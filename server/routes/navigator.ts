import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { analyticsTeamsInScope } from '../lib/userPolicy';
import { actionsForTeams } from '../lib/actions';
import { LOST_CAUSES, LOST_CAUSE_LABELS, lostHoursFor, lostHoursTables, type LostCause, type TeamLostHours } from '../lib/lostHours';
import {
  discoveryHints, FINDING_MIN_HOURS, READINESS_DAYS, readinessPercent, SOURCES, teamFindings, teamState, verdictOf,
  type DiscoveryReport, type FindingJson, type SourceKey, type SourceState,
} from '../lib/navigator';

/**
 * The "next move" pages. Authenticated, company-scoped, read-only; the teams are those of the caller's analytics
 * scope (analyticsTeamsInScope: a super admin the company, a manager their departments, everyone else their teams).
 *
 * GET /api/navigator/status      hours lost per week (12 weeks, by cause), how the figure moved, each team's state and
 *                                its one thing this week, the verified actions
 * GET /api/navigator/findings    the findings of the teams in scope, the costliest first (?team=<id> for one team)
 * GET /api/navigator/outcomes    suggestions without an owner and the tracked actions by verdict (owned, waiting for
 *                                the verdict, verified, not held); ?month=YYYY-MM cuts "done" to one month
 * GET /api/navigator/readiness   per team and source: connected, stale or missing; what each gap blocks and its fix;
 *                                what the Exporter reported on its last run
 *
 * Giving a finding an owner uses the existing endpoints: POST /api/improve/recommendations/:id/accept for a
 * recommendation, POST /api/actions for a finding built from a cause. Nothing here changes a pipeline or a repository.
 */
const router = express.Router();

interface TeamRow { id: string; name: string; department_id: string | null; department_name: string | null }

async function scopedTeams(req: AuthRequest): Promise<TeamRow[]> {
  const rows = await query<any[]>(
    `SELECT t.id, t.name, t.department_id, d.name AS department_name FROM teams t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.company_id = ? AND t.is_active = TRUE ORDER BY d.name NULLS LAST, t.name`, [req.companyId]);
  return analyticsTeamsInScope(policyActor(req), rows.map((r: any) => ({ id: String(r.id), name: r.name, department_id: r.department_id ? String(r.department_id) : null, department_name: r.department_name ?? null })));
}

const REC_SQL = `
  SELECT r.*, a.id AS a_id, a.title AS a_title, a.status AS a_status, a.due_date AS a_due,
         NULLIF(TRIM(COALESCE(o.first_name, '') || ' ' || COALESCE(o.last_name, '')), '') AS a_owner
    FROM recommendations r LEFT JOIN team_actions a ON a.id = r.action_id LEFT JOIN users o ON o.id = a.owner_id
   WHERE r.team_id = ANY(?::text[]) AND ((r.status = 'open' AND r.active) OR (r.status = 'accepted' AND a.status IN ('open', 'in_progress')))
   ORDER BY r.rank NULLS LAST, r.score DESC`;

async function findingsFor(teams: TeamRow[], lost: Map<string, TeamLostHours>): Promise<Map<string, FindingJson[]>> {
  const recs = teams.length ? await query<any[]>(REC_SQL, [teams.map((t) => t.id)]) : [];
  const out = new Map<string, FindingJson[]>();
  for (const t of teams) {
    const l = lost.get(t.id);
    out.set(t.id, teamFindings(t, l?.weeks ?? [], l?.detail ?? { slow_stage: [], flaky_rerun: [], blocked: [], failed_change: [], review_wait: null }, l?.samples ?? {}, recs.filter((r: any) => r.team_id === t.id)));
  }
  return out;
}

type Cells = Record<SourceKey, SourceState>;

