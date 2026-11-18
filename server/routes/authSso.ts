import express from 'express';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../src/lib/db';
import { JWT_SECRET } from '../middleware/auth';
import { inviteLimiter } from '../middleware/rateLimit';
import { recordAudit } from '../lib/audit';
import {
  providerConfig, enabledProviders, beginSignIn, checkState, completeSignIn, appBaseUrl, SsoError, PROVIDER_LABEL, type ProviderId,
} from '../lib/sso';
import { acceptInvitation, findByToken, openInvitationForEmail, statusMessage, InvitationError, ROLE_NAMES } from '../lib/invitations';

/**
 * Public sign-in routes (mounted inside /api/auth):
 *
 *   GET  /providers                     which sign-in methods the login page shows (SSO buttons only
 *                                       when configured; demo account chips only when DEMO_MODE)
 *   GET  /sso/:provider/start[?invite=] redirect to Google / Microsoft (state + nonce + PKCE)
 *   GET  /sso/:provider/callback        verify, match the person, start the session, back to the app
 *   GET  /invitations/:token            what an invitation is for (accept page)
 *   POST /invitations/accept            { token, firstName, lastName, password }
 *
 * SSO matches an existing ACTIVE user (by linked identity, else by verified email) or an OPEN
 * invitation for the verified email; it never creates an account otherwise. The session is the
 * same cookie as the password login.
 */
const router = express.Router();

const isProduction = () => process.env.NODE_ENV === 'production';

/** The session cookie (same for password, invitation and SSO sign-in). */
export function setSessionCookie(res: express.Response, userId: string): void {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('irongate_token', token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

/** DEMO_MODE: demo account chips on the login page. Default on for local development only. */
export function demoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEMO_MODE !== undefined && env.DEMO_MODE !== '') return env.DEMO_MODE === 'true' || env.DEMO_MODE === '1';
  return env.NODE_ENV !== 'production' && !env.NETLIFY;
}

const DEMO_ACCOUNTS = [
  { role: 'Administrator', email: 'admin@irongate.com' },
  { role: 'QA manager', email: 'manager@irongate.com' },
  { role: 'Team lead', email: 'lead@irongate.com' },
  { role: 'QA engineer', email: 'engineer@irongate.com' },
  { role: 'Viewer', email: 'viewer@irongate.com' },
];

router.get('/providers', (_req, res) => {
  const sso = enabledProviders().map((id) => ({ id, label: PROVIDER_LABEL[id], startUrl: `/auth/sso/${id}/start` }));
  const demo = demoModeEnabled();
  res.set('Cache-Control', 'no-store');
  res.json({
    password: true,
    sso,
    demoMode: demo,
    ...(demo ? { demoAccounts: DEMO_ACCOUNTS, demoPassword: 'demo123' } : {}),
  });
});

/* ------------------------------------------------------------------------------------------
 * SSO
 * ---------------------------------------------------------------------------------------- */

const STATE_COOKIE = 'irongate_sso';
const stateCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  // Lax: the provider's redirect back is a cross-site top-level GET, which Strict would drop.
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 10 * 60 * 1000,
});

/** Back to the app with an error the login / accept page shows. */
function backWithError(res: express.Response, code: string, message: string, invite?: string | null) {
  const url = new URL(invite ? '/accept-invite' : '/', appBaseUrl());
  if (invite) url.searchParams.set('token', invite);
  url.searchParams.set('sso_error', code);
  url.searchParams.set('sso_message', message.slice(0, 300));
  res.redirect(302, url.toString());
}

router.get('/sso/:provider/start', inviteLimiter, async (req, res) => {
  const cfg = providerConfig(req.params.provider);
  if (!cfg) return res.status(404).json({ error: 'This sign-in method is not enabled' });
  const invite = typeof req.query.invite === 'string' && req.query.invite.startsWith('igi_') && req.query.invite.length < 200 ? req.query.invite : null;
  try {
    const { url, stateCookie } = await beginSignIn(cfg, JWT_SECRET, invite);
    res.cookie(STATE_COOKIE, stateCookie, stateCookieOptions());
    res.redirect(302, url);
  } catch (e: any) {
    console.error('[sso] start failed:', e?.message || e);
    backWithError(res, e instanceof SsoError ? e.code : 'provider_unavailable', e instanceof SsoError ? e.message : 'The sign-in provider is not reachable. Try again later.', invite);
  }
});

