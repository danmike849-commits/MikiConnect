const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 25e6 // 25MB limit for images, audio, and file uploads
});

// Middleware
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const db = new sqlite3.Database('./mikiconnect.db', (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to SQLite database.');
});

// Create Tables & Run Schema Migrations
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      avatar TEXT DEFAULT 'https://via.placeholder.com/150',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT,
      file_data TEXT,
      file_name TEXT,
      file_type TEXT,
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      text TEXT,
      audio_data TEXT,
      file_data TEXT,
      file_name TEXT,
      file_type TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Safely attempt adding new columns if upgrading existing database
  db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`, () => {});
  db.run(`ALTER TABLE posts ADD COLUMN file_data TEXT`, () => {});
  db.run(`ALTER TABLE posts ADD COLUMN file_name TEXT`, () => {});
  db.run(`ALTER TABLE posts ADD COLUMN file_type TEXT`, () => {});
  db.run(`ALTER TABLE private_messages ADD COLUMN file_data TEXT`, () => {});
  db.run(`ALTER TABLE private_messages ADD COLUMN file_name TEXT`, () => {});
  db.run(`ALTER TABLE private_messages ADD COLUMN file_type TEXT`, () => {});
});

// Helper middleware check for admin rights
function verifyAdmin(req, res, next) {
  const adminUsername = req.query.admin_username || req.body.admin_username;
  if (!adminUsername) return res.status(401).json({ error: 'Unauthorized admin request' });

  db.get(`SELECT role FROM users WHERE username = ?`, [adminUsername], (err, user) => {
    if (err || !user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// --- REST API ENDPOINTS FOR AUTH ---

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    // Automatically set the user as 'admin' if username is 'admin' or first account
    db.get(`SELECT COUNT(*) as count FROM users`, async (err, row) => {
      const isFirstUser = row && row.count === 0;
      const userRole = (isFirstUser || username.toLowerCase() === 'admin') ? 'admin' : 'user';

      const stmt = db.prepare(`INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`);
      stmt.run(username, email, hashedPassword, userRole, function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username or Email already exists' });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }
        res.json({ success: true, message: 'Account created successfully!' });
      });
      stmt.finalize();
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
      user: { id: user.id, username: user.username, email: user.email, role: user.role || 'user', avatar: user.avatar }
    });
  });
});

app.get('/api/users', (req, res) => {
  db.all(`SELECT id, username, role, avatar FROM users ORDER BY username ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch users' });
    res.json(rows);
  });
});

app.get('/api/dm/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const sql = `
    SELECT * FROM private_messages 
    WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
    ORDER BY id ASC
  `;
  db.all(sql, [user1, user2, user2, user1], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to load messages' });
    res.json(rows);
  });
});

// --- REST API ENDPOINTS FOR SOCIAL FEED ---

app.get('/api/posts', (req, res) => {
  const sql = `
    SELECT p.*, COUNT(c.id) AS comment_count 
    FROM posts p 
    LEFT JOIN comments c ON p.id = c.post_id 
    GROUP BY p.id 
    ORDER BY p.id DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch posts' });
    res.json(rows);
  });
});

app.post('/api/posts', (req, res) => {
  const { username, content, file_data, file_name, file_type } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const stmt = db.prepare(`INSERT INTO posts (username, content, file_data, file_name, file_type) VALUES (?, ?, ?, ?, ?)`);
  stmt.run(username, content || '', file_data || null, file_name || null, file_type || null, function (err) {
    if (err) return res.status(500).json({ error: 'Failed to create post' });
    res.json({ success: true, post: { id: this.lastID, username, content, file_data, file_name, file_type, likes: 0, comment_count: 0 } });
  });
  stmt.finalize();
});

app.post('/api/posts/:id/like', (req, res) => {
  const postId = req.params.id;
  db.run(`UPDATE posts SET likes = likes + 1 WHERE id = ?`, [postId], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to like post' });
    db.get(`SELECT likes FROM posts WHERE id = ?`, [postId], (err, row) => {
      res.json({ success: true, likes: row ? row.likes : 0 });
    });
  });
});

