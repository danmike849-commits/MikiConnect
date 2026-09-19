const fs = require('fs');

const routePath = './backend/routes/payment.js';
let code = fs.readFileSync(routePath, 'utf8');

// Replace any legacy sandbox domain in the response payload dynamically
if (!code.includes('replace(/checkout-v2\\.dev-flutterwave\\.com/g')) {
  code = code.replace(
    /res\.json\(data\);/g,
    `if (data && data.data && data.data.link) {
      data.data.link = data.data.link.replace(/checkout-v2\\.dev-flutterwave\\.com/g, 'checkout.flutterwave.com');
    }
    res.json(data);`
  );
  fs.writeFileSync(routePath, code);
  console.log('Successfully updated payment.js domain normalizer!');
} else {
  console.log('Domain normalizer already present.');
}
