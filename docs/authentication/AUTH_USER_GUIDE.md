# Signing in and access: user guide

How to get into QE Navigator, keep your account safe, and understand what your role lets you do. The
complete per-role matrix is in [ROLE_ACCESS.md](../ROLE_ACCESS.md).

## Joining

- **By invitation (most people).** An administrator invites you by e-mail to a role on a team, a department
  or the company. Open the link, enter your first and last name and choose a password, or use Google or
  Microsoft sign-in if your company offers it and the account has the invited e-mail address. The link
  expires after 7 days by default. If it has expired, ask for a new one.
- **Registering.** "Create an account" on the sign-in page registers a **new organisation** with its first
  department and team, and makes you its super admin. Do not register to join your colleagues: ask for an
  invitation instead. A company e-mail domain can belong to one organisation only; with a public address
  (for example gmail.com) there is no such limit.

## Signing in

- E-mail and password, or **Continue with Google / Microsoft** when shown. Single sign-on works only for an
  existing account or an open invitation with the same verified e-mail address.
- **Keep me signed in** keeps you signed in after closing the browser, for as long as your company allows
  (default 7 days). Without it you are signed out when the browser closes.
- After too many failed attempts from one network, sign-in is paused for a while. Wait and try again, or
  reset your password.
- If your organisation's access is suspended, the sign-in page says so. Contact your administrator.

## Passwords

- 10 to 128 characters, at least three of: lower case, upper case, number, symbol. It must not contain the
  part of your e-mail address before the @.
- **Forgot password?** on the sign-in page sends a link to your e-mail. It works once and expires after 60
  minutes. The page always gives the same answer, whether or not the address has an account.
- Resetting your password signs you out on every device.
- An administrator can also set a password for you or send you a reset link.

## Your sessions

- **Account menu → Sign out my other devices** ends every session except the one you are using.
- **Sign out** ends this session.
- If an administrator signs you out everywhere, deactivates you or your organisation is suspended, your next
  action takes you back to the sign-in page with a message.

## What your role lets you do

Press the **question mark** in the top bar ("What you can do here") to see the rules for your own account.
In short:

| Role | Sees | Can change |
|---|---|---|
| Super admin | every team of the company | everything in the company: people, teams, departments, targets, settings, API keys |
| Manager | the teams of the departments they manage | those teams and their people below manager, their targets and alert rules |
| Team lead | the teams they lead or belong to | those teams' data (manual metrics, actions, alerts, pulse), their software engineers and viewers |
| Software engineer | the teams they belong to | their own tracked actions' status; answers the wellbeing pulse |
| Viewer | the teams they are assigned to | nothing (read-only) |

You can hold more than one role (for example viewer of two teams); you get the combined access. Nobody can
change their own role.

## Privacy

- Your individual developer metrics are shown to others only if you opted in to developer insights, and then
  only to super admins, managers and team leads of your team. You always see your own.
- Wellbeing pulse answers are anonymous. Results are shown only as team averages with at least 3 answers.
  Answering is not recorded in any activity log.
- Your company's super admins can see a log of sign-ins and requests in the company (User activity), for 90
  days, without the content of what you sent.
