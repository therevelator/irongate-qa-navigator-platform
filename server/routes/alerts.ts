import express from 'express';
import { query, queryOne, transaction } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamAnalytics, policyActor } from '../middleware/access';
import { recordAudit } from '../lib/audit';
import { execOn } from '../lib/assignments';
import {
  ALERT_RULES, evaluateCompany, isAlertRule, loadRuleBook, metricLabel, normaliseParams, RULE_DEFS, SEVERITY_RANK, type AlertRule,
} from '../lib/alerts';
import { refreshActionOutcomes } from '../lib/actions';
import { canManageCompanyConfig } from '../lib/userPolicy';
import { canAcknowledgeAlert, canEditAlertRules, canReadAlertRules, canRunEvaluation, canSeeAlert } from '../lib/alertPolicy';

/**
 * Alerts (server/lib/alerts.ts) — every route is authenticated and scoped to the caller's company.
 *
 * GET  /api/alerts?status=open|acknowledged|resolved|all&teamId=&limit=
 *        Alerts the caller may see (team alerts: analytics scope; company-level: super_admin).
 * POST /api/alerts/:id/acknowledge
 *        Team data writers (super_admin, the department's QA managers, the team's leads).
 * GET  /api/alerts/rules?scopeType=company|department|team&scopeId=
 *        Rule settings at a scope (own + effective): super_admin and QA managers.
 * PUT  /api/alerts/rules { scopeType, scopeId, rules: { <rule>: { enabled, params } | null } }
 *        As KPI targets (canSetTargets). null removes the scope's own setting (inherit again).
 * POST /api/alerts/evaluate
 *        Evaluate the company now (super_admin).
 * Changes are recorded in the change history.
 */
const router = express.Router();

const alertJson = (a: any, actor: ReturnType<typeof policyActor>) => ({
  id: a.id,
  teamId: a.team_id,
  teamName: a.team_name ?? null,
  rule: a.rule,
  ruleLabel: RULE_DEFS[a.rule as AlertRule]?.label ?? a.rule,
  metricKey: a.metric_key,
  metricLabel: a.metric_key ? metricLabel(a.metric_key) : null,
  severity: a.severity,
  message: a.message,
  details: a.details ?? {},
  createdAt: new Date(a.created_at).toISOString(),
  lastSeenAt: new Date(a.last_seen_at).toISOString(),
  acknowledgedAt: a.acknowledged_at ? new Date(a.acknowledged_at).toISOString() : null,
  acknowledgedBy: a.acknowledged_by_name ?? null,
  resolvedAt: a.resolved_at ? new Date(a.resolved_at).toISOString() : null,
  canAcknowledge: !a.resolved_at && !a.acknowledged_at && canAcknowledgeAlert(actor, a),
});

export const ALERT_SELECT = `
  SELECT a.*, t.name AS team_name, t.department_id,
         NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS acknowledged_by_name
    FROM alerts a
    LEFT JOIN teams t ON t.id = a.team_id
    LEFT JOIN users u ON u.id = a.acknowledged_by`;

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    if (!['open', 'acknowledged', 'resolved', 'all'].includes(status)) return res.status(400).json({ error: 'status must be open, acknowledged, resolved or all' });
    const teamId = typeof req.query.teamId === 'string' && req.query.teamId ? req.query.teamId : null;
    if (teamId && !(await assertTeamAnalytics(req, res, teamId))) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const cond = status === 'open' ? 'a.resolved_at IS NULL AND a.acknowledged_at IS NULL'
      : status === 'acknowledged' ? 'a.resolved_at IS NULL AND a.acknowledged_at IS NOT NULL'
      : status === 'resolved' ? 'a.resolved_at IS NOT NULL' : 'TRUE';
    const rows = await query<any[]>(
      `${ALERT_SELECT} WHERE a.company_id = ? AND ${cond} AND (?::text IS NULL OR a.team_id = ?)
        ORDER BY a.created_at DESC LIMIT 2000`,
      [req.companyId, teamId, teamId]
    );
    const visible = rows.filter((a: any) => canSeeAlert(actor, a));
    visible.sort((a: any, b: any) => (a.resolved_at ? 1 : 0) - (b.resolved_at ? 1 : 0)
      || SEVERITY_RANK[b.severity as keyof typeof SEVERITY_RANK] - SEVERITY_RANK[a.severity as keyof typeof SEVERITY_RANK]
      || Date.parse(b.created_at) - Date.parse(a.created_at));
    const openRows = await query<any[]>(
      `SELECT a.id, a.team_id, a.severity, a.acknowledged_at, t.department_id FROM alerts a LEFT JOIN teams t ON t.id = a.team_id
        WHERE a.company_id = ? AND a.resolved_at IS NULL AND (?::text IS NULL OR a.team_id = ?)`,
      [req.companyId, teamId, teamId]
    );
    const counts = { open: 0, acknowledged: 0, critical: 0, warning: 0, info: 0 };
    for (const a of openRows.filter((x: any) => canSeeAlert(actor, x))) {
      if (a.acknowledged_at) counts.acknowledged++; else counts.open++;
      counts[a.severity as 'critical' | 'warning' | 'info']++;
    }
    res.json({ alerts: visible.slice(0, limit).map((a: any) => alertJson(a, actor)), total: visible.length, counts });
  } catch (error) {
    console.error('List alerts error:', error);
    res.status(500).json({ error: 'Failed to load the alerts' });
  }
});

