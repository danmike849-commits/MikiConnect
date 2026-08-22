require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'mikiconnect_secret_key';

// Body Parsers (50MB limit for high-res media)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MONGOOSE SCHEMAS
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String, // 'all' for group, or specific username
  text: String,
  mediaUrl: String,
  mediaType: String, // 'image', 'video', 'audio'
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// AUTH MIDDLEWARE
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.isAdmin === true) return next();
  return res.status(403).json({ error: 'Admin privileges required' });
};

// CLOUDINARY STORAGE
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'mikiconnect_messenger', resource_type: 'auto' }
});
const upload = multer({ storage });

// API ROUTES
app.post('/api/auth/register-or-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  let user = await User.findOne({ username });
  if (!user) {
    const hashedPassword = await bcrypt.hash(password, 10);
    user = new User({ username, password: hashedPassword, isAdmin: username === 'mika' });
    await user.save();
  } else {
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid password' });
  }

  const token = jwt.sign(
{ id: user._id, username: user.username, isAdmin: user.isAdmin },

    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, username: user.username, isAdmin: user.isAdmin });
});



app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: req.file.path });
});

app.get('/api/messages', async (req, res) => {
  const messages = await Message.find().sort({ createdAt: 1 }).limit(100);
  res.json(messages);
});

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

// REAL-TIME MESSENGER SOCKETS
let onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('join', (username) => {
    socket.username = username;
    onlineUsers.set(username, socket.id);
    io.emit('onlineUsersList', Array.from(onlineUsers.keys()));
  });

  socket.on('typing', (isTyping) => {
    socket.broadcast.emit('userTyping', { username: socket.username, isTyping });
  });

  socket.on('sendMessage', async (data) => {
    const newMsg = new Message({
      sender: data.sender,
      receiver: data.receiver || 'all',
      text: data.text || '',
      mediaUrl: data.mediaUrl || null,
      mediaType: data.mediaType || null
    });
    await newMsg.save();
    io.emit('receiveMessage', newMsg);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      io.emit('onlineUsersList', Array.from(onlineUsers.keys()));
    }
  });
});

// START SERVER
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => server.listen(PORT, () => console.log(`Messenger running on port ${PORT}`)))
    .catch(err => console.error(err));
} else {
  server.listen(PORT, () => console.log(`Server started on port ${PORT} (MongoDB URI missing)`));
}

