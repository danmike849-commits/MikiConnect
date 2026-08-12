// Global App JavaScript
let adminChartInstance = null;
let lastChatCount = 0;

// TAB NAVIGATION


function switchTab(tabName) {
    const user = localStorage.getItem("username");
    const isAuthenticated = user && user !== "null" && user !== "undefined" && user.trim() !== "";

    // Force redirect to account tab if user is not logged in
    if (!isAuthenticated && tabName !== "account") {
        tabName = "account";
        const banner = document.getElementById("auth-notice-banner");
        if (banner) {
            banner.style.display = "block";
            banner.innerText = "🔒 Access Denied: Please log in or register to view MikiConnect.";
        }
    }

    // Hide all tab contents
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(t => t.style.display = 'none');

    // Remove active class from nav items
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(n => n.classList.remove('active'));

    // Display selected tab
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) selectedTab.style.display = 'block';

    const selectedNav = document.getElementById('nav-' + tabName);
    if (selectedNav) selectedNav.classList.add('active');
}
window.switchTab = switchTab;



// AUTH FUNCTIONS






function checkAuthState() {
    const user = localStorage.getItem("username");
    const isAuthenticated = user && user !== "null" && user !== "undefined" && user.trim() !== "";
    
    const profileCard = document.getElementById("user-profile-card");
    const authContainer = document.getElementById("auth-container");
    const nameDisplay = document.getElementById("user-display-name");
    const adminBtn = document.getElementById("nav-admin");
    const accountNavBtn = document.getElementById("nav-account");

    const isCreator = isAuthenticated && (user.toLowerCase() === "admin" || user.toLowerCase() === "mikedan849@gmail.com");

    if (adminBtn) {
        adminBtn.style.display = isCreator ? "inline-block" : "none";
    }

    if (isAuthenticated) {
        // LOGGED IN: Show app navigation bar and profile
        document.body.classList.remove("logged-out");
        if (profileCard) profileCard.style.display = "block";
        if (authContainer) authContainer.style.display = "none";
        if (nameDisplay) nameDisplay.innerText = "@" + user;
        if (accountNavBtn) accountNavBtn.innerText = "@" + user;
    } else {
        // LOGGED OUT: Hide top navbar completely, enforce clean gateway screen
        document.body.classList.add("logged-out");
        if (profileCard) profileCard.style.display = "none";
        if (authContainer) authContainer.style.display = "block";
        if (accountNavBtn) accountNavBtn.innerText = "Account (Login)";
        
        switchTab("account");
    }
}




function logoutUser() {
    localStorage.removeItem("username");
    alert("You have been logged out.");
    checkAuthState();
}

window.checkAuthState = checkAuthState;
window.logoutUser = logoutUser;

// Run check on initial script load
document.addEventListener("DOMContentLoaded", function() {
    checkAuthState();
});


function logoutUser() {
    localStorage.removeItem("username");
    alert("You have logged out.");
    checkAuthState();
}
window.logoutUser = logoutUser;



function showAuthMode(mode) {
    document.getElementById("register-section").style.display = mode === "register" ? "block" : "none";
    document.getElementById("login-section").style.display = mode === "login" ? "block" : "none";
}

async function register() {
    const u = document.getElementById("reg-user").value.trim();
    const e = document.getElementById("reg-email").value.trim();
    const p = document.getElementById("reg-pass").value.trim();

    if (!u || !e || !p) return alert("All fields are required.");

    try {
        const res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, email: e, password: p })
        });
        const data = await res.json();
        if (!res.ok) return alert(data.error || "Registration failed.");

        alert("Registered successfully! Please login.");
        document.getElementById("login-id").value = u;
        showAuthMode("login");
    } catch(err) {
        alert("Registration error: " + err.message);
    }
}

async function login() {
    const id = document.getElementById("login-id").value.trim();
    const p = document.getElementById("login-pass").value.trim();

    if (!id || !p) return alert("Please fill in all credentials.");

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: id, password: p })
        });
        const data = await res.json();
        if (!res.ok) return alert(data.error || "Login failed.");

        localStorage.setItem("username", id);
        alert("Logged in successfully!");
        checkAuthState();
        switchTab("feed");
    } catch(err) {
        alert("Login error: " + err.message);
    }
}

function logout() {
    localStorage.removeItem("username");
    alert("Logged out successfully.");
    checkAuthState();
    showAuthMode("login");
}

