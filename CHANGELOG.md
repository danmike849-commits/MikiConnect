# Changelog

## 2.5.7 - Password reset contract and timeout fix
- Corrected the password reset form to send the backend's expected `password` field.
- Added a regression test for the frontend/backend reset contract.
- Added a 75-second request timeout with a clear recovery message for slow or sleeping production instances.



## 2.5.6 - Password reset request fix
- Fixed the password reset form sending `password` instead of the API's expected `newPassword` field.
- Verified the reset flow request matches the backend contract.

# MikiConnect v2.5.5

- Hardened password-reset emails with a prominent reset button and visible fallback URL.
- Added explicit plain-text reset and verification email bodies so email clients that strip HTML still provide a usable link.
- Escapes usernames when inserting them into transactional email HTML.
- Keeps password-reset tokens hashed, single-use and time-limited.

# MikiConnect v2.5.4

- Separates private platform owner identity from the public official MikiConnect account.
- Protects both the configured owner account and the official platform account from admin ban/demotion/deletion.
- Admin broadcasts are attributed to the configured official platform username instead of a generic SYSTEM sender.
- Adds OWNER_EMAIL and PLATFORM_USERNAME configuration.
- Keeps the owner migration non-destructive; the legacy email account is not deleted automatically.

## 2.5.2
- Fixed authentication controls becoming unresponsive due to a missing Admin Settings element causing frontend initialization to stop.
- Added the Admin Control Panel entry inside Settings for admin users.

## 2.5.1
- Surface the Admin Control Panel inside the authenticated app for admin users.
- Keep admin navigation hidden for normal users while retaining server-side authorization.

## 2.3.6 — Focused authentication flow
- Simplified the initial authentication screen to show only Log in and Create account choices.
- Login and registration fields remain hidden until the user selects the corresponding action.
- Added clear Back controls and isolated each mode's fields to prevent stale credentials or mixed forms.
- Preserved successful registration messaging when returning the user to Login.
- Improved mobile-first spacing and touch targets for the authentication choice screen.

## 2.3.4

- Improved post-verification handoff messaging for mobile/PWA users.
- Added an explicit Email verified success state and clear return-to-app guidance.

## 2.3.2 — Product UX polish

- Simplified authentication with clearer labels, guidance, password controls and keyboard support.
- Removed the developer-facing avatar URL field from registration; profile images remain editable after sign-in.
- Improved mobile spacing, touch targets, form accessibility and inline status feedback.
- Improved chat, people search, posting and notification interaction wording.
- Added lightweight success/error toast feedback and reduced reliance on intrusive alerts.
- Added clearer empty/loading-oriented presentation and more consistent light/dark appearance handling.

## 2.3.1 — Settings & UX completion

- Added a visible in-app Settings center with Account, Security, Notifications, Appearance and Privacy sections.
- Added email verification status and resend verification control to Settings.
- Moved password management into Settings and retained secure session invalidation.
- Added device-local light/dark appearance preference.
- Added clearer owner/support and privacy guidance.

# Changelog

## 2.3.3 - Email verification reliability
- Improved verification email with a clear button and copy/paste fallback URL.
- Added plain-text email fallback for clients that do not render HTML links.
- Improved unverified-login guidance and spam-folder instructions.
- Added resend-verification controls to the verification page.


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

## 2.3.5 — Authentication screen fix
- Fixed a malformed authentication panel that caused registration fields to appear on the login screen.
- Login and registration now render as mutually exclusive modes.
- Switching modes clears the other mode's password fields to avoid confusing stale credentials.
- Added clear mode-specific headings and subtitles for new and returning users.
- Fixed the duplicated Password label visible on mobile.

## Authentication UX polish
- Removed the developer-facing Avatar URL field from registration.
- Added a simple Confirm password field and client-side password checks.
- Added clearer login/registration labels, guidance, and verification messaging.
- Added show/hide password controls and Enter-key submission for auth forms.
- Replaced intrusive auth alerts with inline status/error messaging where appropriate.
- Avatar/profile image editing remains available after sign-in from the profile/settings area.


## v2.3.7
- Fixed authentication entry state so a fresh/returned visitor always sees the minimal Welcome screen before choosing Log in or Create account.
- Fixed logout and invalid-session recovery to return to the minimal Welcome screen instead of exposing the login form.
- Added a pageshow guard for mobile/PWA back-forward-cache cases.
- Bumped the service-worker cache name so the updated authentication shell is picked up after deployment.

## 2.4.0 — Security & abuse-resistance hardening

- Added bounded in-memory rate-limit storage with fail-closed behavior when capacity is exhausted.
- Added rate limits to previously unprotected public read endpoints and authenticated message-history reads.
- Added Socket.IO connection-attempt throttling and a per-account concurrent-session limit.
- Added API `Cache-Control: no-store` and additional browser security headers.
- Added duplicate-open-report protection and validation that reported users/posts/comments exist.
- Made username validation consistent with the UI by allowing hyphens.
- Improved the registration error when verification email delivery fails so users are not told that account creation itself is broken.
- Existing JWT, email verification, password reset, admin authorization, and XSS escaping flows remain intact.


## 2.4.1 — Authorization & Admin Control Hardening

- Hardened administrator ban, role-change, and deletion actions.
- Protected the configured owner/first-admin account from accidental ban, demotion, or deletion.
- Prevented actions that would leave the platform without an active administrator.
- Revoked active tokens when an administrator changes another user's role or ban state.
- Added administrator audit logging for moderation and platform-control actions.
- Added paginated/searchable admin user, report, and message APIs.
- Expanded the admin control panel with user search, moderation messages, report status filters, platform statistics, and audit history.
- Added cleanup of notifications, follows, likes, comments, messages, posts, and reports when an account is deleted.

## 2.5.0 — Session & Private-Data Security
- Replaced browser `localStorage` JWT storage with an HttpOnly `mc_session` cookie.
- Added server-side logout that clears the session cookie.
- Socket.IO now authenticates from the HttpOnly session cookie.
- Added same-origin protection for browser state-changing API requests.
- Admin panel now uses the secure session cookie instead of localStorage tokens.
- Existing token-version invalidation continues to revoke sessions after password, ban, role, or account changes.

## 2.5.3 — Owner Email Migration Preparation
- Updated MikiConnect owner/admin configuration and support contact to `danmike849@gmail.com`.
- Added a one-time owner migration script that promotes the existing `danmike849@gmail.com` account, invalidates its existing sessions, and removes the old `mikedan849@gmail.com` account when present.
- Kept third-party license boundaries unchanged.
