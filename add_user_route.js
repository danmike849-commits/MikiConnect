const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

const userRoute = `
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
  code = code.replace('app.use(express.json());', 'app.use(express.json());\n' + userRoute);
  fs.writeFileSync('server.js', code);
  console.log('✅ Added /api/users route cleanly!');
} else {
  console.log('ℹ️ /api/users route already exists');
}
