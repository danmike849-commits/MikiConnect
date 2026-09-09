require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const https = require('https');
const { cleanUsername, validatePassword, isValidUrl } = require('./utils/validation');

const app = express();
const server = http.createServer(app);
const allowedOrigins = String(process.env.CORS_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
const corsOptions = allowedOrigins.length ? { origin: allowedOrigins, credentials: false } : undefined;
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  ...(corsOptions ? { cors: corsOptions } : {})
});

const config = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  nodeEnv: process.env.NODE_ENV || 'development',
  allowFirstAdmin: process.env.ALLOW_FIRST_ACCOUNT_ADMIN === 'true',
  firstAdminEmail: String(process.env.FIRST_ADMIN_EMAIL || '').trim().toLowerCase(),
  appUrl: String(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  emailProvider: String(process.env.EMAIL_PROVIDER || 'resend').toLowerCase(),
  emailFrom: process.env.EMAIL_FROM || '',
  resendApiKey: process.env.RESEND_API_KEY || ''
};

function validateConfig() {
  if (!config.mongoUri) throw new Error('Missing MONGO_URI environment variable.');
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
}

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3, maxlength: 30, match: /^[a-z0-9_-]+$/ },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  avatar: { type: String, default: '', maxlength: 1000 },
  bio: { type: String, default: '', maxlength: 500 },
  following: { type: [String], default: [] },
  followers: { type: [String], default: [] },
  tokenVersion: { type: Number, default: 0 },
  emailVerified: { type: Boolean, default: false },
  emailVerificationTokenHash: { type: String, default: '', select: false },
  emailVerificationExpiresAt: { type: Date, default: null, select: false },
  passwordResetTokenHash: { type: String, default: '', select: false },
  passwordResetExpiresAt: { type: Date, default: null, select: false },
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const CommentSchema = new mongoose.Schema({
  username: { type: String, required: true, maxlength: 30 },
  text: { type: String, required: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const PostSchema = new mongoose.Schema({
  author: { type: String, required: true, index: true, maxlength: 30 },
  content: { type: String, required: true, maxlength: 5000 },
  imageUrl: { type: String, default: '', maxlength: 2000 },
  likes: { type: [String], default: [] },
  comments: { type: [CommentSchema], default: [] },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true, maxlength: 30 },
  recipient: { type: String, default: '', maxlength: 30, index: true },
  text: { type: String, required: true, maxlength: 2000 },
  roomId: { type: String, default: 'public', maxlength: 100, index: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

const NotificationSchema = new mongoose.Schema({
  recipient: { type: String, required: true, index: true, maxlength: 30 },
  type: { type: String, enum: ['follow', 'like', 'comment', 'system'], required: true },
  actor: { type: String, default: '', maxlength: 30 },
  text: { type: String, required: true, maxlength: 500 },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

const ReportSchema = new mongoose.Schema({
  reporter: { type: String, required: true, maxlength: 30, index: true },
  targetType: { type: String, enum: ['user', 'post', 'comment'], required: true },
  targetId: { type: String, required: true, maxlength: 100 },
  reason: { type: String, required: true, maxlength: 1000 },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Message = mongoose.model('Message', MessageSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const Report = mongoose.model('Report', ReportSchema);

function cleanEmail(value) { return String(value || '').trim().toLowerCase(); }
function publicUser(user) {
  return { id: String(user._id), username: user.username, email: user.email, role: user.role, emailVerified: Boolean(user.emailVerified), avatar: user.avatar || '', bio: user.bio || '', followersCount: user.followers?.length || 0, followingCount: user.following?.length || 0, createdAt: user.createdAt };
}
function safePublicUser(user) {
  return { id: String(user._id), username: user.username, avatar: user.avatar || '', bio: user.bio || '', followersCount: user.followers?.length || 0, followingCount: user.following?.length || 0, createdAt: user.createdAt };
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}
function emailConfigured() {
  return config.emailProvider === 'resend' && Boolean(config.resendApiKey) && Boolean(config.emailFrom);
}
function sendResendEmail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    if (!emailConfigured()) return reject(new Error('Transactional email is not configured.'));
    const text = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const payload = JSON.stringify({ from: config.emailFrom, to: [to], subject, html, text });
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 10000
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(body);
        reject(new Error(`Email provider returned ${res.statusCode}.`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Email provider timeout.')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}
function sendEmail({ to, subject, html }) {
  if (config.emailProvider === 'resend') return sendResendEmail({ to, subject, html });
  return Promise.reject(new Error(`Unsupported email provider: ${config.emailProvider}`));
}
function verificationUrl(token) { return `${config.appUrl}/verify.html?token=${encodeURIComponent(token)}`; }
function resetUrl(token) { return `${config.appUrl}/reset-password.html?token=${encodeURIComponent(token)}`; }
async function issueVerificationEmail(user) {
  const token = makeToken();
  await User.updateOne({ _id: user._id }, { $set: { emailVerificationTokenHash: hashToken(token), emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  try {
    const url = verificationUrl(token);
    await sendEmail({ to: user.email, subject: 'Verify your MikiConnect email', html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>Welcome to MikiConnect</h2><p>Hello @${user.username},</p><p>Please verify your email address to activate your MikiConnect account.</p><p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#4f7cff;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Verify my email</a></p><p>If the button does not work, copy and paste this link into your browser:</p><p style="word-break:break-all">${url}</p><p>This verification link expires in 24 hours and can only be used once.</p><p>If you did not create this account, you can ignore this email.</p></body></html>` });
  } catch (err) {
    await User.updateOne({ _id: user._id }, { $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 } });
    throw err;
  }
}
async function issuePasswordResetEmail(user) {
  const token = makeToken();
  await User.updateOne({ _id: user._id }, { $set: { passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  try {
    await sendEmail({ to: user.email, subject: 'Reset your MikiConnect password', html: `<p>Hello @${user.username},</p><p>A password reset was requested for your MikiConnect account.</p><p><a href="${resetUrl(token)}">Reset my password</a></p><p>This link expires in 1 hour and can only be used once.</p><p>If you did not request this, you can safely ignore this email.</p>` });
  } catch (err) {
    await User.updateOne({ _id: user._id }, { $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } });
    throw err;
  }
}

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, username: user.username, tv: user.tokenVersion ?? 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, issuer: 'mikiconnect', audience: 'mikiconnect-client' });
}
function extractToken(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}
async function getUserFromToken(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, config.jwtSecret, { issuer: 'mikiconnect', audience: 'mikiconnect-client' });
  const user = await User.findById(decoded.sub).lean();
  if (!user || user.isBanned || (decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) return null;
  return user;
}
async function authenticate(req, res, next) {
  try {
    const user = await getUserFromToken(extractToken(req));
    if (!user) return res.status(401).json({ error: 'Authentication required or account unavailable.' });
    req.user = user;
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired token.' }); }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

// Basic in-memory rate limiting for the current single-instance deployment.
// Before scaling to multiple instances, replace this with a shared store (for example Redis).
const buckets = new Map();
const MAX_RATE_BUCKETS = 20000;
function rateLimit({ windowMs, max, key = req => `${req.ip}:${req.path}` }) {
  return (req, res, next) => {
    const now = Date.now();
    const k = String(key(req));
    let current = buckets.get(k);
    if (!current || current.reset <= now) {
      current = { count: 1, reset: now + windowMs };
      if (buckets.size >= MAX_RATE_BUCKETS) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.reset <= now) buckets.delete(bucketKey);
          if (buckets.size < MAX_RATE_BUCKETS) break;
        }
      }
      if (buckets.size >= MAX_RATE_BUCKETS) return res.status(503).json({ error: 'Rate limiting capacity is temporarily unavailable. Please try again later.' });
      buckets.set(k, current);
    } else {
      current.count += 1;
    }
    const entry = buckets.get(k) || current;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - entry.count));
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
}, 30000).unref();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (config.nodeEnv === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
if (corsOptions) app.use(cors({ ...corsOptions, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

app.get('/health', (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({ status: dbReady ? 'ok' : 'degraded', service: 'MikiConnect', database: dbReady ? 'connected' : 'disconnected', uptime: Math.round(process.uptime()) });
});

app.post('/api/register', rateLimit({ windowMs: 15*60*1000, max: 10 }), asyncRoute(async (req, res) => {
  const username = cleanUsername(req.body.username);
  const email = cleanEmail(req.body.email);
  const password = req.body.password;
  const avatar = String(req.body.avatar || '').trim();
  if (!/^[a-z0-9_-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-30 characters: letters, numbers, underscores or hyphens.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 8-128 characters.' });
  if (!isValidUrl(avatar)) return res.status(400).json({ error: 'Avatar must be an http(s) URL.' });
  const [usernameExists, emailExists] = await Promise.all([User.exists({ username }), User.exists({ email })]);
  if (usernameExists || emailExists) return res.status(409).json({ error: 'Username or email is already in use.' });
  const firstAccount = (await User.countDocuments()) === 0;
  const role = firstAccount && config.allowFirstAdmin && (!config.firstAdminEmail || email === config.firstAdminEmail) ? 'admin' : 'user';
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ username, email, password: passwordHash, avatar, role, emailVerified: false });
  try {
    await issueVerificationEmail(user);
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    console.error('Verification email error:', err.message);
    return res.status(503).json({ error: 'We could not send the verification email, so the account was not created. Please try again later or contact support.' });
  }
  res.status(201).json({ success: true, requiresEmailVerification: true, message: 'Account created. Check your email to verify your account before logging in.' });
}));

app.post('/api/login', rateLimit({ windowMs: 15*60*1000, max: 20, key: req => `${req.ip}:login` }), asyncRoute(async (req, res) => {
  const identifier = cleanUsername(req.body.username || req.body.identifier);
  const password = req.body.password;
  if (!identifier || !validatePassword(password)) return res.status(400).json({ error: 'Username and password are required.' });
  const user = await User.findOne({ $or: [{ username: identifier }, { email: cleanEmail(identifier) }] }).select('+password');
  if (!user || user.isBanned) return res.status(401).json({ error: 'Invalid credentials.' });
  if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials.' });
  if (!user.emailVerified) return res.status(403).json({ error: 'Your email is not verified yet. Check your inbox or spam folder for the MikiConnect verification email, then click the Verify my email button. You can also use Resend verification email below.' });
  res.json({ success: true, token: signToken(user), user: publicUser(user) });
}));

app.post('/api/verify-email', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), asyncRoute(async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Invalid or expired verification link.' });
  const user = await User.findOne({ emailVerificationTokenHash: hashToken(token), emailVerificationExpiresAt: { $gt: new Date() } }).select('+emailVerificationTokenHash +emailVerificationExpiresAt');
  if (!user) return res.status(400).json({ error: 'Invalid or expired verification link.' });
  user.emailVerified = true;
  user.emailVerificationTokenHash = '';
  user.emailVerificationExpiresAt = null;
  await user.save();
  res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
}));

app.post('/api/resend-verification', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, key: req => `${req.ip}:resend-verification` }), asyncRoute(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!email || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  const user = await User.findOne({ email }).lean();
  if (user && !user.emailVerified) {
    try { await issueVerificationEmail(user); } catch (err) { console.error('Verification resend error:', err.message); }
  }
  res.json({ success: true, message: 'If that account exists and needs verification, a verification email has been sent.' });
}));

app.post('/api/forgot-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, key: req => `${req.ip}:forgot-password` }), asyncRoute(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!email || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  const user = await User.findOne({ email }).lean();
  if (user && !user.isBanned && user.emailVerified) {
    try { await issuePasswordResetEmail(user); } catch (err) { console.error('Password reset email error:', err.message); }
  }
  res.json({ success: true, message: 'If an account exists for that email, a password reset link has been sent.' });
}));

app.post('/api/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: req => `${req.ip}:reset-password` }), asyncRoute(async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = req.body.password;
  if (!/^[a-f0-9]{64}$/.test(token) || !validatePassword(password)) return res.status(400).json({ error: 'Invalid reset request or password.' });
  const user = await User.findOne({ passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: { $gt: new Date() } }).select('+passwordResetTokenHash +passwordResetExpiresAt');
  if (!user || user.isBanned || !user.emailVerified) return res.status(400).json({ error: 'Invalid or expired reset link.' });
  user.password = await bcrypt.hash(password, 12);
  user.passwordResetTokenHash = '';
  user.passwordResetExpiresAt = null;
  user.tokenVersion += 1;
  await user.save();
  res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
}));

app.get('/api/me', authenticate, (req, res) => res.json({ success: true, user: publicUser(req.user) }));
app.patch('/api/me', authenticate, asyncRoute(async (req, res) => {
  const updates = {};
  if (req.body.bio !== undefined) { const bio = String(req.body.bio).trim(); if (bio.length > 500) return res.status(400).json({ error: 'Bio must be 500 characters or less.' }); updates.bio = bio; }
  if (req.body.avatar !== undefined) { const avatar = String(req.body.avatar).trim(); if (!isValidUrl(avatar)) return res.status(400).json({ error: 'Avatar must be an http(s) URL.' }); updates.avatar = avatar; }
  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true }).lean();
  res.json({ success: true, user: publicUser(user) });
}));


app.post('/api/me/password', authenticate, rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), asyncRoute(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (!validatePassword(currentPassword) || !validatePassword(newPassword)) return res.status(400).json({ error: 'Passwords must be 8-128 characters.' });
  const user = await User.findById(req.user._id).select('+password');
  if (!user || !(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ error: 'Current password is incorrect.' });
  if (currentPassword === newPassword) return res.status(400).json({ error: 'New password must be different.' });
  user.password = await bcrypt.hash(newPassword, 12);
  user.tokenVersion += 1;
  await user.save();
  res.json({ success: true, message: 'Password changed. Please sign in again.' });
}));

app.post('/api/users/:username/follow', authenticate, rateLimit({ windowMs: 60 * 1000, max: 60, key: req => `${req.ip}:follow:${req.user?._id || 'anon'}` }), asyncRoute(async (req, res) => {
  const target = cleanUsername(req.params.username);
  if (!target || target === req.user.username) return res.status(400).json({ error: 'Invalid user.' });
  const other = await User.findOne({ username: target, isBanned: false });
  if (!other) return res.status(404).json({ error: 'User not found.' });
  const meUser = await User.findById(req.user._id);
  const following = meUser.following.includes(target);
  if (following) {
    meUser.following.pull(target); other.followers.pull(meUser.username);
  } else {
    meUser.following.addToSet(target); other.followers.addToSet(meUser.username);
    await Notification.create({ recipient: target, type: 'follow', actor: meUser.username, text: `@${meUser.username} followed you.` });
  }
  await Promise.all([meUser.save(), other.save()]);
  res.json({ success: true, following: !following, followersCount: other.followers.length, followingCount: meUser.following.length });
}));

app.get('/api/users/:username/followers', rateLimit({ windowMs: 60 * 1000, max: 60 }), asyncRoute(async (req, res) => {
  const user = await User.findOne({ username: cleanUsername(req.params.username), isBanned: false }).lean();
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const users = await User.find({ username: { $in: user.followers }, isBanned: false }, 'username bio avatar createdAt').limit(500).lean();
  res.json({ success: true, users: users.map(safePublicUser) });
}));
app.get('/api/users/:username/following', rateLimit({ windowMs: 60 * 1000, max: 60 }), asyncRoute(async (req, res) => {
  const user = await User.findOne({ username: cleanUsername(req.params.username), isBanned: false }).lean();
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const users = await User.find({ username: { $in: user.following }, isBanned: false }, 'username bio avatar createdAt').limit(500).lean();
  res.json({ success: true, users: users.map(safePublicUser) });
}));

app.get('/api/notifications', authenticate, asyncRoute(async (req, res) => {
  const notifications = await Notification.find({ recipient: req.user.username }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, notifications, unread: notifications.filter(n => !n.read).length });
}));
app.post('/api/notifications/read', authenticate, asyncRoute(async (req, res) => {
  await Notification.updateMany({ recipient: req.user.username, read: false }, { $set: { read: true } });
  res.json({ success: true });
}));

app.post('/api/reports', authenticate, rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: req => `${req.ip}:reports:${req.user?._id || 'anon'}` }), asyncRoute(async (req, res) => {
  const targetType = String(req.body.targetType || '');
  const targetId = String(req.body.targetId || '').trim();
  const reason = String(req.body.reason || '').trim();
  if (!['user', 'post', 'comment'].includes(targetType) || !targetId || reason.length < 3 || reason.length > 500) return res.status(400).json({ error: 'Valid target type, target id, and reason are required.' });
  if (targetType === 'user') {
    const target = await User.exists({ username: cleanUsername(targetId), isBanned: false });
    if (!target) return res.status(404).json({ error: 'Reported user not found.' });
  } else if (targetType === 'post') {
    if (!mongoose.isValidObjectId(targetId) || !(await Post.exists({ _id: targetId }))) return res.status(404).json({ error: 'Reported post not found.' });
  } else {
    if (!mongoose.isValidObjectId(targetId) || !(await Post.exists({ 'comments._id': targetId }))) return res.status(404).json({ error: 'Reported comment not found.' });
  }
  const existing = await Report.exists({ reporter: req.user.username, targetType, targetId, status: 'open' });
  if (existing) return res.status(409).json({ error: 'You already have an open report for this item.' });
  const report = await Report.create({ reporter: req.user.username, targetType, targetId, reason });
  res.status(201).json({ success: true, reportId: String(report._id) });
}));

