const fs = require('fs');

const routePath = './backend/routes/payment.js';
let code = fs.readFileSync(routePath, 'utf8');

const webhookRouteCode = `
// POST /api/payments/webhook
router.post('/webhook', async (req, res) => {
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = req.headers['verif-hash'];

  // Validate request signature if FLW_SECRET_HASH is configured
  if (secretHash && signature !== secretHash) {
    return res.status(401).end();
  }

  const payload = req.body;

  if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
    const { tx_ref, amount, customer } = payload.data;
    console.log(\`Webhook payment confirmed for \${customer.email} (Ref: \${tx_ref}, Amount: \${amount})\`);
    
    // TODO: Update user model in MongoDB based on payload.data.customer.email or tx_ref
  }

  // Acknowledge receipt to Flutterwave
  res.status(200).end();
});
`;

if (!code.includes("router.post('/webhook'")) {
  code = code.replace("module.exports =", webhookRouteCode + "\nmodule.exports =");
  fs.writeFileSync(routePath, code);
  console.log('Successfully added /webhook route to payment.js!');
} else {
  console.log('/webhook route is already present.');
}
