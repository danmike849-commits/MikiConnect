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
    const idEl = document.getElementById("login-id");
    const passEl = document.getElementById("login-pass");
    const identifier = idEl ? idEl.value.trim() : "";
    const password = passEl ? passEl.value.trim() : "";

    if (!identifier || !password) {
        alert("Please enter both username/email and password.");
        return;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: identifier, password: password })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || "Login failed");
            return;
        }

        const userObj = data.user || data;
        const username = userObj.username || data.username || "User";
        const role = userObj.role || data.role || "";

        localStorage.setItem("currentUser", JSON.stringify(userObj));
        localStorage.setItem("username", username);
        localStorage.setItem("role", role);

        alert("Login successful! Welcome " + username);

        const adminBtn = document.getElementById("admin-tab-btn");
        if (role === "admin" || username.toLowerCase() === "admin") {
            if (adminBtn) adminBtn.style.display = "inline-block";
            if (typeof switchTab === "function") {
                switchTab("admin-tab", adminBtn);
            }
        } else {
            if (adminBtn) adminBtn.style.display = "none";
            location.reload();
        }
    } catch (e) {
        alert("Login error: " + e.message);
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
    const textEl = document.querySelector("#post-text, #post-input, textarea, input[placeholder*='mind']");
    const text = textEl ? textEl.value.trim() : "";
    
    if (!text) {
        alert("Please write something before posting.");
        return;
    }

    try {
        const username = localStorage.getItem("username") || "Anonymous";
        const res = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, content: text, text })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(data.error || "Failed to create post.");
            return;
        }

        if (textEl) textEl.value = "";
        alert("Post created successfully!");
        if (typeof loadFeed === "function") loadFeed();
    } catch (e) {
        alert("Post error: " + e.message);
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
async function sendChatMessage(type) {
    const inputEl = document.getElementById("chat-msg-input");
    const message = inputEl ? inputEl.value.trim() : "";

    if (!message) {
        alert("Please type a message first.");
        return;
    }

    const username = localStorage.getItem("username") || "Anonymous";

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, message, type: type || "public" })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(data.error || "Failed to send message.");
            return;
        }

        if (inputEl) inputEl.value = "";
        
        // Append message to box immediately or reload chat
        const chatBox = document.getElementById("public-chat-box");
        if (chatBox) {
            const msgDiv = document.createElement("div");
            msgDiv.style.cssText = "margin: 6px 0; padding: 6px 10px; background: #2b2b2b; border-radius: 6px;";
            msgDiv.innerHTML = `<strong style="color:#40c057">@${username}:</strong> ${message}`;
            chatBox.appendChild(msgDiv);
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        if (typeof loadChat === "function") loadChat();
    } catch (e) {
        alert("Chat send error: " + e.message);
    }
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

// --- OVERRIDE LOGIN FUNCTION ---
window.login = async function() {
    const idEl = document.getElementById("login-id");
    const passEl = document.getElementById("login-pass");
    const identifier = idEl ? idEl.value.trim() : "";
    const password = passEl ? passEl.value.trim() : "";

    if (!identifier || !password) {
        alert("Please enter both username/email and password.");
        return;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: identifier, password: password })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || "Login failed");
            return;
        }

        const userObj = data.user || data;
        const username = userObj.username || data.username || "User";

        localStorage.setItem("currentUser", JSON.stringify(userObj));
        localStorage.setItem("username", username);

        alert("Login successful! Welcome " + username);
        location.reload();
    } catch (e) {
        alert("Login error: " + e.message);
    }
};

// --- OVERRIDE LOGIN FUNCTION ---
window.login = async function() {
    const idEl = document.getElementById("login-id");
    const passEl = document.getElementById("login-pass");
    const identifier = idEl ? idEl.value.trim() : "";
    const password = passEl ? passEl.value.trim() : "";

    if (!identifier || !password) {
        alert("Please enter both username/email and password.");
        return;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: identifier, password: password })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || "Login failed");
            return;
        }

        const userObj = data.user || data;
        const username = userObj.username || data.username || "User";

        localStorage.setItem("currentUser", JSON.stringify(userObj));
        localStorage.setItem("username", username);

        alert("Login successful! Welcome " + username);
        location.reload();
    } catch (e) {
        alert("Login error: " + e.message);
    }
};

