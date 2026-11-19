import express from 'express';
import { query, queryOne, transaction } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { canManageCompanyConfig, canSetTargets } from '../lib/userPolicy';
import { recordAudit } from '../lib/audit';
import { execOn } from '../lib/assignments';
import { defaultTarget, isTargetMetric, loadTargetBook, TARGET_METRICS, TARGET_METRIC_KEYS, type TargetMetric, type TargetScope } from '../lib/targets';
import { METRICS_CONFIG } from '../../src/config/metricsConfig';
import { KPI_COLUMNS } from '../lib/kpiIngest';

/**
 * KPI targets with history (Administration → Parameters → KPI targets).
 *
 * GET /api/targets?scopeType=company|department|team&scopeId=…
 *   Every target metric at that scope: the effective target now (own value, else inherited from
 *   department / company, else the default), the scope's own value, and the scope's change
 *   history. Readable by every signed-in user of the company (targets are shown next to KPIs).
 * PUT /api/targets { scopeType, scopeId, targets: { <metric>: { good, warning } | null } }
 *   Sets (or with null: removes, so the parent's target applies again) the scope's targets from
 *   now on. The current row is closed (valid_to = now) and a new one opened, so values recorded
 *   before keep being judged with the target of their date. Policy: canSetTargets
 *   (company: super_admin; department / team: super_admin or that department's QA manager).
 *   Recorded in the change history.
 */
const router = express.Router();

interface ScopeRef { type: TargetScope; id: string; departmentId: string | null; name: string }

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

const metricInfo = (m: TargetMetric) => {
  const c = METRICS_CONFIG[TARGET_METRICS[m]];
  return { metric: m, key: TARGET_METRICS[m], label: KPI_COLUMNS[m].label, unit: c.unit ?? '', lowerIsBetter: c.lowerIsBetter };
};

router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const companyId = req.user.companyId;
    const scope = await resolveScope(companyId, req.query.scopeType, req.query.scopeId);
    if (!scope) return res.status(404).json({ error: 'Scope not found' });
    const book = await loadTargetBook(companyId);
    const now = Date.now();
    // Effective target at this scope = what a team of this scope gets.
    const teamRef = scope.type === 'team' ? { id: scope.id, department_id: scope.departmentId }
      : { id: '', department_id: scope.type === 'department' ? scope.id : null };
    const own = await query<any>(
      `SELECT metric_key, good, warning, valid_from FROM target_history
        WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND valid_to IS NULL`,
      [companyId, scope.type, scope.id]
    );
    const ownBy = new Map(own.map((r: any) => [r.metric_key, r]));
    const metrics = TARGET_METRIC_KEYS.map((m) => {
      const eff = book.at(teamRef, companyId, m, now);
      const o: any = ownBy.get(m);
      return {
        ...metricInfo(m),
        effective: eff,
        own: o ? { good: Number(o.good), warning: Number(o.warning), validFrom: new Date(o.valid_from).toISOString() } : null,
        default: (({ good, warning }) => ({ good, warning }))(defaultTarget(m)),
      };
    });
    const history = await query<any>(
      `SELECT th.id, th.metric_key, th.good, th.warning, th.valid_from, th.valid_to,
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS changed_by_name
         FROM target_history th LEFT JOIN users u ON u.id = th.changed_by
        WHERE th.company_id = ? AND th.scope_type = ? AND th.scope_id = ?
        ORDER BY th.valid_from DESC, th.metric_key
        LIMIT 200`,
      [companyId, scope.type, scope.id]
    );
    res.json({
      scope: { type: scope.type, id: scope.id, name: scope.name },
      canEdit: canSetTargets(policyActor(req), { type: scope.type, departmentId: scope.departmentId }),
      metrics,
      history: history.map((h: any) => ({
        id: h.id, metric: h.metric_key, good: Number(h.good), warning: Number(h.warning),
        validFrom: new Date(h.valid_from).toISOString(), validTo: h.valid_to ? new Date(h.valid_to).toISOString() : null,
        changedBy: h.changed_by_name ?? null,
      })),
    });
  } catch (error) {
    console.error('Get targets error:', error);
    res.status(500).json({ error: 'Failed to load the KPI targets' });
  }
});

class TargetError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

