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

**Managing other people (account takeover).** An account-wide action (reset the password or send a reset
link, change the e-mail address, activate / deactivate, sign out everywhere, delete, the developer-insights
switch, editing the profile) changes the person everywhere, so a manager or team lead may take it only when
the person is ENTIRELY theirs: every active assignment of the person is on a team of a department the
manager manages (a team the lead leads), and the person ranks below them. One assignment anywhere else, or
none at all, and only a super admin may act. Adding an assignment to an existing person needs the same: a
manager can no longer give someone of another department a viewer seat on their own team to bring that
person into reach (`userPolicy.targetWithinScope`, `canAddAssignmentTo`). Changing another person's e-mail
is for super admins only; every e-mail change, including your own, is validated (format, not a platform
operator's address, not taken) and ends the person's other sessions (`server/lib/emailChange.ts`; no
confirmation e-mail is sent to the new address: there is no verification flow). Rules:
[docs/ROLE_ACCESS.md](docs/ROLE_ACCESS.md#account-wide-actions-and-adding-assignments-exact-rule).
Attacker-path tests: `tests/api/security-authz.test.ts`.

**Synthetic data never reaches a real company.** Every generator of random data (the daily drift
`POST /api/analytics/update-daily`, `POST /api/analytics/seed-data`, `…/generate-realistic-data`, the
interval and pipeline generators in `server/jobs`, `server/seeders/pipelineSeeder.ts`,
`server/seeds/seedProductivitySnapshots.ts`) writes only to sample companies: companies created by the demo
generators, whose id starts with `demo-` (`server/lib/sampleCompany.ts`; a registered or operator-created
company has a random id). An endpoint acts only on the caller's own company and answers 403 in a real one;
the background jobs select sample companies only, and every writer refuses a real company id with an
exception. This holds whatever `ENABLE_SYNTHETIC_DATA` says. The daily drift has no schedule any more.

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
- Sign-in lockout (`server/lib/loginLockout.ts`, columns `users.failed_login_attempts` and
  `users.locked_until`): 5 wrong passwords in a row lock the account for 15 minutes. While locked, every
  attempt, even with the right password, gets the same `401 Invalid credentials` as a wrong password or an
  unknown e-mail (no account enumeration; the password is still compared, so the timing is the same) and
  still counts, without extending the lock; the first wrong password after the lock ends locks it again.
  A successful sign-in resets the count; a reset link, a password set by an admin and the platform
  operator's **Clear lockout** clear both columns. On top of this, `/api/auth/login` allows 20 failed
  attempts per 15 minutes per client address. Test: `tests/api/login-lockout.test.ts`.
- The API refuses to start in production without `JWT_SECRET`.
- Single sign-on (Google, Microsoft) matches the exact verified e-mail or an open invitation, never a
  shared domain.
- Password reset links work once and expire after 60 minutes; only a hash of the token is stored; the
  reset page sends no Referer (`netlify.toml`).
- Platform operators have separate accounts, their own cookie and token audience, an 8-hour session,
  and an optional IP allow-list (`PLATFORM_OPERATOR_ALLOWED_IPS`). By the owner's decision an operator
  account is never locked out and its sign-in is not rate limited; lockout and sign-in rate limits apply
  to company users only. Set `PLATFORM_OPERATOR_ALLOWED_IPS` and a long, unique password.

**Demo sandbox (/try).** Anonymous visitors get a session as one of four shared persona users of one
fictional company (`sandbox-demo`, [`server/lib/sandbox.ts`](server/lib/sandbox.ts)). Controls, all on the server:

- Every request of a sandbox session passes `sandboxGate` (in `authenticateToken`), whatever the route: reads
  are allowed except API keys, the user activity log and admin CSV exports; writes only from a short allowlist
  (recommendation decisions, action status, alert acknowledge, notifications read) with the body narrowed so no
  visitor's free text is kept and shown to the next one. Everything else is `403 sandbox_read_only` before the
  handler runs. The request runs in a sandbox context in which no AI provider is called (`server/lib/groq.ts`).
- Persona users cannot be signed in to any other way: the password sign-in refuses them (same `401 Invalid
  credentials`), `issueSessionCookie` throws for them (SSO, invitation, re-issue), forgot-password sends nothing;
  their password hashes are of random values nobody holds. Their API keys are refused.
- No e-mail is ever sent to the sandbox domain (`sendMail`); the digest and pulse sending skip the company.
- Sessions last two hours (token and row; browser-session cookie). A sandbox token is valid only with its session
  row, and the nightly reset deletes the company (rows included) and moves `sessions_valid_after`, so every
  session ends. The session row keeps only a keyed hash of the client address (no address, location or
  browser); sandbox requests are not written to the user activity log.
- `POST /api/auth/sandbox` accepts JSON only (a cross-site form cannot start a session; CORS as for the rest of
  the API), at most `SANDBOX_SESSIONS_PER_IP_HOUR` (20) new sessions per address per hour and
  `SANDBOX_MAX_SESSIONS` (300) open sessions, both counted in the database (global across Netlify instances).
- Isolation is the ordinary tenancy boundary; operator routes need an operator session. `/try` is `noindex`.
- Tests: `tests/api/sandbox.test.ts` (every refused action, session creation and limits, isolation, reset).

**API keys.** Ingestion keys (`igk_…`) are stored as a hash, shown once, scoped to one company, and
revocable. A suspended company's keys are refused.

**On-premises agent** ([`agent/`](agent/README.md)). For Jira, Linear, PagerDuty and Opsgenie a customer can run the agent
inside their own network instead of giving QE Navigator their tool tokens: it reads with their read-only credentials, opens no
port, connects out only to QE Navigator over HTTPS, applies the shared field allow-list
([`server/lib/ingest/fieldAllowList.ts`](server/lib/ingest/fieldAllowList.ts), vendored into the agent) and a stricter send
policy before anything leaves, and shows the exact payload with `qe-agent preview`. It has no runtime dependencies and ships as
one reproducible file or a distroless non-root image. Its own security posture, for customers' security reviews:
[agent/SECURITY.md](agent/SECURITY.md). Its requests are marked **agent** in the ingestion log.

**Rate limits** ([`server/middleware/rateLimit.ts`](server/middleware/rateLimit.ts)): general API
(`API_RATE_LIMIT_MAX` per minute, default 300), sign-in (20 failed attempts per 15 minutes per IP), forgot password (per IP and per
e-mail), reset password, invitations, ingestion (60 per minute), language-model routes and Recalculate.
The store is in memory, so on Netlify a limit applies per warm function instance.

**Input handling and output escaping (XSS).** Names typed by one person are shown to others (dialogs,
toasts, lists, e-mails, Slack, PDFs, CSV), so they are handled on both sides:

- *Names are validated on the server* ([`server/lib/displayName.ts`](server/lib/displayName.ts),
  `validateDisplayName`): trimmed, 1 to 100 characters, no `<` or `>`, no control characters (C0, DEL, C1)
  and no line or paragraph separators; apostrophes, hyphens, `&`, accents and other scripts are fine. A
  name that breaks the rules gets `400` with the reason (for example `First name cannot contain < or >`)
  and nothing is stored. Applied to people's first and last names (own profile `PUT /api/users/:id`,
  `POST` / `PUT /api/admin/users`, registration, accepting an invitation, the operator's create company
  first person), the job title (up to 120), team names (`POST` / `PUT /api/admin/teams`, `POST` /
  `PUT /api/teams`), department names (`POST` / `PUT /api/admin/departments`) and company names
  (registration, operator create / rename company and its first department and team). Names from an
  identity provider (SSO provisioning) are normalised instead (`normaliseDisplayName`: markup and control
  characters removed, cut to 100), since the person cannot correct them.
- *The front end never builds HTML from data.* React renders text. SweetAlert2 renders `title`, `html` and
  button text as HTML, so every dialog helper in [`src/utils/alerts.ts`](src/utils/alerts.ts) takes plain
  text: it uses `titleText` / `text`, and where a dialog needs markup (bold name, a list of members) each
  value goes through the one escaper, [`src/lib/escapeHtml.ts`](src/lib/escapeHtml.ts). Callers pass
  names and server messages, never HTML. The only `dangerouslySetInnerHTML` is the language-model answer
  on Business impact, sanitised with DOMPurify first. Links built from ingested URLs accept `http(s)` only.
- *Other outputs*: e-mail bodies escape every value (`escapeHtml` in `server/lib/mailer.ts`); Slack
  messages escape `&`, `<`, `>` in team names and alert text (`escapeSlack` in
  `server/lib/notifications.ts`; the digest's Slack summary holds counts only); PDFs are drawn as text by
  jsPDF; CSV cells that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` (`src/lib/csv.ts`).
- Legacy rows written before the validation existed are still shown as text.
  Tests: `tests/api/display-name.test.ts` (escaper and rules), `tests/api/stored-xss.test.ts` (every write
  path refuses markup), `tests/api/display-name-data.test.ts` (seed and demo names pass the rules),
  `tests/e2e/org/stored-xss.spec.ts` (names with markup planted in the database are shown as text in every
  dialog and toast; no script runs).

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
- [ ] The demo sandbox: keep `SANDBOX_ENABLED` on only where `/try` should work (off on a customer deployment).
