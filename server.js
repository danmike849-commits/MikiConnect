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

const PORT = process.env.PORT || 10000;

// Body Parsing & Static Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// MongoDB Atlas Connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("CRITICAL ERROR: MONGO_URI environment variable is missing!");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch((err) => console.error('MongoDB Atlas Connection Error:', err));
}

// -------------------------------------------------------------
// Database Schemas & Models
// -------------------------------------------------------------
const UserSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  isAdmin:   { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  sender:    { type: String, required: true },
  content:   { type: String, required: true },
  room:      { type: String, default: 'general' },
  timestamp: { type: Date, default: Date.now }
});

const PostSchema = new mongoose.Schema({
  author:    { type: String, required: true },
  content:   { type: String, required: true },
  likes:     [{ type: String }], // Array of usernames who liked
  comments:  [{
    username: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Post = mongoose.model('Post', PostSchema);

// -------------------------------------------------------------
// Authentication Endpoints
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

    const userCount = await User.countDocuments();
    const isAdmin = userCount === 0;

    const newUser = new User({ username, email, password, isAdmin });
    await newUser.save();

    res.status(201).json({ success: true, message: 'User registered successfully!', isAdmin });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ success: false, error: 'Server error during registration.' });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, email, identifier, password } = req.body;
    const loginId = username || email || identifier;

    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: 'Please enter username/email and password.' });
    }

    const user = await User.findOne({
      $or: [{ username: loginId }, { email: loginId }],
      password: password
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    res.json({
      success: true,
      message: 'Login successful!',
      user: { username: user.username, email: user.email, isAdmin: user.isAdmin }
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// -------------------------------------------------------------
// Feed Post Endpoints (Create, Read, Like, Comment)
// -------------------------------------------------------------

// 1. Create a New Post
app.post('/api/posts', async (req, res) => {
  try {
    const { author, content } = req.body;
    if (!author || !content) {
      return res.status(400).json({ success: false, error: 'Author and content are required.' });
    }

    const newPost = new Post({ author, content, likes: [], comments: [] });
    await newPost.save();

    res.status(201).json({ success: true, post: newPost });
  } catch (error) {
    console.error('Create Post Error:', error);
    res.status(500).json({ success: false, error: 'Failed to create feed post.' });
  }
});

// 2. Fetch All Posts (Most recent first)
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json({ success: true, posts });
  } catch (error) {
    console.error('Fetch Posts Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve feed posts.' });
  }
});

// 3. Toggle Like / Unlike a Post
app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required to like.' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found.' });
    }

    const likeIndex = post.likes.indexOf(username);
    if (likeIndex === -1) {
      post.likes.push(username); // Add Like
    } else {
      post.likes.splice(likeIndex, 1); // Remove Like
    }

    await post.save();
    res.json({ success: true, likes: post.likes });
  } catch (error) {
    console.error('Like Error:', error);
    res.status(500).json({ success: false, error: 'Failed to update like status.' });
  }
});

// 4. Add Comment to a Post
app.post('/api/posts/:id/comment', async (req, res) => {
  try {
    const { username, text } = req.body;
    if (!username || !text) {
      return res.status(400).json({ success: false, error: 'Username and comment text are required.' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found.' });
    }

    post.comments.push({ username, text, createdAt: new Date() });
    await post.save();

    res.json({ success: true, comments: post.comments });
  } catch (error) {
    console.error('Comment Error:', error);
    res.status(500).json({ success: false, error: 'Failed to add comment.' });
  }
});

// -------------------------------------------------------------
// Admin & Message Endpoints
// -------------------------------------------------------------
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users.' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).limit(50);
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve messages.' });
  }
});

// Fallback Route (Serves frontend)
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

// Socket.io Real-Time Messaging
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

server.listen(PORT, () => {
  console.log(`MikiConnect running on port ${PORT}`);
});
