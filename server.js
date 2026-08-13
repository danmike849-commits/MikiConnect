
const mongoose = require('mongoose');

// Connect to MongoDB Atlas
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://danmike849:Urcnmx442@admin442.5kdrg1k.mongodb.net/mikiconnect?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected permanently to MongoDB Atlas!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const express = require("express");

// Health Check / Keep-Alive Endpoint

const path = require("path");
const cors = require("cors");

const app = express();

// Keep-Alive Endpoint
app.get('/ping', (req, res) => {
    res.status(200).send("PONG");
});

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


// Global Stores for DM System
global.inMemoryChatRequests = global.inMemoryChatRequests || [];
global.inMemoryPrivateConvs = global.inMemoryPrivateConvs || [];
global.inMemoryPrivateMsgs  = global.inMemoryPrivateMsgs || [];

// Send Chat Request
app.post('/api/private/request', (req, res) => {
    try {
        const { sender, recipient } = req.body || {};
        if (!sender || !recipient) return res.status(400).json({ error: "Sender and recipient required." });
        if (sender.toLowerCase() === recipient.toLowerCase()) return res.status(400).json({ error: "Cannot request yourself." });

        // Check if existing request or accepted conv
        const existingConv = global.inMemoryPrivateConvs.find(c => 
            (c.u1 === sender && c.u2 === recipient) || (c.u1 === recipient && c.u2 === sender)
        );
        if (existingConv) return res.json({ success: true, conversationId: existingConv.id, status: "accepted" });

        const existingReq = global.inMemoryChatRequests.find(r => 
            (r.sender === sender && r.recipient === recipient) && r.status === 'pending'
        );
        if (existingReq) return res.json({ success: true, message: "Request already pending." });

        const reqObj = { id: Date.now().toString(), sender, recipient, status: "pending", createdAt: new Date() };
        global.inMemoryChatRequests.push(reqObj);
        res.json({ success: true, message: "Chat request sent!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fetch pending requests for a user
app.get('/api/private/requests/:username', (req, res) => {
    const username = req.params.username;
    const reqs = global.inMemoryChatRequests.filter(r => r.recipient.toLowerCase() === username.toLowerCase() && r.status === 'pending');
    res.json(reqs);
});

// Accept or Reject Request
app.post('/api/private/request/:id/respond', (req, res) => {
    try {
        const reqId = req.params.id;
        const { action } = req.body || {}; // 'accept' or 'reject'
        const chatReq = global.inMemoryChatRequests.find(r => r.id === reqId);

        if (!chatReq) return res.status(404).json({ error: "Request not found." });

        chatReq.status = action === 'accept' ? 'accepted' : 'rejected';

        if (action === 'accept') {
            const convId = "conv_" + Date.now();
            const newConv = { id: convId, u1: chatReq.sender, u2: chatReq.recipient, createdAt: new Date() };
            global.inMemoryPrivateConvs.push(newConv);
            return res.json({ success: true, conversationId: convId });
        }

        res.json({ success: true, message: "Request rejected." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fetch active 1-on-1 conversations for user
app.get('/api/private/conversations/:username', (req, res) => {
    const user = req.params.username.toLowerCase();
    const convs = global.inMemoryPrivateConvs.filter(c => c.u1.toLowerCase() === user || c.u2.toLowerCase() === user);
    res.json(convs);
});

// Fetch 1-on-1 Messages
app.get('/api/private/messages/:convId', (req, res) => {
    const convId = req.params.convId;
    const msgs = global.inMemoryPrivateMsgs.filter(m => m.convId === convId);
    res.json(msgs);
});

// Send Private Message (Text, Voice, Image, Video)
app.post('/api/private/messages', (req, res) => {
    try {
        const { convId, sender, text, media, mediaType } = req.body || {};
        if (!convId || !sender) return res.status(400).json({ error: "Missing required fields." });

        const msgObj = {
            id: Date.now().toString(),
            convId,
            sender,
            text: text || "",
            media: media || "", // Base64 or URL
            mediaType: mediaType || "none", // 'image', 'video', 'audio'
            edited: false,
            createdAt: new Date().toISOString()
        };

        global.inMemoryPrivateMsgs.push(msgObj);
        res.json({ success: true, message: msgObj });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edit Private Message
app.put('/api/private/messages/:id', (req, res) => {
    try {
        const msgId = req.params.id;
        const { text } = req.body || {};
        const msg = global.inMemoryPrivateMsgs.find(m => m.id === msgId);
        if (!msg) return res.status(404).json({ error: "Message not found." });

        msg.text = text;
        msg.edited = true;
        res.json({ success: true, message: msg });
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