app.get('/api/users', rateLimit({ windowMs: 60 * 1000, max: 60 }), asyncRoute(async (req, res) => {
  const q = cleanUsername(req.query.q || '');
  const filter = { isBanned: false };
  if (q) filter.username = { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' };
  const users = await User.find(filter, 'username bio avatar createdAt').sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, users: users.map(safePublicUser) });
}));

app.get('/api/users/:username', rateLimit({ windowMs: 60 * 1000, max: 60 }), asyncRoute(async (req, res) => {
  const user = await User.findOne({ username: cleanUsername(req.params.username), isBanned: false }).lean();
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const posts = await Post.find({ author: user.username }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ success: true, user: safePublicUser(user), posts });
}));

app.get('/api/posts', rateLimit({ windowMs: 60 * 1000, max: 60 }), asyncRoute(async (req, res) => {
  const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
  const rows = await Post.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const posts = hasMore ? rows.slice(0, limit) : rows;
  res.json({ success: true, page, limit, posts, hasMore });
}));

app.post('/api/posts', authenticate, rateLimit({ windowMs: 60 * 1000, max: 20, key: req => `${req.ip}:posts:${req.user?._id || 'anon'}` }), asyncRoute(async (req, res) => {
  const content = String(req.body.content || '').trim();
  const imageUrl = String(req.body.imageUrl || '').trim();
  if (!content || content.length > 5000) return res.status(400).json({ error: 'Post content must be 1-5000 characters.' });
  if (!isValidUrl(imageUrl)) return res.status(400).json({ error: 'Image URL must be http(s).' });
  const post = await Post.create({ author: req.user.username, content, imageUrl });
  io.emit('postCreated', post.toObject());
  res.status(201).json({ success: true, post });
}));

