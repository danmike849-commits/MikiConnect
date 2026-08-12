// Global App JavaScript
let adminChartInstance = null;
let lastChatCount = 0;

// TAB NAVIGATION

function switchTab(tabName) {
    const user = localStorage.getItem("username");
    const isCreator = user && (user.toLowerCase() === "admin" || user.toLowerCase() === "mikedan849@gmail.com");

    if (tabName === "admin" && !isCreator) {
        alert("Access Denied: Only the creator of MikiConnect can access the Admin Dashboard.");
        tabName = "feed";
    }

    document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".nav-bar button").forEach(btn => btn.classList.remove("active"));

    const targetTab = document.getElementById(tabName + "-tab");
    const targetNav = document.getElementById("nav-" + tabName);

    if (targetTab) targetTab.classList.add("active");
    if (targetNav) targetNav.classList.add("active");

    if (tabName === "feed") loadFeed();
    if (tabName === "chat") loadChat();
    if (tabName === "admin") loadAdminData();
    if (tabName === "account") checkAuthState();
}


// AUTH FUNCTIONS

function checkAuthState() {
    const user = localStorage.getItem("username");
    const profileCard = document.getElementById("user-profile-card");
    const authContainer = document.getElementById("auth-container");
    const nameDisplay = document.getElementById("user-display-name");
    const adminBtn = document.getElementById("nav-admin");

    const isCreator = user && (user.toLowerCase() === "admin" || user.toLowerCase() === "mikedan849@gmail.com");

    if (adminBtn) {
        adminBtn.style.display = isCreator ? "inline-block" : "none";
    }

    if (user) {
        if (profileCard) profileCard.style.display = "block";
        if (authContainer) authContainer.style.display = "none";
        if (nameDisplay) nameDisplay.innerText = "@" + user;
    } else {
        if (profileCard) profileCard.style.display = "none";
        if (authContainer) authContainer.style.display = "block";
    }
}


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
                <div style="color:#40c057; font-weight:bold; margin-bottom:5px;">@${p.username}</div>
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
