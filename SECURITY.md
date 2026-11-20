# Security

How QE Navigator protects data, what operators of a deployment must do, and how to report a problem.
For who may see and do what, see [docs/ROLE_ACCESS.md](docs/ROLE_ACCESS.md). The dated code review that
introduced many of these controls is [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).

## Reporting a vulnerability

Report suspected vulnerabilities privately to IronGate Software LTD, not in a public issue. Include the
steps to reproduce, the affected route or screen and the request id (`X-Request-Id` header) if you have
one.

## Secrets: never in the repository

- Do not commit `.env`, `.env.test` or any file with a database URL, password, API key or token. `.env` is in
  `.gitignore`. `.env.example` lists the variable names with placeholders only.
- Set secrets as environment variables of the deployment (Netlify site settings, or the server's
  environment). The variable names are listed in [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).
- Anything prefixed `VITE_` is compiled into the browser bundle and is public. Never put a secret in a
  `VITE_` variable.
- If a secret was committed, rotate it at the provider first, then remove it from the code.

## Controls in the code

**Tenancy.** The company is the hard boundary. Every query is scoped to the caller's company; ids from the
URL or body are checked against it. Within a company, access follows role assignments and the scope rule
in [`server/lib/userPolicy.ts`](server/lib/userPolicy.ts). The UI hides what the API would refuse; the API
always enforces it. Per-role tests: `tests/api/r2-security-matrix.test.ts`, `tests/api/role-matrix.test.ts`,
`tests/api/viewer-scope.test.ts`.

**Authentication.**

- Passwords are hashed with bcrypt. Registration, accepting an invitation, resetting a password with a
  link, and every password an admin or a platform operator sets (`POST /api/admin/users`,
  `POST /api/admin/users/:id/reset-password`, the operator's create company / create person / reset
  password) require 10 to 128 characters, three of lower case / upper case / number / symbol, and not the
  part of the e-mail before the @ (`src/lib/passwordPolicy.ts`). Test: `tests/api/admin-password-policy.test.ts`.
- The session is a signed JWT in the httpOnly cookie `irongate_token` (`Secure` and `SameSite=Strict` in
  production). The token only proves identity: every request reloads the user's current assignments, so a
  deactivated user or a changed role takes effect on the next request.
- Each session is a row in `user_sessions` (id = the token's `jti`). Sign out everywhere, a password change
  or reset, "sign out my other devices" and a company suspension revoke the rows.
- The session lifetime is set per company (default 7 days).
- The API refuses to start in production without `JWT_SECRET`.
- Single sign-on (Google, Microsoft) matches the exact verified e-mail or an open invitation, never a
  shared domain.
- Password reset links work once and expire after 60 minutes; only a hash of the token is stored; the
  reset page sends no Referer (`netlify.toml`).
- Platform operators have separate accounts, their own cookie and token audience, an 8-hour session,
  lockout after 5 failures and an optional IP allow-list (`PLATFORM_OPERATOR_ALLOWED_IPS`).

**API keys.** Ingestion keys (`igk_…`) are stored as a hash, shown once, scoped to one company, and
revocable. A suspended company's keys are refused.

**Rate limits** ([`server/middleware/rateLimit.ts`](server/middleware/rateLimit.ts)): general API
(`API_RATE_LIMIT_MAX` per minute, default 300), sign-in (20 failed attempts per 15 minutes per IP), forgot password (per IP and per
e-mail), reset password, invitations, ingestion (60 per minute), language-model routes and Recalculate.
The store is in memory, so on Netlify a limit applies per warm function instance.

**Headers and CORS.** CORS allows only exact origins (local development and `FRONTEND_URL`). Netlify sets
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and a strict referrer policy.

**Errors and logs.** 5xx responses return a generic message and a request id. Server errors are stored for
30 days without bodies, headers, cookies or query strings. The user activity log stores route patterns,
never bodies, query strings, tokens or passwords.

**Stored secrets.** The Slack webhook is encrypted at rest (`SETTINGS_ENCRYPTION_KEY`, else `JWT_SECRET`) and
never returned. Commit author e-mails from deployment events are stored only as a salted hash.

**Database.** The app connects as the database owner. Row Level Security is enabled on every table with no
policies, so Supabase's public Data API cannot read anything.

**Privacy.** Team averages of individual data and wellbeing results are shown only with at least 3
contributors. Individual developer metrics are shown only for people who opted in. See
[docs/PRODUCT_GUIDE.md, section 6](docs/PRODUCT_GUIDE.md#6-privacy-and-wellbeing).

## Checklist for a deployment

- [ ] `JWT_SECRET` is a long random value, different per environment.
- [ ] `DATABASE_URL` uses the Supabase transaction pooler and is set only in the deployment's environment.
- [ ] `FRONTEND_URL` is set when the API is on a different origin from the app.
- [ ] E-mail (`RESEND_API_KEY` or `SMTP_*`) is configured with a verified sending domain.
- [ ] `DEMO_MODE` and `ENABLE_SYNTHETIC_DATA` are off on a customer deployment.
- [ ] Platform operator accounts exist only for IronGate support; `PLATFORM_OPERATOR_ALLOWED_IPS` is set if
      support works from fixed addresses.
- [ ] Database backups are enabled at the provider.
