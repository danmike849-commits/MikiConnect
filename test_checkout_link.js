const http = require('http');

const data = JSON.stringify({
  amount: 10,
  email: "danmike849@gmail.com"
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 5000,
  path: '/api/payments/initialize',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      console.log('\n--- PAYMENT LINK ---');
      console.log(parsed.link);
      console.log('--------------------\n');
    } catch (e) {
      console.log('Response:', body);
    }
  });
});

req.write(data);
req.end();
