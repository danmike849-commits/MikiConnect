const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'mikiconnect_secret_key_123';

let rawUri = process.env.MONGO_URI || process.env.MONGODB_URI || '';
if (rawUri.startsWith('Mongodb+srv://')) {
  rawUri = 'mongodb+srv://' + rawUri.substring(14);
}

if (rawUri) {
  mongoose.connect(rawUri)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Error:', err.message));
}

// Health check endpoint
app.get('/ping', (req, res) => {
  res.status(200).json({ 
    status: 'online', 
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' 
  });
});

const checkDbConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Database offline.' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ success: false, message: 'Admins only' });
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  image: { type: String, default: null },
  replyTo: { type: Object, default: null },
  read: { type: Boolean, default: false },
  isEdited: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

const onlineUsers = new Map();

// Auth Routes
app.post('/api/login', checkDbConnection, async (req, res) => {
  const { username, password } = req.body;
  try {
    let user = await User.findOne({ username });
    if (!user) {
      const count = await User.countDocuments();
      user = new User({ username, password, isAdmin: count === 0 });
      await user.save();
    } else if (user.password !== password) {
      return res.status(400).json({ success: false, message: 'Invalid password' });
    }
    const token = jwt.sign({ username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, username: user.username, isAdmin: user.isAdmin, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ success: true, user: decoded });
  } catch (err) {
    res.status(401).json({ success: false });
  }
});

// Admin Routes
app.get('/api/admin/users', checkDbConnection, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, 'username isAdmin lastSeen');
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/users/:username', checkDbConnection, requireAdmin, async (req, res) => {
  try {
    await User.deleteOne({ username: req.params.username });
    await Message.deleteMany({ $or: [{ sender: req.params.username }, { receiver: req.params.username }] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// User & Message Routes
app.get('/api/users', checkDbConnection, async (req, res) => {
  const currentUser = req.query.currentUser;
  try {
    const users = await User.find({}, 'username isAdmin lastSeen');
    const unreadCounts = {};
    if (currentUser) {
      const unreads = await Message.aggregate([
        { $match: { receiver: currentUser, read: false } },
        { $group: { _id: "$sender", count: { $sum: 1 } } }
      ]);
      unreads.forEach(u => unreadCounts[u._id] = u.count);
    }
    const result = users.map(u => ({
      username: u.username,
      isAdmin: u.isAdmin,
      isOnline: onlineUsers.has(u.username),
      lastSeen: u.lastSeen,
      unreadCount: unreadCounts[u.username] || 0
    }));
    res.json({ success: true, users: result });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/messages', checkDbConnection, async (req, res) => {
  const { user1, user2 } = req.query;
  try {
    let query = user2 === 'Global' 
      ? { receiver: 'Global' } 
      : { $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }] };

    if (user2 !== 'Global') {
      await Message.updateMany({ sender: user2, receiver: user1, read: false }, { $set: { read: true } });
      io.emit('messages_read', { sender: user2, receiver: user1 });
    }

    const messages = await Message.find(query).sort({ timestamp: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.put('/api/messages/:id', checkDbConnection, async (req, res) => {
  try {
    const msg = await Message.findByIdAndUpdate(req.params.id, { text: req.body.text, isEdited: true }, { new: true });
    io.emit('message_updated', msg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/messages/:id', checkDbConnection, async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    io.emit('message_deleted', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// WebSockets
io.on('connection', (socket) => {
  let currentUser = '';

  socket.on('register_user', (username) => {
    currentUser = username;
    onlineUsers.set(username, socket.id);
    io.emit('user_status_change');
  });

  socket.on('typing', (data) => socket.broadcast.emit('user_typing', data));
  socket.on('stop_typing', (data) => socket.broadcast.emit('user_stop_typing', data));

  socket.on('send_message', async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();
      io.emit('new_message', newMsg);
    } catch (err) {
      console.error('Save error:', err);
    }
  });

  socket.on('disconnect', async () => {
    if (currentUser) {
      onlineUsers.delete(currentUser);
      await User.updateOne({ username: currentUser }, { $set: { lastSeen: new Date() } });
      io.emit('user_status_change');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
