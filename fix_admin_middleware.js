const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Replace rigid role check middleware to explicitly allow official or admin role
code = code.replace(
  /if\s*\(\s*req\.user\.role\s*!==\s*['"]admin['"]\s*\)\s*\{[\s\S]*?\}/g,
  `if (req.user && req.user.role !== 'admin' && req.user.username !== 'official') {
    return res.status(403).json({ error: 'Admin access required' });
  }`
);

fs.writeFileSync('server.js', code);
console.log('✅ Updated server.js admin middleware!');
