let socket = typeof io !== 'undefined' ? io() : null;
let currentUser = localStorage.getItem('miki_user') || '';
let currentTarget = 'Global';
let isAdminUser = false;
let onlineUsersList = [];

if (socket) {
  socket.on('connect', () => {
    if (currentUser) socket.emit('register_user', currentUser);
  });

  socket.on('user_status_change', (onlineUsers) => {
    onlineUsersList = onlineUsers;
    loadContacts();
  });

  socket.on('new_message', (msg) => {
    const isGlobalMatch = currentTarget === 'Global' && msg.receiver === 'Global';
    const isPrivateMatch = (msg.sender === currentTarget && msg.receiver === currentUser) || 
                           (msg.sender === currentUser && msg.receiver === currentTarget);

    if (isGlobalMatch || isPrivateMatch) {
      appendMessageUI(msg);
    }
  });

  socket.on('global_chat_cleared', () => {
    if (currentTarget === 'Global') {
      document.getElementById('messages-list').innerHTML = '<div style="text-align:center; color:#94a3b8; font-size:12px; padding:20px;">Global chat cleared by Admin</div>';
    }
  });

  socket.on('message_deleted', ({ id }) => {
    const msgElem = document.getElementById(`msg-${id}`);
    if (msgElem) msgElem.remove();
  });
}

// LOGIN
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (data.success) {
    currentUser = data.username;
    isAdminUser = data.isAdmin;
    localStorage.setItem('miki_user', currentUser);
    if (socket) socket.emit('register_user', currentUser);
    
    document.body.classList.remove('logged-out');
    document.getElementById('auth-wrapper').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';

    if (isAdminUser) document.getElementById('admin-tab-link').style.display = 'inline';

    loadContacts();
    selectChat('Global');
  } else {
    alert(data.message);
  }
}

// CONTACTS
async function loadContacts() {
  const res = await fetch('/api/users');
  const data = await res.json();
  if (data.success) {
    const bar = document.getElementById('contacts-bar');
    bar.innerHTML = `<button class="contact-pill ${currentTarget === 'Global' ? 'active' : ''}" id="pill-Global" onclick="selectChat('Global')">🌐 Global Room</button>`;

    data.users.forEach(u => {
      if (u.username !== currentUser) {
        const isOnline = onlineUsersList.includes(u.username);
        const dot = isOnline ? '<span class="online-dot"></span>' : '<span class="offline-dot"></span>';
        bar.innerHTML += `<button class="contact-pill ${currentTarget === u.username ? 'active' : ''}" id="pill-${u.username}" onclick="selectChat('${u.username}')">${dot} @${u.username}</button>`;
      }
    });
  }
}

// SWITCH CHATS
async function selectChat(target) {
  currentTarget = target;
  document.querySelectorAll('.contact-pill').forEach(btn => btn.classList.remove('active'));
  const activePill = document.getElementById(`pill-${target}`);
  if (activePill) activePill.classList.add('active');

  const name = document.getElementById('header-target-name');
  name.textContent = target === 'Global' ? 'Global Public Chat' : `@${target}`;

  const list = document.getElementById('messages-list');
  list.innerHTML = '';
  
  const res = await fetch(`/api/messages?user1=${currentUser}&user2=${target}`);
  const data = await res.json();
  if (data.success) data.messages.forEach(msg => appendMessageUI(msg));
}

// SEND TEXT
function sendTextMessage() {
  const input = document.getElementById('chat-text');
  if (!input.value.trim()) return;

  socket.emit('send_message', {
    sender: currentUser,
    receiver: currentTarget,
    text: input.value,
    mediaType: 'text'
  });

  input.value = '';
}

