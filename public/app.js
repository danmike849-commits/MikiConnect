const socket = io();
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let authToken = localStorage.getItem('token') || null;

function switchTab(tabId, element) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  if (element) element.classList.add('active');

  if (tabId === 'feed-tab') loadFeed();
  if (tabId === 'admin-tab') loadAdminUsers();
}

function updateAuthUI() {
  const userBar = document.getElementById('user-bar');
  const userDisplay = document.getElementById('user-display');
  const authBtn = document.getElementById('auth-tab-btn');

  if (currentUser) {
    userBar.style.display = 'flex';
    userDisplay.textContent = `@${currentUser.username}${currentUser.isAdmin ? ' [ADMIN]' : ''}`;
    if (authBtn) authBtn.textContent = 'Profile';
    socket.emit('registerSocketUser', currentUser.username);
  } else {
    userBar.style.display = 'none';
    if (authBtn) authBtn.textContent = 'Account';
  }
}

// Authentication
async function register() {
  const username = document.getElementById('reg-user').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-pass').value.trim();
  const avatar = document.getElementById('reg-avatar').value.trim();

  if (!username || !email || !password) return alert('Fill in required fields.');

  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, avatar })
  });
  const data = await res.json();

  if (data.success) {
    alert('Account registered! Please log in.');
    switchTab('auth-tab', document.querySelectorAll('.nav-tab')[4]);
  } else {
    alert(data.error);
  }
}

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
    authToken = data.token;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('token', authToken);

    updateAuthUI();
    alert(`Welcome back @${currentUser.username}!`);
    switchTab('feed-tab', document.querySelectorAll('.nav-tab')[0]);
  } else {
    alert(data.error);
  }
}

function logout() {
  localStorage.removeItem('currentUser');
  localStorage.removeItem('token');
  currentUser = null;
  authToken = null;
  updateAuthUI();
  alert('Logged out.');
}

// Feed Functions
async function loadFeed() {
  try {
    const res = await fetch('/api/posts');
    const data = await res.json();
    if (!data.success) return;

    renderFeed(data.posts);
  } catch (e) {
    console.error(e);
  }
}

function renderFeed(posts) {
  const feedContainer = document.getElementById('feed-container');
  if (!feedContainer) return;
  feedContainer.innerHTML = '';

  posts.forEach(post => {
    const isLiked = currentUser && post.likes.includes(currentUser.username);
    const card = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML = `
      <div class="post-header">
        <strong>@${post.author}</strong>
        <small>${new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </div>
      <p style="margin: 8px 0;">${post.content}</p>
      ${post.imageUrl ? `<img src="${post.imageUrl}" class="post-img" alt="Post media" />` : ''}
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
}

async function createPost() {
  if (!authToken) return alert('Please login to create a post.');
  const content = document.getElementById('post-content').value.trim();
  const imageUrl = document.getElementById('post-image-url').value.trim();
  if (!content) return alert('Post content cannot be empty.');

  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ content, imageUrl })
  });
  const data = await res.json();
  if (data.success) {
    document.getElementById('post-content').value = '';
    document.getElementById('post-image-url').value = '';
  } else {
    alert(data.error);
  }
}

async function toggleLike(postId) {
  if (!authToken) return alert('Please login to like posts.');
  await fetch(`/api/posts/${postId}/like`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    }
  });
}

async function submitComment(postId) {
  if (!authToken) return alert('Please login to comment.');
  const input = document.getElementById(`comment-input-${postId}`);
  if (!input || !input.value.trim()) return;

  await fetch(`/api/posts/${postId}/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ text: input.value.trim() })
  });
}

// Real-Time Socket Feed Updates
socket.on('postCreated', () => loadFeed());
socket.on('postUpdated', () => loadFeed());

// Chat & DMs
function sendPublicChat() {
  if (!currentUser) return alert('Please login to chat!');
  const input = document.getElementById('public-chat-input');
  if (!input.value.trim()) return;

  socket.emit('sendPublicMessage', { sender: currentUser.username, content: input.value.trim() });
  input.value = '';
}

socket.on('receivePublicMessage', msg => {
  const box = document.getElementById('public-chat-box');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<strong>@${msg.sender}:</strong> ${msg.content}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
});

function sendPrivateDM() {
  if (!currentUser) return alert('Please login to send DMs!');
  const recipient = document.getElementById('dm-recipient').value.trim();
  const input = document.getElementById('dm-chat-input');
  if (!recipient || !input.value.trim()) return alert('Enter recipient username and message.');

  socket.emit('sendPrivateMessage', { sender: currentUser.username, recipient, content: input.value.trim() });
  input.value = '';
}

socket.on('receivePrivateMessage', msg => {
  const box = document.getElementById('dm-chat-box');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<strong>@${msg.sender} ➔ @${msg.recipient}:</strong> ${msg.content}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
});

// Admin Panel
async function loadAdminUsers() {
  if (!authToken) return alert('Log in as Admin first.');

  const res = await fetch('/api/admin/users', {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  const list = document.getElementById('admin-user-list');
  if (!list) return;

  list.innerHTML = '';
  if (!data.success) {
    list.innerHTML = `<li>${data.error || 'Access denied'}</li>`;
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
  await fetch(`/api/admin/users/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  loadAdminUsers();
}

document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  loadFeed();
});
