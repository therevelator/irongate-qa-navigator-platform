/**
 * npm run seed:demo:check [-- --company <id>]
 *
 * Coverage check: for every active team of every company, does each analytics module have
 * data in the window its page shows? Uses the same tables, joins and windows as the API.
 * Prints a matrix per company and exits with code 1 below 100 %.
 */
import 'dotenv/config';

interface Module { key: string; label: string; sql: string }

// Each query returns the ids of active teams that have data ($1 = today).
const MODULES: Module[] = [
  { key: 'kpi', label: 'KPI snapshot (30 d)', sql: `SELECT DISTINCT team_id FROM kpi_snapshots WHERE qa_score IS NOT NULL AND snapshot_date >= $1::date - 30` },
  { key: 'devm', label: 'Developer metrics', sql: `SELECT DISTINCT dm.team_id FROM developer_metrics dm JOIN users u ON u.id = dm.developer_id WHERE u.is_active AND u.developer_insights_enabled AND $1::date IS NOT NULL` },
  { key: 'ddps30', label: 'DDPS (30 d)', sql: `
      SELECT DISTINCT t.id FROM teams t JOIN users u ON u.developer_insights_enabled AND u.company_id = t.company_id
        AND (u.primary_team_id = t.id OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = t.id)
             OR EXISTS (SELECT 1 FROM developer_metrics dm WHERE dm.developer_id = u.id AND dm.team_id = t.id))
       WHERE EXISTS (SELECT 1 FROM developer_productivity_snapshots s WHERE s.developer_id = u.id AND s.snapshot_date >= $1::date - 30)` },
  { key: 'ddps6m', label: 'DDPS (6 m, from month 1)', sql: `
      SELECT DISTINCT t.id FROM teams t JOIN users u ON u.developer_insights_enabled AND u.company_id = t.company_id
        AND (u.primary_team_id = t.id OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = t.id)
             OR EXISTS (SELECT 1 FROM developer_metrics dm WHERE dm.developer_id = u.id AND dm.team_id = t.id))
       WHERE EXISTS (SELECT 1 FROM developer_productivity_snapshots s WHERE s.developer_id = u.id AND s.snapshot_date BETWEEN $1::date - 180 AND $1::date - 150)` },
  { key: 'cases', label: 'Test cases', sql: `SELECT DISTINCT team_id FROM test_cases WHERE $1::date IS NOT NULL` },
  { key: 'flaky', label: 'Flaky tests', sql: `
      SELECT DISTINCT COALESCE(ft.team_id, tc.team_id) FROM flaky_tests ft LEFT JOIN test_cases tc ON tc.id = ft.test_case_id WHERE $1::date IS NOT NULL` },
  { key: 'suites7', label: 'Test executions (7 d)', sql: `SELECT DISTINCT team_id FROM test_execution_runs WHERE start_time >= $1::date - 7` },
  { key: 'pipe14', label: 'Pipeline history (14 d)', sql: `SELECT DISTINCT team_id FROM pipeline_execution_summary WHERE execution_date >= $1::date - 14` },
  { key: 'pipe30', label: 'Pipeline runs (30 d)', sql: `SELECT DISTINCT team_id FROM pipeline_runs WHERE started_at >= $1::date - 30` },
  { key: 'stages', label: 'Pipeline stages', sql: `SELECT DISTINCT team_id FROM pipeline_stages WHERE is_active AND $1::date IS NOT NULL` },
  { key: 'perf7', label: 'Performance (7 d)', sql: `SELECT DISTINCT team_id FROM performance_metrics WHERE recorded_date >= $1::date - 7` },
  { key: 'perf30', label: 'Performance (30 d, from week 1)', sql: `SELECT DISTINCT team_id FROM performance_metrics WHERE recorded_date BETWEEN $1::date - 30 AND $1::date - 23` },
  { key: 'perf90', label: 'Performance (90 d, from month 1)', sql: `SELECT DISTINCT team_id FROM performance_metrics WHERE recorded_date BETWEEN $1::date - 90 AND $1::date - 60` },
  { key: 'debt', label: 'Technical debt', sql: `SELECT DISTINCT team_id FROM technical_debt WHERE $1::date IS NOT NULL` },
  { key: 'bi', label: 'Business impact (>= 6 paired months in 12)', sql: `
      SELECT q.team_id FROM business_impact_quality_metrics q JOIN business_impact_business_kpis k ON k.team_id = q.team_id AND k.month_year = q.month_year
       WHERE q.month_year >= to_char($1::date - 365, 'YYYY-MM') GROUP BY q.team_id HAVING COUNT(*) >= 6` },
  { key: 'sprint', label: 'Sprint velocity', sql: `SELECT DISTINCT team_id FROM sprint_velocity WHERE end_date >= $1::date - 60` },
  { key: 'ta', label: 'Team analytics (14 d)', sql: `SELECT DISTINCT team_id FROM team_analytics WHERE period_end >= $1::date - 14` },
  { key: 'mlu', label: 'Metric last updated', sql: `SELECT DISTINCT team_id FROM metric_last_updated WHERE $1::date IS NOT NULL` },
  // The stored values the KPI snapshots are derived from (metric_values, migration 20261120000000).
  { key: 'mv', label: 'Metric values (30 d)', sql: `SELECT DISTINCT team_id FROM metric_values WHERE superseded_by IS NULL AND recorded_at >= $1::date - 30` },
  // Tracked actions (Team detail → Action plan, TV focus panel, digest; migration 20261121000000).
  { key: 'actions', label: 'Tracked actions', sql: `SELECT DISTINCT team_id FROM team_actions WHERE $1::date IS NOT NULL` },
];

