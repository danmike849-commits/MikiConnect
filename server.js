const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Port configuration for Render deployment
const PORT = process.env.PORT || 10000;

// Body Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from 'public' folder and root directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// -------------------------------------------------------------
// MongoDB Atlas Connection
// -------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("CRITICAL ERROR: MONGO_URI environment variable is missing!");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch((err) => console.error('MongoDB Atlas Connection Error:', err));
}

// -------------------------------------------------------------
// MongoDB Schemas & Models
// -------------------------------------------------------------
const UserSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  sender:    { type: String, required: true },
  content:   { type: String, required: true },
  room:      { type: String, default: 'general' },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username or email already exists.' });
    }

    const newUser = new User({ username, email, password });
    await newUser.save();

    res.status(201).json({ success: true, message: 'User registered successfully!' });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ success: false, error: 'Server error during registration.' });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username, password });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    res.json({
      success: true,
      message: 'Login successful!',
      user: { username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// Fetch Message History
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).limit(50);
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve messages.' });
  }
});

// Fallback Route: Serve index.html from 'public' folder
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'index.html'), (err2) => {
        if (err2) {
          res.status(404).send('index.html not found on server.');
        }
      });
    }
  });
});

// -------------------------------------------------------------
// Socket.io Real-Time Messaging
// -------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('sendMessage', async (data) => {
    try {
      const { sender, content, room } = data;
      const newMessage = new Message({ sender, content, room });
      await newMessage.save();

      io.emit('receiveMessage', {
        sender: newMessage.sender,
        content: newMessage.content,
        timestamp: newMessage.timestamp
      });
    } catch (err) {
      console.error('Socket error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// -------------------------------------------------------------
// Start Express Server
// -------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`MikiConnect running on port ${PORT}`);
});
