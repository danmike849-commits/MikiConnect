const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 5000;

// Configure Multer Storage for Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static('.'));
// Serve uploaded files publicly
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Initialize Database
const db = new sqlite3.Database('mikiconnect.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, content TEXT, image_url TEXT, likes INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, username TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS direct_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, receiver TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

// --- REST API ---

// Upload Image Endpoint
app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

// User Register
app.post('/api/users', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  db.run('INSERT OR IGNORE INTO users (username) VALUES (?)', [username], () => res.json({ success: true, username }));
});

// Fetch Posts (Includes Image URL)
app.get('/api/posts', (req, res) => {
  db.all('SELECT * FROM posts ORDER BY created_at DESC', [], (err, rows) => res.json(rows || []));
});

// Create Post with optional Image
app.post('/api/posts', (req, res) => {
  const { username, content, imageUrl } = req.body;
  db.run('INSERT INTO posts (username, content, image_url) VALUES (?, ?, ?)', [username, content, imageUrl || null], () => {
    res.json({ success: true });
  });
});

// Like Post
app.post('/api/posts/:id/like', (req, res) => {
  db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [req.params.id], () => res.json({ success: true }));
});

// Groups API
app.get('/api/groups', (req, res) => {
  db.all('SELECT * FROM groups', [], (err, rows) => res.json(rows || []));
});

app.post('/api/groups', (req, res) => {
  db.run('INSERT INTO groups (name) VALUES (?)', [req.body.name], function(err) {
    if (err) return res.status(400).json({ error: 'Group already exists' });
    res.json({ success: true });
  });
});

// Bug Reporting
app.post('/api/report-bug', (req, res) => {
  const report = { ...req.body, timestamp: new Date().toISOString() };
  fs.appendFileSync('mikiconnect_bugs.json', JSON.stringify(report) + '\n');
  res.json({ status: 'received', message: 'Bug logged successfully!' });
});

app.get('/api/bugs', (req, res) => {
  if (!fs.existsSync('mikiconnect_bugs.json')) return res.json([]);
  const lines = fs.readFileSync('mikiconnect_bugs.json', 'utf-8').trim().split('\n');
  res.json(lines.filter(Boolean).map(line => JSON.parse(line)));
});

// Socket.io Setup
io.on('connection', (socket) => {
  socket.on('join_group', (groupId) => socket.join(`group_${groupId}`));
  socket.on('send_group_msg', ({ groupId, username, message }) => {
    db.run('INSERT INTO group_messages (group_id, username, message) VALUES (?, ?, ?)', [groupId, username, message]);
    io.to(`group_${groupId}`).emit('receive_group_msg', { username, message });
  });

  socket.on('join_dm', ({ sender, receiver }) => {
    const roomId = [sender, receiver].sort().join('_');
    socket.join(`dm_${roomId}`);
  });

  socket.on('send_dm', ({ sender, receiver, message }) => {
    const roomId = [sender, receiver].sort().join('_');
    db.run('INSERT INTO direct_messages (sender, receiver, message) VALUES (?, ?, ?)', [sender, receiver, message]);
    io.to(`dm_${roomId}`).emit('receive_dm', { sender, message });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`MikiConnect Media Engine Active!`);
  console.log(`Access Link: http://127.0.0.1:${PORT}`);
  console.log(`=================================`);
});
