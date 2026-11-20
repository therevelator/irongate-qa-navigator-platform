# Manual test cases

415 manual test cases, one for each automated UI test in `tests/e2e`. The same cases, with columns to record results, are in `MANUAL_TEST_CASES.xlsx`.

Environment: run the app locally (`npm run dev`, http://localhost:5173) with the demo data loaded; demo accounts use the password `demo123`. Only cases of type "Read-only (live site)" are safe on a live site.

## Contents

- [Sign-in and sessions](#sign-in-and-sessions) (29)
- [Registration and invitations](#registration-and-invitations) (19)
- [Forgot / reset password](#forgot--reset-password) (9)
- [Navigation, routes and the app frame](#navigation-routes-and-the-app-frame) (30)
- [Accessibility](#accessibility) (18)
- [Theme and phone layout](#theme-and-phone-layout) (28)
- [Overview (dashboard)](#overview-dashboard) (17)
- [Executive briefing](#executive-briefing) (3)
- [Team detail](#team-detail) (22)
- [Team TV mode](#team-tv-mode) (17)
- [Business impact](#business-impact) (9)
- [Analytics modules](#analytics-modules) (18)
- [Developer insights](#developer-insights) (3)
- [Compare teams](#compare-teams) (7)
- [Saved views](#saved-views) (5)
- [CSV export](#csv-export) (1)
- [Onboarding](#onboarding) (4)
- [KPI targets and ingestion log](#kpi-targets-and-ingestion-log) (4)
- [Executive summary](#executive-summary) (5)
- [Team improve (forecasts and recommendations)](#team-improve-forecasts-and-recommendations) (9)
- [Administration: manual metrics](#administration-manual-metrics) (7)
- [API keys and ingestion](#api-keys-and-ingestion) (3)
- [Sample (demo) data](#sample-demo-data) (4)
- [Administration: KPI targets](#administration-kpi-targets) (5)
- [Administration: parameters](#administration-parameters) (4)
- [Administration: update frequency](#administration-update-frequency) (1)
- [Alerts and notifications](#alerts-and-notifications) (11)
- [Tracked actions](#tracked-actions) (10)
- [CI evidence](#ci-evidence) (4)
- [Connect your CI](#connect-your-ci) (2)
- [Wellbeing pulse](#wellbeing-pulse) (24)
- [Developer productivity](#developer-productivity) (1)
- [Overview](#overview) (4)
- [Organisation: departments](#organisation-departments) (3)
- [Organisation: teams](#organisation-teams) (3)
- [Organisation: users](#organisation-users) (6)
- [Activity](#activity) (4)
- [User activity](#user-activity) (4)
- [Invitations](#invitations) (1)
- [Platform support](#platform-support) (23)
- [Navigation and access control](#navigation-and-access-control) (12)
- [Users and teams](#users-and-teams) (6)
- [Analytics](#analytics) (4)
- [Resilience](#resilience) (8)
- [Live smoke](#live-smoke) (4)

## Sign-in and sessions

### TC-AUTH-001: Super admin signs in with the form and sees the overview with their role

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app's start address (/). | The sign-in screen shows the heading Sign in, the fields Email address and Password and a Sign in button. |
| 2 | Type admin@irongate.com in Email address and demo123 in Password. | Both fields show what was typed (the password is masked). |
| 3 | Click Sign in. | The button briefly reads Signing in…; then the overview (dashboard) opens and the top bar title reads Overview. |
| 4 | Click the menu button at the left of the top bar (Open navigation). | The navigation drawer opens; at the bottom, under your name, the role reads exactly Super admin. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-01 admin signs in with the form and sees the overview with their role`

### TC-AUTH-002: Manager signs in with the form and sees the overview with their role

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app's start address (/). | The sign-in screen shows the heading Sign in, the fields Email address and Password and a Sign in button. |
| 2 | Type manager@irongate.com in Email address and demo123 in Password. | Both fields show what was typed (the password is masked). |
| 3 | Click Sign in. | The button briefly reads Signing in…; then the overview (dashboard) opens and the top bar title reads Overview. |
| 4 | Click the menu button at the left of the top bar (Open navigation). | The navigation drawer opens; at the bottom, under your name, the role reads exactly Manager. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-01 manager signs in with the form and sees the overview with their role`

### TC-AUTH-003: Team lead signs in with the form and sees the overview with their role

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app's start address (/). | The sign-in screen shows the heading Sign in, the fields Email address and Password and a Sign in button. |
| 2 | Type lead@irongate.com in Email address and demo123 in Password. | Both fields show what was typed (the password is masked). |
| 3 | Click Sign in. | The button briefly reads Signing in…; then the overview (dashboard) opens and the top bar title reads Overview. |
| 4 | Click the menu button at the left of the top bar (Open navigation). | The navigation drawer opens; at the bottom, under your name, the role reads exactly Team lead. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-01 lead signs in with the form and sees the overview with their role`

### TC-AUTH-004: Software engineer signs in with the form and sees the overview with their role

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app's start address (/). | The sign-in screen shows the heading Sign in, the fields Email address and Password and a Sign in button. |
| 2 | Type engineer@irongate.com in Email address and demo123 in Password. | Both fields show what was typed (the password is masked). |
| 3 | Click Sign in. | The button briefly reads Signing in…; then the overview (dashboard) opens and the top bar title reads Overview. |
| 4 | Click the menu button at the left of the top bar (Open navigation). | The navigation drawer opens; at the bottom, under your name, the role reads exactly Software engineer. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-01 engineer signs in with the form and sees the overview with their role`

### TC-AUTH-005: Viewer signs in with the form and sees the overview with their role

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app's start address (/). | The sign-in screen shows the heading Sign in, the fields Email address and Password and a Sign in button. |
| 2 | Type viewer@irongate.com in Email address and demo123 in Password. | Both fields show what was typed (the password is masked). |
| 3 | Click Sign in. | The button briefly reads Signing in…; then the overview (dashboard) opens and the top bar title reads Overview. |
| 4 | Click the menu button at the left of the top bar (Open navigation). | The navigation drawer opens; at the bottom, under your name, the role reads exactly Viewer. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-01 viewer signs in with the form and sees the overview with their role`

### TC-AUTH-006: Empty sign-in fields are refused before anything is sent

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Browser DevTools open on the Network tab (to confirm no request is sent)

**Test data**

- E-mail: admin@irongate.com
- Password: (empty)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The Sign in form is shown with empty fields. |
| 2 | Leave both fields empty and click Sign in. | The message 'Enter your email address and password.' appears above the form. |
| 3 | Type admin@irongate.com in Email address, leave Password empty and click Sign in. | The same message 'Enter your email address and password.' is shown; you stay on the sign-in screen. |
| 4 | Look at the Network tab. | No request to /api/auth/login was sent during these steps. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-02 empty fields are refused before anything is sent`

### TC-AUTH-007: Sign in with a wrong password says "Invalid credentials" and keeps the e-mail

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Fewer than 20 failed sign-ins from this computer's address in the last 15 minutes

**Test data**

- E-mail: viewer@irongate.com
- Password: not-the-password

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The Sign in form is shown. |
| 2 | Type viewer@irongate.com in Email address and not-the-password in Password, then click Sign in. | The message 'Invalid credentials' appears. |
| 3 | Look at the Email address field. | It still contains viewer@irongate.com. |
| 4 | Check the page. | You are still on the sign-in screen; the overview is not shown. |

**Notes:** Regression for fixed issue FI-01 (message and typed e-mail used to be lost).

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-03 a wrong password says "Invalid credentials" and keeps what was typed`

### TC-AUTH-008: An unknown e-mail gets exactly the same answer as a wrong password

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Fewer than 20 failed sign-ins from this computer's address in the last 15 minutes

**Test data**

- E-mail: nobody-here@uitest.example
- Password: whatever-123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The Sign in form is shown. |
| 2 | Type nobody-here@uitest.example in Email address and whatever-123 in Password, then click Sign in. | The message reads exactly 'Invalid credentials' (the same text as for a wrong password; nothing says the account does not exist). |
| 3 | Check the page. | You stay on the sign-in screen. |

**Notes:** Security: no account enumeration.

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-04 an unknown e-mail gets exactly the same answer (no account enumeration)`

### TC-AUTH-009: A deactivated account cannot sign in

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A super admin (admin@irongate.com / demo123) has added a test person via Users > Add with password: first name Fixture, last name Person, role Software engineer, team Mavericks, e-mail e.g. qa-fixture-<date>@uitest.example, password Ui-Tests-Passw0rd! (written down as the test person's credentials)
- The super admin has then deactivated the test person (Users > find the person > Deactivate button)
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: the test person's e-mail
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The Sign in form is shown. |
| 2 | Type the deactivated test person's e-mail and password and click Sign in. | The message 'Invalid credentials' appears. |
| 3 | Check the page. | You stay on the sign-in screen; the overview is not shown. |

**After the test:** Sign in as admin@irongate.com / demo123, open Users, find the test person and delete (deactivate) it

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-05 a deactivated account cannot sign in`

### TC-AUTH-010: After 20 failed attempts from one address the form says to wait

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F1.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Use a computer / network address whose sign-in limit you may lock for 15 minutes (the limit is per client address)

**Test data**

- Wrong attempts: E-mail nobody-here@uitest.example, Password x (20 times)
- Then: viewer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The Sign in form is shown. |
| 2 | Type nobody-here@uitest.example and password x and click Sign in; repeat until you have made 20 failed attempts. | Each attempt shows 'Invalid credentials'. |
| 3 | Now type the correct credentials viewer@irongate.com / demo123 and click Sign in. | The message 'Too many attempts, please try again later.' appears and you are not signed in. |

**After the test:** Wait 15 minutes (or ask a developer to restart the API) before signing in again from this address

**Notes:** The automated test sends the 20 failures straight to the API with a fake client address; a manual tester uses the form.

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-06 after 20 failed attempts from one address the form says to wait`

### TC-AUTH-011: The password can be shown and hidden

**Type:** Positive · **Priority:** Low · **Role:** Signed out · **Flow:** F1.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Password: secret-value

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and type secret-value in Password. | The password is masked (dots). |
| 2 | Click the eye button at the right of the Password field (Show password). | The password is shown in plain text: secret-value; the button is now Hide password. |
| 3 | Click the button again (Hide password). | The password is masked again. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-07 the password can be shown and hidden`

### TC-AUTH-012: Demo account chips fill in the credentials

**Type:** Positive · **Priority:** High · **Role:** Signed out · **Flow:** F1.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Demo mode is on (the sign-in screen shows the Demo accounts chips)

**Test data**

- Chip: Team lead

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | Below the form a 'Demo accounts' section says 'Select a role to fill in its credentials.' with chips Super admin, Manager, Team lead, Software engineer, Viewer. |
| 2 | Click the Team lead chip. | Email address now contains lead@irongate.com and Password is filled (demo123; use Show password to check). |
| 3 | Click Sign in. | The overview (dashboard) opens. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-08 demo account chips fill in the credentials (demo mode)`

### TC-AUTH-013: No SSO buttons when single sign-on is not configured

**Type:** Positive · **Priority:** Low · **Role:** Signed out · **Flow:** F1.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Demo mode is on (the sign-in screen shows the Demo accounts chips)
- Google / Microsoft single sign-on is not configured on the server

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The Demo accounts chips are shown. |
| 2 | Look above the Email address field. | There is no 'Continue with Google' or 'Continue with Microsoft' button. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-09 no SSO buttons when single sign-on is not configured`

### TC-AUTH-014: Configured SSO providers show their buttons pointing at the API

**Type:** Positive · **Priority:** Medium · **Role:** Signed out · **Flow:** F1.4, F1.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- A server with Google and Microsoft single sign-on configured and demo mode off (or, with DevTools > Sources > Overrides, override the response of GET /api/auth/providers with: sso = Google (/auth/sso/google/start) and Microsoft (/auth/sso/microsoft/start), demoMode false)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | Buttons 'Continue with Google' and 'Continue with Microsoft' are shown above the e-mail form. |
| 2 | Hover over (or right-click > Copy link) the Continue with Google button. | It links to the API start address <API>/auth/sso/google/start (e.g. http://localhost:3000/api/auth/sso/google/start). |
| 3 | Check the Continue with Microsoft button the same way. | It links to <API>/auth/sso/microsoft/start. |
| 4 | Look at the bottom of the form. | There is no Demo accounts section. |

**Notes:** Requires a server with SSO configured or DevTools response overrides; do not complete a real SSO sign-in (not part of this case).

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-10 configured SSO providers show their buttons pointing at the API (stubbed providers)`

### TC-AUTH-015: An unconfigured SSO provider is refused and the error comes back to the form

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F1.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Google single sign-on is not configured on the server

**Test data**

- Address 1: <API>/auth/sso/google/start (e.g. http://localhost:3000/api/auth/sso/google/start)
- Address 2: /?sso_error=not_allowed&sso_message=No%20account%20for%20this%20e-mail.%20Ask%20your%20administrator%20for%20an%20invitation.

| Step | Action | Expected result |
|---|---|---|
| 1 | Open Address 1 in the browser. | You are not taken to Google: either the API answers 'not found' or you are sent back to the app with sso_error in the address. |
| 2 | Open the app with Address 2. | The sign-in screen shows the message 'No account for this e-mail. Ask your administrator for an invitation.' |
| 3 | Look at the address bar. | The sso_error and sso_message parts have been removed; the address ends with /. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-11 an unconfigured SSO provider is refused by the API and the error comes back to the form`

### TC-AUTH-016: A server error or an unreachable server gives a clear message on sign-in

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F1.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Requires DevTools / a debugging proxy: (a) a way to make POST /api/auth/login answer HTTP 500 with body {"error":"Internal server error","requestId":"req-ui-test-500"} once (e.g. Charles / mitmproxy / Fiddler rule); (b) DevTools > Network request blocking

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). Turn on the proxy rule that makes the sign-in request answer 500 with request id req-ui-test-500. | — |
| 2 | Type viewer@irongate.com / demo123 and click Sign in. | The message reads 'Sign-in failed: the server had a problem. Try again in a moment. Reference: req-ui-test-500.' (no blank screen, no 'Failed to fetch'). |
| 3 | Turn off the 500 rule. In DevTools > Network request blocking, block the URL pattern */api/auth/login. | — |
| 4 | Click Sign in again. | The message reads 'The server could not be reached. Check your connection and try again.' |
| 5 | Look at Email address. | It still contains viewer@irongate.com. |

**After the test:** Remove the request blocking and proxy rules

**Notes:** Requires DevTools request blocking and a response-override proxy for the 500 part. Regression for FI-02.

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-12 a server error or an unreachable server gives a clear message, not a blank screen`

### TC-AUTH-017: Double-clicking Sign in signs in once

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F1.1, F16.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools open on the Network tab, filtered to 'login'

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and type viewer@irongate.com / demo123. | — |
| 2 | Double-click the Sign in button quickly. | The overview (dashboard) opens normally. |
| 3 | Look at the Network tab. | Exactly one POST request to /api/auth/login was sent. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-13 double-clicking Sign in signs in once`

### TC-AUTH-018: "Keep me signed in": unticked a browser-session cookie, ticked a cookie for the company sign-in lifetime

**Type:** Negative · **Priority:** Low · **Role:** Signed out · **Flow:** F1.6

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Two fresh private windows (no IronGate session)
- DevTools > Application > Cookies available

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | In private window 1, open /. | Under the Keep me signed in box the hint reads 'Unticked, you are signed out when you close the browser.' |
| 2 | Leave 'Keep me signed in' unticked and sign in as viewer@irongate.com / demo123. | The overview opens. |
| 3 | In DevTools > Application > Cookies for the API site, look at the irongate_token cookie. | Its Expires / Max-Age column reads 'Session' (a browser-session cookie). |
| 4 | Close window 1. In private window 2, open /, tick 'Keep me signed in' and sign in with the same account. | The overview opens. |
| 5 | Look at the irongate_token cookie again. | It has an expiry date about 7 days from now (the demo company's sign-in lifetime, Parameters → Sign-in). |
| 6 | Close private window 1 and 2, open a new private window and open / (optional check of the unticked case). | The sign-in screen is shown (the browser-session cookie did not survive closing the browser). |

**Notes:** Requires DevTools. The server also refuses a session older than the company sign-in lifetime on every request, ticked or not (FI-03, fixed).

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-14 "Keep me signed in": unticked a browser-session cookie, ticked a cookie for the company sign-in lifetime`

### TC-AUTH-019: "Keep me signed in" also applies to the Google / Microsoft buttons

**Type:** Positive · **Priority:** Low · **Role:** Signed out · **Flow:** F1.6, F1.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Single sign-on (Google) configured on the server, or DevTools > Network > override the response of /api/auth/providers with {"sso":[{"id":"google","label":"Google","startUrl":"/auth/sso/google/start"}],"demoMode":false}

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The button 'Continue with Google' is shown. |
| 2 | Hover (or inspect) 'Continue with Google' and read its link. | It points to <API>/auth/sso/google/start (no remember parameter). |
| 3 | Tick 'Keep me signed in' and read the link again. | It now ends with /auth/sso/google/start?remember=1. |
| 4 | Untick 'Keep me signed in'. | The link is back to /auth/sso/google/start. |

**Notes:** The real provider round trip is covered by the API test tests/api/sso.test.ts SSO-012 (persistent cookie only with remember=1). Requires SSO configured or a DevTools response override.

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign-in › AUTH-15 "Keep me signed in" also applies to the single sign-on buttons (stubbed providers)`

### TC-AUTH-020: Signing out returns to the sign-in screen; Back and reload do not show the app

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F1.7

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Open the navigation (menu button) and click Compare teams. | The top bar title reads Compare teams. |
| 3 | Open the navigation and click the Sign out button (door icon at the bottom, next to your name). | The sign-in screen with the heading Sign in is shown. |
| 4 | Click the browser's Back button. | The sign-in screen is still shown; no app page appears. |
| 5 | Reload the page (F5). | The sign-in screen is still shown. |
| 6 | In a new tab of the same window open <API>/auth/me (e.g. http://localhost:3000/api/auth/me). | The API answers 401 (not signed in) instead of the user's details. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign out and sessions › AUTH-20 signing out returns to the sign-in screen; Back and reload do not show the app`

### TC-AUTH-021: A deep link opened while signed out opens after signing in

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F1.8

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Address: /analytics/pulse
- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /analytics/pulse directly in the address bar. | The sign-in screen (heading Sign in) is shown instead of the page. |
| 2 | Sign in as lead@irongate.com / demo123 with the form. | After sign-in the Wellbeing pulse page opens (top bar title Wellbeing pulse), not the overview. |
| 3 | Look at the address bar. | The address contains /analytics/pulse. |

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign out and sessions › AUTH-21 a deep link opened while signed out opens after signing in`

### TC-AUTH-022: A session ended elsewhere sends the open app to sign-in with a message that survives a reload; the page opens again after signing in

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F1.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A super admin (admin@irongate.com / demo123) has added a test person via Users > Add with password: first name Fixture, last name Person, role Software engineer, team Mavericks, e-mail e.g. qa-fixture-<date>@uitest.example, password Ui-Tests-Passw0rd! (written down as the test person's credentials)
- Two browsers (or a normal and a private window): Browser A for the test person, Browser B for the super admin

**Test data**

- Test person: e-mail noted in the precondition, Ui-Tests-Passw0rd!
- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | In Browser A, sign in as the test person with the form. | The overview opens. |
| 2 | In Browser A, open the navigation and click Compare teams. | The title reads Compare teams. |
| 3 | In Browser B, sign in as admin@irongate.com / demo123, open Users, search for the test person, click its key button (Reset Password) and click 'Sign out everywhere'. | A confirmation message says the person was signed out on every device. |
| 4 | Back in Browser A, open the navigation and click Technical debt. | The sign-in screen appears with the notice 'Your session has ended. Please sign in again.' |
| 5 | Look at the address bar in Browser A. | It still contains /analytics/technical-debt. |
| 6 | Reload the page in Browser A (F5). | The sign-in screen still shows the notice 'Your session has ended. Please sign in again.' and the address still contains /analytics/technical-debt. |
| 7 | Sign in again as the test person in Browser A. | The Technical debt page opens (title Technical debt). |
| 8 | In Browser A, sign out (navigation > Sign out) and reload the page. | The plain sign-in screen is shown, without the notice (a successful sign-in removed it). |

**After the test:** Sign in as admin@irongate.com / demo123, open Users, find the test person and delete (deactivate) it

**Notes:** The automated test ends the sessions directly in the database; 'Sign out everywhere' (Users > key button) does the same. The notice is kept for the browser tab (FI-16, fixed).

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign out and sessions › AUTH-22 a session ended elsewhere (signed out everywhere) sends the open app to sign-in with a message that survives a reload, and the page opens again after signing in`

### TC-AUTH-023: An expired sign-in says so

**Type:** Negative · **Priority:** Medium · **Role:** Viewer · **Flow:** F1.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Requires a debugging proxy (e.g. Charles / mitmproxy) able to make GET /api/auth/me answer 401 with body {"error":"Session expired"} and headers X-Session-Ended: session_expired and Access-Control-Expose-Headers: X-Session-Ended. Alternative without tools: a super admin sets Parameters > Sign-in > Sign-in lasts to the shortest value, then wait until it has passed

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Turn on the proxy rule for GET /api/auth/me (or wait until the sign-in lifetime has passed). | — |
| 3 | Reload the page. | The sign-in screen is shown with the notice 'Your sign-in has expired. Please sign in again.' |

**After the test:** Turn the proxy rule off (or put Sign-in lasts back to its previous value)

**Notes:** Requires a response-override proxy (or a long wait).

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign out and sessions › AUTH-23 an expired sign-in says so`

### TC-AUTH-024: "Sign out my other devices" can be cancelled and then nothing changes

**Type:** Negative · **Priority:** Medium · **Role:** Software engineer · **Flow:** F1.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A super admin (admin@irongate.com / demo123) has added a test person via Users > Add with password: first name Fixture, last name Person, role Software engineer, team Mavericks, e-mail e.g. qa-fixture-<date>@uitest.example, password Ui-Tests-Passw0rd! (written down as the test person's credentials)
- Two browsers (A and B), both signed in as the test person

**Test data**

- Test person: e-mail noted in the precondition, Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | In Browser A, open the navigation. | The drawer shows your name and, next to it, the buttons 'Sign out my other devices' and 'Sign out'. |
| 2 | Click 'Sign out my other devices'. | A browser confirmation asks 'Sign out on all your other devices and browsers? This one stays signed in.' |
| 3 | Click Cancel. | The dialog closes; no success message appears. |
| 4 | In Browser B, reload the page. | Browser B still shows the overview (dashboard); it was not signed out. |

**After the test:** Sign in as admin@irongate.com / demo123, open Users, find the test person and delete (deactivate) it

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign out and sessions › AUTH-24 "Sign out my other devices" can be cancelled and then nothing changes`

### TC-AUTH-025: "Sign out my other devices" reports a server failure

**Type:** Negative · **Priority:** Medium · **Role:** Viewer · **Flow:** F1.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Requires a debugging proxy able to make POST /api/auth/sessions/sign-out-others answer HTTP 500 with body {"error":"Internal server error","requestId":"rid-x"}

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Turn on the proxy rule for POST /api/auth/sessions/sign-out-others. | — |
| 3 | Open the navigation and click 'Sign out my other devices'; click OK in the confirmation. | An error message 'Internal server error' appears (toast). |
| 4 | Close the navigation (Escape) and look at the page. | The overview (dashboard) is still shown; you are still signed in. |

**After the test:** Turn the proxy rule off

**Notes:** Requires a response-override proxy. With DevTools request blocking instead, the message is 'The server could not be reached.' (different case).

*Automated:* `tests/e2e/auth/sign-in.spec.ts › Sign out and sessions › AUTH-25 "Sign out my other devices" reports a server failure`

### TC-AUTH-053: A super admin sets "Sign-in lasts" to 1 hour; the next sign-in lasts 1 hour

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F1.12

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- A second browser / private window
- DevTools > Application > Cookies available

**Test data**

- Super admin: admin@irongate.com / demo123
- Sign-in lasts: 1 hour

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /parameters-config after the site address in the address bar and press Enter. | The page at /parameters-config opens. |
| 2 | Find the 'Sign-in' card and open the 'Sign-in lasts' list. | The list offers several durations; the current one is selected. |
| 3 | Choose 1 hour and click Save. | A message 'Sign-in now lasts 1 hour' appears; below the list the text reads 'Current: 1 hour. Shortening it signs out anyone signed in for longer than the new limit.' |
| 4 | In the second browser tick 'Keep me signed in' and sign in as admin@irongate.com / demo123. | The overview opens. |
| 5 | In DevTools > Application > Cookies (API site) look at the Expires value of irongate_token. | It expires about 1 hour from now (between 54 and 61 minutes). |
| 6 | In the second browser open /parameters-config. | 'Sign-in lasts' shows 1 hour. |

**After the test:** Set 'Sign-in lasts' back to its previous value (the default) and click Save

**Notes:** Cookie check requires DevTools. Without 'Keep me signed in' the cookie is a browser-session cookie (Expires: Session); the sign-in still ends after 1 hour.

*Automated:* `tests/e2e/sessions.spec.ts › Sign-in lifetime and signing out other devices › A super admin sets "Sign-in lasts" to 1 hour; the next sign-in lasts 1 hour`

### TC-AUTH-054: "Sign out my other devices" keeps this browser and signs the other one out with a message

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F1.11, F1.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A super admin (admin@irongate.com / demo123) has added a test person via Users > Add with password: first name Fixture, last name Person, role Software engineer, team Mavericks, e-mail e.g. qa-fixture-<date>@uitest.example, password Ui-Tests-Passw0rd! (written down as the test person's credentials)
- Two browsers: Browser A ("other") and Browser B ("mine")

**Test data**

- Test person: e-mail noted in the precondition, Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test person in Browser A. | The overview opens. |
| 2 | Wait a few seconds, then sign in as the test person in Browser B. | The overview opens. |
| 3 | In Browser B open the navigation and click 'Sign out my other devices'; click OK in the confirmation. | The message 'You were signed out on all other devices. This device stays signed in.' appears. |
| 4 | In Browser A open the navigation and click any page (e.g. Compare teams). | Browser A shows the sign-in screen with the notice 'Your session has ended. Please sign in again.' |
| 5 | In Browser B reload the page. | Browser B still shows the overview (still signed in). |
| 6 | Reload the browser that was signed out. | The sign-in screen still shows 'Your session has ended. Please sign in again.' (FI-16, fixed). |

**After the test:** Sign in as admin@irongate.com / demo123, open Users, find the test person and delete (deactivate) it

*Automated:* `tests/e2e/sessions.spec.ts › Sign-in lifetime and signing out other devices › "Sign out my other devices" keeps this browser and signs the other one out with a message`

### TC-ADM-026: A super admin changes 'Sign-in lasts' and the current value label follows

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F1.12

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions); its sign-in lifetime is still the default.

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Sign-in lasts: 8 hours

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Parameters. | A 'Sign-in' card is shown with the dropdown 'Sign-in lasts' set to '7 days (default)' and a disabled 'Save' button. |
| 2 | Choose '8 hours' in 'Sign-in lasts'. | The 'Save' button of the Sign-in card becomes enabled. |
| 3 | Click 'Save'. | A toast 'Sign-in now lasts 8 hours' appears and the text below reads 'Current: 8 hours. Shortening it signs out anyone signed in for longer than the new limit.' |
| 4 | Reload the page. | 'Sign-in lasts' shows '8 hours'. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › Configuration values and sign-in lifetime › PAR-12 "Sign-in lasts" can be changed by a super admin; the label follows`

### TC-ROLE-043: A forged session cookie shows the sign-in screen, not a broken page

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F1.13

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- Cookie: name irongate_token, value not-a-jwt, domain localhost, path /

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173. In DevTools > Application > Cookies > http://localhost:5173, add a cookie named irongate_token with value not-a-jwt (domain localhost, path /). | The cookie is listed. |
| 2 | Go to http://localhost:5173/compare. | The sign-in screen with the heading "Sign in" is shown; the page is not blank and shows no error. |

**After the test:** Delete the irongate_token cookie.

**Notes:** Requires DevTools (editing cookies).

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-09 a forged or corrupted session cookie means signed out, not a broken page`

## Registration and invitations

### TC-AUTH-026: A new organisation is created and its creator is signed in as super admin

**Type:** Positive · **Priority:** High · **Role:** Signed out · **Flow:** F3.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- First name: Ada
- Last name: O'Neil-Smith
- Email: ada@<unique>.uitest.example (e.g. ada@reg-20261119a.uitest.example)
- Organisation name: UI Reg <unique> (e.g. UI Reg 20261119a)
- First department: Engineering
- First team: Payments QA
- Password / Confirm password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Fill in every field with the test data. | The three password rules below the password all show a tick (met). |
| 3 | Click Create account. | The button reads Creating account…; then the overview (dashboard) opens. |
| 4 | Look at the top of the overview. | A greeting heading contains Ada (e.g. 'Good morning, Ada'), and the 'Set up your organisation' checklist is shown. |
| 5 | Open the navigation. | Under your name the role reads Super admin. |
| 6 | Click Departments in the navigation. | The Departments page opens (title Departments) and lists the department Engineering. |

**After the test:** Ask a developer / database administrator to delete the test organisation that was created (there is no delete in the UI)

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-01 a new organisation is created and its creator is signed in as super admin`

### TC-AUTH-027: Registration: every field is required

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F3.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- First name Ada, Last name Lovelace, Email a@b.example, Organisation name X Org, First department D (First team and passwords left empty)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Click Create account with all fields empty. | The message 'Please complete all fields.' appears. |
| 3 | Fill in First name, Last name, Email, Organisation name and First department only, and click Create account. | The message 'Please complete all fields.' is still shown; no organisation is created and you stay on the form. |

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-02 every field is required`

### TC-AUTH-028: Registration: names and organisation names with markup or symbols are refused

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F3.1, F16.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- First name: <img src=x onerror=alert(1)>
- Last name: Lovelace
- Email: a unique address, e.g. reg-xss-1@uitest.example
- Organisation name: Org, then Evil <script>
- First department: D
- First team: T
- Password / Confirm password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Fill every field with the test data, using <img src=x onerror=alert(1)> as First name, and click Create account. | The message 'Names may contain letters, spaces, hyphens and apostrophes only.' appears; no alert box pops up. |
| 3 | Change First name to Ada and Organisation name to Evil <script>, then click Create account. | The message 'Organisation name may contain letters, numbers, spaces and the characters - ' & .' appears; nothing is created. |

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-03 names and organisation names with markup or symbols are refused`

### TC-AUTH-029: Registration: mismatched and weak passwords are refused (the invitation and reset rules)

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F3.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- First name Ada, Last name Lovelace, Email lovelace@reg-pw-<unique>.uitest.example, Organisation name Some Org, First department D, First team T
- Password Ui-Tests-Passw0rd! / Confirm Ui-Tests-Passw0rd!x
- Weak passwords: Abcdefg1! (9 characters), abcdefghijkl (one kind of character), Lovelace-2024! (contains the e-mail name)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Fill in the details, type Ui-Tests-Passw0rd! as Password and Ui-Tests-Passw0rd!x as Confirm password, then click Create account. | The message 'The passwords do not match.' appears. |
| 3 | Type Abcdefg1! in Password and Confirm password. | Below the password, the rule 'At least 10 characters' shows (not met). |
| 4 | Click Create account. | The message 'Choose a stronger password (see the rules below the password).' appears; nothing is created. |
| 5 | Type abcdefghijkl in both fields and click Create account. | 'Three of: lower case, upper case, number, symbol' is not met; the same message appears. |
| 6 | Type Lovelace-2024! in both fields and click Create account. | 'Does not contain your email name' is not met; the same message appears. |
| 7 | Optional (API client): send POST <API>/auth/register with the same details, a new e-mail and password Abcdefg1!. | Status 400 with error 'The password must be 10 to 128 characters long.'; no organisation is created. |

**Notes:** Registration uses the same password rules as accepting an invitation and resetting a password (FI-18, fixed). The API step needs an API client.

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-04 mismatched and weak passwords are refused (the invitation and reset rules)`

### TC-AUTH-030: Registration: an e-mail that already has an account is refused and the form keeps what was typed

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F3.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- First name Ada, Last name Lovelace
- Email: viewer@irongate.com
- Organisation name: UI Dup <unique> (e.g. UI Dup 1119a)
- First department D, First team T
- Password / Confirm: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Fill in all fields with the test data and click Create account. | The message 'Email already registered' appears. |
| 3 | Look at the form. | The form is still shown and First name still contains Ada (what was typed is kept). |

**Notes:** Regression for FI-01.

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-05 an e-mail that already has an account is refused, and what was typed stays`

### TC-AUTH-031: Registration: the name of an existing organisation is refused

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F3.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Know the exact name of the demo organisation (NovaTech)

**Test data**

- First name Ada, Last name Lovelace
- Email: a unique address, e.g. reg-dup-org@uitest.example
- Organisation name: NovaTech (exact name of the existing demo organisation)
- First department D, First team T
- Password / Confirm: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Fill in all fields, using the existing organisation's name, and click Create account. | The message 'An organisation with this name already exists. Ask its administrator to create an account for you.' appears; you are not added to that organisation. |

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-06 the name of an existing organisation is refused (no joining by name)`

### TC-AUTH-032: Registration: a second organisation for the same company e-mail domain is refused with a clear message

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F3.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An organisation has already been registered with an owner e-mail on a unique domain, e.g. owner@reg-dom-1119.uitest.example (register it first via Create an account)

**Test data**

- First name Ada, Last name Lovelace
- Email: someone.else@reg-dom-1119.uitest.example (same domain)
- Organisation name: UI Other <unique>
- First department D, First team T
- Password / Confirm: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Type the test e-mail (same company domain) in Email. | The hint under Email reads 'With a company address, yours is the only organisation for that e-mail domain. Personal addresses (gmail.com, outlook.com, …) work too.' |
| 3 | Fill in the other fields with the test data and click Create account. | The message 'An organisation already uses the e-mail domain reg-dom-1119.uitest.example. Ask its administrator to invite you.' appears (with your domain); no organisation is created. |

**After the test:** Ask a developer / database administrator to delete the test organisation created for the precondition (there is no delete in the UI)

**Notes:** A company domain belongs to one organisation (FI-05). Public e-mail domains are not limited: see the next case (FI-05b).

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-08 a second organisation for the same company e-mail domain is refused with a clear message`

### TC-AUTH-033: Registration: people with a gmail.com address each create their own organisation

**Type:** Positive · **Priority:** High · **Role:** Signed out · **Flow:** F3.1b

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Two fresh private windows (no IronGate session)

**Test data**

- First person: Gail First, uitest.first.<unique>@gmail.com, organisation UI Gmail first <unique>
- Second person: Gail Second, uitest.second.<unique>@gmail.com, organisation UI Gmail second <unique>
- Department Engineering, team Team, password Ui-Tests-Passw0rd! (both)

| Step | Action | Expected result |
|---|---|---|
| 1 | In window 1 open / and click 'Create an account'. | The heading 'Create your organisation' is shown. |
| 2 | Type the first person's gmail.com address in Email. | The hint under Email reads 'gmail.com is a personal e-mail provider, so it is not linked to your organisation. You invite the people who join.' |
| 3 | Fill in the other fields and click Create account. | The overview of the new organisation opens. |
| 4 | Open /users. | Exactly one user card is shown: the first person. |
| 5 | In window 2 repeat steps 1–3 with the second person's gmail.com address and organisation name. | No domain error: the overview of a second, separate organisation opens. |
| 6 | Open /users in window 2. | Exactly one user card is shown: the second person (nobody was added because of the shared gmail.com domain). |

**After the test:** Remove both test organisations (database clean-up or the platform support panel).

**Notes:** Product decision FI-05b (fixed): public e-mail domains (gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, proton.me, …) never block a registration; nothing joins people to an organisation by domain. API tests: tests/api/registration.test.ts.

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-09 people with a public e-mail address (gmail.com) each create their own organisation`

### TC-AUTH-034: Registration: "Sign in" goes back to the sign-in screen

**Type:** Positive · **Priority:** Low · **Role:** Signed out · **Flow:** F3.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Create an account' (below the form, after 'New organisation?'). | The heading 'Create your organisation' is shown with the fields First name, Last name, Email, Organisation name, First department, First team, Password and Confirm password and a Create account button. |
| 2 | Click 'Sign in' (after 'Already have an account?'). | The sign-in screen with the heading Sign in is shown. |

*Automated:* `tests/e2e/auth/register.spec.ts › Registration › REG-07 "Sign in" goes back to the sign-in screen`

### TC-AUTH-043: A super admin invites a viewer; the person accepts and gets exactly that role

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F3.3, F3.4, F3.6

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A new test organisation registered via 'Create an account' (e.g. organisation name UI Inv Org <unique>, owner owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, first department Engineering, first team Core Team); its owner is its super admin
- E-mail delivery is not configured on the server, so the invite dialog shows the invitation link to copy
- A second browser / private window for the invited person

**Test data**

- Invitee e-mail: inv-<unique>@uitest.example
- Role: Viewer
- First name Ivy, Last name Invited
- Password / Repeat: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test organisation's owner and open Users (navigation > Users, or /users). | The Users page opens with an Invite button. |
| 2 | Click Invite. | The dialog 'Invite a person' opens with Email address, Role and Team fields and a 'Send invitation' button. |
| 3 | Type inv-<unique>@uitest.example in Email address, choose Role Viewer (Team: Core Team) and click Send invitation. | The dialog says 'No email was sent. … Send this link to <address> yourself; it works once.' and shows the invitation link (…/accept-invite?token=igi_…). |
| 4 | Copy the link and note it, then click Done. | The dialog closes; the Invitations panel lists the address. |
| 5 | Look at the invitee's row in the Invitations panel. | The row shows the status Pending. |
| 6 | In the second browser open the copied link. | The page 'Join <organisation name>' says you are invited as Viewer; Email address shows the invitee address. |
| 7 | Type First name Ivy, Last name Invited, Password and Repeat the password Ui-Tests-Passw0rd!, and click 'Accept and sign in'. | The overview (dashboard) opens for the new person. |
| 8 | Open the navigation. | Under the name the role reads Viewer; there is no Users entry. |
| 9 | In the first browser reload Users and tick 'Show accepted and revoked'. | The invitee's row shows the status Accepted. |

**After the test:** Ask a developer / database administrator to delete the test organisation

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-01 a super admin invites a viewer; the person accepts and gets exactly that role`

### TC-AUTH-044: Resending an invitation makes a new link and the old one stops working

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F3.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A new test organisation registered via 'Create an account' (e.g. organisation name UI Inv Org <unique>, owner owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, first department Engineering, first team Core Team); its owner is its super admin
- E-mail delivery is not configured on the server, so the invite dialog shows the invitation link to copy
- A second browser / private window (signed out)

**Test data**

- Invitee e-mail: inv-<unique>@uitest.example
- Role: Viewer

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test organisation's owner and open Users (navigation > Users, or /users). | The Users page opens with an Invite button. |
| 2 | Click Invite. | The dialog 'Invite a person' opens with Email address, Role and Team fields and a 'Send invitation' button. |
| 3 | Type inv-<unique>@uitest.example in Email address, choose Role Viewer (Team: Core Team) and click Send invitation. | The dialog says 'No email was sent. … Send this link to <address> yourself; it works once.' and shows the invitation link (…/accept-invite?token=igi_…). |
| 4 | Copy the link and note it, then click Done. | The dialog closes; the Invitations panel lists the address. |
| 5 | In the Invitations panel click Resend on the invitee's row. | A new invitation link is shown; it differs from the first one. Note it as the second link. |
| 6 | In the second browser open the FIRST link. | The page 'This invitation cannot be used' is shown with an explanation. |
| 7 | Open the SECOND link. | The page 'Join <organisation name>' with the accept form is shown. |

**After the test:** Ask a developer / database administrator to delete the test organisation

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-02 resending makes a new link and the old one stops working`

### TC-AUTH-045: A revoked invitation cannot be used

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F3.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A new test organisation registered via 'Create an account' (e.g. organisation name UI Inv Org <unique>, owner owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, first department Engineering, first team Core Team); its owner is its super admin
- E-mail delivery is not configured on the server, so the invite dialog shows the invitation link to copy
- A second browser / private window (signed out)

**Test data**

- Invitee e-mail: inv-<unique>@uitest.example
- Role: Viewer

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test organisation's owner and open Users (navigation > Users, or /users). | The Users page opens with an Invite button. |
| 2 | Click Invite. | The dialog 'Invite a person' opens with Email address, Role and Team fields and a 'Send invitation' button. |
| 3 | Type inv-<unique>@uitest.example in Email address, choose Role Viewer (Team: Core Team) and click Send invitation. | The dialog says 'No email was sent. … Send this link to <address> yourself; it works once.' and shows the invitation link (…/accept-invite?token=igi_…). |
| 4 | Copy the link and note it, then click Done. | The dialog closes; the Invitations panel lists the address. |
| 5 | Click Revoke on the invitee's row. | The message 'Invitation to <address> revoked' appears. |
| 6 | In the second browser open the invitation link. | The page 'This invitation cannot be used' is shown; no accept form. |

**After the test:** Ask a developer / database administrator to delete the test organisation

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-03 a revoked invitation cannot be used`

### TC-AUTH-046: An expired invitation says so and offers no form

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F3.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An invitation link whose validity has passed (invitations last 7 days by default): send an invitation and wait until it expires, or ask a developer to set its expiry in the past

**Test data**

- The expired invitation link (…/accept-invite?token=igi_…)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the expired invitation link. | The page 'This invitation cannot be used' is shown. |
| 2 | Read the explanation. | It contains 'expired' ('This invitation has expired. Ask the person who invited you to send a new one.'). |
| 3 | Look for the password fields. | No Password field / accept form is shown. |

**Notes:** The automated test inserts an expired invitation directly in the database.

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-04 an expired invitation says so and offers no form`

### TC-AUTH-047: A wrong or incomplete invitation link says the invitation cannot be used

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F3.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Address 1: /accept-invite?token=igi_not-a-real-token
- Address 2: /accept-invite

| Step | Action | Expected result |
|---|---|---|
| 1 | Open Address 1. | The page 'This invitation cannot be used' is shown. |
| 2 | Open Address 2 (no token). | The text reads 'This invitation link is incomplete. Open the link from your email again.' |
| 3 | Click 'Go to sign in'. | The sign-in screen (heading Sign in) is shown. |

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-05 a wrong or incomplete link says the invitation cannot be used`

### TC-AUTH-048: The invite dialog checks the e-mail; an address that already has an account is refused

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F3.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A new test organisation registered via 'Create an account' (e.g. organisation name UI Inv Org <unique>, owner owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, first department Engineering, first team Core Team); its owner is its super admin

**Test data**

- E-mail 1: not-an-email
- E-mail 2: the test organisation owner's own e-mail

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test organisation's owner and open Users (navigation > Users, or /users). | The Users page opens with an Invite button. |
| 2 | Click Invite, type not-an-email in Email address and click Send invitation. | Inside the dialog the message 'Enter a valid email address.' appears. |
| 3 | Replace the e-mail with the owner's own e-mail address and click Send invitation. | Inside the dialog an error message is shown (the address already has an account). |
| 4 | Look at the dialog. | No invitation link is shown. |

**After the test:** Ask a developer / database administrator to delete the test organisation

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-06 the invite dialog checks the e-mail; the API refuses an address that already has an account`

### TC-AUTH-049: The accept-invitation form checks names, password strength and the repeat

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F3.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A new test organisation registered via 'Create an account' (e.g. organisation name UI Inv Org <unique>, owner owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, first department Engineering, first team Core Team); its owner is its super admin
- E-mail delivery is not configured on the server, so the invite dialog shows the invitation link to copy
- A second browser / private window (signed out)

**Test data**

- Invitee e-mail: invname<unique>@uitest.example (local part e.g. invname1119)
- Weak password: short
- Password containing the e-mail name: invname1119-A1!
- Mismatch: Ui-Tests-Passw0rd! / Ui-Tests-Passw0rd!?

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test organisation's owner and open Users (navigation > Users, or /users). | The Users page opens with an Invite button. |
| 2 | Click Invite. | The dialog 'Invite a person' opens with Email address, Role and Team fields and a 'Send invitation' button. |
| 3 | Type invname1119@uitest.example in Email address, choose Role Viewer (Team: Core Team) and click Send invitation. | The dialog says 'No email was sent. … Send this link to <address> yourself; it works once.' and shows the invitation link (…/accept-invite?token=igi_…). |
| 4 | Copy the link and note it, then click Done. | The dialog closes; the Invitations panel lists the address. |
| 5 | In the second browser open the invitation link. | The page 'Join <organisation name>' with the accept form is shown. |
| 6 | Leave First name and Last name empty, type Ui-Tests-Passw0rd! in Password and Repeat the password, and click Accept and sign in. | The message 'Enter your first and last name.' appears. |
| 7 | Type First name Ivy, Last name Invited, password short in both password fields and click Accept and sign in. | The message 'Choose a stronger password (see the rules below).' appears. |
| 8 | Type invname1119-A1! in both password fields and click Accept and sign in. | The message 'Choose a stronger password (see the rules below).' appears (the password contains the e-mail name). |
| 9 | Type Ui-Tests-Passw0rd! as Password and Ui-Tests-Passw0rd!? as Repeat the password and click Accept and sign in. | The message 'The two passwords do not match.' appears; the overview does not open. |

**After the test:** Ask a developer / database administrator to delete the test organisation

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-07 the accept form checks names, password strength and the repeat`

### TC-AUTH-050: An invitation opened while signed in asks to sign out first

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F3.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A new test organisation registered via 'Create an account' (e.g. organisation name UI Inv Org <unique>, owner owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, first department Engineering, first team Core Team); its owner is its super admin
- E-mail delivery is not configured on the server, so the invite dialog shows the invitation link to copy

**Test data**

- Invitee e-mail: inv-<unique>@uitest.example

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test organisation's owner and open Users (navigation > Users, or /users). | The Users page opens with an Invite button. |
| 2 | Click Invite. | The dialog 'Invite a person' opens with Email address, Role and Team fields and a 'Send invitation' button. |
| 3 | Type inv-<unique>@uitest.example in Email address, choose Role Viewer (Team: Core Team) and click Send invitation. | The dialog says 'No email was sent. … Send this link to <address> yourself; it works once.' and shows the invitation link (…/accept-invite?token=igi_…). |
| 4 | Copy the link and note it, then click Done. | The dialog closes; the Invitations panel lists the address. |
| 5 | In the same browser (still signed in) open the invitation link. | The page 'You are already signed in' is shown with the buttons Sign out and 'Go to the dashboard'. |
| 6 | Click Sign out. | The page 'Join <organisation name>' with the accept form is shown. |

**After the test:** Ask a developer / database administrator to delete the test organisation

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-08 an invitation opened while signed in asks to sign out first`

### TC-AUTH-051: Invite role options: a manager may invite team leads, engineers and viewers; a team lead engineers and viewers

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F3.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Manager: manager@irongate.com / demo123
- Team lead: lead@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /users after the site address in the address bar and press Enter. | The page at /users opens. |
| 2 | Click Invite and open the Role list. | The options are exactly: Team lead, Software engineer, Viewer (no Super admin, no Manager). |
| 3 | Click Cancel, open the navigation and click Sign out. | The sign-in screen is shown. |
| 4 | Sign in as Team lead (lead@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /users after the site address in the address bar and press Enter. | The page at /users opens. |
| 5 | Click Invite and open the Role list. | The options are exactly: Software engineer, Viewer. |

**Notes:** Access control check; nothing is sent.

*Automated:* `tests/e2e/auth/invitations.spec.ts › Invitations › INV-09 a manager may invite team leads, software engineers and viewers only; a team lead engineers and viewers`

### TC-AUTH-131: Right after signing in with the form, a company that hides sample-data notices shows no 'Includes sample data' banner

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F1.14

**Preconditions**

- App running at the test URL
- A company whose data includes generated sample values (e.g. the Meridian showcase), with 'Hide the sample-data notices' on (platform support → Edit company)

**Test data**

- A super admin of that company

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in with the form (do not reload afterwards). | The overview opens with the team cards and WITHOUT the 'Includes sample data.' banner. |
| 2 | Sign out. In platform support untick 'Hide the sample-data notices' for the company, then sign in again with the form. | The 'Includes sample data.' banner is shown on the overview. |
| 3 | Set the option back on. | — |

**After the test:** Leave 'Hide the sample-data notices' as it was.

*Automated:* `tests/e2e/auth/sample-notice-sign-in.spec.ts › Sign-in and the sample-data notice › SIGN-SN-01 the banner follows the company setting straight after the sign-in form`

## Forgot / reset password

### TC-AUTH-035: The forgot-password form checks the address format

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F2.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: not an e-mail

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /forgot-password. | The heading 'Forgot your password?' is shown with an Email address field and a 'Send reset link' button. |
| 2 | Type 'not an e-mail' in Email address and click Send reset link. | The message 'Enter the e-mail address you sign in with.' appears; no confirmation is shown. |
| 3 | Click 'Back to sign in'. | The sign-in screen (heading Sign in) is shown. |

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-01 the forgot-password form checks the address format`

### TC-AUTH-036: Forgot password: an unknown address gets the same answer and no e-mail is sent

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F2.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Fewer than 5 forgot-password requests from this computer's address in the last 15 minutes
- Access to the e-mails the server sends (a test mailbox, or in local test runs the e-mail log file test-results/ui-local-logs/mail.jsonl / MAIL_CAPTURE_FILE)

**Test data**

- E-mail: nobody-<timestamp>@uitest.example (an address with no account)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /forgot-password. | The heading 'Forgot your password?' is shown. |
| 2 | Type the unknown address and click Send reset link. | The page shows 'Check your e-mail' and the text "If an account exists for that e-mail, we've sent a link." (same answer as for a real account). |
| 3 | Check the mailbox / e-mail log for that address. | No e-mail was sent to the unknown address. |

**Notes:** Security: no account enumeration.

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-02 an unknown address gets the same answer and no e-mail is sent`

### TC-AUTH-037: The forgot-password form survives an unreachable server

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F2.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools > Network request blocking: block the URL pattern */api/auth/forgot-password

**Test data**

- E-mail: someone@uitest.example

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /forgot-password and turn on the request blocking. | — |
| 2 | Type someone@uitest.example and click Send reset link. | The message 'The server could not be reached. Try again in a moment.' appears; the form stays usable (no blank page). |

**After the test:** Remove the request blocking

**Notes:** Requires DevTools request blocking.

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-03 the forgot-password form survives an unreachable server`

### TC-AUTH-038: A reset page without a token or with a wrong token offers no reset

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F2.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Address 1: /reset-password
- Address 2: /reset-password?token=igr_wrong-token-value
- New password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open Address 1 (no token). | The page shows 'This link cannot be used' with the text 'This reset link is incomplete. Open the link from your e-mail again, or ask for a new one.' and a button 'Ask for a new link'. |
| 2 | Open Address 2. | The page 'Choose a new password' is shown and the address bar changes to /reset-password (the token is removed). |
| 3 | Type Ui-Tests-Passw0rd! in 'New password' and Ui-Tests-Passw0rd! in 'Repeat the new password', then click Change password. | — |
| 4 | Look at the result. | The page switches to 'This link cannot be used' with an explanation (e.g. 'This reset link is not valid…'); 'Password changed' is not shown. |

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-04 a reset page without a token or with a wrong token offers no reset`

### TC-AUTH-039: An expired reset link is refused and the old password keeps working

**Type:** Negative · **Priority:** High · **Role:** Signed out · **Flow:** F2.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A super admin (admin@irongate.com / demo123) has added a test person via Users > Add with password: first name Fixture, last name Person, role Software engineer, team Mavericks, e-mail e.g. qa-fixture-<date>@uitest.example, password Ui-Tests-Passw0rd! (written down as the test person's credentials)
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Access to the e-mails the server sends (a test mailbox, or in local test runs the e-mail log file test-results/ui-local-logs/mail.jsonl / MAIL_CAPTURE_FILE)
- A reset link for the test person that is more than 60 minutes old: request it via Forgot password? (or an admin's Send reset link) and wait over 60 minutes before using it

**Test data**

- Test person's e-mail; current password Ui-Tests-Passw0rd!
- New password tried: Another-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the expired reset link from the e-mail. | The page 'Choose a new password' is shown. |
| 2 | Type Another-Passw0rd! in 'New password' and Another-Passw0rd! in 'Repeat the new password', then click Change password. | — |
| 3 | Look at the result. | 'This link cannot be used' is shown with a text containing 'expired' (e.g. 'This reset link has expired (links work for 60 minutes). Ask for a new one.'). |
| 4 | Open / and sign in as the test person with the OLD password Ui-Tests-Passw0rd!. | Sign-in succeeds and the overview opens (the password was not changed). |

**After the test:** Sign in as admin@irongate.com / demo123, open Users, find the test person and delete (deactivate) it

**Notes:** The automated test creates an already-expired link in the database; manually you have to wait 60+ minutes.

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-05 an expired link is refused and the password stays as it was`

### TC-AUTH-040: Weak and mismatched new passwords are refused before anything is sent

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F2.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools open on the Network tab

**Test data**

- Address: /reset-password?token=igr_some-token
- Weak password: short1
- Mismatch: Ui-Tests-Passw0rd! / Ui-Tests-Passw0rd!!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the address. | The page 'Choose a new password' with the rules list (At least 10 characters; Three of: lower case, upper case, number, symbol; Does not contain your email name) is shown. |
| 2 | Type short1 in 'New password' and short1 in 'Repeat the new password', then click Change password. | — |
| 3 | Look at the message. | 'Choose a stronger password (see the rules below).' is shown. |
| 4 | Type Ui-Tests-Passw0rd! in 'New password' and Ui-Tests-Passw0rd!! in 'Repeat the new password', then click Change password. | — |
| 5 | Look at the message. | 'The two passwords do not match.' is shown. |
| 6 | Look at the Network tab. | No request to /api/auth/reset-password was sent. |

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-06 weak and mismatched new passwords are refused before anything is sent`

### TC-AUTH-041: Completing a password reset signs the person out on their other devices

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F2.2, F1.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A super admin (admin@irongate.com / demo123) has added a test person via Users > Add with password: first name Fixture, last name Person, role Software engineer, team Mavericks, e-mail e.g. qa-fixture-<date>@uitest.example, password Ui-Tests-Passw0rd! (written down as the test person's credentials)
- Access to the e-mails the server sends (a test mailbox, or in local test runs the e-mail log file test-results/ui-local-logs/mail.jsonl / MAIL_CAPTURE_FILE)
- Browser B signed in as the test person (overview open)
- Browser A signed out; a fresh reset link for the test person (requested via Forgot password? in Browser A after Browser B signed in)

**Test data**

- Test person's e-mail
- New password: Ui-Tests-Passw0rd!2

| Step | Action | Expected result |
|---|---|---|
| 1 | In Browser A, open the reset link from the e-mail. | The page 'Choose a new password' is shown. |
| 2 | Type Ui-Tests-Passw0rd!2 in 'New password' and Ui-Tests-Passw0rd!2 in 'Repeat the new password', then click Change password. | — |
| 3 | Look at Browser A. | 'Password changed' with 'Your password was changed. Sign in with your new password.' is shown. |
| 4 | Reload Browser B (F5). | Browser B shows the sign-in screen with the notice 'Your session has ended. Please sign in again.' |
| 5 | Reload Browser B again. | The sign-in screen still shows the same notice (it is kept for the tab, FI-16). |

**After the test:** Sign in as admin@irongate.com / demo123, open Users, find the test person and delete (deactivate) it

**Notes:** The reason a session ended is kept for the browser tab until the next successful sign-in (FI-16, fixed).

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-07 completing a reset signs the person out on their other devices`

### TC-AUTH-042: An administrator sends a reset link from Users; it arrives and works

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F2.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A super admin (admin@irongate.com / demo123) has added a test person via Users > Add with password: first name Fixture, last name Person, role Software engineer, team Mavericks, e-mail e.g. qa-fixture-<date>@uitest.example, password Ui-Tests-Passw0rd! (written down as the test person's credentials)
- Access to the e-mails the server sends (a test mailbox, or in local test runs the e-mail log file test-results/ui-local-logs/mail.jsonl / MAIL_CAPTURE_FILE)
- A second browser / private window for the test person

**Test data**

- Super admin: admin@irongate.com / demo123
- New password: Ui-Tests-Passw0rd!3

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /users after the site address in the address bar and press Enter. | The page at /users opens. |
| 2 | Type the test person's e-mail in 'Search users by name, email, team...'. | The test person's user card is shown. |
| 3 | Click the key button on the card (title Reset Password). | A dialog 'Reset Password: Fixture Person' opens recommending to e-mail a link that 'works once and expires in 60 minutes', with a 'Send reset link' button. |
| 4 | Click Send reset link. | A success message appears (e.g. 'Reset link sent') and the dialog closes. |
| 5 | Open the test person's e-mail and open the reset link in the second browser. | The e-mail contains a link to /reset-password?token=…; the page 'Choose a new password' opens. |
| 6 | Type Ui-Tests-Passw0rd!3 in 'New password' and Ui-Tests-Passw0rd!3 in 'Repeat the new password', then click Change password. | — |
| 7 | Look at the result. | 'Password changed' is shown. |
| 8 | Click 'Go to sign in' and sign in with the test person's e-mail and the new password. | The overview opens. |

**After the test:** Sign in as admin@irongate.com / demo123, open Users, find the test person and delete (deactivate) it

**Notes:** Skipped in automation when e-mail capture (MAIL_CAPTURE_FILE) is off; manually it needs access to the e-mail.

*Automated:* `tests/e2e/auth/password-reset.spec.ts › Password reset: negative cases › PWR-08 an administrator sends a reset link from Users; it arrives and works`

### TC-AUTH-052: Forgot password, follow the e-mailed link, choose a new password, sign in with it; the link works once

**Type:** Positive · **Priority:** High · **Role:** Signed out · **Flow:** F2.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- A Software engineer test person exists in the IronGate demo company, e.g. pwreset-<unique>@irongate.test (created by a super admin via Users > Add with password, team Mavericks)
- Access to the e-mails the server sends (a test mailbox, or in local test runs the e-mail log file test-results/ui-local-logs/mail.jsonl / MAIL_CAPTURE_FILE)
- Fewer than 5 forgot-password requests from this computer's address in the last 15 minutes
- A second browser / private window
- DevTools available (to check the page source)

**Test data**

- E-mail: the test person's e-mail
- Weak password: weak
- New password: Fresh-Passw0rd-42

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) and click 'Forgot password?' (next to the Password label). | The address changes to /forgot-password and the heading 'Forgot your password?' is shown. |
| 2 | Type the test person's e-mail and click Send reset link. | The text "If an account exists for that e-mail, we've sent a link." is shown. |
| 3 | Open the e-mail sent to the test person. | It contains a link to …/reset-password?token=igr_… |
| 4 | Open the link in the second browser. | The heading 'Choose a new password' is shown. |
| 5 | Look at the address bar, and in DevTools > Elements look in <head> for a referrer meta tag. | The address is just /reset-password (the token has been removed); the page has <meta name="referrer" content="no-referrer">. |
| 6 | Type weak in both password fields and click Change password. | A message containing 'stronger password' is shown. |
| 7 | Type Fresh-Passw0rd-42 in both password fields and click Change password. | 'Password changed' is shown with 'Your password was changed. Sign in with your new password.' |
| 8 | Click 'Go to sign in' and sign in with the test person's e-mail and Fresh-Passw0rd-42. | The overview (dashboard) opens. |
| 9 | Open the same e-mailed link again in a new tab, type Fresh-Passw0rd-42x in both fields and click Change password. | 'This link cannot be used' is shown with a text containing 'already been used'. |

**After the test:** Sign in as admin@irongate.com / demo123 and delete (deactivate) the test person in Users

**Notes:** Without e-mail capture the automated test issues the link itself the way the server does.

*Automated:* `tests/e2e/password-reset.spec.ts › Forgot password and reset by e-mail › Forgot password, follow the e-mailed link, choose a new password, sign in with it`

## Navigation, routes and the app frame

### TC-AUTH-055: Super admin sees exactly the navigation entries of the role

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F4.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Click the menu button (Open navigation) at the left of the top bar and wait a moment for the drawer to settle. | The navigation drawer opens. |
| 3 | Read every entry of the drawer from top to bottom (group headings Quality, Delivery, Organisation, Administration, Platform are not entries). | The entries are exactly, in this order: Overview, Analytics, Compare teams, TV mode, Flaky tests, Test execution, Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact, Team rankings, Reports, Users, Teams, Departments, Activity, User activity, Admin console, Manual metrics, Update frequency, Parameters, Ingestion log. |
| 4 | Check that no other entry is present. | No further entries are shown. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-01 admin sees exactly the navigation entries of the role`

### TC-AUTH-056: Super admin: every page of the role opens from its address with its title

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses after the site address and press Enter: / → Overview; /analytics → Analytics; /compare → Compare teams; /analytics/flaky-tests → Flaky tests; /analytics/timeline → Test execution; /analytics/technical-debt → Technical debt; /analytics/performance → Performance; /analytics/pipeline → CI/CD pipeline; /analytics/productivity → Developer productivity; /analytics/pulse → Wellbeing pulse; /analytics/business-impact → Business impact; /analytics/gamification → Team rankings; /analytics/reports → Reports; /notifications → Notifications; /users → Users; /teams → Teams; /departments → Departments; /activity → Activity; /user-activity → User activity; /ingestion-log → Ingestion log; /admin-panel → Admin console; /manual-metrics → Manual metrics; /metric-intervals → Expected update frequency; /parameters-config → Parameters. | Each page opens with the top bar title given after the arrow, and the address bar keeps exactly that address (no redirect to the overview). |
| 3 | Watch the page while doing so. | No page is blank or shows an error. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-02 admin: every page of the role opens from its address with its title`

### TC-AUTH-057: Manager sees exactly the navigation entries of the role

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F4.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Click the menu button (Open navigation) at the left of the top bar and wait a moment for the drawer to settle. | The navigation drawer opens. |
| 3 | Read every entry of the drawer from top to bottom (group headings Quality, Delivery, Organisation, Administration, Platform are not entries). | The entries are exactly, in this order: Overview, Analytics, Compare teams, TV mode, Flaky tests, Test execution, Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact, Team rankings, Reports, Users, Teams, Activity, Admin console, Manual metrics, Update frequency, Parameters, Ingestion log. |
| 4 | Check that no other entry is present. | None of these entries is shown: Departments, User activity, Platform. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-01 manager sees exactly the navigation entries of the role`

### TC-AUTH-058: Manager: every page of the role opens from its address with its title

**Type:** Positive · **Priority:** Medium · **Role:** Manager · **Flow:** F4.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses after the site address and press Enter: / → Overview; /analytics → Analytics; /compare → Compare teams; /analytics/flaky-tests → Flaky tests; /analytics/timeline → Test execution; /analytics/technical-debt → Technical debt; /analytics/performance → Performance; /analytics/pipeline → CI/CD pipeline; /analytics/productivity → Developer productivity; /analytics/pulse → Wellbeing pulse; /analytics/business-impact → Business impact; /analytics/gamification → Team rankings; /analytics/reports → Reports; /notifications → Notifications; /users → Users; /teams → Teams; /activity → Activity; /ingestion-log → Ingestion log; /admin-panel → Admin console; /manual-metrics → Manual metrics; /metric-intervals → Expected update frequency; /parameters-config → Parameters. | Each page opens with the top bar title given after the arrow, and the address bar keeps exactly that address (no redirect to the overview). |
| 3 | Watch the page while doing so. | No page is blank or shows an error. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-02 manager: every page of the role opens from its address with its title`

### TC-AUTH-059: Manager: pages of other roles typed in the address bar lead to the overview with an access message

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F4.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123
- Address: /departments
- Address: /user-activity

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses and press Enter: /departments, /user-activity. | Each time the overview (dashboard) is shown with the title Overview, the address bar changes back to /, and an alert at the top reads "You don't have access to <page name>." (for example "You don't have access to Departments."); it has keyboard focus. |
| 3 | Click the × (Dismiss) on the message. | The message disappears. |
| 4 | Type the first address again, then open Compare teams from the navigation and come back to Overview. | The message is shown again after the redirect and is gone after the page change. |

**Notes:** The access message is the same for every guarded page (FI-14, fixed).

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-03 manager: pages of other roles typed in the address bar lead to the overview with an access message`

### TC-AUTH-060: Team lead sees exactly the navigation entries of the role

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F4.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Click the menu button (Open navigation) at the left of the top bar and wait a moment for the drawer to settle. | The navigation drawer opens. |
| 3 | Read every entry of the drawer from top to bottom (group headings Quality, Delivery, Organisation, Administration, Platform are not entries). | The entries are exactly, in this order: Overview, Analytics, Compare teams, TV mode, Flaky tests, Test execution, Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact, Team rankings, Reports, Users, Teams, Manual metrics. |
| 4 | Check that no other entry is present. | None of these entries is shown: Departments, Activity, User activity, Admin console, Update frequency, Parameters, Ingestion log, Platform. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-01 lead sees exactly the navigation entries of the role`

### TC-AUTH-061: Team lead: every page of the role opens from its address with its title

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F4.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses after the site address and press Enter: / → Overview; /analytics → Analytics; /compare → Compare teams; /analytics/flaky-tests → Flaky tests; /analytics/timeline → Test execution; /analytics/technical-debt → Technical debt; /analytics/performance → Performance; /analytics/pipeline → CI/CD pipeline; /analytics/productivity → Developer productivity; /analytics/pulse → Wellbeing pulse; /analytics/business-impact → Business impact; /analytics/gamification → Team rankings; /analytics/reports → Reports; /notifications → Notifications; /users → Users; /teams → Teams; /manual-metrics → Manual metrics. | Each page opens with the top bar title given after the arrow, and the address bar keeps exactly that address (no redirect to the overview). |
| 3 | Watch the page while doing so. | No page is blank or shows an error. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-02 lead: every page of the role opens from its address with its title`

### TC-AUTH-062: Team lead: pages of other roles typed in the address bar lead to the overview with an access message

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F4.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Address: /departments
- Address: /activity
- Address: /user-activity
- Address: /ingestion-log
- Address: /admin-panel
- Address: /metric-intervals
- Address: /parameters-config

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses and press Enter: /departments, /activity, /user-activity, /ingestion-log, /admin-panel, /metric-intervals, /parameters-config. | Each time the overview (dashboard) is shown with the title Overview, the address bar changes back to /, and an alert at the top reads "You don't have access to <page name>." (for example "You don't have access to Departments."); it has keyboard focus. |
| 3 | Click the × (Dismiss) on the message. | The message disappears. |
| 4 | Type the first address again, then open Compare teams from the navigation and come back to Overview. | The message is shown again after the redirect and is gone after the page change. |

**Notes:** The access message is the same for every guarded page (FI-14, fixed).

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-03 lead: pages of other roles typed in the address bar lead to the overview with an access message`

### TC-AUTH-063: Software engineer sees exactly the navigation entries of the role

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F4.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Click the menu button (Open navigation) at the left of the top bar and wait a moment for the drawer to settle. | The navigation drawer opens. |
| 3 | Read every entry of the drawer from top to bottom (group headings Quality, Delivery, Organisation, Administration, Platform are not entries). | The entries are exactly, in this order: Overview, Analytics, Compare teams, TV mode, Flaky tests, Test execution, Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact, Team rankings, Reports. |
| 4 | Check that no other entry is present. | None of these entries is shown: Users, Teams, Departments, Activity, User activity, Admin console, Manual metrics, Update frequency, Parameters, Ingestion log, Platform. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-01 engineer sees exactly the navigation entries of the role`

### TC-AUTH-064: Software engineer: every page of the role opens from its address with its title

**Type:** Positive · **Priority:** Medium · **Role:** Software engineer · **Flow:** F4.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses after the site address and press Enter: / → Overview; /analytics → Analytics; /compare → Compare teams; /analytics/flaky-tests → Flaky tests; /analytics/timeline → Test execution; /analytics/technical-debt → Technical debt; /analytics/performance → Performance; /analytics/pipeline → CI/CD pipeline; /analytics/productivity → Developer productivity; /analytics/pulse → Wellbeing pulse; /analytics/business-impact → Business impact; /analytics/gamification → Team rankings; /analytics/reports → Reports; /notifications → Notifications. | Each page opens with the top bar title given after the arrow, and the address bar keeps exactly that address (no redirect to the overview). |
| 3 | Watch the page while doing so. | No page is blank or shows an error. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-02 engineer: every page of the role opens from its address with its title`

### TC-AUTH-065: Software engineer: pages of other roles typed in the address bar lead to the overview with an access message

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F4.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Address: /users
- Address: /teams
- Address: /departments
- Address: /activity
- Address: /user-activity
- Address: /ingestion-log
- Address: /admin-panel
- Address: /manual-metrics
- Address: /metric-intervals
- Address: /parameters-config

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses and press Enter: /users, /teams, /departments, /activity, /user-activity, /ingestion-log, /admin-panel, /manual-metrics, /metric-intervals, /parameters-config. | Each time the overview (dashboard) is shown with the title Overview, the address bar changes back to /, and an alert at the top reads "You don't have access to <page name>." (for example "You don't have access to Departments."); it has keyboard focus. |
| 3 | Click the × (Dismiss) on the message. | The message disappears. |
| 4 | Type the first address again, then open Compare teams from the navigation and come back to Overview. | The message is shown again after the redirect and is gone after the page change. |

**Notes:** The access message is the same for every guarded page (FI-14, fixed).

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-03 engineer: pages of other roles typed in the address bar lead to the overview with an access message`

### TC-AUTH-066: Viewer sees exactly the navigation entries of the role

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F4.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Click the menu button (Open navigation) at the left of the top bar and wait a moment for the drawer to settle. | The navigation drawer opens. |
| 3 | Read every entry of the drawer from top to bottom (group headings Quality, Delivery, Organisation, Administration, Platform are not entries). | The entries are exactly, in this order: Overview, Analytics, Compare teams, TV mode, Flaky tests, Test execution, Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact, Team rankings, Reports. |
| 4 | Check that no other entry is present. | None of these entries is shown: Users, Teams, Departments, Activity, User activity, Admin console, Manual metrics, Update frequency, Parameters, Ingestion log, Platform. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-01 viewer sees exactly the navigation entries of the role`

### TC-AUTH-067: Viewer: every page of the role opens from its address with its title

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F4.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses after the site address and press Enter: / → Overview; /analytics → Analytics; /compare → Compare teams; /analytics/flaky-tests → Flaky tests; /analytics/timeline → Test execution; /analytics/technical-debt → Technical debt; /analytics/performance → Performance; /analytics/pipeline → CI/CD pipeline; /analytics/productivity → Developer productivity; /analytics/pulse → Wellbeing pulse; /analytics/business-impact → Business impact; /analytics/gamification → Team rankings; /analytics/reports → Reports; /notifications → Notifications. | Each page opens with the top bar title given after the arrow, and the address bar keeps exactly that address (no redirect to the overview). |
| 3 | Watch the page while doing so. | No page is blank or shows an error. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-02 viewer: every page of the role opens from its address with its title`

### TC-AUTH-068: Viewer: pages of other roles typed in the address bar lead to the overview with an access message

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F4.3

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Address: /users
- Address: /teams
- Address: /departments
- Address: /activity
- Address: /user-activity
- Address: /ingestion-log
- Address: /admin-panel
- Address: /manual-metrics
- Address: /metric-intervals
- Address: /parameters-config

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | One after another, type each of these addresses and press Enter: /users, /teams, /departments, /activity, /user-activity, /ingestion-log, /admin-panel, /manual-metrics, /metric-intervals, /parameters-config. | Each time the overview (dashboard) is shown with the title Overview, the address bar changes back to /, and an alert at the top reads "You don't have access to <page name>." (for example "You don't have access to Departments."); it has keyboard focus. |
| 3 | Click the × (Dismiss) on the message. | The message disappears. |
| 4 | Type the first address again, then open Compare teams from the navigation and come back to Overview. | The message is shown again after the redirect and is gone after the page change. |

**Notes:** The access message is the same for every guarded page (FI-14, fixed).

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-03 viewer: pages of other roles typed in the address bar lead to the overview with an access message`

### TC-AUTH-069: The API refuses what the navigation hides, even when called directly (403 before the body is checked)

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F4.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An API client that sends the browser's session cookie (e.g. Postman with the irongate_token cookie copied from DevTools, or the browser itself for GET requests)

**Test data**

- Viewer: viewer@irongate.com / demo123
- Engineer: engineer@irongate.com / demo123
- Body for every POST / PUT: an empty JSON object {}

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | In a new tab of the same browser open <API>/admin/audit (e.g. http://localhost:3000/api/admin/audit). | Status 403, no audit data. |
| 3 | Open <API>/activity/log. | Status 403. |
| 4 | With the API client and the viewer's cookie, send POST <API>/admin/users, POST <API>/admin/configs and POST <API>/metrics/manual, each with the body {}. | Each answers 403 (not 400): the refusal does not describe a valid body. |
| 5 | Sign out, sign in as engineer@irongate.com / demo123 and open <API>/ingestion-log. | Status 403. |
| 6 | With the engineer's cookie, send PUT <API>/targets, PUT <API>/alerts/rules and POST <API>/admin/users, each with {}. | Each answers 403. |

**Notes:** Requires an API client / DevTools for the PUT and POST calls. Permission checks run before validation (FI-15, fixed); API test tests/api/permission-order.test.ts.

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-04 the API refuses what the navigation hides, even when called directly (403 before the body is checked)`

### TC-AUTH-070: A refusal by the API during an action is shown and the page stays usable

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F4.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Requires a debugging proxy able to make POST /api/admin/users/<id>/toggle-status answer HTTP 403 with body {"error":"You cannot manage this user"}

**Test data**

- Team lead: lead@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /users after the site address in the address bar and press Enter. | The page at /users opens. |
| 2 | Turn on the proxy rule for toggle-status. | — |
| 3 | On the first user card that has a Deactivate / Activate button, click that button. | The error message 'Failed to update status' appears. |
| 4 | Look at the page. | The Users page is still shown and usable; the user's status did not change. |

**After the test:** Turn the proxy rule off

**Notes:** Requires a response-override proxy. Real-life equivalent: a super admin removes the lead's team assignment in another browser while the lead has Users open (then restore it).

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Navigation per role › NAV-05 a refusal by the API during an action is shown, the page stays usable`

### TC-AUTH-071: Unknown addresses open the overview instead of a blank page

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F4.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Addresses: /no-such-page, /analytics/unknown-module, /users/123/edit, /%E2%9C%93?x=%3Cscript%3E

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Open /no-such-page. | The overview (dashboard) is shown with the title Overview. |
| 3 | Open /analytics/unknown-module. | The overview is shown. |
| 4 | Open /users/123/edit. | The overview is shown. |
| 5 | Open /%E2%9C%93?x=%3Cscript%3E (a unicode check mark and markup in the address). | The overview is shown; no script runs, no alert appears. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-10 unknown addresses open the overview instead of a blank page`

### TC-AUTH-072: Unknown addresses while signed out show the sign-in screen

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F1.8, F4.5

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Address: /definitely/not/here

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /definitely/not/here. | The sign-in screen with the heading Sign in is shown (no blank page). |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-11 unknown addresses while signed out show the sign-in screen`

### TC-AUTH-073: Back and Forward move between pages opened from the navigation

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F4.6

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Manager: manager@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Open the navigation and click Compare teams. | Title: Compare teams. |
| 3 | Open the navigation and click Technical debt. | Title: Technical debt. |
| 4 | Open the navigation and click Users. | Title: Users. |
| 5 | Click the browser's Back button. | Title: Technical debt. |
| 6 | Click Back again. | Title: Compare teams. |
| 7 | Click the browser's Forward button. | Title: Technical debt. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-12 Back and Forward move between pages opened from the navigation`

### TC-AUTH-074: Reloading keeps the page and the analytics team (?team=)

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.6, F7.4

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics/technical-debt?team=team-1764026202608-vcbic0w8g (team Mavericks)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/technical-debt?team=team-1764026202608-vcbic0w8g after the site address in the address bar and press Enter. | The page at /analytics/technical-debt?team=team-1764026202608-vcbic0w8g opens. |
| 2 | Look at the Team selector in the scope bar at the top of the page. | Team shows Mavericks. |
| 3 | Reload the page (F5). | The title is still Technical debt and the address still contains team=team-1764026202608-vcbic0w8g. |
| 4 | Look at the Team selector again. | Team still shows Mavericks. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-13 reloading keeps the page and the analytics team (?team=)`

### TC-AUTH-075: A team outside the scope in ?team= is not shown

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F4.6, F7.2

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Engineer: engineer@irongate.com / demo123
- Address: /analytics/technical-debt?team=team-1764026236967-uphpblii4 (team QualityCowboys, not in the engineer's scope)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/technical-debt?team=team-1764026236967-uphpblii4 after the site address in the address bar and press Enter. | The page at /analytics/technical-debt?team=team-1764026236967-uphpblii4 opens. |
| 2 | Look at the top of the page. | The scope bar (Department / Team) is shown. |
| 3 | Search the page for the text QualityCowboys (Ctrl+F). | The name QualityCowboys appears nowhere on the page; no data of that team is shown. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-14 a team outside the scope in ?team= is not shown`

### TC-AUTH-076: The navigation drawer closes with Escape and the backdrop and gives focus back to the menu button

**Type:** Accessibility · **Priority:** Medium · **Role:** Viewer · **Flow:** F4.7

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Browser window narrower than 1280 px or navigation not pinned

**Test data**

- Viewer: viewer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Click the menu button (Open navigation). | The drawer opens over the page with a dark backdrop. |
| 3 | Press Escape. | The drawer closes and the keyboard focus is on the menu button (focus ring visible; pressing Enter would open the drawer again). |
| 4 | Open the drawer again and click on the dark backdrop to the right of the drawer. | The drawer closes. |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-15 the drawer closes with Escape and the backdrop, and gives focus back to the menu button`

### TC-AUTH-077: On a wide screen the navigation can be pinned and stays pinned after a reload

**Type:** Positive · **Priority:** Low · **Role:** Viewer · **Flow:** F4.8

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Browser window at least 1440 x 900 px (the pin button only appears from 1280 px)

**Test data**

- Viewer: viewer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Open the navigation. | Next to the IronGate brand in the drawer there is a pin button (tooltip 'Keep navigation open'). |
| 3 | Click the pin button. | The button is now pressed (tooltip 'Unpin navigation'); the navigation stays docked next to the page. |
| 4 | Reload the page. | The navigation is still shown docked; the menu button in the top bar is now labelled 'Hide navigation'. |
| 5 | Click the menu button (Hide navigation). | The navigation is hidden. |

**After the test:** Make sure the navigation is unpinned again (per-browser preference)

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-16 on a wide screen the navigation can be pinned and stays pinned after a reload`

### TC-AUTH-078: The brand button returns to the overview from any page

**Type:** Positive · **Priority:** Low · **Role:** Team lead · **Flow:** F4.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- Browser window at least 640 px wide (the brand in the top bar is hidden on very narrow screens)

**Test data**

- Team lead: lead@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /compare after the site address in the address bar and press Enter. | The page at /compare opens. |
| 2 | Check the top bar title. | Compare teams. |
| 3 | Click the QE Navigator brand (shield and name) in the top bar (button 'QE Navigator, go to overview'). | The overview opens (title Overview). |

*Automated:* `tests/e2e/navigation/navigation.spec.ts › Routes, history and the navigation drawer › NAV-17 the brand button returns to the overview from any page`

### TC-AUTH-125: Top bar shows the QE Navigator brand, company badge and the person with their role label

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F4.14

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Look at the left of the top bar. | The menu button, the IronGate shield with "QE Navigator" (the shield image has the text alternative "IronGate"), a divider and the page title "Overview". |
| 3 | Look at the right of the top bar. | A rounded company badge with the initials "NT" and the name "NovaTech"; then the name of the person with "Viewer" under it; then a question-mark button, the bell, the theme button and the avatar with the person's initials. |
| 4 | Reload the page and watch the top bar. | Nothing in the top bar jumps or changes size when the shield image loads. |

**Notes:** Repeat as Super admin, Manager, Team lead and Software engineer: the label under the name is the role name (Super admin, Manager, Team lead, Software engineer) when no job title is recorded.

*Automated:* `tests/e2e/navigation/header.spec.ts › Top bar › HDR-01 viewer: brand, company badge, name and role label`

### TC-AUTH-126: "What you can do here" explains the viewer's role, scope and limits; Escape and a click outside close it

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F4.15

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Click the question-mark button "What you can do here" in the top bar. | A panel "What you can do here" opens below the button; keyboard focus moves into it. |
| 3 | Read the panel. | A chip "Viewer · The Away Team"; the sentence "You see The Away Team. Other teams are not shown to you."; under "You can" the overview, team dashboards, TV mode, Compare and Analytics for the teams in scope, pulse results and answering the pulse; under "You cannot" among others "Change settings, KPI targets or alert rules." and "Invite people or change anyone's access." |
| 4 | Press Escape. | The panel closes and the focus is back on the question-mark button. |
| 5 | Open the panel again and click somewhere on the overview outside it. | The panel closes. |

**Notes:** The text is generated from the same access rules the server enforces (docs/ROLE_ACCESS.md).

*Automated:* `tests/e2e/navigation/header.spec.ts › Top bar › HDR-02 viewer: "What you can do here" says her role, scope and limits; Escape and outside click close it`

### TC-AUTH-127: "What you can do here" for a super admin lists company-wide powers and nothing they cannot do

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.15

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Click "What you can do here" (question mark) in the top bar. | The panel reads "You see every team of NovaTech." and lists among others "Set people's job titles."; there is no "You cannot" section. |

*Automated:* `tests/e2e/navigation/header.spec.ts › Top bar › HDR-03 super admin: help lists company-wide powers and nothing she cannot do`

### TC-AUTH-128: A job title set by a super admin replaces the role label in the top bar; others cannot set it

**Type:** Positive · **Priority:** Medium · **Role:** Super admin, Viewer · **Flow:** F4.14

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A test viewer account on The Away Team that you may change (not the shared demo viewer)

**Test data**

- Job title: Product Owner

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Open Users, find the test viewer and click Edit. | The edit form has a field "Job title (optional, shown in the top bar)". |
| 3 | Type "Product Owner" in Job title and save. | "User updated successfully!" is shown. |
| 4 | Sign out and sign in as the test viewer. | The top bar shows the viewer's name with "Product Owner" under it (instead of "Viewer"). |
| 5 | Sign in as Manager (manager@irongate.com) and open the edit form of a user of DevOps. | There is no Job title field (only super admins set job titles; the API answers 403). |
| 6 | Sign in as Super admin again, clear the test viewer's Job title and save. | The test viewer's top bar shows "Viewer" again. |

**After the test:** The test viewer has no job title

*Automated:* `tests/e2e/navigation/header.spec.ts › Top bar › HDR-04 a job title set by a super admin replaces the role label; only super admins may set it`

### TC-AUTH-129: Phone: the top bar shows company initials only; name, title and sign out are in the account menu

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F4.16

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser window 390 px wide (or a phone)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Look at the top bar. | The company badge shows only "NT"; the person's name is not in the bar; nothing scrolls sideways. |
| 3 | Tap the avatar (initials) at the right. | A menu "Account" opens with the name, "Viewer", "NovaTech", "Sign out my other devices" and "Sign out"; the first menu item has the focus. |
| 4 | Tap "Sign out". | The sign-in screen is shown. |

*Automated:* `tests/e2e/navigation/header.spec.ts › Top bar › HDR-05 phone: company initials only; name, title and sign out in the account menu`

### TC-AUTH-130: TV mode is in every role's navigation and opens with a team of the role's scope

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F4.17

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Open the navigation and click "TV mode". | TV mode opens full screen with The Away Team (the viewer's only team); the controls offer no other team (the picker lists the teams in scope only). |
| 3 | Press Escape. | The overview is shown again. |

*Automated:* `tests/e2e/navigation/header.spec.ts › Navigation entries follow the access policy › HDR-06 TV mode is in everyone's navigation and opens with a team`

## Accessibility

### TC-AUTH-079: Sign-in screen has no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Signed out · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The heading Sign in is shown. |
| 2 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-01 sign-in screen`

### TC-AUTH-080: Forgot-password and registration screens have no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Signed out · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /forgot-password. | The heading 'Forgot your password?' is shown. |
| 2 | Run the axe-core scan on the forgot-password page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |
| 3 | Open / and click 'Create an account'. | The heading 'Create your organisation' is shown. |
| 4 | Run the axe-core scan on the registration page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-02 forgot password and registration`

### TC-AUTH-081: Overview page has no new serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type / after the site address in the address bar and press Enter. | The page at / opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Overview. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-03 Overview`

### TC-AUTH-082: Compare teams page has no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /compare

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /compare after the site address in the address bar and press Enter. | The page at /compare opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Compare teams. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violation is reported (colour contrast included). |

**Notes:** KA11Y-01 (colour contrast) is fixed: no known violation is accepted on this page any more.

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-04 Compare teams`

### TC-AUTH-083: Wellbeing pulse page has no new serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics/pulse?team=team-1764200682441-sckxod8xd (team The Away Team)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/pulse?team=team-1764200682441-sckxod8xd after the site address in the address bar and press Enter. | The page at /analytics/pulse?team=team-1764200682441-sckxod8xd opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Wellbeing pulse. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-05 Wellbeing pulse`

### TC-AUTH-084: Technical debt page has no new serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics/technical-debt?team=team-1764200682441-sckxod8xd (team The Away Team)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/technical-debt?team=team-1764200682441-sckxod8xd after the site address in the address bar and press Enter. | The page at /analytics/technical-debt?team=team-1764200682441-sckxod8xd opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Technical debt. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-06 Technical debt`

### TC-AUTH-085: Notifications page has no new serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /notifications

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /notifications after the site address in the address bar and press Enter. | The page at /notifications opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Notifications. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-07 Notifications`

### TC-AUTH-086: Users page has no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /users

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /users after the site address in the address bar and press Enter. | The page at /users opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Users. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violation is reported (colour contrast included). |

**Notes:** KA11Y-02 (colour contrast) is fixed: no known violation is accepted on this page any more.

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-08 Users`

### TC-AUTH-087: Parameters page has no new serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /parameters-config

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /parameters-config after the site address in the address bar and press Enter. | The page at /parameters-config opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Parameters. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-09 Parameters`

### TC-AUTH-088: Activity page has no new serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /activity

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /activity after the site address in the address bar and press Enter. | The page at /activity opens. |
| 2 | Check the top bar title and wait until the page has finished loading (no spinners). | The title reads Activity. |
| 3 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violations are reported. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-10 Activity`

### TC-AUTH-089: Team detail has no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | On the overview, click the team card 'The Away Team'. | The team detail page of The Away Team opens. |
| 3 | Wait until it has finished loading. | KPI sections are shown. |
| 4 | Run the axe-core scan on the whole page and filter the results to impact Serious and Critical. | No serious or critical violation is reported (colour contrast included). |

**Notes:** KA11Y-03 (colour contrast) is fixed: no known violation is accepted on this page any more.

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-11 team detail`

### TC-AUTH-090: Navigation drawer in dark mode has no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1, F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules
- The app is in light mode at the start

**Test data**

- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Click the Appearance button (palette icon) in the top bar and choose Theme 'Dark'; press Escape to close the menu. | The app turns dark. |
| 3 | Open the navigation. | The drawer is shown in dark colours. |
| 4 | Run the axe-core scan on the whole page (overview with the open drawer) and filter the results to impact Serious and Critical. | No serious or critical violation is reported (colour contrast included). |
| 5 | Press Escape, then click Appearance and choose Theme 'Light'. | The drawer closes and the app is back in light mode. |

**Notes:** KA11Y-04 (colour contrast) is fixed: no known violation is accepted on this page any more.

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-12 navigation drawer and dark mode overview`

### TC-AUTH-091: Compare teams, Users and Team detail have no serious or critical accessibility violations in dark mode

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1, F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules
- The app is in light mode at the start

**Test data**

- Super admin: admin@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) and open /compare. | The title reads Compare teams. |
| 2 | Click the Appearance button (palette icon) in the top bar and choose Theme 'Dark'; press Escape to close the menu. | The app turns dark. |
| 3 | Wait until the page has loaded and run the axe-core scan; filter to Serious and Critical. | No serious or critical violation. |
| 4 | Open /users, wait until it has loaded and run the scan again. | No serious or critical violation. |
| 5 | Open the overview, click the team card 'The Away Team', wait until it has loaded and run the scan. | No serious or critical violation. |
| 6 | Click Appearance and choose Theme 'Light'. | The app is back in light mode. |

*Automated:* `tests/e2e/ux/accessibility.spec.ts › Accessibility › A11Y-13 compare teams, users and team detail in the dark theme`

### TC-AUTH-120: Overview and Team detail in the Light theme (Gauge) have no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1, F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123). | The overview opens. |
| 2 | Click Appearance, choose Theme 'Light' and Score display 'Gauge', press Escape. | The app shows the Light theme with gauges. |
| 3 | Wait until the page has loaded and run the axe-core scan; filter to Serious and Critical. | No serious or critical violation (colour contrast included). |
| 4 | Click the team card 'The Away Team', wait until it has loaded and run the scan again. | No serious or critical violation. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance accessibility › A11Y-20 Light theme (Gauge): overview and team detail have no serious violations`

### TC-AUTH-121: Overview and Team detail in the Dark theme (Gauge) have no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1, F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123). | The overview opens. |
| 2 | Click Appearance, choose Theme 'Dark' and Score display 'Gauge', press Escape. | The app shows the Dark theme with gauges. |
| 3 | Wait until the page has loaded and run the axe-core scan; filter to Serious and Critical. | No serious or critical violation (colour contrast included). |
| 4 | Click the team card 'The Away Team', wait until it has loaded and run the scan again. | No serious or critical violation. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance accessibility › A11Y-21 Dark theme (Gauge): overview and team detail have no serious violations`

### TC-AUTH-122: Overview and Team detail in the Graphite theme (Battery) have no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1, F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123). | The overview opens. |
| 2 | Click Appearance, choose Theme 'Graphite' and Score display 'Battery', press Escape. | The app shows the Graphite theme with batterys. |
| 3 | Wait until the page has loaded and run the axe-core scan; filter to Serious and Critical. | No serious or critical violation (colour contrast included). |
| 4 | Click the team card 'The Away Team', wait until it has loaded and run the scan again. | No serious or critical violation. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance accessibility › A11Y-22 Graphite theme (Battery): overview and team detail have no serious violations`

### TC-AUTH-123: Overview and Team detail in the Porcelain theme (Gauge) have no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Medium · **Role:** Super admin · **Flow:** F15.1, F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core (e.g. axe DevTools) configured for WCAG 2.1 A and AA rules

**Test data**

- Super admin: admin@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123). | The overview opens. |
| 2 | Click Appearance, choose Theme 'Porcelain' and Score display 'Gauge', press Escape. | The app shows the Porcelain theme with gauges. |
| 3 | Wait until the page has loaded and run the axe-core scan; filter to Serious and Critical. | No serious or critical violation (colour contrast included). |
| 4 | Click the team card 'The Away Team', wait until it has loaded and run the scan again. | No serious or critical violation. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance accessibility › A11Y-23 Porcelain theme (Gauge): overview and team detail have no serious violations`

### TC-AUTH-124: Sign-in screen in Graphite and Porcelain has no serious or critical accessibility violations

**Type:** Accessibility · **Priority:** Low · **Role:** Signed out · **Flow:** F15.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- An accessibility checker browser extension using axe-core configured for WCAG 2.1 A and AA rules

| Step | Action | Expected result |
|---|---|---|
| 1 | In DevTools > Application > Local storage set irongate_theme_mode to graphite and open the sign-in screen. | The sign-in screen is Graphite. |
| 2 | Run the axe-core scan; filter to Serious and Critical. | No serious or critical violation. |
| 3 | Set irongate_theme_mode to porcelain, reload and scan again. | The sign-in screen is Porcelain; no serious or critical violation. |

**After the test:** Remove the irongate_theme_mode entry.

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance accessibility › A11Y-24 sign-in screen in Graphite and Porcelain`

## Theme and phone layout

### TC-AUTH-092: Switching between Light and Dark in the Appearance menu survives a reload and signing out

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Viewer: viewer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Note whether the app is light or dark, then click the Appearance button (palette icon) in the top bar and choose the other of Light / Dark. | The app switches to the other theme (light → dark or dark → light). |
| 3 | Reload the page. | The overview is shown, still in the new theme. |
| 4 | Open the navigation and click Sign out. | The sign-in screen is shown, still in the new theme. |

**After the test:** Switch the theme back to how it was (or clear the site data / the irongate_theme_mode entry in DevTools > Application > Local storage)

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Theme › UX-01 the theme switch toggles dark mode and the choice survives a reload and signing out`

### TC-AUTH-093: The system dark preference does not override the light default

**Type:** Positive · **Priority:** Low · **Role:** Signed out · **Flow:** F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A fresh private window (no saved theme choice for the site)
- The operating system set to dark mode, or DevTools > Rendering > Emulate CSS media feature prefers-color-scheme: dark

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/) in the private window. | The heading Sign in is shown. |
| 2 | Look at the colours. | The sign-in screen is in light mode (white form background) although the system prefers dark. |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Theme › UX-02 the system dark preference does not override the light default`

### TC-AUTH-094: Sign-in, forgot-password and registration screens fit a phone

**Type:** Positive · **Priority:** Medium · **Role:** Signed out · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in screen (/). | The heading Sign in is shown. |
| 2 | Try to scroll sideways. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |
| 3 | Open /forgot-password and try to scroll sideways. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |
| 4 | Open /, click 'Create an account' and try to scroll sideways. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-10 sign-in, forgot-password and registration screens fit the phone`

### TC-AUTH-095: Overview has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type / after the site address in the address bar and press Enter. | The page at / opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Overview. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Overview has no sideways scrolling on a phone`

### TC-AUTH-096: Compare teams has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /compare

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /compare after the site address in the address bar and press Enter. | The page at /compare opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Compare teams. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Compare teams has no sideways scrolling on a phone`

### TC-AUTH-097: Analytics has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics after the site address in the address bar and press Enter. | The page at /analytics opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Analytics. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Analytics has no sideways scrolling on a phone`

### TC-AUTH-098: Technical debt has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics/technical-debt?team=team-1764200682441-sckxod8xd (team The Away Team)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/technical-debt?team=team-1764200682441-sckxod8xd after the site address in the address bar and press Enter. | The page at /analytics/technical-debt?team=team-1764200682441-sckxod8xd opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Technical debt. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Technical debt has no sideways scrolling on a phone`

### TC-AUTH-099: Wellbeing pulse has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics/pulse?team=team-1764200682441-sckxod8xd (team The Away Team)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/pulse?team=team-1764200682441-sckxod8xd after the site address in the address bar and press Enter. | The page at /analytics/pulse?team=team-1764200682441-sckxod8xd opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Wellbeing pulse. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Wellbeing pulse has no sideways scrolling on a phone`

### TC-AUTH-100: Business impact has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics/business-impact?team=team-1764200682441-sckxod8xd (team The Away Team)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/business-impact?team=team-1764200682441-sckxod8xd after the site address in the address bar and press Enter. | The page at /analytics/business-impact?team=team-1764200682441-sckxod8xd opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Business impact. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Business impact has no sideways scrolling on a phone`

### TC-AUTH-101: Developer productivity has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /analytics/productivity?team=team-1764200682441-sckxod8xd (team The Away Team)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /analytics/productivity?team=team-1764200682441-sckxod8xd after the site address in the address bar and press Enter. | The page at /analytics/productivity?team=team-1764200682441-sckxod8xd opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Developer productivity. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Developer productivity has no sideways scrolling on a phone`

### TC-AUTH-102: Notifications has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /notifications

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /notifications after the site address in the address bar and press Enter. | The page at /notifications opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Notifications. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Notifications has no sideways scrolling on a phone`

### TC-AUTH-103: Users has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /users

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /users after the site address in the address bar and press Enter. | The page at /users opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Users. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

**Notes:** Regression for FI-19 (Users toolbar was wider than the screen).

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Users has no sideways scrolling on a phone`

### TC-AUTH-104: Teams has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /teams

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /teams after the site address in the address bar and press Enter. | The page at /teams opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Teams. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Teams has no sideways scrolling on a phone`

### TC-AUTH-105: Departments has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /departments

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /departments after the site address in the address bar and press Enter. | The page at /departments opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Departments. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Departments has no sideways scrolling on a phone`

### TC-AUTH-106: Activity has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /activity

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /activity after the site address in the address bar and press Enter. | The page at /activity opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Activity. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Activity has no sideways scrolling on a phone`

### TC-AUTH-107: User activity has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /user-activity

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /user-activity after the site address in the address bar and press Enter. | The page at /user-activity opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads User activity. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 User activity has no sideways scrolling on a phone`

### TC-AUTH-108: Parameters has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /parameters-config

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /parameters-config after the site address in the address bar and press Enter. | The page at /parameters-config opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Parameters. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Parameters has no sideways scrolling on a phone`

### TC-AUTH-109: Manual metrics has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /manual-metrics

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /manual-metrics after the site address in the address bar and press Enter. | The page at /manual-metrics opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Manual metrics. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Manual metrics has no sideways scrolling on a phone`

### TC-AUTH-110: Admin console has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /admin-panel

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /admin-panel after the site address in the address bar and press Enter. | The page at /admin-panel opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Admin console. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Admin console has no sideways scrolling on a phone`

### TC-AUTH-111: Ingestion log has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /ingestion-log

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /ingestion-log after the site address in the address bar and press Enter. | The page at /ingestion-log opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Ingestion log. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Ingestion log has no sideways scrolling on a phone`

### TC-AUTH-112: Expected update frequency has no sideways scrolling on a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Super admin: admin@irongate.com / demo123
- Address: /metric-intervals

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. Then type /metric-intervals after the site address in the address bar and press Enter. | The page at /metric-intervals opens. |
| 2 | Check the top bar title and wait until the page has loaded. | The title reads Expected update frequency. |
| 3 | Scroll down through the whole page and try to scroll sideways at several heights. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-11 Expected update frequency has no sideways scrolling on a phone`

### TC-AUTH-113: Team detail, its members and the navigation drawer fit a phone

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F4.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching

**Test data**

- Viewer: viewer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Tap the first team card on the overview. | The team detail page opens. |
| 3 | Scroll through the whole page (including the members) and try to scroll sideways. | The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |
| 4 | Tap the menu button (Open navigation). | The drawer opens and is not wider than the screen (390 px); a strip of the page stays visible beside it. |

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-12 team detail, its members and the navigation drawer fit the phone`

### TC-AUTH-114: Very long names and unicode do not break the phone layout

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F4.11, F16.11

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)
- DevTools device toolbar set to a phone of 390 x 844 px with touch (e.g. iPhone 12 Pro), page reloaded after switching
- A team with a very long unicode name (see Test data): either a super admin renames a test team to it (Teams > edit), or a response-override proxy replaces the first team's name in GET /api/teams

**Test data**

- Super admin: admin@irongate.com / demo123
- Team name: Ünïcødé-名前-🚀- repeated 12 times followed by VeryLongTeamNameWithoutAnySpacesThatCouldOverflowTheCard

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens (top bar title Overview). |
| 2 | Reload the overview. | The team cards are shown, including the team with the long name. |
| 3 | Look at the card with the long name and try to scroll sideways. | The long name wraps or is shortened inside its card. The page has no sideways scrolling: swiping / scrolling left-right does not move the page, no horizontal scrollbar, and no content is cut off or sticks out at the right edge (wide tables may scroll inside their own box). |

**After the test:** Rename the team back (or turn the proxy rule off)

**Notes:** The automated test rewrites the team name in the API response; manually rename a test team (not a demo team used by other tests) or use a proxy.

*Automated:* `tests/e2e/ux/theme-and-phone.spec.ts › Phone layout (390 px) › UX-13 very long names and unicode do not break the phone layout`

### TC-AUTH-115: Appearance menu with the keyboard: choose Graphite and Gauge; the choice survives a reload and signing out

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Viewer: viewer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens in the Light theme; the QA scores are drawn as 3D batteries. |
| 2 | Press Tab until the Appearance button (palette icon) in the top bar has the focus ring, then press Enter. | A menu opens with two groups: Theme (Light, Dark, Graphite, Porcelain, Match system) and Score display (Battery, Gauge). The focus is on 'Light', which has a check mark. |
| 3 | Press the Down arrow twice, then Enter. | 'Graphite' has the focus and is chosen: the app turns deep graphite with translucent dark-glass cards, light hairline borders and a soft diagonal light sheen; text is white / silver. |
| 4 | Press End, then Space. | The focus moves to 'Gauge' and it is chosen: every QA score (company hero, executive metrics, team cards) is now a radial gauge with the number in the centre, a coloured arc with a marker at its end (the score). |
| 5 | Press Escape. | The menu closes and the focus returns to the Appearance button. |
| 6 | Reload the page. | The overview opens directly in Graphite with gauges, without a flash of the light theme. |
| 7 | Open the navigation and click Sign out. | The sign-in screen is shown in Graphite (dark glass, graphite brand panel on wide screens). |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

**Notes:** The preference is kept in this browser (localStorage), not on the account.

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance › APR-01 keyboard: open the menu, choose Graphite and Gauge; the choice survives a reload and signing out`

### TC-AUTH-116: Every theme of the Appearance menu: Light, Dark, Graphite, Porcelain

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Viewer: viewer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens. |
| 2 | Click Appearance and choose 'Dark'. | The app turns dark (plain dark slate surfaces). |
| 3 | Choose 'Porcelain'. | The app turns warm pearl with frosted translucent white cards, soft shadows and hairline borders; text is charcoal. |
| 4 | Choose 'Graphite'. | The app turns dark graphite glass. |
| 5 | Choose 'Light'. | The app is back in the original light theme. |
| 6 | Open the menu again and click somewhere on the page outside it. | The menu closes. |
| 7 | In each theme look at the status pills (Good / Warning / Critical), the battery liquid and the chart colours on a team page. | Status colours and the battery liquid colours are the same in every theme; only surfaces, text and the battery shell change. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance › APR-02 every theme from the menu; Porcelain is light, the menu closes on a click outside`

### TC-AUTH-117: "Match system" follows the device's light / dark setting; with no choice the app is Light

**Type:** Positive · **Priority:** Medium · **Role:** Signed out · **Flow:** F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

| Step | Action | Expected result |
|---|---|---|
| 1 | Set the operating system (or DevTools > Rendering > Emulate CSS prefers-color-scheme) to dark. Open the sign-in screen in a fresh private window. | The sign-in screen is Light: the device setting is not followed until 'Match system' is chosen. |
| 2 | Sign in as any user, click Appearance and choose 'Match system'. | The app turns Dark. |
| 3 | Switch the device setting to light. | The app turns Light without a reload. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance › APR-03 "Match system" follows the device setting; with no choice the app stays Light`

### TC-AUTH-118: Score display Gauge on team cards and Team detail, and back to Battery

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F4.10

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Viewer: viewer@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens with 3D batteries. |
| 2 | Click Appearance and choose Score display 'Gauge'. | The team cards show a small gauge next to 'QA score'. A screen reader reads it as '<team> QA score: <n> of 100', as for the battery. |
| 3 | Click the team card 'The Away Team'. | Team detail opens; the QA score card shows a gauge whose marker sits at the end of the coloured arc, at the team's QA score. |
| 4 | Choose Score display 'Battery'. | The QA score card shows the horizontal 3D battery again. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

**Notes:** With 'Reduce motion' on in the OS the gauge appears without the sweep animation.

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance › APR-04 the score display applies to team cards and Team detail too (Battery back again)`

### TC-AUTH-119: TV mode in a glass theme: its Light / Dark switch shows Porcelain / Graphite and exit gives the app theme back

**Type:** Positive · **Priority:** Low · **Role:** Viewer · **Flow:** F4.10, F7.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser signed out (no IronGate session: use a fresh private window or sign out first)

**Test data**

- Viewer: viewer@irongate.com / demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) on the sign-in screen: type the e-mail in Email address, the password in Password and click Sign in. | The overview opens. |
| 2 | Choose Theme 'Graphite' in the Appearance menu, open the team 'The Away Team' and click 'Open TV mode'. | TV mode opens in Graphite (dark glass). |
| 3 | Move the mouse to show the controls and click 'Light'. | TV mode turns Porcelain (light frosted glass). |
| 4 | Click 'Exit'. | TV mode closes and the app is Graphite again. |

**After the test:** Choose Theme 'Light' and Score display 'Battery' in the Appearance menu (or clear the irongate_theme_mode and irongate_score_display entries in DevTools > Application > Local storage).

**Notes:** With the Light or Dark app theme the TV switch keeps showing plain Light / Dark.

*Automated:* `tests/e2e/ux/appearance.spec.ts › Appearance › APR-05 TV mode keeps its light/dark switch inside the glass family and gives the app theme back on exit`

## Overview (dashboard)

### TC-DASH-001: Super admin sees the company status, every team of the company and the Executive briefing button

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F5.1, F5.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look at the header area of the Overview. | A heading starting with "Good morning", "Good afternoon" or "Good evening" is shown, with the company QA score and status tiles below it. |
| 3 | Scroll to the team grid. | At least one team card is shown; the cards cover the teams of the whole company (e.g. The Away Team, Mavericks, QualityCowboys). |
| 4 | Look at the KPI tiles row. | A tile "Teams vs KPI targets" is shown. |
| 5 | Look for a button "Executive briefing" next to the greeting. | The "Executive briefing" button is visible. |

**Notes:** Smoke test.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-01 admin sees the company status and every team of the company`

### TC-DASH-002: Manager sees the company status, every team of the company and the Executive briefing button

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F5.1, F5.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Manager: E-mail address manager@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look at the header area of the Overview. | A heading starting with "Good morning", "Good afternoon" or "Good evening" is shown, with the company QA score and status tiles below it. |
| 3 | Scroll to the team grid. | At least one team card is shown; the cards cover the teams of the whole company (e.g. The Away Team, Mavericks, QualityCowboys). |
| 4 | Look at the KPI tiles row. | A tile "Teams vs KPI targets" is shown. |
| 5 | Look for a button "Executive briefing" next to the greeting. | The "Executive briefing" button is visible. |

**Notes:** Smoke test.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-01 manager sees the company status and every team of the company`

### TC-DASH-003: Team lead sees the company status, every team of the company and the Executive briefing button

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F5.1, F5.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look at the header area of the Overview. | A heading starting with "Good morning", "Good afternoon" or "Good evening" is shown, with the company QA score and status tiles below it. |
| 3 | Scroll to the team grid. | At least one team card is shown; the cards cover the teams of the whole company (e.g. The Away Team, Mavericks, QualityCowboys). |
| 4 | Look at the KPI tiles row. | A tile "Teams vs KPI targets" is shown. |
| 5 | Look for a button "Executive briefing" next to the greeting. | The "Executive briefing" button is visible. |

**Notes:** Smoke test.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-01 lead sees the company status and every team of the company`

### TC-DASH-004: Software engineer sees the company status, every team of the company and no Executive briefing button

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F5.1, F5.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Software engineer: E-mail address engineer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look at the header area of the Overview. | A heading starting with "Good morning", "Good afternoon" or "Good evening" is shown, with the company QA score and status tiles below it. |
| 3 | Scroll to the team grid. | At least one team card is shown; the cards cover the teams of the whole company (e.g. The Away Team, Mavericks, QualityCowboys). |
| 4 | Look at the KPI tiles row. | A tile "Teams vs KPI targets" is shown. |
| 5 | Look for a button "Executive briefing" next to the greeting. | There is no "Executive briefing" button anywhere on the page. |

**Notes:** Smoke test. The briefing is restricted to super admins, managers and team leads.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-01 engineer sees the company status and every team of the company`

### TC-DASH-005: Viewer sees the company status, every team of the company and no Executive briefing button

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F5.1, F5.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look at the header area of the Overview. | A heading starting with "Good morning", "Good afternoon" or "Good evening" is shown, with the company QA score and status tiles below it. |
| 3 | Scroll to the team grid. | At least one team card is shown; the cards cover the teams of the whole company (e.g. The Away Team, Mavericks, QualityCowboys). |
| 4 | Look at the KPI tiles row. | A tile "Teams vs KPI targets" is shown. |
| 5 | Look for a button "Executive briefing" next to the greeting. | There is no "Executive briefing" button anywhere on the page. |

**Notes:** Smoke test. The briefing is restricted to super admins, managers and team leads.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-01 viewer sees the company status and every team of the company`

### TC-DASH-006: The status filters All / High performing / Needs attention show exactly the counted teams

**Type:** Positive · **Priority:** Medium · **Role:** Manager · **Flow:** F5.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Manager: E-mail address manager@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Wait until the team cards are shown. Note the number on the filter button "High performing <n>". | The filter buttons read "All <n>", "High performing <n>" and "Needs attention <n>". |
| 3 | Click "High performing <n>". | Exactly <n> team cards are shown; if <n> is 0 the message "No teams match" ("Adjust the filters or search term.") is shown instead. |
| 4 | Note the number on "Needs attention <n>" and click it. | Exactly <n> team cards are shown, or "No teams match" if <n> is 0. |
| 5 | Note the number on "All <n>" and click it. | Exactly <n> team cards are shown (all teams). |

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-02 the status filters show the counted teams`

### TC-DASH-007: Team search narrows the list, a search without match says so, and typed markup is treated as plain text

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F5.4, F16.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Search 1: The Away Team
- Search 2: <img src=x onerror=alert(1)>

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into the "Search teams" field. | Exactly one team card is shown and its name is "The Away Team". |
| 3 | Replace the search text with <img src=x onerror=alert(1)>. | The message "No teams match" is shown. No browser alert / pop-up appears and no broken image is shown. |
| 4 | Clear the search field. | The team cards are shown again. |
| 5 | Check that no alert dialog appeared at any point during the test. | No dialog was shown. |

**Notes:** Security check: markup typed into the search must never be executed.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-03 search narrows the list; no match says so; markup typed in is only text`

### TC-DASH-008: Department filter shows only that department's teams; sorting by team name works in both directions

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F5.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Department: Payments Processing

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | In the "Department" dropdown of the team toolbar choose "Payments Processing". | Only team cards of the Payments Processing department are shown (e.g. QualityCowboys); every card shows "Payments Processing". |
| 3 | Set the "Department" dropdown back to "All departments". | Teams of all departments are shown again. |
| 4 | In the "Sort teams by" dropdown choose "Sort: Team name". | The team cards are in alphabetical order A to Z; the direction button next to the dropdown shows an up arrow (tooltip "Ascending"). |
| 5 | Click the direction button next to the sort dropdown. | The arrow points down (tooltip "Descending") and the team cards are in exactly the reverse order (Z to A). |

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-04 department filter and sorting by name both ways`

### TC-DASH-009: Grid / list layout and the number of cards per row are remembered after a reload

**Type:** Positive · **Priority:** Low · **Role:** Team lead · **Flow:** F5.5

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- Browser window at least 1440 x 900 pixels (desktop width; the cards-per-row buttons are hidden on narrow screens)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | In the team toolbar, in the "Cards per row" group, click "3". | The "3" button is highlighted and the team cards are laid out three per row. |
| 3 | Reload the page (F5). | The Overview opens again with "3" still selected and three cards per row. |
| 4 | Click the "List" layout button. | The teams are shown as a list of full-width rows; the "Cards per row" buttons disappear. |
| 5 | Reload the page. | The "List" button is still selected and the list layout is kept. |
| 6 | Click "Grid" and then "1" in "Cards per row". | The grid layout with one card per row is shown (original state restored). |

**After the test:** Leave the layout on Grid with 1 card per row (done in the last step).

**Notes:** Preference is kept per browser.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-05 grid or list and cards per row are remembered after a reload`

### TC-DASH-010: "Teams vs KPI targets" opens the breakdown; its tabs switch; Escape closes it; a team opens from it

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F5.6

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | In the KPI tiles row click the link "Teams vs KPI targets >". | A dialog titled "Teams vs KPI targets" opens with the tabs "On track <n>", "At risk <n>" and "Off track <n>". |
| 3 | Click the tab "On track". | "On track" is shown as selected and its teams are listed (or "No team is on track."). |
| 4 | Click the tab "At risk". | "At risk" is selected and its list is shown (or "No team is at risk."). |
| 5 | Click the tab "Off track". | "Off track" is selected and its list is shown (or "No team is off track."). |
| 6 | Press Escape. | The dialog closes and the Overview is shown. |
| 7 | In the "Teams vs KPI targets" tile click the count "<n> off track". | The dialog opens again on the "Off track" tab. |
| 8 | If at least one team is listed, note its name and click it. | The team detail page of that team opens, with the team name as page heading. (If no team is off track, the step is not applicable.) |

**Notes:** Smoke test.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-06 "Teams vs KPI targets" opens the breakdown; tabs switch; a team opens from it; Escape closes`

### TC-DASH-011: A team card opens the team detail; the "Overview" breadcrumb returns to the overview

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F5.7

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Software engineer: E-mail address engineer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Click the team card "Mavericks". | The team detail page of Mavericks opens; the breadcrumb reads "Overview / Mavericks". |
| 3 | Click "Overview" in the breadcrumb. | The Overview page with the team grid is shown again. |

**Notes:** Smoke test.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-07 a team card opens the team; "Back" returns to the overview`

### TC-DASH-012: A company with sample data shows the "Includes sample data" banner; a new company without sample data does not

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F5.11

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- The sample company "Northwind Payments (Sample data)" is seeded (super admin alex.morgan@northwind.example / demo123)
- A brand-new organisation has been registered via "Create an account" on the sign-in page with its own e-mail domain, e.g. owner@uit-<date>.uitest.example, first name Uitest, last name Owner, company "UI Test <date>", department Engineering, team Core Team, password Ui-Tests-Passw0rd!

**Test data**

- Sample company: alex.morgan@northwind.example / demo123
- New organisation: owner@uit-<date>.uitest.example / Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app and sign in as alex.morgan@northwind.example / demo123. | The Overview of Northwind Payments opens. |
| 2 | Look at the top of the Overview. | A banner reads "Includes sample data. Some values on this screen were generated for demonstration, not measured." with a close (X) button. |
| 3 | Open the navigation menu (menu button at the top left) and click Sign out. | The sign-in page with the heading "Sign in" is shown. |
| 4 | Sign in with the new organisation's owner account. | The Overview of the new organisation opens. |
| 5 | Look at the team grid and the top of the page. | The team card "Core Team" is shown; there is no "Includes sample data" banner. |

**After the test:** Ask a developer / database administrator to remove the test organisation (there is no delete function in the UI).

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-11 a company with sample data shows the "Includes sample data" banner; a new one without data does not`

### TC-DASH-013: A missing company summary does not hide the team list

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F5.1, F16.5

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking is set up (see notes)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern: *localhost:3000/api/analytics/company-summary*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open DevTools and enable network request blocking for the pattern *localhost:3000/api/analytics/company-summary*. | The pattern is listed and ticked. |
| 2 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 3 | Look at the company status area at the top. | A panel "Company summary unavailable" with the text "The organisation-wide metrics could not be loaded. Team data below is unaffected." is shown. |
| 4 | Scroll to the team grid. | The team cards are still shown normally. |

**After the test:** Remove the blocking pattern and disable request blocking.

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers the request with HTTP 500; blocking it gives the same visible result.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-08 a missing company summary does not hide the teams`

### TC-DASH-014: A failed team list request shows a load error with the reference instead of "No teams match"

**Type:** Negative · **Priority:** Medium · **Role:** Viewer · **Flow:** F5.1

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- A proxy/mock tool answers GET http://localhost:3000/api/teams (exactly this path, not /api/teams/...) with HTTP 500 and body {"error": "Internal server error", "requestId": "rid-teams-500"}

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Mocked response: 500, requestId rid-teams-500

| Step | Action | Expected result |
|---|---|---|
| 1 | Switch on the mock rule for GET /api/teams. | The rule is active. |
| 2 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 3 | Look at the team grid area. | A red error box reads exactly "Could not load the teams: the server had a problem. Try again in a moment. Reference: rid-teams-500." |
| 4 | Check the rest of the team area. | The message "No teams match" is NOT shown. |

**After the test:** Switch off the mock rule.

**Notes:** Requires a proxy/mock tool (e.g. Requestly, Charles, Fiddler or mitmproxy) that can answer the named API request with a chosen HTTP status and JSON body; DevTools request blocking only simulates a network failure. Fixed issue FI-07.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-09 a failed team list says so instead of "No teams match"`

### TC-DASH-015: The overview survives an unreachable team list with an offline message

**Type:** Negative · **Priority:** Medium · **Role:** Viewer · **Flow:** F5.1, F16.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking is set up (see notes)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Block pattern: localhost:3000/api/teams (only the exact team list address)

| Step | Action | Expected result |
|---|---|---|
| 1 | Enable request blocking for the team list request http://localhost:3000/api/teams (exact address; do not block /api/teams/... sub-addresses). | The pattern is listed and ticked. |
| 2 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 3 | Look at the team grid area. | A red error box reads "Could not load the teams: the server could not be reached. Check your connection and try again." and the page is otherwise usable. |

**After the test:** Remove the blocking pattern.

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. Fixed issue FI-07.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Overview › DASH-10 the overview survives an offline network with a message`

### TC-DASH-083: Data older than a day: overview, team detail and TV mode show the latest snapshot with "Last updated"

**Type:** Positive · **Priority:** High · **Role:** Super admin (of a new organisation) · **Flow:** F5.12

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) on a LOCAL test database you may change (psql access)
- A new organisation registered through "Create an account" (its owner is its super admin), team "Core Team"
- Two KPI snapshots of Core Team dated three and two days ago, added with psql (see test data); no newer snapshot

**Test data**

- SQL (replace <team id> with Core Team's id: SELECT id FROM teams WHERE name = 'Core Team' ORDER BY created_at DESC LIMIT 1):
- INSERT INTO kpi_snapshots (team_id, snapshot_date, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score, automation_coverage, test_flakiness_rate) VALUES ('<team id>', CURRENT_DATE - 3, 80, 4, 6, 80, 72, 1.5), ('<team id>', CURRENT_DATE - 2, 82, 4, 6, 80, 72, 1.5);
- <date> below = the date two days ago, written like 17 Nov 2026

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's owner and look at the "Company status" card on the overview. | The card header reads "Data as of" with that date (written like Nov 17, 2026) and "Last updated <date>" (amber). The Global QA score shows a number; "No KPI snapshots recorded" and "No KPI data available" do not appear. |
| 2 | Look at the Core Team card in "Team performance". | It shows a QA score and a status (not "No data") and "As of" that date; test coverage 82% is judged (not "stale"). |
| 3 | Click the Core Team card. | Team detail opens; under the name: "… · KPI snapshot as of <date> · Last updated <date>". The QA score card shows "Based on 4 of 4 inputs". |
| 4 | Open /tv?team=<team id> (or click "Open TV mode"). | TV mode shows the QA score (not "No QA score recorded"); under "Data as of <date>" it reads "Last updated <date>". |
| 5 | With psql add a current snapshot: INSERT INTO kpi_snapshots (team_id, snapshot_date, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score) VALUES ('<team id>', CURRENT_DATE, 83, 4, 6, 80); then reload the overview. | "Last updated" is gone everywhere; data as of today. |

**After the test:** Delete the test organisation (or leave it: it is separate from the demo data).

**Notes:** FI-22: before the fix every daily input of such a snapshot was stale at now, so the screens showed "No data" although the snapshots were there (the live site on 19 Nov 2026, before the first nightly sample-data refresh).

*Automated:* `tests/e2e/dashboard/latest-data.spec.ts › Latest data older than a day › LATEST-01 overview, team detail and TV mode show the latest snapshot with "Last updated"`

### TC-DASH-088: Overview cards, hero and gauges show the targets; every battery uses the one colour scale

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F5.13

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Read the Global QA score. | Next to the risk badge: "Target ≥ 85" (for Watch "Watch: 70–85 · Target ≥ 85"). |
| 3 | Read the executive gauges. | Each gauge with a value has "Target ≥ 80" (wellbeing: its own target) under its caption. |
| 4 | Read a team card. | Under QA score: "Target ≥ 85"; under each KPI (Coverage, Automation, …) "Target ≥ 80%" or "Target ≤ 2%", in amber or red when not met. |
| 5 | Compare the battery colours with their values. | <30 red, 30–45 deep amber, 45–60 amber, 60–75 yellow, 75–90 light green, 90–100 green, in light and dark mode. |

*Automated:* `tests/e2e/team/team-detail-header.spec.ts › Team detail header › TDH-05 overview cards and the hero show the targets`

## Executive briefing

### TC-DASH-016: The Executive briefing shows the generated summary formatted, labelled as AI, with markup shown as text

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F5.9, F16.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- A proxy/mock tool answers POST http://localhost:3000/api/analytics/company-insights with HTTP 200 and JSON {"analysis": "## Executive summary\n**Biggest risk:** flaky tests in Payments.\n1. Fix the flaky suite\n- Keep coverage above 80 %\n<script>window.__xss = 1</script>"}

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Switch on the mock rule for the company-insights request. | The rule is active. |
| 2 | Open http://localhost:5173/ and sign in as Manager: E-mail address manager@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 3 | Click "Executive briefing". | A side panel titled "Executive briefing" opens. |
| 4 | Read the panel content. | A heading "Executive summary" is shown, then "Biggest risk:" in bold followed by "flaky tests in Payments.", a numbered item "Fix the flaky suite" and a bullet "Keep coverage above 80 %". |
| 5 | Look at the end of the content. | The text <script>window.__xss = 1</script> is displayed literally as text; nothing is executed. |
| 6 | Look at the panel footer. | The note "AI-generated summary. Verify figures against the underlying metrics before sharing externally." is shown. |
| 7 | Optional: in the DevTools Console, check the value of the variable __xss on the window. | It is undefined (the script did not run). |
| 8 | Press Escape. | The briefing panel closes. |

**After the test:** Switch off the mock rule.

**Notes:** Requires a proxy/mock tool (e.g. Requestly, Charles, Fiddler or mitmproxy) that can answer the named API request with a chosen HTTP status and JSON body; DevTools request blocking only simulates a network failure. The real AI service (Groq) is not called in the automated test; with a real AI service the content differs but the heading structure and AI label must be present.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Executive briefing › BRIEF-01 the briefing shows the generated summary, labelled as AI (stubbed AI service)`

### TC-DASH-017: Without the AI service (or on an error) the Executive briefing says it cannot be generated

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F5.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- The AI service is not configured on the server, or the request POST /api/analytics/company-insights is made to fail (mock 503 {"error": "AI is not configured"} or DevTools request blocking of *api/analytics/company-insights*)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Click "Executive briefing". | The side panel "Executive briefing" opens. |
| 3 | Wait for the content. | The text "The briefing could not be generated right now. Please try again later." is shown. |
| 4 | Click the Close (X) button of the panel. | The panel closes. |

**After the test:** Remove any mock rule / request blocking.

**Notes:** Requires DevTools request blocking or a proxy/mock tool, unless the AI service is genuinely not configured.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Executive briefing › BRIEF-02 without the AI service (or on an error) the briefing says it cannot be generated`

### TC-DASH-018: A software engineer cannot request the Executive briefing, not even through the API

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F5.9, F4.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Software engineer: E-mail address engineer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look for the "Executive briefing" button. | There is no "Executive briefing" button. |
| 3 | Copy the session cookie from DevTools > Application > Cookies (localhost). With an API client send POST http://localhost:3000/api/analytics/company-insights with that cookie and an empty body. | The API answers with status 403 (or 401); no briefing text is returned. |

**Notes:** Requires an API client (e.g. Postman, curl or Insomnia) using the signed-in session cookie copied from DevTools > Application > Cookies for localhost.

*Automated:* `tests/e2e/dashboard/overview.spec.ts › Executive briefing › BRIEF-03 an engineer cannot request the briefing even through the API`

## Team detail

### TC-DASH-019: Super admin: own team shows KPIs and team members; another team shows KPIs and members (super admin)

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F6.1, F6.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Own team: The Away Team
- Other team: QualityCowboys (Payments Processing)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 3 | Look at the KPI section. | The KPI tiles (QA score and the other team KPIs) are shown. |
| 4 | Scroll down to the members area. | The section "Team members" is shown with the team's people. |
| 5 | Click "Overview" in the breadcrumb. | The Overview is shown again. |
| 6 | Type "QualityCowboys" into "Search teams" and click the team card "QualityCowboys". | The team detail page opens with the heading "QualityCowboys" and the breadcrumb "Overview / QualityCowboys". |
| 7 | Look at the KPI section. | The KPI tiles are shown. |
| 8 | Scroll down the page. | The section "Team members" is shown (super admins see every team's members). |

**Notes:** Access control check.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-01 admin: own team shows KPIs and members; another team only for roles that have it in scope`

### TC-DASH-020: Manager: own team shows KPIs and team members; another team is not offered and its API answers 403

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F6.1, F6.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123
- Own team: The Away Team
- Other team: QualityCowboys (Payments Processing)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Manager: E-mail address manager@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 3 | Look at the KPI section. | The KPI tiles (QA score and the other team KPIs) are shown. |
| 4 | Scroll down to the members area. | The section "Team members" is shown with the team's people. |
| 5 | Click "Overview" in the breadcrumb. | The Overview is shown again. |
| 6 | Type "QualityCowboys" into "Search teams". | No team card is found ("No teams match"): QualityCowboys is outside the role's scope and is not listed. |
| 7 | In the same browser open http://localhost:3000/api/teams/team-1764026236967-uphpblii4. | The answer is 403 with "Access denied. This team is outside your analytics scope."; no KPI of QualityCowboys is shown. |

**Notes:** Access control check.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-01 manager: own team shows KPIs and members; another team only for roles that have it in scope`

### TC-DASH-021: Team lead: own team shows KPIs and team members; another team is not offered and its API answers 403

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.1, F6.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Own team: The Away Team
- Other team: QualityCowboys (Payments Processing)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 3 | Look at the KPI section. | The KPI tiles (QA score and the other team KPIs) are shown. |
| 4 | Scroll down to the members area. | The section "Team members" is shown with the team's people. |
| 5 | Click "Overview" in the breadcrumb. | The Overview is shown again. |
| 6 | Type "QualityCowboys" into "Search teams". | No team card is found ("No teams match"): QualityCowboys is outside the role's scope and is not listed. |
| 7 | In the same browser open http://localhost:3000/api/teams/team-1764026236967-uphpblii4. | The answer is 403 with "Access denied. This team is outside your analytics scope."; no KPI of QualityCowboys is shown. |

**Notes:** Access control check.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-01 lead: own team shows KPIs and members; another team only for roles that have it in scope`

### TC-DASH-022: Software engineer: own team shows KPIs and team members; another team is not offered and its API answers 403

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F6.1, F6.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Own team: Mavericks
- Other team: QualityCowboys (Payments Processing)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Software engineer: E-mail address engineer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "Mavericks" into "Search teams" and click the team card "Mavericks". | The team detail page opens with the heading "Mavericks" and the breadcrumb "Overview / Mavericks". |
| 3 | Look at the KPI section. | The KPI tiles (QA score and the other team KPIs) are shown. |
| 4 | Scroll down to the members area. | The section "Team members" is shown with the team's people. |
| 5 | Click "Overview" in the breadcrumb. | The Overview is shown again. |
| 6 | Type "QualityCowboys" into "Search teams". | No team card is found ("No teams match"): QualityCowboys is outside the role's scope and is not listed. |
| 7 | In the same browser open http://localhost:3000/api/teams/team-1764026236967-uphpblii4. | The answer is 403 with "Access denied. This team is outside your analytics scope."; no KPI of QualityCowboys is shown. |

**Notes:** Access control check.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-01 engineer: own team shows KPIs and members; another team only for roles that have it in scope`

### TC-DASH-023: Viewer: own team shows KPIs and team members; another team is not offered and its API answers 403

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F6.1, F6.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Own team: The Away Team
- Other team: QualityCowboys (Payments Processing)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 3 | Look at the KPI section. | The KPI tiles (QA score and the other team KPIs) are shown. |
| 4 | Scroll down to the members area. | The section "Team members" is shown with the team's people. |
| 5 | Click "Overview" in the breadcrumb. | The Overview is shown again. |
| 6 | Type "QualityCowboys" into "Search teams". | No team card is found ("No teams match"): QualityCowboys is outside the role's scope and is not listed. |
| 7 | In the same browser open http://localhost:3000/api/teams/team-1764026236967-uphpblii4. | The answer is 403 with "Access denied. This team is outside your analytics scope."; no KPI of QualityCowboys is shown. |

**Notes:** Access control check.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-01 viewer: own team shows KPIs and members; another team only for roles that have it in scope`

### TC-DASH-024: Formula mode is offered to super admins only and explains a metric

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F6.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- E-mail: manager@irongate.com
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 3 | Click the switch "Show formulas & data sources" to turn it on. | The switch is on and the hint "Select any tile, chart or section to see how it is calculated and where its data comes from." appears. |
| 4 | Click the first KPI tile (QA score). | A dialog opens that explains how the metric is calculated and where its data comes from. |
| 5 | Press Escape. | The explanation dialog closes. |
| 6 | Click the switch "Show formulas & data sources" again to turn it off. | The hint text disappears. |
| 7 | Open the navigation menu (menu button at the top left) and click Sign out. | The sign-in page with the heading "Sign in" is shown. |
| 8 | Sign in as Manager (manager@irongate.com / demo123). | The Overview opens. |
| 9 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 10 | Look for the switch "Show formulas & data sources". | There is no such switch for the manager. |

**After the test:** Make sure formula mode is switched off for the super admin (done in the steps).

**Notes:** Uses two roles: Super admin, then Manager.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-02 formula mode is offered to super admins only and explains a metric`

### TC-DASH-025: The TV mode link of a team can be e-mailed and copied

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F6.6

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- Browser allows clipboard access for the app
- A mail program is configured (or use right-click > Copy link address on the e-mail link)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Expected link part: /tv?team=team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 3 | Right-click "E-mail TV link" and copy the link address (or click it to open the mail program). | The link is a mailto: link with a filled-in subject; its body contains a link with /tv?team=team-1764200682441-sckxod8xd. |
| 4 | Click "Copy link". | A confirmation toast "TV mode link copied" appears. |
| 5 | Paste the clipboard into a text editor or the address bar. | The pasted text is a link containing /tv?team=team-1764200682441-sckxod8xd. |

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-03 the TV link can be e-mailed and copied`

### TC-DASH-026: A failed team detail request does not leave a blank page

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F6.1

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking is available (see notes)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Block patterns: *api/teams/team-1764200682441-sckxod8xd and *api/teams/team-1764200682441-sckxod8xd?* and *api/teams/team-1764200682441-sckxod8xd/kpi-history*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | After the Overview has loaded, enable request blocking for the team detail requests of The Away Team (patterns in Test data). | The patterns are listed and ticked. |
| 3 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 4 | Look at the page. | The page is not blank: the KPI tiles section is still shown (from the overview data) even though the detail requests failed. |
| 5 | Click "Overview" in the breadcrumb. | The Overview with the team grid is shown again. |

**After the test:** Remove the blocking patterns.

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers both requests with HTTP 500.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team detail › TEAM-04 a failed team detail request does not leave a blank page`

### TC-DASH-084: QA score card: battery colour, target, 30-day change, trend, people

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F6.1a

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Battery colours: <30 red, 30–45 deep amber, 45–60 amber, 60–75 yellow, 75–90 light green, 90–100 green

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Click the card "The Away Team". | Team detail opens. The first card is the QA score card (two columns wide on a desktop). |
| 3 | Look at the battery. | A horizontal 3D battery (nib on the right); the liquid colour matches the score's band (e.g. 68 = yellow, 93 = green) and its surface moves gently. |
| 4 | Read the score area. | "QA score", the score "/100", a status badge (On target / Watch / Off target) and next to it "Target ≥ 85" (for Watch: "Watch: 70–85 · Target ≥ 85"); under it the change with an arrow, e.g. "▲ +3 pts vs 30 days ago (20 Oct 2026)", and "Based on n of 4 inputs". |
| 5 | Look at "Trend" and click "90 d". | A small line chart with a dashed target line; "90 d" becomes selected and the chart covers 90 days. |
| 6 | Read the facts under the card. | "Costs the score most" (an input with its value, the points it costs and its target), "Team" (number of people and per role), the team lead (or "Scrum Master" when that is the lead's job title) and a Product Owner when a member has that job title. No rank (the viewer sees one team). |

**Notes:** All numbers come from the latest snapshot, the KPI history and GET /api/teams/:id.

*Automated:* `tests/e2e/team/team-detail-header.spec.ts › Team detail header › TDH-01 viewer: QA card with battery band, target, change, trend toggle and people`

### TC-DASH-085: Super admin sees the team's rank among the company's teams

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F6.1a

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Open The Away Team. | Under the QA score card: "Rank by QA score: n of m teams in the company". |

**Notes:** A manager sees "n of m teams you can see" (the teams of their departments); a person with one team sees no rank.

*Automated:* `tests/e2e/team/team-detail-header.spec.ts › Team detail header › TDH-02 super admin: rank among the company's teams`

### TC-DASH-086: Every headline KPI shows its status with the target valid at its date

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.1b

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Open The Away Team and read the six KPI tiles under the score cards. | Each tile with a value reads e.g. "Off target · Target ≥ 80%", "On target · Target ≤ 10 min" or for Watch "Watch: 0.5–1 · Target ≤ 0.5 /1k LOC"; a stale value says "Stale since …" with the target under it. |
| 3 | Read the Technical debt and Task sizing tiles. | "Lower is better · Off target · Target ≤ 30" (or the matching status) and "Target 1.00 ± 0.15 · Watch: up to ± 0.30". |

*Automated:* `tests/e2e/team/team-detail-header.spec.ts › Team detail header › TDH-03 every headline KPI says its target next to its status`

### TC-DASH-087: Reduced motion: the battery liquid does not move

**Type:** Negative · **Priority:** Low · **Role:** Viewer · **Flow:** F6.1a

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Operating system setting "Reduce motion" on (or DevTools > Rendering > Emulate prefers-reduced-motion: reduce)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Open The Away Team and watch the battery for a few seconds. | The liquid surface stays still; the battery has the same size as with motion (no layout shift). |

*Automated:* `tests/e2e/team/team-detail-header.spec.ts › Team detail header › TDH-04 reduced motion: the battery liquid does not move`

### TC-DASH-090: Phone: the QA score card fits without sideways scrolling

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F6.1a

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- Browser window 390 px wide

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Open The Away Team. | The QA card stacks: battery and score, then the trend, then the facts one per line; nothing scrolls sideways. |

*Automated:* `tests/e2e/team/team-detail-header.spec.ts › Team detail header › TDH-07 phone: the QA card fits without sideways scrolling`

### TC-ROLE-009: Manager sees team recommendations on a team detail page

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F6.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address manager@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the first team card in "Team performance". | The team detail page opens. |
| 3 | Scroll down the team detail page. | A "Team recommendations" card is visible. |

*Automated:* `tests/e2e/qa-manager-rbac.spec.ts › QA Manager Role-Based Access Control › QA Manager can see team details with full insights`

### TC-ROLE-012: Software engineer sees only themselves in Team members of their own team

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F6.2

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Own team: Mavericks (Digital Products)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address engineer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Find the team card marked "· Your team" (Mavericks) and click it. | The team detail page for Mavericks opens. |
| 3 | Scroll to the "Team members" section. | The "Team members" heading is visible. |
| 4 | Count the rows in the Team members table. | Exactly one member row is shown: the signed-in engineer. |

*Automated:* `tests/e2e/qa-engineer-rbac.spec.ts › QA Engineer Role-Based Access Control › QA Engineer sees themselves in Team Members for their own team`

### TC-ROLE-013: Software engineer cannot open another team: no card, and its team detail API answers 403

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F6.2

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address engineer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Type "QualityCowboys" into "Search teams". | No card is found. |
| 3 | Open http://localhost:3000/api/teams/team-1764026236967-uphpblii4 in the same browser. | 403 "Access denied. This team is outside your analytics scope." |

*Automated:* `tests/e2e/qa-engineer-rbac.spec.ts › QA Engineer Role-Based Access Control › QA Engineer cannot open another team: no card for it, and its team detail API answers 403`

### TC-ROLE-014: Software engineer sees no team or developer recommendations

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F6.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address engineer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the first team card in "Team performance". | The team detail page opens. |
| 3 | Scroll through the whole team detail page. | There is no "Team recommendations" card and no "Developer recommendations" section. |
| 4 | Go back to Overview, open the team marked "· Your team" and scroll through it. | Again, neither "Team recommendations" nor "Developer recommendations" is shown. |

**Notes:** The automated test checks only the first team card; checking the own team as well covers both cases.

*Automated:* `tests/e2e/qa-engineer-rbac.spec.ts › QA Engineer Role-Based Access Control › QA Engineer does NOT see AI Insights or Developer Insights`

### TC-ROLE-021: Team lead sees KPIs and team recommendations for their own team

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.1, F6.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the team card marked "· Your team" (The Away Team). | The team detail page opens. |
| 3 | Look at the top of the page. | The KPI tiles (QA score, Technical debt score, Task sizing accuracy) are visible. |
| 4 | Scroll to the bottom of the page. | A "Team recommendations" card is visible. |

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Team Detail (own team) - Full access + AI insights`

### TC-ROLE-022: Team lead sees only basic metrics for another team

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F6.1, F6.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click a team card that is NOT marked "· Your team". | The team detail page of that team opens. |
| 3 | Look at the top of the page. | The KPI tiles are visible. |
| 4 | Scroll through the whole page. | There is no "Team recommendations" card. |

**Notes:** The automated test clicks the second card; choose explicitly a card without "· Your team". The demo team lead has one team, so there is no other team card to open; with a lead of several teams, another of their teams shows its KPIs without team recommendations.

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Team Detail (other teams) - Basic metrics only`

### TC-ROLE-029: Viewer opens a team detail page with KPIs

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F5.7, F6.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the first team card. | The team detail page opens with the breadcrumb "Overview / <team name>". |
| 3 | Look at the top of the page. | The KPI tiles (QA score, Technical debt score, Task sizing accuracy) are visible. |

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer can click into team detail views`

### TC-ROLE-030: Viewer sees no recommendations and no team members on a team detail page

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F6.2, F6.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the first team card. | The team detail page opens. |
| 3 | Scroll through the whole page. | There is no "Team recommendations" card, no "Developer recommendations" section and no "Team members" section. |
| 4 | Scroll back to the top. | The KPI tiles are still visible. |

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer cannot see AI insights or developer insights`

### TC-ROLE-031: Viewer goes back and forth between the overview and the teams of her scope

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F5.7

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- At least two teams exist

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the first team card. | The team detail page of the first team opens. |
| 3 | Click "Overview" in the breadcrumb at the top of the team page. | The Overview page with the team grid is shown again. |
| 4 | If more than one card is listed (a viewer of several teams), click the next card. | Its team detail opens. The demo viewer has one team (The Away Team), so there is no second card. |

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer can go back and forth between the overview and the teams of her scope`

## Team TV mode

### TC-DASH-027: "Open TV mode" shows the team full screen; Exit returns to the team page

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.5

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Type "The Away Team" into "Search teams" and click the team card "The Away Team". | The team detail page opens with the heading "The Away Team" and the breadcrumb "Overview / The Away Team". |
| 3 | Click "Open TV mode". | A full-screen TV view without the app frame opens, showing the team name "The Away Team" in large type; the address is http://localhost:5173/tv?team=team-1764200682441-sckxod8xd. |
| 4 | Move the mouse over the screen. | A controls bar appears with panel buttons, "Auto-rotate", theme, full screen and "Exit". |
| 5 | Click "Exit". | The team detail page of The Away Team is shown again. |

**Notes:** Smoke test.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-01 "Open TV mode" shows the team full screen; Exit returns to the team page`

### TC-DASH-028: TV mode keyboard: 1-4 and arrow keys switch panels, T theme, R rotation, Esc exits

**Type:** Positive · **Priority:** Medium · **Role:** Manager · **Flow:** F6.7

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123
- Address: /tv?team=team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd. | Sign-in succeeds and the page at /tv?team=team-1764200682441-sckxod8xd opens inside the app frame. |
| 2 | Look at the TV view. | The team name "The Away Team" is shown and the panel "Key KPIs" is displayed. |
| 3 | Press the key 2. | The panel "Trends · last <n> days" is shown. |
| 4 | Press the Right arrow key. | The panel "Alerts & actions" is shown. |
| 5 | Press the Right arrow key again. | The panel "Wellbeing" is shown (the fourth panel). |
| 6 | Press the Right arrow key once more. | The panel "Key KPIs" is shown again (wraps around). |
| 7 | Note the current theme and press T. | The TV view switches to the next theme (Light → Dark → Graphite → Porcelain → Light). |
| 8 | Press T three more times. | The original theme is back. |
| 9 | Press R, then move the mouse to show the controls. | The "Auto-rotate" control is shown as pressed/active and the status line at the bottom adds "panels rotate every 20 s". |
| 10 | Press R again. | "Auto-rotate" is no longer active. |
| 11 | Press Escape. | TV mode closes and the Overview is shown. |

**Notes:** The F key (full screen) is not covered here.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-02 keyboard: panels with 1-4 and arrows, T theme, R rotation, Esc exit`

### TC-DASH-029: Kiosk options in the address (?theme=light&rotate=1) are applied

**Type:** Positive · **Priority:** Low · **Role:** Super admin · **Flow:** F6.7

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Address: /tv?team=team-1764200682441-sckxod8xd&theme=light&rotate=1

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd&theme=light&rotate=1. | Sign-in succeeds and the page at /tv?team=team-1764200682441-sckxod8xd&theme=light&rotate=1 opens inside the app frame. |
| 2 | Look at the TV view. | The TV view is in the light theme (even if the app is set to dark). |
| 3 | Read the status line at the bottom. | It reads "Live · updated <time> · refreshes every 60 s · panels rotate every 20 s". |
| 4 | Press R. | Auto-rotation stops and "panels rotate every 20 s" disappears from the status line. |

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-03 kiosk options in the address (?theme=light&rotate=1)`

### TC-DASH-030: TV mode for a team outside the scope is refused, with a button to show the own team; the picker lists the scope only

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F6.8

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Address: /tv?team=team-1764026236967-uphpblii4 (QualityCowboys)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764026236967-uphpblii4. | Sign-in succeeds and the page at /tv?team=team-1764026236967-uphpblii4 opens inside the app frame. |
| 2 | Look at the TV view. | The message "This team is not available to you" is shown with the explanation "TV mode can show the teams in your scope only: ..."; no data of QualityCowboys is shown. |
| 3 | Click the button "Show Mavericks". | The TV view now shows the team name "Mavericks". |
| 4 | Move the mouse to show the controls. | There is no Team picker with other teams: the engineer's scope holds one team (Mavericks), and GET /api/tv/teams lists only Mavericks. |

**Notes:** Access control check.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-04 a team outside the scope is refused, with a way to show the own team; the picker lists the scope only`

### TC-DASH-031: An e-mailed TV link opened while signed out shows the team right after signing in

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F6.9, F1.8

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- Signed out (use a private / incognito window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Address: http://localhost:5173/tv?team=team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | In a private window open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd. | The sign-in page with the heading "Sign in" is shown. |
| 2 | Enter E-mail address viewer@irongate.com and Password demo123 and click Sign in. | TV mode opens directly (not the Overview) and shows the team name "The Away Team". |

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-05 an e-mailed TV link opened while signed out shows the team after signing in`

### TC-DASH-032: A server error in TV mode says the team could not be loaded; Exit TV mode leads to the overview

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F6.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500) for *api/tv/teams/*

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Block pattern: *localhost:3000/api/tv/teams/*

| Step | Action | Expected result |
|---|---|---|
| 1 | Enable request blocking for the pattern *localhost:3000/api/tv/teams/*. | The pattern is listed and ticked. |
| 2 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd. | Sign-in succeeds and the page at /tv?team=team-1764200682441-sckxod8xd opens inside the app frame. |
| 3 | Look at the TV view. | The message "Could not load the team" is shown with "The server did not respond. TV mode keeps trying every 15 seconds and shows the team as soon as it answers." |
| 4 | Click "Exit TV mode". | The Overview page is shown. |

**After the test:** Remove the blocking pattern.

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers the request with HTTP 500.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-06 a server error says the team could not be loaded`

### TC-DASH-033: A failed TV refresh keeps the last data on screen and says the connection was lost

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F6.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking available (see notes)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Block pattern: *localhost:3000/api/tv/teams/*

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd. | Sign-in succeeds and the page at /tv?team=team-1764200682441-sckxod8xd opens inside the app frame. |
| 2 | Wait until the TV view shows the team. | "The Away Team" and its KPIs are shown; the status line reads "Live · updated <time> · refreshes every 60 s". |
| 3 | Now enable request blocking for *localhost:3000/api/tv/teams/* (or set DevTools Network throttling to Offline). | The block is active. |
| 4 | Wait for the next automatic refresh (up to 60 seconds). | The status line changes to "Connection lost · showing data loaded at <time> · retrying every 15 s". |
| 5 | Look at the rest of the screen. | The team name "The Away Team" and the last loaded KPIs are still shown. |

**After the test:** Remove the blocking / set throttling back to No throttling.

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test triggers the refresh immediately; a manual tester waits for the 60-second refresh.

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-07 a failed refresh keeps the last data and says the connection was lost`

### TC-DASH-034: /tv without a team shows the own team (or says there is none)

**Type:** Positive · **Priority:** Medium · **Role:** Software engineer · **Flow:** F6.11

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/tv. | Sign-in succeeds and the page at /tv opens inside the app frame. |
| 2 | Look at the TV view. | TV mode shows the own team "Mavericks"; for an account without a team the message "No team to show" is shown instead. |

*Automated:* `tests/e2e/team/team-detail-and-tv.spec.ts › Team TV mode › TV-08 /tv without a team shows the own team (or says there is none)`

### TC-DASH-091: TV mode rotates through the chosen panels at the chosen interval

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.7, F6.14

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd&rotate=1&interval=5&panels=kpis,focus. | TV mode shows "The Away Team" with the panel "Key KPIs". |
| 2 | Read the status line at the bottom. | It ends with "panels rotate every 5 s"; a thin bar along the top edge fills up over 5 seconds. |
| 3 | Wait about 5 seconds without touching anything. | The panel "Alerts & actions" is shown. |
| 4 | Wait another 5 seconds. | "Key KPIs" is shown again; "Trends" and "Wellbeing" never appear (they are not in the link). |

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-01`

### TC-DASH-092: TV mode rotates between the teams in scope after the last panel

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F6.14

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd&rotate=1&interval=5&panels=kpis&teams=all. | "The Away Team" is shown with a pill "Team <n> of <total>" next to the member count. |
| 2 | Wait about 5 seconds. | The next team of the picker list is shown at once (no loading screen); the pill reads "Team <n+1> of <total>" and the address shows the new team id. |
| 3 | Wait for a few more teams. | The screen keeps moving through every team of the company, and starts again with the first after the last. |

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-02`

### TC-DASH-093: Teams outside the scope in a TV link are ignored

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F6.14

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764026202608-vcbic0w8g&rotate=1&interval=5&teams=team-1764026236967-uphpblii4,team-1764200682441-sckxod8xd,team-1764026202608-vcbic0w8g. | TV mode shows "Mavericks" (the engineer's own team); there is no "Team n of m" pill. |
| 2 | Wait 10 seconds. | "Mavericks" is still shown: QualityCowboys and The Away Team (outside the scope) never appear. |

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-03`

### TC-DASH-094: "Set up the screen" changes interval, panels, teams and theme and copies the screen link

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F6.15

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd. | TV mode shows "The Away Team". |
| 2 | Press S (or move the mouse and click "Set up"). | The dialog "Set up the screen" opens. |
| 3 | Choose "10 seconds", untick "Trends", choose "Every team in my scope", choose the theme "Porcelain" and tick "Rotate automatically". | The choices are shown as selected. |
| 4 | Click "Copy screen link" and paste the clipboard into a text editor. | A link to /tv with team=…, theme=porcelain, rotate=1, interval=10, panels=kpis,focus,pulse and teams=all. |
| 5 | Click "Start". | The dialog closes; the screen uses the Porcelain theme and the status line reads "… panels rotate every 10 s · <n> teams"; the address has interval=10 and teams=all. |
| 6 | Open the copied link in another browser window (signed in as the manager). | The same set-up starts there without any click. |

**After the test:** Open the set-up again and restore "This team only", 20 seconds, every panel and your theme, or clear the site data.

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-04`

### TC-DASH-095: The screen set-up needs at least one panel; Esc closes it without changes

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F6.15

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd and press S. | The dialog "Set up the screen" opens. |
| 2 | Untick all four panels. | "Choose at least one panel." is shown and "Start" and "Copy screen link" are disabled. |
| 3 | Press Escape. | The dialog closes; TV mode stays open, unchanged. |

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-05`

### TC-DASH-096: Alerts & actions and Wellbeing panels show team aggregates only

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.16

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd. | TV mode shows "The Away Team". |
| 2 | Press 3. | "Alerts & actions" is shown: "Open alerts" with the number open and per severity, the most urgent alerts with their message and "since <date>" (or, with no open alert, the KPIs off target and "No open alerts"), and the action plan without owner names. |
| 3 | Press 4. | "Wellbeing" is shown: the latest closed pulse period with its score out of 100 and band (Good / Watch / Low), the number of responses, the five answers as bars from 1 to 5 and the trend of the last periods; or "Not shown" when fewer than 3 people answered. |
| 4 | Look for names or comments anywhere on the screen. | No person's name (other than the team lead in the header) and no survey comment is shown. |

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-06`

### TC-DASH-097: TV mode cycles through the four themes and gives the app theme back on exit

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F6.17

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd&theme=light. | TV mode is in the Light theme. |
| 2 | Press T four times, looking at the screen after each press. | Dark, Graphite (dark glass), Porcelain (light frosted glass), then Light again; every text stays readable. |
| 3 | Press Escape. | The Overview opens in the app's own theme. |

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-07; A11Y-34 … 37`

### TC-DASH-098: TV mode recovers on its own after a lost connection

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F6.18

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd&rotate=1&interval=10. | The status line reads "Live · updated <time> …". |
| 2 | In DevTools, set Network throttling to Offline and wait up to 60 seconds. | The status line reads "Connection lost · showing data loaded at <time> · retrying every 15 s"; the team and its figures stay on screen and the panels keep rotating. |
| 3 | Set Network throttling back to No throttling and wait up to 15 seconds. | The status line reads "Live · updated <new time> …" again without any click. |

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-08`

### TC-DASH-099: TV mode on a 4K screen and hands-off: cursor and controls hide

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F6.18

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | On a 3840×2160 screen (or a browser window of that size), sign in as Super admin and open http://localhost:5173/tv?team=team-1764200682441-sckxod8xd&rotate=1. | The layout is the same as on a 1080p screen, twice as large; nothing scrolls. |
| 2 | Press F, then leave the mouse and keyboard alone for 5 seconds. | The browser goes full screen; the controls bar and the mouse cursor disappear; the screen does not dim (where the browser allows a wake lock). |
| 3 | Move the mouse. | The controls bar appears again. |

**Notes:** Headless test browsers have no real full screen; the automated test checks the scaling, the idle cursor and the controls.

*Automated:* `tests/e2e/team/tv-wall-screen.spec.ts › TVW-09, TVW-10`

## Business impact

### TC-DASH-035: Super admin: Business impact opens on the money summary; the "All teams" tab is offered

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 2 | Look at the page title and the first content. | The top bar title is "Business impact"; the Money view is shown first with sections such as "Where the money is going now" (or, if the team has no figures, the message "Revenue impact not available"). |
| 3 | Look at the tab buttons of the page. | The tabs "Money", "What-if" and "Details" are shown, plus "All teams". |

**Notes:** The company-wide roll-up (All teams) is for super admins and managers only.

*Automated:* `tests/e2e/analytics/business-impact.spec.ts › Business impact › BIZ-01 admin: money summary first; "All teams" only for super admins and managers`

### TC-DASH-036: Manager: Business impact opens on the money summary; the "All teams" tab is offered

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 2 | Look at the page title and the first content. | The top bar title is "Business impact"; the Money view is shown first with sections such as "Where the money is going now" (or, if the team has no figures, the message "Revenue impact not available"). |
| 3 | Look at the tab buttons of the page. | The tabs "Money", "What-if" and "Details" are shown, plus "All teams". |

**Notes:** The company-wide roll-up (All teams) is for super admins and managers only.

*Automated:* `tests/e2e/analytics/business-impact.spec.ts › Business impact › BIZ-01 manager: money summary first; "All teams" only for super admins and managers`

### TC-DASH-037: Team lead: Business impact opens on the money summary; the "All teams" tab is not offered

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 2 | Look at the page title and the first content. | The top bar title is "Business impact"; the Money view is shown first with sections such as "Where the money is going now" (or, if the team has no figures, the message "Revenue impact not available"). |
| 3 | Look at the tab buttons of the page. | The tabs "Money", "What-if" and "Details" are shown; there is NO "All teams" tab. |

**Notes:** The company-wide roll-up (All teams) is for super admins and managers only.

*Automated:* `tests/e2e/analytics/business-impact.spec.ts › Business impact › BIZ-01 lead: money summary first; "All teams" only for super admins and managers`

### TC-DASH-038: Software engineer: Business impact opens on the money summary; the "All teams" tab is not offered

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 2 | Look at the page title and the first content. | The top bar title is "Business impact"; the Money view is shown first with sections such as "Where the money is going now" (or, if the team has no figures, the message "Revenue impact not available"). |
| 3 | Look at the tab buttons of the page. | The tabs "Money", "What-if" and "Details" are shown; there is NO "All teams" tab. |

**Notes:** The company-wide roll-up (All teams) is for super admins and managers only.

*Automated:* `tests/e2e/analytics/business-impact.spec.ts › Business impact › BIZ-01 engineer: money summary first; "All teams" only for super admins and managers`

### TC-DASH-039: Viewer: Business impact opens on the money summary; the "All teams" tab is not offered

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 2 | Look at the page title and the first content. | The top bar title is "Business impact"; the Money view is shown first with sections such as "Where the money is going now" (or, if the team has no figures, the message "Revenue impact not available"). |
| 3 | Look at the tab buttons of the page. | The tabs "Money", "What-if" and "Details" are shown; there is NO "All teams" tab. |

**Notes:** The company-wide roll-up (All teams) is for super admins and managers only.

*Automated:* `tests/e2e/analytics/business-impact.spec.ts › Business impact › BIZ-01 viewer: money summary first; "All teams" only for super admins and managers`

### TC-DASH-040: What-if with empty, huge, negative, zero and tiny changes keeps the page working

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools Console open to watch for uncaught errors

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Change values: (empty), -5, 99999999, 0, 0.00001

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact?team=team-1764200682441-sckxod8xd. | Sign-in succeeds and the page at /analytics/business-impact?team=team-1764200682441-sckxod8xd opens inside the app frame. |
| 2 | Click the tab "What-if". | The what-if form with a metric dropdown, the field "Change (<unit>s, use − for a decrease)" and a result box is shown. |
| 3 | Clear the Change field. | The result box is still shown and contains no "NaN", "Infinity" or "undefined". |
| 4 | Enter -5 in the Change field. | The result box is shown, with no "NaN", "Infinity" or "undefined". |
| 5 | Enter 99999999. | The result box is shown, with no "NaN", "Infinity" or "undefined". |
| 6 | Enter 0. | The result box is shown, with no "NaN", "Infinity" or "undefined". |
| 7 | Enter 0.00001. | The result box is shown, with no "NaN", "Infinity" or "undefined". |
| 8 | Check the DevTools Console. | No uncaught errors were logged; the page never went blank. |

*Automated:* `tests/e2e/analytics/business-impact.spec.ts › Business impact › BIZ-02 what-if with empty, huge and negative changes keeps the page working`

### TC-DASH-080: Super admin: money summary first, explanations behind "How is this calculated?", What-if, Details and All teams

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- What-if change: 2

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 2 | Wait for the Money view. | The headings "Where the money is going now", "What you gain when these are fixed" and "Where to put the money first" are shown. |
| 3 | Look at "Where the money is going now". | Exactly five causes are listed (quality gaps, technical debt, downtime, support, churn), each with a rounded figure like "$1.2k/month", "$300/month", "$1.5M/month" (negative with −) or "—" with its reason. |
| 4 | Look at "What you gain when these are fixed". | At most five gains are shown before a "Show all <n> …" button. |
| 5 | On the first cause click "How is this calculated?". | The explanation opens and contains "Monthly revenue at stake = …". |
| 6 | Click the tab "What-if". | The what-if result box is shown. |
| 7 | Enter 2 in the Change field. | The result says "… is associated with this change in monthly revenue." or "No projection." with a reason. |
| 8 | Click the tab "Details". | At least three collapsible sections are shown, all collapsed. |
| 9 | Click "How sure are we? Revenue per metric". | It expands and shows "$ per month associated with +1 unit of each metric…" or "Not enough months yet". |
| 10 | Click the tab "All teams". | The company roll-up is shown with the tile "Teams with a figure" and an "Export CSV" button. |

*Automated:* `tests/e2e/revenue-impact.spec.ts › Business impact: revenue impact › super admin: money summary first, explanations behind "How is this calculated?", what-if and all teams`

### TC-DASH-081: Software engineer: no All teams / Data entry tabs, the roll-up API refuses; money summary for the own team

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F7.9, F4.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 2 | Wait for the Money view. | The money summary of the engineer's own team (Mavericks) is shown. |
| 3 | Look at the tabs. | There is no "All teams" tab and no "Data entry" tab. |
| 4 | In a new tab of the same browser open http://localhost:3000/api/revenue-impact/rollup. | The API answers 403 (forbidden); no roll-up data is returned. |

**Notes:** Access control check.

*Automated:* `tests/e2e/revenue-impact.spec.ts › Business impact: revenue impact › QA engineer: no roll-up tab and the roll-up API refuses; the money summary is shown for the own team`

### TC-DASH-082: Phone width: the money summary fits without horizontal scrolling

**Type:** Positive · **Priority:** Low · **Role:** Manager · **Flow:** F4.11, F7.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- Browser window (or DevTools device toolbar) set to 390 x 844 pixels

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Set the browser viewport to 390 x 844 (DevTools > Toggle device toolbar > custom size). | The app is shown in phone layout. |
| 2 | Sign in as Manager (manager@irongate.com / demo123), then open http://localhost:5173/analytics/business-impact. | Sign-in succeeds and the page at /analytics/business-impact opens inside the app frame. |
| 3 | Wait for the money summary and scroll the page up and down. | The money summary is shown; the page cannot be scrolled sideways and nothing sticks out to the right. |

**After the test:** Reset the viewport to the normal size.

*Automated:* `tests/e2e/revenue-impact.spec.ts › Business impact: revenue impact › phone width: the money summary fits without horizontal scrolling`

## Analytics modules

### TC-DASH-041: The Analytics hub opens each of the ten modules

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F7.1

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/analytics. | Sign-in succeeds and the page at /analytics opens inside the app frame. |
| 2 | On the Analytics hub click the module card "Flaky tests". | The top bar title is "Flaky tests" and the address is /analytics/flaky-tests (optionally followed by ?team=...). |
| 3 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Test execution". | The top bar title is "Test execution" and the address is /analytics/timeline (optionally followed by ?team=...). |
| 4 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Technical debt". | The top bar title is "Technical debt" and the address is /analytics/technical-debt (optionally followed by ?team=...). |
| 5 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Performance". | The top bar title is "Performance" and the address is /analytics/performance (optionally followed by ?team=...). |
| 6 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "CI/CD pipeline". | The top bar title is "CI/CD pipeline" and the address is /analytics/pipeline (optionally followed by ?team=...). |
| 7 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Developer productivity". | The top bar title is "Developer productivity" and the address is /analytics/productivity (optionally followed by ?team=...). |
| 8 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Wellbeing pulse". | The top bar title is "Wellbeing pulse" and the address is /analytics/pulse (optionally followed by ?team=...). |
| 9 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Business impact". | The top bar title is "Business impact" and the address is /analytics/business-impact (optionally followed by ?team=...). |
| 10 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Team rankings". | The top bar title is "Team rankings" and the address is /analytics/gamification (optionally followed by ?team=...). |
| 11 | Go back to the Analytics hub (http://localhost:5173/analytics) and click the module card "Reports". | The top bar title is "Reports" and the address is /analytics/reports (optionally followed by ?team=...). |

**Notes:** Smoke test.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-01 the hub opens each of the ten modules`

### TC-DASH-042: Super admin: the analytics scope bar lets the role choose exactly what its scope allows

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F7.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt. | Sign-in succeeds and the page at /analytics/technical-debt opens inside the app frame. |
| 2 | Look at the scope bar above the module. | The scope bar with "Department" and "Team" is shown. |
| 3 | Check whether Department and Team can be changed. | "Department" is a dropdown and "Team" is a dropdown. |

**Notes:** Access control: super admins choose department and team; managers choose a team of their department; team leads, engineers and viewers see their fixed team.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-02 admin: the scope bar lets the role choose exactly what its scope allows`

### TC-DASH-043: Manager: the analytics scope bar lets the role choose exactly what its scope allows

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F7.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt. | Sign-in succeeds and the page at /analytics/technical-debt opens inside the app frame. |
| 2 | Look at the scope bar above the module. | The scope bar with "Department" and "Team" is shown. |
| 3 | Check whether Department and Team can be changed. | "Department" is fixed text (read-only) and "Team" is a dropdown. |

**Notes:** Access control: super admins choose department and team; managers choose a team of their department; team leads, engineers and viewers see their fixed team.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-02 manager: the scope bar lets the role choose exactly what its scope allows`

### TC-DASH-044: Team lead: the analytics scope bar lets the role choose exactly what its scope allows

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F7.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt. | Sign-in succeeds and the page at /analytics/technical-debt opens inside the app frame. |
| 2 | Look at the scope bar above the module. | The scope bar with "Department" and "Team" is shown. |
| 3 | Check whether Department and Team can be changed. | "Department" is fixed text (read-only) and "Team" is fixed text (read-only). There is no Team dropdown to choose another team. |

**Notes:** Access control: super admins choose department and team; managers choose a team of their department; team leads, engineers and viewers see their fixed team.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-02 lead: the scope bar lets the role choose exactly what its scope allows`

### TC-DASH-045: Software engineer: the analytics scope bar lets the role choose exactly what its scope allows

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F7.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt. | Sign-in succeeds and the page at /analytics/technical-debt opens inside the app frame. |
| 2 | Look at the scope bar above the module. | The scope bar with "Department" and "Team" is shown. |
| 3 | Check whether Department and Team can be changed. | "Department" is fixed text (read-only) and "Team" is fixed text (read-only). There is no Team dropdown to choose another team. |

**Notes:** Access control: super admins choose department and team; managers choose a team of their department; team leads, engineers and viewers see their fixed team.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-02 engineer: the scope bar lets the role choose exactly what its scope allows`

### TC-DASH-046: Viewer: the analytics scope bar lets the role choose exactly what its scope allows

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F7.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt. | Sign-in succeeds and the page at /analytics/technical-debt opens inside the app frame. |
| 2 | Look at the scope bar above the module. | The scope bar with "Department" and "Team" is shown. |
| 3 | Check whether Department and Team can be changed. | "Department" is fixed text (read-only) and "Team" is fixed text (read-only). There is no Team dropdown to choose another team. |

**Notes:** Access control: super admins choose department and team; managers choose a team of their department; team leads, engineers and viewers see their fixed team.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-02 viewer: the scope bar lets the role choose exactly what its scope allows`

### TC-DASH-047: Every analytics module renders for a team without an uncaught error

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F7.3, F16.1

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Open DevTools > Console and keep it open during the test. | The Console is visible. |
| 2 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 3 | Open http://localhost:5173/analytics/flaky-tests?team=team-1764200682441-sckxod8xd. | The top bar title is "Flaky tests", the scope bar is shown and the page content contains "Flaky tests". |
| 4 | Open http://localhost:5173/analytics/timeline?team=team-1764200682441-sckxod8xd. | The top bar title is "Test execution", the scope bar is shown and the page content contains "Test execution timeline". |
| 5 | Open http://localhost:5173/analytics/technical-debt?team=team-1764200682441-sckxod8xd. | The top bar title is "Technical debt", the scope bar is shown and the page content contains "Technical debt". |
| 6 | Open http://localhost:5173/analytics/performance?team=team-1764200682441-sckxod8xd. | The top bar title is "Performance", the scope bar is shown and the page content contains "Performance". |
| 7 | Open http://localhost:5173/analytics/pipeline?team=team-1764200682441-sckxod8xd. | The top bar title is "CI/CD pipeline", the scope bar is shown and the page content contains "CI/CD pipeline". |
| 8 | Open http://localhost:5173/analytics/productivity?team=team-1764200682441-sckxod8xd. | The top bar title is "Developer productivity", the scope bar is shown and the page content contains "Developer productivity". |
| 9 | Open http://localhost:5173/analytics/pulse?team=team-1764200682441-sckxod8xd. | The top bar title is "Wellbeing pulse", the scope bar is shown and the page content contains "Wellbeing pulse". |
| 10 | Open http://localhost:5173/analytics/business-impact?team=team-1764200682441-sckxod8xd. | The top bar title is "Business impact", the scope bar is shown and the page content contains "Business impact". |
| 11 | Open http://localhost:5173/analytics/gamification?team=team-1764200682441-sckxod8xd. | The top bar title is "Team rankings", the scope bar is shown and the page content contains "Team rankings". |
| 12 | Open http://localhost:5173/analytics/reports?team=team-1764200682441-sckxod8xd. | The top bar title is "Reports", the scope bar is shown and the page content contains "Reports". |
| 13 | Check the DevTools Console. | No uncaught errors (red exceptions) were logged while opening the modules. |

**Notes:** Smoke test.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-03 every module renders for a team without an uncaught error`

### TC-DASH-048: The chosen team stays in the address while moving between modules

**Type:** Positive · **Priority:** Medium · **Role:** Manager · **Flow:** F7.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123), then open http://localhost:5173/analytics/flaky-tests. | Sign-in succeeds and the page at /analytics/flaky-tests opens inside the app frame. |
| 2 | Open the "Team" dropdown of the scope bar. | It lists more than one team. |
| 3 | Choose a team other than The Away Team and note its name. | The module reloads for that team and the address contains team=<id of that team>. |
| 4 | Open the navigation menu and click "CI/CD pipeline". | The top bar title is "CI/CD pipeline". |
| 5 | Check the address and the Team dropdown. | The address still contains the same team=<id>, and the Team dropdown shows the chosen team. |

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-04 the chosen team stays in the address while moving between modules`

### TC-DASH-049: CSV export of a module and the PDF team report download files

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.5

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt?team=team-1764200682441-sckxod8xd. | Sign-in succeeds and the page at /analytics/technical-debt?team=team-1764200682441-sckxod8xd opens inside the app frame. |
| 2 | Click the first "Export CSV" button. | The browser downloads a file whose name ends in .csv. |
| 3 | Open http://localhost:5173/analytics/reports?team=team-1764200682441-sckxod8xd. | The Reports page is shown. |
| 4 | Click "Download PDF". | The button shows "Generating…" briefly, then the browser downloads a file whose name ends in .pdf. |

**After the test:** Delete the downloaded files if not needed.

**Notes:** PDF content is not checked.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-05 CSV and PDF exports download files`

### TC-DASH-050: When the analytics scope cannot be loaded the modules say so

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F7.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- A proxy/mock tool answers GET http://localhost:3000/api/analytics/scope (with any query) with HTTP 500 {"error": "Internal server error"}

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Switch on the mock rule for the analytics scope request. | The rule is active. |
| 2 | Sign in as Team lead (lead@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt. | Sign-in succeeds and the page at /analytics/technical-debt opens inside the app frame. |
| 3 | Look at the module area. | The panel "Analytics scope unavailable" is shown with the text "Could not load your analytics scope (500)." |

**After the test:** Switch off the mock rule.

**Notes:** Requires a proxy/mock tool (e.g. Requestly, Charles, Fiddler or mitmproxy) that can answer the named API request with a chosen HTTP status and JSON body; DevTools request blocking only simulates a network failure. With plain DevTools blocking the title is the same but the text reads "Could not load your analytics scope." or a network error.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-06 the analytics scope cannot be loaded: the modules say so`

### TC-DASH-051: Flaky tests module: a server error shows a message, not an empty module

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500 {"error": "Internal server error", "requestId": "rid-mod"}) for the module's data request

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern(s): *localhost:3000/api/analytics/flaky-tests*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Enable request blocking for: *localhost:3000/api/analytics/flaky-tests*. | The pattern(s) are listed and ticked. |
| 3 | Open http://localhost:5173/analytics/flaky-tests?team=team-1764200682441-sckxod8xd. | The Flaky tests module opens (top bar title "Flaky tests"). |
| 4 | Look at the module content. | An error message is shown: "Could not load flaky tests.". The module does not pretend there is simply no data. |

**After the test:** Remove the blocking pattern(s).

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers with HTTP 500.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-07 /analytics/flaky-tests: a server error shows a message, not an empty module`

### TC-DASH-052: Technical debt module: a server error shows a message, not an empty module

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500 {"error": "Internal server error", "requestId": "rid-mod"}) for the module's data request

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern(s): *localhost:3000/api/analytics/technical-debt*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Enable request blocking for: *localhost:3000/api/analytics/technical-debt*. | The pattern(s) are listed and ticked. |
| 3 | Open http://localhost:5173/analytics/technical-debt?team=team-1764200682441-sckxod8xd. | The Technical debt module opens (top bar title "Technical debt"). |
| 4 | Look at the module content. | An error message is shown: "Could not load technical debt.". The module does not pretend there is simply no data. |

**After the test:** Remove the blocking pattern(s).

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers with HTTP 500.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-07 /analytics/technical-debt: a server error shows a message, not an empty module`

### TC-DASH-053: CI/CD pipeline module: a server error shows a message, not an empty module

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500 {"error": "Internal server error", "requestId": "rid-mod"}) for the module's data request

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern(s): *localhost:3000/api/analytics/pipeline*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Enable request blocking for: *localhost:3000/api/analytics/pipeline*. | The pattern(s) are listed and ticked. |
| 3 | Open http://localhost:5173/analytics/pipeline?team=team-1764200682441-sckxod8xd. | The CI/CD pipeline module opens (top bar title "CI/CD pipeline"). |
| 4 | Look at the module content. | An error message is shown: "Could not load pipeline stages.". The module does not pretend there is simply no data. |

**After the test:** Remove the blocking pattern(s).

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers with HTTP 500.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-07 /analytics/pipeline: a server error shows a message, not an empty module`

### TC-DASH-054: Performance module: a server error shows a message, not an empty module

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500 {"error": "Internal server error", "requestId": "rid-mod"}) for the module's data request

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern(s): *localhost:3000/api/analytics/performance*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Enable request blocking for: *localhost:3000/api/analytics/performance*. | The pattern(s) are listed and ticked. |
| 3 | Open http://localhost:5173/analytics/performance?team=team-1764200682441-sckxod8xd. | The Performance module opens (top bar title "Performance"). |
| 4 | Look at the module content. | An error message is shown: an error starting with "Could not load" (e.g. "Could not load performance metrics."). The module does not pretend there is simply no data. |

**After the test:** Remove the blocking pattern(s).

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers with HTTP 500.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-07 /analytics/performance: a server error shows a message, not an empty module`

### TC-DASH-055: Test execution module: a server error shows a message, not an empty module

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500 {"error": "Internal server error", "requestId": "rid-mod"}) for the module's data request

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern(s): *localhost:3000/api/analytics/test-executions*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Enable request blocking for: *localhost:3000/api/analytics/test-executions*. | The pattern(s) are listed and ticked. |
| 3 | Open http://localhost:5173/analytics/timeline?team=team-1764200682441-sckxod8xd. | The Test execution module opens (top bar title "Test execution"). |
| 4 | Look at the module content. | An error message is shown: exactly "Could not load the test runs: the server had a problem. Try again in a moment. Reference: rid-mod." (with a mock returning 500 and requestId rid-mod); with DevTools blocking: "Could not load the test runs: the server could not be reached. Check your connection and try again.". The module does not pretend there is simply no data. |

**After the test:** Remove the blocking pattern(s).

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers with HTTP 500. Fixed issue FI-08 (previously showed "No test runs in this period").

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-07 /analytics/timeline: a server error shows a message, not an empty module`

### TC-DASH-056: Reports module: a server error shows a message, not an empty module

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500 {"error": "Internal server error", "requestId": "rid-mod"}) for the module's data request

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern(s): *localhost:3000/api/teams/team-1764200682441-sckxod8xd*, *localhost:3000/api/analytics/flaky-tests*, *localhost:3000/api/analytics/technical-debt*

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Enable request blocking for: *localhost:3000/api/teams/team-1764200682441-sckxod8xd*, *localhost:3000/api/analytics/flaky-tests*, *localhost:3000/api/analytics/technical-debt*. | The pattern(s) are listed and ticked. |
| 3 | Open http://localhost:5173/analytics/reports?team=team-1764200682441-sckxod8xd. | The Reports module opens (top bar title "Reports"). |
| 4 | Look at the module content. | An error message is shown: "Could not load report data.". The module does not pretend there is simply no data. |

**After the test:** Remove the blocking pattern(s).

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers with HTTP 500. The automated test fails every data request except sign-in, scope, team list, notifications, pulse, saved views and activity.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-07 /analytics/reports: a server error shows a message, not an empty module`

### TC-DASH-057: Developer productivity: a server error is shown with its reference, not as "no data"

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3, F7.7

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- A proxy/mock tool answers GET http://localhost:3000/api/analytics/developer-metrics (any query) with HTTP 500 {"error": "Internal server error", "requestId": "rid-dev"} (DevTools blocking of *api/analytics/developer-metrics* also reproduces it)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Switch on the mock rule / request blocking for the developer-metrics request. | The rule is active. |
| 2 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/analytics/productivity?team=team-1764200682441-sckxod8xd. | Sign-in succeeds and the page at /analytics/productivity?team=team-1764200682441-sckxod8xd opens inside the app frame. |
| 3 | Look at the module content. | A red message reads "Could not load the developer metrics: the server had a problem. Try again in a moment. Reference: rid-dev." No "No data recorded" and no "No developer metrics recorded" is shown. |

**After the test:** Switch off the mock rule / blocking.

**Notes:** FI-06 (fixed). Requires a proxy/mock tool (e.g. Requestly, Charles, Fiddler or mitmproxy) that can answer the named API request with HTTP 500 and the JSON body; DevTools request blocking reproduces the network-failure case (next test case).

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-08 developer productivity: a server error is shown with its reference, not as "no data"`

### TC-DASH-058: Developer productivity: an unreachable server and a failed snapshot history are errors too

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.3, F7.7

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools > Network request blocking available; for step 4 a proxy/mock tool that answers GET /api/analytics/ddps-history with HTTP 500 {"error":"Internal server error","requestId":"rid-hist"}

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123). In DevTools block the request URL pattern *api/analytics/developer-metrics*. | Blocking is active. |
| 2 | Open http://localhost:5173/analytics/productivity?team=team-1764200682441-sckxod8xd. | A red message reads "Could not load the developer metrics: the server could not be reached. Check your connection and try again." |
| 3 | Remove the block, switch on the mock rule for ddps-history and reload the page. | The developer figures load (no red message at the top). |
| 4 | Look at the card "Recorded DDPS snapshots". | It shows "Could not load the DDPS snapshots: the server had a problem. Try again in a moment. Reference: rid-hist." instead of "No snapshots recorded". |

**After the test:** Remove the request block and the mock rule.

**Notes:** FI-06 (fixed). Requires DevTools and a proxy/mock tool.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Analytics › AN-09 developer productivity: an unreachable server and a failed snapshot history are errors too`

## Developer insights

### TC-DASH-059: A software engineer sees only their own developer row in Developer productivity

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F7.7

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/analytics/productivity. | Sign-in succeeds and the page at /analytics/productivity opens inside the app frame. |
| 2 | Look at the developer table header. | A badge reads "Showing your own metrics only". |
| 3 | Look for a "Developer" dropdown to pick another person. | There is no "Developer" dropdown; only the engineer's own row is shown. |

**Notes:** Privacy / access control.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Developer insights opt-in › DEV-01 an engineer sees only their own developer row`

### TC-DASH-060: A super admin switches a person's developer insights on and off in Users

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.8

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- A super admin has created a test person in NovaTech, e.g. Fixture Person, fixture.person+<date>@uitest.example, role Software engineer, team Mavericks, developer insights off (Users > "Add with password")

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Person: fixture.person+<date>@uitest.example

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/users. | Sign-in succeeds and the page at /users opens inside the app frame. |
| 2 | Type the test person's e-mail into "Search users by name, email, team...". | Exactly the test person's user card is shown; its insights toggle (robot icon) is named "Enable developer insights" (tooltip) and is not pressed. |
| 3 | Click the insights toggle on that card. | A toast "Developer insights enabled" appears; the toggle is now named "Disable developer insights" and pressed. |
| 4 | Reload the page and search for the person again. | The toggle still reads "Disable developer insights": the setting was saved. |
| 5 | Click the insights toggle again. | A toast "Developer insights disabled" appears; the toggle reads "Enable developer insights" again. |

**After the test:** Delete the test person in Users.

**Notes:** Wording fixed (FI-13): nothing on the button or the toasts says "AI insights" any more.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Developer insights opt-in › DEV-02 a super admin switches a person's developer insights on and off in Users`

### TC-DASH-061: A team lead cannot change the developer-insights opt-in of a person outside their team

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F7.8, F4.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- A super admin has created a test person in NovaTech, e.g. Fixture Person, fixture.person+<date>@uitest.example, role Software engineer, team Mavericks, developer insights off (Users > "Add with password")
- The test person's user id is known (as super admin: DevTools > Network, response of the Users list request)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Person id: <id of the test person>
- Body: {"enabled": true}

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | With an API client and the team lead's session cookie send PATCH http://localhost:3000/api/admin/users/<person id>/developer-insights-toggle with JSON body {"enabled": true}. | The API answers 403 or 404. |
| 3 | Open the navigation menu (menu button at the top left) and click Sign out. | The sign-in page with the heading "Sign in" is shown. |
| 4 | Sign in as Super admin (admin@irongate.com / demo123), open Users and search for the test person. | The person's insights toggle still shows "Enable developer insights": developer insights stayed off. |

**After the test:** Delete the test person in Users.

**Notes:** Requires an API client (e.g. Postman, curl or Insomnia) using the signed-in session cookie copied from DevTools > Application > Cookies for localhost.

*Automated:* `tests/e2e/analytics/modules.spec.ts › Developer insights opt-in › DEV-03 the opt-in cannot be changed by someone who does not manage the person`

## Compare teams

### TC-DASH-062: Compare at most four teams; removing one brings the add list back; the trend window is kept in the address

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/compare. | Sign-in succeeds and the page at /compare opens inside the app frame. |
| 2 | Look at the Teams area. | Two team chips are shown and the label reads "Teams (2 of 4)". |
| 3 | In the "Add team" dropdown choose the first listed team. | A third chip is added ("Teams (3 of 4)"). |
| 4 | In the "Add team" dropdown choose the first listed team again. | A fourth chip is added. |
| 5 | Look at the Teams area. | The label reads "Teams (4 of 4)" and the "Add team" dropdown is no longer shown. |
| 6 | Click the X ("Remove <team> from the comparison") on the first chip. | Three chips remain and the "Add team" dropdown is shown again. |
| 7 | Set "Trend window" to "90 days". | The address contains days=90. |
| 8 | Reload the page. | "Trend window" still shows "90 days" and the same three chips are shown. |

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Compare teams › CMP-01 at most four teams; removing one brings the add list back; the window is kept in the address`

### TC-DASH-063: An address with unknown ids, too many ids or a bad window falls back safely

**Type:** Negative · **Priority:** Medium · **Role:** Manager · **Flow:** F7.10, F16.9

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123
- Address: /compare?teams=no-such-team,also-not,%3Cscript%3E,x,y,z&days=999&diff=1

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123), then open http://localhost:5173/compare?teams=no-such-team,also-not,%3Cscript%3E,x,y,z&days=999&diff=1. | Sign-in succeeds and the page at /compare?teams=no-such-team,also-not,%3Cscript%3E,x,y,z&days=999&diff=1 opens inside the app frame. |
| 2 | Look at the page. | The Compare teams page opens normally (no error page, no script runs, no alert). |
| 3 | Check "Trend window". | It shows "30 days" (the invalid 999 was replaced by the default). |
| 4 | Check the Teams area. | The label reads "Teams (<n> of 4)" and at most four chips are shown; the unknown ids are not shown as teams. |

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Compare teams › CMP-02 an address with unknown ids, too many ids or a bad window falls back safely`

### TC-DASH-064: A team outside the scope in the address is not compared

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F7.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Address: /compare?teams=team-1764026202608-vcbic0w8g,team-1764026236967-uphpblii4

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/compare?teams=team-1764026202608-vcbic0w8g,team-1764026236967-uphpblii4. | Sign-in succeeds and the page at /compare?teams=team-1764026202608-vcbic0w8g,team-1764026236967-uphpblii4 opens inside the app frame. |
| 2 | Look at the page. | The Compare teams page opens. |
| 3 | Look for a team card of QualityCowboys. | No card or data of QualityCowboys is shown. |

**Notes:** Access control check.

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Compare teams › CMP-03 a team outside the scope in the address is not compared`

### TC-DASH-065: A failed comparison request shows a message

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering HTTP 500) for the comparison request

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Block pattern: *localhost:3000/api/compare/teams?*

| Step | Action | Expected result |
|---|---|---|
| 1 | Enable request blocking for *localhost:3000/api/compare/teams?*. | The pattern is listed and ticked. |
| 2 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/compare. | Sign-in succeeds and the page at /compare opens inside the app frame. |
| 3 | Look at the comparison area. | An error message is shown instead of the comparison (e.g. "Could not compare the teams (500)" or another text containing "could not", "failed" or "error"). |

**After the test:** Remove the blocking pattern.

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test answers with HTTP 500 {"error": "Internal server error"}.

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Compare teams › CMP-04 a failed comparison request shows a message`

### TC-DASH-070: Compare teams from the navigation: add a team, differences are highlighted, "Only rows that differ" filters

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Open the navigation menu and click "Compare teams". | The Compare teams page opens with two team chips and two team cards. |
| 3 | In "Add team" choose the first listed team. | Three team cards and the comparison table are shown; the address parameter teams= lists three ids. |
| 4 | Look at the comparison table. | More than 10 metric rows are shown; rows where the teams differ are highlighted (amber tint). |
| 5 | Tick "Only rows that differ (<n>)". | Only the highlighted rows remain; their number equals <n>. |

*Automated:* `tests/e2e/compare-views-onboarding.spec.ts › Compare teams, saved views, CSV export, onboarding › Compare teams: open from the navigation, add a team, differences are highlighted`

### TC-DASH-071: Compare teams: a software engineer only gets teams of their own scope; the API refuses others

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F7.10, F4.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123), then open http://localhost:5173/compare. | Sign-in succeeds and the page at /compare opens inside the app frame. |
| 2 | Look at the page. | The Compare teams page opens. If the engineer's scope has fewer than two teams (normal for the demo engineer: only Mavericks) the message "Not enough teams to compare" is shown; otherwise every chip is a team of the engineer's scope. |
| 3 | In a new tab of the same browser open http://localhost:3000/api/compare/teams?ids=team-1764026202608-vcbic0w8g,no-such-team. | The API answers 403 (forbidden); no comparison data is returned. |

**Notes:** Access control check.

*Automated:* `tests/e2e/compare-views-onboarding.spec.ts › Compare teams, saved views, CSV export, onboarding › Compare teams: an engineer only gets teams of their own scope`

### TC-DASH-089: Compare shows status and target under every value

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.10a

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview"). |
| 2 | Open /compare?teams=team-1764200682441-sckxod8xd,team-1764026202608-vcbic0w8g. | Under each value: "On target · Target ≥ 80%", "Off target · …" or "Watch: 70–80% · Target ≥ 80%"; under each QA score the target (and the watch band for Watch). |

*Automated:* `tests/e2e/team/team-detail-header.spec.ts › Team detail header › TDH-06 Compare says status and target under each value`

## Saved views

### TC-DASH-066: A super admin shares a view; a manager sees it read-only and cannot share their own

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F7.11, F7.12

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Manager: manager@irongate.com / demo123
- View names: UI shared <date-time>, UI mine <date-time>

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Click the "Views" button. | The saved views panel opens with "Your views" and the link "Save current view…". |
| 3 | Click "Save current view…". | A field "Name of the view" and a "Save" button appear. |
| 4 | Type the name "UI shared <date-time>" and click "Save". | The views button now shows the name "UI shared <date-time>" (truncated if long). |
| 5 | Open "Views" again and on the row "UI shared <date-time>" click the share icon (tooltip "Share with the company"). | The row now says "Shared with the company" and offers "Stop sharing" instead of the share icon. |
| 6 | Press Escape, then sign out via the navigation menu. | The sign-in page is shown. |
| 7 | Sign in as Manager (manager@irongate.com / demo123) and click "Views". | Under "Shared with the company" the view "UI shared <date-time>" is listed with "Shared by <admin name>"; it has no delete and no share icon. |
| 8 | Click the shared view. | A toast "Opened view \"UI shared <date-time>\"" appears and the views button shows its name. |
| 9 | Click "Views", then "Save current view…", name it "UI mine <date-time>" and click "Save". | The manager's own view is saved and shown on the views button. |
| 10 | Open "Views" and look at the row "UI mine <date-time>". | The row has no share icon: only super admins can share views. |

**After the test:** As the manager delete "UI mine <date-time>"; as the super admin delete "UI shared <date-time>" (Delete icon in the Views panel).

**Notes:** Uses two roles. Access control check.

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Saved views › VIEW-01 a super admin shares a view; a manager sees it read-only and cannot share their own`

### TC-DASH-067: An empty view name cannot be saved; a name with markup is shown as text; a double click saves once

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F7.11, F16.9, F16.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Name 1: three spaces
- Name 2: UI xss <img src=x onerror="window.__xss=1"> <date-time>

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Team lead: E-mail address lead@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Click "Views" and then "Save current view…". | The "Name of the view" field is empty and the "Save" button is disabled. |
| 3 | Type three spaces into the name field. | "Save" stays disabled. |
| 4 | Replace the name with UI xss <img src=x onerror="window.__xss=1"> <date-time> and double-click "Save". | The view is saved; no image or script appears. |
| 5 | Open the "Views" panel (close and reopen it if needed). | Exactly ONE view whose name starts with "UI xss <img" is listed, the name shown literally as text. |
| 6 | Optional: in the DevTools Console check the variable __xss on the window. | It is undefined (the markup was not executed). |

**After the test:** Delete the "UI xss …" view.

**Notes:** Security check (markup) and double-submit check.

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Saved views › VIEW-02 an empty name cannot be saved; a name with markup is shown as text; a double click saves once`

### TC-DASH-068: A saved view of an analytics module keeps the team

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.11

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- View name: UI module view <date-time>

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/analytics/technical-debt?team=team-1764026202608-vcbic0w8g. | Sign-in succeeds and the page at /analytics/technical-debt?team=team-1764026202608-vcbic0w8g opens inside the app frame. |
| 2 | Check the scope bar. | Team "Mavericks" is selected. |
| 3 | Click the "Views" button. | The saved views panel opens with "Your views" and the link "Save current view…". |
| 4 | Click "Save current view…". | A field "Name of the view" and a "Save" button appear. |
| 5 | Type the name "UI module view <date-time>" and click "Save". | The views button now shows the name "UI module view <date-time>" (truncated if long). |
| 6 | Press Escape. In the scope bar choose Department "DevOps" (if needed) and Team "The Away Team". | The module shows The Away Team; the address contains team=team-1764200682441-sckxod8xd. |
| 7 | Click "Views" and click "UI module view <date-time>". | The module switches back to Mavericks; the address contains team=team-1764026202608-vcbic0w8g. |

**After the test:** Delete the "UI module view …" view.

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Saved views › VIEW-03 a view of an analytics module keeps the team`

### TC-DASH-069: A failed save of a view is reported and nothing is listed

**Type:** Negative · **Priority:** Medium · **Role:** Viewer · **Flow:** F7.11

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- DevTools request blocking (or a mock answering POST /api/saved-views with HTTP 500)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Block pattern: *localhost:3000/api/saved-views
- View name: UI failing view <date-time>

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Viewer: E-mail address viewer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Click "Views" and wait until the list is loaded. | The panel shows "Your views" and "Save current view…". |
| 3 | Now enable request blocking for *localhost:3000/api/saved-views. | The pattern is listed and ticked. |
| 4 | Click "Save current view…", type "UI failing view <date-time>" and click "Save". | An error toast appears (automated test with a 500 answer: "Internal server error"); the view is not saved. |
| 5 | Look at the views list. | No view named "UI failing view <date-time>" is listed. |

**After the test:** Remove the blocking pattern; if the view was saved anyway, delete it.

**Notes:** Requires DevTools: open Chrome DevTools > Network > Network request blocking (More tools > Network request blocking), tick "Enable network request blocking" and add the pattern given in the steps. The automated test fails only the POST with HTTP 500; DevTools blocking also blocks reading the list, so enable it only after the panel has loaded.

*Automated:* `tests/e2e/compare/compare-and-views.spec.ts › Saved views › VIEW-04 a failed save is reported and nothing is listed`

### TC-DASH-072: Saved view round trip on the overview: save, change the choices, apply, delete

**Type:** Positive · **Priority:** Medium · **Role:** Software engineer · **Flow:** F5.10, F7.11

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- View name: E2E view <date-time>

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Software engineer: E-mail address engineer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Click the filter "Needs attention <n>" and the layout button "List". | The list shows teams needing attention in list layout. |
| 3 | Click "Views", then "Save current view…", type "E2E view <date-time>" and click "Save". | The views button shows "E2E view <date-time>". |
| 4 | Press Escape, click "All <n>" and the layout button "Grid". | All teams in grid layout are shown; the views button no longer shows the view name (shows "Views"). |
| 5 | Click "Views" and click "E2E view <date-time>". | The views button shows the view name again, the "Needs attention" filter and the "List" layout are selected. |
| 6 | Click "Views" and click the Delete icon of "E2E view <date-time>"; confirm the browser dialog. | The view disappears from the list. |

*Automated:* `tests/e2e/compare-views-onboarding.spec.ts › Compare teams, saved views, CSV export, onboarding › Saved view round trip on the dashboard`

## CSV export

### TC-DASH-073: CSV download from the overview and from the team comparison

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F5.8, F7.5, F7.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- A text editor or spreadsheet program to open the CSV files

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | In the team toolbar click "Export CSV". | A file named irongate-team-performance-YYYY-MM-DD.csv (today's date) is downloaded. |
| 3 | Open the file in a text editor. | The first line starts with the columns Team,Department,QA score,QA score (raw). |
| 4 | Open http://localhost:5173/compare. | Two team cards are shown. |
| 5 | Click "Export CSV" on the Compare teams page. | A file named irongate-team-comparison-<...>.csv is downloaded. |
| 6 | Open the comparison file in a text editor. | The first line starts with Team,Department,Group,Metric,Value,Value (raw); the file has more than 20 lines; it contains no e-mail addresses. |

**After the test:** Delete the downloaded files.

*Automated:* `tests/e2e/compare-views-onboarding.spec.ts › Compare teams, saved views, CSV export, onboarding › CSV download from the dashboard and the comparison`

## Onboarding

### TC-DASH-074: Onboarding checklist shows progress from the real state; it can be hidden and shown again

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F9.1, F9.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded
- The organisation's onboarding checklist is not yet complete and not hidden (otherwise this case is Not applicable / skipped)
- An API client to restore the checklist afterwards (no UI for it)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look at the top of the Overview. | The card "Set up your organisation" is shown with "<x> of <y> steps done · each step ticks itself when the work is done" and a progress bar. |
| 3 | Check each listed step against the real state of the organisation (e.g. teams exist, people invited, data received). | Steps already done show a green tick; steps not done show an empty circle; <x> equals the number of ticked steps. |
| 4 | Click "Hide" on the checklist. | The checklist disappears and a toast says "Checklist hidden. The remaining steps stay available from each page." |
| 5 | Reload the page. | The Overview is shown without the checklist. |
| 6 | With an API client and the super admin's session cookie send POST http://localhost:3000/api/onboarding/restore, then reload the Overview. | The checklist "Set up your organisation" is shown again. |

**After the test:** Make sure the checklist is restored (last step).

**Notes:** The automated test skips itself when the checklist is already complete or hidden. Requires an API client (e.g. Postman, curl or Insomnia) using the signed-in session cookie copied from DevTools > Application > Cookies for localhost.

*Automated:* `tests/e2e/compare-views-onboarding.spec.ts › Compare teams, saved views, CSV export, onboarding › Onboarding checklist: progress from the real state, hide and show again`

### TC-DASH-075: The onboarding checklist is not shown to a manager

**Type:** Negative · **Priority:** Medium · **Role:** Manager · **Flow:** F9.1

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Manager: E-mail address manager@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Wait until the team cards are shown and look at the whole Overview. | There is no "Set up your organisation" checklist. |

*Automated:* `tests/e2e/compare-views-onboarding.spec.ts › Compare teams, saved views, CSV export, onboarding › Onboarding checklist is not shown to a QA manager`

### TC-ADM-008: The onboarding checklist follows the real state as a new organisation is set up

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F9.1

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test: on the sign-in page click 'Create an account', fill First name 'Uitest', Last name 'Owner', Email 'owner@<unique>.uitest.example', Organisation name 'UI Test <unique>', First department 'Engineering', First team 'Core Team', Password and Confirm password 'Ui-Tests-Passw0rd!', and click 'Create account'. Its first user is its super admin.

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Invitee e-mail: onb-<unique>@<unique>.uitest.example (same domain)
- Invitee role: Viewer

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin. | The Overview shows the card 'Set up your organisation' with '2 of 5 steps done'. |
| 2 | Look at the five steps of the checklist. | 'Create departments' (1 department) and 'Add teams' (1 active team) have a green tick and no button. 'Invite people', 'Set KPI targets' and 'Send the first data' have an empty circle and a button each ('Invite people', 'Open Parameters', 'Create an API key'). |
| 3 | Click the 'Invite people' button of the 'Invite people' step. | The Users page opens (top bar title 'Users'). |
| 4 | Click 'Invite'. | The dialog 'Invite a person' opens with Email address and Role fields. |
| 5 | Enter the invitee e-mail, choose Role 'Viewer' and click 'Send invitation'. | The dialog shows the invitation result with an invitation link field (if e-mail is not configured: 'No email was sent. … Send this link to <e-mail> yourself; it works once.'). |
| 6 | Click 'Done'. | The dialog closes. |
| 7 | Open the navigation and choose Overview. | The 'Invite people' step now has a green tick ('1 person or invitation') and the progress reads '3 of 5 steps done'. |

**After the test:** The test organisation cannot be deleted from the UI: ask a developer to remove it from the test database, or use a disposable environment (the automated test deletes it).

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Onboarding, API keys and ingestion › ONB-01 the checklist follows the real state as the organisation is set up`

### TC-ADM-009: Hiding the onboarding checklist keeps it hidden after a reload

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F9.2

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions); its checklist is still shown.

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin. | The Overview shows the card 'Set up your organisation' with a 'Hide' button at its top right. |
| 2 | Click 'Hide'. | A toast 'Checklist hidden. The remaining steps stay available from each page.' appears and the checklist card disappears. |
| 3 | Reload the page. | The Overview loads without the 'Set up your organisation' card. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Onboarding, API keys and ingestion › ONB-02 hiding the checklist and showing it again`

## KPI targets and ingestion log

### TC-DASH-076: The overview and the team detail say what the QA score is based on

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F5.2

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Super admin: E-mail address admin@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Look under the company QA score at the top of the Overview. | A note "Based on <n> of <m> teams" is shown (with a confidence level). |
| 3 | Click the first team card. | The team detail page opens. |
| 4 | Look under the QA score tile of the team. | If a confidence note is shown it reads "Based on <n> of 4 inputs". |

*Automated:* `tests/e2e/metrics-quality.spec.ts › Confidence, KPI targets and the ingestion log › The dashboard and team detail say what the QA score is based on`

### TC-DASH-077: Parameters shows the KPI targets with their history

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.4

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123), then open http://localhost:5173/parameters-config. | Sign-in succeeds and the page at /parameters-config opens inside the app frame. |
| 2 | Look at the page. | The top bar title is "Parameters" and a card "KPI targets" is shown. |
| 3 | Look at the KPI targets table. | A row for Test coverage is shown with its target (good) and watch levels; the button "Target history at this level (<n>)" is available. |

*Automated:* `tests/e2e/metrics-quality.spec.ts › Confidence, KPI targets and the ingestion log › Parameters shows KPI targets with their history`

### TC-DASH-078: A manager has the Ingestion log in the navigation and can open it

**Type:** Positive · **Priority:** Medium · **Role:** Manager · **Flow:** F8.8

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Manager: E-mail address manager@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Open the navigation menu. | The entry "Ingestion log" is shown. |
| 3 | Click "Ingestion log". | The Ingestion log page opens (top bar and page heading "Ingestion log"). |

*Automated:* `tests/e2e/metrics-quality.spec.ts › Confidence, KPI targets and the ingestion log › Ingestion log is in the navigation for super admins and QA managers only`

### TC-DASH-079: A software engineer has no Ingestion log; its address redirects to the overview

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F8.8, F4.3

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173/ and sign in as Software engineer: E-mail address engineer@irongate.com, Password demo123, click Sign in. | The Overview page opens (top bar title "Overview") with a greeting "Good morning / afternoon / evening, <first name>". |
| 2 | Open the navigation menu. | There is no "Ingestion log" entry. |
| 3 | Type http://localhost:5173/ingestion-log into the address bar and press Enter. | The Overview is shown and the address changes to / (no ingestion data shown), with the alert "You don't have access to Ingestion log." |

**Notes:** Access control check. The overview shows "You don't have access to <page>." after the redirect (FI-14, fixed).

*Automated:* `tests/e2e/metrics-quality.spec.ts › Confidence, KPI targets and the ingestion log › An engineer has no Ingestion log`

## Executive summary

### TC-DASH-100: Executive summary on a phone: the company in one screen

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F6.19

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | On a phone (or DevTools device mode 390×844), sign in as Super admin (admin@irongate.com / demo123) and open http://localhost:5173/summary. | The top bar reads "Summary"; the page shows "Executive summary", the company name and "<n> teams · whole company". |
| 2 | Read the first card. | The company QA score as a battery (or gauge, as chosen in Appearance), the number out of 100, its status (On target / Watch / Off target), "Target ≥ 85", the change since last week and the teams on track / at risk / off track. |
| 3 | Read the two tiles below. | "Open alerts" with the number (and how many are critical) and "Money at risk" with a range per month. |
| 4 | Scroll down. | "Since last week" (QA score, teams up / down, status changes, alerts, tracked actions), "Biggest risks" (at most 3 teams, each item with its value, target and change), "Most improved" (at most 3), "Money at risk" and "All <n> teams". |
| 5 | Swipe sideways. | The page does not scroll sideways; every button and link is easy to tap. |

*Automated:* `tests/e2e/summary/executive-summary.spec.ts › SUMUI-01`

### TC-DASH-101: Manager sees the summary of their department; software engineer of their team without money

**Type:** Positive · **Priority:** High · **Role:** Manager, Software engineer · **Flow:** F6.19

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123), open the navigation and click "Executive summary". | The summary opens with the title "DevOps" and "your departments"; every team in "All teams" belongs to DevOps. |
| 2 | Sign out, sign in as Software engineer (engineer@irongate.com / demo123) and open the navigation. | There is no "Executive summary" entry. |
| 3 | Open http://localhost:5173/summary. | The summary of "Mavericks" opens; "Money at risk" says it is shown to super admins and managers, with a link to Business impact. |

*Automated:* `tests/e2e/summary/executive-summary.spec.ts › SUMUI-02, SUMUI-03`

### TC-DASH-102: Executive summary keeps the last copy offline and reloads on its own

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F6.20

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123) and open http://localhost:5173/summary. | "Loaded today at <time>" is shown under the title. |
| 2 | In DevTools set Network throttling to Offline, then click "Reload". | "Offline · showing the summary loaded today at <time>"; the figures stay on screen. |
| 3 | Reload the browser page (still offline, the app files cached) or reopen the page from the history. | The last summary is shown again with the same Offline message. |
| 4 | Set Network throttling back to No throttling. | Within seconds the line reads "Loaded today at <new time>" without any click. |

**Notes:** The copy is kept per person in this browser and removed at sign-out.

*Automated:* `tests/e2e/summary/executive-summary.spec.ts › SUMUI-04, SUMUI-05`

### TC-DASH-103: Executive summary: share link and money at risk assumptions

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F6.19, F6.20

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) on a desktop and open http://localhost:5173/summary. | The summary is shown in two or three columns. |
| 2 | Click "Share link". | "Summary link copied…" is shown; the clipboard holds http://localhost:5173/summary (on a phone the share sheet opens instead). |
| 3 | In "Money at risk", open "How these are estimated". | The method and the caveats of Business impact are listed; the amounts are ranges, never single exact figures. |
| 4 | Click "Assumptions and team figures". | Business impact opens on the "All teams" tab (the revenue roll-up with each team's figures). |

*Automated:* `tests/e2e/summary/executive-summary.spec.ts › SUMUI-06, SUMUI-10`

### TC-DASH-104: Executive summary is readable in every theme and score display

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F6.20

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin on a phone-sized window and open http://localhost:5173/summary. | The summary is shown. |
| 2 | In Appearance choose Light, Dark, Graphite and Porcelain in turn, each with Battery and Gauge. | Every text is readable in every theme; the score is drawn as the chosen battery or gauge. |

*Automated:* `tests/e2e/summary/executive-summary.spec.ts › SUMUI-11, A11Y-30 … 33`

## Team improve (forecasts and recommendations)

### TC-DASH-105: Each KPI tile shows a Forecast line and its trend chart the projected band

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.21

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123). On the Overview type "The Away Team" in "Search teams" and click its team card. | Team detail of "The Away Team" opens; below the KPI tiles the section "Recommendations" is shown, followed by "Action plan". |
| 2 | Scroll to "Quality & testing" and read the tile "Test coverage". | Under the change line it reads "Forecast: …" with one of: "Misses target ≥ 80% around <day month>", "Reaches target …", "On track: stays ≥ 80% (about … by …)", "Stays off target ≥ 80%: about …% by …", or "not enough data (<reason>)". |
| 3 | Look at the chart of the same tile. | After the history the chart continues as a dashed line with a shaded band for 8 weeks; the target is a dashed horizontal line; when the forecast crosses the target a dotted vertical line marks the day. |
| 4 | Hover over a point of the dashed part. | The tooltip shows the date and "Forecast" with a value, and "Forecast band" with a range. |
| 5 | Read the QA score card at the top. | It also has a "Forecast:" line, and the small trend says "Dashed line: target 85 · shaded: forecast". |

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-01`

### TC-DASH-106: Recommendations are ranked, top 3 visible, the rest collapsed, each with evidence, next step, expected effect and confidence

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.22

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123). On the Overview type "The Away Team" in "Search teams" and click its team card. | Team detail of "The Away Team" opens; below the KPI tiles the section "Recommendations" is shown, followed by "Action plan". |
| 2 | Read the heading of the Recommendations section. | "Recommendations (N)" with N between 1 and 6; the three highest ranked show numbers 1, 2, 3. |
| 3 | Read recommendation 1. | It shows a title with the numbers it is based on, a confidence badge (High / Medium / Low), "Metric: …", "Expected effect: <metric> <range> (to <range>) in <weeks>" with "Based on …" below it, and "Next step: …". |
| 4 | Click "Evidence (n)" of recommendation 1. | A list of the numbers behind it opens (e.g. the metric now and 12 weeks ago, the forecast); for flaky tests, coverage or stages the tests, files or stages are named with their counts. |
| 5 | If N is more than 3, click "More recommendations". | The remaining recommendations open below, numbered 4 onwards. |

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-02`

### TC-DASH-107: Add to Action plan creates a tracked action linked to the recommendation and its metric

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.23

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123). On the Overview type "The Away Team" in "Search teams" and click its team card. | Team detail of "The Away Team" opens; below the KPI tiles the section "Recommendations" is shown, followed by "Action plan". |
| 2 | Note the title of recommendation 1 and click its "Add to Action plan". | A message "Added to the Action plan; its outcome is measured on …" appears; the recommendation leaves the top list and "Added to the Action plan or dismissed (1)" appears. |
| 3 | Open "Added to the Action plan or dismissed". | The recommendation shows "In the Action plan: <title> · Open · unassigned" and "Since it was added: <metric> <value> (<day>) → no newer snapshot" with "No new data yet". |
| 4 | In the Action plan, find the action with the same title. | It is Open, says "from the recommendation above", its linked KPI line shows the baseline (the value when it was added), and its description starts with "Next step:". |
| 5 | Change the action's status to "In progress". | The recommendation now shows "· In progress". |

**Notes:** Clean up: delete the action (Action plan → bin icon); the recommendation can then be reopened.

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-03`

### TC-DASH-108: A recommended action later shows whether its metric moved, with the dates

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F6.23

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123). On the Overview type "The Away Team" in "Search teams" and click its team card. | Team detail of "The Away Team" opens; below the KPI tiles the section "Recommendations" is shown, followed by "Action plan". |
| 2 | Take an action created from a recommendation at least one day ago (or create one and come back the next day after new values arrived). | Under its KPI line it reads "Since it was added: <metric> <before> (<day>) → <after> (<day>)" with Improved, Unchanged or Worse. |
| 3 | Compare the two values with the KPI history of that metric on the same days. | Before is the team's snapshot on the day the action was created, after is the latest snapshot; the verdict follows the metric's direction (2 % of the baseline counts as unchanged). |

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-04`

### TC-DASH-109: Dismiss needs a reason, shows who and why, and can be reopened

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.24

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123). On the Overview type "The Away Team" in "Search teams" and click its team card. | Team detail of "The Away Team" opens; below the KPI tiles the section "Recommendations" is shown, followed by "Action plan". |
| 2 | Click "Dismiss" on recommendation 1. | A dialog "Dismiss recommendation" shows its title and reasons: Not relevant for this team, Already being handled, The data is wrong, Not now (later), Other. |
| 3 | Choose "Other", leave the text empty and click "Dismiss". | The dialog stays open: a reason is required for Other. |
| 4 | Choose "Already being handled", type "platform team" in Note and click "Dismiss". | "Recommendation dismissed"; it leaves the top list. |
| 5 | Open "Added to the Action plan or dismissed". | It reads "Dismissed by <your name> on <day month>: Already being handled: platform team" and has a "Reopen" button. |
| 6 | Click "Reopen". | "Recommendation reopened"; it is back in the list. |

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-05`

### TC-DASH-110: A software engineer sees the recommendations but cannot act on them; another team's are refused

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F6.22, F15.1

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as engineer@irongate.com / demo123 and open your team "Mavericks" from the Overview. | The Recommendations section is shown with the forecasts on the KPI tiles. |
| 2 | Look for buttons on the recommendations. | There is no "Add to Action plan", "Dismiss" or "Recalculate"; "Evidence" still opens. |
| 3 | In the browser open http://localhost:3000/api/improve/teams/team-1764026236967-uphpblii4 (QualityCowboys, not your team). | 403 with "Access denied. This team is outside your analytics scope." |

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-06`

### TC-DASH-111: Recalculate keeps the decisions and the recommendations fit a phone

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F6.22, F4.10

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as admin@irongate.com / demo123 and open "The Away Team". | Team detail opens with Recommendations. |
| 2 | Click "Recalculate". | "Forecasts and recommendations recalculated"; the footnote shows the new calculation time; accepted and dismissed ones stay as they were. |
| 3 | In DevTools set the size to 390 x 844 and scroll to Recommendations; open Evidence of the first one. | Everything fits the width (no sideways scrolling); the buttons are full size and below the text. |

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-07, IMP-08`

### TC-DASH-112: Executive summary: risks say what happens at this rate; KPIs forecast to miss are listed

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F6.25

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as admin@irongate.com / demo123 and open http://localhost:5173/summary. | The executive summary opens. |
| 2 | Read the cards under "Biggest risks". | Where a forecast exists, a line under the KPI reads "At this rate <metric> stays off target: about … by … (target …)", "… misses its target … around …" or "… reaches its target … around …". |
| 3 | Look for the section "At this rate". | When a team's KPI is on target now but forecast to miss it within 8 weeks, it is listed with the team and "At this rate … misses its target … around <day>", soonest first. Without such KPIs the section is not shown. |

*Automated:* `tests/e2e/team/improve.spec.ts › IMP-09`

### TC-DASH-113: Recommendations and forecasts are readable in all four themes

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F15.1, F6.22

**Preconditions**

- App running at the test URL (http://localhost:5173, API at http://localhost:3000/api) with the NovaTech demo data loaded

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123). On the Overview type "The Away Team" in "Search teams" and click its team card. | Team detail of "The Away Team" opens; below the KPI tiles the section "Recommendations" is shown, followed by "Action plan". |
| 2 | With Appearance set to Light, Dark, Graphite and Porcelain in turn, read the Recommendations section and a KPI tile's Forecast line. | All text is readable (sufficient contrast), badges and buttons are visible, the shaded forecast band is visible but lighter than the history. |

*Automated:* `tests/e2e/team/improve.spec.ts › A11Y-42 … A11Y-45`

## Administration: manual metrics

### TC-ADM-001: A team lead sees only the teams they lead in Manual metrics and saves a test coverage value

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F8.1

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173) with the API and the NovaTech demo data.
- A dedicated test team exists in the DevOps department (e.g. 'Manual MM Team') with one software engineer member and a team lead who leads ONLY this team. A super admin (admin@irongate.com / demo123) can set this up under Teams / Users (invite the lead with role Team lead on that team). The automated test creates such a team with a generated lead whose password is demo123.
- You know the test team lead's e-mail and password.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123 (or the password set for the lead)
- Lines Executed by Tests: 850
- Total Lines of Code: 1000

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app and sign in with the test team lead's e-mail and password. | The Overview page opens; the top bar shows the burger menu button. |
| 2 | Open the navigation (burger button at the top left) and choose Manual metrics (or open /manual-metrics). | The page 'Manual metrics' opens. The 'Save team metrics' button at the top is disabled. |
| 3 | Open the 'Select Team' dropdown and look at the entries. | There are exactly two entries: '-- Select a team --' and the test team (shown as '<team name> (DevOps)'). No other team (e.g. The Away Team, Mavericks) is offered. |
| 4 | Select the test team. | A section 'Current Metrics for <team name>' appears below the date field. |
| 5 | In the 'Test Coverage' card enter 850 in 'Lines Executed by Tests' and 1000 in 'Total Lines of Code'. | The card shows the Result 85.00%; a 'Calculated Metrics (1)' summary appears; 'Save team metrics' becomes enabled. |
| 6 | Click 'Save team metrics'. | A success dialog titled 'Team Metrics Saved' appears with '<team name> metrics saved successfully' and a 'QA Score:' line. |
| 7 | Click OK. | The dialog closes, the inputs are cleared, and 'Current Metrics for <team name>' now shows Test Coverage 85.00%. |
| 8 | Go to Overview, type the team name in 'Search teams' and open the team card. | Team detail of the test team shows a test coverage value of 85 %. |

**After the test:** Optional: remove the test team and its users when all manual-metrics tests are done.

**Notes:** The automated test checks the stored value in the database; the Team detail check is the visible equivalent.

*Automated:* `tests/e2e/admin/manual-metrics.spec.ts › Manual metrics › MM-01 a team lead sees only the teams they lead and saves a value; the team page shows it`

### TC-ADM-002: Manual metrics: Save stays disabled until a value is entered, and saving without a team is refused

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F8.1

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and its team lead from TC-C-001 exist.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Lines Executed by Tests: 1
- Total Lines of Code: 2

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead and open Manual metrics (/manual-metrics). | The 'Manual metrics' page opens; 'Save team metrics' is disabled. |
| 2 | Make sure 'Select Team' is set to '-- Select a team --'. | No team is selected; no 'Current Metrics for …' section is shown. |
| 3 | In the 'Test Coverage' card enter 1 in 'Lines Executed by Tests' and 2 in 'Total Lines of Code'. | The Result shows 50.00% and 'Save team metrics' becomes enabled. |
| 4 | Click 'Save team metrics'. | A warning dialog titled 'No Team Selected' appears with the text 'Please select a team first'. |
| 5 | Click OK. | The dialog closes; nothing was saved (no success dialog). |

*Automated:* `tests/e2e/admin/manual-metrics.spec.ts › Manual metrics › MM-02 nothing to save: the button stays disabled until a value is entered; no team chosen is refused`

### TC-ADM-003: Manual metrics: a test coverage above 100 % is refused and nothing is stored

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F8.1

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and its team lead from TC-C-001 exist.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Lines Executed by Tests: 1500
- Total Lines of Code: 1000

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, open Manual metrics and select the test team. | 'Current Metrics for <team name>' appears. Note the Test Coverage value shown there (or '—' if none). |
| 2 | In the 'Test Coverage' card enter 1500 in 'Lines Executed by Tests' and 1000 in 'Total Lines of Code'. | The Result shows 150.00%. |
| 3 | Click 'Save team metrics'. | An error dialog titled 'Failed to Save Team Metrics' appears with the server's reason (the value is out of range, e.g. '… must be between 0 and 100'). |
| 4 | Click OK. | The dialog closes. |
| 5 | Reload the page and select the test team again. | The Test Coverage under 'Current Metrics for <team name>' is unchanged from the value noted in step 1 (150 % was not stored). |

*Automated:* `tests/e2e/admin/manual-metrics.spec.ts › Manual metrics › MM-03 a coverage above 100 % is refused and nothing is stored`

### TC-ADM-004: Manual metrics: the date cannot be in the future; values for an earlier day are saved for that day

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F8.2

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and its team lead from TC-C-001 exist.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Date: today minus 3 days (YYYY-MM-DD)
- Lines Executed by Tests: 700
- Total Lines of Code: 1000

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead and open Manual metrics. | The page shows the date field 'Team values are for' with the hint 'Empty or today: the values are for now. Pick an earlier day (up to a year back) to record a past measurement.' |
| 2 | Open the date picker of 'Team values are for' and try to pick tomorrow. | Days after today cannot be selected (the latest selectable day is today). |
| 3 | Select the test team, then set 'Team values are for' to the day three days before today. | The hint changes to 'Saved as values for <that date>: that day's snapshot and the later days without a newer value are updated.' |
| 4 | In the 'Test Coverage' card enter 700 and 1000. | The Result shows 70.00%. |
| 5 | Click 'Save team metrics'. | The dialog 'Team Metrics Saved' appears and its text contains 'saved successfully for <that date>'. |
| 6 | Click OK. | The dialog closes. |

*Automated:* `tests/e2e/admin/manual-metrics.spec.ts › Manual metrics › MM-04 the date cannot be in the future; an earlier day is saved for that day`

### TC-ADM-005: Manual metrics: a server error and an unreachable server are reported

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F8.1

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and its team lead from TC-C-001 exist.
- Browser DevTools available. For part 1 a tool that can answer a request with HTTP 500 is needed (e.g. a mocking proxy such as Fiddler / Charles, or a request-mocking browser extension) configured to answer POST */api/metrics/manual with status 500 and body {"error":"Internal server error","requestId":"rid-mm"}.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Lines Executed by Tests: 800
- Total Lines of Code: 1000

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, open Manual metrics and select the test team. | 'Current Metrics for <team name>' appears. |
| 2 | Turn on the mock that answers POST /api/metrics/manual with HTTP 500 'Internal server error'. | — |
| 3 | Enter 800 and 1000 in the 'Test Coverage' card and click 'Save team metrics'. | An error dialog titled 'Failed to Save Team Metrics' appears with exactly the text 'Internal server error'. |
| 4 | Click OK, then turn the 500 mock off. | The dialog closes; the entered values are still in the card. |
| 5 | In DevTools > Network, block the request URL pattern */api/metrics/manual (Network request blocking), or set the network to Offline. | — |
| 6 | Click 'Save team metrics' again. | A dialog titled 'Error' appears with 'Failed to save team metrics. Check console for details.' |
| 7 | Click OK and remove the blocking / set the network back to Online. | The dialog closes; the page keeps working. |

**After the test:** Remove the request blocking and the mock rule.

**Notes:** Requires DevTools request blocking (unreachable server) and a mocking tool for the HTTP 500 answer.

*Automated:* `tests/e2e/admin/manual-metrics.spec.ts › Manual metrics › MM-05 a server error and an unreachable server are reported`

### TC-ADM-006: Manual metrics: a double click on Save team metrics writes only once

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F8.1

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and its team lead from TC-C-001 exist.
- Browser DevTools open on the Network tab (filter: metrics/manual).

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Lines Executed by Tests: 810
- Total Lines of Code: 1000

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, open Manual metrics and select the test team. | 'Current Metrics for <team name>' appears. |
| 2 | Clear the DevTools Network list. Enter 810 and 1000 in the 'Test Coverage' card. | The Result shows 81.00%. |
| 3 | Double-click 'Save team metrics' quickly. | The button shows 'Saving…' and is disabled during the save; one 'Team Metrics Saved' dialog appears. |
| 4 | Look at the Network tab. | Exactly one POST request to /api/metrics/manual was sent. |
| 5 | Click OK. | The dialog closes; no second dialog appears. |

**Notes:** Requires DevTools Network panel to count the requests.

*Automated:* `tests/e2e/admin/manual-metrics.spec.ts › Manual metrics › MM-06 a double click on Save writes once`

### TC-ADM-007: A team lead cannot write another team's metrics through the API

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F8.1

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and its team lead from TC-C-001 exist.
- Browser DevTools Console (or an HTTP client sending the session cookie) available.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Request: POST <API>/api/metrics/manual (API is http://localhost:3000 locally), JSON body {"teamId":"team-1764026236967-uphpblii4","testCoverage":50}, with credentials included
- Team team-1764026236967-uphpblii4 = QualityCowboys (Payments Processing), outside the lead's scope

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead. | The Overview page opens. |
| 2 | Open DevTools > Console and send a POST request to /api/metrics/manual for team QualityCowboys with test coverage 50, including the sign-in cookie (see Test data). | The request is refused with HTTP status 403 or 404. |
| 3 | As super admin (admin@irongate.com / demo123), open Manual metrics and select QualityCowboys. | Its Test Coverage is not 50.00% from this request (unchanged). |

**Notes:** Requires DevTools Console or an HTTP client; API-level access check.

*Automated:* `tests/e2e/admin/manual-metrics.spec.ts › Manual metrics › MM-07 a lead cannot write another team's metrics through the API`

## API keys and ingestion

### TC-ADM-010: An API key is shown once, sends KPIs that appear in the Ingestion log, and is refused after revoking

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F9.3, F9.4, F9.1, F8.8

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).
- An HTTP client (curl, Postman or similar) that can send a POST request with an Authorization header.
- The id of the team 'Core Team': open it from the Overview, click 'Open TV mode' and read it from the address bar (/tv?team=<id>).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Key name: CI key <unique>
- Request A: POST <API>/api/ingest/kpis, header Authorization: Bearer <key>, JSON body {"teamId":"<Core Team id>","source":"ci","metrics":{"test_coverage":81.5,"defect_escape_rate":3}}
- Request B: same, metrics {"test_coverage":180}
- Request C: same, metrics {"test_coverage":80}

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Admin console (/admin-panel). | The 'API keys' card shows a field with placeholder 'Key name, e.g. Jenkins production' and a 'Create key' button. |
| 2 | Enter the key name and click 'Create key'. | A box shows 'Copy the key for “<key name>” now. It will not be shown again.' with a key that starts with 'igk_'. Copy the key. |
| 3 | With the HTTP client, send Request A using the copied key. | The answer has a 2xx status (written). |
| 4 | Send Request B (test coverage 180). | The answer has status 400 (value out of range rejected). |
| 5 | Back in the app, click 'Done' in the key box. | The box closes and the key text is no longer shown anywhere on the page; the key row is listed with the badge 'Active'. |
| 6 | Open the navigation and choose Ingestion log. | The 'Ingestion log' page lists at least two requests: one with the badge 'Accepted' and one with the badge 'Rejected'. |
| 7 | Open Overview. | The checklist step 'Send the first data' has a green tick ('Data received'). |
| 8 | Open Admin console, and in the key's row click 'Revoke'. | The row shows 'Confirm revoke' and 'Cancel' buttons. |
| 9 | Click 'Cancel'. | The row still shows the badge 'Active'. |
| 10 | Click 'Revoke' again, then 'Confirm revoke'. | The row shows the badge 'Revoked <date and time>'. |
| 11 | Send Request C with the same key. | The answer has status 401 (key refused). |

**After the test:** Remove the test organisation (see TC-C-008).

**Notes:** Requires an HTTP client for the ingestion API calls.

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Onboarding, API keys and ingestion › ING-01 an API key is shown once, sends KPIs, appears in the Ingestion log, and is refused after revoking`

### TC-ADM-011: An API key without a name cannot be created; a manager has no API keys section

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F9.3

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- New organisation super admin: owner@<unique>.uitest.example / Ui-Tests-Passw0rd!
- Key name: three spaces
- Manager: manager@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Admin console (/admin-panel). | The 'API keys' card is shown; with the name field empty, 'Create key' is disabled. |
| 2 | Type three spaces into the field 'Key name, e.g. Jenkins production'. | 'Create key' stays disabled. |
| 3 | Open the navigation and click 'Sign out'. | The 'Sign in' page appears. |
| 4 | Sign in as Manager (manager@irongate.com / demo123) and open Admin console (/admin-panel). | The 'Admin console' page is shown, but there is no API keys section and no 'Key name, e.g. Jenkins production' field. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Onboarding, API keys and ingestion › ING-02 a key without a name cannot be created; a manager has no API keys`

### TC-ADM-012: A manager sees the Ingestion log; a software engineer is refused by the API

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F8.8

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- Browser DevTools Console (or an HTTP client sending the session cookie) available.

**Test data**

- Manager: manager@irongate.com / demo123
- Software engineer: engineer@irongate.com / demo123
- Request: GET <API>/api/ingestion-log with credentials included

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager and open Ingestion log (navigation > Ingestion log, or /ingestion-log). | The 'Ingestion log' page is shown with its description, the Sources card and the filters. |
| 2 | Sign out (navigation > Sign out). | The 'Sign in' page appears. |
| 3 | Sign in as Software engineer. | The Overview opens; the navigation has no 'Ingestion log' entry. |
| 4 | In DevTools > Console send a GET request to /api/ingestion-log with the sign-in cookie. | The answer has HTTP status 403. |

**Notes:** The engineer part requires DevTools Console or an HTTP client.

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Onboarding, API keys and ingestion › ING-03 a manager sees the ingestion log of their departments; an engineer is refused`

## Sample (demo) data

### TC-ADM-013: The Sample data panel says sample data is off on this server and its button is disabled

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F9.5

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The API runs WITHOUT ENABLE_SYNTHETIC_DATA=true (the default).

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin and open Admin console (/admin-panel). | A 'Sample data' card is shown. |
| 2 | Look at the 'Load sample data' button. | The button is disabled. |
| 3 | Read the text below the button. | It says 'Sample data is turned off on this server. Start the API with ENABLE_SYNTHETIC_DATA=true to enable it. It can also be loaded from a terminal with npm run seed:demo.' |

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Sample (demo) data controls › DEMO-01 the panel says sample data is off on this server and the button is disabled`

### TC-ADM-014: When sample data is enabled, loading it reports the result and lists the sample logins

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F9.5

**Preconditions**

- A disposable test environment whose API runs with ENABLE_SYNTHETIC_DATA=true (loading writes a sample company 'Northwind Payments (Sample data)' and may fill teams of your own company that lack data).
- Alternative without such a server: a mocking tool answering GET */api/analytics/seed-data/status with enabled true and POST */api/analytics/seed-data with {"message":"Sample data loaded: 10 teams, 40 users."} (this is what the automated test does).

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin and open Admin console (/admin-panel). | The 'Sample data' card shows an enabled 'Load sample data' button. |
| 2 | Click 'Load sample data'. | The button shows 'Loading sample data…' while it runs. |
| 3 | Wait for it to finish. | A green message appears starting with 'Sample data loaded:' (e.g. 'Sample data loaded: <n> rows for "Northwind Payments (Sample data)".'). |
| 4 | Look below the message. | The text 'Sign out and sign in to the sample company with password demo123:' and a list of sample logins (e-mail addresses such as olivia.bennett@northwind.example) are shown. |
| 5 | Look at the button label. | It now reads 'Load sample data again (adds only missing rows)'. |

**After the test:** The sample company stays in the database; use a disposable environment.

**Notes:** The automated test stubs the server answers because the CI server runs without ENABLE_SYNTHETIC_DATA. Requires a specially configured server or a mocking tool.

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Sample (demo) data controls › DEMO-02 when enabled, loading sample data reports the result and lists the logins (stubbed server)`

### TC-ADM-015: A failure to load sample data is reported

**Type:** Negative · **Priority:** Low · **Role:** Super admin · **Flow:** F9.5

**Preconditions**

- Sample data enabled on the server (see TC-C-014) or the status request mocked as enabled.
- A mocking tool that answers POST */api/analytics/seed-data with HTTP 500 and body {"error":"Seeding failed","requestId":"rid-seed"}. Alternative: after the page has loaded, block the URL pattern */api/analytics/seed-data in DevTools > Network request blocking (then a network error text is shown instead of 'Seeding failed').

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin and open Admin console (/admin-panel). | The 'Sample data' card shows an enabled 'Load sample data' button. |
| 2 | Turn on the failure mock (or the request blocking). | — |
| 3 | Click 'Load sample data'. | A red error message 'Seeding failed' appears in the card (with request blocking: the browser's network error text, e.g. 'Failed to fetch'); no green success message is shown. |

**After the test:** Remove the mock / request blocking.

**Notes:** Requires a mocking tool or DevTools request blocking.

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Sample (demo) data controls › DEMO-03 a failure to load sample data is reported`

### TC-ADM-016: A manager has no sample data controls in the Admin console

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F9.5

**Preconditions**

- App running at the test URL with the NovaTech demo data.

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager and open Admin console (/admin-panel). | The 'Admin console' page is shown. |
| 2 | Look for a 'Sample data' card or a 'Load sample data' button. | Neither is present. |

*Automated:* `tests/e2e/admin/onboarding-and-ingestion.spec.ts › Sample (demo) data controls › DEMO-04 a manager has no sample data controls`

## Administration: KPI targets

### TC-ADM-017: A super admin sets a company-wide test coverage target and it appears in the target history

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F8.4

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Test coverage target: 85
- Test coverage watch level: 75

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Parameters (navigation > Parameters, or /parameters-config). | The page 'System configuration' opens with the Scope card ('Currently editing: Company-wide') and the 'KPI targets' card with a 'Target history at this level (0)' link. |
| 2 | Look at the checkbox 'Apply to every department and team'. | It is ticked by default. |
| 3 | Untick 'Apply to every department and team'. | The checkbox is unticked. |
| 4 | In the 'Test coverage' row enter 85 in the Target field and 75 in the Watch field. | No red message; the KPI targets button reads 'Save 1 change'. |
| 5 | Click 'Save 1 change'. | A toast 'KPI targets saved (Company-wide). Earlier values keep their old targets.' appears; the Target field still shows 85. |
| 6 | Click 'Target history at this level (1)'. | The history lists 'Test coverage  target 85 · watch 75' with the date range ending in 'now'. |
| 7 | Reload the page. | The Test coverage Target field shows 85. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › KPI targets › PAR-01 a super admin sets a company target; it appears in the history`

### TC-ADM-018: The KPI target form requires both values and a watch level on the correct side

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.4

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Target: 80
- Watch: 90

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin, open Parameters and untick 'Apply to every department and team'. | The 'KPI targets' card is shown. |
| 2 | In the 'Test coverage' row enter 80 in Target only. | A red message 'Enter both values, or clear both to inherit' appears in that row and the KPI targets save button is disabled. |
| 3 | Enter 90 in the Watch field. | The message changes to 'Watch level must be at or below the target' and the save button stays disabled. |
| 4 | Clear both the Target and the Watch fields. | The red message disappears and the save button reads 'No changes'. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › KPI targets › PAR-02 the target form checks both values, numbers and the watch side`

### TC-ADM-019: A test coverage target above 100 % is refused by the server with its reason

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.4

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Target: 150
- Watch: 120

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Parameters. Leave 'Apply to every department and team' ticked. | The 'KPI targets' card is shown. |
| 2 | In the 'Test coverage' row enter 150 in Target and 120 in Watch. | No red message in the row; the button reads 'Save 1 change for all departments'. |
| 3 | Click the save button. | An error toast gives the reason, mentioning the allowed range (e.g. 'test_coverage: targets must be between 0 and 100'). |
| 4 | Click 'Target history at this level (0)'. | The text 'No target has been set at this level; the level above applies.' is shown. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › KPI targets › PAR-03 a coverage target above 100 % is refused by the API with its reason`

### TC-ADM-020: "Apply to every department and team" replaces a team's own target

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.4, F8.5

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test with department 'Engineering' and team 'Core Team' (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Team target: 60 / watch 50
- Company target: 90 / watch 80

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Parameters. | Scope shows 'Currently editing: Company-wide'. |
| 2 | In the Scope card choose Department 'Engineering' and Team 'Core Team'. | The text 'Currently editing: Team: Core Team' is shown. |
| 3 | In the 'Test coverage' row enter Target 60 and Watch 50 and click the save button. | A toast starting 'KPI targets saved' appears. |
| 4 | Set Department back to 'All departments (company-wide)'. | 'Apply to every department and team' is shown and ticked. |
| 5 | In the 'Test coverage' row enter Target 90 and Watch 80. | The save button reads 'Save 1 change for all departments'. |
| 6 | Click it. | A toast 'KPI targets saved and applied to every department and team (1 department/team target replaced). Earlier values keep their old targets.' appears. |
| 7 | Untick 'Apply to every department and team', then choose Department 'Engineering' and Team 'Core Team' again. | The Test coverage Target field of the team is empty, and the row shows '≥ 90' as the target in force (inherited). |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › KPI targets › PAR-04 "Apply to every department and team" replaces a team's own target`

### TC-ADM-022: The API refuses a company-level KPI target from a manager

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F8.4

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- Browser DevTools Console (or an HTTP client sending the session cookie) available.

**Test data**

- E-mail: manager@irongate.com
- Password: demo123
- Request: PUT <API>/api/targets, JSON body {"scopeType":"company","scopeId":null,"targets":{"test_coverage":{"good":1,"warning":0}}}, credentials included

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager. | The Overview opens. |
| 2 | In DevTools > Console send the PUT request to /api/targets from Test data. | The answer has HTTP status 403. |
| 3 | Open Parameters. | The company-wide Test coverage target is unchanged (not 1 / 0). |

**Notes:** Requires DevTools Console or an HTTP client.

*Automated:* `tests/e2e/admin/parameters.spec.ts › KPI targets › PAR-06 the API refuses a company target from a manager`

## Administration: parameters

### TC-ADM-021: A manager sees company targets read-only, without 'Apply to all', sign-in or Slack settings

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F8.4, F8.5, F8.6, F1.12, F10.8

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- Browser DevTools open on the Network tab.
- Saving re-sends the current company configuration unchanged; on a shared environment you may block or mock POST */api/admin/configs (the automated test answers it with {"ok":true} so the demo data is not changed).

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager and open Parameters (/parameters-config). | The page 'System configuration' opens with 'Currently editing: Company-wide'. |
| 2 | Look at the Scope card. | There is no 'Apply to every department and team' checkbox. |
| 3 | Look at the Scope card and the 'Save configuration' button. | The note 'Company-wide values are set by super admins. Choose one of your departments or teams to change its values.' is shown and 'Save configuration' is disabled. |
| 4 | Choose one of your departments in the Scope card. | The note disappears and 'Save configuration' is enabled (managers change their departments' and teams' values). |
| 5 | Look at the 'KPI targets' card. | It says 'Company-wide targets are set by super admins. You can view them here.'; the Test coverage Target field is disabled; there is no save button on the card. |
| 6 | Scroll through the rest of the page. | There is no 'Sign-in' card ('Sign-in lasts') and no Slack settings ('Notification channels' / 'Incoming webhook URL'). |

**After the test:** Remove any request blocking or mock.

**Notes:** Covers fixed issue FI-09 (managers were offered 'Apply to every department and team'). Payload check requires DevTools.

*Automated:* `tests/e2e/admin/parameters.spec.ts › KPI targets › PAR-05 a manager sees company targets read-only, no "apply to all", no sign-in or Slack settings`

### TC-ADM-023: Configuration values are saved, inherited fields stay empty, and 'Apply to all' changes the save button

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.6, F8.5

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- P95 response time (ms): 750

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin, open Parameters and untick 'Apply to every department and team'. | The top button reads 'Save configuration'. |
| 2 | In the 'Performance SLA' card enter 750 in 'P95 response time (ms)'. Leave all other fields as they are (empty ones stay empty). | The field shows 750. |
| 3 | Click 'Save configuration'. | A toast 'Configuration saved (Company-wide)' appears. |
| 4 | Reload the page. | 'P95 response time (ms)' shows 750; fields that were empty before are still empty (they inherit). |
| 5 | Tick 'Apply to every department and team'. | The top button now reads 'Save for all departments'. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › Configuration values and sign-in lifetime › PAR-10 configuration values are saved and inherited fields stay empty`

### TC-ADM-024: A negative configuration value is refused by the page and not stored

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.6

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- P95 response time (ms): -5

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin, open Parameters and untick 'Apply to every department and team'. | The 'Performance SLA' card is shown. |
| 2 | Enter -5 in 'P95 response time (ms)'. | The field shows -5. |
| 3 | Click 'Save configuration'. | An error toast 'P95 response time (ms): enter a number of 0 or more, or leave it empty to inherit.' appears; no 'Configuration saved' toast. |
| 4 | Reload the page. | 'P95 response time (ms)' does not show -5. |

**After the test:** Remove the test organisation (see TC-C-008).

**Notes:** Covers FI-10 (page) and FI-10b (fixed): the API refuses the same values; see the next case.

*Automated:* `tests/e2e/admin/parameters.spec.ts › Configuration values and sign-in lifetime › PAR-11 a negative or non-numeric configuration value is not stored`

### TC-ADM-025: A configuration value above its range is refused by the page and by the API

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.6

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Error rate threshold (%): 150

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin, open Parameters and untick 'Apply to every department and team'. | The 'Performance SLA' card is shown. |
| 2 | Enter 150 in 'Error rate threshold (%)' and click 'Save configuration'. | An error toast 'Error rate threshold (%): enter a number from 0 to 100, or leave it empty to inherit.' appears; no 'Configuration saved' toast. |
| 3 | Optional (API client, same session cookie): send POST <API>/admin/configs with {"departmentId":"all","teamId":"all","configs":{"sla_error_rate_percent":"150","sla_response_time_ms":"-5"}}. | Status 400; errors lists 'Error rate threshold (%): enter a number from 0 to 100, …' and 'P95 response time (ms): enter a number of 0 or more, …'. |
| 4 | Reload the page. | 'Error rate threshold (%)' does not show 150. |

**Notes:** FI-10b (fixed): the server applies the page rules (src/lib/configRules.ts). The API step needs an API client.

*Automated:* `tests/e2e/admin/parameters.spec.ts › Configuration values and sign-in lifetime › PAR-14 a configuration value above its range is refused by the page and by the API`

## Administration: update frequency

### TC-ADM-027: Expected update frequency: change, discard, save and reset to default

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F8.7

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- New interval: original value + 2

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Update frequency (navigation > Update frequency, or /metric-intervals). | The page 'Expected update frequency' lists metrics by category, each with an interval number, a unit and a 'Default' badge. |
| 2 | Note the name and interval of the first metric in the list, then increase its interval by 2. | A 'Discard changes' button appears next to 'Save changes'. |
| 3 | Click 'Discard changes'. | The interval shows the original value again. |
| 4 | Increase the same interval by 2 again and click 'Save changes'. | A toast 'Expected update frequencies saved' appears and the metric's badge changes to 'Custom'. |
| 5 | Click the reset button (circular arrow, tooltip 'Reset to default') in that metric's row. | A toast 'Reset to default' appears and the badge is 'Default' again with the original interval. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › Configuration values and sign-in lifetime › PAR-13 expected update frequency: change, discard, save and reset to default`

## Alerts and notifications

### TC-ADM-028: A super admin switches the 'Metric stale' alert rule off for the company and back on

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F10.6

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin, open Parameters and scroll to the 'Alert rules' card. | The rule 'Metric stale' has its switch On; the card's button reads 'No changes'. |
| 2 | Click the 'Metric stale' switch. | The switch shows 'Off' and the button reads 'Save 1 change'. |
| 3 | Click 'Save 1 change'. | A toast 'Alert rules saved (Company-wide)' appears. |
| 4 | Reload the page. | The 'Metric stale' rule shows 'Off'. |
| 5 | Click the 'Metric stale' switch again and click the save button. | The switch shows 'On' and the toast 'Alert rules saved (Company-wide)' appears. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › Alert rules, Slack and the digest › ALR-01 a super admin switches an alert rule off for the company and back`

### TC-ADM-029: A team's alert rule inherits until 'Inherit' is unticked

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F10.6

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test with department 'Engineering' and team 'Core Team' (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open Parameters. | The 'Alert rules' card is shown. |
| 2 | In the Scope card choose Department 'Engineering' and Team 'Core Team'. | 'Currently editing: Team: Core Team' is shown. |
| 3 | Look at the rule 'QA score drop'. | It shows a badge starting with 'From' (e.g. 'From default' or 'From company'), its 'Inherit' checkbox is ticked and its on/off switch is disabled. |
| 4 | Untick 'Inherit' for 'QA score drop'. | The on/off switch and its parameter fields become enabled. |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › Alert rules, Slack and the digest › ALR-02 a team rule inherits until "inherit" is unticked`

### TC-ADM-030: Slack: a non-Slack webhook is refused; a valid one is stored masked, tested and removed

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F10.8

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).
- A webhook receiver: either a real Slack incoming webhook of a test workspace (https://hooks.slack.com/services/…), or a local HTTP receiver (e.g. a request catcher on http://127.0.0.1:<port>) with the API started with NOTIFY_SLACK_ALLOW_LOCAL=true (never in production).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!
- Invalid URL: https://evil.example/hooks/abc
- Valid URL: your Slack test webhook, or http://127.0.0.1:<port>/services/UITEST/secretvalue1234

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin, open Parameters and scroll to 'Notification channels' > Slack. | The 'Incoming webhook URL' field is a masked (password) field with placeholder 'https://hooks.slack.com/services/…'. |
| 2 | Enter the invalid URL and click 'Save Slack settings'. | An error toast 'Enter a Slack incoming webhook URL (https://hooks.slack.com/services/…)' appears. |
| 3 | Replace it with the valid URL and click 'Save Slack settings'. | A toast 'Slack settings saved' appears; the field is emptied and its placeholder starts with 'Configured: ' (a short hint only, '(enter a new one to replace)'). |
| 4 | Use the browser's View page source / Inspect search for the secret part of the URL (e.g. 'secretvalue'). | The secret part of the webhook URL is not found anywhere on the page. |
| 5 | Click 'Send test message'. | The receiver (Slack channel or local catcher) gets a test message; the page reports the result (e.g. 'Test message posted to Slack'). |
| 6 | Click 'Remove webhook'. | A toast 'Slack webhook removed' appears and the field's placeholder is 'https://hooks.slack.com/services/…' again. |

**After the test:** Stop the local receiver if used; remove the test organisation (see TC-C-008).

**Notes:** Requires a Slack test webhook or a local receiver with NOTIFY_SLACK_ALLOW_LOCAL=true.

*Automated:* `tests/e2e/admin/parameters.spec.ts › Alert rules, Slack and the digest › SLK-01 Slack: a webhook that is not Slack is refused; a valid one is stored masked, tested and removed`

### TC-ADM-031: 'Evaluate alerts now' and the test digest report what they did

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F10.7, F10.5

**Preconditions**

- App running at the test URL.
- A brand-new organisation registered for this test (see TC-C-008 preconditions).

**Test data**

- E-mail: owner@<unique>.uitest.example
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin, open Parameters and scroll to 'Notification channels' > 'Email and the weekly digest'. | The buttons 'Send test digest to me' and 'Evaluate alerts now' are shown. |
| 2 | Click 'Evaluate alerts now'. | The button shows 'Evaluating…', then a message in the form 'Evaluated <n> teams: <x> opened, <y> resolved, <z> still open.' appears. |
| 3 | Click 'Send test digest to me'. | A message about the digest appears: 'Test digest sent to <your e-mail>' or, when e-mail is not configured, 'Email is not configured on this server (RESEND_API_KEY or SMTP_HOST is not set): the digest was written to the server log instead.' |

**After the test:** Remove the test organisation (see TC-C-008).

*Automated:* `tests/e2e/admin/parameters.spec.ts › Alert rules, Slack and the digest › DIG-01 "Evaluate alerts now" and the test digest report what they did`

### TC-ADM-032: A team lead can send themselves a test digest; a software engineer has no digest option

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F10.5

**Preconditions**

- App running at the test URL with the NovaTech demo data.

**Test data**

- Team lead: lead@irongate.com / demo123
- Software engineer: engineer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead and open Notifications > Preferences (/notifications?tab=preferences). | The preferences show 'Send me the weekly digest' and a 'Send me a test digest' button. |
| 2 | Click 'Send me a test digest'. | A message about the digest appears next to the button (e.g. 'Test digest sent to lead@irongate.com' or the 'Email is not configured on this server … the digest was written to the server log instead.' note). |
| 3 | Sign out and sign in as Software engineer, then open Notifications > Preferences. | The notification preferences are shown. |
| 4 | Look for the digest option. | There is no 'Send me the weekly digest' switch and no test digest button; the text 'The weekly digest is sent to super admins, managers and team leads.' is shown. |

*Automated:* `tests/e2e/admin/parameters.spec.ts › Alert rules, Slack and the digest › DIG-02 a team lead can send themselves a test digest; an engineer has no digest`

### TC-ADM-033: Notification preferences: nothing to save until something changes; a failed save is reported

**Type:** Negative · **Priority:** Medium · **Role:** Viewer · **Flow:** F10.4

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- A mocking tool that answers PUT */api/notifications/preferences with HTTP 500 and body {"error":"Internal server error","requestId":"rid-prefs"} (GET requests must pass through). Alternative: block the URL in DevTools > Network request blocking AFTER the page has loaded (then a network error text is shown instead).

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Tell me about: Critical only

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer and open Notifications > Preferences (/notifications?tab=preferences). | The preferences are shown; the 'Save' button is disabled. |
| 2 | Change 'Tell me about' to 'Critical only'. | The 'Save' button becomes enabled. |
| 3 | Turn on the failure mock, then click 'Save'. | An error toast 'Internal server error' appears (no 'Notification preferences saved'). |
| 4 | Turn the mock off and reload the page. | 'Tell me about' shows its previous value (the change was not stored). |

**After the test:** Remove the mock / request blocking.

**Notes:** Requires a mocking tool (or DevTools request blocking as an approximation).

*Automated:* `tests/e2e/admin/parameters.spec.ts › Alert rules, Slack and the digest › DIG-03 notification preferences: nothing to save until something changes; a failed save is reported`

### TC-ADM-039: A software engineer cannot acknowledge an alert, even through the API

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F10.2

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- At least one open, unacknowledged alert exists in NovaTech. Find its id as super admin: Notifications > Alerts, with DevTools > Network open, and read the id from the alerts response.
- Browser DevTools Console (or an HTTP client sending the session cookie) available.

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Request: POST <API>/api/alerts/<alert id>/acknowledge, credentials included

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer. | The Overview opens. |
| 2 | In DevTools > Console send the POST acknowledge request for the alert id. | The answer has HTTP status 403 or 404. |
| 3 | Sign in as super admin and open Notifications > Alerts. | The alert is still open (not 'Acknowledged'). |

**Notes:** The automated test is skipped when the demo data has no open alert ('No open alert in the demo data to try with.'). Requires DevTools Console or an HTTP client.

*Automated:* `tests/e2e/alerts/actions.spec.ts › Tracked actions › ALT-01 alerts cannot be acknowledged by an engineer even through the API`

### TC-ADM-044: A team lead sees a new alert in the bell, marks everything read and acknowledges the alert

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F4.13, F10.1, F10.2, F10.3

**Preconditions**

- App running at the test URL with the NovaTech demo data (lead@irongate.com leads The Away Team).
- Changing The Away Team's defect escape rate is acceptable in this environment (it is set back at the end).

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- On target: Production Bugs 1, Total Bugs Found 50 (2 %)
- Off target: Production Bugs 27, Total Bugs Found 100 (27 %)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead via the sign-in form. Open Manual metrics, select The Away Team, enter 1 and 50 in the 'Defect Escape Rate' card and click 'Save team metrics', then OK. | 'Team Metrics Saved' appears (value on target; any open escape-rate alert is resolved). |
| 2 | Click the notifications bell in the top bar and click 'Mark all read'; close the panel with Escape. | The bell shows no red unread count. |
| 3 | In Manual metrics enter 27 and 100 in the 'Defect Escape Rate' card and save, then OK. | 'Team Metrics Saved' appears. |
| 4 | Open the Overview and reload the page. | Within about 15 seconds the bell shows a red unread count. |
| 5 | Click the bell. | The 'Notifications' panel opens; the first item mentions The Away Team. |
| 6 | Click 'Mark all read'. | The red unread count on the bell disappears. |
| 7 | Press Escape. | The panel closes. |
| 8 | Click the bell again and click 'All alerts'. | The Notifications page opens on the Alerts tab (tiles 'Open alerts', 'Critical', 'Warning', 'Acknowledged'). |
| 9 | Find the alert row mentioning 'Defect escape rate' and click its 'Acknowledge' button. | A toast 'Alert acknowledged' appears. |

**After the test:** In Manual metrics set The Away Team's Defect Escape Rate back on target (1 of 50 = 2 %), which resolves the alert.

**Notes:** The automated test writes the values through the API (POST /api/metrics/manual); Manual metrics is the UI equivalent.

*Automated:* `tests/e2e/alerts-actions.spec.ts › Alerts, notifications and tracked actions › A team lead sees a new alert in the bell, can open the panel and mark everything read`

### TC-ADM-045: Notification preferences can be changed and saved

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F10.4, F10.5

**Preconditions**

- App running at the test URL with the NovaTech demo data.

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead and open Notifications > Preferences (/notifications?tab=preferences). | The preferences are shown with the switches 'In the app (bell)' and 'Email for each alert'. |
| 2 | Note the state of 'Email for each alert' and click it. | The switch flips; 'Save' becomes enabled. |
| 3 | Click 'Save'. | A toast 'Notification preferences saved' appears. |
| 4 | Click 'Email for each alert' again and click 'Save'. | The switch is back in its original state and the change is saved. |
| 5 | Look at the digest section. | The 'Send me a test digest' button is shown. |

*Automated:* `tests/e2e/alerts-actions.spec.ts › Alerts, notifications and tracked actions › Notification preferences can be changed and saved`

### TC-ADM-046: A software engineer has no digest option and cannot acknowledge alerts

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F10.2, F10.5

**Preconditions**

- App running at the test URL with the NovaTech demo data.

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer and open Notifications > Preferences (/notifications?tab=preferences). | The notification preferences are shown. |
| 2 | Look for the test digest button. | There is no 'Send me a test digest' button. |
| 3 | Open the Alerts tab (/notifications). | The Alerts tab is shown with its tiles and list. |
| 4 | Look at every alert row. | No row has an 'Acknowledge' button. |

*Automated:* `tests/e2e/alerts-actions.spec.ts › Alerts, notifications and tracked actions › An engineer has no digest option and cannot acknowledge alerts`

### TC-ADM-047: Parameters shows the alert rules and, for super admins, the Slack settings with a masked webhook field

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F10.6, F10.8

**Preconditions**

- App running at the test URL with the NovaTech demo data.

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin and open Parameters (/parameters-config). | The page 'System configuration' opens. |
| 2 | Scroll to the 'Alert rules' card. | The card lists the rule 'KPI off target' (among 'Metric stale', 'QA score drop', 'Ingestion failures'). |
| 3 | Scroll to 'Notification channels'. | A 'Slack' section with the 'Incoming webhook URL' field is shown. |
| 4 | Type a few characters into 'Incoming webhook URL' (do not save), then clear it. | The characters are masked (shown as dots, a password-type field). |

*Automated:* `tests/e2e/alerts-actions.spec.ts › Alerts, notifications and tracked actions › Parameters shows the alert rules and, for super admins, the Slack settings`

## Tracked actions

### TC-ADM-034: A team lead creates an action for a member, edits it, marks it done and deletes it after a cancel

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- A dedicated test team in the DevOps department with a team lead (e.g. 'Fixture Lead') and two software engineer members named 'Fixture Member1' and 'Fixture Member2', each with a known login (the automated test creates them with password demo123). A super admin can arrange this under Teams / Users.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Title: Stabilise the checkout suite
- Owner: Fixture Member1
- Linked KPI: Test coverage
- Due date: 2030-06-30
- New title: Stabilise the checkout suite (phase 1)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead. On the Overview type the test team name into 'Search teams' and click its team card. | Team detail opens with the 'Action plan' card and a 'New action' button. |
| 2 | Click 'New action'. | The dialog 'New action' opens with Title, Description (optional), Owner, Due date and Linked KPI. |
| 3 | Enter the title, choose Owner 'Fixture Member1', Linked KPI 'Test coverage', Due date 2030-06-30 and click 'Create action'. | A toast 'Action created' appears; the action is listed with the owner 'Fixture Member1'. |
| 4 | Click the Edit (pencil) button of the action, change the title to the new title and click 'Save changes'. | A toast 'Action updated' appears; the list shows 'Stabilise the checkout suite (phase 1)'. |
| 5 | In the action's status dropdown choose 'Done'. | A toast 'Marked done; the outcome is computed from the stored values' appears; the action leaves the Open group and the group header 'Done (1)' is shown, collapsed. |
| 6 | Click the 'Done (1)' group header. | The Done group expands and shows the action with outcome badges (checkpoints with e.g. 'Pending' / 'No new data'). |
| 7 | Click the Delete (bin) button of the action. | A browser confirmation asks 'Delete the action "Stabilise the checkout suite (phase 1)"? This cannot be undone.' |
| 8 | Click Cancel. | The action is still listed. |
| 9 | Click Delete again and confirm with OK. | A toast 'Action deleted' appears and the action is no longer listed. |

*Automated:* `tests/e2e/alerts/actions.spec.ts › Tracked actions › ACT-01 a lead creates an action for a member, edits it, marks it done (outcome shown) and deletes it after a cancel`

### TC-ADM-035: An action title must have 3 to 200 characters; markup in a title is shown as plain text

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and lead from TC-C-033 exist.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Short title: ab
- Long title: 250 times the letter x
- Markup title: <img src=x onerror="window.__xss=1"> Fix it

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, open the test team's Team detail and click 'New action'. | The dialog 'New action' opens. |
| 2 | Enter 'ab' as Title and click 'Create action'. | The browser refuses the form with a length message (e.g. 'Please lengthen this text to 3 characters or more'); the dialog stays open and no action is created. |
| 3 | Paste the 250-character title into Title. | Only 200 characters are accepted in the field. |
| 4 | Replace the title with the markup title and click 'Create action'. | A toast 'Action created' appears; the action is listed with the literal text '<img src=x onerror="window.__xss=1"> Fix it' (no image, no broken-image icon). |
| 5 | Optional: in DevTools > Console type window.__xss and press Enter. | It answers undefined (no script ran). |

**After the test:** Delete the created action (bin button, confirm).

**Notes:** Security check (markup injection).

*Automated:* `tests/e2e/alerts/actions.spec.ts › Tracked actions › ACT-02 a title must have 3 to 200 characters; markup in a title is only text`

### TC-ADM-036: A double click on 'Create action' creates only one action

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and lead from TC-C-033 exist; no action named 'Only once please' exists.

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Title: Only once please

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, open the test team's Team detail and click 'New action'. | The dialog 'New action' opens. |
| 2 | Enter the title and double-click 'Create action' quickly. | The button shows 'Saving…'; the dialog closes after one save. |
| 3 | Look at the Action plan list (reload the page to be sure). | Exactly one action 'Only once please' is listed. |

**After the test:** Delete the created action.

*Automated:* `tests/e2e/alerts/actions.spec.ts › Tracked actions › ACT-03 a double click on "Create action" creates one action`

### TC-ADM-037: The owner (a software engineer) may change the status of their own action only

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F10.10, F10.9

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team, its lead and members 'Fixture Member1' / 'Fixture Member2' from TC-C-033 exist.
- Browser DevTools Console (or an HTTP client sending the session cookie) available for the last step.

**Test data**

- Lead: <test team lead e-mail> / demo123
- Member 1: <Fixture Member1 e-mail> / demo123
- Request: POST <API>/api/actions, JSON body {"teamId":"<test team id>","title":"Not allowed"}, credentials included

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, open the test team's Team detail and create an action 'Owned by member one' with Owner 'Fixture Member1', and an action 'Owned by member two' with Owner 'Fixture Member2' (due date 2030-06-30). | Both actions are listed with their owners. |
| 2 | Sign out and sign in as Fixture Member1. Open the test team's Team detail. | The 'Action plan' card is shown without a 'New action' button. |
| 3 | Look at the action 'Owned by member one'. | It has a status dropdown but no Edit (pencil) or Delete (bin) button. |
| 4 | Change its status to 'In progress'. | A toast 'Status: In progress' appears. |
| 5 | Look at the action 'Owned by member two'. | It has no status dropdown (status shown as a badge only). |
| 6 | In DevTools > Console send the POST request to /api/actions from Test data. | The answer has HTTP status 403. |

**After the test:** Sign in as the lead and delete both actions.

**Notes:** The last step requires DevTools Console or an HTTP client. The test team id can be read from the TV mode address (/tv?team=<id>).

*Automated:* `tests/e2e/alerts/actions.spec.ts › Tracked actions › ACT-04 the owner (a software engineer) may change the status of their action only`

### TC-ADM-038: A failed action save keeps the form open with the reason

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL with the NovaTech demo data.
- The test team and lead from TC-C-033 exist.
- A mocking tool that answers POST */api/actions with HTTP 500 and body {"error":"Internal server error","requestId":"rid-act"} (GET requests pass through). Alternative: DevTools > Network request blocking of */api/actions after the page has loaded (then a network error text is shown instead).

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123
- Title: Will fail

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead and open the test team's Team detail. | The 'Action plan' card is shown. |
| 2 | Turn on the failure mock. Click 'New action', enter the title 'Will fail' and click 'Create action'. | The dialog stays open and shows the error 'Internal server error'. |
| 3 | Close the dialog with Cancel and turn the mock off; reload the page. | No action 'Will fail' is listed. |

**After the test:** Remove the mock / request blocking.

**Notes:** Requires a mocking tool (or DevTools request blocking as an approximation).

*Automated:* `tests/e2e/alerts/actions.spec.ts › Tracked actions › ACT-05 a failed save keeps the form open with the reason`

### TC-ADM-040: Action plan groups the actions by status; Done and Dropped are collapsed by default

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A test team with a team lead (Overview > search) that has tracked actions: 7 Open, 2 In progress, 12 Done, 3 Dropped (created through the app or the database)
- Browser signed out (fresh private window)

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, type the test team name into 'Search teams' on the Overview and click its team card. | Team detail opens with the 'Action plan' card. |
| 2 | Read the group headers in the Action plan. | Four accordion headers in this order: 'Open (7)', 'In progress (2)', 'Done (12)', 'Dropped (3)'. |
| 3 | Look under 'Open' and 'In progress'. | Both are expanded and list their actions. |
| 4 | Look under 'Done' and 'Dropped'. | Both are collapsed: no actions are shown under them. |
| 5 | Click the 'Done (12)' header. | The Done group expands and shows its first 5 actions. |
| 6 | Press Tab until the 'Dropped (3)' header has the focus ring and press Enter. | The Dropped group expands and shows 3 actions without a pager. |

**After the test:** Delete the test actions.

**Notes:** Screen readers announce each header as a button, expanded or collapsed.

*Automated:* `tests/e2e/team/action-plan.spec.ts › Action plan › APL-01 grouped by status with counts; Open and In progress expanded, Done and Dropped collapsed`

### TC-ADM-041: Action plan paging per group: 5 per page by default, previous / next, page numbers, 10 and 20 per page

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A test team with a team lead (Overview > search) that has tracked actions: 7 Open, 2 In progress, 12 Done, 3 Dropped (created through the app or the database)
- Browser signed out (fresh private window)

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, type the test team name into 'Search teams' on the Overview and click its team card. | Team detail opens. |
| 2 | Look at the bottom of the Open group. | 'Showing 1–5 of 7', 'Per page 5', 'Previous' (disabled), page numbers 1 and 2, 'Next'. |
| 3 | Click 'Next'. | 'Showing 6–7 of 7'; two actions are listed; page 2 is highlighted and 'Next' is disabled. |
| 4 | Choose Per page '10'. | 'Showing 1–7 of 7'; all 7 actions are listed and there are no page buttons. |
| 5 | Expand 'Done (12)' and click page '3'. | 'Showing 11–12 of 12' in the Done group; the Open group still shows 'Showing 1–7 of 7'. |
| 6 | Choose Per page '20' in the Done group. | All 12 done actions are listed. |

**After the test:** Delete the test actions.

*Automated:* `tests/e2e/team/action-plan.spec.ts › Action plan › APL-02 paging per group: 5 per page by default, previous / next / numbers, page size 10 and 20`

### TC-ADM-042: The expanded groups and the collapsed Action plan section are remembered after a reload

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A test team with a team lead (Overview > search) that has tracked actions: 7 Open, 2 In progress, 12 Done, 3 Dropped (created through the app or the database)
- Browser signed out (fresh private window)

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, type the test team name into 'Search teams' on the Overview and click its team card. | Team detail opens. |
| 2 | Expand 'Done' and collapse 'Open'. | Done shows its actions; Open shows none. |
| 3 | Reload the page and open the team again. | Done is still expanded and Open still collapsed. |
| 4 | Click the 'Action plan' title (chevron) at the top of the card. | The whole list collapses; the 'New action' button stays. |
| 5 | Reload the page and open the team again. | The Action plan is still collapsed. |
| 6 | Click 'Action plan' again. | The list is shown again. |

**After the test:** Delete the test actions.

**Notes:** Remembered per person in this browser (localStorage).

*Automated:* `tests/e2e/team/action-plan.spec.ts › Action plan › APL-03 the expanded state of the groups and the section survives a reload`

### TC-ADM-043: Changing an action's status moves it to its group and updates the counts

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F10.9

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173; API at http://localhost:3000/api) with the demo company NovaTech loaded
- A test team with a team lead (Overview > search) that has tracked actions: 7 Open, 2 In progress, 12 Done, 3 Dropped (created through the app or the database)
- Browser signed out (fresh private window)

**Test data**

- E-mail: <test team lead e-mail>
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the test team lead, type the test team name into 'Search teams' on the Overview and click its team card. | Team detail opens. |
| 2 | In the In progress group change the status dropdown of an action to 'Dropped'. | A toast 'Status: Dropped' appears; the headers read 'In progress (1)' and 'Dropped (4)'. |
| 3 | Expand 'Dropped'. | The action is listed there. |
| 4 | Change its status back to 'In progress'. | The headers read 'In progress (2)' and 'Dropped (3)'. |

**After the test:** Delete the test actions.

*Automated:* `tests/e2e/team/action-plan.spec.ts › Action plan › APL-04 a status change moves the action to its group and updates the counts`

### TC-ADM-048: A team lead creates a tracked action on Team detail, moves it to In progress, and TV mode shows it without owner names

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F10.9, F6.12

**Preconditions**

- App running at the test URL with the NovaTech demo data (lead@irongate.com leads The Away Team).

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Title: Manual action <date-time>
- Linked KPI: Test coverage
- Due date: 2030-03-01

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead and click The Away Team's card on the Overview. | Team detail opens with the 'Action plan' card. |
| 2 | Click 'New action'. | The dialog 'New action' opens. |
| 3 | Enter the title, choose Linked KPI 'Test coverage', Due date 2030-03-01 and click 'Create action'. | A toast 'Action created' appears and the action is listed. |
| 4 | Look at the action's KPI line. | It reads 'Test coverage (higher is better): baseline …'. |
| 5 | Change the action's status to 'In progress'. | The action shows the badge 'In progress'. |
| 6 | Click 'Open TV mode' (or open /tv?team=<The Away Team id>), move the mouse to show the controls and click 'Alerts & actions'. | An 'Action plan' panel with the tracked actions is shown, including the new action. |
| 7 | Read the Action plan panel on TV. | No owner names are shown (e.g. no 'Team Lead'). |

**After the test:** Leave TV mode, open The Away Team's Team detail and delete the created action.

*Automated:* `tests/e2e/alerts-actions.spec.ts › Alerts, notifications and tracked actions › A team lead creates a tracked action on Team detail, moves it to in progress, and TV mode shows it`

## CI evidence

### TC-ADM-049: The team page shows Evidence from CI: calculated metrics, flaky tests with their runs, lowest-coverage files, slowest tests and failing stages

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F9.7

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173) with the API and the NovaTech demo data loaded (npm run seed:demo, which also adds 14 days of sample raw CI data).

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as super admin, type 'The Away Team' in 'Search teams' on the Overview and click its card. | Team detail of The Away Team opens. |
| 2 | Scroll to the section 'Evidence from CI'. | The section shows 'Last data received — Tests: …, Coverage: …, Pipelines: …' and a card 'Calculated from CI data' with tiles such as Line coverage, Pass rate, Average build time; each tile shows a date, the number of runs and a confidence (high / medium / low). |
| 3 | Look at the card 'Flaky tests'. | Each flaky test shows its name and file, 'Failed in N runs, passed in M', the commit(s), red 'failed · run …' chips and green 'passed · run … #2' chips (the runs that prove it) and the failure message. If the list is empty it says 'No flaky tests found.' |
| 4 | Look at 'Lowest-coverage files', 'Slowest tests' and 'Failing stages'. | Lowest-coverage files: the latest report (commit, branch, format, number of files, date) and files with 'Lines hit' and a coloured coverage badge, lowest first. Slowest tests: test, file, median duration and number of runs. Failing stages: stage name, '% failed' badge, 'N of M runs failed · median …' and the latest failing runs. |

**Notes:** Sample raw data: its evidence is shown, but it is never written as KPI values.

*Automated:* `tests/e2e/team/ci-evidence.spec.ts › Evidence from CI › CIEV-01`

### TC-ADM-050: How this was calculated: from a KPI card and from a calculated metric, with the formula, values used and source runs

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F9.8

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173) with the API and the NovaTech demo data loaded (npm run seed:demo, which also adds 14 days of sample raw CI data).

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Team: The Away Team

| Step | Action | Expected result |
|---|---|---|
| 1 | On The Away Team's Team detail, find the 'Test coverage' KPI card and click 'How this was calculated'. | A dialog 'How this was calculated: Line coverage' opens with a confidence badge, the value, 'Formula: lines hit ÷ lines found × 100 …', 'Based on N run(s)' and the note 'Calculated from sample CI data: shown as evidence, not written to the team's KPIs.' |
| 2 | Read the sections 'Values used', 'Lowest-coverage files in this report' and 'Source records'. | Values used lists Files, Lines hit, Lines found and the report format; Source records lists the coverage report with its commit, branch, date and 'hit / found lines · files'. |
| 3 | Press Esc. | The dialog closes and focus returns to the link. |
| 4 | In 'Calculated from CI data', click the 'Average build time' tile. | The dialog shows 'Average build time', the formula 'median pipeline duration …' and the pipeline runs it used (run id, commit, date, result and duration). |
| 5 | Close it with the X button. | The dialog closes. |

*Automated:* `tests/e2e/team/ci-evidence.spec.ts › Evidence from CI › CIEV-02`

### TC-ADM-051: An engineer sees the evidence of their own team; another team and the CI status are refused

**Type:** Negative · **Priority:** Medium · **Role:** Software engineer · **Flow:** F9.7

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173) with the API and the NovaTech demo data loaded (npm run seed:demo, which also adds 14 days of sample raw CI data).

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as engineer and open the team card 'Mavericks'. | Team detail shows the section 'Evidence from CI'. |
| 2 | In the same browser, open <API>/api/ci/teams/<QualityCowboys team id>/evidence (e.g. http://localhost:3000/api/ci/teams/team-1764026236967-uphpblii4/evidence). | The answer is 403 with "Access denied. This team is outside your analytics scope." |
| 3 | Open <API>/api/ci/status. | The answer is 403 "Super admin access required". |

*Automated:* `tests/e2e/team/ci-evidence.spec.ts › Evidence from CI › CIEV-03`

### TC-ADM-052: A team without CI data says so and points the admin to Connect your CI

**Type:** Positive · **Priority:** Low · **Role:** Super admin · **Flow:** F9.7

**Preconditions**

- A newly registered organisation (Register a company) with its first team; no CI data sent.

**Test data**

- The new organisation's super admin

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the new organisation's super admin and open its team from the Overview. | Team detail opens. |
| 2 | Scroll to 'Evidence from CI'. | It reads 'No CI data for this team yet' and mentions 'Admin console → Connect your CI'. |

*Automated:* `tests/e2e/team/ci-evidence.spec.ts › Evidence from CI › CIEV-04`

## Connect your CI

### TC-ADM-053: Connect your CI: steps per CI tool, test call, last data received after a real upload, main branch

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F9.6

**Preconditions**

- A newly registered organisation with one team (or any organisation: use a team that has no CI data).
- A terminal with curl.

**Test data**

- Key name: CI evidence key
- Wrong key: igk_wrong
- JUnit file junit.xml with two test cases, one failing (see tests/e2e/team/ci-evidence.spec.ts JUNIT)

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as super admin and open Admin console (/admin-panel); scroll to "Connect your CI". | Three endpoint boxes (Test reports, Coverage, Pipeline runs) show 'POST <address>/api/ingest/…'. Tabs GitHub Actions, GitLab CI, Jenkins, Azure DevOps; the GitHub Actions snippet contains 'secrets.QE_NAVIGATOR_API_KEY' and 'team=<the selected team id>'. |
| 2 | Click 'GitLab CI', then press the Right arrow key; then click 'Azure DevOps'. | GitLab shows 'stage: .post' jobs; the arrow key selects 'Jenkins' (credentialsId 'qe-navigator-api-key'); Azure shows '$(System.JobAttempt)'. 'Copy' copies the snippet. |
| 3 | In 'Last data received', find the team. | Tests, Coverage and Pipelines say 'none yet'. |
| 4 | In 'API keys', create a key named 'CI evidence key' and copy it; click Done. | The key is shown once. |
| 5 | In 'Send a test call', paste igk_wrong and click 'Send test call'. | A red message 'The key was refused: …'. |
| 6 | Paste the real key and click 'Send test call'. | A green message 'Connected. The key is valid, team … accepts data and the sample report was read (3 tests). Nothing was stored.' The team row still says 'none yet'. |
| 7 | In a terminal: curl -X POST "<API>/api/ingest/tests?team=<team id>&commit=abc&branch=main&run=1" -H "Authorization: Bearer <key>" -H "Content-Type: application/xml" --data-binary @junit.xml | HTTP 201 with "status":"accepted" and "computed" values. |
| 8 | Reload the Admin console. | The team row shows today's date and 'junit' under Tests. |
| 9 | Type 'develop' as the team's main branch and click Save; then clear it and Save again. | 'Saved' appears each time. |
| 10 | Open the team on the Overview, click the 'Pass rate' tile under 'Calculated from CI data'. | The dialog shows 50.0 % and 'Shown here only (no KPI column)'. |
| 11 | Close it; on the 'First-time pass rate' KPI card, read the source line and click 'How this was calculated'. | The card says 'computed · as of …'; the dialog says 'Written to the team's KPI as source "computed"'. |

**After the test:** Revoke the key in API keys.

*Automated:* `tests/e2e/team/ci-evidence.spec.ts › Connect your CI › CI-01`

### TC-ADM-054: A manager has no Connect your CI

**Type:** Negative · **Priority:** Low · **Role:** Manager · **Flow:** F9.6

**Preconditions**

- App running at the test URL (e.g. http://localhost:5173) with the API and the NovaTech demo data loaded (npm run seed:demo, which also adds 14 days of sample raw CI data).

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as manager and open Admin console (/admin-panel). | The Admin console opens without the sections 'API keys' and 'Connect your CI'. |

*Automated:* `tests/e2e/team/ci-evidence.spec.ts › Connect your CI › CI-02`

## Wellbeing pulse

### TC-ORG-001: Super admin: the pulse page shows the send panel, cadence and reminders only to the roles allowed

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F11.4, F11.12

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- The demo team "The Away Team" (DevOps department) exists; lead@ leads it and viewer@ is a viewer on it.

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Team id of The Away Team: team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Enter the address /analytics/pulse?team=team-1764200682441-sckxod8xd (The Away Team) in the address bar and press Enter. | The Wellbeing pulse page opens and shows the pulse page of The Away Team. Either the privacy list ("Answers are stored without your name, user id or the time you answered...") or the team's wellbeing card is visible. |
| 3 | Look for the "Send the survey" panel (with the "Send survey to the team" button). | The "Send the survey" panel is shown. |
| 4 | Look for the "Ask the team" cadence drop-down (Every week / Every two weeks / Every month / Every three months). | The "Ask the team" drop-down is shown. |
| 5 | Look for the "Reminders and escalation" card (Warn members who have not answered, E-mail reminders, Escalate, Tell, Save). | The "Reminders and escalation" card is shown. |
| 6 | Press Ctrl+F (Cmd+F) and search the page for "igp_", then for "pulse/answer?token". | Neither text is found: no personal survey link is ever shown on the page. |

**Notes:** Expected per role: Super admin and Manager see all three (send panel, cadence, reminders); Team lead sees send panel and reminders but no cadence; Software engineer and Viewer see none of them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: roles › PUL-01 admin on the pulse page of The Away Team: send panel, cadence and reminders per role`

### TC-ORG-002: Manager: the pulse page shows the send panel, cadence and reminders only to the roles allowed

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F11.4, F11.12

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- The demo team "The Away Team" (DevOps department) exists; lead@ leads it and viewer@ is a viewer on it.

**Test data**

- E-mail: manager@irongate.com
- Password: demo123
- Team id of The Away Team: team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Manager (manager@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Enter the address /analytics/pulse?team=team-1764200682441-sckxod8xd (The Away Team) in the address bar and press Enter. | The Wellbeing pulse page opens and shows the pulse page of The Away Team. Either the privacy list ("Answers are stored without your name, user id or the time you answered...") or the team's wellbeing card is visible. |
| 3 | Look for the "Send the survey" panel (with the "Send survey to the team" button). | The "Send the survey" panel is shown. |
| 4 | Look for the "Ask the team" cadence drop-down (Every week / Every two weeks / Every month / Every three months). | The "Ask the team" drop-down is shown. |
| 5 | Look for the "Reminders and escalation" card (Warn members who have not answered, E-mail reminders, Escalate, Tell, Save). | The "Reminders and escalation" card is shown. |
| 6 | Press Ctrl+F (Cmd+F) and search the page for "igp_", then for "pulse/answer?token". | Neither text is found: no personal survey link is ever shown on the page. |

**Notes:** Expected per role: Super admin and Manager see all three (send panel, cadence, reminders); Team lead sees send panel and reminders but no cadence; Software engineer and Viewer see none of them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: roles › PUL-01 manager on the pulse page of The Away Team: send panel, cadence and reminders per role`

### TC-ORG-003: Team lead: the pulse page shows the send panel, cadence and reminders only to the roles allowed

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F11.4, F11.12

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- The demo team "The Away Team" (DevOps department) exists; lead@ leads it and viewer@ is a viewer on it.

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Team id of The Away Team: team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Team lead (lead@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Enter the address /analytics/pulse?team=team-1764200682441-sckxod8xd (The Away Team) in the address bar and press Enter. | The Wellbeing pulse page opens and shows the pulse page of The Away Team. Either the privacy list ("Answers are stored without your name, user id or the time you answered...") or the team's wellbeing card is visible. |
| 3 | Look for the "Send the survey" panel (with the "Send survey to the team" button). | The "Send the survey" panel is shown. |
| 4 | Look for the "Ask the team" cadence drop-down (Every week / Every two weeks / Every month / Every three months). | The "Ask the team" drop-down is NOT shown. |
| 5 | Look for the "Reminders and escalation" card (Warn members who have not answered, E-mail reminders, Escalate, Tell, Save). | The "Reminders and escalation" card is shown. |
| 6 | Press Ctrl+F (Cmd+F) and search the page for "igp_", then for "pulse/answer?token". | Neither text is found: no personal survey link is ever shown on the page. |

**Notes:** Expected per role: Super admin and Manager see all three (send panel, cadence, reminders); Team lead sees send panel and reminders but no cadence; Software engineer and Viewer see none of them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: roles › PUL-01 lead on the pulse page of The Away Team: send panel, cadence and reminders per role`

### TC-ORG-004: Software engineer: the pulse page shows the send panel, cadence and reminders only to the roles allowed

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F11.4, F11.12

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- The demo team "The Away Team" (DevOps department) exists; lead@ leads it and viewer@ is a viewer on it.

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Team id of The Away Team: team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Software engineer (engineer@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Enter the address /analytics/pulse?team=team-1764200682441-sckxod8xd (The Away Team) in the address bar and press Enter. | The Wellbeing pulse page opens and shows the pulse page of the engineer's own team (Mavericks), because the engineer is not a member of The Away Team and it is outside their scope. Either the privacy list ("Answers are stored without your name, user id or the time you answered...") or the team's wellbeing card is visible. |
| 3 | Look for the "Send the survey" panel (with the "Send survey to the team" button). | The "Send the survey" panel is NOT shown. |
| 4 | Look for the "Ask the team" cadence drop-down (Every week / Every two weeks / Every month / Every three months). | The "Ask the team" drop-down is NOT shown. |
| 5 | Look for the "Reminders and escalation" card (Warn members who have not answered, E-mail reminders, Escalate, Tell, Save). | The "Reminders and escalation" card is NOT shown. |
| 6 | Press Ctrl+F (Cmd+F) and search the page for "igp_", then for "pulse/answer?token". | Neither text is found: no personal survey link is ever shown on the page. |

**Notes:** Expected per role: Super admin and Manager see all three (send panel, cadence, reminders); Team lead sees send panel and reminders but no cadence; Software engineer and Viewer see none of them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: roles › PUL-01 engineer on the pulse page of The Away Team: send panel, cadence and reminders per role`

### TC-ORG-005: Viewer: the pulse page shows the send panel, cadence and reminders only to the roles allowed

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F11.4, F11.12

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- The demo team "The Away Team" (DevOps department) exists; lead@ leads it and viewer@ is a viewer on it.

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Team id of The Away Team: team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Viewer (viewer@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Enter the address /analytics/pulse?team=team-1764200682441-sckxod8xd (The Away Team) in the address bar and press Enter. | The Wellbeing pulse page opens and shows the pulse page of The Away Team. Either the privacy list ("Answers are stored without your name, user id or the time you answered...") or the team's wellbeing card is visible. |
| 3 | Look for the "Send the survey" panel (with the "Send survey to the team" button). | The "Send the survey" panel is NOT shown. |
| 4 | Look for the "Ask the team" cadence drop-down (Every week / Every two weeks / Every month / Every three months). | The "Ask the team" drop-down is NOT shown. |
| 5 | Look for the "Reminders and escalation" card (Warn members who have not answered, E-mail reminders, Escalate, Tell, Save). | The "Reminders and escalation" card is NOT shown. |
| 6 | Press Ctrl+F (Cmd+F) and search the page for "igp_", then for "pulse/answer?token". | Neither text is found: no personal survey link is ever shown on the page. |

**Notes:** Expected per role: Super admin and Manager see all three (send panel, cadence, reminders); Team lead sees send panel and reminders but no cadence; Software engineer and Viewer see none of them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: roles › PUL-01 viewer on the pulse page of The Away Team: send panel, cadence and reminders per role`

### TC-ORG-006: The API refuses a survey send from a viewer and a cadence change from a team lead

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F4.4, F11.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- Browser developer tools available (the refusals are checked on the API directly; the UI hides these controls).

**Test data**

- Viewer: viewer@irongate.com / demo123
- Team lead: lead@irongate.com / demo123
- Team id of The Away Team: team-1764200682441-sckxod8xd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Viewer (viewer@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open DevTools > Console and send a POST request (with credentials included) to http://localhost:3000/api/pulse/teams/team-1764200682441-sckxod8xd/send; then look at the request in DevTools > Network. | The request is refused with status 403 (or 404). No survey is sent. |
| 3 | Open the navigation (burger button) and click "Sign out". | The sign-in screen ("Sign in") is shown. |
| 4 | Open the sign-in page and sign in as Team lead (lead@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 5 | In DevTools > Console send a PUT request (credentials included, JSON body with cadence "weekly") to http://localhost:3000/api/pulse/teams/team-1764200682441-sckxod8xd/cadence; check it in the Network tab. | The request is refused with status 403. The cadence of The Away Team is unchanged. |

**Notes:** Requires DevTools (requests sent from the Console). Signed in through the app first so the session cookie is sent.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: roles › PUL-02 the API refuses sending and cadence changes from roles without them`

### TC-ORG-007: A manager changes the cadence: it applies from the next period; choosing the current one again cancels the change

**Type:** Positive · **Priority:** Medium · **Role:** Manager · **Flow:** F11.5

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- The fixture team is on the default cadence "Every two weeks" with no pending change.

**Test data**

- Manager: manager@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Manager (manager@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /analytics/pulse?team=<id of UI Team X> (or open Wellbeing pulse and pick UI Team X in the scope bar). | The Wellbeing pulse page of UI Team X opens; the "Ask the team" drop-down shows "Every two weeks". |
| 3 | In "Ask the team" choose "Every month". | A message "Every month from <date> (the running period keeps its length)." appears. The drop-down shows "Every month" and a note "from <date>" next to it. |
| 4 | In "Ask the team" choose "Every two weeks" again. | A message starting "Stays every two weeks." appears; the pending change is cancelled (no "from <date>" note). |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-10 a manager changes the cadence: it applies from the next period; choosing the current one cancels`

### TC-ORG-008: Reminder settings outside the allowed range are refused with the reason in the page's words; a valid value saves

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F11.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.

**Test data**

- Fixture Lead e-mail and password
- Invalid value: 99
- Valid value: 3

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Fixture Lead (the fixture team's lead). | The Overview opens. |
| 2 | Open /analytics/pulse?team=<id of UI Team X>. | The "Reminders and escalation" card is visible. |
| 3 | In "Warn members who have not answered" type 99 and click "Save". | A red error inside the card reads "The in-app warning to members who have not answered must be a whole number of days from 0 to 30." (no API field names such as warningAfterDays). Nothing is saved. |
| 4 | Change it to 3, type 61 in "Escalate" and click "Save". | The error reads "The escalation must be a whole number of days from 1 to 60." |
| 5 | Change "Escalate" back to 5 and click "Save". | A confirmation "Reminder settings saved." appears and the red error is gone. |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.; Set "Warn members who have not answered" back to its previous value if needed.

**Notes:** Messages in the page's words (FI-12, fixed).

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-11 reminder settings outside the allowed range are refused with the reason, in the page's words`

### TC-ORG-009: After the escalation the team lead sees who has not answered (names only, never answers)

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F11.10

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- An escalation for the current period was sent to Fixture Lead, and the daily non-responder list contains Fixture Member1 and Fixture Member2 (not Member3). This normally happens through the scheduled escalation job after "Escalate" days; to test on demand ask a developer to seed the escalation and the non-responder list in the test database.

**Test data**

- Fixture Lead e-mail and password

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Fixture Lead. | The Overview opens. |
| 2 | Open /analytics/pulse?team=<id of UI Team X>. | The "Send the survey" panel is shown. |
| 3 | Find the list headed "Not answered yet (...)" in the send panel. | It reads "Not answered yet (2) · escalated to you on <date>". |
| 4 | Read the names in the list. | Exactly "Fixture Member1" and "Fixture Member2" are listed; "Fixture Member3" is not. No answers or scores are shown, only names, with the note "Only whether people answered; never what they answered." |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.

**Notes:** Requires database setup (escalation record and non-responder list) or waiting for the scheduled escalation job.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-12 after the escalation the lead sees who has not answered (names only, never answers)`

### TC-ORG-010: A manager the escalation did not go to does not see the list of members who have not answered

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F11.10

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- The escalation of the current period went only to Fixture Lead (see the previous test case).

**Test data**

- Manager: manager@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Manager (manager@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /analytics/pulse?team=<id of UI Team X>. | The "Send the survey" panel is shown. |
| 3 | Look for a "Not answered yet (...)" list in the panel. | There is no "Not answered yet" list and no member names of non-responders anywhere on the page. |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.

**Notes:** Run after the escalation test case (same setup).

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-13 people the escalation did not go to do not see the list`

### TC-ORG-011: The team lead sends the survey; without e-mail configured nothing is e-mailed and the reminder button stays off

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F11.6, F11.7, F11.12

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- The server has no e-mail delivery configured (no Resend / SMTP), as on local and CI test servers.

**Test data**

- Fixture Lead e-mail and password

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Fixture Lead. | The Overview opens. |
| 2 | Open /analytics/pulse?team=<id of UI Team X>. | The "Send the survey" panel shows "Not sent yet for this period (3 members)." (or the number of active members) and an amber note that e-mail is not configured on this server. |
| 3 | Click "Send survey to the team". | A message appears: "E-mail is not configured on this server, so nothing was e-mailed. Members can answer in the app." (on a server with e-mail: "Survey sent to N members."). |
| 4 | Look at the panel below the buttons. | A "Recent sends" list appears with a line such as "Survey sent to 3 members by <name> · not e-mailed (e-mail not configured)". |
| 5 | Look at the "Send reminder to those who haven’t answered" button. | The button is disabled (no e-mail was delivered, so there is nobody to remind). |
| 6 | Press Ctrl+F (Cmd+F) and search the page for "igp_", then for "pulse/answer?token". | Neither text is found: no personal survey link is ever shown on the page. |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-17 the lead sends the survey; without e-mail configured nothing is e-mailed and reminders stay off`

### TC-ORG-012: "Send reminder" reports how many members were reminded

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F11.7

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- The survey has been sent and e-mailed (delivered) to the members this period, at least 24 hours ago or with no reminder yet, and 2 members have not answered. This needs a server with e-mail delivery configured. Without it, use DevTools Local Overrides to change the response of GET /api/pulse/teams/<team id> (sending.sent at least 1, reminderAvailableAt null, emailConfigured true) and of POST /api/pulse/teams/<team id>/remind ({emailConfigured: true, recipients: 2, delivered: 2}).

**Test data**

- Fixture Lead e-mail and password

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Fixture Lead. | The Overview opens. |
| 2 | Open /analytics/pulse?team=<id of UI Team X>. | The "Send the survey" panel is shown and "Send reminder to those who haven’t answered" is enabled. |
| 3 | Click "Send reminder to those who haven’t answered". | A confirmation "Reminder sent to 2 members who have not answered." appears. |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.; Remove any DevTools overrides.

**Notes:** Requires e-mail delivery configured on the server, or DevTools Local Overrides (the automated test stubs both responses).

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-18 "Send reminder" reports how many were reminded (delivery stubbed: e-mail is not configured in tests)`

### TC-ORG-013: An expired personal survey link says the survey has closed

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F11.8

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- A personal pulse link (from a survey e-mail) for Fixture Member3 whose period has ended / which has expired. Get one from an e-mail of an earlier period on a server with e-mail configured, or ask a developer to issue an expired link in the test database.

**Test data**

- Expired personal link: <app>/pulse/answer?token=igp_...

| Step | Action | Expected result |
|---|---|---|
| 1 | Make sure you are signed out (or use a private browser window). | No one is signed in. |
| 2 | Open the expired personal link in the browser. | A page with the QE Navigator shield opens with the heading "This survey has closed" and an explanation; no survey questions are shown. |
| 3 | Click "Open QE Navigator". | The app's start (sign-in) page opens. |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.

**Notes:** Requires an expired link (database setup or an old e-mail).

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-14 an expired personal link says the survey has closed`

### TC-ORG-014: Answering through a personal link with a double click records one answer; markup in the comment is kept as text

**Type:** Negative · **Priority:** Medium · **Role:** Signed out · **Flow:** F11.8, F16.9, F16.10

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- A valid, unused personal pulse link for Fixture Member3 for the current period (from the survey e-mail on a server with e-mail, or issued by a developer). No answer exists yet for UI Team X this period.

**Test data**

- Comment: <b>bold?</b> 🚀 ünïcødé
- Answer 3 to every question

| Step | Action | Expected result |
|---|---|---|
| 1 | While signed out, open the personal link. | The page "Wellbeing pulse · UI Team X" opens with five questions (1 = strongly disagree, 5 = strongly agree), a "Comment (optional)" box and a "Send anonymously" button. |
| 2 | For each of the five questions choose 3. | The 3 button of each question is highlighted. |
| 3 | Type the comment <b>bold?</b> 🚀 ünïcødé into "Comment (optional)". | The text appears exactly as typed (no bold formatting). |
| 4 | Double-click "Send anonymously" quickly. | The "Thank you" page appears ("This link no longer works. You can close this page."). No error is shown. |
| 5 | Open the same link again. | The page says "Already answered". |
| 6 | Sign in as Super admin (admin@irongate.com / demo123) and open /analytics/pulse?team=<id of UI Team X>; read "Answers so far" in the send panel. | It shows that only one answer exists (worded "fewer than 3 responses so far"); a developer can confirm exactly one response row exists for the team and period. |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.

**Notes:** Exact count of one answer is checked in the database by the automated test; a manual tester can only see "fewer than 3 responses so far" and the "Already answered" state.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-15 answering through a link with a double click records one answer`

### TC-ORG-015: The survey comment box keeps to its maximum length (500 characters)

**Type:** Negative · **Priority:** Low · **Role:** Software engineer · **Flow:** F11.1, F16.11

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A fixture team in the DevOps department (the manager's department) of NovaTech, here called "UI Team X", with a team lead "Fixture Lead" and three software engineers "Fixture Member1", "Fixture Member2", "Fixture Member3", each with their own e-mail and a known password (the automated test uses demo123; when creating them by hand as super admin via Teams > Create team and Users > Add with password, use Ui-Tests-Passw0rd!). Each user's primary team and role assignment is UI Team X. Nobody has answered the pulse for the current period and nothing has been sent yet.
- Fixture Member1 has not answered the survey of the current period.

**Test data**

- Fixture Member1 e-mail and password
- A text of 550 characters (e.g. 550 times "x")

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Fixture Member1. | The Overview opens. |
| 2 | Open /analytics/pulse?team=<id of UI Team X>. | The "This period's survey" card with the five questions and the "Comment (optional)" box is shown. |
| 3 | Paste a text of 550 characters into "Comment (optional)". | Only the first 500 characters are accepted; the box stops at its maximum length. |

**After the test:** Delete UI Team X and its four users (Teams > Delete team; Users > Delete), or ask a developer to remove them.

*Automated:* `tests/e2e/pulse/pulse-roles-and-negatives.spec.ts › Wellbeing pulse: changes on a fixture team › PUL-16 the comment box keeps to its maximum length`

### TC-ORG-016: A member sees the pending-pulse banner, answers from it, and the banner goes away

**Type:** Positive · **Priority:** Medium · **Role:** Software engineer · **Flow:** F4.12, F11.11, F11.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A team "E2E Reminder Team" in the engineer's department (Digital Products) of NovaTech with software engineer "Remi Tester" (e2e-prem-user@irongate.test) and team lead "Lena Tester" (e2e-prem-lead@irongate.test), both with password demo123 and primary team E2E Reminder Team.
- The team is asked every week and the current weekly period started today; the survey of this period was sent today (in the app, not e-mailed); "Warn members who have not answered" is 0 days. The automated test seeds this in the database; by hand, set the cadence to "Every week" in the week before (a change applies from the next period), set the warning to 0 and press "Send survey to the team" on the first day of the period.
- Remi Tester has not answered this period.

**Test data**

- E-mail: e2e-prem-user@irongate.test
- Password: demo123
- Answer 4 to every question

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Remi Tester (e2e-prem-user@irongate.test / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Look at the band below the top bar. | A banner reads "Your team's wellbeing pulse is waiting — it takes 1 minute. Your answers are anonymous." with the buttons "Answer now" and "Not today". |
| 3 | Click "Answer now". | The Wellbeing pulse page opens with the address /analytics/pulse?team=e2e-prem-team and shows "Your manager can see whether you have responded, not what you answered." |
| 4 | Choose 4 for each of the five questions and click "Send anonymously". | The message "Thank you. Your answer was saved anonymously." appears and the card says "You have answered for this period. The next survey opens on <date>..." |
| 5 | Reload the page. | The "You have answered for this period" message is still shown and the pending-pulse banner is no longer displayed. |

**After the test:** Remove E2E Reminder Team and its two users (or ask a developer to clean them up).

*Automated:* `tests/e2e/pulse-reminders.spec.ts › Wellbeing pulse reminders › a member sees the banner, answers from it, and the banner goes away`

### TC-ORG-017: The team lead hides the banner with "Not today" and edits the reminder and escalation settings

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F4.12, F11.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A team "E2E Reminder Team" in the engineer's department (Digital Products) of NovaTech with software engineer "Remi Tester" (e2e-prem-user@irongate.test) and team lead "Lena Tester" (e2e-prem-lead@irongate.test), both with password demo123 and primary team E2E Reminder Team.
- The team is asked every week and the current weekly period started today; the survey of this period was sent today (in the app, not e-mailed); "Warn members who have not answered" is 0 days. The automated test seeds this in the database; by hand, set the cadence to "Every week" in the week before (a change applies from the next period), set the warning to 0 and press "Send survey to the team" on the first day of the period.
- Lena Tester has not answered this period.

**Test data**

- E-mail: e2e-prem-lead@irongate.test
- Password: demo123
- Escalate: 10 days

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Lena Tester (e2e-prem-lead@irongate.test / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Look at the band below the top bar. | The pending-pulse banner is shown. |
| 3 | Click "Not today". | The banner disappears (hidden until tomorrow). |
| 4 | Open /analytics/pulse?team=e2e-prem-team. | The "Reminders and escalation" card is visible. Under "Tell" the text reads "Now: Lena Tester." |
| 5 | In "Escalate" type 10 and click "Save". | "Reminder settings saved." appears. Because the weekly period is short, a grey note reads "This period is short, so it uses: warning after ... days, reminders every ... days, escalation after 6 days." |

**After the test:** Remove E2E Reminder Team and its two users (or ask a developer to clean them up).; Set "Escalate" back to its previous value.

*Automated:* `tests/e2e/pulse-reminders.spec.ts › Wellbeing pulse reminders › the lead sees "Not today" hide it, and edits the reminder settings`

### TC-ORG-018: A super admin sends the survey; the team shows the closed period with its response rate

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F11.6, F11.2, F11.12, F11.5

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A team "E2E Pulse Send Team" in Digital Products (NovaTech) with four software engineers "Send Member1" ... "Send Member4" (e2e-psend-u1@irongate.test ... e2e-psend-u4@irongate.test, password demo123).
- The team is on the default cadence (every two weeks). The previous, closed period has 3 answers (one with every answer 5, one with 4, one with 3) and the survey of that period was delivered by e-mail to all 4 members. The automated test seeds this in the database; by hand it needs the previous period to have been run on a server with e-mail configured, or a developer to seed it.
- Nothing has been sent yet for the current period and nobody has answered it.

**Test data**

- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /analytics/pulse?team=e2e-psend-team. | The "Send the survey" panel shows "Not sent yet for this period (4 members)." and a "Not sent yet (4)" list with the four member names. |
| 3 | Click "Send survey to the team". | A message about the send appears and "Recent sends" lists "Survey sent to 4 members by <name>" (with "· not e-mailed (e-mail not configured)" on a server without e-mail). |
| 4 | Press Ctrl+F (Cmd+F) and search the page for "igp_", then for "pulse/answer?token". | Neither text is found: no personal survey link is ever shown on the page. |
| 5 | Look at the "Latest results" card. | The "Wellbeing (survey)" tile shows 75 /100 (mean answer 4.0 of 5). |
| 6 | Read the response rate line below the tile. | It reads "Response rate: 75% (3 responses, survey e-mailed to 4 members)". |
| 7 | Open the "Ask the team" drop-down. | It offers exactly: Every week, Every two weeks, Every month, Every three months. |

**After the test:** Remove E2E Pulse Send Team and its four users (or ask a developer to clean them up).

**Notes:** A developer can confirm that each of the 4 members got a personal link stored only as a hash (the automated test checks the database).

*Automated:* `tests/e2e/pulse-sending.spec.ts › Wellbeing pulse: sending and answering through the link › An admin sends the survey; the team sees the closed period with its response rate`

### TC-ORG-019: A member answers through the personal link without signing in; the link then works no more; a wrong link is refused

**Type:** Positive · **Priority:** High · **Role:** Signed out · **Flow:** F11.8

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A team "E2E Pulse Send Team" in Digital Products (NovaTech) with four software engineers "Send Member1" ... "Send Member4" (e2e-psend-u1@irongate.test ... e2e-psend-u4@irongate.test, password demo123).
- The survey of the current period has been sent (previous test case). Send Member1's personal link is available: from the e-mail on a server with e-mail configured, or issued by a developer.

**Test data**

- Personal link of Send Member1: <app>/pulse/answer?token=igp_...
- Answers: workload 4, focus 3, support 5, energy 4, outlook 4
- Comment: Answered from the e-mail
- Invalid link: /pulse/answer?token=igp_not-a-valid-token-at-all

| Step | Action | Expected result |
|---|---|---|
| 1 | In a signed-out (private) browser window, open Send Member1's personal link. | The page shows the heading "Wellbeing pulse · E2E Pulse Send Team", the anonymity note and the five questions. |
| 2 | Without choosing anything, click "Send anonymously". | An error reads "Answer every question (1–5) before sending." Nothing is sent. |
| 3 | Choose workload 4, focus 3, support 5, energy 4, outlook 4; type "Answered from the e-mail" as the comment; click "Send anonymously". | The "Thank you" page appears with "This link no longer works. You can close this page." |
| 4 | Open the same personal link again. | The page says "Already answered". |
| 5 | Open /pulse/answer?token=igp_not-a-valid-token-at-all. | The page says "Link not valid". |

**After the test:** Remove E2E Pulse Send Team and its four users (or ask a developer to clean them up).

**Notes:** The automated test also checks in the database that the answer is stored without a user id and that only participation of Send Member1 is recorded.

*Automated:* `tests/e2e/pulse-sending.spec.ts › Wellbeing pulse: sending and answering through the link › A member answers through the personal link without signing in; the link then works no more`

### TC-ORG-020: The send panel shows counts only (no names of who answered), and a team lead cannot change the cadence

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F11.2, F11.4, F11.5

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A team "E2E Pulse Send Team" in Digital Products (NovaTech) with four software engineers "Send Member1" ... "Send Member4" (e2e-psend-u1@irongate.test ... e2e-psend-u4@irongate.test, password demo123).
- Exactly one member answered the current period (previous test case), with the comment "Answered from the e-mail".

**Test data**

- Super admin: admin@irongate.com / demo123
- Team lead: lead@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /analytics/pulse?team=e2e-psend-team. | The "Send the survey" panel is shown. |
| 3 | Read the "Answers so far" line. | It reads "Answers so far: fewer than 3 responses so far ... What anyone answered is never shown." No count and no name of who answered is shown. |
| 4 | Search the page (Ctrl+F) for "Answered from the e-mail". | Not found: the comment of the running period is not shown. |
| 5 | Sign out, then sign in as Team lead (lead@irongate.com / demo123) and open Wellbeing pulse (/analytics/pulse). | The pulse page of the lead's team (The Away Team) shows the "Send the survey" panel. |
| 6 | Look for the "Ask the team" drop-down and read the note at the bottom of the send panel. | There is no "Ask the team" drop-down. The note reads "Asked every two weeks, sent by hand. Managers decide how often and whether it goes out automatically." (wording depends on the cadence). |

**After the test:** Remove E2E Pulse Send Team and its four users (or ask a developer to clean them up).

*Automated:* `tests/e2e/pulse-sending.spec.ts › Wellbeing pulse: sending and answering through the link › The send panel shows counts only, and the lead cannot change the cadence`

### TC-ORG-021: A team member answers the survey once and sees the team results (averages, no comments)

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F11.1, F11.2, F11.3

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- Two teams in Digital Products (NovaTech): "E2E Pulse Team" and "E2E Pulse Small Team". Software engineer "Pulse Tester" (e2e-pulse-user@irongate.test / demo123) is a member of E2E Pulse Team.
- Previous closed period: E2E Pulse Team has 3 answers (all 5s with comment "Retro actions helped", all 4s, all 3s); E2E Pulse Small Team has 2 answers (all 5s with comment "Only two of us", all 1s). The automated test seeds these answers in the database; by hand, have three / two members answer in the previous period, or ask a developer to seed them.
- Nobody has answered the current period.

**Test data**

- E-mail: e2e-pulse-user@irongate.test
- Password: demo123
- Answers: workload 4, focus 3, support 5, energy 2, outlook 4
- Comment: Fewer meetings please

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Pulse Tester (e2e-pulse-user@irongate.test / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open the navigation (burger button) and click "Wellbeing pulse". | The address changes to /analytics/pulse and the "This period's survey" card shows the five questions. |
| 3 | Look at "Latest results". | The "Wellbeing (survey)" tile shows 75 /100 with "Mean answer 4.0 of 5". |
| 4 | Search the page for "Retro actions helped". | Not found: members see averages, not comments. |
| 5 | Choose 4 for question 1 (workload) only and click "Send anonymously". | The 4 of question 1 is selected; an error reads "Answer every question (1–5) before sending." |
| 6 | Choose focus 3, support 5, energy 2, outlook 4; type "Fewer meetings please"; click "Send anonymously". | "Thank you. Your answer was saved anonymously." appears; the questions are replaced by "You have answered for this period. The next survey opens on <date>..." |
| 7 | Look at "Latest results" again. | Still 75: the running period is never shown. |
| 8 | Reload the page. | The "You have answered for this period" message is still shown; the form cannot be answered again. |

**After the test:** Remove the two E2E pulse teams and Pulse Tester (or ask a developer to clean them up).

*Automated:* `tests/e2e/pulse-survey.spec.ts › Wellbeing pulse survey › A team member answers the survey once and sees the team results`

### TC-ORG-022: A super admin sees results and comments but cannot answer for a team they are not in

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F11.1, F11.3

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- Two teams in Digital Products (NovaTech): "E2E Pulse Team" and "E2E Pulse Small Team". Software engineer "Pulse Tester" (e2e-pulse-user@irongate.test / demo123) is a member of E2E Pulse Team.
- Previous closed period: E2E Pulse Team has 3 answers (all 5s with comment "Retro actions helped", all 4s, all 3s); E2E Pulse Small Team has 2 answers (all 5s with comment "Only two of us", all 1s). The automated test seeds these answers in the database; by hand, have three / two members answer in the previous period, or ask a developer to seed them.

**Test data**

- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /analytics/pulse?team=e2e-pulse-team. | "Latest results" shows the "Wellbeing (survey)" tile with 75. |
| 3 | Look at the comments under the results. | A "Comments (1), in alphabetical order" list contains "Retro actions helped". |
| 4 | Look at the "This period's survey" card. | Instead of questions it reads "Only members of this team can answer its survey. You can see the team’s results." |
| 5 | Look at the page header. | The "Ask the team" cadence drop-down is shown. |

**After the test:** Remove the two E2E pulse teams and Pulse Tester (or ask a developer to clean them up).

*Automated:* `tests/e2e/pulse-survey.spec.ts › Wellbeing pulse survey › An admin sees results and comments but cannot answer for a team they are not in`

### TC-ORG-023: A team with fewer than 3 responses shows no results, no comments and no trend

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F11.2

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- Two teams in Digital Products (NovaTech): "E2E Pulse Team" and "E2E Pulse Small Team". Software engineer "Pulse Tester" (e2e-pulse-user@irongate.test / demo123) is a member of E2E Pulse Team.
- Previous closed period: E2E Pulse Team has 3 answers (all 5s with comment "Retro actions helped", all 4s, all 3s); E2E Pulse Small Team has 2 answers (all 5s with comment "Only two of us", all 1s). The automated test seeds these answers in the database; by hand, have three / two members answer in the previous period, or ask a developer to seed them.

**Test data**

- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /analytics/pulse?team=e2e-pulse-small. | "Latest results" shows "Not shown: fewer than 3 contributors. Results appear once at least 3 people have answered for a period." instead of a score. |
| 3 | Search the page for "Only two of us". | Not found: the comment is not shown. |
| 4 | Look at the "Trend" card. | It shows "Not shown: no period of the last N reached 3 responses" instead of a chart. |

**After the test:** Remove the two E2E pulse teams and Pulse Tester (or ask a developer to clean them up).

*Automated:* `tests/e2e/pulse-survey.spec.ts › Wellbeing pulse survey › A team with fewer than 3 responses shows no results`

### TC-ORG-070: The pulse survey goes to team members only, not to a stakeholder with read access

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F11.6, F11.7, F11.10, F11.11

**Preconditions**

- App running at the test URL with the NovaTech demo data loaded
- A team with a team lead, at least three software engineers and a Product Owner (a viewer listed as a team member)
- A stakeholder (e.g. Head of Product) with a Viewer assignment on that team who is not a member of it (super admin: Users > the person > assignments > Viewer on the team, without adding them to the team)

**Test data**

- Passwords of the demo accounts: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the team lead, open the team's Wellbeing pulse and click "Send survey". | The confirmation reports the number of members it was sent to: the team lead, the engineers and the Product Owner, not the stakeholder. |
| 2 | Sign in as the stakeholder and open the team. | The team is visible read-only; there is no pending-pulse banner and the pulse page offers no survey to answer. |
| 3 | Sign in as the Product Owner. | They can answer the survey. |
| 4 | As the team lead, after the reminder period, click "Send reminder" and look at the list of members who have not answered. | The reminder count and the non-responder names never include the stakeholder; the response rate counts the members only. |

**Notes:** Recipients, response rate, reminders, escalation names, the banner and the right to answer all use the same set: the people who work in the team.

*Automated:* `API tests/api/pulse-stakeholders.test.ts PSTK-001 … PSTK-005`

## Developer productivity

### TC-ORG-024: Developer productivity withholds team figures below 3 opted-in developers

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F7.7

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- The sample company "Northwind" (sample data) is loaded on the server; its team Checkout Core has only one developer opted in to developer insights, Fraud Detection has at least three.

**Test data**

- E-mail: alex.morgan@northwind.example (super admin of the sample company)
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Alex Morgan (alex.morgan@northwind.example / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /analytics/productivity?team=demo-team-checkout (Checkout Core). | The team summary shows "Not shown: fewer than 3 contributors" instead of the team figures. |
| 3 | Look at the DDPS history chart area. | It shows the "Not shown: fewer than 3 contributors" note instead of a chart. |
| 4 | Open /analytics/productivity?team=demo-team-fraud (Fraud Detection). | The tile "Team avg DDPS" is shown with a value, and no "Not shown: fewer than 3 contributors" note appears in the summary. |

**Notes:** Requires the sample (synthetic) data company to be loaded.

*Automated:* `tests/e2e/pulse-survey.spec.ts › Wellbeing pulse survey › Developer productivity withholds team figures below 3 opted-in developers`

## Overview

### TC-ORG-025: The overview shows the Wellbeing (survey) tile and Engineering health includes the wellbeing survey

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F5.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded

**Test data**

- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Look at the KPI tiles at the top of the Overview. | A tile labelled "Wellbeing (survey)" is shown. |
| 3 | Read the caption under the "Engineering health" tile. | It reads "Delivery, pipeline, debt, wellbeing survey", or, when a part has no data, "Excludes <parts> (no data)". |

*Automated:* `tests/e2e/pulse-survey.spec.ts › Wellbeing pulse survey › The dashboard shows Wellbeing (survey) and engineering health includes it`

### TC-ROLE-011: Software engineer sees only the teams of their scope on the overview

**Type:** Positive · **Priority:** Medium · **Role:** Software engineer · **Flow:** F5.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address engineer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Read the team cards in "Team performance". | Only Mavericks (the engineer's team) is listed; the summary card is titled "Your team". |

*Automated:* `tests/e2e/qa-engineer-rbac.spec.ts › QA Engineer Role-Based Access Control › QA Engineer sees only the teams of their analytics scope on the dashboard`

### TC-ROLE-017: Team lead sees only the teams of their scope on the overview

**Type:** Positive · **Priority:** Medium · **Role:** Team lead · **Flow:** F5.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Read the team cards in "Team performance". | Exactly the teams the lead is assigned to (The Away Team); no team of another department. |

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Main Dashboard - Team Lead sees the teams of their scope only`

### TC-ROLE-028: Viewer sees only her team on the overview; another team is refused (team detail and TV mode)

**Type:** Positive · **Priority:** Medium · **Role:** Viewer · **Flow:** F5.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Look at the "Team performance" section and the summary card. | Only The Away Team is listed and the summary card is titled "Your team". |
| 3 | Open http://localhost:3000/api/teams/team-1764026236967-uphpblii4 and then http://localhost:3000/api/tv/teams/team-1764026236967-uphpblii4 in the same browser. | Both answer 403: team detail and TV mode follow the analytics scope. |

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer sees only the teams she is assigned to on the dashboard`

## Organisation: departments

### TC-ORG-026: Create, rename and delete a department; a duplicate name is refused; cancelling a delete keeps it

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F12.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- Department name: Dept <6 random characters>, e.g. Dept a1b2c3

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open the navigation and click "Departments". | The "Departments" page shows a table with Department, Description, Teams, Users, Created, Actions. |
| 3 | Click "Create department", type "Dept a1b2c3" in "Department Name" and click "Create department" in the dialog. | "Department created successfully!" appears and the department is listed in the table. |
| 4 | Click "Create department" again, enter the same name "Dept a1b2c3" and click "Create department". | An error starting "Failed to create department" appears; no second department is created. |
| 5 | Click "Cancel" in the dialog. | The dialog closes. |
| 6 | Click the edit (pencil) button of "Dept a1b2c3", change "Department Name" to "Dept a1b2c3 renamed" and click "Save changes". | "Department updated successfully!" appears and the table shows the new name. |
| 7 | Click the delete (bin) button of "Dept a1b2c3 renamed". | A confirmation "Are you sure?" appears with "No, cancel!" and "Yes, delete it!". |
| 8 | Click "No, cancel!". | The dialog closes and "Dept a1b2c3 renamed" is still listed. |
| 9 | Click the delete button again and click "Yes, delete it!". | "Department deleted successfully!" appears and the department is no longer in the table. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Departments › ORG-01 create, rename and delete a department; a duplicate name is refused; cancelling a delete keeps it`

### TC-ORG-027: A department name with markup is stored and shown as plain text, never run

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F12.1, F16.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- Department name: X <img src=x onerror="window.__xss=1">

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /departments. | The "Departments" page opens. |
| 3 | Click "Create department", enter the name X <img src=x onerror="window.__xss=1"> and click "Create department" in the dialog. | The department is created. |
| 4 | Look at the table. | The name is shown literally as typed, including "<img src=x onerror=...>" as text; no broken image icon appears. |
| 5 | Open DevTools > Console and check the value of window.__xss. | It is undefined: the markup was not executed. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

**Notes:** The last step uses DevTools (Console).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Departments › ORG-02 a department name with markup is stored and shown as text`

### TC-ORG-028: A team moves to another department after the move plan is shown

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F12.2

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- New department: Second Department

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /departments, click "Create department", enter "Second Department" and confirm. | "Department created successfully!" appears; "Second Department" is listed with 0 teams. |
| 3 | Click the department name "Engineering" in the table. | The department expands and shows its team "Core Team" with a "Move to…" drop-down. |
| 4 | In the "Move to…" drop-down of Core Team choose "Second Department". | A dialog opens describing "What moves with Core Team" (members, assignments) and a button "Move to Second Department". |
| 5 | Click "Move to Second Department". | The dialog closes and a confirmation "Core Team moved to Second Department..." appears. |
| 6 | Look at the "Second Department" row. | Its Teams count is 1. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Moving teams and the Admin console › ORG-03 a team moves to another department after the move plan is shown`

## Organisation: teams

### TC-ORG-029: The Admin console creates a team that then appears on the Teams page

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F12.12, F12.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- Team name: Console Team <5 random characters>, e.g. Console Team x1y2z

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open the navigation and click "Admin console" (/admin-panel). | The Admin console opens. |
| 3 | Click "Create Team". | A form with "Team Name" (and a department choice when offered) appears. |
| 4 | Enter "Console Team x1y2z" as Team Name, choose department "Engineering" if asked, and click "Create Team" in the form. | A confirmation "Team created successfully!" appears. |
| 5 | Open the navigation and click "Teams". | The "Teams" page opens and lists "Console Team x1y2z". |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Moving teams and the Admin console › ORG-04 the Admin console creates a team that then appears on the Teams page`

### TC-ORG-030: Create, edit and delete a team

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F12.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- Team name: Team <6 random characters>, e.g. Team q1w2e3

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /teams. | The "Teams" page opens with a "Create team" button. |
| 3 | Click "Create team", enter "Team q1w2e3" in "Team name", choose department "Engineering", click "Create". | "Team created" appears and "Team q1w2e3" is listed. |
| 4 | Click the edit (pencil, "Edit team") button of "Team q1w2e3", change the name to "Team q1w2e3 2" and click "Save". | "Team updated" appears and the row shows "Team q1w2e3 2". |
| 5 | Click the delete ("Delete team") button of "Team q1w2e3 2". | A confirmation "Are you sure?" appears with "No, cancel!" and "Yes, delete it!". |
| 6 | Click "Yes, delete it!". | "Team q1w2e3 2" is removed from the list. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Teams › ORG-10 create, edit and delete a team`

### TC-ORG-031: A team needs a name and a department; a very long unicode name does not break the list

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F12.4, F16.11

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- Long name: "Ünïcødé 团队 🚀 " followed by "Long-Name-" repeated 20 times

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /teams and click "Create team". | The "Create team" dialog opens. |
| 3 | Leave everything empty and click "Create". | The dialog stays open; the browser marks "Team name" as a required field ("Please fill out this field"). No team is created. |
| 4 | Enter the long unicode name, choose department "Engineering" and click "Create". | "Team created" appears (or a clear message that the name is too long). |
| 5 | Look at the Teams page and scroll sideways if possible. | The page does not scroll sideways: the long name wraps or is truncated inside the list. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Teams › ORG-11 a team needs a name and a department; a very long unicode name does not break the list`

## Organisation: users

### TC-ORG-032: A super admin adds a user with a password, edits, deactivates, reactivates and deletes them

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F12.6, F12.7, F12.8, F12.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- New user: Pat Person, person-<unique>@<organisation domain>
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open the navigation and click "Users". | The "Users" page opens with "Invite" and "Add with password" buttons. |
| 3 | Click "Add with password" (Demo). In the dialog "Add a user with a password" enter First Name "Pat", Last Name "Person", Email "person-<unique>@<organisation domain>", Password "Ui-Tests-Passw0rd!", Role "Software engineer", Department "Engineering", Primary Team "Core Team", then click "Create User". | "User created successfully!" appears; a card for Pat Person with the e-mail shows the status badge "Active". |
| 4 | On Pat Person's card click "Edit", change First Name to "Patricia" and click "Save Changes". | "User updated successfully!" appears and the card shows "Patricia". |
| 5 | Click the "Deactivate" button on the card. | The status badge changes to "Inactive". |
| 6 | Click the "Activate" button on the card. | The status badge changes back to "Active". |
| 7 | Click "Delete" on the card. | A confirmation "Are you sure?" appears with "No, cancel!" and "Yes, delete it!". |
| 8 | Click "Yes, delete it!". | "User deleted!" appears. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Users and assignments › ORG-20 a super admin adds a user with a password, edits, deactivates, reactivates and deletes them`

### TC-ORG-033: Adding a user with an e-mail already in use or a weak password is refused with the reason

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F12.6

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- E-mail in use: viewer@irongate.com
- Weak password: abc

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /users. | The "Users" page opens. |
| 3 | Click "Add with password" (Demo). In the dialog "Add a user with a password" enter First Name "Dup", Last Name "Licate", Email "viewer@irongate.com", Password "Ui-Tests-Passw0rd!", Role "Software engineer", Department "Engineering", Primary Team "Core Team", then click "Create User". | An error message starting "Failed: " appears (the e-mail is already in use). No user is created. |
| 4 | Click "Cancel" in the dialog. | The dialog closes. |
| 5 | Click "Add with password" (Demo). In the dialog "Add a user with a password" enter First Name "Weak", Last Name "Password", Email "weak-<unique>@<organisation domain>", Password "abc", Role "Software engineer", Department "Engineering", Primary Team "Core Team", then click "Create User". | An error message starting "Failed: " appears (password too weak). |
| 6 | Look at the user cards. | There is no card for "Weak Password". |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Users and assignments › ORG-21 adding a user: an e-mail already in use and a weak password are refused with the reason`

### TC-ORG-034: User names with markup are shown as text on the Users page

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F12.6, F16.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- First name: <img src=x onerror="window.__xss=1">
- Last name: <b>Bold</b>
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /users. | The "Users" page opens. |
| 3 | Click "Add with password" (Demo). In the dialog "Add a user with a password" enter First Name "<img src=x onerror="window.__xss=1">", Last Name "<b>Bold</b>", Email "xss-<unique>@<organisation domain>", Password "Ui-Tests-Passw0rd!", Role "Software engineer", Department "Engineering", Primary Team "Core Team", then click "Create User". | Either "User created successfully!" or an error starting "Failed: " appears. |
| 4 | If the user was created, look at their card. | The names appear literally as text; "Bold" is not shown in bold and no broken image appears. |
| 5 | In DevTools > Console check window.__xss. | It is undefined: no markup was executed. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

**Notes:** The last step uses DevTools (Console).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Users and assignments › ORG-22 names with markup are shown as text on the users page`

### TC-ORG-035: A role assignment is added as a chip and removed again after a confirmation in the page

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F12.10

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- New user: Chip Holder
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /users. | The "Users" page opens. |
| 3 | Click "Add with password" (Demo). In the dialog "Add a user with a password" enter First Name "Chip", Last Name "Holder", Email "chip-<unique>@<organisation domain>", Password "Ui-Tests-Passw0rd!", Role "Software engineer", Department "Engineering", Primary Team "Core Team", then click "Create User". | "User created successfully!" appears; Chip Holder's card shows their assignment chip(s), e.g. "Software engineer · Core Team". Note the number of chips. |
| 4 | On Chip Holder's card click "+ Add". In "Add an assignment for Chip Holder" choose Role "Viewer", choose a team/department in the second drop-down, click "Add assignment". | The dialog closes; the card shows one more chip "Viewer · <scope>". |
| 5 | Click the small x on the "Viewer · <scope>" chip (Remove Viewer of <scope> from Chip Holder). | A dialog "Remove this assignment?" opens in the page: "Remove Viewer of <scope> from Chip Holder? …" with Cancel and Remove assignment. No browser pop-up. |
| 6 | Click Cancel. | The dialog closes; the Viewer chip is still there. |
| 7 | Click the x again and press Escape. | The dialog closes; the chip is still there. |
| 8 | Click the x again and click "Remove assignment". | A message "Chip Holder: removed Viewer of <scope>" appears and the chip count is back to the original number. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

**Notes:** Removing an assignment asks first (FI-17, fixed).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Users and assignments › ORG-23 an assignment is added as a chip and removed again after a confirmation in the page`

### TC-ORG-036: Nobody can deactivate or delete themselves

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F12.8, F12.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /users. | The "Users" page opens. |
| 3 | Find your own card (Uitest Owner, owner@<unique>.uitest.example). | Your card is shown. |
| 4 | Look at the buttons on your own card. | There is no "Deactivate" button and no "Delete" button on your own card. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Users and assignments › ORG-24 nobody can deactivate or delete themselves`

### TC-ORG-037: A manager cannot edit or remove the super admin (UI hides it, API refuses it)

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F12.8, F4.4, F2.3

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- Browser developer tools available.
- The id of the super admin user admin@irongate.com (from a developer, or from DevTools > Network: the response of GET /api/admin/users when signed in as super admin).

**Test data**

- Manager: manager@irongate.com / demo123
- Super admin e-mail: admin@irongate.com

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Manager (manager@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /users and type "admin@irongate.com" in "Search users by name, email, team...". | Either no card is shown (the super admin is outside the manager's scope) or the Admin User card is shown. |
| 3 | If the super admin's card is shown, look at its buttons. | The card has no "Deactivate" and no "Delete" button. |
| 4 | In DevTools > Console send a POST request (credentials included) to http://localhost:3000/api/admin/users/<super admin id>/toggle-status and look at it in the Network tab. | The request is refused with status 403. |
| 5 | Sign out, sign in as Super admin (admin@irongate.com / demo123). | Sign-in succeeds: the super admin is still active. |

**Notes:** Requires DevTools (request sent from the Console).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Users and assignments › ORG-25 a manager cannot edit or remove the super admin`

## Activity

### TC-ORG-038: The Activity log records a deactivation; Undo restores it and cannot be done twice

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F13.1, F13.2

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- New user: Undo Me
- Password: Ui-Tests-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /users. | The "Users" page opens. |
| 3 | Click "Add with password" (Demo). In the dialog "Add a user with a password" enter First Name "Undo", Last Name "Me", Email "undo-<unique>@<organisation domain>", Password "Ui-Tests-Passw0rd!", Role "Software engineer", Department "Engineering", Primary Team "Core Team", then click "Create User". | "User created successfully!" appears; Undo Me's card shows "Active". |
| 4 | Click "Deactivate" on Undo Me's card. | The status changes to "Inactive". |
| 5 | Open the navigation and click "Activity". | The "Activity" page lists one entry starting "Deactivated Undo Me" with an "Undo" button. |
| 6 | Click "Undo" on that entry. | A dialog "Undo this change?" shows the summary and the buttons "Cancel" and "Undo". |
| 7 | Click "Undo" in the dialog. | A new entry "Undid: Deactivated Undo Me..." appears; the original entry shows "Undone" and "· undone by <your name> on <date>" and no longer has an "Undo" button. |
| 8 | Open the navigation and click "Users". | Undo Me's card shows the status "Active" again. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Activity and user activity › ORG-30 the Activity log records a deactivation; Undo restores it and cannot be done twice`

### TC-ORG-039: Activity search narrows the list; a search with no match says so

**Type:** Negative · **Priority:** Low · **Role:** Super admin · **Flow:** F13.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- Search text: no-such-thing-<random>

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /activity. | The Activity page lists at least one entry (e.g. the creation of the organisation). |
| 3 | Type "no-such-thing-<random>" into "Search". | No entries remain; the empty state "No changes match" is shown. |
| 4 | Clear the "Search" field. | The entries are listed again. |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Activity and user activity › ORG-31 Activity search narrows the list; a search with no match says so`

### TC-ORG-042: Activity is in the navigation for a super admin and opens the Activity log

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F13.1, F4.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded

**Test data**

- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Click the menu (burger) button. | The navigation opens and contains "Activity". |
| 3 | Click "Activity". | The page heading "Activity" is shown with a list of changes, or "No changes match" when there are none. |

**Notes:** Managers also have this entry (covered elsewhere).

*Automated:* `tests/e2e/organisation.spec.ts › Organisation, invitations and activity › Activity is in the navigation for super admins and QA managers only`

### TC-ORG-043: A software engineer has no Activity page

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F13.1, F4.3

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded

**Test data**

- Software engineer: engineer@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Software engineer (engineer@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Click the menu (burger) button. | The navigation opens; there is no "Activity" entry. |
| 3 | Enter /activity in the address bar and press Enter. | The Overview (dashboard) is shown and the address changes to "/", with the alert "You don't have access to Activity." |

**Notes:** The redirect shows "You don't have access to <page>." (FI-14, fixed).

*Automated:* `tests/e2e/organisation.spec.ts › Organisation, invitations and activity › An engineer has no Activity page`

## User activity

### TC-ORG-040: User activity lists the sign-in and screens; filters work; CSV export contains the user

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F13.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A new, empty organisation registered through "Create an account" on the sign-in page: first name Uitest, last name Owner, e-mail owner@<unique>.uitest.example, password Ui-Tests-Passw0rd!, organisation name "UI Test <unique>", department "Engineering", team "Core Team". Its registrant is its super admin (referred to below as "the owner").

**Test data**

- Owner e-mail: owner@<unique>.uitest.example
- Owner password: Ui-Tests-Passw0rd!
- Request id: no-such-request-<random>

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as the owner (super admin) of the new test organisation (owner@<unique>.uitest.example / Ui-Tests-Passw0rd!). | The Overview of the test organisation opens. |
| 2 | Open /compare, then open /user-activity. | The "User activity" page opens with the notice "Every action by your users is recorded for 90 days..." and a list of entries (your sign-in and the screens you opened). |
| 3 | In "Action type" choose the first type after "All actions". | The list shows only entries of that type, or "No activity matches". |
| 4 | Set "Action type" back to "All actions" and type "no-such-request-<random>" into "Request id". | No entries remain ("No activity matches"). |
| 5 | Clear "Request id" and click "Export CSV". | A .csv file is downloaded. |
| 6 | Open the downloaded file. | It contains the owner's e-mail address (owner@<unique>.uitest.example). |

**After the test:** The test organisation cannot be removed in the app: ask a developer to delete it from the test database, or leave it (it is isolated from the demo data).

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Activity and user activity › ORG-32 User activity lists the sign-in and screens; filters; CSV export`

### TC-ORG-041: A manager has no User activity page and the API refuses it

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F13.4, F4.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded

**Test data**

- Manager: manager@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Manager (manager@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Enter /user-activity in the address bar and press Enter. | The Overview (dashboard) is shown instead; there is no User activity page. |
| 3 | In the same browser open http://localhost:3000/api/activity/log in a new tab (or check the request in DevTools > Network). | The API answers with status 403 (an error instead of activity data). |

**Notes:** The API check uses a direct address or DevTools.

*Automated:* `tests/e2e/org/organisation-admin.spec.ts › Activity and user activity › ORG-33 a manager has no User activity and the API refuses it`

### TC-ORG-057: A super admin sees the user activity with the privacy notice and can filter by sign-ins

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F13.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded

**Test data**

- Super admin: admin@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Click the menu (burger) button and click "User activity". | The page heading "User activity" is shown. |
| 3 | Read the notice at the top. | It reads "Every action by your users is recorded for 90 days. Let your staff know..." |
| 4 | Look at the list. | At least one activity entry is listed. |
| 5 | In "Action type" choose the sign-in type. | The first entry in the list is a "Sign-in" entry. |

*Automated:* `tests/e2e/platform-operator.spec.ts › User activity › super admins see the user activity with the privacy notice`

### TC-ORG-058: A manager has no User activity page

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F13.4, F4.3

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded

**Test data**

- Manager: manager@irongate.com / demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Manager (manager@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Enter /user-activity in the address bar and press Enter. | The Overview (dashboard) is shown and the address changes to "/", with the alert "You don't have access to User activity." |

**Notes:** The redirect shows "You don't have access to <page>." (FI-14, fixed).

*Automated:* `tests/e2e/platform-operator.spec.ts › User activity › a QA manager has no User activity page`

## Invitations

### TC-ORG-044: Invite by e-mail, then accept the invitation (weak password refused) and sign in; the link works only once

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F3.3, F3.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- E-mail delivery is not configured on the server, so the invitation link is shown in the app.
- A second browser or a private window for the invited person.

**Test data**

- Super admin: admin@irongate.com / demo123
- Invitee e-mail: e2e-invite-<timestamp>@irongate.test
- Name: Eto Invited
- Weak password: Weak
- Strong password: Str0ng-Passw0rd

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in page and sign in as Super admin (admin@irongate.com / demo123). | The Overview opens; the top bar shows the menu (burger) button. |
| 2 | Open /users and click "Invite". | The dialog "Invite a person" opens with Email address, Role and scope fields. |
| 3 | Enter the invitee e-mail, choose Role "Viewer" (and a scope if asked) and click "Send invitation". | An amber box says "No email was sent. ... Send this link to <e-mail> yourself; it works once." and shows the invitation link containing "/accept-invite?token=igi_". |
| 4 | Copy the link and open it in a private window. | The page shows the heading "Join NovaTech..." ("Join <organisation>") with the role "Viewer". |
| 5 | Enter First name "Eto", Last name "Invited", Password and Repeat the password "Weak", click "Accept and sign in". | An error reads "Choose a stronger password (see the rules below)." |
| 6 | Change both password fields to "Str0ng-Passw0rd" and click "Accept and sign in". | The account is created and the Overview (dashboard) opens for the new viewer. |
| 7 | In the same private window open the invitation link again. | Either "This invitation cannot be used" with a message that the invitation has already been used, or "You are already signed in". |

**After the test:** As super admin, delete (deactivate) the user e2e-invite-<timestamp>@irongate.test on the Users page.

*Automated:* `tests/e2e/organisation.spec.ts › Organisation, invitations and activity › Invite by email, then accept the invitation and sign in`

## Platform support

### TC-ORG-045: Manager: no Platform entry; /operator asks for a platform support account

**Type:** Negative · **Priority:** High · **Role:** Manager · **Flow:** F14.1, F4.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Manager (manager@irongate.com / demo123) and open the navigation (menu button at the left of the top bar). | There is no "Platform" entry in the navigation. |
| 2 | Open /operator in the address bar. | The "Platform support sign-in" form (E-mail address, Password, Sign in) is shown, not the platform overview: the company session does not count here. |

**Notes:** Platform operators are separate accounts (platform_operators), never company users.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-01 manager: no Platform entry; /operator asks for a platform support account`

### TC-ORG-046: Team lead: no Platform entry; /operator asks for a platform support account

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F14.1, F4.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Team lead (lead@irongate.com / demo123) and open the navigation (menu button at the left of the top bar). | There is no "Platform" entry in the navigation. |
| 2 | Open /operator in the address bar. | The "Platform support sign-in" form (E-mail address, Password, Sign in) is shown, not the platform overview: the company session does not count here. |

**Notes:** Platform operators are separate accounts (platform_operators), never company users.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-01 lead: no Platform entry; /operator asks for a platform support account`

### TC-ORG-047: Software engineer: no Platform entry; /operator asks for a platform support account

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F14.1, F4.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Software engineer (engineer@irongate.com / demo123) and open the navigation (menu button at the left of the top bar). | There is no "Platform" entry in the navigation. |
| 2 | Open /operator in the address bar. | The "Platform support sign-in" form (E-mail address, Password, Sign in) is shown, not the platform overview: the company session does not count here. |

**Notes:** Platform operators are separate accounts (platform_operators), never company users.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-01 engineer: no Platform entry; /operator asks for a platform support account`

### TC-ORG-048: Viewer: no Platform entry; /operator asks for a platform support account

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F14.1, F4.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Viewer (viewer@irongate.com / demo123) and open the navigation (menu button at the left of the top bar). | There is no "Platform" entry in the navigation. |
| 2 | Open /operator in the address bar. | The "Platform support sign-in" form (E-mail address, Password, Sign in) is shown, not the platform overview: the company session does not count here. |

**Notes:** Platform operators are separate accounts (platform_operators), never company users.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-01 viewer: no Platform entry; /operator asks for a platform support account`

### TC-ORG-049: The support session survives a reload; Sign out ends it

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Errors (24 h), Database size, Jobs failing, the "Companies" table and the "Scheduled jobs" table. |
| 2 | Reload the page (F5). | The platform overview is shown again without signing in (8-hour session). |
| 3 | Click "Sign out" in the amber bar. | The "Platform support sign-in" form is shown. |
| 4 | Reload the page. | The sign-in form is still shown. |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-02 the support session survives a reload; Sign out ends it`

### TC-ORG-050: Tabs: error search by request id (none found) and platform sign-ins; there is no access log tab

**Type:** Positive · **Priority:** Medium · **Role:** Platform operator · **Flow:** F14.2

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 2 | Click "Error search", type a made-up request id (e.g. no-such-request-123) and click "Search". | The "Server errors" list says "No errors." |
| 3 | Click "Sign-ins". | "Sign-in events" lists sign-ins of every company with When, Company, User (or "Unknown e-mail"), Outcome, Type, IP, Location, Device and Request id, with filters and a CSV button. |
| 4 | Look at the tabs at the top right. | Only Overview, Sign-ins and Error search are offered; there is no "Access log" tab (operator activity is not logged). |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-03 tabs: error search by request id (none found) and platform sign-ins; no access log tab`

### TC-ORG-051: A destructive action waits for the "I want to do this now" tick; Cancel changes nothing

**Type:** Negative · **Priority:** High · **Role:** Platform operator · **Flow:** F14.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- A fresh organisation registered for this test (Create an account: any company name, its owner's e-mail and password); delete it afterwards in platform support (Delete, type its name).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 2 | Click the fresh organisation's name in "Companies". | The company opens at once on the Organisation tab (no reason is asked for). |
| 3 | Click the "Users" tab, then "Deactivate" in the owner's row. | A dialog "Deactivate account" explains the effect; "Deactivate" is disabled until "I want to do this now" is ticked. |
| 4 | Click "Cancel". | The dialog closes; the owner is still "Active". |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-04 a destructive action waits for the confirmation tick; Cancel changes nothing`

### TC-ORG-052: A failed repair action shows the error with its request id

**Type:** Negative · **Priority:** Medium · **Role:** Platform operator · **Flow:** F14.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 2 | In DevTools → Network, block (or override with a 500 answer) the URL pattern */api/operator/actions/*. | — |
| 3 | Click "Refresh sample data now" under "Scheduled jobs". | It runs at once (no dialog) and an error message shows the server's error with "(request id …)" when the server sent one. |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes. Requires DevTools request blocking or an override.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-05 a failed repair action shows the error with its request id`

### TC-ORG-053: Nothing of the operator's visit or changes appears in the company's Activity log

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F13.5

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- A fresh organisation registered for this test (Create an account: any company name, its owner's e-mail and password); delete it afterwards in platform support (Delete, type its name).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 2 | Open the fresh organisation; on Organisation click "Add department", type a unique name (e.g. Ops dept 123) and click "Save". | The new department appears on the Organisation tab. |
| 3 | Click "Sign out". Sign in to the app as the organisation's owner and open Organisation → Activity. | The Activity log shows the organisation's own entries (e.g. its creation) but nothing by "platform support" and no entry for the new department. |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-06 nothing of the operator's visit or changes reaches the company's Activity log`

### TC-ORG-054: The operator signs in at /operator (wrong password refused), opens a company, runs an action and signs out

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.1, F14.2, F14.3, F14.4, F14.5

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator. | The amber bar reads "IronGate platform support" and the "Platform support sign-in" form is shown. |
| 2 | Enter the operator's e-mail and the password not-the-password, click "Sign in". | An error reads "Wrong e-mail address or password." |
| 3 | Enter the right password and click "Sign in". | The platform overview opens; "Scheduled jobs" lists the jobs with their last run, or says "No runs recorded yet."; "Main tables" lists companies, users, … with row counts. |
| 4 | Click a company name in "Companies". | The company opens at once on the Organisation tab (no reason is asked for). |
| 5 | Click the "Users" tab. | The users table shows Name, Status, Assignments, Last sign-in (time, IP and location, device), Sessions now, Last seen, Failed 7 d. |
| 6 | Click "Re-run alerts". | It runs at once (no dialog) and a message "Alerts evaluated: … opened, … resolved" appears. |
| 7 | Click "Sign out". | The sign-in form is shown. |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform-operator.spec.ts › Platform support panel › the operator signs in at /operator, opens a company, runs an action and signs out`

### TC-ORG-055: The platform support panel works at 390 px phone width without sideways scrolling

**Type:** Positive · **Priority:** Low · **Role:** Platform operator · **Flow:** F14.6, F4.11

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Set the browser window (or DevTools device toolbar) to 390 × 844. | The page is narrow. |
| 2 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Errors (24 h), Database size, Jobs failing, the "Companies" table and the "Scheduled jobs" table. |
| 3 | Scroll the overview sideways. | The page does not scroll sideways (wide tables scroll inside their cards). |
| 4 | Open a company. | The Organisation tab shows without sideways scrolling of the page. |
| 5 | Click the "Users" tab. | The users table scrolls inside its card; the page does not scroll sideways. |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform-operator.spec.ts › Platform support panel › works at 390 px without sideways scrolling`

### TC-ORG-056: Company users have no Platform entry and cannot sign in at /operator

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F14.1, F4.1, F13.4

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) and open the navigation. | "User activity" is listed; there is no "Platform" entry. |
| 2 | Open /operator. | The "Platform support sign-in" form is shown (the company session does not count). |
| 3 | Enter admin@irongate.com and demo123 and click "Sign in". | An error reads "Wrong e-mail address or password.": a company account cannot sign in to platform support. |

**Notes:** Platform operators and company users are kept apart: the same e-mail address cannot be both.

*Automated:* `tests/e2e/platform-operator.spec.ts › Platform support panel › company users have no Platform entry and cannot sign in at /operator`

### TC-ORG-059: Refresh sample data now: started in the background on the hosted site, run directly on a local server

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.7

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 2 | Click "Refresh sample data now" under "Scheduled jobs" on the hosted site (Netlify). | It runs at once (no reason, no dialog); a message says "Sample data refresh started. It runs in the background for a few minutes." |
| 3 | On a local server, click "Refresh sample data now" again. | A message says "Sample data refreshed: N new rows." |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-07 "Refresh sample data now": started in the background on the hosted site, run directly elsewhere`

### TC-ORG-060: Super admin: no Platform entry; /operator asks for a platform support account

**Type:** Negative · **Priority:** High · **Role:** Super admin · **Flow:** F14.1

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Sign in as Super admin (admin@irongate.com / demo123) and open the navigation. | There is no "Platform" entry. |
| 2 | Open /operator. | The "Platform support sign-in" form is shown, not the platform overview. |

**Notes:** Platform operators are separate accounts (platform_operators), never company users.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-01 admin: no Platform entry; /operator asks for a platform support account`

### TC-ORG-061: Every module of a company in detail: all developer rows, single pulse answers, module data

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.8

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- The sample company Northwind Payments (Sample data) is loaded (npm run seed:demo).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!
- Reason: UI test: full data views

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Errors (24 h), Database size, Jobs failing, the "Companies" table and the "Scheduled jobs" table. |
| 2 | In "Companies", click Northwind Payments (Sample data). | The company opens at once on the Organisation tab (no reason is asked for). |
| 3 | Click the "Data" tab. | "Developer metrics" lists every developer of the first team with the columns Developer, E-mail, Opted in (yes / no), PR merge, Review, Focus, Meetings, Switches, Happiness, Updated. |
| 4 | Click the "Wellbeing pulse" tab. | The note reads "… every single answer with its comment, and who answered in each period. The app never stores which person gave which answer."; each team shows its answers (Workload, Focus, Support, Energy, Outlook, Comment) and who answered. |
| 5 | Click the "Modules" tab. | One table per module (Test execution runs, Flaky tests, Technical debt, Pipeline runs, Performance metrics, …) with its row count and newest rows for the chosen team. |
| 6 | Click the "Settings & targets" tab and look at a credential setting such as jira_api_token, if one is set. | Its value reads "set" (never the token itself). |

**Notes:** Secrets are never shown: password, API key and token hashes, link tokens, the Slack webhook, integration credentials.

*Automated:* `tests/e2e/platform/operator-extras.spec.ts › Platform support panel › OPS-08 every module of a company in detail: all developer rows, single pulse answers, module data`

### TC-ORG-062: Create a company with its first person (Super admin by default), then add a department, a team and a person

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 2 | Click "Create company". Enter a unique company name and, under "First person: e-mail", the first person's e-mail (e.g. boss@<unique>.example). | A "Role" field appears with "Super admin" selected and the help text "Every company needs a super admin to manage it; you can also manage it yourself from this panel." |
| 3 | Keep the role "Super admin", choose "Password set now", enter first name, last name and a strong password (e.g. Ui-Tests-Passw0rd!) and click "Create company". | A message says "<name> created" and the new company opens with its first department "General" and team "Team 1". |
| 4 | Click "Add department", type Quality and click "Save". | A section "Quality" appears. |
| 5 | Click "Add team", type Beta squad, choose the department Quality and click "Save". | Beta squad is listed under Quality. |
| 6 | Open "Users", click "Add person", fill first name, last name, a new e-mail, role Software engineer, team Beta squad and a strong password, click "Save". | The person appears in the users table. |
| 7 | Click "Add person" again with the same e-mail. | The form shows "Email already registered" (the company app's own rule). |
| 8 | Sign in to the app (/) with the super admin's e-mail and password. | The dashboard opens; the person is a super admin of the new company. |

**After the test:** Delete the company in platform support (Delete, type its name).

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-crud.spec.ts › Platform support: changes › OPC-01 create a company, then a department, a team and a person`

### TC-ORG-063: A person's page: sign-in history and sessions; Revoke ends exactly one session

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.10

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- A fresh organisation registered for this test (Create an account: any company name, its owner's e-mail and password); delete it afterwards in platform support (Delete, type its name).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | In a second browser (or a private window), sign in to the app as the fresh organisation's owner. | The dashboard opens. |
| 2 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 3 | Open the organisation, click "Users". | The owner's row shows "Last sign-in" with time, IP, location and browser / OS / device, and "Sessions now" of at least 1. |
| 4 | Click "Details" in the owner's row. | The person's page shows Profile, Role assignments and teams, Sessions (status Valid, issued, expires, last seen, IP, location, device), Sign-in history (Success, Password) and Recent activity. |
| 5 | Click "Revoke" in a Valid session row. | A dialog "Revoke session" asks for the "I want to do this now" tick; "Revoke" is disabled until then. |
| 6 | Tick the box and click "Revoke". | That session's status becomes "Revoked" (by IronGate platform support); the other sessions stay Valid. |
| 7 | In the second browser, click anything in the app. | If that browser's session was the revoked one, the sign-in screen says "Your session has ended. Please sign in again." |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-crud.spec.ts › Platform support: changes › OPC-02 a person's sign-ins and sessions; Revoke ends one session`

### TC-ORG-064: Suspend a company until it pays: its people see why; reactivate

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.11

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- A fresh organisation registered for this test (Create an account: any company name, its owner's e-mail and password); delete it afterwards in platform support (Delete, type its name).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | In a second browser, sign in to the app as the fresh organisation's owner. | The dashboard opens. |
| 2 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 3 | Open the organisation and click "Suspend". Enter the reason "Invoice 2026-11 unpaid" and the billing note "Pay by bank transfer". | "Suspend company" stays disabled until "I want to do this now" is ticked. |
| 4 | Tick the box and click "Suspend company". | A red note says "Suspended <date> by <operator>: Invoice 2026-11 unpaid · Pay by bank transfer" and the header shows a "Suspended" badge. |
| 5 | Go back to all companies. | The company's Status shows "Suspended". |
| 6 | In the second browser, reload the page. | The sign-in screen says "Your organisation's access is suspended. Contact your administrator." |
| 7 | Sign in there again with the right password. | Sign-in is refused with the same message. (With a wrong password the usual "Invalid credentials" is shown.) |
| 8 | In platform support, open the company, click "Reactivate", tick the box and confirm. | The red note disappears and the badge shows "Active". |
| 9 | Sign in again in the second browser. | The dashboard opens. |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-crud.spec.ts › Platform support: changes › OPC-03 suspend a company until it pays; its people see why; reactivate`

### TC-ORG-065: Deleting a team or a company needs the typed name

**Type:** Negative · **Priority:** High · **Role:** Platform operator · **Flow:** F14.12

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 2 | Click "Create company", enter a unique name and an e-mail domain (e.g. <unique>.example), leave the super admin empty and click "Create company". | The new company opens with team "Team 1". |
| 3 | Click "Delete" next to Team 1 and type "Team". | The dialog says what is deleted; "Delete team for good" stays disabled. |
| 4 | Type "Team 1" exactly and click "Delete team for good". | Team 1 disappears from the Organisation tab. |
| 5 | Click "Delete" at the top and type the company name in lower case. | "Delete company for good" stays disabled. |
| 6 | Type the exact company name and click "Delete company for good". | The company is deleted (it no longer appears in "Companies"). |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-crud.spec.ts › Platform support: changes › OPC-04 deleting a team or a company needs the typed name`

### TC-ORG-066: A company's last views, sessions, access log (CSV) and sign-ins

**Type:** Positive · **Priority:** Medium · **Role:** Platform operator · **Flow:** F14.13

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- A fresh organisation registered for this test (Create an account: any company name, its owner's e-mail and password); delete it afterwards in platform support (Delete, type its name).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | In a second browser, sign in as the fresh organisation's owner and open their team (Core Team) once. | The team page opens. |
| 2 | Open /operator, enter the operator's e-mail and password under "Platform support sign-in" and click "Sign in". | The amber bar reads "IronGate platform support" with the operator's name and "Sign out"; the platform overview shows the tiles Companies, Active sessions, Sign-ins (7 days), Failed sign-ins (7 days), Errors (24 h), Database size, and the "Companies", "Scheduled jobs" and "Main tables" sections. |
| 3 | Open the organisation and click "Last views". | The Teams table shows Core Team with "Last viewed" a moment ago, "By" the owner (Uitest Owner), its views in 30 days and the most active viewers. |
| 4 | Click "Sessions". | The owner's session is listed with status "Valid". |
| 5 | Click "Access log", then "CSV". | The company's requests and screens are listed (filters incl. IP address); a .csv file is downloaded. |
| 6 | Click "Sign-ins", choose Outcome "Success" and click "Apply filters". | Only successful sign-ins are listed, with IP, location and device. |

**Notes:** Do not enter wrong passwords more than 4 times in a row: the 5th locks the operator account for 15 minutes.

*Automated:* `tests/e2e/platform/operator-crud.spec.ts › Platform support: changes › OPC-05 last views, sessions and the access log of a company`

### TC-ORG-067: Create a company whose first person is invited as a Software engineer of the first team

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.9

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator and sign in as the operator. | The platform overview is shown. |
| 2 | Click "Create company", enter a unique company name and a first person's e-mail (e.g. dev@<unique>.example). | The "Role" field shows "Super admin" with the help text "Every company needs a super admin to manage it; you can also manage it yourself from this panel." |
| 3 | Choose the role "Software engineer of the first team", keep "Invitation e-mail" and click "Create company". | The company opens. |
| 4 | Open "Users" and look at the invitations. | One pending invitation for dev@<unique>.example as Software engineer of "Team 1"; there is no super admin invitation. |
| 5 | Optional: repeat with "Manager of the first department" and "Password set now". | The person is created as Manager of "General" (no super admin assignment) and can sign in to the app. |

**After the test:** Delete the companies in platform support (Delete, type the name).

**Notes:** Before this change the first person was always a super admin. The operator can manage a company without a super admin from this panel.

*Automated:* `tests/e2e/platform/operator-crud.spec.ts › Platform support: changes › OPC-01b the first person can be invited as a software engineer of the first team; API tests/api/operator-crud.test.ts OPC-003c`

### TC-ORG-068: Demo Data: departments, Scrum teams and people with one year of data; the shared password is shown once

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.14

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- A fresh organisation registered for this test (Create an account: any company name, its owner's e-mail and password); delete it afterwards in platform support (Delete, type its name).

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!
- Sizes: Departments 1, Teams per department 1, Members per team 3

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, sign in as the operator and open the fresh organisation. | The company view opens with the buttons "Demo Data" and "Populate metrics". |
| 2 | Click "Demo Data". | A modal "Demo Data for <company>" opens with Departments (1–10) = 3, Teams per department (1–8) = 3, Members per team (3–12) = 6 and the preview "Creates 3 departments, 9 teams, 57 people and one year of data." |
| 3 | Change Members per team to 2. | The preview reads "Enter whole numbers within the ranges shown." and "Generate" is disabled. |
| 4 | Enter Departments 1, Teams per department 1, Members per team 3. | The preview reads "Creates 1 department, 1 team, 4 people and one year of data." |
| 5 | Click "Generate". | The modal says "Created 1 department, 1 team and 4 people. Now filling one year of data…" with a progress bar and the step, and asks to keep the window open. |
| 6 | Wait until the job finishes (under a minute locally). | "Done: 1 department, 1 team and 4 people with one year of data (… rows)." The shared password is shown with a "Copy" button, and "One sign-in per role level" lists Manager (Head of … Engineering), Team lead (Scrum Master), Software engineer and Viewer (Product Owner) with e-mail addresses on the company's domain. |
| 7 | Click "Copy", then "Done". Open the Organisation section. | The modal closes. A new department (e.g. Payments) with its manager and a new team (e.g. Checkout Core) with its four people are listed. |
| 8 | In a private window sign in to the app with the Team lead's e-mail and the copied password and open the team. | The sign-in works. The team shows a year of history: KPI trends over 12 months, pipelines, tests, flaky tests, technical debt, DORA, sprints, the wellbeing pulse with comments, actions and alerts. No sample-data banner is shown. |
| 9 | Back in platform support, click "Demo Data" again. | The password of the first run is not shown again (it was shown once only). |

**After the test:** Delete the organisation in platform support (Delete, type its name).

**Notes:** Each run adds new departments and teams with new names; existing ones and other companies are never changed. On Netlify the data is written by a background function and the modal polls it. If the company uses a public e-mail domain (gmail.com…), the e-mails are first.last@<company-slug>.example.

*Automated:* `tests/e2e/platform/operator-demo-data.spec.ts › Platform support: Demo Data › OPD-01 Demo Data: sizes and preview, progress, then the password and one login per role level; Populate metrics`

### TC-ORG-069: Populate metrics fills a year of data for teams without data and creates nobody

**Type:** Positive · **Priority:** High · **Role:** Platform operator · **Flow:** F14.14

**Preconditions**

- App running at the test URL (local: http://localhost:5173, API on http://localhost:3000) with the NovaTech demo data loaded
- A platform operator account exists (platform support, not a company user): create it with npm run operator:create -- --email operator@platform-support.uitest.example --name "UI Test Operator" (password Ui-Operator-Passw0rd!).
- A fresh organisation registered for this test; as its owner (Users page) add a team lead and two software engineers to its team.

**Test data**

- Operator: operator@platform-support.uitest.example / Ui-Operator-Passw0rd!

| Step | Action | Expected result |
|---|---|---|
| 1 | Open /operator, sign in as the operator and open the organisation. Note the number of users. | The company view opens. |
| 2 | Click "Populate metrics". | A modal "Populate metrics of <company>" explains that one year of sample data is filled for every team without data, that nobody is created and that a team without a team lead or software engineer is skipped. |
| 3 | Click "Populate metrics" in the modal and wait. | A progress bar is shown, then "Done: one year of data for 1 team (… rows)." No password is shown. |
| 4 | Check the number of users. | Unchanged: nobody was created. |
| 5 | Sign in as the organisation's owner and open the team. | Every module shows a year of data (KPIs, pipelines, tests, pulse, sprints, actions, alerts). |
| 6 | In platform support click "Populate metrics" again and run it. | "Done: one year of data for 0 teams (… rows); 1 team that already had sample data topped up." |

**After the test:** Delete the organisation in platform support (Delete, type its name).

**Notes:** Only one sample-data job runs per company at a time: a second start while one runs says "Sample data is already being generated for this company. Wait until it has finished."

*Automated:* `tests/e2e/platform/operator-demo-data.spec.ts › OPD-01 (Populate metrics part); API tests/api/demo-data.test.ts DD-008`

## Navigation and access control

### TC-ROLE-001: Viewer does not see a Settings entry anywhere in the app frame

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F4.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Look at the top bar for a user / profile menu button. If one exists, click it. | There is no Settings entry in the profile menu (if a menu exists). |
| 3 | Look at the whole visible page, including the top bar. | No item or link labelled "Settings" is visible. |
| 4 | Click the menu (burger) button at the left of the top bar to open the navigation drawer. | The navigation drawer opens and lists the navigation entries in groups (Quality, Delivery, Organisation, Administration). |
| 5 | Read the entries in the navigation drawer and the account area at its bottom. | There is no "Settings" entry; the account area shows only the name, the role "Viewer", "Sign out my other devices" and "Sign out" buttons. |

**Notes:** The app has no profile menu; the check is simply that no "Settings" text is shown to a viewer.

*Automated:* `tests/e2e/comprehensive-rbac.spec.ts › Comprehensive RBAC Additional Tests › Viewer cannot see Settings in profile menu`

### TC-ROLE-002: Software engineer is refused by the invite-member API

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F4.4, F3.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Request: POST http://localhost:3000/api/users/invite with body {"email":"test@example.com","role":"viewer"}

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address engineer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Open the navigation drawer. | There is no "Users" entry, so no Invite button is reachable in the UI. |
| 3 | Open DevTools (F12) > Console. Send a POST request with credentials to http://localhost:3000/api/users/invite with the JSON body e-mail test@example.com and role viewer (Content-Type: application/json), and print the response status. | The response status is 401, 403 or 404 (not 200/201). |
| 4 | Sign out and sign in as admin@irongate.com / demo123, open Users and look at the Invitations panel. | No invitation for test@example.com was created. |

**Notes:** Requires DevTools. A GET request can be sent by opening the API address in a new tab of the same signed-in browser (the session cookie is sent because it belongs to localhost). For other methods use the DevTools Console, e.g. fetch(URL, { method: "DELETE", credentials: "include" }).then(r => console.log(r.status)).

*Automated:* `tests/e2e/comprehensive-rbac.spec.ts › Comprehensive RBAC Additional Tests › QA Engineer cannot access Invite Member API`

### TC-ROLE-003: Team lead is refused when deleting a team through the API

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F4.4, F12.4

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Request: DELETE http://localhost:3000/api/teams/999999

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Open DevTools (F12) > Console. Send a DELETE request with credentials to http://localhost:3000/api/teams/999999 and print the response status. | The response status is 401, 403 or 404 (not 200/204). |
| 3 | Open the navigation drawer and click Teams. | The Teams page opens and the team lead's own team (The Away Team) is still listed; nothing was deleted. |

**Notes:** Requires DevTools. A GET request can be sent by opening the API address in a new tab of the same signed-in browser (the session cookie is sent because it belongs to localhost). For other methods use the DevTools Console, e.g. fetch(URL, { method: "DELETE", credentials: "include" }).then(r => console.log(r.status)).

*Automated:* `tests/e2e/comprehensive-rbac.spec.ts › Comprehensive RBAC Additional Tests › Team Lead cannot delete other teams`

### TC-ROLE-004: Super admin sees every navigation entry, full team detail and the Admin console

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F4.1, F6.2, F6.3, F12.12

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the menu (burger) button at the left of the top bar to open the navigation drawer. | The navigation drawer opens and lists the navigation entries in groups (Quality, Delivery, Organisation, Administration). |
| 3 | Read the entries of the navigation drawer. | Overview, Users, Teams, Departments, Analytics, Admin console, Manual metrics, Update frequency and Parameters are all visible. |
| 4 | Press Escape. | The navigation drawer closes (the menu button is no longer expanded). |
| 5 | Click the first team card in the "Team performance" section. | The team detail page opens with a breadcrumb "Overview / <team name>". |
| 6 | Scroll through the team detail page. | A "Team members" section, a "Team recommendations" card and a "Developer recommendations" section are all visible. |
| 7 | Type http://localhost:5173/admin-panel in the address bar and press Enter. | The Admin console page opens with the heading "Admin console" and a section "Organization Structure". |

*Automated:* `tests/e2e/super-admin-rbac.spec.ts › Super Admin Role-Based Access Control › Super Admin has full access to all features`

### TC-ROLE-007: Manager sees the teams of their departments on the overview and the manager navigation, without Departments

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F4.1, F5.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address manager@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Wait for the "Team performance" grid to load and read the departments of the cards. | Only teams of DevOps (the manager's department) are listed; the summary card is titled "Your teams". |
| 3 | Click the menu (burger) button at the left of the top bar to open the navigation drawer. | The navigation drawer opens and lists the navigation entries in groups (Quality, Delivery, Organisation, Administration). |
| 4 | Read the navigation entries. | Overview, Users, Teams, Analytics, Admin console, Update frequency, Parameters and Manual metrics are visible. |
| 5 | Look for a "Departments" entry. | There is no "Departments" entry in the navigation. |

*Automated:* `tests/e2e/qa-manager-rbac.spec.ts › QA Manager Role-Based Access Control › QA Manager has access to department-level features`

### TC-ROLE-010: Manager can open the Admin console

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F12.12

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address manager@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/admin-panel. | The Admin console page opens (the address stays /admin-panel). |
| 3 | Read the page headings. | The heading "Admin console" and the section "Organization Structure" are visible. |

*Automated:* `tests/e2e/qa-manager-rbac.spec.ts › QA Manager Role-Based Access Control › QA Manager can access admin panel`

### TC-ROLE-016: Software engineer typing admin addresses is sent back to the overview

**Type:** Negative · **Priority:** High · **Role:** Software engineer · **Flow:** F4.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123
- Addresses: /users, /teams, /departments, /admin-panel

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address engineer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Type http://localhost:5173/users in the address bar and press Enter; wait 2 seconds. | The app shows the Overview page and the address is no longer /users; an alert reads "You don't have access to <that page>." |
| 3 | Repeat with http://localhost:5173/teams. | The Overview is shown; the address is no longer /teams; an alert reads "You don't have access to <that page>." |
| 4 | Repeat with http://localhost:5173/departments. | The Overview is shown; the address is no longer /departments; an alert reads "You don't have access to <that page>." |
| 5 | Repeat with http://localhost:5173/admin-panel. | The Overview is shown; the address is no longer /admin-panel; an alert reads "You don't have access to <that page>." |

**Notes:** Each redirect shows "You don't have access to <page>." at the top of the overview (FI-14, fixed).

*Automated:* `tests/e2e/qa-engineer-rbac.spec.ts › QA Engineer Role-Based Access Control › QA Engineer cannot access restricted pages directly`

### TC-ROLE-025: Team lead navigation shows team-level entries only

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F4.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the menu (burger) button at the left of the top bar to open the navigation drawer. | The navigation drawer opens and lists the navigation entries in groups (Quality, Delivery, Organisation, Administration). |
| 3 | Read the navigation entries. | Overview, Teams, Users, Analytics and Manual metrics are visible. |
| 4 | Look for administration entries. | Departments, Admin console, Update frequency and Parameters are NOT shown. |

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Navigation restrictions - Team Lead cannot access restricted areas`

### TC-ROLE-026: Team lead is refused analytics of another team by the API

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F4.4

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | In a new tab of the same browser open http://localhost:3000/api/analytics/test-executions?days=7. | The response is 200 with JSON data for the lead's own team. |
| 3 | Open http://localhost:3000/api/analytics/test-executions?teamId=some-other-team&days=7 (check the status in DevTools > Network). | The response status is 403 (forbidden). |

**Notes:** Requires DevTools. A GET request can be sent by opening the API address in a new tab of the same signed-in browser (the session cookie is sent because it belongs to localhost). For other methods use the DevTools Console, e.g. fetch(URL, { method: "DELETE", credentials: "include" }).then(r => console.log(r.status)). If the first request does not answer 200, the automated test skips the 403 check.

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › API restrictions - Team Lead cannot access other teams' data`

### TC-ROLE-027: Viewer navigation shows only Overview and analytics entries

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F4.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Click the menu (burger) button at the left of the top bar to open the navigation drawer. | The navigation drawer opens and lists the navigation entries in groups (Quality, Delivery, Organisation, Administration). |
| 3 | Read the navigation entries. | Overview and Analytics (plus the analytics modules such as Compare teams, Flaky tests, Reports) are visible. |
| 4 | Look for management entries. | Users, Teams, Departments, Admin console, Manual metrics, Update frequency and Parameters are NOT shown. |

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer has minimal access to features`

### TC-ROLE-032: Viewer typing management addresses is sent back to the overview

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F4.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123
- Addresses: /users, /teams, /departments, /admin-panel, /manual-metrics, /metric-intervals, /parameters-config

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Type http://localhost:5173/users in the address bar, press Enter and wait 2 seconds. | The Overview page is shown and the address is no longer /users; an alert reads "You don't have access to <that page>." |
| 3 | Repeat with /teams and /departments. | Each time the Overview is shown and the address no longer contains the typed path; an alert reads "You don't have access to <that page>." |
| 4 | Repeat with /admin-panel and /manual-metrics. | Each time the Overview is shown; an alert reads "You don't have access to <that page>." |
| 5 | Repeat with /metric-intervals and /parameters-config. | Each time the Overview is shown; no management page content appears; an alert reads "You don't have access to <that page>." |

**Notes:** Each redirect shows "You don't have access to <page>." at the top of the overview (FI-14, fixed).

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer cannot access any admin or management pages`

### TC-ROLE-034: Viewer sees no create, edit or delete buttons

**Type:** Negative · **Priority:** High · **Role:** Viewer · **Flow:** F5.1, F6.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Look at the Overview page. | No "Add with password", "Create team", Edit or Delete buttons are visible. |
| 3 | Click the first team card. | The team detail page opens. |
| 4 | Look through the team detail page. | No "Edit team" or "Delete team" buttons are visible. |

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer cannot perform any write operations`

## Users and teams

### TC-ROLE-005: Super admin adds a software engineer with a password

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F12.6

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- New user: First Name Test, Last Name User, Email e2e-<timestamp>@example.com (unique), Password password123, Role: Software engineer

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/users. | The Users page opens with a list of user cards. |
| 3 | Click "Add with password" (marked Demo) in the toolbar. | A dialog "Add a user with a password" opens with First Name, Last Name, Email, Password, Role, Department and Primary team fields. |
| 4 | Enter First Name "Test", Last Name "User", a unique Email such as e2e-20261119a@example.com and Password "password123". | The values are shown in the fields. |
| 5 | Choose Role "Software engineer" (QA engineer). | The role is selected. |
| 6 | Choose a Department that has teams (e.g. DevOps), then choose its first team in the Primary team list. | The Primary team list offers the teams of the chosen department and one is selected. |
| 7 | Click "Create User". | A success message "User created successfully!" appears and the dialog closes. |
| 8 | Search the user list for the new e-mail address. | A card for "Test User" with the new e-mail address is shown, status Active. |

**After the test:** Deactivate or delete the created user (Users > the user's card > Deactivate / Delete) so the demo data stays clean.

*Automated:* `tests/e2e/super-admin-rbac.spec.ts › Super Admin Role-Based Access Control › Super Admin can create and manage all user roles`

### TC-ROLE-008: Manager sees users and creates a team

**Type:** Positive · **Priority:** High · **Role:** Manager · **Flow:** F12.5, F12.4

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: manager@irongate.com
- Password: demo123
- Team name: QA Manager Test Team <timestamp> (unique)
- Description: Test team created by QA Manager

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address manager@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/users. | The Users page opens and at least one user card is shown. |
| 3 | Go to http://localhost:5173/teams. | The Teams page opens with a "Create team" button. |
| 4 | Click "Create team". | A "Create team" dialog opens with a Team name field and a Description field. |
| 5 | Enter a unique team name such as "QA Manager Test Team 20261119" and the description "Test team created by QA Manager", then click "Create". | The dialog closes and a "Team created" message appears. |
| 6 | Look for the new team in the teams list. | A row with the new team name is listed. |

**After the test:** Delete the created team (Teams > row of the new team > Delete team) to keep the demo data clean.

*Automated:* `tests/e2e/qa-manager-rbac.spec.ts › QA Manager Role-Based Access Control › QA Manager can manage users and teams in their department`

### TC-ROLE-018: Team lead sees at most their own team on the Teams page

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F12.4

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123
- Own team: The Away Team (DevOps)

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/teams. | The Teams page opens. |
| 3 | Count the team rows in the list. | At most one team is listed, and it is The Away Team; no other team is shown. |

**Notes:** If the lead has no team in the data, the list is empty and the automated test passes without asserting.

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Admin Teams - Team Lead sees only their own team`

### TC-ROLE-019: Team lead sees only users of their own team on the Users page

**Type:** Negative · **Priority:** High · **Role:** Team lead · **Flow:** F12.5

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/users. | The Users page opens with at least one user card. |
| 3 | Check the team of every user card (switch to list view or use Export CSV to see the Team column if needed). | Every listed user belongs to the same team, The Away Team; no users of other teams are shown. |

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Admin Users - Team Lead sees only users in their team`

### TC-ROLE-023: Team lead deactivates and reactivates a member of their team

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F12.8

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/users. | The Users page lists the members of The Away Team. |
| 3 | Find the first user card that has a Deactivate / Activate button and note its status badge. | The badge reads "Active" (or "Inactive"). |
| 4 | Click the Deactivate (or Activate) button on that card and wait 2 seconds. | A confirmation message appears and the status badge changes (Active to Inactive, or the reverse). |
| 5 | Click the same button again and wait 2 seconds. | The status badge returns to its original value. |

**After the test:** Make sure the user is back in the original status.

**Notes:** If no card has the button, record that no toggle is offered; the automated test then passes without asserting.

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Toggle User Status - For users in their team only`

### TC-ROLE-024: Team lead switches AI suggestions for their team and developer insights for a member

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F6.13, F7.8

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/teams. | The Teams page shows The Away Team. |
| 3 | Hover the AI toggle button on the team row and note its tooltip. | The tooltip reads "Turn AI suggestions off" or "Turn AI suggestions on". |
| 4 | Click the AI toggle button and wait 2 seconds. | A message "AI suggestions turned on" or "AI suggestions turned off" appears and the tooltip flips. |
| 5 | Click the AI toggle again. | The setting returns to its original state. |
| 6 | Go to http://localhost:5173/users and hover the insights button on the first user card that has one. | The tooltip reads "Enable developer insights" or "Disable developer insights". |
| 7 | Click that button and wait 2 seconds. | A message "Developer insights enabled" or "Developer insights disabled" appears and the tooltip flips. |
| 8 | Click the button again. | The setting returns to its original state. |

**After the test:** Leave the team AI setting and the user's developer insights in their original state.

**Notes:** The user button and its messages say "developer insights" (FI-13, fixed).

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Toggle AI - For their team and team users`

## Analytics

### TC-ROLE-006: Super admin opens Analytics and sees the module cards for a chosen team

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F7.1, F7.2

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/analytics. | The Analytics page opens with a scope bar (Department and Team drop-down lists) and the heading "Analytics". |
| 3 | In the Department list choose the first department. | The Team list offers the teams of that department. |
| 4 | In the Team list choose the first team. | The page description says "Every module opens for <team name>…". |
| 5 | Look at the module cards below the scope bar. | At least one analytics module card (e.g. Flaky tests, Test execution, Technical debt) is visible and clickable. |

**Notes:** If the database has no departments or teams, no module cards appear; the automated test then passes without asserting.

*Automated:* `tests/e2e/super-admin-rbac.spec.ts › Super Admin Role-Based Access Control › Super Admin can access all analytics features`

### TC-ROLE-015: Software engineer sees Developer productivity read-only for their own team, own row only

**Type:** Positive · **Priority:** High · **Role:** Software engineer · **Flow:** F7.7, F7.2

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: engineer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address engineer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/analytics/productivity. | The Developer productivity page opens with a scope bar at the top. |
| 3 | Look at the scope bar. | Department and Team are shown as read-only values (the engineer's own department and team); there are no drop-down lists. |
| 4 | Look at the developer table area. | A badge "Showing your own metrics only" is visible. |
| 5 | Look at the address bar. | The address contains a ?team=<team id> parameter. |
| 6 | Reload the page (F5). | The same team is still shown in the scope bar. |

*Automated:* `tests/e2e/qa-engineer-rbac.spec.ts › QA Engineer Role-Based Access Control › QA Engineer opens team analytics for their own team, with only their own developer row`

### TC-ROLE-020: Team lead sees a fixed (read-only) department and team in the Analytics scope bar

**Type:** Positive · **Priority:** High · **Role:** Team lead · **Flow:** F7.2

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/analytics. | The Analytics page opens with a scope bar. |
| 3 | Look at the scope bar. | There are no drop-down lists; Department and Team are shown as read-only values. |
| 4 | Read the Department and Team values. | Department shows DevOps and Team shows The Away Team (not empty). |

*Automated:* `tests/e2e/team-lead-rbac.spec.ts › Team Lead Role-Based Access Control › Analytics - Static label shows team lead's team`

### TC-ROLE-033: Viewer sees Analytics read-only for their own team

**Type:** Positive · **Priority:** High · **Role:** Viewer · **Flow:** F7.2

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: viewer@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address viewer@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Go to http://localhost:5173/analytics. | The Analytics page opens with a scope bar. |
| 3 | Look at the scope bar. | There are no Department / Team drop-down lists. |
| 4 | Read the scope bar values. | The Team is shown as a read-only value (The Away Team); if the viewer has no team, a "No team in your analytics scope" message is shown instead. |

*Automated:* `tests/e2e/viewer-rbac.spec.ts › Viewer Role-Based Access Control › Viewer opens Analytics read-only for their own team (or sees the no-team state)`

## Resilience

### TC-ROLE-035: Every navigation page of a super admin opens without an uncaught error

**Type:** Positive · **Priority:** High · **Role:** Super admin · **Flow:** F16.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open DevTools (F12) on the Console tab and clear it before starting. | The Console is empty. |
| 2 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 3 | Open the navigation and click, one after the other: Overview, Analytics, Compare teams, Flaky tests, Test execution, Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact, Team rankings, Reports. | Each page opens and shows its content area (the top bar title changes to the page name). |
| 4 | Continue with Users, Teams, Departments, Activity, User activity, Admin console, Manual metrics, Update frequency, Parameters and Ingestion log. | Each page opens and shows its content. |
| 5 | Check the DevTools Console. | The DevTools Console shows no red "Uncaught" error entries. |

**Notes:** Tagged @smoke.

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-01 a tour of every page of a super admin raises no uncaught error`

### TC-ROLE-036: A slow server shows a loading state, then the Users list

**Type:** Positive · **Priority:** Medium · **Role:** Super admin · **Flow:** F16.2

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | In DevTools > Network set throttling to "Slow 3G" (or a custom profile with about 2.5 s latency). | Throttling is active. |
| 3 | Go to http://localhost:5173/users. | A loading indicator is shown while the list loads; no "No users found" message appears. |
| 4 | Wait up to 20 seconds. | The user cards appear. |
| 5 | Set throttling back to "No throttling". | — |

**Notes:** Requires DevTools. The automated test delays only the request /api/admin/users by 2.5 s; network throttling slows every request, which is an acceptable approximation.

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-02 a slow server shows a loading state, then the page`

### TC-ROLE-037: A 502 HTML proxy error on the teams list is reported as an error, not an empty list

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F16.3, F12.5

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- A debugging proxy (e.g. Fiddler, Charles or mitmproxy) set up to answer GET http://localhost:3000/api/admin/teams with the fake 502 HTML response

**Test data**

- E-mail: admin@irongate.com
- Password: demo123
- Fake response for GET http://localhost:3000/api/admin/teams: status 502, Content-Type text/html, body "<html><body><h1>502 Bad Gateway</h1></body></html>"

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Enable the proxy rule for /api/admin/teams. | — |
| 3 | Go to http://localhost:5173/teams. | A red error box reads exactly "Could not load the teams: the server had a problem. Try again in a moment." |
| 4 | Look at the list area. | The text "No teams found" is NOT shown. |
| 5 | Disable the proxy rule and reload the page. | The teams list loads normally. |

**Notes:** Requires a response-mocking proxy: DevTools request blocking produces a network error ("could not be reached") instead of a 502 and does not test the same thing.

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-03 a proxy error page (HTML, 502) is reported, not shown as an empty list`

### TC-ROLE-038: Offline, the Users page says the server cannot be reached; back online it loads

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F16.4, F12.5

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | In DevTools > Network set throttling to "Offline". | The browser is offline. |
| 3 | Open the navigation and click Users. | The top bar title reads "Users" and a red error box reads "Could not load the users: the server could not be reached. Check your connection and try again." |
| 4 | Set throttling back to "No throttling" and reload the page (F5). | The Users page loads and user cards are shown. |

**Notes:** Requires DevTools (Network > Offline).

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-04 going offline: pages say the server cannot be reached; back online they work again`

### TC-ROLE-039: A hanging company-summary request does not block the overview or other pages

**Type:** Negative · **Priority:** Medium · **Role:** Team lead · **Flow:** F16.5, F5.1

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: lead@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | In DevTools > Network request blocking, add the pattern */api/analytics/company-summary* and enable it. | The pattern is listed and active. |
| 2 | Open http://localhost:5173, enter E-mail address lead@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 3 | Look at the "Team performance" grid. | Team cards are shown even though the company summary does not load. |
| 4 | Open the navigation and click Compare teams. | The top bar title reads "Compare teams" and the Compare teams page is shown. |
| 5 | Remove the blocking pattern. | — |

**Notes:** Requires DevTools. The automated test leaves the request hanging forever; blocking makes it fail instead, which is the closest manual approximation.

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-05 a request that never answers (timeout) leaves the rest of the app usable`

### TC-ROLE-040: Reloading while the invite dialog is filled in sends no invitation

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F16.6, F3.3

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- A new organisation has been registered with "Create an account" on the sign-in screen (its owner is its super admin), so no demo data is touched
- You are signed in as that organisation's owner

**Test data**

- E-mail: owner address of the new organisation
- Password: the password chosen at registration
- Invitee: reload-test@<the new organisation's e-mail domain>

| Step | Action | Expected result |
|---|---|---|
| 1 | Go to http://localhost:5173/users. | The Users page opens with an "Invite" button. |
| 2 | Click "Invite". | The "Invite a person" dialog opens. |
| 3 | Type reload-test@<organisation domain> in the e-mail field. Do not submit. | The address is shown in the field. |
| 4 | Reload the page (F5). | The Users page is shown again and no dialog is open. |
| 5 | Look at the Invitations panel on the Users page. | There is no invitation for reload-test@<organisation domain>. |

**After the test:** Delete the test organisation if your environment allows it, or leave it (it is isolated from the demo company).

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-06 reloading in the middle of an invitation sends nothing`

### TC-ROLE-041: Browser Back while the invite dialog is open returns to the overview with no dialog

**Type:** Negative · **Priority:** Medium · **Role:** Super admin · **Flow:** F16.7

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)

**Test data**

- E-mail: admin@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open http://localhost:5173, enter E-mail address admin@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 2 | Open the navigation and click Users. | The Users page opens (title "Users"). |
| 3 | Click "Invite". | The "Invite a person" dialog opens. |
| 4 | Click the browser Back button. | The Overview page is shown (top bar title "Overview") and no dialog is open. |

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-07 Back while a dialog is open leaves the page cleanly`

### TC-ROLE-042: Rapid navigation clicks end on the last page clicked without errors

**Type:** Negative · **Priority:** Medium · **Role:** Manager · **Flow:** F16.8

**Preconditions**

- App running at http://localhost:5173 with the API at http://localhost:3000 and the NovaTech demo data loaded
- You are signed out (use a fresh private browser window)
- Browser DevTools available

**Test data**

- E-mail: manager@irongate.com
- Password: demo123

| Step | Action | Expected result |
|---|---|---|
| 1 | Open DevTools (F12) on the Console tab and clear it before starting. | The Console is empty. |
| 2 | Open http://localhost:5173, enter E-mail address manager@irongate.com and Password demo123, then click Sign in. | The Overview page opens: the top bar title reads "Overview" and the "Team performance" section lists team cards. |
| 3 | As fast as possible, open the navigation and click Compare teams, then open it again and click Users, then Activity, then Technical debt, then Parameters (do not wait for pages to load). | Each click is accepted. |
| 4 | Wait for the page to settle. | The top bar title reads "Parameters" and the Parameters page is shown. |
| 5 | Check the DevTools Console. | The DevTools Console shows no red "Uncaught" error entries. |

*Automated:* `tests/e2e/resilience/resilience.spec.ts › Resilience › RES-08 rapid clicks through the navigation end on the last page clicked`

## Live smoke

### TC-ROLE-044: The sign-in screen loads with its links

**Type:** Read-only (live site) · **Priority:** High · **Role:** Signed out · **Flow:** F17.1

**Preconditions**

- The app under test is reachable (local http://localhost:5173, or the deployed site)
- You are signed out
- Browser DevTools available to watch the Console

| Step | Action | Expected result |
|---|---|---|
| 1 | Open DevTools (F12) on the Console tab and clear it before starting. | The Console is empty. |
| 2 | Open the app's home address. | The heading "Sign in" is shown with Email address and Password fields. |
| 3 | Look below the form. | A "Forgot password?" link and a "Create an account" button are visible. |
| 4 | Click "Forgot password?". | The heading "Forgot your password?" is shown. |
| 5 | Check the DevTools Console. | The DevTools Console shows no red "Uncaught" error entries. |

**Notes:** Read-only: change nothing. Tagged @smoke and @readonly; can be run on the deployed site.

*Automated:* `tests/e2e/readonly/live-smoke.spec.ts › Live smoke (read-only) › LIVE-01 the sign-in screen loads with its links`

### TC-ROLE-045: Sign in, see the overview and open the first team

**Type:** Read-only (live site) · **Priority:** High · **Role:** Any · **Flow:** F17.2, F1.1

**Preconditions**

- The app under test is reachable (local http://localhost:5173, or the deployed site)
- You are signed out
- Browser DevTools available to watch the Console

**Test data**

- Local: E-mail admin@irongate.com, Password demo123
- Live site: the test account provided for live checks

| Step | Action | Expected result |
|---|---|---|
| 1 | Open DevTools (F12) on the Console tab and clear it before starting. | The Console is empty. |
| 2 | Open the app's home address, enter the e-mail and password of the account from Test data and click Sign in. | The Overview page opens (the Overview / team grid is shown). |
| 3 | If team cards are shown, click the first one. | The team detail page opens. |
| 4 | Click "Overview" in the breadcrumb. | The Overview page is shown again. |
| 5 | Check the DevTools Console. | The DevTools Console shows no red "Uncaught" error entries. |

**Notes:** Read-only: change nothing. Tagged @smoke and @readonly; can be run on the deployed site.

*Automated:* `tests/e2e/readonly/live-smoke.spec.ts › Live smoke (read-only) › LIVE-02 sign in, see the overview and open the first team`

### TC-ROLE-046: Every page in the navigation opens

**Type:** Read-only (live site) · **Priority:** High · **Role:** Any · **Flow:** F17.3, F4.2

**Preconditions**

- The app under test is reachable (local http://localhost:5173, or the deployed site)
- You are signed out
- Browser DevTools available to watch the Console

**Test data**

- Local: E-mail admin@irongate.com, Password demo123
- Live site: the test account provided for live checks

| Step | Action | Expected result |
|---|---|---|
| 1 | Open DevTools (F12) on the Console tab and clear it before starting. | The Console is empty. |
| 2 | Open the app's home address, enter the e-mail and password of the account from Test data and click Sign in. | The Overview page opens (the Overview / team grid is shown). |
| 3 | Click the menu (burger) button at the left of the top bar to open the navigation drawer. | The navigation drawer opens and lists the navigation entries in groups (Quality, Delivery, Organisation, Administration). |
| 4 | Click each navigation entry in turn (skip "Platform"), reopening the navigation each time. | Each page opens and the top bar shows a non-empty page title (e.g. Analytics, Compare teams, Flaky tests …). |
| 5 | Check the DevTools Console. | The DevTools Console shows no red "Uncaught" error entries. |

**Notes:** Read-only: change nothing. Tagged @smoke and @readonly; can be run on the deployed site.

*Automated:* `tests/e2e/readonly/live-smoke.spec.ts › Live smoke (read-only) › LIVE-03 every page in the navigation opens`

### TC-ROLE-047: Unknown address leads to the overview, the Appearance menu switches Light / Dark, phone layout fits

**Type:** Read-only (live site) · **Priority:** High · **Role:** Any · **Flow:** F17.4, F4.5, F4.10, F4.11

**Preconditions**

- The app under test is reachable (local http://localhost:5173, or the deployed site)
- You are signed out
- Browser DevTools available to watch the Console

**Test data**

- Local: E-mail admin@irongate.com, Password demo123
- Live site: the test account provided for live checks

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the app's home address, enter the e-mail and password of the account from Test data and click Sign in. | The Overview page opens (the Overview / team grid is shown). |
| 2 | Go to <app address>/this-page-does-not-exist. | The Overview page is shown. |
| 3 | Click the "Appearance" button in the top bar and choose the other of Light / Dark. | The colours switch between light and dark. |
| 4 | Click "Appearance" again and choose the original theme. | The original theme is restored. |
| 5 | In DevTools turn on the device toolbar and set the size to 390 x 844. | The layout adapts to the phone width. |
| 6 | Try to scroll the page sideways. | The page does not scroll horizontally and no content sticks out to the right (wide tables may scroll inside their own box). |

**Notes:** Read-only: change nothing. Tagged @smoke and @readonly; can be run on the deployed site. The theme choice is stored per browser only.

*Automated:* `tests/e2e/readonly/live-smoke.spec.ts › Live smoke (read-only) › LIVE-04 unknown addresses lead to the overview; the theme switch works; the phone layout fits`
