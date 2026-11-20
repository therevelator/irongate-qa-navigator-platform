/**
 * Sample status history of tracked actions (team_action_events, team_actions.status_changed_by / _at)
 * for sample actions that have none: who created the action and who moved it on, so the Action plan
 * shows names on sample data too ("Changed to Done by … on …").
 *
 * Every change is made by someone allowed to make it (server/lib/alertPolicy.ts): the creation by the
 * action's creator, else the team's lead, else the department's QA manager, else a company admin;
 * "in progress" by the action's owner (owners may change the status), else the lead; "done" by the
 * owner (or, for one in three, the lead); "dropped" by the lead or the department's QA manager. Only
 * active people with a live role assignment are picked. Times are on weekdays between 09:00 and
 * 17:00 UTC, after the creation and before now; a done action's last change is its completed_at.
 * Chains: open = created; in progress = created → in progress; done = created → in progress → done;
 * dropped = created → (in progress, for half of them) → dropped.
 *
 * One statement, idempotent (only actions without any history row; event ids derived from the
 * action id), never changes created_by, completed_at or the outcomes. Used after every demo seed /
 * fill (server/seeds/demoSeed.ts: `demo-` actions), by the Meridian showcase
 * (scripts/reseed/showcase-content.sql: `mft-act-` actions) and the production script for the live
 * Meridian organisation.
 */

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface SampleHistoryOptions {
  /** SQL condition on `a` (team_actions) selecting the sample actions. */
  where: string;
  /** Prefix of the generated event ids (e.g. 'demo-ahe-'); at most 12 characters. */
  idPrefix: string;
}

/** A weekday time between 09:00 and 17:00 UTC, `days` after the day of `base` (weekends move to Monday). */
const workTime = (base: string, days: string, h: string) => {
  const day = `((${base} AT TIME ZONE 'UTC')::date + (${days})::int)`;
  return `(((${day} + CASE extract(isodow FROM ${day}) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END)
            + make_interval(hours => 9 + (${h}) % 8, mins => ((${h}) / 8) % 60)) AT TIME ZONE 'UTC')`;
};

const personWith = (role: string, scopeType: string, scopeId: string, salt: string) =>
  `(SELECT ra.user_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active
     WHERE ra.company_id = x.company_id AND ra.revoked_at IS NULL AND ra.role = ${lit(role)} AND ra.scope_type = ${lit(scopeType)} AND ra.scope_id = ${scopeId}
     ORDER BY md5(ra.user_id || x.id || ${lit(salt)}) LIMIT 1)`;

