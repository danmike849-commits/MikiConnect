const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanUsername, validatePassword, isValidUrl } = require('../utils/validation');

test('cleanUsername normalizes usernames', () => {
  assert.equal(cleanUsername('  Alice_01 '), 'alice_01');
});

test('validatePassword enforces length', () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('password123'), true);
  assert.equal(validatePassword('a'.repeat(129)), false);
});

test('isValidUrl accepts http(s) and rejects unsafe schemes', () => {
  assert.equal(isValidUrl('https://example.com/avatar.png'), true);
  assert.equal(isValidUrl('http://example.com/avatar.png'), true);
  assert.equal(isValidUrl('javascript:alert(1)'), false);
  assert.equal(isValidUrl('data:text/html,test'), false);
});
