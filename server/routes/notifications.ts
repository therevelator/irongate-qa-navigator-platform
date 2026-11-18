import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { recordAudit } from '../lib/audit';
import { canAcknowledgeAlert, canManageNotificationSettings, canReceiveDigest, loadActor } from '../lib/alertPolicy';
import { isSeverity } from '../lib/alerts';
import {
  encryptSecret, getPrefs, getSettings, maskWebhook, publicSettings, savePrefs, sendNow, validatePrefs, validateSlackWebhook,
} from '../lib/notifications';
import { buildDigest, renderDigest, sendTestDigest } from '../lib/digest';

/**
 * Notifications (server/lib/notifications.ts, server/lib/digest.ts). Authenticated, company-scoped.
 *
 * Own inbox and preferences (every user, their own only):
 *   GET  /api/notifications?unread=true&limit=      the caller's notifications + unread count
 *   GET  /api/notifications/unread-count
 *   POST /api/notifications/:id/read · POST /api/notifications/read-all
 *   GET  /api/notifications/preferences · PUT /api/notifications/preferences
 * Weekly digest (super_admin, QA managers, team leads — their own scope):
 *   GET  /api/notifications/digest/preview · POST /api/notifications/digest/test (to the caller)
 * Company Slack settings (super_admin):
 *   GET  /api/notifications/settings · PUT /api/notifications/settings
 *   POST /api/notifications/settings/slack-test
 *   The webhook URL is write-only: responses carry a masked hint, never the URL.
 */
const router = express.Router();

const notificationJson = (n: any, actor: ReturnType<typeof policyActor>) => ({
  id: n.id,
  kind: n.kind,
  severity: n.severity,
  title: n.title,
  body: n.body,
  teamId: n.team_id,
  alertId: n.alert_id,
  actionId: n.action_id,
  createdAt: new Date(n.created_at).toISOString(),
  readAt: n.read_at ? new Date(n.read_at).toISOString() : null,
  alert: n.alert_id ? {
    status: n.alert_resolved_at ? 'resolved' : n.alert_acknowledged_at ? 'acknowledged' : 'open',
    canAcknowledge: !n.alert_resolved_at && !n.alert_acknowledged_at && canAcknowledgeAlert(actor, { team_id: n.team_id, department_id: n.department_id }),
  } : null,
});

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    const unread = req.query.unread === 'true';
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const rows = await query<any[]>(
      `SELECT n.*, a.resolved_at AS alert_resolved_at, a.acknowledged_at AS alert_acknowledged_at, t.department_id
         FROM notifications n
         LEFT JOIN alerts a ON a.id = n.alert_id
         LEFT JOIN teams t ON t.id = n.team_id
        WHERE n.user_id = ? AND n.company_id = ? AND (? = FALSE OR n.read_at IS NULL)
        ORDER BY n.created_at DESC LIMIT ?`,
      [actor.id, req.companyId, unread, limit]
    );
    const [{ n }] = await query<any[]>('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND company_id = ? AND read_at IS NULL', [actor.id, req.companyId]);
    res.json({ notifications: rows.map((r: any) => notificationJson(r, actor)), unreadCount: n });
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ error: 'Failed to load the notifications' });
  }
});

router.get('/unread-count', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const [{ n }] = await query<any[]>('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND company_id = ? AND read_at IS NULL', [req.userId, req.companyId]);
    res.json({ unreadCount: n });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to load the unread count' });
  }
});

router.post('/read-all', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const rows = await query<any[]>('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND company_id = ? AND read_at IS NULL RETURNING id', [req.userId, req.companyId]);
    res.json({ marked: rows.length, unreadCount: 0 });
  } catch (error) {
    console.error('Read all error:', error);
    res.status(500).json({ error: 'Failed to mark the notifications as read' });
  }
});

router.post('/:id/read', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Only the caller's own notification (another user's id is "not found").
    const row = await queryOne<any>(
      'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ? AND company_id = ? RETURNING id',
      [req.params.id, req.userId, req.companyId]
    );
    if (!row) return res.status(404).json({ error: 'Notification not found' });
    const [{ n }] = await query<any[]>('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND company_id = ? AND read_at IS NULL', [req.userId, req.companyId]);
    res.json({ ok: true, unreadCount: n });
  } catch (error) {
    console.error('Read notification error:', error);
    res.status(500).json({ error: 'Failed to mark the notification as read' });
  }
});

