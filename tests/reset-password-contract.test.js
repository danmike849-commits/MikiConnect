const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('password reset page sends the backend password field', () => {
  const html = fs.readFileSync('public/reset-password.html', 'utf8');

  assert.match(
    html,
    /JSON\.stringify\(\{token,password\}\)/,
    'reset page must send { token, password }'
  );

  assert.doesNotMatch(
    html,
    /JSON\.stringify\(\{token,newPassword:password\}\)/,
    'reset page must not send the incorrect newPassword field'
  );
});
