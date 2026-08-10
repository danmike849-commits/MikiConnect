const socket = io();
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let authToken = localStorage.getItem('token') || null;

let mediaRecorder;
let audioChunks = [];
let recordedVoiceBase64 = '';

// Username Letter A-Z Color Generator
function getUserColor(username) {
  if (!username) return '#40c057';
  const charCode = username.toUpperCase().charCodeAt(0);
  const colors = [
    '#ff6b6b', '#f783ac', '#e599f7', '#b197fc', '#91a7ff',
    '#74c0fc', '#3bc9db', '#38d9a9', '#69db7c', '#a9e34b',
    '#ffd43b', '#ffa8a8', '#ff8787', '#f783ac', '#da77f2',
    '#9775fa', '#748ffc', '#4dabf7', '#20c997', '#51cf66',
    '#94d82d', '#fcc419', '#ff922b', '#eebe71', '#37b24d', '#12b886'
  ];
  return colors[charCode % colors.length] || '#40c057';
}

function switchTab(tabId, element) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  if (element) element.classList.add('active');

  if (tabId === 'feed-tab') loadFeed();
  if (tabId === 'groups-tab') loadGroups();
  if (tabId === 'admin-tab') loadAdminUsers();
}

function updateAuthUI() {
  const userBar = document.getElementById('user-bar');
  const userDisplay = document.getElementById('user-display');
  const adminTabBtn = document.getElementById('admin-tab-btn');
  const loggedInProfile = document.getElementById('logged-in-profile');
  const loginCard = document.getElementById('login-card');
  const registerCard = document.getElementById('register-card');

  if (currentUser) {
    userBar.style.display = 'flex';
    userDisplay.innerHTML = `<span style="color:${getUserColor(currentUser.username)}">@${currentUser.username}</span> ${currentUser.isAdmin ? '[ADMIN]' : ''}`;
    
    // Admin dashboard visible ONLY to admins
    if (adminTabBtn) adminTabBtn.style.display = currentUser.isAdmin ? 'block' : 'none';
    
    if (loggedInProfile) {
      loggedInProfile.style.display = 'block';
      document.getElementById('profile-details').innerHTML = `Logged in as: <strong style="color:${getUserColor(currentUser.username)}">@${currentUser.username}</strong><br>Email: ${currentUser.email}`;
    }
    if (loginCard) loginCard.style.display = 'none';
    if (registerCard) registerCard.style.display = 'none';

    socket.emit('registerSocketUser', currentUser.username);
  } else {
    userBar.style.display = 'none';
    if (adminTabBtn) adminTabBtn.style.display = 'none';
    if (loggedInProfile) loggedInProfile.style.display = 'none';
    if (loginCard) loginCard.style.display = 'block';
    if (registerCard) registerCard.style.display = 'block';
  }
}

// Active Users online list
socket.on('onlineUsersList', (users) => {
  const listEl = document.getElementById('online-users-list');
  if (!listEl) return;
  if (!users || users.length === 0) {
    listEl.innerHTML = 'None online';
    return;
  }
  listEl.innerHTML = users.map(u => `<strong style="color:${getUserColor(u)}">@${u}</strong>`).join(', ');
});

// Auth Functions
async function register() {
  const username = document.getElementById('reg-user').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-pass').value.trim();

  if (!username || !email || !password) return alert('All fields required.');

  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  });
  const data = await res.json();
  if (data.success) {
    alert('Account created! Please log in.');
  } else {
    alert(data.error);
  }
}

async function login() {
  const identifier = document.getElementById('login-id').value.trim();
  const password = document.getElementById('login-pass').value.trim();

  if (!identifier || !password) return alert('Enter credentials.');

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
    alert(`Logged in as @${currentUser.username}`);
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

// File Base64 Helper
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

function previewMedia(input, previewId) {
  if (input.files && input.files[0]) {
    document.getElementById(previewId).innerText = `Selected: ${input.files[0].name}`;
  }
}

// Feed Posts
async function loadFeed() {
  const res = await fetch('/api/posts');
  const data = await res.json();
  if (!data.success) return;

  const container = document.getElementById('feed-container');
  container.innerHTML = '';

  data.posts.forEach(post => {
    const userColor = getUserColor(post.author);
    const isLiked = currentUser && post.likes.includes(currentUser.username);

    const card = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML = `
      <div class="post-header">
        <strong style="color:${userColor}">@${post.author}</strong>
        <small>${new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </div>
      <p style="margin: 8px 0;">${post.content}</p>
      ${post.imageUrl ? `<img src="${post.imageUrl}" class="post-media" />` : ''}
      ${post.videoUrl ? `<video src="${post.videoUrl}" controls class="post-media"></video>` : ''}
      <button onclick="toggleLike('${post._id}')" style="width: auto; padding: 4px 10px;">
        ${isLiked ? '❤️' : '🤍'} ${post.likes.length} Likes
      </button>
    `;
    container.appendChild(card);
  });
}

async function createPost() {
  if (!authToken) return alert('Please login to post.');
  const content = document.getElementById('post-content').value.trim();
  const imgFile = document.getElementById('post-img-file').files[0];
  const vidFile = document.getElementById('post-vid-file').files[0];

  let imageUrl = '', videoUrl = '';
  if (imgFile) imageUrl = await fileToBase64(imgFile);
  if (vidFile) videoUrl = await fileToBase64(vidFile);

  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ content, imageUrl, videoUrl })
  });

  const data = await res.json();
  if (data.success) {
    document.getElementById('post-content').value = '';
    document.getElementById('post-img-file').value = '';
    document.getElementById('post-vid-file').value = '';
    document.getElementById('img-preview').innerText = '';
    document.getElementById('vid-preview').innerText = '';
  }
}

