const fs = require('fs');

if (!fs.existsSync('app.js')) {
  console.error('Target app.js file not found!');
  process.exit(1);
}

let code = fs.readFileSync('app.js', 'utf8');

if (!code.includes('/api/payments')) {
  code = code.replace(
    /const app = express\(\);/,
    "const app = express();\nconst paymentRoutes = require('./backend/routes/payment');"
  );

  code = code.replace(
    /app.use\(express.json\(\)\);/,
    "app.use(express.json());\napp.use('/api/payments', paymentRoutes);"
  );

  fs.writeFileSync('app.js', code);
  console.log('Successfully added payment routes to app.js');
} else {
  console.log('Payment routes are already present in app.js.');
}
