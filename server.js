const http = require('http');
const express = require('express');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const jwt = require('jwt-simple');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  }
});

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav'
    ];

    if (!file.mimetype || !allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Unsupported audio format.'));
    }

    cb(null, true);
  }
});

const { sendVerificationEmail, sendPasswordResetEmail } = require('./mailer');

const app = express();
const httpServer = http.createServer(app);

app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

const { Server: SocketIOServer } = require('socket.io');
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true
  }
});

// Track active Socket.IO connections per user.
// A user stays active while at least one authenticated socket is connected.
const activeUserSockets = new Map();

function markUserActive(userId) {
  const key = String(userId);
  const count = Number(activeUserSockets.get(key) || 0) + 1;
  activeUserSockets.set(key, count);
  return count === 1;
}

function markUserInactive(userId) {
  const key = String(userId);
  const count = Number(activeUserSockets.get(key) || 0);

  if (count <= 1) {
    activeUserSockets.delete(key);
    return true;
  }

  activeUserSockets.set(key, count - 1);
  return false;
}

function isUserActive(userId) {
  return activeUserSockets.has(String(userId));
}

function parseCookieHeader(header = '') {
  const cookies = {};
  String(header)
    .split(';')
    .forEach(part => {
      const index = part.indexOf('=');
      if (index === -1) return;

      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();

      if (key) {
        cookies[key] = decodeURIComponent(value);
      }
    });

  return cookies;
}

io.use(async (socket, next) => {
  try {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie || '');
    const token = cookies[COOKIE_NAME];

    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.decode(token, JWT_SECRET);

    if (
      !decoded?.sub ||
      !decoded?.exp ||
      decoded.exp < Math.floor(Date.now() / 1000)
    ) {
      return next(new Error('Session expired'));
    }

    const user = await User.findById(decoded.sub)
      .select('_id username isBanned tokenVersion');

    if (!user || user.isBanned) {
      return next(new Error('Account unavailable'));
    }

    if (Number(user.tokenVersion || 0) !== Number(decoded.tv || 0)) {
      return next(new Error('Session invalidated'));
    }

    socket.user = user;
    next();
  } catch {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', socket => {
  socket.join(`user:${String(socket.user._id)}`);

  const becameActive = markUserActive(socket.user._id);

  // Send the newly connected user the current active-user snapshot.
  for (const activeUserId of activeUserSockets.keys()) {
    if (activeUserId === String(socket.user._id)) continue;

    socket.emit('presence', {
      userId: activeUserId,
      active: true
    });
  }

  if (becameActive) {
    io.emit('presence', {
      userId: String(socket.user._id),
      active: true
    });
  }

  socket.on('disconnect', () => {
    const becameInactive = markUserInactive(socket.user._id);

    if (becameInactive) {
      io.emit('presence', {
        userId: String(socket.user._id),
        active: false
      });
    }
  });

  socket.on('joinPrivateChat', async (conversationId, callback) => {
    try {
      const conversation = await getAuthorizedConversation(
        conversationId,
        socket.user._id
      );

      if (!conversation) {
        return callback?.({
          success: false,
          error: 'Conversation unavailable.'
        });
      }

      const room = `conversation:${String(conversation._id)}`;
      socket.join(room);

      const deliveredAt = new Date();

      const deliveryResult = await Message.updateMany(
        {
          conversationId: conversation._id,
          senderId: { $ne: socket.user._id },
          deliveredAt: null
        },
        {
          $set: { deliveredAt }
        }
      );

      if (deliveryResult.modifiedCount > 0) {
        const senderIds = await Message.distinct('senderId', {
          conversationId: conversation._id,
          senderId: { $ne: socket.user._id }
        });

        senderIds.forEach(senderId => {
          io.to(`user:${String(senderId)}`).emit('messagesDelivered', {
            conversationId: String(conversation._id),
            deliveredAt,
            updatedCount: Number(deliveryResult.modifiedCount || 0)
          });
        });
      }

      callback?.({
        success: true,
        conversationId: String(conversation._id)
      });
    } catch (err) {
      console.error('Socket chat join error:', err);
      callback?.({
        success: false,
        error: 'Unable to join conversation.'
      });
    }
  });

  socket.on('clearPrivateMessages', async (payload, callback) => {
    try {
      const conversationId = String(payload?.conversationId || '').trim();

      if (!conversationId) {
        return callback?.({
          success: false,
          error: 'Conversation is required.'
        });
      }

      const conversation = await getAuthorizedConversation(
        conversationId,
        socket.user._id
      );

      if (!conversation) {
        return callback?.({
          success: false,
          error: 'Conversation unavailable.'
        });
      }

      await Message.deleteMany({
        conversationId: conversation._id
      });

      const resetUnreadCounts = {};
      conversation.participants.forEach(participantId => {
        resetUnreadCounts[String(participantId)] = 0;
      });

      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessageAt: null,
            unreadCounts: resetUnreadCounts
          }
        }
      );

      io.to(`conversation:${String(conversation._id)}`).emit(
        'privateMessagesCleared',
        {
          conversationId: String(conversation._id)
        }
      );

      callback?.({
        success: true
      });
    } catch (err) {
      console.error('Socket clear private messages error:', err);
      callback?.({
        success: false,
        error: 'Unable to clear messages.'
      });
    }
  });

  socket.on('privateMessage', async (payload, callback) => {
    try {
      const conversationId = String(payload?.conversationId || '');
      const content = String(payload?.content || '').trim();

      if (!content) {
        return callback?.({
          success: false,
          error: 'Message cannot be empty.'
        });
      }

      if (content.length > 2000) {
        return callback?.({
          success: false,
          error: 'Message is too long.'
        });
      }

      const conversation = await getAuthorizedConversation(
        conversationId,
        socket.user._id
      );

      if (!conversation) {
        return callback?.({
          success: false,
          error: 'Conversation unavailable.'
        });
      }

      const message = await Message.create({
        conversationId: conversation._id,
        senderId: socket.user._id,
        content
      });

      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { lastMessageAt: message.createdAt } }
      );

      const recipientId = conversation.participants.find(
        participantId => String(participantId) !== String(socket.user._id)
      );

      let recipientUnreadCount = 0;
      if (recipientId) {
        const unreadKey = `unreadCounts.${String(recipientId)}`;
        const updatedConversation = await Conversation.findOneAndUpdate(
          { _id: conversation._id },
          { $inc: { [unreadKey]: 1 } },
          { new: true }
        ).lean();
        recipientUnreadCount = Number(updatedConversation?.unreadCounts?.[String(recipientId)] || 0);
      }

      const outgoingMessage = {
        id: String(message._id),
        senderId: String(message.senderId),
        senderUsername: socket.user.username || '',
        content: message.content,
        createdAt: message.createdAt,
        deliveredAt: message.deliveredAt || null,
        readAt: message.readAt || null
      };

      io.to(`conversation:${String(conversation._id)}`).emit(
        'privateMessage',
        outgoingMessage
      );

      if (recipientId) {
        io.to(`user:${String(recipientId)}`).emit('chatUnread', {
          conversationId: String(conversation._id),
          senderId: String(socket.user._id),
          senderUsername: socket.user.username || '',
          unreadCount: recipientUnreadCount
        });
      }

      callback?.({
        success: true,
        message: outgoingMessage
      });
    } catch (err) {
      console.error('Socket private message error:', err);
      callback?.({
        success: false,
        error: 'Unable to send message.'
      });
    }
  });
});

const PORT = Number(process.env.PORT || 5000);
const REQUIRE_EMAIL_VERIFICATION = String(process.env.REQUIRE_EMAIL_VERIFICATION || "false").toLowerCase() === "true";
const PASSWORD_RESET_MODE = String(process.env.PASSWORD_RESET_MODE || "email").toLowerCase();
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const APP_URL = (process.env.APP_URL || 'https://mikiconnect.onrender.com').replace(/\/+$/, '');

if (!MONGO_URI) throw new Error('MONGO_URI is required');
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured and at least 32 characters');
}

/* ---------------------------------------------------------
   Security helpers
--------------------------------------------------------- */

const COOKIE_NAME = 'mc_session';
const RESET_COOKIE_NAME = 'mc_reset';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const state = new Map();

function clientKey(req, suffix = '') {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? String(forwarded).split(',')[0].trim() : req.socket.remoteAddress;
  return `${ip || 'unknown'}:${suffix}`;
}

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const item = state.get(key);

  if (!item || item.expiresAt <= now) {
    state.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (item.count >= max) return false;
  item.count += 1;
  return true;
}

function randomCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function generateReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = crypto.randomBytes(4);
    let suffix = "";
    for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
    const code = `MIKI-${suffix}`;
    const existing = await User.findOne({ referralCode: code }).select("_id").lean();
    if (!existing) return code;
  }
  throw new Error("Unable to generate a unique referral code.");
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;

  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');

  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9_]{3,30}$/.test(value);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};

  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function setCookie(res, name, value, maxAgeSeconds, options = {}) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];

  if (secure) parts.push('Secure');
  if (options.clear) parts.push('Max-Age=0');

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  setCookie(res, name, '', 0, { clear: true });
}

function createSession(user) {
  const now = Math.floor(Date.now() / 1000);

  return jwt.encode({
    sub: String(user._id),
    tv: Number(user.tokenVersion || 0),
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  }, JWT_SECRET);
}

function createResetSession(token) {
  const now = Math.floor(Date.now() / 1000);

  return jwt.encode({
    purpose: 'password-reset',
    token,
    iat: now,
    exp: now + Math.ceil(RESET_TOKEN_TTL_MS / 1000)
  }, JWT_SECRET);
}

function decodeResetSession(value) {
  try {
    const decoded = jwt.decode(value, JWT_SECRET);

    if (
      decoded.purpose !== 'password-reset' ||
      !decoded.token ||
      !decoded.exp ||
      decoded.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------
   Same-origin protection for state-changing API requests
--------------------------------------------------------- */

app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;

    if (origin) {
      try {
        const requestOrigin = new URL(origin).origin;
        const allowedOrigin = new URL(APP_URL).origin;
        const requestHost = req.headers.host;
        const serverOrigin = requestHost
          ? `${req.protocol}://${requestHost}`
          : '';

        if (
          requestOrigin !== allowedOrigin &&
          requestOrigin !== serverOrigin
        ) {
          return res.status(403).json({ error: 'Forbidden origin' });
        }
      } catch {
        return res.status(403).json({ error: 'Forbidden origin' });
      }
    }
  }

  next();
});

/* ---------------------------------------------------------
   MongoDB
--------------------------------------------------------- */

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 15000
})
.then(() => console.log('MongoDB Connected'))
.catch(err => {
  console.error('MongoDB Connection Error:', err.message);
});