// FEED FUNCTIONS
async function loadFeed() {
    const container = document.getElementById("feed-posts");
    if (!container) return;

    try {
        const res = await fetch("/api/posts");
        const posts = await res.json();

        if (posts.length === 0) {
            container.innerHTML = "<div class='card' style='text-align:center; color:#888;'>No posts yet.</div>";
            return;
        }

        container.innerHTML = posts.map(p => `
            <div class="card">
                <div onclick="requestPrivateChat('${p.username}')" style="color:#40c057; font-weight:bold; margin-bottom:5px; cursor:pointer;">@${p.username} <span style="font-size:11px; color:#339af0;">(Tap to DM)</span></div>
                <div style="color:#fff; font-size:14px;">${p.content}</div>
            </div>
        `).join("");
    } catch(err) {
        console.error("Feed error:", err);
    }
}

async function createPost() {
    const input = document.getElementById("post-input");
    const content = input.value.trim();
    const username = localStorage.getItem("username") || "Anonymous";

    if (!content) return alert("Post content cannot be empty.");

    try {
        const res = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, content })
        });
        if (res.ok) {
            input.value = "";
            loadFeed();
        }
    } catch(err) {
        alert("Error creating post: " + err.message);
    }
}

// LIVE CHAT FUNCTIONS
async function loadChat() {
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer) return;

    try {
        const res = await fetch("/api/chat");
        const data = await res.json();
        const messages = data.messages || [];

        if (messages.length === 0) {
            chatContainer.innerHTML = "<p style='color:#888; text-align:center;'>No messages yet.</p>";
            return;
        }

        const currentUser = localStorage.getItem("username") || "Anonymous";

        chatContainer.innerHTML = messages.map(m => {
            const isMe = m.username === currentUser;
            return `
                <div style="background: ${isMe ? '#1e3a24' : '#25282c'}; padding: 8px 12px; border-radius: 6px; align-self: ${isMe ? 'flex-end' : 'flex-start'}; max-width: 80%;">
                    <div style="display:flex; justify-content:space-between; gap:10px;">
                        <strong style="color: ${isMe ? '#40c057' : '#339af0'}; font-size:12px;">@${m.username}</strong>
                        ${m.id ? `<button onclick="deleteChatMessage('${m.id}')" style="background:none; border:none; color:#ff6b6b; font-size:10px; cursor:pointer;">delete</button>` : ''}
                    </div>
                    ${m.content ? `<div style="color:#fff; font-size:13px; margin-top:2px;">${m.content}</div>` : ''}
                    ${m.imageUrl ? `<img src="${m.imageUrl}" style="max-width:100%; border-radius:4px; margin-top:4px;" onerror="this.style.display='none'" />` : ''}
                </div>
            `;
        }).join("");

        chatContainer.scrollTop = chatContainer.scrollHeight;
    } catch(err) {
        console.error("Chat error:", err);
    }
}

async function sendChatMessage() {
    const input = document.getElementById("chat-msg-input");
    const imgInput = document.getElementById("chat-img-input");
    const msg = input.value.trim();
    const imgUrl = imgInput.value.trim();
    const username = localStorage.getItem("username") || "Anonymous";

    if (!msg && !imgUrl) return;

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, message: msg, imageUrl: imgUrl })
        });
        if (res.ok) {
            input.value = "";
            imgInput.value = "";
            loadChat();
        }
    } catch(err) {
        alert("Error sending message: " + err.message);
    }
}

async function deleteChatMessage(id) {
    if (!confirm("Delete chat message?")) return;
    try {
        const res = await fetch("/api/chat/" + id, { method: "DELETE" });
        if (res.ok) loadChat();
    } catch(err) {
        alert("Error deleting message: " + err.message);
    }
}

// ADMIN DASHBOARD FUNCTIONS
async function loadAdminData() {
    loadUsersList();
    renderAdminChart();
}

async function renderAdminChart() {
    const canvas = document.getElementById("adminStatsChart");
    if (!canvas || typeof Chart === "undefined") return;

    try {
        const res = await fetch("/api/admin/stats");
        const stats = await res.json();

        if (adminChartInstance) adminChartInstance.destroy();

        const ctx = canvas.getContext("2d");
        adminChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: ["Users", "Posts", "Chat Messages"],
                datasets: [{
                    data: [stats.users || 0, stats.posts || 0, stats.chats || 0],
                    backgroundColor: ["#40c057", "#339af0", "#cc5de8"]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: "#888" } },
                    x: { ticks: { color: "#fff" } }
                }
            }
        });
    } catch(err) {
        console.error("Chart render error:", err);
    }
}

