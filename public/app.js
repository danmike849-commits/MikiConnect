let socket = typeof io !== 'undefined' ? io() : null;
let currentUser = localStorage.getItem('miki_user') || '';
let isAdminUser = false;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

if (socket) {
  socket.on('new_message', (msg) => {
    appendMessageUI(msg);
    if (msg.receiver === currentUser && !msg.isRead) {
      socket.emit('mark_read', { messageId: msg._id });
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

// LOGIN API
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
  } else {
    alert(data.message);
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
    receiver: 'Global',
    text: input.value,
    mediaType: 'text'
  });
  input.value = '';
}

// UPLOAD MEDIA (Image / Video)
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
      receiver: 'Global',
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
          receiver: 'Global',
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

// RENDER MESSAGE IN UI
function appendMessageUI(msg) {
  const list = document.getElementById('messages-list');
  const isMine = msg.sender === currentUser;

  const div = document.createElement('div');
  div.id = `msg-${msg._id}`;
  div.style.cssText = `margin-bottom:10px; text-align:${isMine ? 'right' : 'left'};`;

  let body = '';
  if (msg.mediaType === 'image') body = `<img src="${msg.mediaUrl}" style="max-width:200px; border-radius:8px;">`;
  else if (msg.mediaType === 'video') body = `<video src="${msg.mediaUrl}" controls style="max-width:200px; border-radius:8px;"></video>`;
  else if (msg.mediaType === 'audio') body = `<audio src="${msg.mediaUrl}" controls></audio>`;
  else body = `<span id="text-${msg._id}">${msg.text}${msg.isEdited ? ' <small style="color:#94a3b8;">(edited)</small>' : ''}</span>`;

  const readMark = isMine ? `<span id="read-${msg._id}">${msg.isRead ? ' ✓✓' : ' ✓'}</span>` : '';

  div.innerHTML = `
    <div onclick="handleMessageClick('${msg._id}', '${msg.sender}', '${msg.text}')" style="display:inline-block; background:${isMine ? '#0284c7' : '#334155'}; padding:8px 12px; border-radius:8px; cursor:pointer;">
      <small style="display:block; color:#cbd5e1; font-size:10px;">${msg.sender}</small>
      ${body}
      <small style="font-size:10px; color:#cbd5e1;">${readMark}</small>
    </div>
  `;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

// SENDER-ONLY ACTION MENU (Edit / Delete / Copy)
function handleMessageClick(msgId, sender, text) {
  if (sender !== currentUser) {
    navigator.clipboard.writeText(text);
    alert('Message text copied!');
    return;
  }

  const action = prompt("Sender Menu:\n1. Copy\n2. Edit\n3. Delete", "1");
  if (action === "1") {
    navigator.clipboard.writeText(text);
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

// TABS SWITCHING
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
    const uList = document.getElementById('admin-users-list');
    uList.innerHTML = data.users.map(u => `<li>${u.username} ${u.isAdmin ? '(Admin)' : ''}</li>`).join('');
    
    const mLog = document.getElementById('admin-messages-log');
    mLog.innerHTML = data.messages.map(m => `<div>[${m.sender}]: ${m.text || m.mediaType}</div>`).join('');
  }
}