router.post('/:id/acknowledge', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    const a = await queryOne<any>(`${ALERT_SELECT} WHERE a.id = ? AND a.company_id = ?`, [req.params.id, req.companyId]);
    if (!a || !canSeeAlert(actor, a)) return res.status(404).json({ error: 'Alert not found' });
    if (!canAcknowledgeAlert(actor, a)) return res.status(403).json({ error: 'Only the team’s leads, its department’s managers and administrators can acknowledge this alert' });
    if (a.resolved_at) return res.status(409).json({ error: 'This alert is already resolved' });
    if (a.acknowledged_at) return res.json({ alert: alertJson(a, actor) });
    await transaction(async (client) => {
      const exec = execOn(client);
      await exec('UPDATE alerts SET acknowledged_at = NOW(), acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL', [actor.id, a.id]);
      await exec('UPDATE notifications SET read_at = NOW() WHERE alert_id = ? AND user_id = ? AND read_at IS NULL', [a.id, actor.id]);
      await recordAudit({
        companyId: req.companyId as string, actorId: actor.id, action: 'alert.acknowledge', entityType: 'alert', entityId: a.id,
        summary: `Acknowledged alert: ${a.team_name ? `${a.team_name} · ` : ''}${a.message}`.slice(0, 500),
        before: { acknowledged_at: null }, after: { acknowledged: true }, departmentIds: [a.department_id], subjectIds: [a.id, a.team_id],
      }, exec);
    });
    const after = await queryOne<any>(`${ALERT_SELECT} WHERE a.id = ?`, [a.id]);
    res.json({ alert: alertJson(after, actor) });
  } catch (error) {
    console.error('Acknowledge alert error:', error);
    res.status(500).json({ error: 'Failed to acknowledge the alert' });
  }
});

/* ------------------------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------------------------- */

interface ScopeRef { type: 'company' | 'department' | 'team'; id: string; departmentId: string | null; name: string }

async function resolveScope(companyId: string, scopeType: unknown, scopeId: unknown): Promise<ScopeRef | null> {
  if (scopeType === 'company' || scopeType === undefined || scopeType === '') {
    const c = await queryOne<any>('SELECT id, name FROM companies WHERE id = ?', [companyId]);
    return c ? { type: 'company', id: c.id, departmentId: null, name: c.name } : null;
  }
  if (typeof scopeId !== 'string' || !scopeId) return null;
  if (scopeType === 'department') {
    const d = await queryOne<any>('SELECT id, name FROM departments WHERE id = ? AND company_id = ?', [scopeId, companyId]);
    return d ? { type: 'department', id: d.id, departmentId: d.id, name: d.name } : null;
  }
  if (scopeType === 'team') {
    const t = await queryOne<any>('SELECT id, name, department_id FROM teams WHERE id = ? AND company_id = ?', [scopeId, companyId]);
    return t ? { type: 'team', id: t.id, departmentId: t.department_id, name: t.name } : null;
  }
  return null;
}

async function rulesAt(companyId: string, scope: ScopeRef) {
  const book = await loadRuleBook(companyId);
  const ref = { companyId, departmentId: scope.departmentId, teamId: scope.type === 'team' ? scope.id : null };
  return ALERT_RULES.map((rule) => {
    const def = RULE_DEFS[rule];
    const own = book.own(scope.type, scope.id, rule);
    return {
      rule, label: def.label, description: def.description, params: def.params, defaults: def.defaults,
      own,
      effective: book.resolve(rule, ref),
    };
  });
}

router.get('/rules', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canReadAlertRules(actor)) return res.status(403).json({ error: 'Only super admins and managers can see the alert rules' });
    const scope = await resolveScope(req.companyId as string, req.query.scopeType, req.query.scopeId);
    if (!scope) return res.status(404).json({ error: 'Scope not found' });
    res.json({
      scope: { type: scope.type, id: scope.id, name: scope.name },
      canEdit: canEditAlertRules(actor, { type: scope.type, departmentId: scope.departmentId }),
      rules: await rulesAt(req.companyId as string, scope),
    });
  } catch (error) {
    console.error('Get alert rules error:', error);
    res.status(500).json({ error: 'Failed to load the alert rules' });
  }
});