// Demo sign-ins (README) must each have a real team, so every demo role sees data.
const DEMO_LOGINS_SQL = `
  SELECT u.email, EXISTS (
           SELECT 1 FROM role_assignments ra JOIN teams t ON t.id = ra.scope_id AND t.is_active
            WHERE ra.user_id = u.id AND ra.scope_type = 'team' AND ra.revoked_at IS NULL) AS has_team,
         EXISTS (SELECT 1 FROM teams t WHERE t.id = u.primary_team_id AND t.is_active) AS primary_ok
    FROM users u WHERE lower(u.email) = ANY($1::text[]) AND u.is_active AND ($2::text IS NULL OR u.company_id = $2)
   ORDER BY u.email`;

async function main() {
  const { pool } = await import('../../src/lib/db');
  const i = process.argv.indexOf('--company');
  const only = i >= 0 ? process.argv[i + 1] : null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const teams = (await pool.query(
      `SELECT t.id, t.name, t.company_id, c.name AS company FROM teams t JOIN companies c ON c.id = t.company_id
        WHERE t.is_active AND ($1::text IS NULL OR t.company_id = $1) ORDER BY c.name, t.name`, [only]
    )).rows as Array<{ id: string; name: string; company_id: string; company: string }>;
    const covered = new Map<string, Set<string>>();
    for (const m of MODULES) covered.set(m.key, new Set((await pool.query(m.sql, [today])).rows.map(r => Object.values(r)[0] as string)));

    console.log('Modules:');
    MODULES.forEach((m, n) => console.log(`  ${String.fromCharCode(65 + n)}  ${m.label}`));
    let ok = 0, total = 0;
    const missing: string[] = [];
    for (const company of [...new Set(teams.map(t => t.company_id))]) {
      const list = teams.filter(t => t.company_id === company);
      console.log(`\n${list[0].company} (${company}): ${list.length} active teams`);
      console.log(`  ${'team'.padEnd(36)} ${MODULES.map((_, n) => String.fromCharCode(65 + n)).join(' ')}`);
      for (const t of list) {
        const marks = MODULES.map(m => {
          total++;
          const has = covered.get(m.key)!.has(t.id);
          if (has) ok++; else missing.push(`${list[0].company} / ${t.name}: ${m.label}`);
          return has ? '✓' : '✗';
        });
        console.log(`  ${t.name.slice(0, 36).padEnd(36)} ${marks.join(' ')}`);
      }
    }
    const { DEMO_LOGIN_EMAILS } = await import('./demoData');
    const logins = (await pool.query(DEMO_LOGINS_SQL, [DEMO_LOGIN_EMAILS, only])).rows as Array<{ email: string; has_team: boolean; primary_ok: boolean }>;
    if (logins.length) {
      console.log('\nDemo sign-ins (team assignment / primary team):');
      for (const l of logins) {
        total++;
        const good = l.has_team && l.primary_ok;
        if (good) ok++; else missing.push(`Demo sign-in ${l.email}: no existing team (assignment ${l.has_team ? 'ok' : 'missing'}, primary team ${l.primary_ok ? 'ok' : 'missing'})`);
        console.log(`  ${l.email.padEnd(36)} ${l.has_team ? '✓' : '✗'} ${l.primary_ok ? '✓' : '✗'}`);
      }
    }
    const pct = total ? (ok / total) * 100 : 100;
    console.log(`\nCoverage: ${ok} / ${total} team-modules = ${pct.toFixed(1)} %`);
    if (missing.length) {
      console.log('Missing:');
      for (const m of missing) console.log(`  ${m}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
