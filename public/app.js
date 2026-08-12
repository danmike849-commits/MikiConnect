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

        const currentUser = localStorage.getItem("username") || "Anonymous";

        feedContainer.innerHTML = posts.map(p => {
            const id = p._id || p.id;
            const author = p.username || "Anonymous";
            const body = p.content || p.text || "";
            const time = p.createdAt ? new Date(p.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "";
            const color = typeof getUserColor === "function" ? getUserColor(author) : "#40c057";

            const likes = p.likes || [];
            const comments = p.comments || [];
            const hasLiked = likes.includes(currentUser);

            const commentsHtml = comments.map(c => `
                <div style="background:#1c1e22; border-radius:6px; padding:6px 10px; margin-top:6px; font-size:13px;">
                    <strong style="color:#40c057;">@${c.username || 'User'}:</strong> 
                    <span style="color:#ddd;">${c.text}</span>
                </div>
            `).join("");

            return `
                <div style="background:#25282c; border-radius:8px; padding:12px; margin-bottom:12px; border:1px solid #333;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <strong style="color:${color}">@${author}</strong>
                        <small style="color:#777">${time}</small>
                    </div>
                    <div style="color:#eee; font-size:14px; white-space:pre-wrap; word-break:break-word; margin-bottom:10px;">${body}</div>

                    <!-- Action Bar -->
                    <div style="display:flex; gap:10px; border-top:1px solid #333; padding-top:8px; align-items:center;">
                        <button onclick="toggleLike('${id}')" style="background:${hasLiked ? '#2b5235' : '#333'}; color:${hasLiked ? '#40c057' : '#ccc'}; border:none; padding:5px 12px; border-radius:4px; font-size:12px; cursor:pointer;">
                            ${hasLiked ? '❤️ Liked' : '🤍 Like'} (${likes.length})
                        </button>
                        <span style="color:#888; font-size:12px;">💬 ${comments.length} Comments</span>
                    </div>

                    <!-- Comments List -->
                    <div style="margin-top:8px;">
                        ${commentsHtml}
                    </div>

                    <!-- Comment Input -->
                    <div style="display:flex; gap:6px; margin-top:8px;">
                        <input type="text" id="comment-input-${id}" placeholder="Write a comment..." style="flex:1; background:#181a1d; border:1px solid #444; color:#fff; border-radius:4px; padding:6px 8px; font-size:12px;" />
                        <button onclick="submitComment('${id}')" style="background:#40c057; color:#fff; border:none; padding:6px 10px; border-radius:4px; font-size:12px; cursor:pointer;">Send</button>
                    </div>
                </div>
            `;
        }).join("");
    } catch(err) {
        feedContainer.innerHTML = `<div style="padding:15px; color:#ff6b6b; text-align:center;">Feed error: ${err.message}</div>`;
    }
}

async function toggleLike(postId) {
    try {
        const username = localStorage.getItem("username") || "Anonymous";
        await fetch(`/api/posts/${postId}/like`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username })
        });
        loadFeed();
    } catch(err) {
        console.error("Like error:", err);
    }
}

