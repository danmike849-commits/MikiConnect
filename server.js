const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// Create uploads directory if not exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

let activeUsers = {};
let messages = [];

// Media Upload Endpoint
app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// Auth route placeholder
app.post('/api/auth/register-or-login', (req, res) => {
  const { username } = req.body;
  res.json({ token: 'demo-token', username });
});

// Messages routes
app.get('/api/messages', (req, res) => res.json(messages));

app.put('/api/messages/:id', (req, res) => {
  const msg = messages.find(m => m._id === req.params.id);
  if (msg) {
    msg.text = req.body.text;
    msg.isEdited = true;
    io.emit('message_edited', msg);
    return res.json(msg);
  }
  res.status(404).json({ error: 'Message not found' });
});

app.delete('/api/messages/:id', (req, res) => {
  messages = messages.filter(m => m._id !== req.params.id);
  io.emit('message_deleted', req.params.id);
  res.json({ success: true });
});

// Socket.io Handlers
io.on('connection', (socket) => {
  socket.on('user_connected', (username) => {
    activeUsers[socket.id] = username;
    io.emit('active_users', Object.values(activeUsers));
  });

  socket.on('chat message', (data) => {
    const msg = {
      _id: Date.now().toString(),
      sender: data.sender,
      text: data.text || '',
      mediaUrl: data.mediaUrl || null,
      mediaType: data.mediaType || null,
      timestamp: new Date()
    };
    messages.push(msg);
    io.emit('chat message', msg);
  });

  socket.on('typing', (data) => socket.broadcast.emit('user_typing', data));

  // WebRTC Signaling
  socket.on('call_user', (data) => {
    const targetSocket = Object.keys(activeUsers).find(key => activeUsers[key] === data.userToCall);
    if (targetSocket) {
      io.to(targetSocket).emit('incoming_call', { signal: data.signalData, from: data.from, isVideo: data.isVideo });
    }
  });

  socket.on('answer_call', (data) => {
    const targetSocket = Object.keys(activeUsers).find(key => activeUsers[key] === data.to);
    if (targetSocket) {
      io.to(targetSocket).emit('call_accepted', data.signal);
    }
  });

  socket.on('end_call', (data) => {
    const targetSocket = Object.keys(activeUsers).find(key => activeUsers[key] === data.to);
    if (targetSocket) {
      io.to(targetSocket).emit('call_ended');
    }
  });

  socket.on('disconnect', () => {
    delete activeUsers[socket.id];
    io.emit('active_users', Object.values(activeUsers));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