async function loadUsersList() {
    const display = document.getElementById("admin-users-display");
    const countBadge = document.getElementById("admin-total-users");
    if (!display) return;

    try {
        const res = await fetch("/api/admin/users");
        const users = await res.json();

        if (!Array.isArray(users) || users.length === 0) {
            display.innerHTML = "<p style='color:#aaa;'>No users registered.</p>";
            if (countBadge) countBadge.innerText = "0 Users";
            return;
        }

        if (countBadge) countBadge.innerText = users.length + " Users";

        display.innerHTML = users.map(u => {
            const uid = u._id || u.id;
            return `
                <div style="background:#181a1d; padding:10px; border-radius:6px; border:1px solid #333; display:flex; justify-space-between; align-items:center;">
                    <div>
                        <div style="color:#fff; font-weight:bold;">@${u.username}</div>
                        <div style="color:#888; font-size:11px;">${u.email}</div>
                    </div>
                    ${uid !== "1" ? `<button onclick="deleteUser('${uid}')" style="background:#e03131; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Delete</button>` : '<span style="color:#40c057; font-size:11px;">System</span>'}
                </div>
            `;
        }).join("");
    } catch(err) {
        display.innerHTML = "<p style='color:#ff6b6b;'>Error loading users.</p>";
    }
}

async function deleteUser(id) {
    if (!confirm("Delete this user?")) return;
    try {
        const res = await fetch("/api/admin/users/" + id, { method: "DELETE" });
        if (res.ok) loadAdminData();
    } catch(err) {
        alert("Error deleting user: " + err.message);
    }
}

// Auto Refresh Chat every 3s
setInterval(() => {
    const chatTab = document.getElementById("chat-tab");
    if (chatTab && chatTab.classList.contains("active")) {
        loadChat();
    }
}, 3000);

// Init on load
loadFeed();
checkAuthState();


// 1-ON-1 DM SYSTEM VARIABLES
let activeConvId = null;
let activePartner = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// Request Private Chat from Feed / User Click
async function requestPrivateChat(targetUser) {
    const currentUser = localStorage.getItem("username");
    if (!currentUser) return alert("Please login first to chat!");
    if (currentUser.toLowerCase() === targetUser.toLowerCase()) return alert("You cannot chat with yourself.");

    if (!confirm("Send a 1-on-1 Private Chat request to @" + targetUser + "?")) return;

    try {
        const res = await fetch("/api/private/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender: currentUser, recipient: targetUser })
        });
        const data = await res.json();
        if (data.status === "accepted") {
            alert("Chat already accepted! Opening conversation...");
            switchTab("dm");
            openDMChat(data.conversationId, targetUser);
        } else {
            alert(data.message || "Chat request sent!");
        }
    } catch(err) {
        alert("Error sending request: " + err.message);
    }
}

// Load Conversations & Pending Requests
async function loadDMTab() {
    const user = localStorage.getItem("username");
    if (!user) return;

    // Load Requests
    try {
        const reqRes = await fetch("/api/private/requests/" + user);
        const reqs = await reqRes.json();

        const reqContainer = document.getElementById("dm-requests-container");
        const reqList = document.getElementById("dm-requests-list");

        if (reqs.length > 0) {
            reqContainer.style.display = "block";
            reqList.innerHTML = reqs.map(r => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#25282c; padding:8px; border-radius:4px; margin-bottom:6px;">
                    <span style="color:#fff; font-size:13px;">@${r.sender} wants to chat</span>
                    <div style="display:flex; gap:6px;">
                        <button onclick="respondChatRequest('${r.id}', 'accept')" style="background:#40c057; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Accept</button>
                        <button onclick="respondChatRequest('${r.id}', 'reject')" style="background:#e03131; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Reject</button>
                    </div>
                </div>
            `).join("");
        } else {
            reqContainer.style.display = "none";
        }
    } catch(e) {}

    // Load Active Conversations
    try {
        const convRes = await fetch("/api/private/conversations/" + user);
        const convs = await convRes.json();
        const convList = document.getElementById("dm-conv-list");

        if (convs.length === 0) {
            convList.innerHTML = "<p style='color:#888; text-align:center;'>No 1-on-1 private chats yet. Tap any @username in the feed to request a chat!</p>";
            return;
        }

        convList.innerHTML = convs.map(c => {
            const partner = c.u1.toLowerCase() === user.toLowerCase() ? c.u2 : c.u1;
            return `
                <div onclick="openDMChat('${c.id}', '${partner}')" style="background:#25282c; padding:12px; border-radius:6px; border:1px solid #333; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                    <span style="color:#40c057; font-weight:bold;">@${partner}</span>
                    <span style="color:#888; font-size:12px;">Open Chat →</span>
                </div>
            `;
        }).join("");
    } catch(e) {}
}

