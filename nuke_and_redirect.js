const fs = require('fs');
const path = require('path');

// 1. Delete public/admin.html if it exists
const adminFilePath = path.join(__dirname, 'public', 'admin.html');
if (fs.existsSync(adminFilePath)) {
  fs.unlinkSync(adminFilePath);
  console.log('🗑️ Deleted public/admin.html successfully!');
}

// 2. Add /dashboard route to server.js
let code = fs.readFileSync('server.js', 'utf8');

const dashboardRoute = `
// --- NEW DASHBOARD ROUTE ---
app.get('/dashboard', (req, res) => {
  res.send(\`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MikiConnect Admin Control Panel</title>
  <style>
    body { background: #121212; color: #fff; font-family: system-ui, sans-serif; padding: 20px; margin: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 15px; }
    .card { background: #1e1e1e; padding: 20px; border-radius: 8px; margin-top: 20px; border: 1px solid #333; }
    input { width: 70%; padding: 10px; background: #2a2a2a; border: 1px solid #444; color: #fff; border-radius: 4px; }
    button { padding: 10px 16px; background: #007bff; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
    a { color: #aaa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <h2>🛡️ MikiConnect Admin Panel</h2>
    <a href="/">← Back to App</a>
  </div>

  <div class="card">
    <h3>📢 Real-time System Broadcast</h3>
    <p style="color: #aaa; font-size: 0.85em;">Send a live global notification to connected users.</p>
    <div style="display: flex; gap: 10px; margin-top: 10px;">
      <input type="text" id="broadcastMsg" placeholder="Type global announcement...">
      <button onclick="sendBroadcast()">Send</button>
    </div>
  </div>

  <script>
    async function sendBroadcast() {
      const msg = document.getElementById('broadcastMsg').value;
      if (!msg) return alert('Enter a message first');
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      if (res.ok) { alert('Broadcast sent!'); document.getElementById('broadcastMsg').value = ''; }
      else { alert('Failed to send broadcast'); }
    }
  </script>
</body>
</html>\`);
});
`;

if (!code.includes("app.get('/dashboard'")) {
  code = dashboardRoute + '\n' + code;
  fs.writeFileSync('server.js', code);
  console.log('✅ Added /dashboard route to server.js!');
}
