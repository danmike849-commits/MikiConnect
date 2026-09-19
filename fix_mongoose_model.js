const fs = require('fs');

const paymentPath = './backend/routes/payment.js';
let code = fs.readFileSync(paymentPath, 'utf8');

// Replace file-based require with Mongoose model getter
code = code.replace(/const User = require\(['"][^'"]+['"]\);/g, '');

// Ensure mongoose is required
if (!code.includes("const mongoose = require('mongoose');")) {
  code = "const mongoose = require('mongoose');\n" + code;
}

// Ensure User getter function is used before queries
const userGetter = `
const getUserModel = () => {
  try {
    return mongoose.model('User');
  } catch (e) {
    const UserSchema = new mongoose.Schema({}, { strict: false });
    return mongoose.model('User', UserSchema);
  }
};
`;

if (!code.includes('getUserModel')) {
  code = userGetter + code;
}

// Replace direct User usage with getUserModel()
code = code.replace(/User\.findOneAndUpdate/g, 'getUserModel().findOneAndUpdate');

fs.writeFileSync(paymentPath, code);
console.log('Successfully updated payment.js to retrieve Mongoose User model safely!');
