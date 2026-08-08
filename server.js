require('dotenv').config();

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

// --- MONGODB CONNECTION FROM .ENV ---
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas successfully!'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// --- SCHEMAS & MODELS ---
const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  is_admin: { type: Number, default: 0 }
}));

const Post = mongoose.model('Post', new mongoose.Schema({
  username: String,
  content: String,
  likes: { type: Number, default: 0 },
  comments: [{ username: String, text: String, created_at: { type: Date, default: Date.now } }],
  created_at: { type: Date, default: Date.now }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  created_at: { type: Date, default: Date.now }
}));

// --- AUTH ROUTES ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === 'MikiConnect' && password === 'admin123') {
      return res.json({ id: 'admin', username: 'MikiConnect', is_admin: 1 });
    }

    const user = await User.findOne({ username, password });
    if (user) {
      return res.json({ id: user._id, username: user.username, is_admin: user.is_admin });
    }
    res.status(401).json({ error: 'Invalid username or password' });
  } catch (err) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const newUser = new User({ username, password });
    await newUser.save();
    res.json({ id: newUser._id, username: newUser.username, is_admin: 0 });
  } catch (err) {
    res.status(400).json({ error: 'Username already taken or database error' });
  }
});

// --- POSTS ROUTES ---
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ created_at: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch posts' });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const { content, username } = req.body;
    const newPost = new Post({ username, content });
    await newPost.save();
    res.json(newPost);
  } catch (err) {
    res.status(500).json({ error: 'Could not create post' });
  }
});

app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (post) {
      post.likes = (post.likes || 0) + 1;
      await post.save();
      return res.json({ success: true, likes: post.likes });
    }
    res.status(404).json({ error: 'Post not found' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to like post' });
  }
});

app.post('/api/posts/:id/comment', async (req, res) => {
  try {
    const { username, text } = req.body;
    const post = await Post.findById(req.params.id);
    if (post) {
      post.comments.push({ username, text });
      await post.save();
      return res.json({ success: true, comments: post.comments });
    }
    res.status(404).json({ error: 'Post not found' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// --- USERS & MESSAGES ---
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username is_admin');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch users' });
  }
});

app.get('/api/messages/:otherUser', async (req, res) => {
  try {
    const { otherUser } = req.params;
    const currentUser = req.query.username;

    const msgs = await Message.find({
      $or: [
        { sender: currentUser, receiver: otherUser },
        { sender: otherUser, receiver: currentUser }
      ]
    }).sort({ created_at: 1 });

    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch messages' });
  }
});

// --- REAL-TIME SOCKETS ---
io.on('connection', (socket) => {
  socket.on('register_user', (username) => {
    socket.username = username;
    io.emit('update_users');
  });

  socket.on('send_message', async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();
      io.emit('receive_message', data);
    } catch (e) {}
  });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`MikiConnect Server Active on Port ${PORT}`);
});