async function respondChatRequest(reqId, action) {
    try {
        const res = await fetch("/api/private/request/" + reqId + "/respond", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (data.success) {
            alert(action === 'accept' ? "Request accepted!" : "Request rejected.");
            loadDMTab();
        }
    } catch(err) {
        alert("Error responding: " + err.message);
    }
}

// Open Private DM Room
function openDMChat(convId, partner) {
    activeConvId = convId;
    activePartner = partner;
    document.getElementById("dm-partner-name").innerText = "@" + partner;
    document.getElementById("dm-chat-room").style.display = "block";
    loadPrivateMessages();
}

function closeDMChat() {
    activeConvId = null;
    activePartner = null;
    document.getElementById("dm-chat-room").style.display = "none";
}

// Load Private Messages
async function loadPrivateMessages() {
    if (!activeConvId) return;
    const container = document.getElementById("dm-messages-display");
    const user = localStorage.getItem("username");

    try {
        const res = await fetch("/api/private/messages/" + activeConvId);
        const msgs = await res.json();

        if (msgs.length === 0) {
            container.innerHTML = "<p style='color:#888; text-align:center;'>Start your private conversation!</p>";
            return;
        }

        container.innerHTML = msgs.map(m => {
            const isMe = m.sender.toLowerCase() === user.toLowerCase();
            return `
                <div style="background:${isMe ? '#1e3a24' : '#25282c'}; padding:8px 12px; border-radius:6px; align-self:${isMe ? 'flex-end' : 'flex-start'}; max-width:82%; border:1px solid ${isMe ? '#2b5235' : '#333'};">
                    <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:4px;">
                        <strong style="color:${isMe ? '#40c057' : '#339af0'}; font-size:11px;">@${m.sender} ${m.edited ? '<i style="color:#aaa;">(edited)</i>' : ''}</strong>
                        <div style="display:flex; gap:6px;">
                            <button onclick="copyMsgText('${encodeURIComponent(m.text)}')" style="background:none; border:none; color:#aaa; font-size:10px; cursor:pointer;">Copy</button>
                            ${isMe ? `<button onclick="editPrivateMsg('${m.id}', '${encodeURIComponent(m.text)}')" style="background:none; border:none; color:#40c057; font-size:10px; cursor:pointer;">Edit</button>` : ''}
                        </div>
                    </div>
                    ${m.text ? `<div style="color:#fff; font-size:13px; word-break:break-word;">${m.text}</div>` : ''}
                    ${m.mediaType === 'image' ? `<img src="${m.media}" style="max-width:100%; max-height:200px; border-radius:6px; margin-top:6px; display:block;" />` : ''}
                    ${m.mediaType === 'video' ? `<video src="${m.media}" controls style="max-width:100%; max-height:200px; border-radius:6px; margin-top:6px; display:block;"></video>` : ''}
                    ${m.mediaType === 'audio' ? `<audio src="${m.media}" controls style="width:100%; margin-top:6px;"></audio>` : ''}
                </div>
            `;
        }).join("");

        container.scrollTop = container.scrollHeight;
    } catch(e) {}
}

// Send Text Message
async function sendPrivateMessage() {
    const input = document.getElementById("dm-msg-input");
    const text = input.value.trim();
    const sender = localStorage.getItem("username");

    if (!text || !activeConvId) return;

    try {
        const res = await fetch("/api/private/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ convId: activeConvId, sender, text, mediaType: "none" })
        });
        if (res.ok) {
            input.value = "";
            loadPrivateMessages();
        }
    } catch(err) {
        alert("Send error: " + err.message);
    }
}

// Media File Upload Handler (Photo / Video)
function handleMediaUpload(input) {
    const file = input.files[0];
    if (!file || !activeConvId) return;

    const sender = localStorage.getItem("username");
    const isVideo = file.type.startsWith("video");
    const isImage = file.type.startsWith("image");

    if (!isImage && !isVideo) return alert("Please select an image or video file.");

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Data = e.target.result;
        try {
            const res = await fetch("/api/private/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    convId: activeConvId,
                    sender,
                    media: base64Data,
                    mediaType: isVideo ? "video" : "image"
                })
            });
            if (res.ok) {
                input.value = "";
                loadPrivateMessages();
            }
        } catch(err) {
            alert("Upload error: " + err.message);
        }
    };
    reader.readAsDataURL(file);
}

