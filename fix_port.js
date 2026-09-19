const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

// Ensure port defaults to process.env.PORT or 5000
code = code.replace(/const PORT = .*/, 'const PORT = process.env.PORT || 5000;');
code = code.replace(/app\.listen\(\d+/, 'app.listen(PORT');

fs.writeFileSync('app.js', code);
console.log('Updated app.js to use process.env.PORT dynamically.');