router.put('/rules', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    const companyId = req.companyId as string;
    const { scopeType, scopeId, rules } = req.body ?? {};
    // Permission before the body is looked at (FI-15): only super admins and managers edit alert rules.
    if (!canManageCompanyConfig(actor)) {
      return res.status(403).json({ error: 'Only administrators and department managers can change alert rules' });
    }
    const scope = await resolveScope(companyId, scopeType, scopeId);
    if (!scope) return res.status(404).json({ error: 'Scope not found' });
    if (!canEditAlertRules(actor, { type: scope.type, departmentId: scope.departmentId })) {
      return res.status(403).json({ error: scope.type === 'company' ? 'Only administrators can change company alert rules' : 'Only administrators and this department’s managers can change these alert rules' });
    }
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return res.status(400).json({ error: 'rules must be an object of { rule: { enabled, params } | null }' });
    const changes: Array<{ rule: AlertRule; value: { enabled: boolean; params: Record<string, number | string> } | null }> = [];
    for (const [rule, v] of Object.entries(rules)) {
      if (!isAlertRule(rule)) return res.status(400).json({ error: `Unknown rule "${rule}"` });
      if (v === null) { changes.push({ rule, value: null }); continue; }
      if (!v || typeof v !== 'object' || typeof (v as any).enabled !== 'boolean') return res.status(400).json({ error: `${rule}: enabled must be true or false` });
      try {
        changes.push({ rule, value: { enabled: (v as any).enabled, params: normaliseParams(rule, (v as any).params) } });
      } catch (e) {
        return res.status(400).json({ error: `${RULE_DEFS[rule].label}: ${(e as Error).message}` });
      }
    }
    if (!changes.length) return res.status(400).json({ error: 'No rule changes' });
    const book = await loadRuleBook(companyId);
    await transaction(async (client) => {
      const exec = execOn(client);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const c of changes) {
        before[c.rule] = book.own(scope.type, scope.id, c.rule);
        after[c.rule] = c.value;
        if (c.value === null) {
          await exec('DELETE FROM alert_rules WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND rule = ?', [companyId, scope.type, scope.id, c.rule]);
        } else {
          await exec(
            `INSERT INTO alert_rules (company_id, scope_type, scope_id, rule, enabled, params, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, NOW())
             ON CONFLICT (company_id, scope_type, scope_id, rule) DO UPDATE SET enabled = EXCLUDED.enabled, params = EXCLUDED.params, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [companyId, scope.type, scope.id, c.rule, c.value.enabled, JSON.stringify(c.value.params), actor.id]
          );
        }
      }
      await recordAudit({
        companyId, actorId: actor.id, action: 'alert_rules.update', entityType: 'config', entityId: scope.id,
        summary: `Changed ${changes.length} alert rule${changes.length === 1 ? '' : 's'} (${scope.type} ${scope.name}): ${changes.map((c) => c.rule).join(', ')}`,
        before, after, departmentIds: [scope.departmentId], subjectIds: [scope.id],
      }, exec);
    });
    // Re-evaluate the affected teams with the new rules (best effort; the change is saved).
    const teamIds = scope.type === 'team' ? [scope.id]
      : scope.type === 'department' ? (await query<any[]>('SELECT id FROM teams WHERE company_id = ? AND department_id = ? AND is_active', [companyId, scope.id])).map((t: any) => t.id)
      : undefined;
    await evaluateCompany(companyId, teamIds ? { teamIds } : {}).catch((e) => console.error('[alerts] re-evaluation after a rule change failed:', e?.message ?? e));
    res.json({
      scope: { type: scope.type, id: scope.id, name: scope.name },
      canEdit: true,
      rules: await rulesAt(companyId, scope),
    });
  } catch (error) {
    console.error('Update alert rules error:', error);
    res.status(500).json({ error: 'Failed to save the alert rules' });
  }
});

router.post('/evaluate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!canRunEvaluation(policyActor(req))) return res.status(403).json({ error: 'Only administrators can run the alert evaluation' });
    const r = await evaluateCompany(req.companyId as string);
    const outcomes = await refreshActionOutcomes(req.companyId as string);
    res.json({ teams: r.teams, opened: r.opened.length, escalated: r.escalated.length, refreshed: r.refreshed, resolved: r.resolved, actionOutcomesUpdated: outcomes });
  } catch (error) {
    console.error('Evaluate alerts error:', error);
    res.status(500).json({ error: 'Failed to evaluate the alerts' });
  }
});

export default router;