async function readinessFor(teamIds: string[]): Promise<Map<string, { cells: Cells; last: Partial<Record<SourceKey, string>> }>> {
  const out = new Map<string, { cells: Cells; last: Partial<Record<SourceKey, string>> }>();
  for (const id of teamIds) out.set(id, { cells: Object.fromEntries(SOURCES.map((s) => [s.key, 'missing'])) as Cells, last: {} });
  if (!teamIds.length) return out;
  const optional = async (table: string, sql: string) =>
    (await queryOne<any>(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`))?.ok ? sql : null;
  const parts = [
    `SELECT team_id, 'pipelines' AS k, MAX(day)::text AS d FROM pipeline_runs_raw WHERE team_id = ANY($1) GROUP BY 1`,
    `SELECT team_id, 'tests', MAX(day)::text FROM test_runs WHERE team_id = ANY($1) GROUP BY 1`,
    `SELECT team_id, 'coverage', MAX(day)::text FROM coverage_reports WHERE team_id = ANY($1) GROUP BY 1`,
    `SELECT team_id, 'deployments', MAX(day)::text FROM deployments_raw WHERE team_id = ANY($1) GROUP BY 1`,
    `SELECT team_id, 'incidents', MAX(day)::text FROM incidents_raw WHERE team_id = ANY($1) GROUP BY 1`,
    await optional('issues', `SELECT team_id, 'issues', MAX(GREATEST(opened_at, COALESCE(source_updated_at, opened_at)))::date::text FROM issues WHERE team_id = ANY($1) GROUP BY 1`),
    await optional('pull_requests_raw', `SELECT team_id, 'pull_requests', MAX(opened_at)::date::text FROM pull_requests_raw WHERE team_id = ANY($1) GROUP BY 1`),
    await optional('performance_runs', `SELECT team_id, 'performance', MAX(day)::text FROM performance_runs WHERE team_id = ANY($1) GROUP BY 1`),
    await optional('tm_cases', `SELECT team_id, 'test_management', MAX(received_at)::date::text FROM tm_cases WHERE team_id = ANY($1) GROUP BY 1`),
  ].filter((p): p is string => !!p);
  const rows = await query<any[]>(parts.join(' UNION ALL ').replace(/\$1/g, '?::text[]'), parts.map(() => teamIds));
  const today = Date.now();
  for (const r of rows) {
    const t = out.get(r.team_id);
    if (!t || !r.d) continue;
    const k = r.k as SourceKey;
    // Incidents are rare by nature: a team is connected when one was sent in the last 180 days.
    const limit = k === 'incidents' ? 180 : k === 'test_management' ? 90 : READINESS_DAYS;
    t.last[k] = r.d;
    t.cells[k] = today - Date.parse(`${r.d}T00:00:00Z`) <= (limit + 1) * 86_400_000 ? 'ok' : 'stale';
  }
  return out;
}

async function discoveryFor(teamIds: string[]): Promise<Map<string, DiscoveryReport[]>> {
  const out = new Map<string, DiscoveryReport[]>();
  if (!teamIds.length || !(await queryOne<any>(`SELECT to_regclass('public.exporter_discovery') IS NOT NULL AS ok`))?.ok) return out;
  const rows = await query<any[]>(`SELECT team_id, source, exporter_version, reported_at, report FROM exporter_discovery WHERE team_id = ANY(?::text[]) ORDER BY source`, [teamIds]);
  for (const r of rows) {
    const rep = r.report ?? {};
    const list = out.get(r.team_id) ?? [];
    list.push({
      source: r.source, reportedAt: new Date(r.reported_at).toISOString(), exporterVersion: r.exporter_version ?? null,
      counts: rep.counts ?? {}, runsWithoutTests: rep.runsWithoutTests ?? null, runsWithoutCoverage: rep.runsWithoutCoverage ?? null,
      unmapped: Array.isArray(rep.unmapped) ? rep.unmapped : [], notes: Array.isArray(rep.notes) ? rep.notes : [],
    });
    out.set(r.team_id, list);
  }
  return out;
}

const sumWeeks = (list: TeamLostHours[]) => {
  const weeks = list.find((l) => l.weeks.length)?.weeks.map((w) => ({ start: w.start, end: w.end })) ?? [];
  return weeks.map((w) => {
    const hours = Object.fromEntries(LOST_CAUSES.map((c) => [c, 0])) as Record<LostCause, number>;
    for (const l of list) { const x = l.weeks.find((y) => y.start === w.start); if (x) for (const c of LOST_CAUSES) hours[c] += x.hours[c]; }
    for (const c of LOST_CAUSES) hours[c] = Math.round(hours[c] * 10) / 10;
    return { ...w, hours, total: Math.round(LOST_CAUSES.reduce((n, c) => n + hours[c], 0) * 10) / 10 };
  });
};

const fail = (res: express.Response, e: unknown, what: string) => { console.error(`${what}:`, e); res.status(500).json({ error: what }); };

router.get('/status', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const teams = await scopedTeams(req);
    const ids = teams.map((t) => t.id);
    const ready = await lostHoursTables();
    const lost = await lostHoursFor(req.companyId as string, ids);
    const [findings, readiness, actions, company] = await Promise.all([
      findingsFor(teams, lost), readinessFor(ids), actionsForTeams(req.companyId as string, ids, 90), queryOne<any>('SELECT name FROM companies WHERE id = ?', [req.companyId]),
    ]);
    const weeks = sumWeeks([...lost.values()]);
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    const verified = actions.filter((a) => verdictOf(a) === 'verified');
    const teamRows = teams.map((t) => {
      const l = lost.get(t.id);
      const f = findings.get(t.id) ?? [];
      const r = readiness.get(t.id)!;
      const focus = f.find((x) => x.action && x.hours !== null) ?? f.find((x) => x.hours !== null) ?? f[0] ?? null;
      const pct = readinessPercent(r.cells);
      const state = pct < 50 ? 'unknown' : teamState(l?.weeks ?? [], l?.samples);
      return {
        id: t.id, name: t.name, department: t.department_name, state, readiness: pct,
        hoursNow: l?.weeks.length ? l.weeks[l.weeks.length - 1].total : null, hoursBefore: l?.weeks.length ? l.weeks[0].total : null,
        trend: l?.weeks.map((w) => w.total) ?? [],
        focus: focus ? { id: focus.id, title: focus.action?.title ?? focus.title, hours: focus.hours, owner: focus.action?.owner ?? null, dueDate: focus.action?.dueDate ?? null, status: focus.action?.status ?? 'suggested' } : null,
        findings: f.length,
      };
    });
    const order = { slipping: 0, unknown: 1, steady: 2, improving: 3 } as const;
    teamRows.sort((a, b) => order[a.state] - order[b.state] || (b.hoursNow ?? 0) - (a.hoursNow ?? 0));
    const all = [...findings.values()].flat();
    const unowned = all.filter((f) => !f.action && f.hours !== null);
    res.json({
      available: ready, companyName: company?.name ?? null, generatedAt: new Date().toISOString(),
      weeks, hoursNow: last?.total ?? null, hoursBefore: first?.total ?? null, period: first && last ? { from: first.start, to: last.end } : null,
      causes: LOST_CAUSES.map((c) => ({ key: c, ...LOST_CAUSE_LABELS[c], now: last?.hours[c] ?? 0, before: first?.hours[c] ?? 0 })),
      teams: teamRows,
      unowned: { count: unowned.length, hours: Math.round(unowned.reduce((n, f) => n + (f.hours ?? 0), 0) * 10) / 10 },
      verified: verified.slice(0, 8).map((a) => ({ id: a.id, title: a.title, teamName: a.teamName, owner: a.owner?.name ?? null, metric: a.metric?.label ?? null, unit: a.metric?.unit ?? null, before: a.baseline?.value ?? null,
        after: [...a.outcomes].reverse().find((o) => o.value !== null)?.value ?? null, completedAt: a.completedAt })),
      verifiedCount: verified.length,
      waitingCount: actions.filter((a) => verdictOf(a) === 'waiting').length,
      minHours: FINDING_MIN_HOURS,
    });
  } catch (e) { fail(res, e, 'Failed to load the company status'); }
});

router.get('/findings', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const only = typeof req.query.team === 'string' ? req.query.team : null;
    const teams = (await scopedTeams(req)).filter((t) => !only || t.id === only);
    const lost = await lostHoursFor(req.companyId as string, teams.map((t) => t.id));
    const findings = [...(await findingsFor(teams, lost)).values()].flat().sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1));
    const measured = findings.reduce((n, f) => n + (f.hours ?? 0), 0);
    const total = sumWeeks([...lost.values()]).slice(-1)[0]?.total ?? 0;
    res.json({ findings, hoursExplained: Math.round(measured * 10) / 10, hoursTotal: total, teams: teams.map((t) => ({ id: t.id, name: t.name })), causes: LOST_CAUSE_LABELS, generatedAt: new Date().toISOString() });
  } catch (e) { fail(res, e, 'Failed to load the findings'); }
});

router.get('/outcomes', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : null;
    const teams = await scopedTeams(req);
    const ids = teams.map((t) => t.id);
    const lost = await lostHoursFor(req.companyId as string, ids);
    const [findings, actions] = await Promise.all([findingsFor(teams, lost), actionsForTeams(req.companyId as string, ids, month ? 400 : 120)]);
    const suggested = [...findings.values()].flat().filter((f) => !f.action).sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1));
    const card = (a: (typeof actions)[number]) => ({
      id: a.id, teamId: a.teamId, teamName: a.teamName, title: a.title, owner: a.owner?.name ?? null, dueDate: a.dueDate, overdue: a.overdue, status: a.status,
      metric: a.metric, baseline: a.baseline?.value ?? null, current: a.current?.value ?? null, completedAt: a.completedAt, createdAt: a.createdAt,
      outcomes: a.outcomes, verdict: verdictOf(a),
    });
    const cards = actions.map(card).filter((a) => a.verdict !== null && (!month || a.verdict === 'owned' || (a.completedAt ?? '').startsWith(month)));
    const weeks = sumWeeks([...lost.values()]);
    res.json({
      month, suggested, owned: cards.filter((a) => a.verdict === 'owned'), waiting: cards.filter((a) => a.verdict === 'waiting'),
      verified: cards.filter((a) => a.verdict === 'verified'), notHeld: cards.filter((a) => a.verdict === 'not_held'),
      weeks, causes: LOST_CAUSES.map((c) => ({ key: c, ...LOST_CAUSE_LABELS[c], now: weeks[weeks.length - 1]?.hours[c] ?? 0, before: weeks[0]?.hours[c] ?? 0 })),
      verdictRule: 'Verified: the linked KPI improved on its value when the action was created, at the latest checkpoint (14 or 30 days after it was done). Not held: unchanged or worse at that checkpoint. Waiting: done, no checkpoint yet.',
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { fail(res, e, 'Failed to load the outcomes'); }
});

router.get('/readiness', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const teams = await scopedTeams(req);
    const ids = teams.map((t) => t.id);
    const [readiness, discovery, exporter] = await Promise.all([
      readinessFor(ids), discoveryFor(ids),
      queryOne<any>(`SELECT exporter_version, host_label, received_at FROM exporter_deliveries WHERE company_id = ? AND NOT dry_run ORDER BY received_at DESC LIMIT 1`, [req.companyId]).catch(() => null),
    ]);
    const rows = teams.map((t) => {
      const r = readiness.get(t.id)!;
      const reports = discovery.get(t.id) ?? [];
      return {
        id: t.id, name: t.name, department: t.department_name, cells: r.cells, last: r.last, readiness: readinessPercent(r.cells),
        gaps: SOURCES.filter((s) => r.cells[s.key] !== 'ok').map((s) => ({
          source: s.key, label: s.label, required: s.required, state: r.cells[s.key], lastSeen: r.last[s.key] ?? null, blocks: s.blocks, fix: s.fix, effort: s.effort, seen: discoveryHints(s.key, reports),
        })),
        discovery: reports,
      };
    });
    res.json({
      sources: SOURCES.map((s) => ({ key: s.key, label: s.label, required: s.required })), teams: rows,
      exporter: exporter ? { version: exporter.exporter_version ?? null, host: exporter.host_label ?? null, lastSeen: new Date(exporter.received_at).toISOString() } : null,
      rule: `A source is connected when the team sent a record of that kind in the last ${READINESS_DAYS} days (incidents: 180, test management: 90). Readiness is the share of the six required sources that are connected.`,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { fail(res, e, 'Failed to load data readiness'); }
});

export default router;
