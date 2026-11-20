# Authentication and authorisation: developer guide

How sign-in, sessions and access control work in the code. For end users see
[AUTH_USER_GUIDE.md](AUTH_USER_GUIDE.md); for the per-role matrix see [ROLE_ACCESS.md](../ROLE_ACCESS.md).

## Files

| File | Role |
|---|---|
| `server/routes/auth.ts` | Register, login, logout, `/me`, forgot / reset password, sign out other devices |
| `server/routes/authSso.ts` | Sign-in providers, Google / Microsoft SSO, invitation lookup and acceptance |
| `server/lib/sessions.ts` | Session cookie, lifetime, `user_sessions` rows, `loadAccessContext`, revocation |
| `server/middleware/auth.ts` | `authenticateToken`: verifies the token and loads the current user and assignments |
| `server/middleware/apiKey.ts` | `authenticateApiKey` for `/api/ingest/*` |
| `server/lib/userPolicy.ts` | Every access rule, as pure functions shared by API and UI |
| `server/lib/assignments.ts`, `server/lib/roleAssignment.ts` | Role assignments (grants) |
| `server/middleware/access.ts` | Permission helpers used by routes |
| `server/lib/sso.ts` | OpenID Connect (PKCE, state, nonce, ID token verification) |
| `server/lib/invitations.ts`, `server/lib/passwordReset.ts` | Invitations and reset links |
| `server/lib/authEvents.ts` | Sign-in events (`auth_events`) |
| `server/lib/operator.ts`, `server/routes/operator.ts` | Platform operator accounts and sessions |
| `src/contexts/AuthContext.tsx` | Client session state (`GET /api/auth/me`) |
| `src/lib/viewAccess.ts`, `src/lib/accessSummary.ts` | Pages and navigation; the Help popover |
| `src/lib/passwordPolicy.ts` | Password rules (client and server) |

## Sign-in methods

**Password.** `POST /api/auth/login { email, password, rememberMe }`. The e-mail is matched case-insensitively.
Unknown e-mail, inactive user and wrong password all answer `401 Invalid credentials`. A suspended company
answers `403 { code: "company_suspended" }` only after the right password. Failed attempts are rate limited
per IP (20 per 15 minutes; successful sign-ins do not count). Every attempt is recorded in `auth_events`
(an unknown e-mail only as a keyed hash).

**Registration.** `POST /api/auth/register` creates a new company, its first department and team, and the
person as super admin. A company e-mail domain may be used by one organisation only; public domains
(`src/lib/emailDomains.ts`) never block.

**Invitation.** `GET /api/auth/invitations/:token` describes the invitation; `POST /api/auth/invitations/accept
{ token, firstName, lastName, password }` creates the user with the invited role assignment. Tokens are
stored as hashes, expire after `INVITE_TTL_HOURS` (default 168), can be revoked, and resending replaces the
token.

**Single sign-on.** `GET /api/auth/providers` lists the configured methods. `GET /api/auth/sso/:provider/start`
redirects to Google or Microsoft (authorization code flow with PKCE S256, state and nonce);
`…/callback` verifies the ID token (signature against the provider's keys, issuer, audience, expiry, nonce)
and uses only a verified e-mail. It matches an existing active user (by linked identity, else by verified
e-mail) or an open invitation for that e-mail; it never creates an account otherwise. A provider exists only
when its variables are set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; `MS_CLIENT_ID`, `MS_CLIENT_SECRET`,
`MS_TENANT`; and `APP_URL` for the redirect URI `<APP_URL>/api/auth/sso/<provider>/callback`.

**Password reset.** `POST /api/auth/forgot-password { email }` always answers the same way; when the user
exists it e-mails a link (`igr_` token, only its hash stored, valid 60 minutes, works once).
`POST /api/auth/reset-password { token, password }` sets the password, clears the lockout fields and ends
all the user's sessions. Both are rate limited.

**Password rules** (registration, invitation, reset): 10 to 128 characters, three of lower case / upper case /
number / symbol, not containing the part of the e-mail before the @.

## Sessions

- A JWT signed with `JWT_SECRET`, carrying the user id and a `jti`, in the httpOnly cookie `irongate_token`
  (`Secure` and `SameSite=Strict` in production, `Lax` in development). The same token is accepted as
  `Authorization: Bearer`.
- Lifetime: the company's "Sign-in lasts" setting, one of 1, 8, 24, 168 (default), 336 or 720 hours
  (`SESSION_LIFETIME_CHOICES`). With "Keep me signed in" the cookie persists for that time; without it the
  cookie is a browser session cookie.
- Each session is a `user_sessions` row (id = `jti`) with issue time, expiry, method, IP, country and last
  seen. `authenticateToken` reads the row in the same query as the user (`loadAccessContext`). A revoked row
  answers `401` with the header `X-Session-Ended`. `last_seen_at` is updated at most every 5 minutes.
- Revocation: sign out everywhere (admin), password change or reset, `POST /api/auth/sessions/sign-out-others`,
  a company suspension, and the operator's **Revoke** on one session.
- In production the API refuses to start without `JWT_SECRET`.

## Authorisation

1. `authenticateToken` loads the user's **current** row and active role assignments on every request. The
   token proves identity only; a deactivated user or a changed assignment takes effect on the next request.
2. Routes check permissions with the shared policy (`server/lib/userPolicy.ts`), for example
   `canViewTeamAnalytics` (the scope rule), `canManageTeam`, `canManageCompanyConfig`, `canOpenUserAdmin`.
3. Every query is limited to the caller's company.
4. The UI uses the same functions (`src/lib/viewAccess.ts`) to show only what the API allows. A page the
   person may not open redirects to the Overview with "You don't have access to …".

Roles and scope:

| Key | Screen name | Scope | Teams in scope |
|---|---|---|---|
| `super_admin` | Super admin | company | all teams of the company |
| `qa_manager` | Manager | department | the department's teams |
| `team_lead` | Team lead | team | that team |
| `qa_engineer` | Software engineer | team | that team |
| `viewer` | Viewer | team | that team |

A person may hold several assignments (`role_assignments`); access is the union. Nobody may change their own
role or manage someone of equal or higher rank.

## API keys

`authenticateApiKey` accepts `Authorization: Bearer igk_…` on `/api/ingest/*`. Keys are created by super
admins (`POST /api/admin/api-keys`), stored as a hash, shown once, and revocable. A suspended company's keys
answer `403 company_suspended`.

## Platform operators

Separate accounts (`platform_operators`), created with `npm run operator:create`. Sign-in at
`POST /api/operator/login` sets the cookie `irongate_operator` with its own token audience; 8-hour session;
lockout for 15 minutes after 5 failures; rate limited per IP; optional `PLATFORM_OPERATOR_ALLOWED_IPS`.
When an operator changes company data, the request runs the company app's handler as a super admin of that
company without a user id. Operator actions are not logged.

## Tests

`tests/api/registration.test.ts`, `password-reset.test.ts`, `sessions.test.ts`, `keep-signed-in.test.ts`,
`sso.test.ts`, `invitations.test.ts`, `auth-events-sessions.test.ts`, `platform-operator.test.ts`,
`role-matrix.test.ts`, `r2-security-matrix.test.ts`, `security.test.ts`, and the UI suites in `tests/e2e/`.