/* ------------------------------------------------------------------------------------------
 * Preferences
 * ---------------------------------------------------------------------------------------- */

router.get('/preferences', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    const { prefs, isDefault } = await getPrefs(actor);
    res.json({ preferences: prefs, isDefault, digestAvailable: canReceiveDigest(actor) });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to load the notification preferences' });
  }
});

router.put('/preferences', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    const { prefs: current } = await getPrefs(actor);
    let next;
    try {
      next = validatePrefs(req.body ?? {}, current);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    if (next.weeklyDigest && !canReceiveDigest(actor)) {
      return res.status(400).json({ error: 'The weekly digest is available to administrators, QA managers and team leads' });
    }
    await savePrefs(req.companyId as string, actor.id, next);
    await recordAudit({
      companyId: req.companyId as string, actorId: actor.id, action: 'notification_prefs.update', entityType: 'config', entityId: actor.id,
      summary: 'Changed own notification preferences', before: current, after: next, departmentIds: [], subjectIds: [actor.id],
    });
    res.json({ preferences: next, isDefault: false, digestAvailable: canReceiveDigest(actor) });
  } catch (error) {
    console.error('Save preferences error:', error);
    res.status(500).json({ error: 'Failed to save the notification preferences' });
  }
});

/* ------------------------------------------------------------------------------------------
 * Digest
 * ---------------------------------------------------------------------------------------- */

router.get('/digest/preview', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canReceiveDigest(actor)) return res.status(403).json({ error: 'The weekly digest is available to administrators, QA managers and team leads' });
    const me = await loadActor(req.companyId as string, actor.id);
    if (!me) return res.status(403).json({ error: 'Access denied' });
    const d = await buildDigest(req.companyId as string, me);
    const r = renderDigest(d);
    res.json({ digest: d, subject: r.subject, text: r.text });
  } catch (error) {
    console.error('Digest preview error:', error);
    res.status(500).json({ error: 'Failed to build the digest' });
  }
});

router.post('/digest/test', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canReceiveDigest(actor)) return res.status(403).json({ error: 'The weekly digest is available to administrators, QA managers and team leads' });
    const me = await loadActor(req.companyId as string, actor.id);
    if (!me) return res.status(403).json({ error: 'Access denied' });
    const r = await sendTestDigest(req.companyId as string, me);
    const delivered = r.status === 'sent';
    res.json({
      status: r.status,
      delivered,
      to: me.email,
      subject: r.subject,
      message: delivered ? `Test digest sent to ${me.email}` : r.status === 'logged' ? 'Email is not configured on this server (SMTP_HOST is not set): the digest was written to the server log instead.' : `The digest could not be sent: ${r.error ?? 'unknown error'}`,
    });
  } catch (error) {
    console.error('Test digest error:', error);
    res.status(500).json({ error: 'Failed to send the test digest' });
  }
});

/* ------------------------------------------------------------------------------------------
 * Company settings (Slack)
 * ---------------------------------------------------------------------------------------- */

router.get('/settings', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!canManageNotificationSettings(policyActor(req))) return res.status(403).json({ error: 'Only administrators can manage notification settings' });
    res.json({ settings: publicSettings(await getSettings(req.companyId as string)), smtpConfigured: !!process.env.SMTP_HOST });
  } catch (error) {
    console.error('Get notification settings error:', error);
    res.status(500).json({ error: 'Failed to load the notification settings' });
  }
});

