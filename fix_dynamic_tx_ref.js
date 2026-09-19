const fs = require('fs');

const routePath = './backend/routes/payment.js';
let code = fs.readFileSync(routePath, 'utf8');

// Ensure tx_ref dynamically appends Date.now()
code = code.replace(/tx_ref:\s*['"][^'"]+['"]/g, 'tx_ref: `tx-${Date.now()}`');

fs.writeFileSync(routePath, code);
console.log('Updated payment.js to generate unique transaction references!');
