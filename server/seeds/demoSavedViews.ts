/**
 * Sample saved views (table saved_views, migration 20261121100000) for the demo seed.
 *
 * Per company: views owned by its first super_admin (by e-mail), so the quick switchers on the
 * dashboard, the analytics modules and Compare teams are not empty in the demo:
 *   - dashboard "Needs attention" (shared with the company) and "Lowest coverage first" (personal)
 *   - compare "Weakest QA scores" (shared): the two active teams with the lowest current QA score
 *   - analytics (Flaky tests) "Flaky tests: <first team by name>" (personal)
 * Ids start with 'demo-sv-' (removed by seed:demo:clear). Idempotent: ON CONFLICT DO NOTHING, so a
 * re-run adds nothing and a person's own view with the same name is never touched.
 */
import { createHash } from 'crypto';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const vid = (companyId: string, key: string) => `demo-sv-${createHash('sha1').update(`${companyId}:${key}`).digest('hex').slice(0, 24)}`;

export function savedViewsSql(companyId: string): string {
  const c = q(companyId);
  const owner = `(SELECT u.id FROM users u JOIN role_assignments ra ON ra.user_id = u.id AND ra.role = 'super_admin' AND ra.revoked_at IS NULL
                   WHERE u.company_id = ${c} AND u.is_active ORDER BY lower(u.email) LIMIT 1)`;
  const weakest = `(SELECT jsonb_agg(x.id) FROM (
                      SELECT t.id FROM teams t
                        JOIN LATERAL (SELECT ks.qa_score FROM kpi_snapshots ks WHERE ks.team_id = t.id ORDER BY ks.snapshot_date DESC LIMIT 1) k ON k.qa_score IS NOT NULL
                       WHERE t.company_id = ${c} AND t.is_active ORDER BY k.qa_score ASC, t.name LIMIT 2) x)`;
  const firstTeam = `(SELECT t.id FROM teams t WHERE t.company_id = ${c} AND t.is_active ORDER BY t.name, t.id LIMIT 1)`;
  const row = (key: string, kind: string, module: string | null, name: string, state: string, shared: boolean, cond = 'TRUE', nameSql = q(name)) => `
    SELECT ${q(vid(companyId, key))}, ${c}, o.id, ${q(kind)}, ${module ? q(module) : 'NULL'}, ${nameSql}, ${state}, ${shared}, ${shared ? 'o.id' : 'NULL'}, ${shared ? 'now()' : 'NULL'}
      FROM (SELECT ${owner} AS id) o WHERE o.id IS NOT NULL AND (${cond})`;
  return `INSERT INTO saved_views (id, company_id, owner_id, kind, module, name, state, shared, shared_by, shared_at)
  ${[
    row('dash-attention', 'dashboard', null, 'Needs attention',
      `'{"filter":"attention","sort":{"key":"qa","dir":"asc"},"view":"list"}'::jsonb`, true),
    row('dash-coverage', 'dashboard', null, 'Lowest coverage first',
      `'{"filter":"all","sort":{"key":"coverage","dir":"asc"},"view":"grid","columns":2}'::jsonb`, false),
    row('cmp-weakest', 'compare', null, 'Weakest QA scores',
      `jsonb_build_object('teamIds', ${weakest}, 'days', 30)`, true, `COALESCE(jsonb_array_length(${weakest}), 0) = 2`),
    row('an-flaky', 'analytics', 'flaky-test-intelligence', '',
      `jsonb_build_object('teamId', ${firstTeam})`, false, `${firstTeam} IS NOT NULL`,
      `left('Flaky tests: ' || (SELECT t.name FROM teams t WHERE t.id = ${firstTeam}), 80)`),
  ].join('\n    UNION ALL')}
  ON CONFLICT DO NOTHING;`;
}
