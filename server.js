const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global Memory Stores
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

// ==================== ADMIN ENDPOINTS ====================

app.get('/api/admin/stats', (req, res) => {
    const requester = req.headers['x-admin-user'];
    if (!requester || (requester.toLowerCase() !== 'admin' && requester.toLowerCase() !== 'mikedan849@gmail.com')) {
        return res.status(403).json({ error: "Access denied. Creator only." });
    }
    res.json({
        users: global.inMemoryUsers ? global.inMemoryUsers.length : 1,
        posts: global.inMemoryPosts ? global.inMemoryPosts.length : 0,
        chats: global.inMemoryChat ? global.inMemoryChat.length : 0
    });
});


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

app.delete('/api/admin/users/:id', (req, res) => {
    try {
        const userId = req.params.id;
        global.inMemoryUsers = global.inMemoryUsers.filter(u => u.id !== userId && u._id !== userId);
        res.json({ success: true, message: "User deleted successfully." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== FEED ENDPOINTS ====================
app.get('/api/posts', (req, res) => {
    res.json(global.inMemoryPosts);
});

app.post('/api/posts', (req, res) => {
    try {
        const { username, content } = req.body || {};
        if (!content || !content.trim()) return res.status(400).json({ error: "Post content required." });

        const newPost = {
            id: Date.now().toString(),
            username: username || "Anonymous",
            content: content.trim(),
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

// ==================== CHAT ENDPOINTS ====================
app.get('/api/chat', (req, res) => {
    res.json({ success: true, messages: global.inMemoryChat });
});

app.post('/api/chat', (req, res) => {
    try {
        const { username, message, imageUrl } = req.body || {};
        if (!message && !imageUrl) return res.status(400).json({ error: "Message required." });

        const msgObj = {
            id: Date.now().toString(),
            username: username || "Anonymous",
            content: message || "",
            imageUrl: imageUrl || "",
            createdAt: new Date().toISOString()
        };
        global.inMemoryChat.push(msgObj);
        res.json({ success: true, message: msgObj });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/chat/:id', (req, res) => {
    try {
        const msgId = req.params.id;
        global.inMemoryChat = global.inMemoryChat.filter(m => m.id !== msgId);
        res.json({ success: true, message: "Message deleted." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve Static Frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
