const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

const routeCode = `
// --- PUBLIC USER LIST ROUTE ---
app.get('/api/users', async (req, res) => {
  try {
    if (typeof User !== 'undefined') {
      const users = await User.find({}, 'username createdAt avatar isOnline');
      return res.json(users);
    }
    res.json([]);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});
`;

if (!code.includes("app.get('/api/users'")) {
  code = code.replace('app.use(express.json());', 'app.use(express.json());\n' + routeCode);
  fs.writeFileSync('server.js', code);
  console.log('✅ Injected /api/users safely!');
} else {
  console.log('ℹ️ /api/users route is already present.');
}
