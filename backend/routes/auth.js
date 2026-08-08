const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// SECRET KEY for signing JSON Web Tokens
const JWT_SECRET = 'your_super_secret_key_here';

// 1. REGISTER USER
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    // Hash the password for security
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Save new user
    user = new User({ username, email, password: hashedPassword });
    await user.save();

    res.status(201).json({ message: 'User registered successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. LOGIN USER
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid Credentials' });

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid Credentials' });

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
