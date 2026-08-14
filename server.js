const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Middleware & Static Files
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Uptime Monitor Health Check
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Root Route
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Database Connection
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB Atlas Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));
}

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false }
});

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, required: true, default: 'Global' },
  text: { type: String, default: '' },
  mediaUrl: { type: String, default: '' },
  mediaType: { type: String, enum: ['text', 'image', 'video', 'audio'], default: 'text' },
  isRead: { type: Boolean, default: false },
  isEdited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

// --- API ENDPOINTS ---

// Auth
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    let user = await User.findOne({ username });
    if (!user) {
      user = await User.create({ username, password, isAdmin: username.toLowerCase() === 'admin' });
    } else if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get User List for Contacts
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username isAdmin');
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
});

// Fetch Chat History (Global or 1-on-1 Private)
app.get('/api/messages', async (req, res) => {
  const { user1, user2 } = req.query;
  try {
    let query = {};
    if (!user2 || user2 === 'Global') {
      query = { receiver: 'Global' };
    } else {
      query = {
        $or: [
          { sender: user1, receiver: user2 },
          { sender: user2, receiver: user1 }
        ]
      };
    }
    const messages = await Message.find(query).sort({ createdAt: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching history' });
  }
});

// Media Upload
app.post('/api/upload', upload.single('mediaFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

// Edit Message (Sender Only)
app.put('/api/messages/:id', async (req, res) => {
  const { sender, text } = req.body;
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found' });
    if (msg.sender !== sender) return res.status(403).json({ success: false, message: 'Unauthorized' });

    msg.text = text;
    msg.isEdited = true;
    await msg.save();

    io.emit('message_updated', msg);
    res.json({ success: true, msg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error updating' });
  }
});

// Delete Message (Sender Only)
app.delete('/api/messages/:id', async (req, res) => {
  const { sender } = req.body;
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found' });
    if (msg.sender !== sender) return res.status(403).json({ success: false, message: 'Unauthorized' });

    await Message.findByIdAndDelete(req.params.id);
    io.emit('message_deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error deleting' });
  }
});

// Admin Data
app.get('/api/admin/data', async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    const messages = await Message.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, users, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Admin error' });
  }
});

// Socket.io Events
io.on('connection', (socket) => {
  socket.on('send_message', async (data) => {
    const newMsg = await Message.create(data);
    io.emit('new_message', newMsg);
  });

  socket.on('mark_read', async ({ messageId }) => {
    const msg = await Message.findByIdAndUpdate(messageId, { isRead: true }, { new: true });
    if (msg) io.emit('message_read_update', { id: messageId, isRead: true });
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
