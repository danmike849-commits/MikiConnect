const fs = require('fs');

const routePath = './backend/routes/payment.js';
let code = fs.readFileSync(routePath, 'utf8');

const verifyRouteCode = `
// GET /api/payments/verify?transaction_id=12345
router.get('/verify', async (req, res) => {
  const { transaction_id } = req.query;

  if (!transaction_id) {
    return res.status(400).json({ status: 'error', message: 'Transaction ID is required' });
  }

  try {
    const response = await fetch(\`https://api.flutterwave.com/v3/transactions/\${transaction_id}/verify\`, {
      method: 'GET',
      headers: {
        'Authorization': \`Bearer \${process.env.FLW_SECRET_KEY}\`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.status === 'success' && data.data.status === 'successful') {
      // Payment confirmed! Update user status/plan here
      return res.json({
        status: 'success',
        message: 'Payment verified successfully',
        amount: data.data.amount,
        currency: data.data.currency,
        tx_ref: data.data.tx_ref
      });
    } else {
      return res.status(400).json({ status: 'error', message: 'Payment verification failed or unconfirmed' });
    }
  } catch (err) {
    console.error('Verification error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error during verification' });
  }
});
`;

if (!code.includes("router.get('/verify'")) {
  // Inject before module.exports
  code = code.replace("module.exports =", verifyRouteCode + "\nmodule.exports =");
  fs.writeFileSync(routePath, code);
  console.log('Successfully added /verify route to payment.js!');
} else {
  console.log('/verify route is already present.');
}
