const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const db = new sqlite3.Database('./mikiconnect.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create messages table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Socket.IO Handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Fetch and send last 50 messages when user connects
  db.all(`SELECT user, text, timestamp FROM messages ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching history:', err.message);
      return;
    }
    // Reverse array so oldest messages appear first
    socket.emit('chat_history', rows.reverse());
  });

  // Handle incoming new message
  socket.on('chat_message', (data) => {
    const { user, text } = data;

    // Save message to SQLite
    const stmt = db.prepare(`INSERT INTO messages (user, text) VALUES (?, ?)`);
    stmt.run(user, text, function (err) {
      if (err) {
        console.error('Failed to save message:', err.message);
        return;
      }
      // Broadcast to all connected clients
      io.emit('chat_message', { id: this.lastID, user, text });
    });
    stmt.finalize();
  });

  // Handle user joining event
  socket.on('user_joined', (username) => {
    socket.broadcast.emit('system_message', `${username} joined the chat`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`MikiConnect server running on port ${PORT}`);
});