async function toggleLike(postId) {
  if (!authToken) return alert('Please login.');
  await fetch(`/api/posts/${postId}/like`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
}

socket.on('postCreated', () => loadFeed());
socket.on('postUpdated', () => loadFeed());

// Voice Recorder
async function toggleVoiceRecord() {
  const voiceBtn = document.getElementById('voice-btn');
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      recordedVoiceBase64 = await fileToBase64(audioBlob);
      voiceBtn.innerText = '✅ Voice Recorded!';
    };
    mediaRecorder.start();
    voiceBtn.innerText = '🔴 Recording... Click to Stop';
  } else {
    mediaRecorder.stop();
  }
}

function addEmoji(emoji) {
  if (!emoji) return;
  const input = document.getElementById('chat-msg-input');
  input.value += emoji;
}

// Chat Messaging
async function sendChatMessage(targetType) {
  if (!currentUser) return alert('Login required.');
  const content = document.getElementById('chat-msg-input').value.trim();
  const imgFile = document.getElementById('chat-img').files[0];
  const vidFile = document.getElementById('chat-vid').files[0];

  let mediaUrl = '', mediaType = '';
  if (imgFile) { mediaUrl = await fileToBase64(imgFile); mediaType = 'image'; }
  else if (vidFile) { mediaUrl = await fileToBase64(vidFile); mediaType = 'video'; }
  else if (recordedVoiceBase64) { mediaUrl = recordedVoiceBase64; mediaType = 'voice'; }

  const groupId = targetType === 'group' ? document.getElementById('active-group-select').value : '';

  socket.emit('sendChatMessage', {
    sender: currentUser.username,
    recipient: targetType === 'group' ? 'group' : 'public',
    groupId,
    content,
    mediaUrl,
    mediaType
  });

  document.getElementById('chat-msg-input').value = '';
  document.getElementById('chat-img').value = '';
  document.getElementById('chat-vid').value = '';
  recordedVoiceBase64 = '';
  document.getElementById('voice-btn').innerText = '🎙️ Record Voice';
}

socket.on('receiveChatMessage', (msg) => {
  const box = msg.recipient === 'group' ? document.getElementById('group-chat-box') : document.getElementById('public-chat-box');
  if (!box) return;

  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `
    <strong style="color:${getUserColor(msg.sender)}">@${msg.sender}:</strong> ${msg.content}
    ${msg.mediaType === 'image' ? `<br><img src="${msg.mediaUrl}" style="max-width:100%; border-radius:5px; margin-top:5px;" />` : ''}
    ${msg.mediaType === 'video' ? `<br><video src="${msg.mediaUrl}" controls style="max-width:100%; border-radius:5px; margin-top:5px;"></video>` : ''}
    ${msg.mediaType === 'voice' ? `<br><audio src="${msg.mediaUrl}" controls style="width:100%; margin-top:5px;"></audio>` : ''}
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
});

// Group Forums
async function loadGroups() {
  const res = await fetch('/api/groups');
  const data = await res.json();
  if (!data.success) return;

  const select = document.getElementById('active-group-select');
  select.innerHTML = '<option value="">Select a Group Forum...</option>';
  data.groups.forEach(g => {
    select.innerHTML += `<option value="${g._id}">${g.name} (Admin: @${g.creator})</option>`;
  });
}

async function createGroup() {
  if (!authToken) return alert('Please login to create groups.');
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) return alert('Enter group name.');

  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ name })
  });

  const data = await res.json();
  if (data.success) {
    document.getElementById('group-name-input').value = '';
    loadGroups();
  }
}

// Admin Panel
async function loadAdminUsers() {
  if (!authToken) return alert('Log in as Admin.');

  const res = await fetch('/api/admin/users', {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  const list = document.getElementById('admin-user-list');
  list.innerHTML = '';

  if (!data.success) {
    list.innerHTML = `<li>${data.error || 'Access denied'}</li>`;
    return;
  }

  data.users.forEach(u => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.padding = '8px 0';
    li.style.borderBottom = '1px solid #3b424e';
    li.innerHTML = `
      <span><strong style="color:${getUserColor(u.username)}">@${u.username}</strong> (${u.email}) ${u.isAdmin ? '[ADMIN]' : ''}</span>
      ${!u.isAdmin ? `<button onclick="deleteUser('${u._id}')" style="background:#c92a2a; color:#fff; width:auto; padding:3px 8px; font-size:12px;">Delete</button>` : ''}
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