router.get('/sso/:provider/callback', inviteLimiter, async (req: any, res) => {
  const provider = req.params.provider as ProviderId;
  const cfg = providerConfig(provider);
  if (!cfg) return res.status(404).json({ error: 'This sign-in method is not enabled' });
  const cookie = req.cookies?.[STATE_COOKIE];
  // The state cookie is single-use: cleared whatever happens next.
  res.clearCookie(STATE_COOKIE, { ...stateCookieOptions(), maxAge: undefined });
  let invite: string | null = null;
  try {
    const st = checkState(provider, cookie, req.query.state, JWT_SECRET);
    invite = st.i ?? null;
    if (typeof req.query.error === 'string') {
      throw new SsoError('provider_error', req.query.error === 'access_denied' ? 'Sign-in was cancelled.' : `${PROVIDER_LABEL[provider]} reported an error (${String(req.query.error).slice(0, 60)}).`);
    }
    const identity = await completeSignIn(cfg, req.query.code, st);

    // 1. A linked identity; 2. an active user with this verified email; 3. an open invitation.
    let user = await queryOne<any>(
      `SELECT u.id, u.company_id, u.is_active, u.email FROM user_identities ui JOIN users u ON u.id = ui.user_id
        WHERE ui.provider = ? AND ui.subject = ?`,
      [provider, identity.subject]
    );
    if (!user) user = await queryOne<any>('SELECT id, company_id, is_active, email FROM users WHERE LOWER(email) = LOWER(?)', [identity.email]);
    if (user) {
      if (!user.is_active) throw new SsoError('account_inactive', 'Your account has been deactivated. Please contact your administrator.');
      const linked = await queryOne<any>('SELECT id FROM user_identities WHERE provider = ? AND subject = ?', [provider, identity.subject]);
      if (!linked) {
        await query(
          `INSERT INTO user_identities (user_id, provider, subject, email, last_login_at) VALUES (?, ?, ?, ?, now())
           ON CONFLICT (provider, subject) DO NOTHING`,
          [user.id, provider, identity.subject, identity.email]
        );
        await recordAudit({
          companyId: user.company_id, actorId: user.id, action: 'sso.link', entityType: 'user', entityId: user.id,
          summary: `${PROVIDER_LABEL[provider]} sign-in linked to ${user.email}`, subjectIds: [user.id],
        });
      } else {
        await query('UPDATE user_identities SET last_login_at = now() WHERE id = ?', [linked.id]);
      }
    } else {
      const inv = invite ? await findByToken(invite) : null;
      const target = inv && inv.status === 'open' && String(inv.email).toLowerCase() === identity.email ? inv : await openInvitationForEmail(identity.email);
      if (!target) {
        throw new SsoError('no_account', `There is no IronGate account for ${identity.email}. Ask your administrator for an invitation.`);
      }
      const first = identity.givenName || identity.name?.split(' ')[0] || identity.email.split('@')[0];
      const last = identity.familyName || identity.name?.split(' ').slice(1).join(' ') || '-';
      const created = await acceptInvitation({
        invitationId: target.id, firstName: first, lastName: last, password: null,
        sso: { provider, subject: identity.subject }, verifiedEmail: identity.email,
      });
      user = { id: created.userId };
    }
    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    setSessionCookie(res, user.id);
    res.redirect(302, `${appBaseUrl()}/`);
  } catch (e: any) {
    if (e instanceof SsoError || e instanceof InvitationError) {
      return backWithError(res, e instanceof SsoError ? e.code : (e.code ?? 'invitation'), e.message, invite);
    }
    console.error('[sso] callback failed:', e?.message || e);
    backWithError(res, 'sso_failed', 'Sign-in failed. Please try again.', invite);
  }
});

/* ------------------------------------------------------------------------------------------
 * Invitations (public)
 * ---------------------------------------------------------------------------------------- */

router.get('/invitations/:token', inviteLimiter, async (req, res) => {
  try {
    const inv = await findByToken(req.params.token);
    if (!inv) return res.status(404).json({ error: 'This invitation link is not valid.', status: 'invalid' });
    if (inv.status !== 'open') return res.status(410).json({ error: statusMessage(inv.status), status: inv.status });
    res.set('Cache-Control', 'no-store');
    res.json({
      status: 'open',
      email: inv.email,
      role: inv.role,
      roleName: ROLE_NAMES[inv.role] ?? inv.role,
      scopeType: inv.scope_type,
      scopeName: inv.scope_name,
      companyName: inv.company_name,
      invitedBy: inv.invited_by_name,
      expiresAt: inv.expires_at,
      sso: enabledProviders().map((id) => ({ id, label: PROVIDER_LABEL[id] })),
    });
  } catch (e) {
    console.error('Invitation lookup error:', e);
    res.status(500).json({ error: 'Failed to read the invitation' });
  }
});

router.post('/invitations/accept', inviteLimiter, async (req, res) => {
  try {
    const { token, firstName, lastName, password } = req.body ?? {};
    if (typeof token !== 'string' || typeof password !== 'string' || typeof firstName !== 'string' || typeof lastName !== 'string') {
      return res.status(400).json({ error: 'token, firstName, lastName and password are required' });
    }
    const { userId } = await acceptInvitation({ token, firstName, lastName, password });
    setSessionCookie(res, userId);
    const user = await queryOne<any>(
      `SELECT id, email, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified, created_at
         FROM users WHERE id = ?`,
      [userId]
    );
    res.status(201).json({ user });
  } catch (e: any) {
    if (e instanceof InvitationError) return res.status(e.status).json({ error: e.message, status: e.code ?? null });
    console.error('Accept invitation error:', e);
    res.status(500).json({ error: 'Failed to accept the invitation' });
  }
});

export default router;