app.post('/api/posts/:id/like', authenticate, rateLimit({ windowMs: 60 * 1000, max: 60, key: req => `${req.ip}:likes:${req.user?._id || 'anon'}` }), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid post id.' });
  const post = await Post.findById(req.params.id).lean();
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const liked = post.likes.includes(req.user.username);
  const updated = await Post.findByIdAndUpdate(
    req.params.id,
    liked ? { $pull: { likes: req.user.username } } : { $addToSet: { likes: req.user.username } },
    { new: true, runValidators: true }
  ).lean();
  io.emit('postUpdated', updated);
  if (!liked && updated.author !== req.user.username) await Notification.create({ recipient: updated.author, type: 'like', actor: req.user.username, text: `@${req.user.username} liked your post.` });
  res.json({ success: true, liked: !liked, likes: updated.likes.length });
}));

app.post('/api/posts/:id/comment', authenticate, rateLimit({ windowMs: 60 * 1000, max: 30, key: req => `${req.ip}:comments:${req.user?._id || 'anon'}` }), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid post id.' });
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Comment must be 1-1000 characters.' });
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  post.comments.push({ username: req.user.username, text });
  await post.save();
  io.emit('postUpdated', post.toObject());
  if (post.author !== req.user.username) await Notification.create({ recipient: post.author, type: 'comment', actor: req.user.username, text: `@${req.user.username} commented on your post.` });
  res.status(201).json({ success: true, comment: post.comments[post.comments.length - 1] });
}));

