const fs = require('fs');

let appContent = fs.readFileSync('app.js', 'utf8');

// Check if static middleware is already added
if (!appContent.includes('express.static')) {
    const staticCode = `
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));
`;
    // Insert after const app = express();
    appContent = appContent.replace("const app = express();", "const app = express();\n" + staticCode);
}

// Check if root route is already added
if (!appContent.includes("app.get('/',")) {
    const rootRoute = `
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
`;
    appContent += rootRoute;
}

fs.writeFileSync('app.js', appContent);
console.log('app.js updated successfully with static routing!');
