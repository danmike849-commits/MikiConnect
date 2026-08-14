let socket = typeof io !== 'undefined' ? io() : null;
let currentUser = localStorage.getItem('miki_user') || '';
let currentTarget = 'Global';
let isAdminUser = false;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

if (socket) {
  socket.on('new_message', (msg) => {
    // Check if message belongs to current open room
    const isGlobalMatch = currentTarget === 'Global' && msg.receiver === 'Global';
    const isPrivateMatch = (msg.sender === currentTarget && msg.receiver === currentUser) || 
                           (msg.sender === currentUser && msg.receiver === currentTarget);

    if (isGlobalMatch || isPrivateMatch) {
      appendMessageUI(msg);
      if (msg.receiver === currentUser && !msg.isRead) {
        socket.emit('mark_read', { messageId: msg._id });
      }
    }
  });

  socket.on('message_read_update', ({ id, isRead }) => {
    const elem = document.getElementById(`read-${id}`);
    if (elem) elem.innerHTML = ' ✓✓';
  });

  socket.on('message_updated', (msg) => {
    const textElem = document.getElementById(`text-${msg._id}`);
    if (textElem) textElem.innerHTML = `${msg.text} <small style="color:#94a3b8;">(edited)</small>`;
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
    document.body.classList.remove('logged-out');
    document.getElementById('auth-card').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';

    if (isAdminUser) {
      document.getElementById('admin-tab-link').style.display = 'inline';
    }

    loadContacts();
    selectChat('Global');
  } else {
    alert(data.message);
  }
}

// LOAD CONTACTS LIST
async function loadContacts() {
  const res = await fetch('/api/users');
  const data = await res.json();
  if (data.success) {
    const bar = document.getElementById('contacts-bar');
    bar.innerHTML = `<button class="contact-pill ${currentTarget === 'Global' ? 'active' : ''}" id="pill-Global" onclick="selectChat('Global')">🌐 Global Room</button>`;

    data.users.forEach(u => {
      if (u.username !== currentUser) {
        bar.innerHTML += `<button class="contact-pill ${currentTarget === u.username ? 'active' : ''}" id="pill-${u.username}" onclick="selectChat('${u.username}')">👤 ${u.username}</button>`;
      }
    });
  }
}

// SWITCH ACTIVE CHAT ROOM
async function selectChat(target) {
  currentTarget = target;

  // Update Pills Active State
  document.querySelectorAll('.contact-pill').forEach(btn => btn.classList.remove('active'));
  const activePill = document.getElementById(`pill-${target}`);
  if (activePill) activePill.classList.add('active');

  // Update Header Bar
  const avatar = document.getElementById('header-avatar');
  const name = document.getElementById('header-target-name');
  const sub = document.getElementById('header-target-sub');

  if (target === 'Global') {
    avatar.textContent = '🌐';
    name.textContent = 'Global Public Chat';
    sub.textContent = 'Visible to everyone online';
  } else {
    avatar.textContent = '👤';
    name.textContent = `@${target}`;
    sub.textContent = 'Private 1-on-1 Direct Message';
  }

  // Load Message History
  const list = document.getElementById('messages-list');
  list.innerHTML = '';
  
  const res = await fetch(`/api/messages?user1=${currentUser}&user2=${target}`);
  const data = await res.json();

  if (data.success) {
    data.messages.forEach(msg => appendMessageUI(msg));
  }
}

// LOGOUT
function logoutUser() {
  localStorage.removeItem('miki_user');
  location.reload();
}

// SEND TEXT MESSAGE
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

// UPLOAD MEDIA
async function uploadMediaFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('mediaFile', file);

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();

  if (data.success) {
    const type = file.type.startsWith('video') ? 'video' : 'image';
    socket.emit('send_message', {
      sender: currentUser,
      receiver: currentTarget,
      mediaUrl: data.url,
      mediaType: type
    });
  }
}

