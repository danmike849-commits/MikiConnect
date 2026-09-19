const fs = require('fs');

let code = fs.readFileSync('backend/routes/payment.js', 'utf8');

// Replace require('../models/User') with mongoose.model('User')
code = code.replace(
  /const User = require\(['"]\.\.\/models\/User['"]\);/,
  "const mongoose = require('mongoose');\nconst User = mongoose.model('User');"
);

fs.writeFileSync('backend/routes/payment.js', code);
console.log('Successfully updated backend/routes/payment.js import.');