app.post('/api/posts/:id/comments', (req, res) => {
  const postId = req.params.id;
  const { username, comment, postAuthor } = req.body;
  if (!username || !comment) return res.status(400).json({ error: 'Comment text required' });

  const stmt = db.prepare(`INSERT INTO comments (post_id, username, comment) VALUES (?, ?, ?)`);
  stmt.run(postId, username, comment, function (err) {
    if (err) return res.status(500).json({ error: 'Failed to add comment' });

    if (postAuthor) {
      io.emit('new_comment_notification', {
        postAuthor: postAuthor,
        commenter: username,
        comment: comment
      });
    }

    res.json({ success: true, comment: { id: this.lastID, post_id: postId, username, comment } });
  });
  stmt.finalize();
});

app.get('/api/posts/:id/comments', (req, res) => {
  const postId = req.params.id;
  db.all(`SELECT * FROM comments WHERE post_id = ? ORDER BY id ASC`, [postId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch comments' });
    res.json(rows);
  });
});

// --- ADMIN MODERATION API ENDPOINTS ---

app.get('/api/admin/stats', (req, res) => {
  db.get(`SELECT (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM posts) as posts, (SELECT COUNT(*) FROM private_messages) as dms`, [], (err, row) => {
    if (err) return res.status(500).json({ error: 'Failed to load stats' });
    res.json(row);
  });
});

app.get('/api/admin/users', (req, res) => {
  db.all(`SELECT id, username, email, role, created_at FROM users ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to load admin users' });
    res.json(rows);
  });
});

app.delete('/api/admin/users/:id', verifyAdmin, (req, res) => {
  const userId = req.params.id;
  db.run(`DELETE FROM users WHERE id = ?`, [userId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete user' });
    res.json({ success: true });
  });
});

app.post('/api/admin/users/:id/make-admin', verifyAdmin, (req, res) => {
  const userId = req.params.id;
  db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [userId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to promote user' });
    res.json({ success: true });
  });
});

app.delete('/api/admin/posts/:id', verifyAdmin, (req, res) => {
  const postId = req.params.id;
  db.run(`DELETE FROM posts WHERE id = ?`, [postId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete post' });
    db.run(`DELETE FROM comments WHERE post_id = ?`, [postId], () => {});
    res.json({ success: true });
  });
});

app.delete('/api/admin/comments/:id', verifyAdmin, (req, res) => {
  const commentId = req.params.id;
  db.run(`DELETE FROM comments WHERE id = ?`, [commentId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete comment' });
    res.json({ success: true });
  });
});

// --- SOCKET.IO CHAT & DIRECT MESSAGES ---
const onlineUsers = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  db.all(`SELECT user, text, timestamp FROM messages ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
    if (!err && rows) {
      socket.emit('chat_history', rows.reverse());
    }
  });

  socket.on('user_joined', (userData) => {
    onlineUsers.set(socket.id, userData.username);
    userSockets.set(userData.username, socket.id);
    io.emit('online_count', onlineUsers.size);
  });

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

  socket.on('private_message', (data) => {
    const { sender, recipient, text, audio_data, file_data, file_name, file_type } = data;
    const stmt = db.prepare(`INSERT INTO private_messages (sender, recipient, text, audio_data, file_data, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    
    stmt.run(sender, recipient, text || null, audio_data || null, file_data || null, file_name || null, file_type || null, function (err) {
      if (!err) {
        const msgObj = { id: this.lastID, sender, recipient, text, audio_data, file_data, file_name, file_type, timestamp: new Date() };
        const recipientSocketId = userSockets.get(recipient);
        if (recipientSocketId) {
          io.to(recipientSocketId).emit('private_message', msgObj);
        }
        socket.emit('private_message', msgObj);
      }
    });
    stmt.finalize();
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    if (username) {
      onlineUsers.delete(socket.id);
      userSockets.delete(username);
      io.emit('online_count', onlineUsers.size);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
