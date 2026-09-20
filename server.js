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
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ADMIN_EMAILS = ['danmike849@gmail.com', 'danmike849'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SCHEMAS
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  isBanned: { type: Boolean, default: false },
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
  if (!ADMIN_EMAILS.includes(req.user.username.toLowerCase())) {
    return res.status(403).json({ error: 'Access Denied: Admin privileges required.' });
  }
  next();
};

// REGISTER OR LOGIN
app.post('/api/auth/register-or-login', async (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username/Email and password are required' });

  username = username.toLowerCase().trim();

  try {
    let user = await User.findOne({
      $or: [
        { username: new RegExp(`^${username}$`, 'i') },
        { email: new RegExp(`^${username}$`, 'i') }
      ]
    });

    if (user && user.isBanned) {
      return res.status(403).json({ error: 'This account has been banned by Admin.' });
    }

    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const isOwner = ADMIN_EMAILS.includes(username);
      user = new User({ 
        username: username, 
        email: username.includes('@') ? username : `${username}@mikiconnect.app`, 
        password: hashedPassword,
        role: isOwner ? 'admin' : 'user'
      });
      await user.save();
    } else {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ error: 'Incorrect password entered.' });
    }

    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Authentication error: ' + err.message });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  let { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Please enter a valid email address or username.' });

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') }
      ]
    });

    if (!user) return res.status(404).json({ error: `No account exists for "${identifier}".` });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = Date.now() + 3600000;
    await user.save();

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.json({ 
        message: `RESEND_API_KEY missing on Render! Fallback code: ${resetCode}` 
      });
    }

    try {
      const { Resend } = require('resend');
      const resend = new Resend(apiKey);
      const emailResult = await resend.emails.send({
        from: 'MikiConnect <onboarding@resend.dev>',
        to: user.email,
        subject: 'MikiConnect Password Reset Code',
        html: `<p>Your MikiConnect password reset code is: <strong>${resetCode}</strong></p>`
      });

      if (emailResult.error) {
        return res.status(400).json({ error: `Resend Error: ${emailResult.error.message}` });
      }

      return res.json({ message: `Password reset code sent to ${user.email}!` });
    } catch (sdkErr) {
      return res.status(500).json({ error: `SDK Error: ${sdkErr.message}` });
    }

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// RESEND VERIFICATION
app.post('/api/auth/resend-verification', async (req, res) => {
  let { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Please enter a valid email address or username.' });

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') }
      ]
    });

    if (!user) return res.status(404).json({ error: `No account found for "${identifier}".` });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.json({ message: `RESEND_API_KEY not found on Render.` });
    }

    try {
      const { Resend } = require('resend');
      const resend = new Resend(apiKey);
      const emailResult = await resend.emails.send({
        from: 'MikiConnect <onboarding@resend.dev>',
        to: user.email,
        subject: 'MikiConnect Email Verification',
        html: `<p>Hello ${user.username}, your account is active and verified!</p>`
      });

      if (emailResult.error) {
        return res.status(400).json({ error: `Resend Error: ${emailResult.error.message}` });
      }

      return res.json({ message: `Verification email sent to ${user.email}!` });
    } catch (sdkErr) {
      return res.status(500).json({ error: `SDK Error: ${sdkErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});


// RESET PASSWORD FINALIZATION
app.post('/api/auth/reset-password', async (req, res) => {
  let { identifier, resetCode, newPassword } = req.body;
  if (!identifier || !resetCode || !newPassword) {
    return res.status(400).json({ error: 'All fields are required (identifier, code, and new password).' });
  }

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${identifier}const express = require('express');
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
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ADMIN_EMAILS = ['danmike849@gmail.com', 'danmike849'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SCHEMAS
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  isBanned: { type: Boolean, default: false },
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
  if (!ADMIN_EMAILS.includes(req.user.username.toLowerCase())) {
    return res.status(403).json({ error: 'Access Denied: Admin privileges required.' });
  }
  next();
};

// REGISTER OR LOGIN
app.post('/api/auth/register-or-login', async (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username/Email and password are required' });

  username = username.toLowerCase().trim();

  try {
    let user = await User.findOne({
      $or: [
        { username: new RegExp(`^${username}$`, 'i') },
        { email: new RegExp(`^${username}$`, 'i') }
      ]
    });

    if (user && user.isBanned) {
      return res.status(403).json({ error: 'This account has been banned by Admin.' });
    }

    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const isOwner = ADMIN_EMAILS.includes(username);
      user = new User({ 
        username: username, 
        email: username.includes('@') ? username : `${username}@mikiconnect.app`, 
        password: hashedPassword,
        role: isOwner ? 'admin' : 'user'
      });
      await user.save();
    } else {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ error: 'Incorrect password entered.' });
    }

    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Authentication error: ' + err.message });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  let { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Please enter a valid email address or username.' });

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') }
      ]
    });

    if (!user) return res.status(404).json({ error: `No account exists for "${identifier}".` });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = Date.now() + 3600000;
    await user.save();

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.json({ 
        message: `RESEND_API_KEY missing on Render! Fallback code: ${resetCode}` 
      });
    }

    try {
      const { Resend } = require('resend');
      const resend = new Resend(apiKey);
      const emailResult = await resend.emails.send({
        from: 'MikiConnect <onboarding@resend.dev>',
        to: user.email,
        subject: 'MikiConnect Password Reset Code',
        html: `<p>Your MikiConnect password reset code is: <strong>${resetCode}</strong></p>`
      });

      if (emailResult.error) {
        return res.status(400).json({ error: `Resend Error: ${emailResult.error.message}` });
      }

      return res.json({ message: `Password reset code sent to ${user.email}!` });
    } catch (sdkErr) {
      return res.status(500).json({ error: `SDK Error: ${sdkErr.message}` });
    }

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// RESEND VERIFICATION
app.post('/api/auth/resend-verification', async (req, res) => {
  let { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Please enter a valid email address or username.' });

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') }
      ]
    });

    if (!user) return res.status(404).json({ error: `No account found for "${identifier}".` });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.json({ message: `RESEND_API_KEY not found on Render.` });
    }

    try {
      const { Resend } = require('resend');
      const resend = new Resend(apiKey);
      const emailResult = await resend.emails.send({
        from: 'MikiConnect <onboarding@resend.dev>',
        to: user.email,
        subject: 'MikiConnect Email Verification',
        html: `<p>Hello ${user.username}, your account is active and verified!</p>`
      });

      if (emailResult.error) {
        return res.status(400).json({ error: `Resend Error: ${emailResult.error.message}` });
      }

      return res.json({ message: `Verification email sent to ${user.email}!` });
    } catch (sdkErr) {
      return res.status(500).json({ error: `SDK Error: ${sdkErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

, 'i') },
        { email: new RegExp(`^${identifier}const express = require('express');
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
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ADMIN_EMAILS = ['danmike849@gmail.com', 'danmike849'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SCHEMAS
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  isBanned: { type: Boolean, default: false },
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
  if (!ADMIN_EMAILS.includes(req.user.username.toLowerCase())) {
    return res.status(403).json({ error: 'Access Denied: Admin privileges required.' });
  }
  next();
};

// REGISTER OR LOGIN
app.post('/api/auth/register-or-login', async (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username/Email and password are required' });

  username = username.toLowerCase().trim();

  try {
    let user = await User.findOne({
      $or: [
        { username: new RegExp(`^${username}$`, 'i') },
        { email: new RegExp(`^${username}$`, 'i') }
      ]
    });

    if (user && user.isBanned) {
      return res.status(403).json({ error: 'This account has been banned by Admin.' });
    }

    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const isOwner = ADMIN_EMAILS.includes(username);
      user = new User({ 
        username: username, 
        email: username.includes('@') ? username : `${username}@mikiconnect.app`, 
        password: hashedPassword,
        role: isOwner ? 'admin' : 'user'
      });
      await user.save();
    } else {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ error: 'Incorrect password entered.' });
    }

    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Authentication error: ' + err.message });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  let { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Please enter a valid email address or username.' });

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') }
      ]
    });

    if (!user) return res.status(404).json({ error: `No account exists for "${identifier}".` });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = Date.now() + 3600000;
    await user.save();

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.json({ 
        message: `RESEND_API_KEY missing on Render! Fallback code: ${resetCode}` 
      });
    }

    try {
      const { Resend } = require('resend');
      const resend = new Resend(apiKey);
      const emailResult = await resend.emails.send({
        from: 'MikiConnect <onboarding@resend.dev>',
        to: user.email,
        subject: 'MikiConnect Password Reset Code',
        html: `<p>Your MikiConnect password reset code is: <strong>${resetCode}</strong></p>`
      });

      if (emailResult.error) {
        return res.status(400).json({ error: `Resend Error: ${emailResult.error.message}` });
      }

      return res.json({ message: `Password reset code sent to ${user.email}!` });
    } catch (sdkErr) {
      return res.status(500).json({ error: `SDK Error: ${sdkErr.message}` });
    }

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// RESEND VERIFICATION
app.post('/api/auth/resend-verification', async (req, res) => {
  let { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Please enter a valid email address or username.' });

  identifier = identifier.toLowerCase().trim();

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') }
      ]
    });

    if (!user) return res.status(404).json({ error: `No account found for "${identifier}".` });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.json({ message: `RESEND_API_KEY not found on Render.` });
    }

    try {
      const { Resend } = require('resend');
      const resend = new Resend(apiKey);
      const emailResult = await resend.emails.send({
        from: 'MikiConnect <onboarding@resend.dev>',
        to: user.email,
        subject: 'MikiConnect Email Verification',
        html: `<p>Hello ${user.username}, your account is active and verified!</p>`
      });

      if (emailResult.error) {
        return res.status(400).json({ error: `Resend Error: ${emailResult.error.message}` });
      }

      return res.json({ message: `Verification email sent to ${user.email}!` });
    } catch (sdkErr) {
      return res.status(500).json({ error: `SDK Error: ${sdkErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

, 'i') }
      ]
    });

    if (!user) return res.status(404).json({ error: 'Account not found.' });

    if (!user.resetToken || user.resetToken !== resetCode.trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit reset code.' });
    }

    if (user.resetTokenExpiry && Date.now() > user.resetTokenExpiry) {
      return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
    }

    // Hash and update to new password
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: 'Password updated successfully! You can now log in with your new password.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ADMIN CONTROLS
app.delete('/api/admin/delete-user/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User permanently deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user: ' + err.message });
  }
});

app.post('/api/admin/ban-user/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBanned: true });
    res.json({ message: 'User has been banned.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to ban user: ' + err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username createdAt role isBanned').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

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
  console.log(`RESEND_API_KEY Status: ${process.env.RESEND_API_KEY ? 'CONFIGURED' : 'MISSING'}`);
  if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('Connected to MongoDB Atlas'))
      .catch(err => console.error('MongoDB error:', err.message));
  }
});