// Voice Recorder (Voice Notes)
async function toggleVoiceRecording() {
    const btn = document.getElementById("dm-mic-btn");
    const sender = localStorage.getItem("username");

    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    await fetch("/api/private/messages", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            convId: activeConvId,
                            sender,
                            media: base64Audio,
                            mediaType: "audio"
                        })
                    });
                    loadPrivateMessages();
                };
                reader.readAsDataURL(audioBlob);
            };

            mediaRecorder.start();
            isRecording = true;
            btn.innerText = "🛑 Stop & Send Voice";
            btn.style.background = "#e03131";
        } catch(err) {
            alert("Microphone access required: " + err.message);
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        btn.innerText = "🎤 Record Voice";
        btn.style.background = "#1e3a24";
    }
}

// Edit Message
async function editPrivateMsg(msgId, encodedOldText) {
    const oldText = decodeURIComponent(encodedOldText);
    const newText = prompt("Edit your message:", oldText);
    if (!newText || newText === oldText) return;

    try {
        const res = await fetch("/api/private/messages/" + msgId, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: newText })
        });
        if (res.ok) loadPrivateMessages();
    } catch(err) {
        alert("Edit error: " + err.message);
    }
}

// Copy Message
function copyMsgText(encodedText) {
    const text = decodeURIComponent(encodedText);
    navigator.clipboard.writeText(text);
    alert("Message copied to clipboard!");
}

// Attach DM hook into switchTab
const origSwitchTab = window.switchTab;
window.switchTab = function(tabName) {
    if (typeof origSwitchTab === "function") origSwitchTab(tabName);
    if (tabName === "dm") loadDMTab();
};

// Global exports
window.requestPrivateChat = requestPrivateChat;
window.respondChatRequest = respondChatRequest;
window.openDMChat = openDMChat;
window.closeDMChat = closeDMChat;
window.sendPrivateMessage = sendPrivateMessage;
window.handleMediaUpload = handleMediaUpload;
window.toggleVoiceRecording = toggleVoiceRecording;
window.editPrivateMsg = editPrivateMsg;
window.copyMsgText = copyMsgText;

// Auto-poll DM messages every 3s
setInterval(() => {
    if (activeConvId) loadPrivateMessages();
}, 3000);


let isRegisterMode = false;

function switchToRegisterMode() {
    isRegisterMode = true;
    document.getElementById("gateway-welcome-title").innerText = "Join MikiConnect";
    document.getElementById("auth-submit-btn").innerText = "Create Account";
    document.getElementById("auth-submit-btn").style.background = "#20c997";
    document.getElementById("auth-toggle-link").innerText = "Already have an account? Log in";
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    const title = document.getElementById("gateway-welcome-title");
    const btn = document.getElementById("auth-submit-btn");
    const link = document.getElementById("auth-toggle-link");

    if (isRegisterMode) {
        if (title) title.innerText = "Join MikiConnect";
        if (btn) { btn.innerText = "Create Account"; btn.style.background = "#20c997"; }
        if (link) link.innerText = "Already have an account? Log in";
    } else {
        if (title) title.innerText = "MikiConnect";
        if (btn) { btn.innerText = "Log In"; btn.style.background = "#2b8a3e"; }
        if (link) link.innerText = "Log into another account";
    }
}

async function handleAuthSubmit() {
    const usernameInput = document.getElementById("auth-username").value.trim();
    const passwordInput = document.getElementById("auth-password").value.trim();

    if (!usernameInput || !passwordInput) {
        alert("Please enter both username/email and password.");
        return;
    }

    const endpoint = isRegisterMode ? "/api/register" : "/api/login";

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            localStorage.setItem("username", data.username || usernameInput);
            alert(isRegisterMode ? "Account created successfully!" : "Logged in successfully!");
            checkAuthState();
            switchTab("feed");
        } else {
            alert(data.message || "Authentication failed. Please check your details.");
        }
    } catch(err) {
        alert("Server error: " + err.message);
    }
}

window.switchToRegisterMode = switchToRegisterMode;
window.toggleAuthMode = toggleAuthMode;
window.handleAuthSubmit = handleAuthSubmit;