// Global window bindings for HTML onclick attributes
window.sendMessage = typeof sendChatMessage === "function" ? sendChatMessage : function(){};
window.getUserColor = typeof getUserColor !== "undefined" ? getUserColor : function(){};
window.switchTab = typeof switchTab !== "undefined" ? switchTab : function(){};
window.updateAuthUI = typeof updateAuthUI !== "undefined" ? updateAuthUI : function(){};
window.register = typeof register !== "undefined" ? register : function(){};
window.login = typeof login !== "undefined" ? login : function(){};
window.logout = typeof logout !== "undefined" ? logout : function(){};
window.fileToBase64 = typeof fileToBase64 !== "undefined" ? fileToBase64 : function(){};
window.previewMedia = typeof previewMedia !== "undefined" ? previewMedia : function(){};
window.loadFeed = typeof loadFeed !== "undefined" ? loadFeed : function(){};
window.createPost = typeof createPost !== "undefined" ? createPost : function(){};
window.toggleLike = typeof toggleLike !== "undefined" ? toggleLike : function(){};
window.toggleVoiceRecord = typeof toggleVoiceRecord !== "undefined" ? toggleVoiceRecord : function(){};
window.addEmoji = typeof addEmoji !== "undefined" ? addEmoji : function(){};
window.sendChatMessage = typeof sendChatMessage !== "undefined" ? sendChatMessage : function(){};
window.loadGroups = typeof loadGroups !== "undefined" ? loadGroups : function(){};
window.createGroup = typeof createGroup !== "undefined" ? createGroup : function(){};
window.loadAdminUsers = typeof loadAdminUsers !== "undefined" ? loadAdminUsers : function(){};
window.deleteUser = typeof deleteUser !== "undefined" ? deleteUser : function(){};
window.getUserColor = typeof getUserColor !== "undefined" ? getUserColor : function(){};
window.switchTab = typeof switchTab !== "undefined" ? switchTab : function(){};
window.updateAuthUI = typeof updateAuthUI !== "undefined" ? updateAuthUI : function(){};
window.register = typeof register !== "undefined" ? register : function(){};
window.login = typeof login !== "undefined" ? login : function(){};
window.logout = typeof logout !== "undefined" ? logout : function(){};
window.fileToBase64 = typeof fileToBase64 !== "undefined" ? fileToBase64 : function(){};
window.previewMedia = typeof previewMedia !== "undefined" ? previewMedia : function(){};
window.loadFeed = typeof loadFeed !== "undefined" ? loadFeed : function(){};
window.createPost = typeof createPost !== "undefined" ? createPost : function(){};
window.toggleLike = typeof toggleLike !== "undefined" ? toggleLike : function(){};
window.toggleVoiceRecord = typeof toggleVoiceRecord !== "undefined" ? toggleVoiceRecord : function(){};
window.addEmoji = typeof addEmoji !== "undefined" ? addEmoji : function(){};
window.sendChatMessage = typeof sendChatMessage !== "undefined" ? sendChatMessage : function(){};
window.loadGroups = typeof loadGroups !== "undefined" ? loadGroups : function(){};
window.createGroup = typeof createGroup !== "undefined" ? createGroup : function(){};
window.loadAdminUsers = typeof loadAdminUsers !== "undefined" ? loadAdminUsers : function(){};
window.deleteUser = typeof deleteUser !== "undefined" ? deleteUser : function(){};
if (typeof getUserColor !== 'undefined') window.getUserColor = getUserColor;
if (typeof switchTab !== 'undefined') window.switchTab = switchTab;
if (typeof updateAuthUI !== 'undefined') window.updateAuthUI = updateAuthUI;
if (typeof register !== 'undefined') window.register = register;
if (typeof login !== 'undefined') window.login = login;
if (typeof logout !== 'undefined') window.logout = logout;
if (typeof fileToBase64 !== 'undefined') window.fileToBase64 = fileToBase64;
if (typeof previewMedia !== 'undefined') window.previewMedia = previewMedia;
if (typeof loadFeed !== 'undefined') window.loadFeed = loadFeed;
if (typeof createPost !== 'undefined') window.createPost = createPost;
if (typeof toggleLike !== 'undefined') window.toggleLike = toggleLike;
if (typeof toggleVoiceRecord !== 'undefined') window.toggleVoiceRecord = toggleVoiceRecord;
if (typeof addEmoji !== 'undefined') window.addEmoji = addEmoji;
if (typeof sendChatMessage !== 'undefined') window.sendChatMessage = sendChatMessage;
if (typeof loadGroups !== 'undefined') window.loadGroups = loadGroups;
if (typeof createGroup !== 'undefined') window.createGroup = createGroup;
if (typeof loadAdminUsers !== 'undefined') window.loadAdminUsers = loadAdminUsers;
if (typeof deleteUser !== 'undefined') window.deleteUser = deleteUser;
if (typeof loadGroupChat !== 'undefined') window.loadGroupChat = loadGroupChat;

setInterval(() => {
        if (typeof loadChat === "function" && document.getElementById("chat-tab")?.classList.contains("active")) {
            loadChat();
        }
    }, 3000);