router.put('/settings', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canManageNotificationSettings(actor)) return res.status(403).json({ error: 'Only administrators can manage notification settings' });
    const companyId = req.companyId as string;
    const body = req.body ?? {};
    const current = await getSettings(companyId);
    let enc: string | null | undefined;
    let hint: string | null | undefined;
    if (body.slackWebhookUrl !== undefined) {
      if (body.slackWebhookUrl === null || body.slackWebhookUrl === '') { enc = null; hint = null; }
      else {
        try {
          const url = validateSlackWebhook(body.slackWebhookUrl);
          enc = encryptSecret(url);
          hint = maskWebhook(url);
        } catch (e) {
          return res.status(400).json({ error: (e as Error).message });
        }
      }
    }
    for (const k of ['slackEnabled', 'slackDigest'] as const) {
      if (body[k] !== undefined && typeof body[k] !== 'boolean') return res.status(400).json({ error: `${k} must be true or false` });
    }
    if (body.slackMinSeverity !== undefined && !isSeverity(body.slackMinSeverity)) return res.status(400).json({ error: 'slackMinSeverity must be info, warning or critical' });
    const next = {
      enc: enc === undefined ? undefined : enc,
      hint: hint === undefined ? current.slackHint : hint,
      enabled: body.slackEnabled ?? current.slackEnabled,
      minSeverity: body.slackMinSeverity ?? current.slackMinSeverity,
      digest: body.slackDigest ?? current.slackDigest,
    };
    const configured = enc === undefined ? current.slackConfigured : !!enc;
    if (next.enabled && !configured) return res.status(400).json({ error: 'Enter the Slack webhook URL before turning Slack on' });
    await query(
      `INSERT INTO company_notification_settings (company_id, slack_webhook_enc, slack_webhook_hint, slack_enabled, slack_min_severity, slack_digest, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (company_id) DO UPDATE SET
         slack_webhook_enc = CASE WHEN ? THEN EXCLUDED.slack_webhook_enc ELSE company_notification_settings.slack_webhook_enc END,
         slack_webhook_hint = EXCLUDED.slack_webhook_hint, slack_enabled = EXCLUDED.slack_enabled, slack_min_severity = EXCLUDED.slack_min_severity,
         slack_digest = EXCLUDED.slack_digest, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [companyId, next.enc ?? null, next.hint, next.enabled, next.minSeverity, next.digest, actor.id, enc !== undefined]
    );
    // The change history never holds the webhook: only whether it is set and its masked hint.
    const view = (s: { configured: boolean; hint: string | null; enabled: boolean; minSeverity: string; digest: boolean }) => s;
    await recordAudit({
      companyId, actorId: actor.id, action: 'notification_settings.update', entityType: 'config', entityId: companyId,
      summary: `Changed Slack notifications${enc !== undefined ? (enc ? ' (new webhook)' : ' (webhook removed)') : ''}: ${next.enabled ? 'on' : 'off'}, from ${next.minSeverity}`,
      before: view({ configured: current.slackConfigured, hint: current.slackHint, enabled: current.slackEnabled, minSeverity: current.slackMinSeverity, digest: current.slackDigest }),
      after: view({ configured, hint: next.hint, enabled: next.enabled, minSeverity: next.minSeverity, digest: next.digest }),
      departmentIds: [], subjectIds: [companyId],
    });
    res.json({ settings: publicSettings(await getSettings(companyId)), smtpConfigured: !!process.env.SMTP_HOST });
  } catch (error) {
    console.error('Save notification settings error:', error);
    res.status(500).json({ error: 'Failed to save the notification settings' });
  }
});

router.post('/settings/slack-test', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canManageNotificationSettings(actor)) return res.status(403).json({ error: 'Only administrators can manage notification settings' });
    const s = await getSettings(req.companyId as string);
    if (!s.slackConfigured) return res.status(400).json({ error: 'No Slack webhook is configured' });
    if (s.slackUnreadable) return res.status(409).json({ error: 'The stored webhook cannot be read (the server’s encryption key changed). Enter it again.' });
    const r = await sendNow({
      companyId: req.companyId as string, channel: 'slack', kind: 'test', userId: actor.id, recipient: 'slack', subject: 'Test message',
      payload: { text: 'IronGate QE Navigator: test message. Alerts will be posted to this channel.' }, dedupeKey: null,
    });
    res.json({ status: r.status, delivered: r.status === 'sent', message: r.status === 'sent' ? 'Test message posted to Slack' : `Slack test failed: ${r.error ?? 'unknown error'}` });
  } catch (error) {
    console.error('Slack test error:', error);
    res.status(500).json({ error: 'Failed to send the Slack test message' });
  }
});

export default router;
