const socket = io();
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;

// Handle UI tab switching
function switchTab(tabId, element) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  if (element) element.classList.add('active');

  if (tabId === 'feed-tab') loadFeed();
  if (tabId === 'admin-tab') loadAdminUsers();
}

// User Session UI
function updateAuthUI() {
  const userBar = document.getElementById('user-bar');
  const userDisplay = document.getElementById('user-display');
  const authBtn = document.getElementById('auth-tab-btn');

  if (currentUser) {
    userBar.style.display = 'flex';
    userDisplay.textContent = `Logged in as @${currentUser.username}${currentUser.isAdmin ? ' [ADMIN]' : ''}`;
    if (authBtn) authBtn.textContent = 'Profile';
  } else {
    userBar.style.display = 'none';
    if (authBtn) authBtn.textContent = 'Account';
  }
}

// Register
async function register() {
  const username = document.getElementById('reg-user').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-pass').value.trim();

  if (!username || !email || !password) return alert('Fill in all fields.');

  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  });
  const data = await res.json();

  if (data.success) {
    alert('Registration successful! Please login.');
    document.getElementById('reg-user').value = '';
    document.getElementById('reg-email').value = '';
    document.getElementById('reg-pass').value = '';
  } else {
    alert(data.error);
  }
}

// Login
async function login() {
  const identifier = document.getElementById('login-id').value.trim();
  const password = document.getElementById('login-pass').value.trim();

  if (!identifier || !password) return alert('Enter login credentials.');

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  const data = await res.json();

  if (data.success) {
    currentUser = data.user;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    updateAuthUI();
    alert(`Welcome back @${currentUser.username}!`);
    switchTab('feed-tab', document.querySelectorAll('.nav-tab')[0]);
  } else {
    alert(data.error);
  }
}

function logout() {
  localStorage.removeItem('currentUser');
  currentUser = null;
  updateAuthUI();
  alert('Logged out.');
}

// Feed Functions
async function loadFeed() {
  try {
    const res = await fetch('/api/posts');
    const data = await res.json();
    if (!data.success) return;

    const feedContainer = document.getElementById('feed-container');
    feedContainer.innerHTML = '';

    data.posts.forEach(post => {
      const isLiked = currentUser && post.likes.includes(currentUser.username);
      const card = document.createElement('div');
      card.className = 'post-card';
      card.innerHTML = `
        <div class="post-header">
          <strong>@${post.author}</strong>
          <small>${new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
        <p style="margin: 8px 0;">${post.content}</p>
        <button onclick="toggleLike('${post._id}')" class="like-btn ${isLiked ? 'liked' : ''}">
          ❤️ ${post.likes.length} Likes
        </button>
        <div class="comments-section">
          ${post.comments.map(c => `<div class="comment-item"><strong>@${c.username}:</strong> ${c.text}</div>`).join('')}
          <div class="comment-box" style="margin-top: 6px;">
            <input type="text" id="comment-input-${post._id}" placeholder="Write a comment..." />
            <button onclick="submitComment('${post._id}')">Send</button>
          </div>
        </div>
      `;
      feedContainer.appendChild(card);
    });
  } catch (e) {
    console.error(e);
  }
}

async function createPost() {
  if (!currentUser) return alert('Please login first on the Account tab!');
  const content = document.getElementById('post-content').value.trim();
  if (!content) return alert('Post cannot be empty.');

  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: currentUser.username, content })
  });
  const data = await res.json();
  if (data.success) {
    document.getElementById('post-content').value = '';
    loadFeed();
  }
}

async function toggleLike(postId) {
  if (!currentUser) return alert('Please login to like posts!');
  await fetch(`/api/posts/${postId}/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser.username })
  });
  loadFeed();
}

async function submitComment(postId) {
  if (!currentUser) return alert('Please login to comment!');
  const input = document.getElementById(`comment-input-${postId}`);
  if (!input || !input.value.trim()) return;

  await fetch(`/api/posts/${postId}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser.username, text: input.value.trim() })
  });
  loadFeed();
}

// Socket.io Real-Time Chat
function sendChatMessage() {
  if (!currentUser) return alert('Please login to chat!');
  const input = document.getElementById('chat-input');
  if (!input.value.trim()) return;

  socket.emit('sendMessage', { sender: currentUser.username, content: input.value.trim() });
  input.value = '';
}

socket.on('receiveMessage', data => {
  const chatBox = document.getElementById('chat-box');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.innerHTML = `<strong>@${data.sender}:</strong> ${data.content}`;
  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
});

// Admin Moderation
async function loadAdminUsers() {
  const res = await fetch('/api/admin/users');
  const data = await res.json();
  const list = document.getElementById('admin-user-list');
  if (!list) return;

  list.innerHTML = '';
  if (!data.success) {
    list.innerHTML = `<li>${data.error || 'Failed to load users'}</li>`;
    return;
  }

  data.users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span><strong>@${u.username}</strong> (${u.email}) ${u.isAdmin ? '[ADMIN]' : ''}</span>
      ${!u.isAdmin ? `<button class="del-btn" onclick="deleteUser('${u._id}')">Delete</button>` : ''}
    `;
    list.appendChild(li);
  });
}

async function deleteUser(id) {
  if (!confirm('Delete user?')) return;
  await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  loadAdminUsers();
}

document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  loadFeed();
});
