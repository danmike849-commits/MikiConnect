const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'mikiconnect_super_secret_key_2026';

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
// Schemas & Models
// -------------------------------------------------------------
const UserSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  avatar:    { type: String, default: 'https://via.placeholder.com/150/007bff/ffffff?text=User' },
  isAdmin:   { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const PostSchema = new mongoose.Schema({
  author:    { type: String, required: true },
  content:   { type: String, required: true },
  imageUrl:  { type: String, default: '' },
  likes:     [{ type: String }],
  comments:  [{
    username: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  sender:    { type: String, required: true },
  recipient: { type: String, default: 'public' }, // 'public' or specific username
  content:   { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Message = mongoose.model('Message', MessageSchema);

// -------------------------------------------------------------
// Authentication Middlewares
// -------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Access token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }
  next();
}

// -------------------------------------------------------------
// Auth Endpoints
// -------------------------------------------------------------
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, avatar } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username or email already exists.' });
    }

    const userCount = await User.countDocuments();
    const isAdmin = userCount === 0; // First account gets Admin rights
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      avatar: avatar || undefined,
      isAdmin
    });
    await newUser.save();

    res.status(201).json({ success: true, message: 'User registered successfully!' });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ success: false, error: 'Server error during registration.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, email, identifier, password } = req.body;
    const loginId = username || email || identifier;

    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: 'Please enter username/email and password.' });
    }

    const user = await User.findOne({
      $or: [{ username: loginId }, { email: loginId }]
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { userId: user._id, username: user.username, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: { username: user.username, email: user.email, avatar: user.avatar, isAdmin: user.isAdmin }
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// -------------------------------------------------------------
// Feed Post Endpoints (Protected + Real-time Socket Broadcast)
// -------------------------------------------------------------
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve posts.' });
  }
});

app.post('/api/posts', authenticateToken, async (req, res) => {
  try {
    const { content, imageUrl } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Post content required.' });

    const newPost = new Post({
      author: req.user.username,
      content,
      imageUrl: imageUrl || '',
      likes: [],
      comments: []
    });
    await newPost.save();

    // Broadcast new post in real time to all connected users
    io.emit('postCreated', newPost);

    res.status(201).json({ success: true, post: newPost });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create post.' });
  }
});

app.post('/api/posts/:id/like', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });

    const username = req.user.username;
    const index = post.likes.indexOf(username);
    if (index === -1) {
      post.likes.push(username);
    } else {
      post.likes.splice(index, 1);
    }
    await post.save();

    // Broadcast updated post state to all connected users
    io.emit('postUpdated', post);

    res.json({ success: true, likes: post.likes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Like toggle failed.' });
  }
});

app.post('/api/posts/:id/comment', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'Comment text required.' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });

    post.comments.push({ username: req.user.username, text, createdAt: new Date() });
    await post.save();

    // Broadcast updated post comments to all connected users
    io.emit('postUpdated', post);

    res.json({ success: true, comments: post.comments });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Comment failed.' });
  }
});

// -------------------------------------------------------------
// Admin Endpoints (Protected with JWT + Admin Check)
// -------------------------------------------------------------
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users.' });
  }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
});

// Serve Fallback HTML
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------------------------------------------------
// Socket.io Real-Time Messaging (Public & Private DMs)
// -------------------------------------------------------------
const onlineUsers = new Map(); // username -> socketId

io.on('connection', (socket) => {
  socket.on('registerSocketUser', (username) => {
    if (username) {
      onlineUsers.set(username, socket.id);
      io.emit('onlineUsersList', Array.from(onlineUsers.keys()));
    }
  });

  socket.on('sendPublicMessage', async (data) => {
    try {
      const newMsg = new Message({ sender: data.sender, recipient: 'public', content: data.content });
      await newMsg.save();
      io.emit('receivePublicMessage', newMsg);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('sendPrivateMessage', async (data) => {
    try {
      const { sender, recipient, content } = data;
      const newMsg = new Message({ sender, recipient, content });
      await newMsg.save();

      const recipientSocketId = onlineUsers.get(recipient);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('receivePrivateMessage', newMsg);
      }
      // Send copy back to sender
      socket.emit('receivePrivateMessage', newMsg);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    for (let [user, id] of onlineUsers.entries()) {
      if (id === socket.id) {
        onlineUsers.delete(user);
        break;
      }
    }
    io.emit('onlineUsersList', Array.from(onlineUsers.keys()));
  });
});

server.listen(PORT, () => {
  console.log(`MikiConnect running securely on port ${PORT}`);
});
