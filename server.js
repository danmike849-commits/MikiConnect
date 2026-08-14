cat << 'EOF' > server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB Atlas Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));
} else {
  console.warn('MONGODB_URI is not defined in Environment Variables.');
}

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

// Real Authentication Endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required.' });
  }

  try {
    let user = await User.findOne({ username });
    if (!user) {
      user = await User.create({ username, password });
    } else if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    res.json({ success: true, message: 'Login successful', username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// Socket.io Real-Time Engine
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('send_message', (data) => {
    io.emit('new_message', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`MikiConnect Server running on port ${PORT}`);
});
EOF
