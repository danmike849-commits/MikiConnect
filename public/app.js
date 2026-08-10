// Retrieve stored user session (saved during login)
let currentUser = JSON.parse(localStorage.getItem('user')) || null;

// -------------------------------------------------------------
// 1. CREATE A NEW FEED POST
// -------------------------------------------------------------
async function createPost() {
  const contentInput = document.getElementById('post-content');
  const content = contentInput ? contentInput.value.trim() : '';

  if (!currentUser) {
    alert('Please log in first to create a post.');
    return;
  }

  if (!content) {
    alert('Post content cannot be empty.');
    return;
  }

  try {
    const response = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: currentUser.username,
        content: content
      })
    });

    const data = await response.json();
    if (data.success) {
      if (contentInput) contentInput.value = '';
      loadFeed(); // Refresh feed immediately
    } else {
      alert('Error creating post: ' + data.error);
    }
  } catch (err) {
    console.error('Create Post Error:', err);
  }
}

// -------------------------------------------------------------
// 2. FETCH AND DISPLAY FEED POSTS
// -------------------------------------------------------------
async function loadFeed() {
  const feedContainer = document.getElementById('feed-container');
  if (!feedContainer) return;

  try {
    const response = await fetch('/api/posts');
    const data = await response.json();

    if (!data.success) return;

    feedContainer.innerHTML = ''; // Clear feed before rendering

    data.posts.forEach(post => {
      const isLiked = currentUser && post.likes.includes(currentUser.username);
      
      const postCard = document.createElement('div');
      postCard.className = 'post-card';
      postCard.style.cssText = 'border: 1px solid #ccc; padding: 12px; margin-bottom: 12px; border-radius: 8px; background: #fff;';

      postCard.innerHTML = `
        <div style="font-weight: bold; color: #333;">@${post.author}</div>
        <p style="margin: 8px 0; font-size: 15px;">${post.content}</p>
        <small style="color: #777;">${new Date(post.createdAt).toLocaleString()}</small>
        
        <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center;">
          <button onclick="toggleLike('${post._id}')" style="padding: 4px 10px; cursor: pointer;">
            ${isLiked ? '❤️ Liked' : '🤍 Like'} (${post.likes.length})
          </button>
        </div>

        <!-- Comments Section -->
        <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #eee;">
          <strong>Comments (${post.comments.length}):</strong>
          <div id="comments-${post._id}" style="margin-top: 6px;">
            ${post.comments.map(c => `
              <div style="font-size: 13px; background: #f4f4f4; padding: 4px 8px; border-radius: 4px; margin-top: 4px;">
                <strong>@${c.username}:</strong> ${c.text}
              </div>
            `).join('')}
          </div>

          <!-- Add Comment Input -->
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <input type="text" id="input-comment-${post._id}" placeholder="Write a comment..." style="flex: 1; padding: 4px 8px;" />
            <button onclick="addComment('${post._id}')" style="padding: 4px 10px;">Send</button>
          </div>
        </div>
      `;

      feedContainer.appendChild(postCard);
    });
  } catch (err) {
    console.error('Fetch Feed Error:', err);
  }
}

// -------------------------------------------------------------
// 3. TOGGLE LIKE / UNLIKE
// -------------------------------------------------------------
async function toggleLike(postId) {
  if (!currentUser) {
    alert('Please log in to like posts.');
    return;
  }

  try {
    const response = await fetch(`/api/posts/${postId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username })
    });

    const data = await response.json();
    if (data.success) {
      loadFeed(); // Refresh feed to update like count & button state
    }
  } catch (err) {
    console.error('Like Error:', err);
  }
}

// -------------------------------------------------------------
// 4. ADD COMMENT TO A POST
// -------------------------------------------------------------
async function addComment(postId) {
  if (!currentUser) {
    alert('Please log in to comment.');
    return;
  }

  const commentInput = document.getElementById(`input-comment-${postId}`);
  const text = commentInput ? commentInput.value.trim() : '';

  if (!text) return;

  try {
    const response = await fetch(`/api/posts/${postId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        text: text
      })
    });

    const data = await response.json();
    if (data.success) {
      commentInput.value = '';
      loadFeed(); // Refresh feed to display new comment
    }
  } catch (err) {
    console.error('Comment Error:', err);
  }
}

// -------------------------------------------------------------
// 5. ADMIN DASHBOARD (Fetch & Manage Registered Users)
// -------------------------------------------------------------
async function loadAdminDashboard() {
  const adminContainer = document.getElementById('admin-container');
  if (!adminContainer) return;

  if (!currentUser || !currentUser.isAdmin) {
    adminContainer.style.display = 'none';
    return;
  }

  adminContainer.style.display = 'block';

  try {
    const response = await fetch('/api/admin/users');
    const data = await response.json();

    if (!data.success) return;

    adminContainer.innerHTML = `
      <h3>Admin Dashboard</h3>
      <table border="1" cellpadding="8" style="width: 100%; border-collapse: collapse; background: #fff;">
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Registered Date</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${data.users.map(u => `
            <tr>
              <td>@${u.username} ${u.isAdmin ? '👑' : ''}</td>
              <td>${u.email}</td>
              <td>${new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                ${!u.isAdmin ? `<button onclick="deleteUser('${u._id}')" style="color: red;">Delete</button>` : 'Admin'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Admin Fetch Error:', err);
  }
}

// Delete User from Admin Dashboard
async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;

  try {
    const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const data = await response.json();
    if (data.success) {
      loadAdminDashboard(); // Refresh admin table
    }
  } catch (err) {
    console.error('Delete User Error:', err);
  }
}

// Automatically load feed and admin panel on page load
document.addEventListener('DOMContentLoaded', () => {
  loadFeed();
  loadAdminDashboard();
});