app.delete('/api/posts/:id', authenticate, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid post id.' });
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.author !== req.user.username && req.user.role !== 'admin') return res.status(403).json({ error: 'You cannot delete this post.' });
  await post.deleteOne();
  io.emit('postDeleted', { id: req.params.id });
  res.json({ success: true });
}));

app.get('/api/messages/public', authenticate, rateLimit({ windowMs: 60 * 1000, max: 60, key: req => `${req.ip}:public-messages:${req.user?._id || 'anon'}` }), asyncRoute(async (req, res) => {
  const messages = await Message.find({ roomId: 'public', recipient: '' }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, messages: messages.reverse() });
}));
app.get('/api/messages/dm/:username', authenticate, rateLimit({ windowMs: 60 * 1000, max: 60, key: req => `${req.ip}:dm-history:${req.user?._id || 'anon'}` }), asyncRoute(async (req, res) => {
  const other = cleanUsername(req.params.username);
  if (!other || other === req.user.username) return res.status(400).json({ error: 'Invalid recipient.' });
  const messages = await Message.find({ recipient: { $in: [req.user.username, other] }, sender: { $in: [req.user.username, other] }, roomId: { $ne: 'public' } }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, messages: messages.reverse() });
}));

app.get('/api/admin/stats', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const [totalUsers, totalPosts, totalMessages, bannedUsers] = await Promise.all([User.countDocuments(), Post.countDocuments(), Message.countDocuments(), User.countDocuments({ isBanned: true })]);
  res.json({ success: true, totalUsers, totalPosts, totalMessages, bannedUsers, activeSockets: io.engine.clientsCount });
}));
app.get('/api/admin/users', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const users = await User.find({}, 'username email role isBanned avatar bio createdAt').sort({ createdAt: -1 }).limit(500).lean();
  res.json({ success: true, users });
}));
app.put('/api/admin/users/ban', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const username = cleanUsername(req.body.username);
  if (!username || typeof req.body.isBanned !== 'boolean') return res.status(400).json({ error: 'username and boolean isBanned are required.' });
  if (username === req.user.username) return res.status(400).json({ error: 'You cannot change your own ban status.' });
  const result = await User.updateOne({ username }, { $set: { isBanned: req.body.isBanned } });
  if (!result.matchedCount) return res.status(404).json({ error: 'User not found.' });
  if (req.body.isBanned) disconnectUserSockets(username);
  res.json({ success: true });
}));
app.put('/api/admin/users/role', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const username = cleanUsername(req.body.username); const role = req.body.role;
  if (!username || !['user','admin'].includes(role)) return res.status(400).json({ error: 'Valid username and role are required.' });
  if (username === req.user.username && role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own admin role.' });
  const result = await User.updateOne({ username }, { $set: { role } });
  if (!result.matchedCount) return res.status(404).json({ error: 'User not found.' });
  res.json({ success: true });
}));
app.delete('/api/admin/users/:username', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const username = cleanUsername(req.params.username);
  if (username === req.user.username) return res.status(400).json({ error: 'You cannot delete yourself.' });
  const result = await User.deleteOne({ username });
  if (!result.deletedCount) return res.status(404).json({ error: 'User not found.' });
  await Post.deleteMany({ author: username });
  await Message.deleteMany({ $or: [{ sender: username }, { recipient: username }] });
  disconnectUserSockets(username);
  res.json({ success: true });
}));

