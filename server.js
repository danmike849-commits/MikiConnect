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
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e8 // 100MB for video/audio payload
});

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'mikiconnect_super_secret_key_2026';

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("CRITICAL ERROR: MONGO_URI environment variable is missing!");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas!'))
    .catch((err) => console.error('MongoDB Error:', err));
}

// -------------------------------------------------------------
// Schemas & Models
// -------------------------------------------------------------
const UserSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  avatar:    { type: String, default: 'https://via.placeholder.com/150/164228/ffffff?text=User' },
  isAdmin:   { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const PostSchema = new mongoose.Schema({
  author:    { type: String, required: true },
  content:   { type: String, default: '' },
  imageUrl:  { type: String, default: '' },
  videoUrl:  { type: String, default: '' },
  likes:     [{ type: String }],
  comments:  [{
    username: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  sender:      { type: String, required: true },
  recipient:   { type: String, default: 'public' }, // 'public', 'group_ID', or username
  groupId:     { type: String, default: '' },
  content:     { type: String, default: '' },
  mediaUrl:    { type: String, default: '' },
  mediaType:   { type: String, default: '' }, // 'image', 'video', 'voice'
  likes:       [{ type: String }],
  comments:    [{ username: String, text: String, createdAt: { type: Date, default: Date.now } }],
  timestamp:   { type: Date, default: Date.now }
});

const GroupSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  creator:     { type: String, required: true },
  admins:      [{ type: String }],
  members:     [{ type: String }],
  createdAt:   { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Message = mongoose.model('Message', MessageSchema);
const Group = mongoose.model('Group', GroupSchema);

// Middlewares
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Access token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Invalid token.' });
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

// Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, avatar } = req.body;
    if (!username || !email || !password) return res.status(400).json({ success: false, error: 'All fields required.' });

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ success: false, error: 'Username or email already exists.' });

    const userCount = await User.countDocuments();
    const isAdmin = userCount === 0;
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ username, email, password: hashedPassword, avatar, isAdmin });
    await newUser.save();

    res.status(201).json({ success: true, message: 'Account registered!' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Registration failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ success: false, error: 'Credentials missing.' });

    const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, error: 'Invalid login details.' });
    }

    const token = jwt.sign({ userId: user._id, username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { username: user.username, email: user.email, avatar: user.avatar, isAdmin: user.isAdmin } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Login server error.' });
  }
});

// Feed Endpoints
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error fetching posts.' });
  }
});

app.post('/api/posts', authenticateToken, async (req, res) => {
  try {
    const { content, imageUrl, videoUrl } = req.body;
    const newPost = new Post({ author: req.user.username, content, imageUrl: imageUrl || '', videoUrl: videoUrl || '' });
    await newPost.save();
    io.emit('postCreated', newPost);
    res.status(201).json({ success: true, post: newPost });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error publishing post.' });
  }
});

app.post('/api/posts/:id/like', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const index = post.likes.indexOf(req.user.username);
    if (index === -1) post.likes.push(req.user.username);
    else post.likes.splice(index, 1);
    await post.save();
    io.emit('postUpdated', post);
    res.json({ success: true, likes: post.likes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Like toggle failed.' });
  }
});

app.post('/api/posts/:id/comment', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    post.comments.push({ username: req.user.username, text: req.body.text, createdAt: new Date() });
    await post.save();
    io.emit('postUpdated', post);
    res.json({ success: true, comments: post.comments });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Comment failed.' });
  }
});

// Group Endpoints
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await Group.find();
    res.json({ success: true, groups });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Fetch groups failed.' });
  }
});

app.post('/api/groups', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const newGroup = new Group({
      name,
      creator: req.user.username,
      admins: [req.user.username],
      members: [req.user.username]
    });
    await newGroup.save();
    io.emit('groupCreated', newGroup);
    res.status(201).json({ success: true, group: newGroup });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Group creation failed.' });
  }
});

// Admin Routes
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Fetch users failed.' });
  }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Delete failed.' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket Realtime
const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('registerSocketUser', (username) => {
    if (username) {
      onlineUsers.set(username, socket.id);
      io.emit('onlineUsersList', Array.from(onlineUsers.keys()));
    }
  });

  socket.on('sendChatMessage', async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();
      io.emit('receiveChatMessage', newMsg);
    } catch (e) {
      console.error(e);
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

// Emergency route to turn your account into an Admin
app.get('/api/make-me-admin/:username', async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { username: req.params.username },
      { isAdmin: true },
      { new: true }
    );
    if (user) {
      res.send(`SUCCESS: @${user.username} is now an ADMIN! Log out and log back in.`);
    } else {
      res.send(`User '${req.params.username}' not found in database.`);
    }
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Quick route to list all usernames so you can find your account name
app.get('/api/list-users', async (req, res) => {
  try {
    const users = await User.find({}, 'username email isAdmin');
    res.json(users);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

server.listen(PORT, () => console.log(`MikiConnect running on port ${PORT}`));
