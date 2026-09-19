const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

if (!code.includes('subscriptionTier')) {
  code = code.replace(
    /const UserSchema = new mongoose\.Schema\(\{/,
    `const UserSchema = new mongoose.Schema({\n  subscriptionTier: { type: String, enum: ['Free', 'Pro', 'Business'], default: 'Free' },\n  subscriptionStatus: { type: String, enum: ['active', 'inactive', 'cancelled'], default: 'inactive' },\n  flutterwaveCustomerRef: { type: String, default: null },`
  );

  fs.writeFileSync('app.js', code);
  console.log('Successfully updated UserSchema with subscription fields.');
} else {
  console.log('Subscription fields already present in UserSchema.');
}
