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
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'miki_super_secret_jwt_key_2026';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mikiconnect';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// HTTPS Redirect Middleware
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Models
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  bio: { type: String, default: '' },
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  roomId: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Admin Guard Middleware
async function isAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });

    try {
      const user = await User.findById(decoded.id);
      if (user && user.role === 'admin') {
        req.user = user;
        return next();
      }
      res.status(403).json({ error: 'Admin access required' });
    } catch (e) {
      res.status(500).json({ error: 'Database verification failed' });
    }
  });
}

// Admin APIs
app.get('/api/admin/stats', isAdmin, async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalMessages = await Message.countDocuments();
  const bannedUsers = await User.countDocuments({ isBanned: true });
  const activeSockets = io.engine.clientsCount || 0;
  res.json({ totalUsers, totalMessages, bannedUsers, activeSockets });
});

app.get('/api/admin/users', isAdmin, async (req, res) => {
  const users = await User.find({}, 'username role isBanned createdAt').sort({ createdAt: -1 });
  res.json(users);
});

app.put('/api/admin/users/ban', isAdmin, async (req, res) => {
  const { username, isBanned } = req.body;
  await User.updateOne({ username }, { $set: { isBanned } });
  res.json({ success: true });
});

app.put('/api/admin/users/role', isAdmin, async (req, res) => {
  const { username, role } = req.body;
  await User.updateOne({ username }, { $set: { role } });
  res.json({ success: true });
});

app.delete('/api/admin/users/:username', isAdmin, async (req, res) => {
  await User.deleteOne({ username: req.params.username });
  res.json({ success: true });
});

app.get('/api/admin/messages', isAdmin, async (req, res) => {
  const messages = await Message.find().sort({ createdAt: -1 }).limit(20);
  res.json(messages);
});

app.delete('/api/admin/messages/:id', isAdmin, async (req, res) => {
  await Message.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/broadcast', isAdmin, async (req, res) => {
  const { message } = req.body;
  io.emit('systemAnnouncement', { text: message, sender: 'SYSTEM' });
  res.json({ success: true });
});

// Auth API
app.post('/api/auth/register-or-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    let user = await User.findOne({ username });
    if (!user) {
      const isFirstAccount = (await User.countDocuments({})) === 0;
      const hashedPassword = await bcrypt.hash(password, 10);
      user = new User({ username, password: hashedPassword, role: isFirstAccount ? 'admin' : 'user' });
      await user.save();
      
      const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ role: user.role, token, username: user.username, role: user.role, bio: user.bio });
    }

    if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ role: user.role, token, username: user.username, role: user.role, bio: user.bio });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket Handler
io.on('connection', (socket) => {
  socket.on('sendMessage', async (data) => {
    const msg = new Message(data);
    await msg.save();
    io.emit('receiveMessage', msg);
  });
});

// Server Listener Required for Render
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
