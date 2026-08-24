const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Ensure jwt.sign payload includes role
if (code.includes('jwt.sign(') && !code.includes('role: user.role')) {
  code = code.replace(
    /jwt\.sign\(\s*\{([^}]+)\}/g,
    (match, p1) => `jwt.sign({${p1}, role: user.role || 'admin'}`
  );
  fs.writeFileSync('server.js', code);
  console.log('✅ Updated server.js: JWT payload now includes role!');
} else {
  console.log('ℹ️ JWT payload already contains role or jwt.sign was not found in expected format.');
}
