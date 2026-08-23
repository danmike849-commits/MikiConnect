const fs = require('fs');

// 1. Patch public/admin.html to decode JWT token payload directly
let adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const adminCheckScript = `<script>
  const token = localStorage.getItem('token');
  let isAdmin = false;

  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role === 'admin' || payload.username === 'official') {
        isAdmin = true;
      }
    } catch (e) {
      console.error('Token decode error:', e);
    }
  }

  if (!isAdmin) {
    alert('Access Denied: Please log in as an Admin first.');
    window.location.href = '/';
  }
</script>`;

if (adminHtml.includes('<script>')) {
  adminHtml = adminHtml.replace(/<script>[\s\S]*?<\/script>/, adminCheckScript);
} else {
  adminHtml = adminHtml.replace('</body>', `${adminCheckScript}\n</body>`);
}
fs.writeFileSync('public/admin.html', adminHtml);
console.log('✅ public/admin.html updated!');

// 2. Patch public/index.html to display Admin button for official / admin users
let indexHtml = fs.readFileSync('public/index.html', 'utf8');
if (!indexHtml.includes('payload.role')) {
  indexHtml = indexHtml.replace(
    /const token = localStorage\.getItem\('token'\);/g,
    `const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.role === 'admin' || payload.username === 'official') {
          setTimeout(() => {
            const adminBtn = document.getElementById('admin-btn') || document.getElementById('admin-link');
            if (adminBtn) adminBtn.style.display = 'inline-block';
          }, 500);
        }
      } catch(e) {}
    }`
  );
  fs.writeFileSync('public/index.html', indexHtml);
  console.log('✅ public/index.html updated!');
}