async function submitComment(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    if (!input || !input.value.trim()) return;

    try {
        const username = localStorage.getItem("username") || "Anonymous";
        const res = await fetch(`/api/posts/${postId}/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, text: input.value.trim() })
        });

        if (res.ok) {
            input.value = "";
            loadFeed();
        }
    } catch(err) {
        console.error("Comment error:", err);
    }
}

window.loadFeed = loadFeed;
window.toggleLike = toggleLike;
window.submitComment = submitComment;


function showAuthMode(mode) {
    const regSec = document.getElementById("register-section");
    const loginSec = document.getElementById("login-section");
    if (mode === "login") {
        if (regSec) regSec.style.display = "none";
        if (loginSec) loginSec.style.display = "block";
    } else {
        if (regSec) regSec.style.display = "block";
        if (loginSec) loginSec.style.display = "none";
    }
}

async function register() {
    const user = document.getElementById("reg-user")?.value.trim();
    const email = document.getElementById("reg-email")?.value.trim();
    const pass = document.getElementById("reg-pass")?.value.trim();

    if (!user || !email || !pass) {
        alert("Please fill in all registration fields.");
        return;
    }

    try {
        const res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: user, email, password: pass })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(data.error || "Registration failed.");
            return;
        }

        alert("Registration successful! Switching to login...");
        
        // Auto-fill login ID field with registered username/email
        const loginId = document.getElementById("login-id");
        if (loginId) loginId.value = user;

        // Switch screen to Login view
        showAuthMode("login");
    } catch(err) {
        alert("Registration error: " + err.message);
    }
}

window.showAuthMode = showAuthMode;
window.register = register;




window.loadUsersList = loadUsersList;
window.loadUsers = loadUsersList;


function checkAdminAccess() {
    const currentUser = (localStorage.getItem("username") || "").trim().toLowerCase();
    const adminBtn = document.getElementById("nav-admin");
    
    if (adminBtn) {
        if (currentUser === "admin") {
            adminBtn.style.display = "block";
        } else {
            adminBtn.style.display = "none";
            const adminTab = document.getElementById("admin-tab");
            if (adminTab && adminTab.style.display !== "none") {
                if (typeof switchTab === "function") switchTab("feed");
            }
        }
    }
}





document.addEventListener("DOMContentLoaded", checkAdminAccess);
window.checkAdminAccess = checkAdminAccess;
window.login = login;
window.loadUsersList = loadUsersList;


function checkAdminAccess() {
    const currentUser = (localStorage.getItem("username") || "").trim().toLowerCase();
    const adminBtn = document.getElementById("nav-admin");
    
    if (adminBtn) {
        if (currentUser === "admin") {
            adminBtn.style.display = "block";
        } else {
            adminBtn.style.display = "none";
            const adminTab = document.getElementById("admin-tab");
            if (adminTab && adminTab.style.display !== "none") {
                if (typeof switchTab === "function") switchTab("feed");
            }
        }
    }
}

async function login() {
    const loginId = document.getElementById("login-id")?.value.trim();
    const pass = document.getElementById("login-pass")?.value.trim();

    if (!loginId || !pass) {
        alert("Please enter both username/email and password.");
        return;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: loginId, password: pass })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(data.error || "Login failed.");
            return;
        }

        const authenticatedUsername = data.user?.username || loginId;
        localStorage.setItem("username", authenticatedUsername);
        alert("Logged in successfully as @" + authenticatedUsername);

        checkAdminAccess();
        if (typeof switchTab === "function") {
            switchTab(authenticatedUsername.toLowerCase() === "admin" ? "admin" : "feed");
        }
    } catch(err) {
        alert("Login error: " + err.message);
    }
}



document.addEventListener("DOMContentLoaded", checkAdminAccess);
window.checkAdminAccess = checkAdminAccess;
window.login = login;
window.loadUsersList = loadUsersList;


async function loadUsersList() {
    const display = document.getElementById("admin-users-display");
    const countBadge = document.getElementById("admin-total-users");
    if (!display) return;

    display.innerHTML = "<p style='color: #aaa; text-align: center;'>Loading users...</p>";

    try {
        const res = await fetch("/api/admin/users");
        const users = await res.json();

        if (!Array.isArray(users) || users.length === 0) {
            display.innerHTML = "<p style='color: #aaa; text-align: center;'>No registered users found.</p>";
            if (countBadge) countBadge.innerText = "0 Users";
            return;
        }

        if (countBadge) countBadge.innerText = users.length + " Users";

        display.innerHTML = users.map(u => {
            const uid = u._id || u.id;
            const regDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "N/A";
            return `
                <div style="background: #181a1d; padding: 12px; border-radius: 6px; border: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="color: #fff; font-weight: bold;">@${u.username}</div>
                        <div style="color: #888; font-size: 12px;">${u.email} • Registered: ${regDate}</div>
                    </div>
                    ${uid !== "1" ? `<button onclick="deleteUser('${uid}')" style="background: #e03131; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; font-size: 12px; cursor: pointer;">Delete</button>` : '<span style="color: #40c057; font-size: 12px;">System</span>'}
                </div>
            `;
        }).join("");
    } catch (err) {
        display.innerHTML = "<p style='color: #ff6b6b;'>Failed to load users: " + err.message + "</p>";
    }
}

async function deleteUser(userId) {
    if (!confirm("Are you sure you want to delete this user account?")) return;

    try {
        const res = await fetch("/api/admin/users/" + userId, {
            method: "DELETE"
        });
        const data = await res.json();

        if (!res.ok) {
            alert(data.error || "Failed to delete user.");
            return;
        }

        alert("User deleted successfully.");
        loadUsersList();
    } catch (err) {
        alert("Delete error: " + err.message);
    }
}

window.loadUsersList = loadUsersList;
window.deleteUser = deleteUser;


// Audio Notification Player using Web Audio API
function playChatNotification() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 tone
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
}

let adminChartInstance = null;

async function renderAdminChart() {
    const canvas = document.getElementById("adminStatsChart");
    if (!canvas || typeof Chart === "undefined") return;

    try {
        const res = await fetch("/api/admin/stats");
        const stats = await res.json();

        if (adminChartInstance) {
            adminChartInstance.destroy();
        }

        const ctx = canvas.getContext("2d");
        adminChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: ["Users", "Posts", "Chat Messages"],
                datasets: [{
                    label: "Activity Metrics",
                    data: [stats.users || 0, stats.posts || 0, stats.chats || 0],
                    backgroundColor: ["#40c057", "#339af0", "#cc5de8"],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { color: "#888" }, grid: { color: "#222" } },
                    x: { ticks: { color: "#fff" }, grid: { display: false } }
                }
            }
        });
    } catch (err) {
        console.error("Failed to render chart:", err);
    }
}

let lastChatCount = 0;

async function loadChat() {
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer) return;

    try {
        const res = await fetch("/api/chat");
        const data = await res.json();
        const messages = data.messages || [];

        // Play audio alert if new message received
        if (messages.length > lastChatCount && lastChatCount !== 0) {
            playChatNotification();
        }
        lastChatCount = messages.length;

        if (messages.length === 0) {
            chatContainer.innerHTML = "<p style='color:#888; text-align:center;'>No chat messages yet. Start the conversation!</p>";
            return;
        }

        const currentUser = localStorage.getItem("username") || "Anonymous";

        chatContainer.innerHTML = messages.map(m => {
            const isMe = m.username === currentUser;
            const msgId = m.id || "";
            return `
                <div style="background: ${isMe ? '#1e3a24' : '#25282c'}; border: 1px solid ${isMe ? '#2b5235' : '#333'}; padding: 10px; border-radius: 6px; width: 85%; align-self: ${isMe ? 'flex-end' : 'flex-start'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong style="color: ${isMe ? '#40c057' : '#339af0'}; font-size: 13px;">@${m.username}</strong>
                        ${msgId ? `<button onclick="deleteChatMessage('${msgId}')" style="background: none; border: none; color: #ff6b6b; font-size: 11px; cursor: pointer;">Delete</button>` : ''}
                    </div>
                    ${m.content ? `<div style="color: #fff; font-size: 14px; word-break: break-word;">${m.content}</div>` : ''}
                    ${m.imageUrl ? `<img src="${m.imageUrl}" style="max-width: 100%; max-height: 180px; border-radius: 6px; margin-top: 6px; display: block;" onerror="this.style.display='none'" />` : ''}
                </div>
            `;
        }).join("");

        // Auto-scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    } catch (err) {
        console.error("Chat fetch error:", err);
    }
}

async function sendChatMessage() {
    const input = document.getElementById("chat-msg-input");
    const imgInput = document.getElementById("chat-img-input");
    const msg = input?.value.trim();
    const imgUrl = imgInput?.value.trim();
    const username = localStorage.getItem("username") || "Anonymous";

    if (!msg && !imgUrl) return;

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, message: msg, imageUrl: imgUrl })
        });

        if (res.ok) {
            if (input) input.value = "";
            if (imgInput) imgInput.value = "";
            loadChat();
        }
    } catch (err) {
        alert("Failed to send message: " + err.message);
    }
}

async function deleteChatMessage(id) {
    if (!confirm("Delete this chat message?")) return;
    try {
        const res = await fetch("/api/chat/" + id, { method: "DELETE" });
        if (res.ok) {
            loadChat();
        }
    } catch (err) {
        alert("Error deleting message: " + err.message);
    }
}

// Global Exports
window.renderAdminChart = renderAdminChart;
window.loadChat = loadChat;
window.sendChatMessage = sendChatMessage;
window.deleteChatMessage = deleteChatMessage;

// Auto-poll chat every 3 seconds
setInterval(() => {
    const chatTab = document.getElementById("chat-tab");
    if (chatTab && chatTab.style.display !== "none") {
        loadChat();
    }
}, 3000);

// Hook chart render into Admin load
const originalLoadUsersList = window.loadUsersList;
window.loadUsersList = function() {
    if (typeof originalLoadUsersList === "function") originalLoadUsersList();
    renderAdminChart();
};
