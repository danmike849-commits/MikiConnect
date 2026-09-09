# MikiConnect V2.3 Security / Commercial Audit

Owner: **Mika Daniel (MIKI)**
Copyright: **2026**
Product: **MikiConnect**

## Completed in V2.3
- Mandatory email verification on registration.
- Login blocked until email verification succeeds.
- Cryptographically random, hashed, expiring email-verification tokens.
- Verification tokens are single-use and cleared after successful verification.
- Password recovery with cryptographically random, hashed, one-hour reset tokens.
- Password reset tokens are single-use and cleared after successful reset.
- Password reset increments the user's token version, invalidating existing JWT sessions.
- Forgot-password and resend-verification endpoints use generic responses to reduce account enumeration.
- Rate limiting added to verification/reset flows.
- Resend transactional email integration uses the provider REST API without committing API credentials.
- Browser pages added for email verification and password reset.
- Initial-admin bootstrap restricted to the configured owner email when `FIRST_ADMIN_EMAIL` is set.
- Commercial license framework updated for Mika Daniel (MIKI).
- Third-party ownership/license boundary documented.
- Privacy and terms drafts added for legal review.

## Important owner/deployment actions still required
1. Create/configure a transactional email provider account (Resend recommended).
2. Verify a sending domain and set `EMAIL_FROM`.
3. Add `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `MONGO_URI`, and `JWT_SECRET` to Render environment variables. Render recommends environment variables/secrets for credentials rather than committing them.
4. Keep `FIRST_ADMIN_EMAIL=mikedan849@gmail.com` if Mika should be the only person eligible for initial admin bootstrap.
5. Run `npm audit --omit=dev` from a networked environment and review the complete dependency tree.
6. Review every third-party asset/source contribution and document its license.
7. Have the commercial license, privacy notice, terms, and any data-processing disclosures reviewed by qualified Nigerian counsel before commercial launch.
8. Test the complete registration → email verification → login and forgot-password → reset → login flows against the live Render environment.

## Render readiness
The service uses `npm start`, binds to `0.0.0.0`, and exposes `/health`. Render HTTP health checks accept a 2xx/3xx response and can use the configured `healthCheckPath`; Render also recommends storing secrets as environment variables.

## Known architecture limitation
The in-memory rate limiter is appropriate as a baseline for a single instance but should be replaced with a shared store such as Redis before horizontally scaling authentication-heavy traffic.

## Commercial position
Recommended model: hosted SaaS as the default, with paid business deployments and separately negotiated white-label/source-code rights. The proprietary license does not grant white-label, resale, sublicensing, or redistribution rights unless a written agreement expressly does so.

## Legal status
The included legal documents are drafts/frameworks, not legal advice. They must not be represented as a completed legal agreement until reviewed and finalized.

## V2.3.1 UX completion
- Added a visible Settings center so backend capabilities are discoverable in the app.
- Added account/email verification status, security controls, notifications, appearance preference, and privacy guidance.
- Removed duplicate password controls from the main profile card.


## Step 3 — Security / Abuse-Resistance Review (v2.4.0)

### Findings addressed
- **Rate-limit memory growth:** bounded in-memory buckets and fail-closed capacity handling.
- **Unprotected read endpoints:** feed, profile, follower/following, and message history reads now have request limits.
- **WebSocket abuse:** connection-attempt throttling plus a maximum of five active sessions per account.
- **API caching:** API responses are marked `no-store` to reduce accidental caching of authenticated data.
- **Browser hardening:** CSP baseline, CORP, Origin-Agent-Cluster, existing HSTS/frame/referrer protections retained.
- **Report abuse:** duplicate open reports are rejected and targets are checked before a report is stored.
- **Validation consistency:** username rules now match the product UI and DM validation.

### Remaining architectural risks / next hardening targets
1. In-memory rate limiting is suitable for the current single Render instance only; production horizontal scaling should use a shared rate-limit store.
2. JWTs are currently stored in browser localStorage. This is workable for the current SPA/PWA but an httpOnly secure session-cookie architecture would reduce token theft impact from XSS.
3. Posts embed comments and likes in one MongoDB document; high-volume growth should eventually normalize these collections or introduce bounded/paginated interaction storage.
4. WebSocket message throttling is per socket; account/IP-level message quotas should be moved to shared storage when scaling.
5. Add automated integration tests against a disposable MongoDB/CI environment before commercial launch.