export function sampleActionHistorySql(opts: SampleHistoryOptions): string {
  if (opts.idPrefix.length > 12) throw new Error('idPrefix too long');
  const P = lit(opts.idPrefix);
  return `WITH x AS (
  SELECT a.id, a.company_id, a.team_id, a.status, a.owner_id, a.created_by, a.created_at, a.completed_at, t.department_id,
         ('x' || substr(md5(a.id), 1, 7))::bit(28)::int AS h
    FROM team_actions a JOIN teams t ON t.id = a.team_id
   WHERE (${opts.where}) AND a.created_at < now() - interval '1 hour'
     AND NOT EXISTS (SELECT 1 FROM team_action_events e WHERE e.action_id = a.id)
), p AS (
  SELECT x.*,
         ${personWith('team_lead', 'team', 'x.team_id', 'lead')} AS lead_id,
         ${personWith('qa_manager', 'department', 'x.department_id', 'mgr')} AS manager_id,
         ${personWith('super_admin', 'company', 'x.company_id', 'admin')} AS admin_id,
         (SELECT u.id FROM users u WHERE u.id = x.owner_id AND u.is_active) AS owner_ok,
         (SELECT u.id FROM users u WHERE u.id = x.created_by AND u.is_active) AS creator_ok
    FROM x
), r AS (
  SELECT p.*,
         COALESCE(p.creator_ok, p.lead_id, p.manager_id, p.admin_id) AS creator,
         COALESCE(p.owner_ok, p.lead_id, p.manager_id, p.admin_id) AS starter,
         CASE WHEN p.h % 3 = 0 THEN COALESCE(p.lead_id, p.owner_ok, p.manager_id, p.admin_id)
              ELSE COALESCE(p.owner_ok, p.lead_id, p.manager_id, p.admin_id) END AS finisher,
         CASE WHEN p.h % 2 = 0 THEN COALESCE(p.manager_id, p.lead_id, p.admin_id)
              ELSE COALESCE(p.lead_id, p.manager_id, p.admin_id) END AS dropper,
         CASE WHEN p.status = 'done' AND p.completed_at IS NOT NULL THEN p.completed_at
              WHEN p.status IN ('done', 'dropped') THEN ${workTime('p.created_at', '3 + p.h % 9', 'p.h / 7')}
         END AS end_raw,
         ${workTime('p.created_at', '1 + p.h % 3', 'p.h / 5')} AS start_raw
    FROM p
), t AS (
  SELECT r.*,
         CASE WHEN r.end_raw IS NULL OR r.status = 'done' AND r.completed_at IS NOT NULL THEN r.end_raw
              WHEN r.end_raw > r.created_at AND r.end_raw < now() THEN r.end_raw
              ELSE r.created_at + (now() - r.created_at) * 0.6 END AS end_at
    FROM r
), t2 AS (
  SELECT t.*,
         CASE WHEN t.start_raw > t.created_at AND t.start_raw < LEAST(COALESCE(t.end_at, now()), now()) THEN t.start_raw
              ELSE t.created_at + (LEAST(COALESCE(t.end_at, now()), now()) - t.created_at) * 0.4 END AS start_at
    FROM t
), ev AS (
  SELECT t2.id AS action_id, t2.company_id, t2.team_id, 1 AS step, NULL::text AS from_status, 'open'::text AS to_status, t2.creator AS changed_by, t2.created_at AS changed_at
    FROM t2
  UNION ALL
  SELECT t2.id, t2.company_id, t2.team_id, 2, 'open', 'in_progress', t2.starter, t2.start_at
    FROM t2 WHERE t2.status IN ('in_progress', 'done') OR (t2.status = 'dropped' AND t2.h % 2 = 1)
  UNION ALL
  SELECT t2.id, t2.company_id, t2.team_id, 3, CASE WHEN t2.status = 'done' OR t2.h % 2 = 1 THEN 'in_progress' ELSE 'open' END, t2.status,
         CASE WHEN t2.status = 'done' THEN t2.finisher ELSE t2.dropper END, t2.end_at
    FROM t2 WHERE t2.status IN ('done', 'dropped')
), ok AS (
  -- Only actions whose every change has a person (and in order: created, then later changes).
  SELECT ev.* FROM ev
   WHERE NOT EXISTS (SELECT 1 FROM ev e2 WHERE e2.action_id = ev.action_id AND e2.changed_by IS NULL)
     AND NOT EXISTS (SELECT 1 FROM ev e2 JOIN ev e3 ON e3.action_id = e2.action_id AND e3.step > e2.step AND e3.changed_at <= e2.changed_at WHERE e2.action_id = ev.action_id)
), ins AS (
  INSERT INTO team_action_events (id, company_id, team_id, action_id, from_status, to_status, changed_by, source, changed_at)
  SELECT ${P} || substr(md5(ok.action_id || ':' || ok.step), 1, 24), ok.company_id, ok.team_id, ok.action_id, ok.from_status, ok.to_status, ok.changed_by, 'user', ok.changed_at
    FROM ok
  ON CONFLICT (id) DO NOTHING
  RETURNING action_id, to_status, changed_by, changed_at
)
UPDATE team_actions a
   SET status_changed_by = l.changed_by, status_changed_at = l.changed_at
  FROM (SELECT DISTINCT ON (action_id) * FROM ins ORDER BY action_id, changed_at DESC) l
 WHERE a.id = l.action_id AND a.status = l.to_status;`;
}

/** Sample (`demo-`) actions of any company: run after every demo seed and fill. */
export const DEMO_ACTION_HISTORY_SQL = sampleActionHistorySql({ where: `a.id LIKE 'demo-%'`, idPrefix: 'demo-ahe-' });

/** Meridian showcase actions (`mft-act-`, scripts/reseed/showcase-content.sql). */
export const MERIDIAN_ACTION_HISTORY_SQL = sampleActionHistorySql({ where: `a.company_id = 'mft-meridian' AND a.id LIKE 'mft-act-%'`, idPrefix: 'mft-ahe-' });
