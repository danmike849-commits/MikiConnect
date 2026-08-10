cat << 'EOF' > server.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin442:admin442@cluster0.mongodb.net/mikiconnect?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB Connected Successfully"))
  .catch(err => console.error("MongoDB Connection Error:", err));

// User Schema
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false }
});

const User = mongoose.model('User', UserSchema);

// Post Schema
const PostSchema = new mongoose.Schema({
    username: String,
    content: String,
    createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', PostSchema);

// --- AUTH ROUTES ---

// Registration Route
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const cleanUsername = username.trim().toLowerCase();
        const existingUser = await User.findOne({ username: cleanUsername });
        
        if (existingUser) {
            return res.status(400).json({ error: 'Username already registered' });
        }

        // Hash password ONCE
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = new User({
            username: cleanUsername,
            email: email.trim().toLowerCase(),
            password: hashedPassword
        });

        await newUser.save();
        res.json({ message: 'Registration successful! You can now log in.' });
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Login Route
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const cleanUsername = username.trim().toLowerCase();
        const user = await User.findOne({ username: cleanUsername });

        if (!user) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }

        // Compare plain password with stored hash
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }

        res.json({
            message: 'Login successful',
            user: {
                username: user.username,
                email: user.email,
                isAdmin: user.isAdmin
            }
        });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- ADMIN / UTILITY ROUTES ---

// Route to make any user an Admin directly
app.get('/api/make-me-admin/:username', async (req, res) => {
    try {
        const cleanUsername = req.params.username.trim().toLowerCase();
        const user = await User.findOneAndUpdate(
            { username: cleanUsername },
            { isAdmin: true },
            { new: true }
        );

        if (!user) {
            return res.status(404).send(`User ${cleanUsername} not found in database.`);
        }

        res.send(`SUCCESS: @${user.username} is now an ADMIN! Log out and log back in.`);
    } catch (err) {
        res.status(500).send("Error updating admin status: " + err.message);
    }
});

// Route to list users
app.get('/api/list-users', async (req, res) => {
    try {
        const users = await User.find({}, 'username email isAdmin');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- POSTS / FEED ROUTES ---

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { username, content } = req.body;
        const newPost = new Post({ username, content });
        await newPost.save();
        res.json(newPost);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve frontend SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
EOF
