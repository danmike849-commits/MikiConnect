const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MONGO DB CONNECTION
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://mikedan849:mike1234@cluster0.0yq4c.mongodb.net/mikiconnect?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// SCHEMAS
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false }
});

const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  mediaType: { type: String, default: 'text' },
  mediaUrl: String,
  replyTo: Object,
  reactions: { type: Map, of: String, default: {} },
  isRead: { type: Boolean, default: false },
  isEdited: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

let onlineUsers = new Map();

// AUTH ROUTES
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: 'Missing username or password' });

  try {
    let user = await User.findOne({ username });
    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = new User({ username, password: hashedPassword, isAdmin: username.toLowerCase() === 'admin' });
      await user.save();
      return res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.json({ success: false, message: 'Invalid credentials' });

    res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
  } catch (err) {
    res.json({ success: false, message: 'Server authentication error' });
  }
});

// FETCH USERS
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username isAdmin');
    res.json({ success: true, users });
  } catch (err) {
    res.json({ success: false, message: 'Failed to fetch users' });
  }
});

// FETCH MESSAGES
app.get('/api/messages', async (req, res) => {
  const { user1, user2 } = req.query;
  try {
    let query = {};
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
    res.json({ success: false, message: 'Failed to fetch messages' });
  }
});

// ADMIN DATA API
app.get('/api/admin/data', async (req, res) => {
  try {
    const users = await User.find({}, 'username isAdmin');
    const messages = await Message.find().sort({ timestamp: -1 }).limit(100);
    const totalMessages = await Message.countDocuments();
    
    res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        onlineUsers: onlineUsers.size,
        totalMessages
      },
      users,
      messages
    });
  } catch (err) {
    res.json({ success: false, message: 'Failed to fetch admin data' });
  }
});

// ADMIN USER DELETION
app.delete('/api/admin/users/:username', async (req, res) => {
  try {
    await User.deleteOne({ username: req.params.username });
    await Message.deleteMany({ $or: [{ sender: req.params.username }, { receiver: req.params.username }] });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    res.json({ success: false, message: 'Failed to delete user' });
  }
});

// ADMIN TOGGLE ROLE
app.put('/api/admin/users/:username/role', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.json({ success: false, message: 'User not found' });
    user.isAdmin = !user.isAdmin;
    await user.save();
    res.json({ success: true, isAdmin: user.isAdmin });
  } catch (err) {
    res.json({ success: false, message: 'Failed to update role' });
  }
});

// ADMIN MESSAGE DELETION
app.delete('/api/admin/messages/:id', async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    io.emit('message_deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: 'Failed to delete message' });
  }
});

// ADMIN PURGE GLOBAL CHAT
app.post('/api/admin/clear-global', async (req, res) => {
  try {
    await Message.deleteMany({ receiver: 'Global' });
    io.emit('global_chat_cleared');
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: 'Failed to clear chat' });
  }
});

// SOCKET.IO REALTIME ENGINE
io.on('connection', (socket) => {
  socket.on('register_user', (username) => {
    onlineUsers.set(username, socket.id);
    io.emit('user_status_change', Array.from(onlineUsers.keys()));
  });

  socket.on('send_message', async (data) => {
    try {
      const msg = new Message(data);
      await msg.save();
      
      if (data.receiver === 'Global') {
        io.emit('new_message', msg);
      } else {
        const targetSocketId = onlineUsers.get(data.receiver);
        if (targetSocketId) io.to(targetSocketId).emit('new_message', msg);
        socket.emit('new_message', msg);
      }
    } catch (err) {
      console.error('Message save error:', err);
    }
  });

  socket.on('typing_start', ({ sender, receiver }) => {
    if (receiver === 'Global') {
      socket.broadcast.emit('user_typing', { sender, receiver: 'Global', isTyping: true });
    } else {
      const targetSocketId = onlineUsers.get(receiver);
      if (targetSocketId) io.to(targetSocketId).emit('user_typing', { sender, receiver, isTyping: true });
    }
  });

  socket.on('typing_stop', ({ sender, receiver }) => {
    if (receiver === 'Global') {
      socket.broadcast.emit('user_typing', { sender, receiver: 'Global', isTyping: false });
    } else {
      const targetSocketId = onlineUsers.get(receiver);
      if (targetSocketId) io.to(targetSocketId).emit('user_typing', { sender, receiver, isTyping: false });
    }
  });

  socket.on('add_reaction', async ({ messageId, username, emoji }) => {
    try {
      const msg = await Message.findById(messageId);
      if (msg) {
        msg.reactions.set(username, emoji);
        await msg.save();
        io.emit('reaction_updated', { messageId, reactions: Object.fromEntries(msg.reactions) });
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    for (let [username, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(username);
        break;
      }
    }
    io.emit('user_status_change', Array.from(onlineUsers.keys()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
