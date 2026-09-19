[1mdiff --git a/app.js b/app.js[m
[1mindex 2fc57b0..692b204 100644[m
[1m--- a/app.js[m
[1m+++ b/app.js[m
[36m@@ -357,13 +357,32 @@[m [mapp.post('/api/register', rateLimit({ windowMs: 15*60*1000, max: 10 }), asyncRou[m
 }));[m
 [m
 app.post('/api/login', rateLimit({ windowMs: 15*60*1000, max: 20, key: req => `${req.ip}:login` }), asyncRoute(async (req, res) => {[m
[31m-  const identifier = cleanUsername(req.body.username || req.body.identifier);[m
[32m+[m[32m  const rawIdentifier = String(req.body.username || req.body.identifier || '').trim();[m
   const password = req.body.password;[m
[31m-  if (!identifier || !validatePassword(password)) return res.status(400).json({ error: 'Username and password are required.' });[m
[31m-  const user = await User.findOne({ $or: [{ username: identifier }, { email: cleanEmail(identifier) }] }).select('+password');[m
[31m-  if (!user || user.isBanned) return res.status(401).json({ error: 'Invalid credentials.' });[m
[31m-  if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials.' });[m
[31m-  if (!user.emailVerified) return res.status(403).json({ error: 'Your email is not verified yet. Check your inbox or spam folder for the MikiConnect verification email, then click the Verify my email button. You can also use Resend verification email below.' });[m
[32m+[m
[32m+[m[32m  if (!rawIdentifier || !validatePassword(password)) {[m
[32m+[m[32m    return res.status(400).json({ error: 'Username and password are required.' });[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  const isEmailLogin = rawIdentifier.includes('@');[m
[32m+[m[32m  const lookup = isEmailLogin[m
[32m+[m[32m    ? { email: cleanEmail(rawIdentifier) }[m
[32m+[m[32m    : { username: cleanUsername(rawIdentifier) };[m
[32m+[m
[32m+[m[32m  const user = await User.findOne(lookup).select('+password');[m
[32m+[m
[32m+[m[32m  if (!user || user.isBanned) {[m
[32m+[m[32m    return res.status(401).json({ error: 'Invalid credentials.' });[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  if (!user.password || !(await bcrypt.compare(password, user.password))) {[m
[32m+[m[32m    return res.status(401).json({ error: 'Invalid credentials.' });[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  if (!user.emailVerified) {[m
[32m+[m[32m    return res.status(403).json({ error: 'Your email is not verified yet. Check your inbox or spam folder for the MikiConnect verification email, then click the Verify my email button. You can also use Resend verification email below.' });[m
[32m+[m[32m  }[m
[32m+[m
   setSessionCookie(res, signToken(user));[m
   res.json({ success: true, user: publicUser(user) });[m
 }));[m
