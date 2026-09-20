
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jwt-simple');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'miki_super_secret_key_123';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mikiconnect';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

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

const User = mongoose.model('User', UserSchema);

// AUTH MIDDLEWARE
const authenticate = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.decode(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// LOGIN CHECK
app.post('/api/auth/login-check', async (req, res) => {
  const { username, password } = req.body;
  try {
    const query = username.includes('+') || /^[0-9]+$/.test(username) 
      ? { phone: username } 
      : { username: username.toLowerCase() };

    const user = await User.findOne(query);
    if (!user) {
      return res.status(404).json({ accountExists: false, error: 'Account not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ accountExists: true, error: 'Invalid password.' });
    }

    const token = jwt.encode({ id: user._id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  const { identifier, username, password } = req.body;
  try {
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) return res.status(400).json({ error: 'Username already taken.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const isPhone = identifier.includes('+') || /^[0-9]+$/.test(identifier);

    const newUser = new User({
      username: username.toLowerCase(),
      phone: isPhone ? identifier : undefined,
      password: hashedPassword
    });

    await newUser.save();
    const token = jwt.encode({ id: newUser._id, username: newUser.username, role: newUser.role }, JWT_SECRET);
    res.status(201).json({ token, username: newUser.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  const { identifier } = req.body;
  try {
    const query = identifier.includes('+') || /^[0-9]+$/.test(identifier)
      ? { phone: identifier }
      : { username: identifier.toLowerCase() };

    const user = await User.findOne(query);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = Date.now() + 10 * 60 * 1000;
    await user.save();

    res.json({ message: 'Code generated', resetCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RESET PASSWORD
app.post('/api/auth/reset-password', async (req, res) => {
  const { identifier, resetCode, newPassword } = req.body;
  try {
    const query = identifier.includes('+') || /^[0-9]+$/.test(identifier)
      ? { phone: identifier }
      : { username: identifier.toLowerCase() };

    const user = await User.findOne(query);
    if (!user || user.resetToken !== resetCode || user.resetTokenExpiry < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: 'Password reset successful!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
