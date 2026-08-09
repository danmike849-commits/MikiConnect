const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const db = new sqlite3.Database('./mikiconnect.db', (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to SQLite database.');
});

// Create Tables
db.serialize(() => {
  // Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT 'https://via.placeholder.com/150',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Messages Table
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// --- REST API ENDPOINTS FOR AUTH ---

// Register API
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`);

    stmt.run(username, email, hashedPassword, function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Username or Email already exists' });
        }
        return res.status(500).json({ error: 'Registration failed' });
      }
      res.json({ success: true, message: 'Account created successfully!' });
    });
    stmt.finalize();
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login API
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });
  });
});

// --- SOCKET.IO REAL-TIME CHAT ---
const onlineUsers = new Map();

io.on('connection', (socket) => {
  // Fetch chat history
  db.all(`SELECT user, text, timestamp FROM messages ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
    if (!err && rows) {
      socket.emit('chat_history', rows.reverse());
    }
  });

  // User Joined
  socket.on('user_joined', (userData) => {
    onlineUsers.set(socket.id, userData.username);
    io.emit('online_count', onlineUsers.size);
    socket.broadcast.emit('system_message', `${userData.username} joined MikiConnect`);
  });

  // New Message
  socket.on('chat_message', (data) => {
    const { user, text } = data;
    const stmt = db.prepare(`INSERT INTO messages (user, text) VALUES (?, ?)`);
    stmt.run(user, text, function (err) {
      if (!err) {
        io.emit('chat_message', { id: this.lastID, user, text });
      }
    });
    stmt.finalize();
  });

  // Disconnect
  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    if (username) {
      onlineUsers.delete(socket.id);
      io.emit('online_count', onlineUsers.size);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
