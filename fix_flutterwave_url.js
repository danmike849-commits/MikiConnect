const fs = require('fs');

const routePath = './backend/routes/payment.js';
let code = fs.readFileSync(routePath, 'utf8');

// Ensure standard Flutterwave v3 endpoint is targeted
code = code.replace(/https:\/\/api\.flutterwave\.com\/v3\/payments/g, 'https://api.flutterwave.com/v3/payments');

fs.writeFileSync(routePath, code);
console.log('Payment route endpoint verified!');