/* ---------------------------------------------------------
   User model
--------------------------------------------------------- */

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  phone: {
    type: String,
    trim: true
  },

  email: {
    type: String,
    lowercase: true,
    trim: true
  },

  password: {
    type: String,
    required: true
  },

  role: {
    type: String,
    default: 'user'
  },

  isBanned: {
    type: Boolean,
    default: false
  },

  tokenVersion: {
    type: Number,
    default: 0
  },

  emailVerified: {
    type: Boolean,
    default: false
  },

  emailVerificationTokenHash: {
    type: String,
    select: false
  },

  emailVerificationExpiresAt: {
    type: Date,
    select: false
  },

  emailVerificationCodeHash: {
    type: String,
    select: false
  },

  emailVerificationCodeExpiresAt: {
    type: Date,
    select: false
  },

  emailVerificationCodeAttempts: {
    type: Number,
    default: 0,
    select: false
  },

  passwordResetTokenHash: {
    type: String,
    select: false
  },

  passwordResetTokenExpiresAt: {
    type: Date,
    select: false
  },

  passwordResetCodeHash: {
    type: String,
    select: false
  },

  passwordResetCodeExpiresAt: {
    type: Date,
    select: false
  },

  passwordResetCodeAttempts: {
    type: Number,
    default: 0,
    select: false
  },

  /* Dating profile fields */
  photos: {
    type: [String],
    default: []
  },

  avatar: {
    type: String,
    default: ''
  },

  age: {
    type: Number,
    min: 18,
    max: 100
  },

  minAge: {
    type: Number,
    min: 18,
    max: 100,
    default: 18
  },

  maxAge: {
    type: Number,
    min: 18,
    max: 100,
    default: 100
  },

  gender: {
    type: String,
    enum: ['man', 'woman', 'nonbinary', 'other']
  },

  interestedIn: {
    type: String,
    enum: ['men', 'women', 'everyone']
  },

  showInDiscovery: {
    type: Boolean,
    default: true
  },

  showLocation: {
    type: Boolean,
    default: true
  },

  showPhotos: {
    type: Boolean,
    default: true
  },

  pulseAnswers: {
    type: Map,
    of: String,
    default: {}
  },

  notificationPreferences: {
    newSpark: {
      type: Boolean,
      default: true
    },
    mutualSpark: {
      type: Boolean,
      default: true
    },
    privateMessages: {
      type: Boolean,
      default: true
    },
    pulseActivity: {
      type: Boolean,
      default: true
    }
  },

  bio: {
    type: String,
    maxlength: 300,
    default: ''
  },

  location: {
    type: String,
    default: ''
  },

  sparkedUsers: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    default: []
  },

  passedUsers: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    default: []
  },

  blockedUsers: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    default: []
  },

  isPremium: {
    type: Boolean,
    default: false
  },

  referralCode: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    trim: true
  },

  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

UserSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('User', UserSchema);

/* ---------------------------------------------------------
   PRIVATE CHAT MODELS
--------------------------------------------------------- */

/* ---------------------------------------------------------
   BLOCK / REPORT MODELS
--------------------------------------------------------- */

const ReportSchema = new mongoose.Schema({
  reporterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  reportedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  reason: {
    type: String,
    required: true,
    enum: [
      'harassment',
      'spam',
      'fake_profile',
      'inappropriate_content',
      'scam',
      'safety_concern',
      'other'
    ]
  },

  details: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },

  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
    default: 'pending',
    index: true
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  editedAt: {
    type: Date,
    default: null
  },

  deliveredAt: {
    type: Date,
    default: null
  },

  readAt: {
    type: Date,
    default: null
  }
});

ReportSchema.index({ reporterId: 1, reportedUserId: 1, createdAt: -1 });

const Report = mongoose.model('Report', ReportSchema);


const AdminAuditSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },

  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  target: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ''
  },

  details: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

AdminAuditSchema.index({ createdAt: -1 });

const AdminAudit = mongoose.model('AdminAudit', AdminAuditSchema);


const ConversationSchema = new mongoose.Schema({
  participants: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    required: true,
    validate: {
      validator: value => Array.isArray(value) && value.length === 2,
      message: 'A conversation must have exactly two participants.'
    }
  },

  lastMessageAt: {
    type: Date,
    default: Date.now
  },

  unreadCounts: {
    type: Map,
    of: Number,
    default: {}
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ lastMessageAt: -1 });

const Conversation = mongoose.model('Conversation', ConversationSchema);

const MessageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },

  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  replyToMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null,
    index: true
  },

  type: {
    type: String,
    enum: ['text', 'voice'],
    default: 'text',
    required: true
  },

  content: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: ''
  },

  audioUrl: {
    type: String,
    trim: true,
    default: ''
  },

  audioDuration: {
    type: Number,
    min: 0,
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  editedAt: {
    type: Date,
    default: null
  }
});

const Message = mongoose.model('Message', MessageSchema);


const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  type: {
    type: String,
    required: true,
    enum: ['spark'],
    index: true
  },

  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  message: {
    type: String,
    required: true,
    maxlength: 300
  },

  read: {
    type: Boolean,
    default: false,
    index: true
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

NotificationSchema.index(
  { userId: 1, actorId: 1, type: 1 },
  { unique: true }
);

const Notification = mongoose.model('Notification', NotificationSchema);



/* ---------------------------------------------------------
   Authentication middleware
--------------------------------------------------------- */

async function authenticate(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.decode(token, JWT_SECRET);

    if (!decoded.sub || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'Session expired' });
    }

    const user = await User.findById(decoded.sub).select('+password');

    if (!user) {
      clearCookie(res, COOKIE_NAME);
      return res.status(401).json({ error: 'Session invalid' });
    }

    if (user.isBanned) {
      clearCookie(res, COOKIE_NAME);
      return res.status(403).json({ error: 'Account unavailable' });
    }

    if (Number(user.tokenVersion || 0) !== Number(decoded.tv || 0)) {
      clearCookie(res, COOKIE_NAME);
      return res.status(401).json({ error: 'Session invalidated' });
    }

    req.user = user;
    next();
  } catch {
    clearCookie(res, COOKIE_NAME);
    return res.status(401).json({ error: 'Invalid session' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  next();
}

async function recordAdminAudit(req, action, target = '', details = '') {
  try {
    if (!req.user?._id) return;

    await AdminAudit.create({
      action,
      actorId: req.user._id,
      target: String(target || '').slice(0, 200),
      details: String(details || '').slice(0, 1000)
    });
  } catch (err) {
    console.error('Admin audit error:', err);
  }
}

/* ---------------------------------------------------------
   ADMIN MESSAGES
--------------------------------------------------------- */

app.get('/api/admin/messages', authenticate, requireAdmin, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50,
      100
    );

    const messages = await Message.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('senderId', 'username')
      .populate({
        path: 'conversationId',
        populate: {
          path: 'participants',
          select: 'username'
        }
      })
      .lean();

    res.json({
      success: true,
      messages: messages.map(message => {
        const participants = message.conversationId?.participants || [];
        const recipient = participants.find(
          user => String(user._id) !== String(message.senderId?._id)
        );

        return {
          id: String(message._id),
          _id: String(message._id),
          sender: message.senderId?.username || 'Unknown',
          recipient: recipient?.username || '',
          text: message.type === 'voice'
            ? '[Voice message]'
            : message.content || '',
          type: message.type,
          createdAt: message.createdAt || null,
          editedAt: message.editedAt || null
        };
      })
    });
  } catch (err) {
    console.error('Admin messages error:', err);
    res.status(500).json({ error: 'Unable to load admin messages.' });
  }
});


app.delete('/api/admin/messages/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid message ID.' });
    }

    const message = await Message.findById(id).lean();

    if (!message) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    await Message.deleteOne({ _id: message._id });

    await recordAdminAudit(
      req,
      'message_deleted',
      id,
      `Deleted ${message.type || 'text'} message from conversation ${String(message.conversationId)}.`
    );

    res.json({
      success: true,
      id
    });
  } catch (err) {
    console.error('Admin message delete error:', err);
    res.status(500).json({ error: 'Unable to delete message.' });
  }
});


/* ---------------------------------------------------------
   ADMIN USERS
--------------------------------------------------------- */

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50,
      100
    );

    const q = String(req.query.q || '').trim();
    const filter = q
      ? {
          $or: [
            { username: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } }
          ]
        }
      : {};

    const users = await User.find(filter)
      .select('username email role isBanned emailVerified createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      ownerUsername: '',
      users: users.map(user => ({
        id: String(user._id),
        username: user.username || '',
        email: user.email || '',
        role: user.role || 'user',
        isBanned: !!user.isBanned,
        emailVerified: !!user.emailVerified,
        createdAt: user.createdAt || null
      }))
    });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Unable to load admin users.' });
  }
});


app.put('/api/admin/users/role', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, role } = req.body || {};
    const allowedRoles = ['user', 'admin'];

    if (!username || !allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid username or role.' });
    }

    const targetUser = await User.findOne({ username: String(username).trim() });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (String(targetUser._id) === String(req.user._id) && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin access.' });
    }

    const oldRole = targetUser.role || 'user';
    targetUser.role = role;
    await targetUser.save();

    await recordAdminAudit(
      req,
      'user_role_changed',
      targetUser.username,
      `Role changed from ${oldRole} to ${role}.`
    );

    res.json({
      success: true,
      username: targetUser.username,
      role: targetUser.role
    });
  } catch (err) {
    console.error('Admin user role error:', err);
    res.status(500).json({ error: 'Unable to update user role.' });
  }
});


app.put('/api/admin/users/ban', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, isBanned } = req.body || {};

    if (!username || typeof isBanned !== 'boolean') {
      return res.status(400).json({ error: 'Invalid username or ban status.' });
    }

    const targetUser = await User.findOne({ username: String(username).trim() });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (String(targetUser._id) === String(req.user._id) && isBanned) {
      return res.status(400).json({ error: 'You cannot ban your own admin account.' });
    }

    targetUser.isBanned = isBanned;
    await targetUser.save();

    await recordAdminAudit(
      req,
      isBanned ? 'user_banned' : 'user_unbanned',
      targetUser.username,
      isBanned ? 'User account banned.' : 'User account unbanned.'
    );

    res.json({
      success: true,
      username: targetUser.username,
      isBanned: !!targetUser.isBanned
    });
  } catch (err) {
    console.error('Admin user ban error:', err);
    res.status(500).json({ error: 'Unable to update user ban status.' });
  }
});


