const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Express v5 compatible fallback route
app.get('(.*)', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mikiconnect')
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Socket.io setup
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('send_message', (data) => {
    io.emit('receive_message', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
