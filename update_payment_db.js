const fs = require('fs');

const routePath = './backend/routes/payment.js';
let code = fs.readFileSync(routePath, 'utf8');

// Ensure User model import exists at the top
if (!code.includes("require('../models/User')")) {
  code = "const User = require('../models/User');\n" + code;
}

// Helper block to update user plan
const dbUpdateLogic = `
    // Update database record for user
    if (customer && customer.email) {
      await User.findOneAndUpdate(
        { email: customer.email },
        { plan: 'Pro', isPro: true },
        { new: true }
      );
      console.log(\`[DB] Successfully upgraded user \${customer.email} to Pro plan.\`);
    }
`;

// Inject DB update into verification route
if (code.includes("message: 'Payment verified successfully'") && !code.includes("[DB] Successfully upgraded")) {
  code = code.replace(
    "tx_ref: data.data.tx_ref\n      });",
    `tx_ref: data.data.tx_ref\n      });\n${dbUpdateLogic}`
  );
}

// Inject DB update into webhook route
if (code.includes("Webhook payment confirmed for") && !code.includes("await User.findOneAndUpdate")) {
  code = code.replace(
    "// TODO: Update user model in MongoDB based on payload.data.customer.email or tx_ref",
    `await User.findOneAndUpdate({ email: customer.email }, { plan: 'Pro', isPro: true });\n    console.log(\`[DB] Webhook updated \${customer.email} to Pro plan.\`);`
  );
}

fs.writeFileSync(routePath, code);
console.log('Successfully added MongoDB User model updates to payment handlers!');
