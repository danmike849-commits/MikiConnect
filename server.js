const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();

// Parse both JSON and standard HTML form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("CRITICAL: MONGO_URI is missing in Environment settings!");
} else {
    mongoose.connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    }).then(function() {
        console.log("MongoDB Connected Successfully");
    }).catch(function(err) {
        console.error("MongoDB Connection Error:", err);
    });
}

// User Schema
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
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

app.post('/api/register', async function(req, res) {
    try {
        const username = req.body.username || req.body.regUsername || req.body.user;
        const email = req.body.email || req.body.regEmail;
        const password = req.body.password || req.body.regPassword || req.body.pass;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const cleanUsername = username.trim().toLowerCase();
        const cleanEmail = email.trim().toLowerCase();

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = new User({
            username: cleanUsername,
            email: cleanEmail,
            password: hashedPassword
        });

        await newUser.save();
        res.json({ message: 'Registration successful! You can now log in.' });
    } catch (err) {
        console.error("Register Error:", err);
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Username or Email is already registered.' });
        }
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

app.post('/api/login', async function(req, res) {
    try {
        // Accepts any field name sent by the frontend HTML
        const usernameInput = req.body.username || req.body.email || req.body.loginUsername || req.body.loginEmail || req.body.identifier || req.body.user;
        const passwordInput = req.body.password || req.body.pass || req.body.loginPassword;

        if (!usernameInput || !passwordInput) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const cleanUsername = usernameInput.trim().toLowerCase();
        const user = await User.findOne({ 
            $or: [{ username: cleanUsername }, { email: cleanUsername }] 
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid username/email or password' });
        }

        const isMatch = await bcrypt.compare(passwordInput, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid username/email or password' });
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

// --- UTILITY ROUTES ---

app.get('/api/reset-password/:identifier/:newpassword', async function(req, res) {
    try {
        const cleanIdentifier = req.params.identifier.trim().toLowerCase();
        const newPassword = req.params.newpassword;
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const user = await User.findOneAndUpdate(
            { $or: [{ username: cleanIdentifier }, { email: cleanIdentifier }] },
            { password: hashedPassword },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("User or Email '" + cleanIdentifier + "' not found in database.");
        }

        res.send("SUCCESS: Password updated to '" + newPassword + "' for user '" + user.username + "'!");
    } catch (err) {
        res.status(500).send("Error resetting password: " + err.message);
    }
});

app.get('/api/make-me-admin/:username', async function(req, res) {
    try {
        const cleanUsername = req.params.username.trim().toLowerCase();
        const user = await User.findOneAndUpdate(
            { username: cleanUsername },
            { isAdmin: true },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("User not found in database.");
        }

        res.send("SUCCESS: Admin updated! Log out and log back in.");
    } catch (err) {
        res.status(500).send("Error updating admin status: " + err.message);
    }
});

app.get('/api/posts', async function(req, res) {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/posts', async function(req, res) {
    try {
        const username = req.body.username;
        const content = req.body.content;
        const newPost = new Post({ username: username, content: content });
        await newPost.save();
        res.json(newPost);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log("Server running on port " + PORT);
});