// VOICE RECORDING
async function toggleVoiceRecord() {
  const btn = document.getElementById('voice-btn');
  if (!isRecording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('mediaFile', audioBlob, 'voice-note.webm');

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        socket.emit('send_message', {
          sender: currentUser,
          receiver: currentTarget,
          mediaUrl: data.url,
          mediaType: 'audio'
        });
      }
    };

    mediaRecorder.start();
    isRecording = true;
    btn.style.color = '#ef4444';
  } else {
    mediaRecorder.stop();
    isRecording = false;
    btn.style.color = 'white';
  }
}

// RENDER MESSAGE IN UI WITH SENDER BADGES
function appendMessageUI(msg) {
  const list = document.getElementById('messages-list');
  const isMine = msg.sender === currentUser;

  const div = document.createElement('div');
  div.id = `msg-${msg._id}`;
  div.style.cssText = `margin-bottom:12px; text-align:${isMine ? 'right' : 'left'};`;

  // Always show Sender Badge on top of bubble (Media & Text)
  const senderBadge = `<small style="display:block; color:${isMine ? '#bae6fd' : '#38bdf8'}; font-weight:bold; font-size:11px; margin-bottom:4px;">${msg.sender}</small>`;

  let mediaContent = '';
  if (msg.mediaType === 'image') {
    mediaContent = `<img src="${msg.mediaUrl}" style="max-width:220px; border-radius:8px; display:block; margin-top:4px;">`;
  } else if (msg.mediaType === 'video') {
    mediaContent = `<video src="${msg.mediaUrl}" controls style="max-width:220px; border-radius:8px; display:block; margin-top:4px;"></video>`;
  } else if (msg.mediaType === 'audio') {
    mediaContent = `<audio src="${msg.mediaUrl}" controls style="max-width:220px; margin-top:4px;"></audio>`;
  } else {
    mediaContent = `<span id="text-${msg._id}">${msg.text}${msg.isEdited ? ' <small style="color:#94a3b8;">(edited)</small>' : ''}</span>`;
  }

  const readMark = isMine ? `<span id="read-${msg._id}">${msg.isRead ? ' ✓✓' : ' ✓'}</span>` : '';

  div.innerHTML = `
    <div onclick="handleMessageClick('${msg._id}', '${msg.sender}', '${msg.text}')" style="display:inline-block; background:${isMine ? '#0284c7' : '#334155'}; padding:10px 14px; border-radius:12px; cursor:pointer; text-align:left;">
      ${senderBadge}
      ${mediaContent}
      <div style="text-align:right; margin-top:4px;">
        <small style="font-size:10px; color:#cbd5e1;">${readMark}</small>
      </div>
    </div>
  `;

  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

// SENDER MENU
function handleMessageClick(msgId, sender, text) {
  if (sender !== currentUser) {
    if (text) {
      navigator.clipboard.writeText(text);
      alert('Copied message text!');
    }
    return;
  }

  const action = prompt("Sender Options:\n1. Copy\n2. Edit\n3. Delete", "1");
  if (action === "1") {
    if (text) navigator.clipboard.writeText(text);
    alert('Copied!');
  } else if (action === "2") {
    const newText = prompt("Edit message:", text);
    if (newText) {
      fetch(`/api/messages/${msgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: currentUser, text: newText })
      });
    }
  } else if (action === "3") {
    if (confirm("Delete this message?")) {
      fetch(`/api/messages/${msgId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: currentUser })
      });
    }
  }
}

// SWITCH TABS
function switchTab(tab) {
  if (tab === 'admin') {
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'block';
    loadAdminData();
  } else {
    document.getElementById('admin-dashboard').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
  }
}

async function loadAdminData() {
  const res = await fetch('/api/admin/data');
  const data = await res.json();
  if (data.success) {
    document.getElementById('admin-users-list').innerHTML = data.users.map(u => `<li>${u.username} ${u.isAdmin ? '(Admin)' : ''}</li>`).join('');
    document.getElementById('admin-messages-log').innerHTML = data.messages.map(m => `<div>[${m.sender} ➔ ${m.receiver}]: ${m.text || m.mediaType}</div>`).join('');
  }
}

// Auto restore login session
window.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    document.body.classList.remove('logged-out');
    document.getElementById('auth-card').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
    loadContacts();
    selectChat('Global');
  }
});