// RENDER MESSAGE
function appendMessageUI(msg) {
  const list = document.getElementById('messages-list');
  const isMine = msg.sender === currentUser;
  const isSys = msg.sender === 'SYSTEM';

  const div = document.createElement('div');
  div.id = `msg-${msg._id}`;
  div.style.cssText = `margin-bottom:10px; text-align:${isSys ? 'center' : (isMine ? 'right' : 'left')};`;

  if (isSys) {
    div.innerHTML = `<span style="background:#0284c7; color:white; padding:4px 12px; border-radius:12px; font-size:11px; font-weight:bold;">📢 ${msg.text}</span>`;
  } else {
    div.innerHTML = `
      <div style="display:inline-block; background:${isMine ? '#0284c7' : '#334155'}; padding:8px 12px; border-radius:12px; text-align:left; max-width:85%;">
        <small style="display:block; color:#bae6fd; font-weight:bold; font-size:11px; margin-bottom:2px;">${msg.sender}</small>
        <span>${msg.text}</span>
      </div>
    `;
  }

  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

// TAB SWITCHER & ADMIN DATA LOAD
function switchTab(tab) {
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  if (tab === 'admin') {
    document.getElementById('admin-tab-link').classList.add('active');
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'flex';
    loadAdminData();
  } else {
    document.getElementById('tab-chats').classList.add('active');
    document.getElementById('admin-dashboard').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
  }
}

// FETCH FULL ADMIN DATA
async function loadAdminData() {
  const res = await fetch('/api/admin/data');
  const data = await res.json();
  if (data.success) {
    document.getElementById('stat-total-users').textContent = data.stats.totalUsers;
    document.getElementById('stat-online-users').textContent = data.stats.onlineUsers;
    document.getElementById('stat-total-msgs').textContent = data.stats.totalMessages;

    const tableBody = document.getElementById('admin-users-table-body');
    tableBody.innerHTML = data.users.map(u => `
      <tr>
        <td><strong>@${u.username}</strong></td>
        <td><span style="color:${u.isAdmin ? '#38bdf8' : '#94a3b8'}; font-weight:bold;">${u.isAdmin ? 'Admin' : 'User'}</span></td>
        <td>
          <button onclick="toggleUserRole('${u.username}')" class="action-btn btn-role">Role</button>
          <button onclick="deleteUserAccount('${u.username}')" class="action-btn btn-danger">Delete</button>
        </td>
      </tr>
    `).join('');

    const msgLog = document.getElementById('admin-messages-log');
    msgLog.innerHTML = data.messages.map(m => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid #1e293b;">
        <span><strong>[${m.sender} ➔ ${m.receiver}]:</strong> ${m.text || m.mediaType}</span>
        <button onclick="deleteSingleMessage('${m._id}')" class="action-btn btn-danger" style="padding:2px 6px;">🗑️</button>
      </div>
    `).join('');
  }
}

// ADMIN ACTIONS
async function toggleUserRole(username) {
  if (confirm(`Toggle admin role for @${username}?`)) {
    await fetch(`/api/admin/users/${username}/role`, { method: 'PUT' });
    loadAdminData();
  }
}

async function deleteUserAccount(username) {
  if (confirm(`PERMANENTLY delete @${username} and all their messages?`)) {
    await fetch(`/api/admin/users/${username}`, { method: 'DELETE' });
    loadAdminData();
  }
}

async function deleteSingleMessage(msgId) {
  await fetch(`/api/admin/messages/${msgId}`, { method: 'DELETE' });
  loadAdminData();
}

async function clearGlobalChatHistory() {
  if (confirm("Purge ALL messages in Global Chat?")) {
    await fetch('/api/admin/clear-global', { method: 'POST' });
    loadAdminData();
  }
}

function sendAdminBroadcast() {
  const input = document.getElementById('admin-broadcast-input');
  if (!input.value.trim()) return;

  socket.emit('send_message', {
    sender: 'SYSTEM',
    receiver: 'Global',
    text: input.value,
    mediaType: 'text'
  });

  input.value = '';
  alert('Broadcast sent to Global Chat!');
}

function logoutUser() {
  localStorage.removeItem('miki_user');
  location.reload();
}

window.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    document.body.classList.remove('logged-out');
    document.getElementById('auth-wrapper').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
    if (socket) socket.emit('register_user', currentUser);
    loadContacts();
    selectChat('Global');
  }
});