app.delete('/api/admin/users/:username', authenticate, requireAdmin, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();

    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const targetUser = await User.findOne({ username });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (String(targetUser._id) === String(req.user._id)) {
      return res.status(400).json({ error: 'You cannot delete your own admin account here.' });
    }

    const targetUserId = targetUser._id;

    await User.updateMany(
      { _id: { $ne: targetUserId } },
      {
        $pull: {
          sparkedUsers: targetUserId,
          passedUsers: targetUserId,
          blockedUsers: targetUserId
        }
      }
    );

    const conversations = await Conversation.find({
      participants: targetUserId
    }).select('_id').lean();

    const conversationIds = conversations.map(
      conversation => conversation._id
    );

    if (conversationIds.length) {
      await Message.deleteMany({
        conversationId: { $in: conversationIds }
      });

      await Conversation.deleteMany({
        _id: { $in: conversationIds }
      });
    }

    await Notification.deleteMany({
      $or: [
        { userId: targetUserId },
        { actorId: targetUserId }
      ]
    });

    const deleted = await User.deleteOne({
      _id: targetUserId
    });

    if (!deleted.deletedCount) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    await recordAdminAudit(
      req,
      'user_deleted',
      username,
      'User account and associated private chat data were permanently deleted.'
    );

    res.json({
      success: true,
      username
    });
  } catch (err) {
    console.error('Admin user delete error:', err);
    res.status(500).json({ error: 'Unable to delete user account.' });
  }
});


/* ---------------------------------------------------------
   ADMIN STATS
--------------------------------------------------------- */

app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [
      totalUsers,
      totalPosts,
      totalMessages,
      bannedUsers,
      openReports,
      adminCount
    ] = await Promise.all([
      User.countDocuments({}),
      0,
      Message.countDocuments({}),
      User.countDocuments({ isBanned: true }),
      Report.countDocuments({ status: { $in: ['pending', 'reviewed'] } }),
      User.countDocuments({ role: 'admin' })
    ]);

    res.json({
      success: true,
      totalUsers,
      totalPosts,
      totalMessages,
      bannedUsers,
      openReports,
      adminCount,
      activeSockets: io.engine?.clientsCount || 0
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Unable to load admin stats.' });
  }
});


app.get('/api/admin/audit-log', authenticate, requireAdmin, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50,
      100
    );

    const entries = await AdminAudit.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actorId', 'username')
      .lean();

    res.json({
      success: true,
      entries: entries.map(entry => ({
        id: String(entry._id),
        action: entry.action || '',
        actor: entry.actorId?.username || 'Unknown',
        target: entry.target || '',
        details: entry.details || '',
        createdAt: entry.createdAt || null
      }))
    });
  } catch (err) {
    console.error('Admin audit log error:', err);
    res.status(500).json({ error: 'Unable to load audit log.' });
  }
});


app.post('/api/admin/broadcast', authenticate, requireAdmin, async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();

    if (!message) {
      return res.status(400).json({ error: 'Broadcast message is required.' });
    }

    if (message.length > 1000) {
      return res.status(400).json({ error: 'Broadcast message is too long.' });
    }

    const broadcastPayload = {
      message,
      createdAt: new Date().toISOString()
    };

    for (const socket of io.sockets.sockets.values()) {
      if (String(socket.userId || '') === String(req.user._id)) {
        continue;
      }

      socket.emit('adminBroadcast', broadcastPayload);
    }

    await recordAdminAudit(
      req,
      'broadcast_sent',
      'all_users',
      message
    );

    res.json({
      success: true,
      message: 'Broadcast sent successfully.'
    });
  } catch (err) {
    console.error('Admin broadcast error:', err);
    res.status(500).json({ error: 'Unable to send broadcast.' });
  }
});


/* ---------------------------------------------------------
   ADMIN REPORTS
--------------------------------------------------------- */

app.get('/api/admin/reports', authenticate, requireAdmin, async (req, res) => {
  try {
    const allowedStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
    const requestedStatus = String(req.query.status || '').trim();
    const reportFilter = allowedStatuses.includes(requestedStatus)
      ? { status: requestedStatus }
      : {};

    const reports = await Report.find(reportFilter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('reporterId', 'username email avatar')
      .populate('reportedUserId', 'username email avatar')
      .lean();

    res.json({
      success: true,
      reports: reports.map(report => ({
        id: String(report._id),
        reporter: report.reporterId ? {
          id: String(report.reporterId._id),
          username: report.reporterId.username || '',
          email: report.reporterId.email || '',
          avatar: report.reporterId.avatar || ''
        } : null,
        reportedUser: report.reportedUserId ? {
          id: String(report.reportedUserId._id),
          username: report.reportedUserId.username || '',
          email: report.reportedUserId.email || '',
          avatar: report.reportedUserId.avatar || ''
        } : null,
        reason: report.reason,
        details: report.details || '',
        status: report.status,
        createdAt: report.createdAt,
        editedAt: report.editedAt || null,
        readAt: report.readAt || null
      }))
    });
  } catch (err) {
    console.error('Admin reports error:', err);
    res.status(500).json({ error: 'Unable to load reports.' });
  }
});

/* ---------------------------------------------------------
   ADMIN REPORT STATUS
--------------------------------------------------------- */

app.put('/api/admin/reports/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    const allowedStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid report ID.' });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid report status.' });
    }

    const report = await Report.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          editedAt: new Date()
        }
      },
      { new: true }
    ).lean();

    if (!report) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    res.json({
      success: true,
      report: {
        id: String(report._id),
        status: report.status,
        editedAt: report.editedAt || null
      }
    });
  } catch (err) {
    console.error('Admin report status error:', err);
    res.status(500).json({ error: 'Unable to update report status.' });
  }
});


/* ---------------------------------------------------------
   Health
--------------------------------------------------------- */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'MikiConnect',
    timestamp: new Date().toISOString()
  });
});

/* ---------------------------------------------------------
   Current session
--------------------------------------------------------- */

app.get('/api/me', authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    authenticated: true,
    user: {
      id: String(req.user._id),
      username: req.user.username,
      email: req.user.email || '',
      phone: req.user.phone || '',
      role: req.user.role,
      emailVerified: !!req.user.emailVerified,
      isPremium: !!req.user.isPremium,
      bio: req.user.bio || '',
      avatar: req.user.avatar || '',
      photos: Array.isArray(req.user.photos) ? req.user.photos.slice(0, 6) : [],
      age: req.user.age || null,
      minAge: req.user.minAge ?? 18,
      maxAge: req.user.maxAge ?? 100,
      gender: req.user.gender || '',
      interestedIn: req.user.interestedIn || '',
      showInDiscovery: req.user.showInDiscovery !== false,
      showLocation: req.user.showLocation !== false,
      showPhotos: req.user.showPhotos !== false,
      notificationPreferences: {
        newSpark: req.user.notificationPreferences?.newSpark !== false,
        mutualSpark: req.user.notificationPreferences?.mutualSpark !== false,
        privateMessages: req.user.notificationPreferences?.privateMessages !== false,
        pulseActivity: req.user.notificationPreferences?.pulseActivity !== false
      },
      location: req.user.location || ''
    }
  });
});

/* ---------------------------------------------------------
   REGISTER
--------------------------------------------------------- */