app.get('/api/admin/reports', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const reports = await Report.find({ status }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, reports });
}));
app.put('/api/admin/reports/:id', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid report id.' });
  const status = String(req.body.status || '');
  if (!['open', 'resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const report = await Report.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true }).lean();
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  res.json({ success: true, report });
}));

app.get('/api/admin/messages', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const messages = await Message.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, messages });
}));
app.delete('/api/admin/messages/:id', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid message id.' });
  const result = await Message.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).json({ error: 'Message not found.' });
  res.json({ success: true });
}));
app.post('/api/admin/broadcast', authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message || message.length > 2000) return res.status(400).json({ error: 'Message must be 1-2000 characters.' });
  io.emit('systemAnnouncement', { text: message, sender: 'SYSTEM', id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  res.json({ success: true });
}));

function disconnectUserSockets(username) {
  const room = io.sockets.adapter.rooms.get(`user:${username}`);
  if (!room) return;
  for (const socketId of room) io.sockets.sockets.get(socketId)?.disconnect(true);
}

const socketConnectionBuckets = new Map();
const MAX_SOCKET_CONNECTION_BUCKETS = 10000;
function allowSocketConnection(ip) {
  const now = Date.now();
  let entry = socketConnectionBuckets.get(ip);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + 5 * 60 * 1000 };
    if (socketConnectionBuckets.size >= MAX_SOCKET_CONNECTION_BUCKETS) {
      for (const [key, value] of socketConnectionBuckets) {
        if (value.reset <= now) socketConnectionBuckets.delete(key);
        if (socketConnectionBuckets.size < MAX_SOCKET_CONNECTION_BUCKETS) break;
      }
    }
    if (socketConnectionBuckets.size < MAX_SOCKET_CONNECTION_BUCKETS) socketConnectionBuckets.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= 30;
}

