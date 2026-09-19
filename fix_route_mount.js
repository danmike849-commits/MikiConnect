const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

const targetLine = "app.use((req, res, next) => { if (req.path.startsWith('/api/'))";
const routeMount = "app.use('/api/payments', paymentRoutes);\napp.use('/api/payment', paymentRoutes);\n\n";

if (!code.includes("app.use('/api/payments'")) {
  code = code.replace(targetLine, routeMount + targetLine);
  fs.writeFileSync('app.js', code);
  console.log('Successfully mounted payment routes before the 404 handler!');
} else {
  console.log('Payment routes are already mounted.');
}
