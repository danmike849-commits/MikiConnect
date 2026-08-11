const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());




// ==================== FEED, LIKES & COMMENTS ENDPOINTS ====================
global.inMemoryPosts = global.inMemoryPosts || [];

app.post('/api/posts', async (req, res) => {
    try {
        const { username, content, text } = req.body || {};
        const postContent = content || text;

        if (!postContent || !postContent.trim()) {
            return res.status(400).json({ error: "Post content cannot be empty." });
        }

        const newPost = {
            id: Date.now().toString(),
            username: username || "Anonymous",
            content: postContent.trim(),
            likes: [],
            comments: [],
            createdAt: new Date().toISOString()
        };

        if (typeof Post !== 'undefined') {
            try {
                const dbPost = await Post.create({ 
                    username: newPost.username, 
                    content: newPost.content,
                    likes: [],
                    comments: []
                });
                return res.json({ success: true, post: dbPost });
            } catch (dbErr) {}
        }

        global.inMemoryPosts.unshift(newPost);
        res.json({ success: true, post: newPost });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/posts', async (req, res) => {
    try {
        if (typeof Post !== 'undefined') {
            try {
                const dbPosts = await Post.find().sort({ createdAt: -1 });
                return res.json(dbPosts);
            } catch (dbErr) {}
        }
        res.json(global.inMemoryPosts || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Like Endpoint
app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const postId = req.params.id;
        const { username } = req.body || {};
        const user = username || "Anonymous";

        if (typeof Post !== 'undefined') {
            try {
                let p = await Post.findById(postId);
                if (p) {
                    p.likes = p.likes || [];
                    const idx = p.likes.indexOf(user);
                    if (idx === -1) p.likes.push(user);
                    else p.likes.splice(idx, 1);
                    await p.save();
                    return res.json({ success: true, likes: p.likes });
                }
            } catch (dbErr) {}
        }

        let post = global.inMemoryPosts.find(p => (p.id == postId || p._id == postId));
        if (!post) return res.status(404).json({ error: "Post not found" });

        post.likes = post.likes || [];
        const index = post.likes.indexOf(user);
        if (index === -1) {
            post.likes.push(user);
        } else {
            post.likes.splice(index, 1);
        }

        res.json({ success: true, likes: post.likes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add Comment Endpoint
app.post('/api/posts/:id/comment', async (req, res) => {
    try {
        const postId = req.params.id;
        const { username, text } = req.body || {};

        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Comment text cannot be empty." });
        }

        const newComment = {
            id: Date.now().toString(),
            username: username || "Anonymous",
            text: text.trim(),
            createdAt: new Date().toISOString()
        };

        if (typeof Post !== 'undefined') {
            try {
                let p = await Post.findById(postId);
                if (p) {
                    p.comments = p.comments || [];
                    p.comments.push(newComment);
                    await p.save();
                    return res.json({ success: true, comments: p.comments });
                }
            } catch (dbErr) {}
        }

        let post = global.inMemoryPosts.find(p => (p.id == postId || p._id == postId));
        if (!post) return res.status(404).json({ error: "Post not found" });

        post.comments = post.comments || [];
        post.comments.push(newComment);

        res.json({ success: true, comments: post.comments });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// =========================================================================

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

        // Returns both nested and flat responses so all HTML formats work seamlessly
        res.json({
            message: 'Login successful',
            username: user.username,
            email: user.email,
            isAdmin: user.isAdmin,
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
            { $or: [{ username: cleanUsername }, { email: cleanUsername }] },
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

app.get(/.*/, function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.post('/api/chat', (req, res) => {
    const { username, message } = req.body || {};
    if (!message) return res.status(400).json({ error: "Message content is required" });
    // Echo or store message logic
    res.json({ success: true, message: { username: username || "Anonymous", content: message, createdAt: new Date() } });
});

app.get('/api/chat', (req, res) => {
    res.json({ success: true, messages: [] });
});


app.get('/api/admin/users', async (req, res) => {
    try {
        // Return dummy/db users
        if (typeof User !== 'undefined') {
            const users = await User.find({}, '-password');
            return res.json(users);
        }
        res.json([]);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, function() {
    console.log("Server running on port " + PORT);
});
