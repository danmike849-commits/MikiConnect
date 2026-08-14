cat << 'EOF' > public/app.js
let socket;

// Connect Socket.io client if available
if (typeof io !== 'undefined') {
  socket = io();

  // Listen for real-time messages broadcasted by the server
  socket.on('new_message', (data) => {
    if (data && data.sender && data.message) {
      triggerInAppAlert(data.sender, data.message);
    }
  });
}

// --- REAL FETCH API LOGIN HANDLER ---
async function handleLogin(event) {
  event.preventDefault();
  
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!username || !password) return;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      // Remove logged-out class from body to reveal Navigation Header
      document.body.classList.remove('logged-out');

      // Switch auth card to user profile card
      const authCard = document.getElementById('auth-card');
      const profileCard = document.getElementById('user-profile-card');
      const displayName = document.getElementById('user-display-name');

      if (authCard) authCard.style.display = 'none';
      if (profileCard) profileCard.style.display = 'block';
      if (displayName) displayName.textContent = data.username;

      // Save user session locally
      localStorage.setItem('miki_user', data.username);

      // Trigger pop-up alert
      triggerInAppAlert("MikiConnect Server", `Welcome back, ${data.username}!`);
    } else {
      alert(data.message || 'Login failed.');
    }
  } catch (err) {
    console.error('Login error:', err);
    alert('Could not connect to the server. Please try again.');
  }
}

// --- LOGOUT HANDLER ---
function logoutUser() {
  localStorage.removeItem('miki_user');
  document.body.classList.add('logged-out');

  const authCard = document.getElementById('auth-card');
  const profileCard = document.getElementById('user-profile-card');

  if (authCard) authCard.style.display = 'block';
  if (profileCard) profileCard.style.display = 'none';
}

// --- IN-APP POP-UP ALERT SYSTEM ---
function triggerInAppAlert(sender, message) {
  const alertBanner = document.getElementById('in-app-alert');
  const alertSender = document.getElementById('alert-sender');
  const alertPreview = document.getElementById('alert-preview');

  if (alertBanner && alertSender && alertPreview) {
    alertSender.textContent = sender;
    alertPreview.textContent = message;

    alertBanner.classList.remove('hidden');

    setTimeout(() => {
      alertBanner.classList.add('hidden');
    }, 4000);
  }
}

function openAlertMessage() {
  const alertBanner = document.getElementById('in-app-alert');
  if (alertBanner) {
    alertBanner.classList.add('hidden');
  }
}

// Restore saved session on reload
window.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('miki_user');
  if (savedUser) {
    document.body.classList.remove('logged-out');
    const authCard = document.getElementById('auth-card');
    const profileCard = document.getElementById('user-profile-card');
    const displayName = document.getElementById('user-display-name');

    if (authCard) authCard.style.display = 'none';
    if (profileCard) profileCard.style.display = 'block';
    if (displayName) displayName.textContent = savedUser;
  }
});
EOF