io.use(async (socket, next) => {
  try {
    const ip = String(socket.handshake.address || 'unknown');
    if (!allowSocketConnection(ip)) return next(new Error('Too many connection attempts. Please try again later.'));
    const user = await getUserFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('Authentication required or account unavailable.'));
    const room = io.sockets.adapter.rooms.get(`user:${user.username}`);
    if (room && room.size >= 5) return next(new Error('Too many active sessions for this account.'));
    socket.user = user;
    next();
  } catch { next(new Error('Invalid or expired token.')); }
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of socketConnectionBuckets) if (v.reset <= now) socketConnectionBuckets.delete(k);
}, 60000).unref();

io.on('connection', socket => {
  socket.join(`user:${socket.user.username}`);
  socket.emit('ready', { username: socket.user.username });
  let socketMessages = 0;
  let socketWindow = Date.now() + 10000;
  const allowSocketMessage = () => { const now = Date.now(); if (now >= socketWindow) { socketMessages = 0; socketWindow = now + 10000; } if (++socketMessages > 20) return false; return true; };

  socket.on('sendPublicMessage', async (data, callback) => {
    try {
      if (!allowSocketMessage()) return callback?.({ success: false, error: 'Too many messages. Please slow down.' });
      const text = String(data?.content || data?.text || '').trim();
      if (!text || text.length > 2000) return callback?.({ success: false, error: 'Message must be 1-2000 characters.' });
      const msg = await Message.create({ sender: socket.user.username, text, recipient: '', roomId: 'public' });
      io.emit('receivePublicMessage', { id: String(msg._id), sender: msg.sender, content: msg.text, createdAt: msg.createdAt });
      callback?.({ success: true, messageId: String(msg._id) });
    } catch (e) { console.error('Public message error:', e); callback?.({ success: false, error: 'Message could not be sent.' }); }
  });

  socket.on('sendPrivateMessage', async (data, callback) => {
    try {
      if (!allowSocketMessage()) return callback?.({ success: false, error: 'Too many messages. Please slow down.' });
      const recipient = cleanUsername(data?.recipient);
      const text = String(data?.content || data?.text || '').trim();
      if (!/^[a-z0-9_-]{3,30}$/.test(recipient) || recipient === socket.user.username) return callback?.({ success: false, error: 'Invalid recipient.' });
      if (!text || text.length > 2000) return callback?.({ success: false, error: 'Message must be 1-2000 characters.' });
      const exists = await User.exists({ username: recipient, isBanned: false });
      if (!exists) return callback?.({ success: false, error: 'Recipient not found.' });
      const roomId = [socket.user.username, recipient].sort().join(':');
      const msg = await Message.create({ sender: socket.user.username, recipient, text, roomId });
      const payload = { id: String(msg._id), sender: msg.sender, recipient: msg.recipient, content: msg.text, createdAt: msg.createdAt };
      io.to(`user:${socket.user.username}`).to(`user:${recipient}`).emit('receivePrivateMessage', payload);
      callback?.({ success: true, messageId: String(msg._id) });
    } catch (e) { console.error('DM error:', e); callback?.({ success: false, error: 'Message could not be sent.' }); }
  });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((req, res, next) => { if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' }); next(); });
app.use((err, req, res, next) => { console.error('Unhandled error:', err); if (res.headersSent) return next(err); res.status(err.name === 'ValidationError' ? 400 : 500).json({ error: err.name === 'ValidationError' ? 'Invalid request data.' : 'Internal server error.' }); });

async function start() {
  validateConfig();
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB connected.');
  return new Promise(resolve => server.listen(config.port, '0.0.0.0', () => { console.log(`MikiConnect listening on ${config.port}`); resolve(); }));
}
async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  await mongoose.connection.close().catch(() => {});
  await new Promise(resolve => server.close(() => resolve()));
  process.exit(0);
}
module.exports = { app, server, io, User, Post, Message, Notification, Report, signToken, cleanUsername, validatePassword, isValidUrl, safePublicUser, config, start, shutdown };
