const express = require('express');
const router = express.Router();
const https = require('https');
const mongoose = require('mongoose');

// Safe Mongoose model access to prevent OverwriteModelError
const getUserModel = () => {
  if (mongoose.models && mongoose.models.User) {
    return mongoose.models.User;
  }
  const userSchema = new mongoose.Schema({}, { strict: false });
  return mongoose.model('User', userSchema, 'users');
};

// 1. Payment Initialization Route
router.post('/initialize', (req, res) => {
  const payload = JSON.stringify({
    tx_ref: "tx-" + Date.now(),
    amount: req.body.amount || 10,
    currency: "NGN",
    redirect_url: "http://127.0.0.1:5000/payment-success.html",
    payment_options: "card, banktransfer",
    customer: {
      email: req.body.email || "danmike849@gmail.com",
      name: "Mika Daniel"
    },
    customizations: {
      title: "MikiConnect Pro Upgrade",
      description: "Subscription upgrade for MikiConnect"
    }
  });

  const options = {
    hostname: 'api.flutterwave.com',
    port: 443,
    path: '/v3/payments',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`,
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
        res.status(500).json({ status: 'error', message: 'Failed to parse gateway response' });
      }
    });
  });

  flwReq.on('error', (err) => {
    res.status(500).json({ status: 'error', message: err.message });
  });

  flwReq.write(payload);
  flwReq.end();
});

// 2. Flutterwave Webhook Listener Endpoint
router.post('/webhook', async (req, res) => {
  const secretHash = process.env.FLW_SECRET_HASH || "MikiConnectSecretHash2026";
  const signature = req.headers['verif-hash'];

  if (!signature || signature !== secretHash) {
    return res.status(401).end();
  }

  const payload = req.body;

  if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
    const customerEmail = payload.data.customer.email;

    try {
      const User = getUserModel();
      await User.findOneAndUpdate(
        { $or: [{ email: customerEmail }, { username: "admin" }] },
        { $set: { isPro: true } },
        { new: true }
      );

      console.log(`\n[WEBHOOK SUCCESS] User ${customerEmail} upgraded to Pro.`);
    } catch (err) {
      console.error('[WEBHOOK ERROR] Database update failed:', err.message);
    }
  }

  res.status(200).end();
});

module.exports = router;
