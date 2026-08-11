const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global Data Stores
global.inMemoryUsers = global.inMemoryUsers || [];
global.inMemoryPosts = global.inMemoryPosts || [];
global.inMemoryChat = global.inMemoryChat || [];

// ==================== AUTH ENDPOINTS ====================
app.post('/api/register', (req, res) => {
    try {
        const { username, email, password } = req.body || {};
        if (!username || !email || !password) {
            return res.status(400).json({ error: "All fields are required." });
        }

        const existing = global.inMemoryUsers.find(u => u.username === username || u.email === email);
        if (existing) {
            return res.status(400).json({ error: "User already exists." });
        }

        const newUser = { id: Date.now().toString(), username, email, password, createdAt: new Date() };
        global.inMemoryUsers.push(newUser);

        res.json({ success: true, message: "User registered successfully!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', (req, res) => {
    try {
        const { username, email, password } = req.body || {};
        const loginId = username || email;

        const user = global.inMemoryUsers.find(u => (u.username === loginId || u.email === loginId) && u.password === password);
        if (!user && global.inMemoryUsers.length > 0) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        res.json({ success: true, user: { username: loginId || "User", email: loginId } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ADMIN ENDPOINT ====================
app.get('/api/admin/users', (req, res) => {
    try {
        const safeUsers = global.inMemoryUsers.map(u => ({
            _id: u.id,
            username: u.username,
            email: u.email,
            createdAt: u.createdAt
        }));

        if (safeUsers.length === 0) {
            return res.json([
                { _id: "1", username: "Admin", email: "admin@mikiconnect.com", createdAt: new Date() }
            ]);
        }

        res.json(safeUsers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== FEED, LIKES & COMMENTS ENDPOINTS ====================
app.get('/api/posts', (req, res) => {
    res.json(global.inMemoryPosts);
});

app.post('/api/posts', (req, res) => {
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

        global.inMemoryPosts.unshift(newPost);
        res.json({ success: true, post: newPost });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/posts/:id/like', (req, res) => {
    try {
        const postId = req.params.id;
        const { username } = req.body || {};
        const user = username || "Anonymous";

        let post = global.inMemoryPosts.find(p => p.id == postId);
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

app.post('/api/posts/:id/comment', (req, res) => {
    try {
        const postId = req.params.id;
        const { username, text } = req.body || {};

        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Comment text cannot be empty." });
        }

        let post = global.inMemoryPosts.find(p => p.id == postId);
        if (!post) return res.status(404).json({ error: "Post not found" });

        const newComment = {
            id: Date.now().toString(),
            username: username || "Anonymous",
            text: text.trim(),
            createdAt: new Date().toISOString()
        };

        post.comments = post.comments || [];
        post.comments.push(newComment);

        res.json({ success: true, comments: post.comments });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== CHAT ENDPOINTS ====================
app.get('/api/chat', (req, res) => {
    res.json({ success: true, messages: global.inMemoryChat });
});

app.post('/api/chat', (req, res) => {
    try {
        const { username, message } = req.body || {};
        if (!message) return res.status(400).json({ error: "Message is required." });

        const msgObj = {
            username: username || "Anonymous",
            content: message,
            createdAt: new Date()
        };
        global.inMemoryChat.push(msgObj);
        res.json({ success: true, message: msgObj });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve Static Frontend
app.use(express.static(path.join(__dirname, "public")));

// SPA Catch-All
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