router.put('/', authenticateToken, async (req: any, res) => {
  try {
    const companyId = req.user.companyId;
    const { scopeType, scopeId, targets: rawTargets, applyToAll } = req.body ?? {};
    // applyToAll (company scope only): after saving, every department and team target is ended,
    // so the company targets apply everywhere. Allowed with no target changes.
    const applyAll = applyToAll === true;
    const targets = applyAll && (rawTargets === undefined || rawTargets === null) ? {} : rawTargets;
    const actor = policyActor(req);
    // Permission before the body is looked at (FI-15): only super admins and managers set targets.
    if (!canManageCompanyConfig(actor)) {
      return res.status(403).json({ error: 'You can only set targets for the departments you manage and their teams' });
    }
    const scope = await resolveScope(companyId, scopeType, scopeId);
    if (!scope) return res.status(404).json({ error: 'Scope not found' });
    if (!canSetTargets(actor, { type: scope.type, departmentId: scope.departmentId })) {
      return res.status(403).json({
        error: scope.type === 'company'
          ? 'Only a super admin can set company-wide targets'
          : 'You can only set targets for the departments you manage and their teams',
      });
    }
    if (applyAll && scope.type !== 'company') {
      return res.status(400).json({ error: 'applyToAll is only valid for company-wide targets' });
    }
    if (!targets || typeof targets !== 'object' || Array.isArray(targets) || (Object.keys(targets).length === 0 && !applyAll)) {
      return res.status(400).json({ error: 'targets must be an object of { metric: { good, warning } | null }' });
    }

    // Validate everything first.
    const errors: string[] = [];
    const wanted: Array<{ metric: TargetMetric; good: number; warning: number } | { metric: TargetMetric; clear: true }> = [];
    for (const [metric, v] of Object.entries<any>(targets)) {
      if (!isTargetMetric(metric)) { errors.push(`Unknown metric "${metric}"`); continue; }
      if (v === null) { wanted.push({ metric, clear: true }); continue; }
      const good = typeof v?.good === 'number' ? v.good : Number(v?.good);
      const warning = typeof v?.warning === 'number' ? v.warning : Number(v?.warning);
      const spec = KPI_COLUMNS[metric];
      if (!Number.isFinite(good) || !Number.isFinite(warning)) { errors.push(`${metric}: good and warning must be numbers`); continue; }
      if (good < spec.min || good > spec.max || warning < spec.min || warning > spec.max) {
        errors.push(`${metric}: targets must be between ${spec.min} and ${spec.max}`); continue;
      }
      const lower = METRICS_CONFIG[TARGET_METRICS[metric]].lowerIsBetter;
      if (lower ? warning < good : warning > good) {
        errors.push(`${metric}: the warning level must be ${lower ? 'at or above' : 'at or below'} the target (${lower ? 'lower' : 'higher'} is better)`);
        continue;
      }
      wanted.push({ metric, good, warning });
    }
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

    const changed = await transaction(async (client) => {
      const exec = execOn(client);
      // Serialise target writes of the company (one open row per scope and metric).
      await exec('SELECT pg_advisory_xact_lock(hashtext(?))', [`targets:${companyId}`]);
      const before: Record<string, any> = {};
      const after: Record<string, any> = {};
      for (const w of wanted) {
        const [open] = await exec<any>(
          `SELECT id, good, warning FROM target_history
            WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND metric_key = ? AND valid_to IS NULL`,
          [companyId, scope.type, scope.id, w.metric]
        );
        const same = open && !('clear' in w) && Number(open.good) === w.good && Number(open.warning) === w.warning;
        if (same || (!open && 'clear' in w)) continue;
        before[w.metric] = open ? { good: Number(open.good), warning: Number(open.warning) } : null;
        if (open) {
          // valid_to must be after valid_from: a row opened and replaced within the same instant is removed instead.
          await exec(
            `UPDATE target_history SET valid_to = GREATEST(now(), valid_from + interval '1 millisecond') WHERE id = ?`,
            [open.id]
          );
        }
        if ('clear' in w) {
          after[w.metric] = null;
        } else {
          await exec(
            `INSERT INTO target_history (company_id, scope_type, scope_id, metric_key, good, warning, valid_from, changed_by)
             VALUES (?, ?, ?, ?, ?, ?, GREATEST(now(), COALESCE((SELECT max(valid_to) FROM target_history
                     WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND metric_key = ?), now())), ?)`,
            [companyId, scope.type, scope.id, w.metric, w.good, w.warning, companyId, scope.type, scope.id, w.metric, req.user.id]
          );
          after[w.metric] = { good: w.good, warning: w.warning };
        }
      }
      const metrics = Object.keys(after);
      let replaced = 0;
      if (applyAll) {
        const ended = await exec<any>(
          `UPDATE target_history SET valid_to = GREATEST(now(), valid_from + interval '1 millisecond')
            WHERE company_id = ? AND scope_type IN ('department', 'team') AND valid_to IS NULL
            RETURNING metric_key`,
          [companyId]
        );
        replaced = ended.length;
      }
      if (applyAll || !metrics.length) {
        // Recorded even without a change: confirming the company-wide targets completes that
        // onboarding step (server/lib/onboarding.ts).
        await recordAudit({
          companyId, actorId: req.user.id, action: replaced > 0 ? 'targets.apply_all' : 'targets.confirm', entityType: 'config', entityId: scope.id,
          summary: replaced > 0
            ? `Applied company-wide KPI targets to every department and team (ended ${replaced} department/team target${replaced === 1 ? '' : 's'})`
            : `Confirmed the KPI targets (${scope.type} ${scope.name})`,
          departmentIds: [], subjectIds: [scope.id],
        }, exec);
      }
      if (metrics.length) {
        await recordAudit({
          companyId, actorId: req.user.id, action: 'targets.update', entityType: 'config', entityId: scope.id,
          summary: `Changed ${metrics.length} KPI target${metrics.length === 1 ? '' : 's'} (${scope.type} ${scope.name}): ${metrics.join(', ')}`,
          before, after,
          departmentIds: scope.departmentId ? [scope.departmentId] : [],
          subjectIds: [scope.id],
        }, exec);
      }
      return { metrics, replaced };
    });

    res.json({ success: true, changed: changed.metrics, replaced: changed.replaced });
  } catch (error) {
    if (error instanceof TargetError) return res.status(error.status).json({ error: error.message });
    console.error('Update targets error:', error);
    res.status(500).json({ error: 'Failed to save the KPI targets' });
  }
});

export default router;
