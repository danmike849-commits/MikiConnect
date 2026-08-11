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
    const contents = document.querySelectorAll(".tab-content");
    contents.forEach(c => c.classList.remove("active"));
    
    const tabs = document.querySelectorAll(".nav-tab");
    tabs.forEach(t => t.classList.remove("active"));

    const targetContent = document.getElementById(tabId);
    if (targetContent) targetContent.classList.add("active");
    if (element) element.classList.add("active");

    if (tabId === "admin-tab" && typeof loadAdminUsers === "function") {
        loadAdminUsers();
    }
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
    const feedContainer = document.getElementById("feed-container");
    if (!feedContainer) return;

    try {
        const res = await fetch("/api/posts?v=" + Date.now());
        if (!res.ok) {
            feedContainer.innerHTML = `<div style="padding:15px; color:#ff6b6b; text-align:center;">Error ${res.status}: Failed to load feed</div>`;
            return;
        }

        const data = await res.json();
        const posts = Array.isArray(data) ? data : (data.posts || []);

        if (posts.length === 0) {
            feedContainer.innerHTML = `<div style="padding:25px; text-align:center; color:#888;">No posts yet. Be the first to post!</div>`;
            return;
        }

        feedContainer.innerHTML = posts.map(p => {
            const author = p.username || "Anonymous";
            const body = p.content || p.text || "";
            const time = p.createdAt ? new Date(p.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "";
            const color = typeof getUserColor === "function" ? getUserColor(author) : "#40c057";

            return `
                <div style="background:#25282c; border-radius:8px; padding:12px; margin-bottom:12px; border:1px solid #333;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <strong style="color:${color}">@${author}</strong>
                        <small style="color:#777">${time}</small>
                    </div>
                    <div style="color:#eee; font-size:14px; white-space:pre-wrap; word-break:break-word;">${body}</div>
                </div>
            `;
        }).join("");
    } catch(err) {
        feedContainer.innerHTML = `<div style="padding:15px; color:#ff6b6b; text-align:center;">Feed error: ${err.message}</div>`;
    }
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
    const list = document.getElementById("admin-user-list");
    if (!list) return;

    list.innerHTML = "<li style='padding: 10px; color: #aaa;'>Loading users from server...</li>";

    try {
        const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
        const res = await fetch("/api/admin/users", {
            headers: {
                "Content-Type": "application/json",
                "x-user-role": localStorage.getItem("role") || "",
                "x-username": localStorage.getItem("username") || ""
            }
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            list.innerHTML = `<li style="padding: 10px; color: #ff6b6b;">Error ${res.status}: ${errData.error || "Failed to load users"}</li>`;
            return;
        }

        const data = await res.json();
        const users = Array.isArray(data) ? data : (data.users || []);

        if (users.length === 0) {
            list.innerHTML = "<li style='padding: 10px; color: #888;'>No registered users found.</li>";
            return;
        }

        list.innerHTML = "";
        users.forEach(u => {
            const li = document.createElement("li");
            li.style.cssText = "padding: 10px; margin-bottom: 6px; background: #25282c; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;";
            const isAdmin = u.isAdmin || u.role === "admin";
            const color = typeof getUserColor === "function" ? getUserColor(u.username) : "#40c057";

            li.innerHTML = `
                <div>
                    <strong style="color:${color}; font-size: 15px;">@${u.username || "User"}</strong>
                    <div style="font-size: 12px; color: #aaa;">${u.email || "No email"}</div>
                </div>
                <div>
                    ${isAdmin ? "<span style='color:#40c057; font-weight:bold; font-size:12px; margin-right:8px;'>[ADMIN]</span>" : `<button onclick="deleteUser('${u._id || u.id}')" style="background:#e74c3c; color:#fff; border:none; padding:5px 10px; border-radius:4px; font-size:12px; cursor:pointer;">Delete</button>`}
                </div>
            `;
            list.appendChild(li);
        });
    } catch (err) {
        list.innerHTML = `<li style="padding: 10px; color: #ff6b6b;">Network error: ${err.message}</li>`;
    }
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

window.switchTab = switchTab;
window.loadAdminUsers = loadAdminUsers;

window.loadFeed = loadFeed;

// Feed auto-poll
setInterval(() => {
    const feedTab = document.getElementById("feed-tab");
    if (typeof loadFeed === "function" && feedTab && feedTab.classList.contains("active")) {
        loadFeed();
    }
}, 4000);
