const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Strip out any previous custom app.get('/admin.html') overrides we added
code = code.replace(/app\.get\(['"]\/admin\.html['"][\s\S]*?\n\}\);\n/g, '');

const topRoute = `
// --- TOP-PRIORITY CLEAN ADMIN ROUTE ---
app.get('/admin.html', (req, res) => {
  res.send(\`<!DOCTYPE html>
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
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (let r of regs) r.unregister();
      });
    }

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

// Insert right after express initialization (const app = express();)
if (code.includes('const app = express();')) {
  code = code.replace('const app = express();', 'const app = express();\n' + topRoute);
} else {
  code = topRoute + '\n' + code;
}

fs.writeFileSync('server.js', code);
console.log('✅ Injected clean /admin.html route at top priority!');
