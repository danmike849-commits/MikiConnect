const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

// HTTPS Redirect
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mikiconnect';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'demo',
  api_key: process.env.CLOUDINARY_API_KEY || '123456',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'secret'
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'mikiconnect_uploads',
    resource_type: 'auto'
  }
});
const upload = multer({ storage });

// Database Schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  bio: { type: String, default: 'Hey there! I am using MikiConnect.' }
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
  sender: String,
  recipient: { type: String, default: 'General Chat' },
  text: String,
  mediaUrl: String,
  mediaType: String,
  isEdited: { type: Boolean, default: false },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

function getRoomId(user1, user2) {
  if (user2 === 'General Chat') return 'General Chat';
  return [user1, user2].sort().join('_');
}

// API Routes
app.post('/api/auth/register-or-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    let user = await User.findOne({ username });
    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = new User({ username, password: hashedPassword });
      await user.save();
      return res.json({ username: user.username, bio: user.bio, token: 'demo-token' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid password' });

    res.json({ username: user.username, bio: user.bio, token: 'demo-token' });
  } catch (err) {
    res.status(500).json({ error: 'Auth server error' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username bio');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/messages/:activeChat/:currentUser', async (req, res) => {
  try {
    const { activeChat, currentUser } = req.params;
    let query = {};
    
    if (activeChat === 'General Chat') {
      query = { recipient: 'General Chat' };
    } else {
      query = {
        $or: [
          { sender: currentUser, recipient: activeChat },
          { sender: activeChat, recipient: currentUser }
        ]
      };
      // Mark as read when opening chat
      await Message.updateMany({ sender: activeChat, recipient: currentUser, isRead: false }, { isRead: true });
    }

    const messages = await Message.find(query).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

app.get('/api/unread-counts/:currentUser', async (req, res) => {
  try {
    const { currentUser } = req.params;
    const unread = await Message.aggregate([
      { $match: { recipient: currentUser, isRead: false } },
      { $group: { _id: '$sender', count: { $sum: 1 } } }
    ]);
    res.json(unread);
  } catch (err) {
    res.status(500).json({ error: 'Error counting unreads' });
  }
});

app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: req.file.path || req.file.secure_url });
});

app.put('/api/users/bio', async (req, res) => {
  const { username, bio } = req.body;
  try {
    await User.findOneAndUpdate({ username }, { bio });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

app.put('/api/messages/:id', async (req, res) => {
  try {
    const msg = await Message.findByIdAndUpdate(req.params.id, { text: req.body.text, isEdited: true }, { new: true });
    const roomId = getRoomId(msg.sender, msg.recipient);
    io.to(roomId).emit('message_edited', msg);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (msg) {
      const roomId = getRoomId(msg.sender, msg.recipient);
      await Message.findByIdAndDelete(req.params.id);
      io.to(roomId).emit('message_deleted', req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Socket Events
const activeUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_connected', (username) => {
    activeUsers.set(socket.id, username);
    socket.join(username);
    socket.join('General Chat');
    io.emit('active_users', Array.from(new Set(activeUsers.values())));
  });

  socket.on('join_room', async ({ user1, user2 }) => {
    const roomId = getRoomId(user1, user2);
    socket.join(roomId);

    if (user2 !== 'General Chat') {
      await Message.updateMany({ sender: user2, recipient: user1, isRead: false }, { isRead: true });
      io.to(user2).emit('messages_marked_read', { byUser: user1 });
    }
  });

  socket.on('chat message', async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();

      const roomId = getRoomId(data.sender, data.recipient);
      io.to(roomId).emit('chat message', newMsg);
      io.to(data.recipient).emit('new_unread_notification', { sender: data.sender });
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('typing', (data) => {
    const roomId = getRoomId(data.username, data.recipient);
    socket.to(roomId).emit('user_typing', data);
  });

  socket.on('stop_typing', (data) => {
    const roomId = getRoomId(data.username, data.recipient);
    socket.to(roomId).emit('user_stopped_typing', data);
  });

  socket.on('call_user', (data) => {
    io.to(data.userToCall).emit('incoming_call', { signal: data.signalData, from: data.from, isVideo: data.isVideo });
  });

  socket.on('answer_call', (data) => {
    io.to(data.to).emit('call_accepted', data.signal);
  });

  socket.on('end_call', (data) => {
    io.to(data.to).emit('call_ended');
  });

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('active_users', Array.from(new Set(activeUsers.values())));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
