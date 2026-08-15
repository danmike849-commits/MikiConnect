const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mikiconnect';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// UptimeRobot Health Check (Always returns HTTP 200 to keep Render awake)
app.get('/ping', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.status(200).json({ 
    status: 'online', 
    database: isConnected ? 'connected' : 'connecting/disconnected' 
  });
});

// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false }
});

const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Store active online users
const onlineUsers = new Set();

// API Routes
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    let user = await User.findOne({ username });
    if (!user) {
      const count = await User.countDocuments();
      user = new User({ username, password, isAdmin: count === 0 });
      await user.save();
    } else if (user.password !== password) {
      return res.status(400).json({ success: false, message: 'Invalid password' });
    }
    
    res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username isAdmin');
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/messages', async (req, res) => {
  const { user1, user2 } = req.query;
  try {
    let query;
    if (user2 === 'Global') {
      query = { receiver: 'Global' };
    } else {
      query = {
        $or: [
          { sender: user1, receiver: user2 },
          { sender: user2, receiver: user1 }
        ]
      };
    }
    const messages = await Message.find(query).sort({ timestamp: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Admin Routes
app.get('/api/admin/data', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const users = await User.find({}, 'username isAdmin');
    const messages = await Message.find().sort({ timestamp: -1 }).limit(10);
    
    res.json({
      success: true,
      stats: { totalUsers, onlineUsers: onlineUsers.size, totalMessages },
      users,
      messages
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.put('/api/admin/users/:username/role', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (user) {
      user.isAdmin = !user.isAdmin;
      await user.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/admin/users/:username', async (req, res) => {
  try {
    await User.deleteOne({ username: req.params.username });
    await Message.deleteMany({ $or: [{ sender: req.params.username }, { receiver: req.params.username }] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/admin/messages/:id', async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/admin/clear-global', async (req, res) => {
  try {
    await Message.deleteMany({ receiver: 'Global' });
    io.emit('global_chat_cleared');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Socket.io WebSockets
io.on('connection', (socket) => {
  let currentUser = '';

  socket.on('register_user', (username) => {
    currentUser = username;
    onlineUsers.add(username);
    io.emit('user_status_change');
  });

  socket.on('send_message', async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();
      io.emit('new_message', newMsg);
    } catch (err) {
      console.error('Save message error:', err);
    }
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers.delete(currentUser);
      io.emit('user_status_change');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
