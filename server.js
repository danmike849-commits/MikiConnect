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

let rawUri = process.env.MONGO_URI || process.env.MONGODB_URI || '';
if (rawUri.startsWith('Mongodb+srv://')) {
  rawUri = 'mongodb+srv://' + rawUri.substring(14);
}

const MONGO_URI = rawUri;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Error:', err.message));
}

app.get('/ping', (req, res) => {
  res.status(200).json({ 
    status: 'online', 
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' 
  });
});

const checkDbConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Database connection offline.' });
  }
  next();
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
  replyTo: { type: Object, default: null },
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

const onlineUsers = new Map();

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
    res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/users', checkDbConnection, async (req, res) => {
  try {
    const users = await User.find({}, 'username isAdmin lastSeen');
    const result = users.map(u => ({
      username: u.username,
      isAdmin: u.isAdmin,
      isOnline: onlineUsers.has(u.username),
      lastSeen: u.lastSeen
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

io.on('connection', (socket) => {
  let currentUser = '';

  socket.on('register_user', async (username) => {
    currentUser = username;
    onlineUsers.set(username, socket.id);
    io.emit('user_status_change');
  });

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
