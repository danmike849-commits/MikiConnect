const fs = require('fs');
const path = require('path');

const paymentPath = './backend/routes/payment.js';
let code = fs.readFileSync(paymentPath, 'utf8');

// Check possible locations for User model relative to backend/routes/
let correctImport = "const User = require('../../models/User');";

if (fs.existsSync(path.join(__dirname, 'models/User.js'))) {
  correctImport = "const User = require('../../models/User');";
} else if (fs.existsSync(path.join(__dirname, 'backend/models/User.js'))) {
  correctImport = "const User = require('../models/User');";
}

// Replace the invalid require statement
code = code.replace(/const User = require\(['"]\.\.\/models\/User['"]\);/, correctImport);

fs.writeFileSync(paymentPath, code);
console.log(`Updated import in payment.js to: ${correctImport}`);
