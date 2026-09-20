const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mikiconnect_secret_key_2026';
const MONGO_URI = process.env.MONGO_URI;

const ADMIN_IDENTIFIERS = ['danmike849@gmail.com', 'danmike849', '08000000000'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// USER SCHEMA WITH PHONE & EMAIL
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  isBanned: { type: Boolean, default: false },
  
  // DATING PROFILE FIELDS
  photos: { type: [String], default: [] },
  age: { type: Number, min: 18, max: 100 },
  gender: { type: String, enum: ['man', 'woman', 'nonbinary', 'other'] },
  interestedIn: { type: String, enum: ['men', 'women', 'everyone'] },
  bio: { type: String, maxlength: 300, default: '' },
  location: { type: String, default: '' },
  isPremium: { type: Boolean, default: false },
  
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const PostSchema = new mongoose.Schema({
  author: { type: String, required: true },
  caption: { type: String, required: true },
  likes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);


// GET CURRENT USER PROFILE
app.get('/api/user/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve profile: ' + err.message });
  }
});

// UPDATE USER PROFILE
app.put('/api/user/profile', authenticate, async (req, res) => {
  const { photos, age, gender, interestedIn, bio, location } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (photos !== undefined) user.photos = photos;
    if (age !== undefined) user.age = Number(age);
    if (gender !== undefined) user.gender = gender;
    if (interestedIn !== undefined) user.interestedIn = interestedIn;
    if (bio !== undefined) user.bio = bio;
    if (location !== undefined) user.location = location;

    await user.save();
    res.json({ message: 'Profile updated successfully!', user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile: ' + err.message });
  }
});

// AUTH MIDDLEWARE
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (!ADMIN_IDENTIFIERS.includes(req.user.username.toLowerCase())) {
    return res.status(403).json({ error: 'Access Denied: Admin privileges required.' });
  }
  next();
};

// 1. LOGIN / ACCOUNT CHECK
app.post('/api/auth/login-check', async (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Phone number/Username and password are required' });

  username = username.toLowerCase().trim();

  try {
    let user = await User.findOne({
      $or: [
        { username: username },
        { phone: username },
        { email: username }
      ]
    });

    if (user && user.isBanned) {
      return res.status(403).json({ error: 'This account has been banned by Admin.' });
    }

    // Account Not Found -> Inform Frontend to show Sign-Up Form
    if (!user) {
      return res.status(404).json({ 
        accountExists: false, 
        message: 'No account found. Please complete registration.' 
      });
    }

    // Account Found -> Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Incorrect password entered.' });

    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role: user.role });

  } catch (err) {
    res.status(500).json({ error: 'Authentication error: ' + err.message });
  }
});

// 2. EXPLICIT ACCOUNT REGISTRATION
app.post('/api/auth/register', async (req, res) => {
  let { identifier, username, password } = req.body;
  if (!identifier || !username || !password) {
    return res.status(400).json({ error: 'All registration fields are required.' });
  }

  identifier = identifier.toLowerCase().trim();
  username = username.toLowerCase().trim();

  try {
    const existingUser = await User.findOne({ username: username });
    if (existingUser) {
      return res.status(400).json({ error: `Username "${username}" is already taken. Try another.` });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const isOwner = ADMIN_IDENTIFIERS.includes(identifier) || ADMIN_IDENTIFIERS.includes(username);
    const isPhone = /^\+?[0-9]{7,15}$/.test(identifier);

    const newUser = new User({
      username: username,
      phone: isPhone ? identifier : undefined,
      email: identifier.includes('@') ? identifier : `${username}@mikiconnect.app`,
      password: hashedPassword,
      role: isOwner ? 'admin' : 'user'
    });

    await newUser.save();

    const token = jwt.sign({ id: newUser._id, username: newUser.username, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, username: newUser.username, role: newUser.role, message: 'Account created successfully!' });

  } catch (err) {
    res.status(500).json({ error: 'Registration error: ' + err.message });
  }
});

// 3. FORGOT PASSWORD (IN-APP CODE GENERATION)
app.post('/api/auth/forgot-password', async (req, res) => {
  let { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Please enter a valid Phone Number or Username.' });

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { phone: identifier },
        { email: identifier }
      ]
    });

    if (!user) return res.status(404).json({ error: `No account exists for "${identifier}".` });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = Date.now() + 3600000;
    await user.save();

    return res.json({ 
      success: true,
      resetCode: resetCode,
      message: 'Reset code generated successfully!' 
    });

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// 4. RESET PASSWORD FINALIZATION
app.post('/api/auth/reset-password', async (req, res) => {
  let { identifier, resetCode, newPassword } = req.body;
  if (!identifier || !resetCode || !newPassword) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { phone: identifier },
        { email: identifier }
      ]
    });

    if (!user) return res.status(404).json({ error: 'Account not found.' });

    if (!user.resetToken || user.resetToken !== resetCode.trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit reset code.' });
    }

    if (user.resetTokenExpiry && Date.now() > user.resetTokenExpiry) {
      return res.status(400).json({ error: 'Reset code has expired. Request a new one.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully! You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// POSTS & REALTIME FEEDS
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).limit(50);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.post('/api/posts', authenticate, async (req, res) => {
  const { caption } = req.body;
  if (!caption) return res.status(400).json({ error: 'Caption required' });

  try {
    const post = new Post({ author: req.user.username, caption });
    await post.save();
    io.emit('new_post', post);
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save post' });
  }
});

// SOCKET DM ROUTING
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('register_user', (username) => {
    if (username) userSockets[username.toLowerCase()] = socket.id;
  });

  socket.on('send_message', (data) => {
    io.emit('receive_message', data);
  });

  socket.on('send_private_message', (data) => {
    const recipientSocketId = userSockets[data.recipient.toLowerCase()];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('receive_private_message', data);
    }
    socket.emit('receive_private_message', data);
  });

  socket.on('disconnect', () => {
    for (const [user, id] of Object.entries(userSockets)) {
      if (id === socket.id) delete userSockets[user];
    }
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

server.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
  if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('Connected to MongoDB Atlas'))
      .catch(err => console.error('MongoDB error:', err.message));
  }
});
