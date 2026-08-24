const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Route to serve clean Admin Dashboard directly from Express
const directAdminRoute = `
app.get('/admin.html', (req, res) => {
  res.send(\`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MikiConnect Admin Control Panel</title>
  <style>
    body { background: #121212; color: #fff; font-family: sans-serif; padding: 20px; }
    .card { background: #1e1e1e; padding: 20px; border-radius: 8px; margin-top: 15px; border: 1px solid #333; }
    input { width: 70%; padding: 10px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; }
    button { padding: 10px 15px; background: #007bff; color: white; border: none; border-radius: 4px; font-weight: bold; }
    a { color: #007bff; text-decoration: none; }
  </style>
</head>
<body>
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <h2>🛡️ MikiConnect Admin Panel</h2>
    <a href="/">← Back to App</a>
  </div>
  <hr style="border-color:#333;">

  <div class="card">
    <h3>📢 Real-time System Broadcast</h3>
    <p style="color:#aaa; font-size:0.85em;">Send a live global notification to connected users.</p>
    <div style="display:flex; gap:10px;">
      <input type="text" id="broadcastMsg" placeholder="Type global announcement...">
      <button onclick="sendBroadcast()">Send</button>
    </div>
  </div>

  <script>
    async function sendBroadcast() {
      const msg = document.getElementById('broadcastMsg').value;
      if(!msg) return alert('Enter a message first');
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      if(res.ok) { alert('Broadcast sent successfully!'); document.getElementById('broadcastMsg').value = ''; }
      else { alert('Failed to send broadcast'); }
    }
  </script>
</body>
</html>
  \`);
});
`;

if (!code.includes("app.get('/admin.html'")) {
  code = directAdminRoute + '\n' + code;
  fs.writeFileSync('server.js', code);
  console.log('✅ Overrode /admin.html route directly in server.js!');
} else {
  console.log('ℹ️ Route already configured.');
}
