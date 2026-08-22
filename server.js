const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'mikiconnect_secret_key';

// Schemas & Models
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  mediaUrl: String,
  mediaType: String,
  isEdited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'mikiconnect_media', resource_type: 'auto' }
});
const upload = multer({ storage });

// API Endpoints
app.post('/api/auth/register-or-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    let user = await User.findOne({ username });
    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = new User({ username, password: hashedPassword });
      await user.save();
    } else {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ id: user._id, username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, isAdmin: user.isAdmin });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/messages', async (req, res) => {
  const messages = await Message.find().sort({ createdAt: 1 });
  res.json(messages);
});

app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload failed' });
  res.json({ url: req.file.path, resource_type: req.file.mimetype.split('/')[0] });
});

app.put('/api/messages/:id', async (req, res) => {
  const { text } = req.body;
  const message = await Message.findByIdAndUpdate(req.params.id, { text, isEdited: true }, { new: true });
  io.emit('message_edited', message);
  res.json(message);
});

app.delete('/api/messages/:id', async (req, res) => {
  await Message.findByIdAndDelete(req.params.id);
  io.emit('message_deleted', req.params.id);
  res.json({ success: true });
});

// Socket.io Handlers
const activeUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_connected', (username) => {
    activeUsers.set(username, socket.id);
    io.emit('active_users', Array.from(activeUsers.keys()));
  });

  socket.on('chat message', async (data) => {
    const newMsg = new Message(data);
    await newMsg.save();
    io.emit('chat message', newMsg);
  });

  socket.on('typing', (data) => {
    socket.broadcast.emit('user_typing', data);
  });

  socket.on('disconnect', () => {
    for (let [username, id] of activeUsers.entries()) {
      if (id === socket.id) {
        activeUsers.delete(username);
        break;
      }
    }
    io.emit('active_users', Array.from(activeUsers.keys()));
  });
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(console.error);
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
