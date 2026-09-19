const fs = require('fs');

let code = fs.readFileSync('backend/routes/payment.js', 'utf8');

// Remove global model access at the top of the file
code = code.replace(/const User = mongoose\.model\('User'\);?\n?/, '');

// Dynamically reference mongoose.model('User') inside route calls if not already inline
if (!code.includes("mongoose.model('User')")) {
  code = code.replace(/\bUser\b/g, "mongoose.model('User')");
}

fs.writeFileSync('backend/routes/payment.js', code);
console.log('Updated payment.js to lazy-load User model.');
