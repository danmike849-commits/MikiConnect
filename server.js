const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8 // 100 MB limit for voice/media
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mikiconnect';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Schemas & Models
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  mediaUrl: String,
  mediaType: String,
  isEdited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// File Upload Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// API ROUTES
app.post('/api/auth/register-or-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    let user = await User.findOne({ username });
    if (!user) {
      user = new User({ username, password });
      await user.save();
    } else if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    res.json({ username: user.username, token: 'demo-token' });
  } catch (err) {
    res.status(500).json({ error: 'Auth server error' });
  }
});

// GET ALL REGISTERED USERS (MUST BE BEFORE LISTEN)
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username');
    res.json(users.map(u => u.username));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.put('/api/messages/:id', async (req, res) => {
  try {
    const msg = await Message.findByIdAndUpdate(req.params.id, { text: req.body.text, isEdited: true }, { new: true });
    io.emit('message_edited', msg);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    io.emit('message_deleted', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// SOCKET.IO REALTIME EVENTS
const activeUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_connected', (username) => {
    activeUsers.set(socket.id, username);
    io.emit('active_users', Array.from(new Set(activeUsers.values())));
  });

  socket.on('chat message', async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();
      io.emit('chat message', newMsg);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('typing', (data) => {
    socket.broadcast.emit('user_typing', data);
  });

  socket.on('call_user', (data) => {
    const targetSocketId = [...activeUsers.entries()].find(([_, un]) => un === data.userToCall)?.[0];
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming_call', { signal: data.signalData, from: data.from, isVideo: data.isVideo });
    }
  });

  socket.on('answer_call', (data) => {
    const targetSocketId = [...activeUsers.entries()].find(([_, un]) => un === data.to)?.[0];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_accepted', data.signal);
    }
  });

  socket.on('end_call', (data) => {
    const targetSocketId = [...activeUsers.entries()].find(([_, un]) => un === data.to)?.[0];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_ended');
    }
  });

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('active_users', Array.from(new Set(activeUsers.values())));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
