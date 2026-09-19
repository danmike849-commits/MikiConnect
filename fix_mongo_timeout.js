const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

// Increase serverSelectionTimeoutMS to 30s
code = code.replace(/serverSelectionTimeoutMS:\s*10000/, 'serverSelectionTimeoutMS: 30000');

fs.writeFileSync('app.js', code);
console.log('Updated app.js MongoDB connection timeout to 30000ms.');
