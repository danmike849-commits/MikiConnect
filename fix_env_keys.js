const fs = require('fs');

let envContent = fs.readFileSync('.env', 'utf8');

// Replace unassigned key strings with properly formatted environment variable assignments
envContent = envContent.replace(/FLWPUBK_TEST[^\n]+/, 'FLW_PUBLIC_KEY=FLWPUBK_TEST-01332127ac1538fe2bcdeffc0191cbc4-X');
envContent = envContent.replace(/FLWSECK_TEST[^\n]+/, 'FLW_SECRET_KEY=FLWSECK_TEST-b444f8aef2ae494f0b8204906a34f4aa-X');

fs.writeFileSync('.env', envContent);
console.log('Updated .env with FLW_PUBLIC_KEY and FLW_SECRET_KEY assignments.');
