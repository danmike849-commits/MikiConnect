const fs = require('fs');

const routePath = './backend/routes/payment.js';
let code = `
const express = require('express');
const router = express.Router();
const https = require('https');

router.post('/initialize', (req, res) => {
  const txRef = 'tx-' + Date.now();
  
  const payload = JSON.stringify({
    tx_ref: txRef,
    amount: req.body.amount || 10,
    currency: req.body.currency || 'NGN',
    redirect_url: 'http://127.0.0.1:5000/payment-success.html',
    payment_options: 'card, banktransfer',
    customer: {
      email: req.body.email || 'danmike849@gmail.com',
      name: 'Mika Daniel'
    },
    customizations: {
      title: 'MikiConnect Pro Upgrade',
      description: 'Subscription for MikiConnect Pro features'
    }
  });

  const options = {
    hostname: 'api.flutterwave.com',
    port: 443,
    path: '/v3/payments',
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${process.env.FLW_SECRET_KEY}\`,
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    }
  };

  const flwReq = https.request(options, (flwRes) => {
    let responseData = '';
    flwRes.on('data', chunk => responseData += chunk);
    flwRes.on('end', () => {
      try {
        const parsed = JSON.parse(responseData);
        if (parsed.status === 'success' && parsed.data && parsed.data.link) {
          res.json({ status: 'success', link: parsed.data.link });
        } else {
          res.status(400).json({ status: 'error', message: parsed.message || 'Initialization failed' });
        }
      } catch (e) {
        res.status(500).json({ status: 'error', message: 'Failed to parse payment gateway response' });
      }
    });
  });

  flwReq.on('error', (err) => {
    res.status(500).json({ status: 'error', message: err.message });
  });

  flwReq.write(payload);
  flwReq.end();
});

module.exports = router;
`;

fs.writeFileSync(routePath, code.trim());
console.log('Successfully updated backend payment payload!');
