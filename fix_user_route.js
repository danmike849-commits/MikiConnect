const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

const userEndpoint = `
// --- PUBLIC USER LIST ROUTE ---
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username createdAt avatar isOnline');
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});
`;

if (!code.includes("app.get('/api/users'")) {
  code = code.replace("// Auth API", userEndpoint + "\n// Auth API");
  fs.writeFileSync('server.js', code);
  console.log("✅ Successfully injected /api/users into server.js");
} else {
  console.log("ℹ️ Route /api/users already present");
}
