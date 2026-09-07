## 2.3.1 — Settings & UX completion

- Added a visible in-app Settings center with Account, Security, Notifications, Appearance and Privacy sections.
- Added email verification status and resend verification control to Settings.
- Moved password management into Settings and retained secure session invalidation.
- Added device-local light/dark appearance preference.
- Added clearer owner/support and privacy guidance.

# Changelog

## 2.2.0 — Commercial Release Candidate

### Added
- Follow/unfollow relationships with follower/following counts.
- Notification inbox for follows, likes, comments, and system events.
- User, post, and comment reporting API.
- Admin report queue with resolve/dismiss actions.
- Password-change endpoint with JWT token-version invalidation.
- Socket.io per-connection message throttling.

### Security
- Password changes invalidate existing JWTs.
- Write-heavy social actions have server-side rate limits.
- Socket messages derive sender identity from the authenticated socket.
- Public profile responses avoid private email/role fields.
- Additional browser security headers enabled.

### Commercial readiness
- Updated repository documentation and release checklist.
- Added explicit separation between source-code release and final legal/commercial licensing.

## 2.3.0
- Added mandatory email verification flow.
- Added secure, single-use password reset flow with hashed expiring tokens.
- Added verification resend and password-reset request endpoints with generic responses.
- Added browser verification and password reset pages.
- Added Resend REST integration without exposing API credentials in source code.
- Added owner-specific first-admin bootstrap guard using FIRST_ADMIN_EMAIL.
- Added commercial-license framework for Mika Daniel (MIKI).
- Added third-party notices and commercial-release ownership guidance.
