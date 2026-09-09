function cleanUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

module.exports = { cleanUsername, validatePassword, isValidUrl };
