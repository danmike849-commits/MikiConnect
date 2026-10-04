const { Resend } = require('resend');

function getResend() {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  return new Resend(key);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getFrom() {
  return process.env.EMAIL_FROM || 'MikiConnect <onboarding@resend.dev>';
}

async function sendEmail({ to, subject, html, text }) {
  const resend = getResend();

  const result = await resend.emails.send({
    from: getFrom(),
    to: [to],
    subject,
    html,
    text
  });

  if (result && result.error) {
    throw new Error(result.error.message || 'Resend rejected the email');
  }

  return result;
}

async function sendVerificationEmail({
  email,
  username,
  verificationToken,
  verificationCode,
  appUrl
}) {
  const safeUsername = escapeHtml(username);
  const verificationUrl =
    `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;

  const html = `
<!doctype html>
<html>
<body style="margin:0;background:#f5f5f7;font-family:Arial,sans-serif;color:#222">
  <div style="max-width:600px;margin:30px auto;background:#fff;padding:32px;border-radius:16px">
    <h1 style="margin-top:0">Welcome to MikiConnect 💜</h1>

    <p>Hi ${safeUsername},</p>

    <p>Verify your email address to activate your MikiConnect account.</p>

    <p style="text-align:center;margin:30px 0">
      <a href="${verificationUrl}"
         style="display:inline-block;background:#6d4aff;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:bold">
        Verify My Email
      </a>
    </p>

    <p>Your 6-digit verification code is:</p>

    <div style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;padding:18px;background:#f3f0ff;border-radius:12px">
      ${verificationCode}
    </div>

    <p style="font-size:14px;color:#666">
      The code expires in 10 minutes. The verification link expires in 24 hours.
      You only need to use one of them.
    </p>

    <p style="font-size:13px;color:#777">
      If the button does not work, copy this address into your browser:<br>
      ${verificationUrl}
    </p>
  </div>
</body>
</html>`;

  const text = `
Welcome to MikiConnect, ${username}.

Verify your email using this link:
${verificationUrl}

Or enter this 6-digit verification code:
${verificationCode}

The code expires in 10 minutes.
The verification link expires in 24 hours.
You only need to use one method.
`;

  return sendEmail({
    to: email,
    subject: 'Verify your MikiConnect email',
    html,
    text
  });
}

async function sendPasswordResetEmail({
  email,
  username,
  resetToken,
  resetCode,
  appUrl
}) {
  const safeUsername = escapeHtml(username);

  const resetUrl =
    `${appUrl}/reset-password.html?token=${encodeURIComponent(resetToken)}`;

  const html = `
<!doctype html>
<html>
<body style="margin:0;background:#f5f5f7;font-family:Arial,sans-serif;color:#222">
  <div style="max-width:600px;margin:30px auto;background:#fff;padding:32px;border-radius:16px">
    <h1 style="margin-top:0">Reset your MikiConnect password</h1>

    <p>Hi ${safeUsername},</p>

    <p>We received a request to reset your MikiConnect password.</p>

    <p style="text-align:center;margin:30px 0">
      <a href="${resetUrl}"
         style="display:inline-block;background:#6d4aff;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:bold">
        Reset My Password
      </a>
    </p>

    <p>Or use this 6-digit reset code:</p>

    <div style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;padding:18px;background:#f3f0ff;border-radius:12px">
      ${resetCode}
    </div>

    <p style="font-size:14px;color:#666">
      The code expires in 10 minutes. The reset link expires in 10 minutes.
      You only need to use one method.
    </p>

    <p style="font-size:13px;color:#777">
      If the button does not work, copy this address into your browser:<br>
      ${resetUrl}
    </p>

    <p style="font-size:13px;color:#777">
      If you did not request this reset, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`;

  const text = `
MikiConnect password reset

Hi ${username},

Reset your password using this link:
${resetUrl}

Or enter this 6-digit reset code:
${resetCode}

The code and reset link expire in 10 minutes.
You only need to use one method.

If you did not request this reset, you can ignore this email.
`;

  return sendEmail({
    to: email,
    subject: 'Reset your MikiConnect password',
    html,
    text
  });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail
};
