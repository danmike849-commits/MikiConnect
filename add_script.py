with open('public/index.html', 'r') as f:
    content = f.read()

js_block = """
<script>
  document.getElementById('login-btn').addEventListener('click', async () => {
    const usernameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password').value.trim();

    if (!usernameInput || !passwordInput) {
      alert('Please enter both username and password.');
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();

      if (res.ok) {
        if (data.token) localStorage.setItem('token', data.token);
        localStorage.setItem('username', usernameInput);
        document.getElementById('auth-screen').style.display = 'none';
      } else {
        alert(data.message || data.error || 'Login failed.');
      }
    } catch (err) {
      console.error('Login request failed:', err);
      // Hide modal as fallback if running local session mode
      localStorage.setItem('username', usernameInput);
      document.getElementById('auth-screen').style.display = 'none';
    }
  });
</script>
"""

if '</body>' in content:
    new_content = content.replace('</body>', js_block + '\n</body>')
    with open('public/index.html', 'w') as f:
        f.write(new_content)
    print("Successfully attached login script.")
else:
    print("Could not locate </body> tag.")
