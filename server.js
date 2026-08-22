const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');

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

// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'demo',
  api_key: process.env.CLOUDINARY_API_KEY || '123456',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'secret'
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'mikiconnect_uploads', resource_type: 'auto' }
});
const upload = multer({ storage });

// Web Push Setup
const vapidKeys = webpush.generateVAPIDKeys();
webpush.setVapidDetails('mailto:admin@mikiconnect.com', vapidKeys.publicKey, vapidKeys.privateKey);

// Database Schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  bio: { type: String, default: 'Hey there! I am using MikiConnect.' },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isBanned: { type: Boolean, default: false },
  pushSubscription: { type: Object, default: null }
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

// Middleware: Admin Guard
async function isAdmin(req, res, next) {
  const adminUsername = req.headers['x-admin-user'];
  if (!adminUsername) return res.status(401).json({ error: 'Unauthorized' });
  const user = await User.findOne({ username: adminUsername });
  if (user && user.role === 'admin') return next();
  res.status(403).json({ error: 'Access denied: Admin permissions required' });
}

// Auth API
app.post('/api/auth/register-or-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    let user = await User.findOne({ username });
    if (!user) {
      const isFirstAccount = (await User.countDocuments({})) === 0;
      const hashedPassword = await bcrypt.hash(password, 10);
      user = new User({ username, password: hashedPassword, role: isFirstAccount ? 'admin' : 'user' });
      await user.save();
      return res.json({ username: user.username, bio: user.bio, role: user.role });
    }

    if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid password' });

    res.json({ username: user.username, bio: user.bio, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Auth server error' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({ isBanned: false }, 'username bio role');
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

// ADMIN ROUTES
app.get('/api/admin/stats', isAdmin, async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalMessages = await Message.countDocuments();
  const bannedUsers = await User.countDocuments({ isBanned: true });
  res.json({ totalUsers, totalMessages, bannedUsers, activeSockets: activeUsers.size });
});

app.get('/api/admin/users', isAdmin, async (req, res) => {
  const users = await User.find({}, 'username role isBanned bio');
  res.json(users);
});

app.put('/api/admin/users/ban', isAdmin, async (req, res) => {
  const { username, isBanned } = req.body;
  await User.findOneAndUpdate({ username }, { isBanned });
  res.json({ success: true });
});

app.put('/api/admin/users/role', isAdmin, async (req, res) => {
  const { username, role } = req.body;
  await User.findOneAndUpdate({ username }, { role });
  res.json({ success: true });
});

app.delete('/api/admin/messages/:id', isAdmin, async (req, res) => {
  await Message.findByIdAndDelete(req.params.id);
  io.emit('message_deleted', req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/broadcast', isAdmin, async (req, res) => {
  const { text } = req.body;
  const sysMsg = new Message({ sender: 'SYSTEM', recipient: 'General Chat', text });
  await sysMsg.save();
  io.to('General Chat').emit('chat message', sysMsg);
  res.json({ success: true });
});

// Push Subscription Route
app.get('/api/push/key', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));
app.post('/api/push/subscribe', async (req, res) => {
  const { username, subscription } = req.body;
  await User.findOneAndUpdate({ username }, { pushSubscription: subscription });
  res.json({ success: true });
});

// Socket.io Setup
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

      // Web Push Notification to offline target user
      if (data.recipient !== 'General Chat') {
        const recipientUser = await User.findOne({ username: data.recipient });
        if (recipientUser && recipientUser.pushSubscription) {
          const payload = JSON.stringify({ title: `New message from ${data.sender}`, body: data.text || 'Media File' });
          webpush.sendNotification(recipientUser.pushSubscription, payload).catch(err => console.error(err));
        }
      }
    } catch (err) {
      console.error('Socket message error:', err);
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

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('active_users', Array.from(new Set(activeUsers.values())));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
