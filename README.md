# MikiConnect

MikiConnect is a Node.js/Express/MongoDB/Socket.io community application with JWT-backed HttpOnly cookie sessions, user profiles, posts, likes, comments, public chat, private messaging, PWA support, and an admin moderation panel. This repository is a commercial-oriented release candidate owned by Mika Daniel (MIKI). It is designed for hosted SaaS, business licensing, optional white-label agreements, and other written commercial arrangements; production launch still requires the deployment, third-party licensing, email-provider, and legal checks listed below.

## Stack
- Node.js 20+
- Express 5
- MongoDB + Mongoose
- JWT + bcryptjs
- Socket.io
- Vanilla HTML/CSS/JavaScript PWA frontend
- Render-compatible deployment

## Local setup
1. Install Node.js 20+.
2. Run `npm ci`.
3. Copy `.env.example` to `.env`.
4. Set a real MongoDB Atlas URI and a random JWT secret of at least 32 characters.
5. Run `npm start`.
6. Open `http://localhost:3000`.

For development, `npm run dev` currently runs the same server command. Add a file-watching tool later if desired.

## Environment variables
- `NODE_ENV` — `development` or `production`.
- `PORT` — server port; Render supplies this automatically.
- `MONGO_URI` — MongoDB Atlas connection string.
- `JWT_SECRET` — private signing secret, minimum 32 characters.
- `JWT_EXPIRES_IN` — JWT lifetime, e.g. `24h`.
- `CORS_ORIGIN` — optional comma-separated allowed origins. Prefer the production site URL rather than `*`.
- `ALLOW_FIRST_ACCOUNT_ADMIN` — enables initial-admin bootstrap. Pair it with `FIRST_ADMIN_EMAIL` so only the owner email can receive the first-admin role.
- `FIRST_ADMIN_EMAIL` — owner email allowed to receive the initial admin role (`mikedan849@gmail.com` in the owner configuration).
- `APP_URL` — public application URL used in verification and password-reset links.
- `EMAIL_PROVIDER` — currently `resend`.
- `EMAIL_FROM` — verified sender identity for transactional mail.
- `RESEND_API_KEY` — Resend API key; store only in Render/local environment variables, never in source control.

## API
### Authentication
- `POST /api/register` — create an account and send a verification email.
- `POST /api/login` — login with username or email after email verification.
- `POST /api/verify-email` — consume a single-use verification token.
- `POST /api/resend-verification` — resend verification mail with a generic response.
- `POST /api/forgot-password` — request a password reset with a generic response.
- `POST /api/reset-password` — consume a single-use password reset token.
- `GET /api/me` — authenticated profile.
- `PATCH /api/me` — update bio/avatar.
- `POST /api/me/password` — change password and invalidate existing sessions.
- `GET /api/notifications` — notification inbox.
- `POST /api/notifications/read` — mark notifications read.

### Users
- `GET /api/users?q=` — search/list public users.
- `GET /api/users/:username` — public profile and recent posts.
- `POST /api/users/:username/follow` — follow/unfollow a user.
- `GET /api/users/:username/followers` — public follower list.
- `GET /api/users/:username/following` — public following list.

### Trust & safety
- `POST /api/reports` — submit a report for a user, post, or comment.

### Posts
- `GET /api/posts?page=&limit=` — paginated feed.
- `POST /api/posts` — authenticated post creation.
- `POST /api/posts/:id/like` — toggle like.
- `POST /api/posts/:id/comment` — add comment.
- `DELETE /api/posts/:id` — owner/admin deletion.

### Messaging
- `GET /api/messages/public` — authenticated public-message history.
- `GET /api/messages/dm/:username` — authenticated DM history.

### Admin
All admin routes require a valid JWT belonging to a user with `role=admin`.
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `PUT /api/admin/users/ban`
- `PUT /api/admin/users/role`
- `DELETE /api/admin/users/:username`
- `GET /api/admin/messages`
- `DELETE /api/admin/messages/:id`
- `GET /api/admin/reports`
- `PUT /api/admin/reports/:id`
- `POST /api/admin/broadcast`

### Health
- `GET /health` — returns 200 when MongoDB is connected and 503 when degraded.

## Socket.io events
Client authentication is supplied as `{ auth: { token } }` during connection.

Public chat:
- client `sendPublicMessage` → `{ content }`
- server `receivePublicMessage`

Private chat:
- client `sendPrivateMessage` → `{ recipient, content }`
- server `receivePrivateMessage`

System:
- server `systemAnnouncement`
- server `ready`

Post updates:
- server `postCreated`
- server `postUpdated`
- server `postDeleted`

The server derives the sender from the authenticated socket. It never trusts a client-provided sender username.

## Render deployment
Create a Render Web Service using the repository. The included `render.yaml` uses:
- Build: `npm ci`
- Start: `npm start`
- Health check: `/health`

Set `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`, `EMAIL_FROM`, and `RESEND_API_KEY` in Render's environment settings. The Blueprint keeps secret values out of source control. Render supports environment variables/secrets for this purpose. citeturn0search1

## Security notes
- Passwords are hashed with bcryptjs.
- JWTs are verified with issuer and audience claims.
- Protected routes re-check the user in MongoDB and reject banned accounts.
- Admin authorization is enforced server-side.
- Socket.io requires a valid JWT.
- Request bodies have size limits.
- Basic security headers are set.
- Authentication endpoints have basic in-memory rate limiting. For multi-instance production deployments, replace this with shared Redis-backed rate limiting.

## Quality and security verification

Run these before every release:

```bash
npm ci
npm run check
npm test
npm audit --omit=dev
```

`npm audit` requires network access to the npm registry.

## Commercial release checklist
Before a public sale/release:
1. Run `npm ci` and `npm test`.
2. Run `npm audit` and review all findings.
3. Configure MongoDB Atlas network/database access securely.
4. Set strong Render environment variables.
5. Test registration, login, feed, likes, comments, chat, DMs, admin actions, and banned-account behavior.
6. Add screenshots and a demo account to the sales package.
7. Replace the placeholder license owner/details in `LICENSE` after deciding the commercial licensing model.
8. Review Git history for accidentally committed secrets before making the repository public.
9. Configure and verify the transactional email sender before public launch.
10. Review third-party dependency and asset licenses.
11. Review the commercial license, privacy notice, and terms with qualified legal counsel before selling licenses or collecting production user data.

## Commercial ownership and legal documents
The owner configuration identifies **Mika Daniel (MIKI)** as the MikiConnect creator/owner, copyright 2026. `LICENSE` is a proprietary commercial-license framework and must be legally reviewed before sale. `THIRD_PARTY_NOTICES.md` records the third-party ownership boundary. `PRIVACY.md` and `TERMS.md` are operational legal-document drafts, not legal advice.