app.get('/api/user/invite', authenticate, async (req, res) => {
  try {
    let referralCode = req.user.referralCode;

    if (!referralCode) {
      referralCode = await generateReferralCode();
      await User.updateOne(
        { _id: req.user._id },
        { $set: { referralCode } }
      );
    }

    const invitedCount = await User.countDocuments({
      referredBy: req.user._id
    });

    const baseUrl = String(APP_URL || '').replace(/\/$/, '');
    const inviteLink = `${baseUrl}/register?ref=${encodeURIComponent(referralCode)}`;

    res.json({
      referralCode,
      inviteLink,
      invitedCount
    });
  } catch (error) {
    console.error('Invite info error:', error);
    res.status(500).json({ error: 'Unable to load invite information.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    if (!rateLimit(clientKey(req, 'register'), 8, 15 * 60 * 1000)) {
      return res.status(429).json({
        error: 'Too many registration attempts. Please try again later.'
      });
    }

    const username = normalizeUsername(req.body.username);
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!validUsername(username)) {
      return res.status(400).json({
        error: 'Username must be 3-30 characters using letters, numbers, or underscores.'
      });
    }

    if (!validEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (!validPassword(password)) {
      return res.status(400).json({
        error: 'Password must be between 8 and 128 characters.'
      });
    }

    const existing = await User.findOne({
      $or: [
        { username },
        { email }
      ]
    });

    if (existing) {
      if (existing.username === username) {
        return res.status(409).json({ error: 'Username already taken.' });
      }

      return res.status(409).json({
        error: 'An account with that email already exists.'
      });
    }

    const referralCodeInput = String(req.body.referralCode || '').trim().toUpperCase();
    let referredBy = null;

    if (referralCodeInput) {
      const inviter = await User.findOne({ referralCode: referralCodeInput }).select('_id').lean();
      if (inviter) {
        referredBy = inviter._id;
      }
    }

    const verificationToken = randomToken();
    const verificationCode = randomCode();
    const referralCode = await generateReferralCode();

    const user = new User({
      username,
      email,
      referralCode,
      referredBy,
      password: await bcrypt.hash(password, 12),
      role: 'user',
      emailVerified: !REQUIRE_EMAIL_VERIFICATION,
      ...(REQUIRE_EMAIL_VERIFICATION ? {
        emailVerificationTokenHash: hashSecret(verificationToken),
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        emailVerificationCodeHash: hashSecret(verificationCode),
        emailVerificationCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
        emailVerificationCodeAttempts: 0
      } : {})
    });

    await user.save();

    if (REQUIRE_EMAIL_VERIFICATION) {
      try {
        await sendVerificationEmail({
          email,
          username,
          verificationToken,
          verificationCode,
          appUrl: APP_URL
        });
      } catch (mailError) {
        await User.deleteOne({ _id: user._id });
        console.error('Verification email failed:', mailError.message);

        return res.status(503).json({
          error: 'We could not send the verification email. Please try again shortly.'
        });
      }
    }

    res.status(201).json({
      success: true,
      requiresVerification: REQUIRE_EMAIL_VERIFICATION,
      message: REQUIRE_EMAIL_VERIFICATION
        ? 'Account created. Check your email for the verification link and 6-digit code.'
        : 'Account created successfully. Welcome to MikiConnect!'
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

/* ---------------------------------------------------------
   LOGIN
--------------------------------------------------------- */

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!rateLimit(clientKey(req, 'login'), 12, 10 * 60 * 1000)) {
      return res.status(429).json({
        error: 'Too many login attempts. Please try again later.'
      });
    }

    const identifier = String(req.body.username || req.body.email || '').trim();
    const password = req.body.password;

    if (!identifier || !password) {
      return res.status(400).json({
        error: 'Please provide your username or email and password.'
      });
    }

    const normalized = identifier.toLowerCase();


    const user = await User.findOne({
      $or: [
        { username: normalized },
        { email: normalized }
      ]
    }).select('+password');

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Account unavailable.' });
    }

    const matches = await bcrypt.compare(password, user.password);


    if (!matches) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    if (REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
      return res.status(403).json({
        error: 'Please verify your email before logging in.',
        requiresVerification: true,
        email: user.email || ''
      });
    }

    const token = createSession(user);

    setCookie(res, COOKIE_NAME, token, SESSION_TTL_SECONDS);

    res.set('Cache-Control', 'no-store');

    res.json({
      success: true,
      user: {
        id: String(user._id),
        username: user.username,
        email: user.email,
        role: user.role,
        isPremium: !!user.isPremium
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

/* Backward-compatible route for the existing frontend while it is being updated. */
app.post('/api/login', async (req, res) => {
  req.url = '/api/auth/login';
  return app._router.handle(req, res);
});

/* ---------------------------------------------------------
   LOGOUT
--------------------------------------------------------- */

app.post('/api/auth/logout', (req, res) => {
  clearCookie(res, COOKIE_NAME);
  clearCookie(res, RESET_COOKIE_NAME);
  res.json({ success: true });
});


/* ---------------------------------------------------------
   DELETE ACCOUNT
--------------------------------------------------------- */
app.post('/api/auth/delete-account', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Remove this user from other users' relationship lists.
    await User.updateMany(
      { _id: { $ne: userId } },
      {
        $pull: {
          sparkedUsers: userId,
          passedUsers: userId,
          blockedUsers: userId
        }
      }
    );

    // Remove private chat data belonging to this account.
    const conversations = await Conversation.find({
      participants: userId
    }).select('_id').lean();

    const conversationIds = conversations.map(conversation => conversation._id);

    if (conversationIds.length) {
      await Message.deleteMany({
        conversationId: { $in: conversationIds }
      });

      await Conversation.deleteMany({
        _id: { $in: conversationIds }
      });
    }

    // Remove in-app notifications belonging to or generated by this account.
    await Notification.deleteMany({
      $or: [
        { userId: userId },
        { actorId: userId }
      ]
    });

    // Keep Report records for future Admin review.
    // Their ObjectId references may remain after this user is deleted.

    // Permanently delete the account.
    const deleted = await User.deleteOne({ _id: userId });

    if (!deleted.deletedCount) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Clear the active session cookies.
    clearCookie(res, COOKIE_NAME);
    clearCookie(res, RESET_COOKIE_NAME);

    return res.json({
      success: true,
      message: 'Your MikiConnect account has been deleted.'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({
      error: 'Unable to delete your account right now.'
    });
  }
});

/* ---------------------------------------------------------
   EMAIL VERIFICATION - LINK
--------------------------------------------------------- */

app.get('/api/auth/verify-email', async (req, res) => {
  const token = String(req.query.token || '');

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).send(`
      <h2>MikiConnect</h2>
      <p>This verification link is invalid.</p>
      <p><a href="/">Return to MikiConnect</a></p>
    `);
  }

  try {
    const user = await User.findOne({
      emailVerificationTokenHash: hashSecret(token),
      emailVerificationExpiresAt: { $gt: new Date() }
    }).select('+emailVerificationTokenHash +emailVerificationExpiresAt');

    if (!user) {
      return res.status(400).send(`
        <h2>MikiConnect</h2>
        <p>This verification link is invalid or has expired.</p>
        <p><a href="/">Return to MikiConnect</a></p>
      `);
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpiresAt = undefined;
    user.emailVerificationCodeHash = undefined;
    user.emailVerificationCodeExpiresAt = undefined;
    user.emailVerificationCodeAttempts = 0;

    await user.save();

    res.send(`
      <!doctype html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Email Verified - MikiConnect</title>
      </head>
      <body style="font-family:Arial,sans-serif;text-align:center;padding:60px 20px">
        <h1>Email verified ✓</h1>
        <p>Your MikiConnect account is now verified.</p>
        <p><a href="/">Log in to MikiConnect</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Email verification error:', err);
    res.status(500).send('Verification failed.');
  }
});

/* ---------------------------------------------------------
   EMAIL VERIFICATION - 6 DIGIT CODE
--------------------------------------------------------- */

app.post('/api/auth/verify-email-code', async (req, res) => {
  try {
    if (!rateLimit(clientKey(req, 'verify-code'), 10, 10 * 60 * 1000)) {
      return res.status(429).json({
        error: 'Too many verification attempts. Please try again later.'
      });
    }

    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();

    if (!validEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid verification details.' });
    }

    const user = await User.findOne({ email })
      .select('+emailVerificationCodeHash +emailVerificationCodeExpiresAt +emailVerificationCodeAttempts');

    if (!user || user.emailVerified) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    if (
      !user.emailVerificationCodeExpiresAt ||
      user.emailVerificationCodeExpiresAt.getTime() < Date.now() ||
      Number(user.emailVerificationCodeAttempts || 0) >= MAX_CODE_ATTEMPTS
    ) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    user.emailVerificationCodeAttempts += 1;

    if (!safeEqual(hashSecret(code), user.emailVerificationCodeHash)) {
      await user.save();
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpiresAt = undefined;
    user.emailVerificationCodeHash = undefined;
    user.emailVerificationCodeExpiresAt = undefined;
    user.emailVerificationCodeAttempts = 0;

    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully.'
    });
  } catch (err) {
    console.error('Verification code error:', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

/* ---------------------------------------------------------
   RESEND VERIFICATION
--------------------------------------------------------- */

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    if (!rateLimit(clientKey(req, 'resend-verification'), 3, 15 * 60 * 1000)) {
      return res.status(429).json({
        error: 'Too many requests. Please wait before requesting another code.'
      });
    }

    const email = normalizeEmail(req.body.email);

    if (!validEmail(email)) {
      return res.status(400).json({
        error: 'Please provide a valid email address.'
      });
    }

    const user = await User.findOne({ email })
      .select('+emailVerificationTokenHash +emailVerificationExpiresAt +emailVerificationCodeHash +emailVerificationCodeExpiresAt');

    if (!user || user.emailVerified) {
      return res.json({
        success: true,
        message: 'If that account needs verification, a new email has been sent.'
      });
    }

    const verificationToken = randomToken();
    const verificationCode = randomCode();

    user.emailVerificationTokenHash = hashSecret(verificationToken);
    user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    user.emailVerificationCodeHash = hashSecret(verificationCode);
    user.emailVerificationCodeExpiresAt = new Date(Date.now() + CODE_TTL_MS);
    user.emailVerificationCodeAttempts = 0;

    await user.save();

    await sendVerificationEmail({
      email,
      username: user.username,
      verificationToken,
      verificationCode,
      appUrl: APP_URL
    });

    res.json({
      success: true,
      message: 'If that account needs verification, a new email has been sent.'
    });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(503).json({
      error: 'We could not send the verification email right now.'
    });
  }
});

/* ---------------------------------------------------------
   FORGOT PASSWORD
--------------------------------------------------------- */

app.post('/api/auth/forgot-password', async (req, res) => {
  const genericResponse = {
    success: true,
    message: 'If an account with that email exists, password reset instructions have been sent.'
  };

  try {
    if (!rateLimit(clientKey(req, 'forgot-password'), 5, 15 * 60 * 1000)) {
      return res.status(429).json({
        error: 'Too many password-reset requests. Please try again later.'
      });
    }

    const email = normalizeEmail(req.body.email);

    if (!validEmail(email)) {
      return res.json(genericResponse);
    }

    const user = await User.findOne({ email })
      .select('+passwordResetTokenHash +passwordResetTokenExpiresAt +passwordResetCodeHash +passwordResetCodeExpiresAt');

    if (!user) {
      return res.json(genericResponse);
    }

    const resetToken = randomToken();
    const resetCode = randomCode();

    user.passwordResetTokenHash = hashSecret(resetToken);
    user.passwordResetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    user.passwordResetCodeHash = hashSecret(resetCode);
    user.passwordResetCodeExpiresAt = new Date(Date.now() + CODE_TTL_MS);
    user.passwordResetCodeAttempts = 0;

    await user.save();

    if (PASSWORD_RESET_MODE === 'screen') {
      return res.json({
        success: true,
        mode: 'screen',
        resetCode,
        message: 'Your password reset code is ready. Enter it below.'
      });
    }

    try {
      await sendPasswordResetEmail({
        email,
        username: user.username,
        resetToken,
        resetCode,
        appUrl: APP_URL
      });
    } catch (mailError) {
      console.error('Password reset email failed:', mailError.message);

      user.passwordResetTokenHash = undefined;
      user.passwordResetTokenExpiresAt = undefined;
      user.passwordResetCodeHash = undefined;
      user.passwordResetCodeExpiresAt = undefined;
      user.passwordResetCodeAttempts = 0;
      await user.save();
    }

    res.json(genericResponse);
  } catch (err) {
    console.error('Forgot-password error:', err);
    res.json(genericResponse);
  }
});

/* ---------------------------------------------------------
   CHANGE PASSWORD - AUTHENTICATED USER
--------------------------------------------------------- */

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = req.body.newPassword;

    if (!currentPassword || !validPassword(newPassword)) {
      return res.status(400).json({
        error: 'Current password and a new password between 8 and 128 characters are required.'
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'New password must be different from your current password.'
      });
    }

    const matches = await bcrypt.compare(currentPassword, req.user.password);

    if (!matches) {
      return res.status(401).json({
        error: 'Current password is incorrect.'
      });
    }

    req.user.password = await bcrypt.hash(newPassword, 12);

    /* Invalidate all existing sessions after a password change. */
    req.user.tokenVersion = Number(req.user.tokenVersion || 0) + 1;

    await req.user.save();

    clearCookie(res, COOKIE_NAME);

    res.set('Cache-Control', 'no-store');

    res.json({
      success: true,
      message: 'Password changed successfully. Please log in again with your new password.'
    });
  } catch (err) {
    console.error('Change-password error:', err);
    res.status(500).json({
      error: 'Unable to change password right now.'
    });
  }
});

/* ---------------------------------------------------------
   PASSWORD RESET - LINK
--------------------------------------------------------- */

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const resetTokenFromBody = String(req.body.resetToken || '');
    const newPassword = req.body.newPassword;

    if (!validPassword(newPassword)) {
      return res.status(400).json({
        error: 'Password must be between 8 and 128 characters.'
      });
    }

    const cookies = parseCookies(req);
    const resetCookie = cookies[RESET_COOKIE_NAME];

    let rawResetToken = resetTokenFromBody || '';

    if (!rawResetToken && resetCookie) {
      const decoded = decodeResetSession(resetCookie);
      rawResetToken = decoded ? decoded.token : '';
    }

    if (!/^[a-f0-9]{64}$/i.test(rawResetToken)) {
      return res.status(400).json({
        error: 'Invalid or expired password-reset session.'
      });
    }

    const user = await User.findOne({
      passwordResetTokenHash: hashSecret(rawResetToken),
      passwordResetTokenExpiresAt: { $gt: new Date() }
    }).select('+passwordResetTokenHash +passwordResetTokenExpiresAt');

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired password-reset session.'
      });
    }

    user.password = await bcrypt.hash(newPassword, 12);

    user.passwordResetTokenHash = undefined;
    user.passwordResetTokenExpiresAt = undefined;
    user.passwordResetCodeHash = undefined;
    user.passwordResetCodeExpiresAt = undefined;
    user.passwordResetCodeAttempts = 0;

    /* Invalidate every previous login session. */
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;

    await user.save();

    clearCookie(res, COOKIE_NAME);
    clearCookie(res, RESET_COOKIE_NAME);

    res.json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (err) {
    console.error('Reset-password error:', err);
    res.status(500).json({ error: 'Password reset failed.' });
  }
});

/* ---------------------------------------------------------
   PASSWORD RESET - 6 DIGIT CODE
--------------------------------------------------------- */

app.post('/api/auth/verify-reset-code', async (req, res) => {
  try {
    if (!rateLimit(clientKey(req, 'reset-code'), 10, 10 * 60 * 1000)) {
      return res.status(429).json({
        error: 'Too many attempts. Please try again later.'
      });
    }

    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();

    if (!validEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: 'Invalid or expired reset code.'
      });
    }

    const user = await User.findOne({ email })
      .select('+passwordResetCodeHash +passwordResetCodeExpiresAt +passwordResetCodeAttempts');

    if (
      !user ||
      !user.passwordResetCodeHash ||
      !user.passwordResetCodeExpiresAt ||
      user.passwordResetCodeExpiresAt.getTime() < Date.now() ||
      Number(user.passwordResetCodeAttempts || 0) >= MAX_CODE_ATTEMPTS
    ) {
      return res.status(400).json({
        error: 'Invalid or expired reset code.'
      });
    }

    user.passwordResetCodeAttempts += 1;

    if (!safeEqual(hashSecret(code), user.passwordResetCodeHash)) {
      await user.save();

      return res.status(400).json({
        error: 'Invalid or expired reset code.'
      });
    }

    const resetToken = randomToken();

    user.passwordResetTokenHash = hashSecret(resetToken);
    user.passwordResetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    /* Consume the code so it cannot be reused. */
    user.passwordResetCodeHash = undefined;
    user.passwordResetCodeExpiresAt = undefined;
    user.passwordResetCodeAttempts = 0;

    await user.save();

    const resetSession = createResetSession(resetToken);
    setCookie(res, RESET_COOKIE_NAME, resetSession, Math.ceil(RESET_TOKEN_TTL_MS / 1000));

    res.json({
      success: true,
      message: 'Code verified. You can now choose a new password.'
    });
  } catch (err) {
    console.error('Reset-code verification error:', err);
    res.status(500).json({
      error: 'Password reset verification failed.'
    });
  }
});

/* ---------------------------------------------------------
   GET CURRENT USER PROFILE
--------------------------------------------------------- */

app.get('/api/user/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to retrieve profile'
    });
  }
});

/* ---------------------------------------------------------
   UPDATE ACCOUNT INFORMATION
--------------------------------------------------------- */

app.put('/api/user/account', authenticate, async (req, res) => {
  try {
    const {
      username,
      email,
      phone
    } = req.body || {};

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const nextUsername = normalizeUsername(username);
    const nextEmail = normalizeEmail(email);
    const nextPhone = String(phone ?? '').trim();

    if (!validUsername(nextUsername)) {
      return res.status(400).json({
        error: 'Username must be 3-30 characters using letters, numbers, or underscores.'
      });
    }

    if (!validEmail(nextEmail)) {
      return res.status(400).json({
        error: 'Please provide a valid email address.'
      });
    }

    const usernameChanged = nextUsername !== String(user.username || '');
    const emailChanged = nextEmail !== String(user.email || '');

    if (usernameChanged || emailChanged) {
      const existing = await User.findOne({
        _id: { $ne: user._id },
        $or: [
          { username: nextUsername },
          { email: nextEmail }
        ]
      });

      if (existing) {
        if (existing.username === nextUsername) {
          return res.status(409).json({
            error: 'Username already taken.'
          });
        }

        if (existing.email === nextEmail) {
          return res.status(409).json({
            error: 'An account with that email already exists.'
          });
        }
      }
    }

    user.username = nextUsername;
    user.phone = nextPhone;

    if (emailChanged) {
      user.email = nextEmail;
      user.emailVerified = false;
      user.emailVerificationTokenHash = undefined;
      user.emailVerificationExpiresAt = undefined;
      user.emailVerificationCodeHash = undefined;
      user.emailVerificationCodeExpiresAt = undefined;
      user.emailVerificationCodeAttempts = 0;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Account information updated successfully.',
      user: {
        username: user.username,
        email: user.email,
        phone: user.phone,
        emailVerified: !!user.emailVerified
      }
    });
  } catch (err) {
    console.error('Account information update error:', err);
    res.status(500).json({
      error: 'Failed to update account information.'
    });
  }
});

/* ---------------------------------------------------------
   UPDATE USER PROFILE
--------------------------------------------------------- */

app.put('/api/user/profile', authenticate, async (req, res) => {
  try {
    const {
      photos,
      avatar,
      age,
      minAge,
      maxAge,
      gender,
      interestedIn,
      showInDiscovery,
      showLocation,
      showPhotos,
      notificationPreferences,
      bio,
      location
    } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (photos !== undefined) user.photos = photos;
    if (avatar !== undefined) user.avatar = String(avatar);
    if (age !== undefined) user.age = Number(age);

    if (minAge !== undefined || maxAge !== undefined) {
      const nextMinAge = minAge !== undefined
        ? Number(minAge)
        : Number(user.minAge ?? 18);

      const nextMaxAge = maxAge !== undefined
        ? Number(maxAge)
        : Number(user.maxAge ?? 100);

      if (
        !Number.isInteger(nextMinAge) ||
        !Number.isInteger(nextMaxAge) ||
        nextMinAge < 18 ||
        nextMaxAge > 100 ||
        nextMinAge > nextMaxAge
      ) {
        return res.status(400).json({
          error: 'Age range must be between 18 and 100, with the minimum age not greater than the maximum age.'
        });
      }

      user.minAge = nextMinAge;
      user.maxAge = nextMaxAge;
    }

    if (gender !== undefined) user.gender = gender;
    if (interestedIn !== undefined) user.interestedIn = interestedIn;

    if (showInDiscovery !== undefined) {
      user.showInDiscovery = Boolean(showInDiscovery);
    }

    if (showLocation !== undefined) {
      user.showLocation = Boolean(showLocation);
    }

    if (showPhotos !== undefined) {
      user.showPhotos = Boolean(showPhotos);
    }

    if (notificationPreferences !== undefined) {
      if (
        typeof notificationPreferences !== 'object' ||
        notificationPreferences === null ||
        Array.isArray(notificationPreferences)
      ) {
        return res.status(400).json({
          error: 'Invalid notification preferences.'
        });
      }

      const allowedKeys = [
        'newSpark',
        'mutualSpark',
        'privateMessages',
        'pulseActivity'
      ];

      for (const key of allowedKeys) {
        if (notificationPreferences[key] !== undefined) {
          if (typeof notificationPreferences[key] !== 'boolean') {
            return res.status(400).json({
              error: 'Notification preferences must be true or false.'
            });
          }

          user.notificationPreferences[key] = notificationPreferences[key];
        }
      }
    }

    if (bio !== undefined) user.bio = bio;
    if (location !== undefined) user.location = location;

    await user.save();

    res.json({
      message: 'Profile updated successfully!',
      user
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to update profile'
    });
  }
});

/* ---------------------------------------------------------
   UPLOAD PROFILE GALLERY PHOTO
--------------------------------------------------------- */

app.post('/api/media/photo', authenticate, avatarUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please select an image.' });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (Array.isArray(user.photos) && user.photos.length >= 6) {
      return res.status(400).json({
        error: 'You can have a maximum of 6 gallery photos.'
      });
    }


    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'mikiconnect/photos',
          resource_type: 'image'
        },
        (error, uploaded) => {
          if (error) return reject(error);
          resolve(uploaded);
        }
      );

      stream.end(req.file.buffer);
    });

    user.photos = Array.isArray(user.photos) ? user.photos : [];
    user.photos.push(result.secure_url);
    await user.save();

    res.json({
      message: 'Photo uploaded successfully!',
      photo: result.secure_url,
      photos: user.photos
    });
  } catch (err) {
    console.error('Gallery photo upload error:', err);
    res.status(500).json({
      error: 'Failed to upload gallery photo.'
    });
  }
});

/* ---------------------------------------------------------
   UPLOAD PROFILE AVATAR
--------------------------------------------------------- */

app.post('/api/media/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please select an image.' });
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'mikiconnect/avatars',
          resource_type: 'image'
        },
        (error, uploaded) => {
          if (error) return reject(error);
          resolve(uploaded);
        }
      );

      stream.end(req.file.buffer);
    });

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.avatar = result.secure_url;
    await user.save();

    res.json({
      message: 'Avatar uploaded successfully!',
      avatar: result.secure_url
    });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({
      error: 'Failed to upload avatar.'
    });
  }
});

/* ---------------------------------------------------------
   UPLOAD VOICE MESSAGE AUDIO
--------------------------------------------------------- */


function convertVoiceToMp3(inputBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', '128k',
      '-f', 'mp3',
      'pipe:1'
    ]);

    const outputChunks = [];
    const errorChunks = [];

    ffmpeg.stdout.on('data', chunk => {
      outputChunks.push(chunk);
    });

    ffmpeg.stderr.on('data', chunk => {
      errorChunks.push(chunk);
    });

    ffmpeg.on('error', error => {
      reject(error);
    });

    ffmpeg.on('close', code => {
      if (code !== 0) {
        const errorMessage = Buffer.concat(errorChunks)
          .toString()
          .trim();

        return reject(
          new Error(
            errorMessage ||
            `FFmpeg exited with code ${code}.`
          )
        );
      }

      const outputBuffer = Buffer.concat(outputChunks);

      if (!outputBuffer.length) {
        return reject(
          new Error('FFmpeg produced an empty audio file.')
        );
      }

      resolve(outputBuffer);
    });

    ffmpeg.stdin.on('error', error => {
      if (error.code !== 'EPIPE') {
        reject(error);
      }
    });

    ffmpeg.stdin.end(inputBuffer);
  });
}

app.post('/api/media/voice', authenticate, voiceUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Please provide an audio recording.'
      });
    }

    const mp3Buffer = await convertVoiceToMp3(req.file.buffer);

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'mikiconnect/voice-messages',
          resource_type: 'video',
          format: 'mp3'
        },
        (error, uploaded) => {
          if (error) return reject(error);
          resolve(uploaded);
        }
      );

      stream.end(mp3Buffer);
    });


    return res.json({
      success: true,
      audioUrl: result.secure_url
    });
  } catch (err) {
    console.error('Voice upload error:', err);
    return res.status(500).json({
      error: 'Failed to upload voice message.'
    });
  }
});

/* ---------------------------------------------------------
   PASS ACTION
--------------------------------------------------------- */

app.post('/api/spark/:userId/pass', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const targetUserId = String(req.params.userId || '');

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: 'You cannot pass yourself.' });
    }

    const targetUser = await User.findOne({
      _id: targetUserId,
      isBanned: { $ne: true },
      showInDiscovery: { $ne: false }
    }).select('_id');

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const alreadyPassed = (req.user.passedUsers || [])
      .some(id => String(id) === targetUserId);

    if (!alreadyPassed) {
      req.user.passedUsers.push(targetUser._id);

      // A Pass cancels this user's previous Spark.
      req.user.sparkedUsers = (req.user.sparkedUsers || [])
        .filter(id => String(id) !== targetUserId);

      await req.user.save();
    }

    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      message: 'Passed.'
    });
  } catch (err) {
    console.error('Spark pass error:', err);
    return res.status(500).json({
      error: 'Unable to pass this profile.'
    });
  }
});

/* ---------------------------------------------------------
   MUTUAL SPARK LIST
--------------------------------------------------------- */



app.get('/api/chat/conversations', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);

    const conversations = await Conversation.find({
      participants: req.user._id
    })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .populate('participants', 'username avatar photos isBanned blockedUsers')
      .lean();

    const conversationIds = conversations.map(conversation => conversation._id);

    const latestMessages = conversationIds.length
      ? await Message.aggregate([
          {
            $match: {
              conversationId: { $in: conversationIds }
            }
          },
          {
            $sort: {
              createdAt: -1
            }
          },
          {
            $group: {
              _id: '$conversationId',
              content: { $first: '$content' },
              createdAt: { $first: '$createdAt' }
            }
          }
        ])
      : [];

    const latestMessageMap = new Map(
      latestMessages.map(message => [
        String(message._id),
        {
          content: message.content || '',
          createdAt: message.createdAt
        }
      ])
    );

    const result = conversations
      .map(conversation => {
        const participant = (conversation.participants || []).find(
          user =>
            String(user._id) !== currentUserId &&
            !user.isBanned &&
            !(req.user.blockedUsers || []).some(
              blockedId => String(blockedId) === String(user._id)
            ) &&
            !(user.blockedUsers || []).some(
              blockedId => String(blockedId) === currentUserId
            )
        );

        if (!participant) return null;

        const latestMessage = latestMessageMap.get(String(conversation._id));

        return {
          id: String(conversation._id),
          participant: {
            id: String(participant._id),
            username: participant.username,
            avatar: participant.avatar || '',
            photos: Array.isArray(participant.photos) ? participant.photos.slice(0, 6) : []
          },
          unreadCount: Number(
            conversation.unreadCounts?.[currentUserId] || 0
          ),
          lastMessage: latestMessage?.content || '',
          lastMessageAt: latestMessage?.createdAt || conversation.lastMessageAt || conversation.createdAt,
          hasConversation: true
        };
      })
      .filter(Boolean);

    const mutualSparkUsers = await User.find({
      _id: {
        $ne: req.user._id,
        $in: req.user.sparkedUsers || [],
        $nin: req.user.blockedUsers || []
      },
      isBanned: { $ne: true },
      blockedUsers: { $ne: req.user._id },
      sparkedUsers: req.user._id
    })
      .select('username avatar photos isBanned')
      .limit(100)
      .lean();

    const existingParticipantIds = new Set(
      result.map(item => String(item.participant.id))
    );

    mutualSparkUsers.forEach(user => {
      const userId = String(user._id);

      if (existingParticipantIds.has(userId)) return;

      result.push({
        id: null,
        participant: {
          id: userId,
          username: user.username,
          avatar: user.avatar || '',
          photos: Array.isArray(user.photos) ? user.photos.slice(0, 6) : []
        },
        unreadCount: 0,
        lastMessage: '',
        lastMessageAt: null,
        hasConversation: false
      });
    });

    result.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      }

      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;

      return String(a.participant.username || '').localeCompare(
        String(b.participant.username || '')
      );
    });

    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, conversations: result });
  } catch (err) {
    console.error('Conversation list error:', err);
    return res.status(500).json({ error: 'Unable to load conversations.' });
  }
});

app.get('/api/chat/mutual-sparks', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const users = await User.find({
      _id: {
        $ne: currentUserId,
        $in: req.user.sparkedUsers || [],
        $nin: req.user.blockedUsers || []
      },
      isBanned: { $ne: true },
      blockedUsers: { $ne: currentUserId },
      sparkedUsers: currentUserId
    })
      .select('username avatar photos age location bio')
      .limit(100)
      .lean();

    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      users: users.map(user => ({
        id: String(user._id),
        username: user.username,
        avatar: user.avatar || '',
        photos: Array.isArray(user.photos) ? user.photos.slice(0, 6) : [],
        age: user.age || null,
        location: user.location || '',
        bio: user.bio || ''
      }))
    });
  } catch (err) {
    console.error('Mutual Spark list error:', err);
    return res.status(500).json({
      error: 'Unable to load mutual Sparks.'
    });
  }
});

/* ---------------------------------------------------------
   MUTUAL SPARK CONVERSATIONS
--------------------------------------------------------- */



app.post('/api/chat/conversation/:userId', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const otherUserId = String(req.params.userId || '');

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    if (currentUserId === otherUserId) {
      return res.status(400).json({ error: 'Invalid conversation.' });
    }

    const otherUser = await User.findById(otherUserId)
      .select('username avatar photos isBanned sparkedUsers')
      .lean();

    if (!otherUser || otherUser.isBanned === true) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const currentUserSparked = (req.user.sparkedUsers || [])
      .some(id => String(id) === otherUserId);

    const otherUserSparked = (otherUser.sparkedUsers || [])
      .some(id => String(id) === currentUserId);

    if (!currentUserSparked || !otherUserSparked) {
      return res.status(403).json({
        error: 'You can only chat after a mutual Spark.'
      });
    }

    const participants = [
      req.user._id,
      new mongoose.Types.ObjectId(otherUserId)
    ].sort((a, b) => String(a).localeCompare(String(b)));

    let conversation = await Conversation.findOne({
      participants: { $all: participants },
      $expr: { $eq: [{ $size: '$participants' }, 2] }
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants,
        lastMessageAt: new Date()
      });
    }

    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      conversation: {
        id: String(conversation._id),
        participant: {
          id: otherUserId,
          username: otherUser.username,
          avatar: otherUser.avatar || '',
          photos: Array.isArray(otherUser.photos)
            ? otherUser.photos.slice(0, 6)
            : []
        }
      }
    });
  } catch (err) {
    console.error('Conversation creation error:', err);
    return res.status(500).json({
      error: 'Unable to open conversation.'
    });
  }
});

/* ---------------------------------------------------------
   PRIVATE CHAT MESSAGES
--------------------------------------------------------- */

async function getAuthorizedConversation(conversationId, userId) {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return null;
  }

  const conversation = await Conversation.findOne({
    _id: conversationId,
    participants: userId
  }).lean();

  if (!conversation || conversation.participants.length !== 2) {
    return null;
  }

  const otherUserId = conversation.participants.find(
    participantId => String(participantId) !== String(userId)
  );

  if (!otherUserId) {
    return null;
  }

  const users = await User.find({
    _id: { $in: [userId, otherUserId] }
  })
    .select("_id blockedUsers")
    .lean();

  const currentUser = users.find(
    user => String(user._id) === String(userId)
  );

  const otherUser = users.find(
    user => String(user._id) === String(otherUserId)
  );

  const currentUserBlockedOther = (currentUser?.blockedUsers || [])
    .some(id => String(id) === String(otherUserId));

  const otherUserBlockedCurrent = (otherUser?.blockedUsers || [])
    .some(id => String(id) === String(userId));

  if (currentUserBlockedOther || otherUserBlockedCurrent) {
    return null;
  }

  return conversation;
}

app.get('/api/chat/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const conversation = await getAuthorizedConversation(
      req.params.conversationId,
      req.user._id
    );

    if (!conversation) {
      return res.status(403).json({
        error: 'Conversation unavailable.'
      });
    }

    const messages = await Message.find({
      conversationId: conversation._id
    })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate('senderId', 'username')
      .populate({
        path: 'replyToMessageId',
        select: 'senderId type content audioDuration',
        populate: {
          path: 'senderId',
          select: 'username'
        }
      })
      .lean();

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { [`unreadCounts.${String(req.user._id)}`]: 0 } }
    );

    const readAt = new Date();

    const readResult = await Message.updateMany(
      {
        conversationId: conversation._id,
        senderId: { $ne: req.user._id },
        readAt: null
      },
      {
        $set: { readAt }
      }
    );

    const senderIds = await Message.distinct('senderId', {
      conversationId: conversation._id,
      senderId: { $ne: req.user._id }
    });

    senderIds.forEach(senderId => {
      io.to(`user:${String(senderId)}`).emit('messagesRead', {
        conversationId: String(conversation._id),
        readAt,
        updatedCount: Number(readResult.modifiedCount || 0)
      });
    });

    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      messages: messages.map(message => ({
        id: String(message._id),
        senderId: String(message.senderId?._id || message.senderId),
        senderUsername: message.senderId?.username || '',
        replyToMessageId: message.replyToMessageId
          ? String(message.replyToMessageId._id || message.replyToMessageId)
          : null,
        replyTo: message.replyToMessageId && typeof message.replyToMessageId === 'object'
          ? {
              id: String(message.replyToMessageId._id),
              senderId: String(
                message.replyToMessageId.senderId?._id ||
                message.replyToMessageId.senderId
              ),
              senderUsername: message.replyToMessageId.senderId?.username || '',
              type: message.replyToMessageId.type || 'text',
              content: message.replyToMessageId.content || '',
              audioDuration: message.replyToMessageId.audioDuration ?? null
            }
          : null,
        type: message.type || 'text',
        content: message.content || '',
        audioUrl: message.audioUrl || '',
        audioDuration: message.audioDuration ?? null,
        createdAt: message.createdAt,
        editedAt: message.editedAt || null,
        deliveredAt: message.deliveredAt || null,
        readAt: message.readAt || null
      }))
    });
  } catch (err) {
    console.error('Chat history error:', err);
    return res.status(500).json({
      error: 'Unable to load messages.'
    });
  }
});

app.post('/api/chat/:conversationId/read', authenticate, async (req, res) => {
  try {
    const conversation = await getAuthorizedConversation(
      req.params.conversationId,
      req.user._id
    );

    if (!conversation) {
      return res.status(403).json({ error: 'Conversation unavailable.' });
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { [`unreadCounts.${String(req.user._id)}`]: 0 } }
    );

    const readAt = new Date();

    const readResult = await Message.updateMany(
      {
        conversationId: conversation._id,
        senderId: { $ne: req.user._id },
        readAt: null
      },
      {
        $set: { readAt }
      }
    );

    if (readResult.modifiedCount > 0) {
      const senderIds = await Message.distinct('senderId', {
        conversationId: conversation._id,
        senderId: { $ne: req.user._id }
      });

      senderIds.forEach(senderId => {
        io.to(`user:${String(senderId)}`).emit('messagesRead', {
          conversationId: String(conversation._id),
          readAt,
          updatedCount: Number(readResult.modifiedCount || 0)
        });
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ success: true });
  } catch (err) {
    console.error('Conversation read error:', err);
    return res.status(500).json({ error: 'Unable to mark conversation read.' });
  }
});

app.post('/api/chat/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const conversation = await getAuthorizedConversation(
      req.params.conversationId,
      req.user._id
    );

    if (!conversation) {
      return res.status(403).json({
        error: 'Conversation unavailable.'
      });
    }

    const type = String(req.body?.type || 'text').trim().toLowerCase();
    const content = String(req.body?.content || '').trim();
    const audioUrl = String(req.body?.audioUrl || '').trim();
    const audioDuration = Number(req.body?.audioDuration);

    const rawReplyToMessageId = String(req.body?.replyToMessageId || '').trim();
    let replyToMessageId = null;
    let replyTarget = null;

    if (rawReplyToMessageId) {
      if (!mongoose.Types.ObjectId.isValid(rawReplyToMessageId)) {
        return res.status(400).json({
          error: 'Invalid reply message.'
        });
      }

      replyTarget = await Message.findOne({
        _id: rawReplyToMessageId,
        conversationId: conversation._id
      })
        .select('_id senderId type content audioDuration')
        .populate('senderId', 'username')
        .lean();

      if (!replyTarget) {
        return res.status(400).json({
          error: 'Reply message not found.'
        });
      }

      replyToMessageId = replyTarget._id;
    }

    if (!['text', 'voice'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid message type.'
      });
    }

    if (type === 'text') {
      if (!content) {
        return res.status(400).json({
          error: 'Message cannot be empty.'
        });
      }

      if (content.length > 2000) {
        return res.status(400).json({
          error: 'Message is too long.'
        });
      }
    }

    if (type === 'voice') {
      if (!audioUrl) {
        return res.status(400).json({
          error: 'Voice message audio is required.'
        });
      }

      if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
        return res.status(400).json({
          error: 'Voice message duration is required.'
        });
      }

      if (audioDuration > 300) {
        return res.status(400).json({
          error: 'Voice message is too long.'
        });
      }
    }

    console.time('VOICE_MESSAGE_CREATE');

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: req.user._id,
      replyToMessageId,
      type,
      content: type === 'text' ? content : '',
      audioUrl: type === 'voice' ? audioUrl : '',
      audioDuration: type === 'voice' ? audioDuration : null
    });

    console.timeEnd('VOICE_MESSAGE_CREATE');

    const recipientId = conversation.participants.find(
      participantId => String(participantId) !== String(req.user._id)
    );

    const update = { $set: { lastMessageAt: message.createdAt } };
    if (recipientId) {
      update.$inc = { [`unreadCounts.${String(recipientId)}`]: 1 };
    }

    await Conversation.updateOne({ _id: conversation._id }, update);

    let deliveredAt = null;

    if (recipientId) {
      const sender = await User.findById(req.user._id).select('username').lean();

      const recipientRoom = `user:${String(recipientId)}`;
      const recipientSockets = io.sockets.adapter.rooms.get(recipientRoom);
      const recipientIsInConversation = Boolean(
        recipientSockets && recipientSockets.size > 0
      );

      if (recipientIsInConversation) {
        deliveredAt = new Date();

        await Message.updateOne(
          { _id: message._id },
          { $set: { deliveredAt } }
        );

      }

      io.to(`user:${String(recipientId)}`).emit('chatUnread', {
        conversationId: String(conversation._id),
        senderId: String(req.user._id),
        senderUsername: sender?.username || '',
        unreadCount: Number(update.$inc[`unreadCounts.${String(recipientId)}`] || 1)
      });
    }

    res.set('Cache-Control', 'no-store');

    return res.status(201).json({
      success: true,
      message: {
        id: String(message._id),
        senderId: String(message.senderId),
        replyToMessageId: message.replyToMessageId
          ? String(message.replyToMessageId)
          : null,
        replyTo: replyTarget ? {
          id: String(replyTarget._id),
          senderId: String(
            replyTarget.senderId?._id ||
            replyTarget.senderId
          ),
          senderUsername: replyTarget.senderId?.username || '',
          type: replyTarget.type || 'text',
          content: replyTarget.content || '',
          audioDuration: replyTarget.audioDuration ?? null
        } : null,
        type: message.type || 'text',
        content: message.content || '',
        audioUrl: message.audioUrl || '',
        audioDuration: message.audioDuration ?? null,
        createdAt: message.createdAt,
        deliveredAt,
        readAt: null
      }
    });
  } catch (err) {
    console.error('Chat send error:', err);
    return res.status(500).json({
      error: 'Unable to send message.'
    });
  }
});


app.put('/api/chat/messages/:messageId', authenticate, async (req, res) => {
  try {
    const messageId = String(req.params.messageId || '').trim();
    const content = String(req.body?.content || '').trim();

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid message.' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    if (content.length > 2000) {
      return res.status(400).json({
        error: 'Message is too long.'
      });
    }

    const message = await Message.findOne({
      _id: messageId,
      senderId: req.user._id
    });

    if (!message) {
      return res.status(404).json({
        error: 'Message not found.'
      });
    }

    if (message.type !== 'text') {
      return res.status(400).json({
        error: 'Voice messages cannot be edited.'
      });
    }

    message.content = content;
    message.editedAt = new Date();

    await message.save();

    return res.status(200).json({
      success: true,
      message: {
        id: String(message._id),
        senderId: String(message.senderId),
        replyToMessageId: message.replyToMessageId
          ? String(message.replyToMessageId)
          : null,
        type: message.type || 'text',
        content: message.content || '',
        audioUrl: message.audioUrl || '',
        audioDuration: message.audioDuration ?? null,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
        deliveredAt: message.deliveredAt || null,
        readAt: message.readAt || null
      }
    });
  } catch (err) {
    console.error('Chat edit error:', err);
    return res.status(500).json({
      error: 'Unable to edit message.'
    });
  }
});

/* ---------------------------------------------------------
   PULSE ANSWERS
--------------------------------------------------------- */

app.post('/api/pulse/answer', authenticate, async (req, res) => {
  try {
    const questionId = String(req.body?.questionId || '').trim();
    const answer = String(req.body?.answer || '').trim();

    if (!questionId || !answer) {
      return res.status(400).json({
        error: 'Question and answer are required.'
      });
    }

    if (questionId.length > 80 || answer.length > 200) {
      return res.status(400).json({
        error: 'Invalid Pulse answer.'
      });
    }

    if (!req.user.pulseAnswers) {
      req.user.pulseAnswers = new Map();
    }

    req.user.pulseAnswers.set(questionId, answer);
    req.user.markModified('pulseAnswers');

    await req.user.save();

    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      pulseAnswers: Object.fromEntries(req.user.pulseAnswers)
    });
  } catch (err) {
    console.error('Pulse answer error:', err);
    return res.status(500).json({
      error: 'Unable to save Pulse answer.'
    });
  }
});

/* ---------------------------------------------------------
   PULSE MATCHING
--------------------------------------------------------- */

app.get('/api/pulse/matches', authenticate, async (req, res) => {
  try {
    const currentUser = req.user;
    const currentUserId = currentUser._id;

    const currentAge = Number(currentUser.age || 0);
    const currentMinAge = Number(currentUser.minAge ?? 18);
    const currentMaxAge = Number(currentUser.maxAge ?? 100);
    const currentGender = String(currentUser.gender || '').toLowerCase();
    const currentInterestedIn = String(currentUser.interestedIn || '').toLowerCase();
    const currentLocation = String(currentUser.location || '').trim().toLowerCase();

    const excludedIds = [
      currentUserId,
      ...(currentUser.sparkedUsers || []),
      ...(currentUser.passedUsers || []),
      ...(currentUser.blockedUsers || [])
    ].map(id => String(id));

    const profiles = await User.find({
      _id: {
        $nin: excludedIds
      },
      showInDiscovery: { $ne: false },
      blockedUsers: { $ne: currentUserId },
      isBanned: { $ne: true },
      age: { $gte: currentMinAge, $lte: currentMaxAge }
    })
      .select(
        'username avatar photos age minAge maxAge gender interestedIn bio location ' +
        'showPhotos showLocation pulseAnswers isPremium'
      )
      .limit(100)
      .lean();

    function interestMatches(interestedIn, gender) {
      if (!interestedIn || !gender) return true;
      if (interestedIn === 'everyone') return true;
      if (interestedIn === 'men') return gender === 'man';
      if (interestedIn === 'women') return gender === 'woman';
      return false;
    }

    function ageMatches(age, minAge, maxAge) {
      if (!Number.isFinite(age)) return false;
      return age >= minAge && age <= maxAge;
    }

    function locationScore(a, b) {
      if (!a || !b) return 0;

      if (a === b) return 30;

      const aParts = a.split(/[,\-]/).map(part => part.trim()).filter(Boolean);
      const bParts = b.split(/[,\-]/).map(part => part.trim()).filter(Boolean);

      const sharedParts = aParts.filter(part =>
        bParts.some(other => other === part)
      );

      if (sharedParts.length > 0) return 20;

      const aWords = new Set(a.split(/\s+/).filter(Boolean));
      const bWords = new Set(b.split(/\s+/).filter(Boolean));

      let sharedWords = 0;
      for (const word of aWords) {
        if (word.length >= 4 && bWords.has(word)) {
          sharedWords += 1;
        }
      }

      return sharedWords > 0 ? 10 : 0;
    }

    function pulseScore(aAnswers, bAnswers) {
      if (!aAnswers || !bAnswers) return { score: 0, matches: 0 };

      const a = Object.fromEntries(
        aAnswers instanceof Map ? aAnswers : Object.entries(aAnswers)
      );
      const b = Object.fromEntries(
        bAnswers instanceof Map ? bAnswers : Object.entries(bAnswers)
      );

      const questionIds = Object.keys(a);
      if (!questionIds.length) return { score: 0, matches: 0 };

      let matches = 0;

      for (const questionId of questionIds) {
        if (
          Object.prototype.hasOwnProperty.call(b, questionId) &&
          String(a[questionId]) === String(b[questionId])
        ) {
          matches += 1;
        }
      }

      return {
        score: Math.round((matches / questionIds.length) * 50),
        matches
      };
    }

    const matches = [];

    for (const profile of profiles) {
      const profileAge = Number(profile.age || 0);
      const profileGender = String(profile.gender || '').toLowerCase();
      const profileInterestedIn = String(profile.interestedIn || '').toLowerCase();
      const profileMinAge = Number(profile.minAge ?? 18);
      const profileMaxAge = Number(profile.maxAge ?? 100);

      if (
        currentAge &&
        !ageMatches(currentAge, profileMinAge, profileMaxAge)
      ) {
        continue;
      }

      if (
        !interestMatches(currentInterestedIn, profileGender) ||
        !interestMatches(profileInterestedIn, currentGender)
      ) {
        continue;
      }

      const locationPoints = locationScore(
        currentLocation,
        String(profile.location || '').trim().toLowerCase()
      );

      const pulse = pulseScore(
        currentUser.pulseAnswers,
        profile.pulseAnswers
      );

      const agePoints =
        currentAge &&
        profileAge >= currentMinAge &&
        profileAge <= currentMaxAge &&
        currentAge >= profileMinAge &&
        currentAge <= profileMaxAge
          ? 20
          : 0;

      const genderPoints =
        interestMatches(currentInterestedIn, profileGender) &&
        interestMatches(profileInterestedIn, currentGender)
          ? 20
          : 0;

      const totalScore = Math.min(
        100,
        agePoints + genderPoints + locationPoints + pulse.score
      );

      if (totalScore < 30) continue;

      matches.push({
        id: String(profile._id),
        username: profile.username,
        avatar: profile.showPhotos !== false ? (profile.avatar || '') : '',
        photos:
          profile.showPhotos !== false && Array.isArray(profile.photos)
            ? profile.photos.slice(0, 6)
            : [],
        age: profileAge || null,
        gender: profileGender,
        interestedIn: profileInterestedIn,
        bio: profile.bio || '',
        location:
          profile.showLocation !== false ? (profile.location || '') : '',
        isPremium: !!profile.isPremium,
        compatibility: totalScore,
        pulseMatches: pulse.matches
      });
    }

    matches.sort((a, b) => {
      if (b.compatibility !== a.compatibility) {
        return b.compatibility - a.compatibility;
      }

      return b.pulseMatches - a.pulseMatches;
    });

    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      matches: matches.slice(0, 20)
    });
  } catch (err) {
    console.error('Pulse matching error:', err);
    return res.status(500).json({
      error: 'Unable to load Pulse matches.'
    });
  }
});

/* ---------------------------------------------------------
   SPARK DISCOVERY
--------------------------------------------------------- */






/* ---------------------------------------------------------
   BLOCK / REPORT
--------------------------------------------------------- */

app.post('/api/users/:userId/block', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const targetUserId = String(req.params.userId || '');

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: 'You cannot block yourself.' });
    }

    const targetUser = await User.findById(targetUserId).select('_id isBanned');

    if (!targetUser || targetUser.isBanned === true) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { blockedUsers: targetUser._id } }
    );

    return res.json({
      success: true,
      message: 'User blocked successfully.'
    });
  } catch (err) {
    console.error('Block user error:', err);
    return res.status(500).json({ error: 'Unable to block this user right now.' });
  }
});

app.delete('/api/users/:userId/block', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const targetUserId = String(req.params.userId || '');

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { blockedUsers: new mongoose.Types.ObjectId(targetUserId) } }
    );

    return res.json({
      success: true,
      message: 'User unblocked successfully.'
    });
  } catch (err) {
    console.error('Unblock user error:', err);
    return res.status(500).json({ error: 'Unable to unblock this user right now.' });
  }
});

app.get('/api/users/blocked', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('blockedUsers')
      .lean();

    const blockedIds = Array.isArray(user?.blockedUsers)
      ? user.blockedUsers
      : [];

    const blockedUsers = await User.find({
      _id: { $in: blockedIds },
      isBanned: { $ne: true }
    })
      .select('username avatar')
      .sort({ username: 1 })
      .lean();

    return res.json({
      success: true,
      users: blockedUsers.map(user => ({
        id: String(user._id),
        username: user.username,
        avatar: user.avatar || ''
      }))
    });
  } catch (err) {
    console.error('Blocked users error:', err);
    return res.status(500).json({ error: 'Unable to load blocked users right now.' });
  }
});

app.post('/api/users/:userId/report', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const targetUserId = String(req.params.userId || '');
    const reason = String(req.body?.reason || '').trim();
    const details = String(req.body?.details || '').trim();

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: 'You cannot report yourself.' });
    }

    const allowedReasons = [
      'harassment',
      'spam',
      'fake_profile',
      'inappropriate_content',
      'scam',
      'safety_concern',
      'other'
    ];

    if (!allowedReasons.includes(reason)) {
      return res.status(400).json({ error: 'Please choose a valid report reason.' });
    }

    if (details.length > 1000) {
      return res.status(400).json({ error: 'Report details are too long.' });
    }

    const targetUser = await User.findById(targetUserId)
      .select('_id isBanned');

    if (!targetUser || targetUser.isBanned === true) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const report = await Report.create({
      reporterId: req.user._id,
      reportedUserId: targetUser._id,
      reason,
      details
    });

    return res.json({
      success: true,
      reportId: String(report._id),
      message: 'Report submitted successfully.'
    });
  } catch (err) {
    console.error('Report user error:', err);
    return res.status(500).json({ error: 'Unable to submit this report right now.' });
  }
});

app.post('/api/users/:userId/block-and-report', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const targetUserId = String(req.params.userId || '');
    const reason = String(req.body?.reason || '').trim();
    const details = String(req.body?.details || '').trim();

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: 'You cannot block or report yourself.' });
    }

    const allowedReasons = [
      'harassment',
      'spam',
      'fake_profile',
      'inappropriate_content',
      'scam',
      'safety_concern',
      'other'
    ];

    if (!allowedReasons.includes(reason)) {
      return res.status(400).json({ error: 'Please choose a valid report reason.' });
    }

    if (details.length > 1000) {
      return res.status(400).json({ error: 'Report details are too long.' });
    }

    const targetUser = await User.findById(targetUserId)
      .select('_id isBanned');

    if (!targetUser || targetUser.isBanned === true) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { blockedUsers: targetUser._id } }
    );

    const report = await Report.create({
      reporterId: req.user._id,
      reportedUserId: targetUser._id,
      reason,
      details
    });

    return res.json({
      success: true,
      reportId: String(report._id),
      message: 'User blocked and report submitted successfully.'
    });
  } catch (err) {
    console.error('Block and report error:', err);
    return res.status(500).json({
      error: 'Unable to block and report this user right now.'
    });
  }
});

app.get('/api/spark/discover', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const profiles = await User.find({
      _id: {
        $ne: currentUserId,
        $nin: [
          ...(req.user.sparkedUsers || []),
          ...(req.user.passedUsers || []),
          ...(req.user.blockedUsers || [])
        ]
      },
      blockedUsers: { $ne: currentUserId },
      isBanned: { $ne: true }
    })
      .select('username avatar photos age gender interestedIn bio location isPremium showPhotos showLocation')
      .limit(20)
      .lean();

    const safeProfiles = profiles.map(profile => ({
      id: String(profile._id),
      username: profile.username,
      avatar: profile.showPhotos !== false ? (profile.avatar || '') : '',
      photos: profile.showPhotos !== false && Array.isArray(profile.photos)
        ? profile.photos.slice(0, 6)
        : [],
      age: profile.age || null,
      gender: profile.gender || '',
      interestedIn: profile.interestedIn || '',
      bio: profile.bio || '',
      location: profile.showLocation !== false ? (profile.location || '') : '',
      isPremium: !!profile.isPremium
    }));

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      profiles: safeProfiles
    });
  } catch (err) {
    console.error('Spark discovery error:', err);
    res.status(500).json({
      error: 'Unable to load Spark profiles.'
    });
  }
});

/* ---------------------------------------------------------
   SPARK ACTION
--------------------------------------------------------- */

app.post('/api/spark/:userId', authenticate, async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const targetUserId = String(req.params.userId || '');

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user.' });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: 'You cannot Spark yourself.' });
    }

    const targetUser = await User.findOne({
      _id: targetUserId,
      isBanned: { $ne: true }
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const alreadySparked = (req.user.sparkedUsers || [])
      .some(id => String(id) === targetUserId);

    if (!alreadySparked) {
      req.user.sparkedUsers.push(targetUser._id);

      // Remove a previous Pass if the user changes their mind.
      req.user.passedUsers = (req.user.passedUsers || [])
        .filter(id => String(id) !== targetUserId);

      await req.user.save();
    }

    const reciprocalSpark = (targetUser.sparkedUsers || [])
      .some(id => String(id) === currentUserId);

    let notification = null;

    // Notify the target only the first time this user Sparks them.
    if (!alreadySparked) {
      notification = await Notification.findOneAndUpdate(
        {
          userId: targetUser._id,
          actorId: req.user._id,
          type: 'spark'
        },
        {
          $setOnInsert: {
            userId: targetUser._id,
            actorId: req.user._id,
            type: 'spark',
            message: `✨ ${req.user.username} sent you a Spark!`
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      ).lean();

      io.to(`user:${targetUser._id}`).emit('notification', {
        id: String(notification._id),
        type: notification.type,
        actorId: String(notification.actorId),
        message: notification.message,
        read: notification.read,
        createdAt: notification.createdAt
      });
    }

    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      mutual: reciprocalSpark,
      message: reciprocalSpark
        ? '✨ It’s a mutual Spark!'
        : '✨ Spark sent!'
    });
  } catch (err) {
    console.error('Spark action error:', err);
    return res.status(500).json({
      error: 'Unable to send Spark.'
    });
  }
});


/* ---------------------------------------------------------
   NOTIFICATIONS
--------------------------------------------------------- */

app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.user._id
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('actorId', 'username avatar')
      .lean();

    const unreadCount = notifications.filter(notification => !notification.read).length;

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      notifications: notifications.map(notification => ({
        id: String(notification._id),
        type: notification.type,
        actorId: String(notification.actorId?._id || notification.actorId),
        actorUsername: notification.actorId?.username || '',
        actorAvatar: notification.actorId?.avatar || '',
        message: notification.message,
        read: !!notification.read,
        createdAt: notification.createdAt
      })),
      unreadCount
    });
  } catch (err) {
    console.error('Notification list error:', err);
    res.status(500).json({
      error: 'Unable to load notifications.'
    });
  }
});

app.post('/api/notifications/:notificationId/read', authenticate, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) {
      return res.status(400).json({ error: 'Invalid notification.' });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.notificationId,
        userId: req.user._id
      },
      {
        $set: { read: true }
      },
      {
        new: true
      }
    ).lean();

    if (!notification) {
      return res.status(404).json({
        error: 'Notification not found.'
      });
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      notification: {
        id: String(notification._id),
        read: true
      }
    });
  } catch (err) {
    console.error('Notification read error:', err);
    res.status(500).json({
      error: 'Unable to update notification.'
    });
  }
});

app.post('/api/notifications/read-all', authenticate, async (req, res) => {
  try {
    await Notification.updateMany(
      {
        userId: req.user._id,
        read: false
      },
      {
        $set: { read: true }
      }
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true
    });
  } catch (err) {
    console.error('Notification read-all error:', err);
    res.status(500).json({
      error: 'Unable to update notifications.'
    });
  }
});

/* ---------------------------------------------------------
   404 API fallback
--------------------------------------------------------- */



app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

/* ---------------------------------------------------------
   Start
--------------------------------------------------------- */

const server = httpServer.listen(PORT, () => {
  console.log(`MikiConnect server running on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  server.close(async () => {
    try {
      await mongoose.connection.close();
    } finally {
      process.exit(0);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };
