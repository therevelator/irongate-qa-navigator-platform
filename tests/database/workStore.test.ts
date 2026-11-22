/**
 * Raw work and code-quality store (migration 20261201000000) and the scheduled parts of phase 3:
 *   WDB-001  the migration is idempotent (applied again: nothing changes, nothing fails)
 *   WDB-002  the nightly recalculation (recomputeRecent) picks up a team whose only raw data are issues
 *            and a SARIF report, writes the work and quality evidence and KPI values (source 'computed')
 *            once, and nothing again when nothing changed
 *   WDB-003  the sample issues and reports (server/seeds/demoWork.ts) follow the team's KPI history:
 *            velocity, commitment and carryover equal its sprint_velocity rows, the code quality score its
 *            snapshot, blocked time and sizing accuracy its snapshot of the sprint's last day, escape rate
 *            and density stay close; re-running adds nothing; evidence only, never KPI values
 *   WDB-004  retention (cleanupRawData): resolved issues, closed sprints, reports and their findings after
 *            13 months (findings of reports 40 and 300 days old stay, 400 days old go); open issues are kept
 * Runs against DATABASE_URL (local only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../../src/lib/db';
import { cleanupRawData, recomputeRecent } from '../../server/lib/calc/engine';
import { computeSampleEvidence } from '../../server/seeds/demoRaw';
import { workSampleSqlForTeam } from '../../server/seeds/demoWork';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
const T = `wdb-team-${Date.now()}`;
const S = `${T}-sample`;
const DAY = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const dayAgo = (days: number) => ago(days).slice(0, 10);
const n = async (sql: string, p: any[] = []) => Number((await pool.query(sql, p)).rows[0].n);

describe('Work and code-quality store: migration, nightly recalculation, sample data and retention', () => {
  jest.setTimeout(120000);
  beforeAll(async () => {
    if (!local) return;
    for (const id of [T, S]) {
      await pool.query(
        `INSERT INTO teams (id, company_id, department_id, name, is_active)
         SELECT $1, company_id, id, $2, TRUE FROM departments WHERE is_active IS NOT FALSE ORDER BY id LIMIT 1`, [id, id === S ? 'Payments Sample' : id]);
    }
  });
  afterAll(async () => {
    if (local) {
      await pool.query('DELETE FROM metric_values WHERE team_id = ANY($1::text[])', [[T, S]]);
      await pool.query('DELETE FROM kpi_snapshots WHERE team_id = ANY($1::text[])', [[T, S]]);
      await pool.query('DELETE FROM teams WHERE id = ANY($1::text[])', [[T, S]]);
    }
    await pool.end();
  });

  it('WDB-001 the migration applies again without changes', async () => {
    if (!local) return;
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261201000000_raw_ingestion_phase3_work_quality.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql);
    const rls = (await pool.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('issues', 'issue_transitions', 'issue_sprints', 'analysis_reports', 'analysis_findings') ORDER BY relname`)).rows;
    expect(rls).toHaveLength(5);
    expect(rls.every((r: any) => r.relrowsecurity)).toBe(true);
    expect(await n(`SELECT COUNT(*) AS n FROM pg_policies WHERE tablename IN ('issues', 'issue_transitions', 'issue_sprints', 'analysis_reports', 'analysis_findings')`)).toBe(0);
  });

  it('WDB-002 the nightly run computes the work and quality values of a team with issues and a report only, and writes them once', async () => {
    if (!local) return;
    const co = (await pool.query(`SELECT company_id FROM teams WHERE id = $1`, [T])).rows[0].company_id;
    await pool.query(`INSERT INTO issue_sprints (company_id, team_id, external_id, name, state, started_at, completed_at) VALUES ($1, $2, 'S1', 'Sprint 1', 'closed', $3, $4)`, [co, T, ago(16), ago(3)]);
    for (const [key, pts, status, resolved] of [['W-1', 5, 'done', ago(5)], ['W-2', 3, 'in_progress', null]] as const) {
      await pool.query(
        `INSERT INTO issues (company_id, team_id, external_id, issue_type, status, status_category, resolution, story_points, sprint_ids, opened_at, resolved_at, day)
         VALUES ($1, $2, $3, 'story', $4::text, $4::text, $5, $6, ARRAY['S1']::varchar[], $7::timestamptz, $8::timestamptz, $7::timestamptz::date)`, [co, T, key, status, status === 'done' ? 'Done' : null, pts, ago(20), resolved]);
    }
    await pool.query(
      `INSERT INTO issues (company_id, team_id, external_id, issue_type, status_category, environment, found_in, opened_at, day)
       VALUES ($1, $2, 'W-3', 'bug', 'todo', 'Production', 'production', $3, CURRENT_DATE - 1), ($1, $2, 'W-4', 'bug', 'todo', 'QA', 'pre_release', $3, CURRENT_DATE - 1)`, [co, T, ago(1)]);
    await pool.query(
      `INSERT INTO analysis_reports (company_id, team_id, tool, repo, branch, commit_sha, analyzed_at, day, lines_of_code, findings, high, low)
       VALUES ($1, $2, 'SonarQube', 'app', 'main', 'c1', now() - interval '1 hour', CURRENT_DATE, 20000, 3, 1, 2)`, [co, T]);
    const r = await recomputeRecent(1);
    expect(r.teams).toBeGreaterThanOrEqual(1);
    const ev = Object.fromEntries((await pool.query(`SELECT metric_key, value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND day = $2::date`, [T, today])).rows.map((x) => [x.metric_key, x.v]));
    expect(ev.velocity).toBe(5);
    expect(ev.commitment).toBe(62.5);
    expect(ev.carryover).toBe(37.5);
    expect(ev.escape_rate).toBe(50);
    expect(ev.code_quality).toBe(Math.round(100 * Math.exp(-(6 / 20) / 20))); // weighted 5 + 1 = 6 over 20 KLOC
    const mv = await pool.query(`SELECT DISTINCT source FROM metric_values WHERE team_id = $1 AND metric_key IN ('sprint_velocity', 'code_quality_score')`, [T]);
    expect(mv.rows.map((x) => x.source)).toEqual(['computed']);
    const before = await n(`SELECT COUNT(*) AS n FROM metric_values WHERE team_id = $1`, [T]);
    await recomputeRecent(1);
    expect(await n(`SELECT COUNT(*) AS n FROM metric_values WHERE team_id = $1`, [T])).toBe(before);
  });

  it('WDB-003 sample issues and reports follow the KPI history, are re-runnable and are evidence only', async () => {
    if (!local) return;
    const co = (await pool.query(`SELECT company_id FROM teams WHERE id = $1`, [S])).rows[0].company_id;
    // 90 days of KPI history and six two-week sprints ending on Fridays.
    for (let d = 90; d >= 0; d--) {
      await pool.query(
        `INSERT INTO kpi_snapshots (team_id, snapshot_date, defect_escape_rate, defect_density, code_quality_score, blocked_time_hours, sizing_accuracy, sprint_velocity, field_sources)
         VALUES ($1, $2::date, 12, 0.8, $3, 9, 1.25, 40, '{}'::jsonb)`, [S, dayAgo(d), 70 + (d % 5)]);
    }
    const lastFriday = (() => { const x = new Date(Date.now() - DAY); while (x.getUTCDay() !== 5) x.setTime(x.getTime() - DAY); return x; })();
    const sprints: Array<{ name: string; end: string; committed: number; delivered: number }> = [];
    for (let k = 5; k >= 0; k--) {
      const end = new Date(lastFriday.getTime() - k * 14 * DAY).toISOString().slice(0, 10);
      const start = new Date(Date.parse(end) - 13 * DAY).toISOString().slice(0, 10);
      const committed = 50 + k;
      const delivered = 40 + (k % 3);
      sprints.push({ name: `Sprint ${10 - k}`, end, committed, delivered });
      await pool.query(`INSERT INTO sprint_velocity (team_id, sprint_name, start_date, end_date, committed_points, delivered_points, carryover_points) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [S, `Sprint ${10 - k}`, start, end, committed, delivered, committed - delivered]);
    }
    await pool.query(
      `INSERT INTO coverage_reports (id, company_id, team_id, format, commit_sha, branch, run_id, attempt, created_at, day, lines_found, lines_hit, file_count, is_sample)
       VALUES ($1, $2, $3, 'lcov', 'c', 'main', 'r', 1, now() - interval '2 hours', CURRENT_DATE, 10000, 7000, 20, TRUE)`, [`demo-raw-wdb-${Date.now()}`, co, S]);
    const sql = workSampleSqlForTeam({ id: S, companyId: co, name: 'Payments Sample' });
    for (const st of sql) await pool.query(st);
    const counts = async () => [
      await n(`SELECT COUNT(*) AS n FROM issues WHERE team_id = $1`, [S]), await n(`SELECT COUNT(*) AS n FROM issue_transitions WHERE team_id = $1`, [S]),
      await n(`SELECT COUNT(*) AS n FROM issue_sprints WHERE team_id = $1`, [S]), await n(`SELECT COUNT(*) AS n FROM analysis_reports WHERE team_id = $1`, [S]),
      await n(`SELECT COUNT(*) AS n FROM analysis_findings WHERE team_id = $1`, [S]),
    ];
    const first = await counts();
    expect(first[0]).toBeGreaterThan(100);
    expect(first[2]).toBe(6);
    expect(first[3]).toBeGreaterThanOrEqual(12);
    for (const st of sql) await pool.query(st);
    expect(await counts()).toEqual(first);
    expect(await n(`SELECT COUNT(*) AS n FROM issues WHERE team_id = $1 AND NOT is_sample`, [S])).toBe(0);
    // The nightly run leaves sample teams alone; the sample refresh records evidence, never KPI values.
    await recomputeRecent(1);
    expect(await n(`SELECT COUNT(*) AS n FROM metric_evidence WHERE team_id = $1`, [S])).toBe(0);
    const client = await pool.connect();
    try { await computeSampleEvidence(client, [S], 14); } finally { client.release(); }
    expect(await n(`SELECT COUNT(*) AS n FROM metric_values WHERE team_id = $1`, [S])).toBe(0);
    const last = sprints[sprints.length - 1];
    const ev = Object.fromEntries((await pool.query(`SELECT metric_key, value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND day = $2::date`, [S, today])).rows.map((x) => [x.metric_key, x.v]));
    expect(ev.velocity).toBe(last.delivered);
    expect(ev.commitment).toBe(Math.round((last.delivered / last.committed) * 10000) / 100);
    expect(ev.carryover).toBe(Math.round(((last.committed - last.delivered) / last.committed) * 10000) / 100);
    expect(ev.blocked_time).toBe(9);
    expect(ev.sizing_accuracy).toBe(1.25);
    expect(Math.abs(ev.escape_rate - 12)).toBeLessThanOrEqual(5);
    expect(Math.abs(ev.defect_density - 0.8)).toBeLessThanOrEqual(0.3);
    const lastReport = (await pool.query(`SELECT day, critical, high, medium, low, info, lines_of_code FROM analysis_reports WHERE team_id = $1 ORDER BY analyzed_at DESC LIMIT 1`, [S])).rows[0];
    const snap = (await pool.query(`SELECT code_quality_score::float8 AS q FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [S, lastReport.day])).rows[0].q;
    const w = lastReport.critical * 10 + lastReport.high * 5 + lastReport.medium * 2 + lastReport.low * 0.5;
    expect(Math.round(100 * Math.exp(-(w / (lastReport.lines_of_code / 1000)) / 20))).toBe(snap);
    expect(await n(`SELECT COUNT(*) AS n FROM analysis_reports WHERE team_id = $1 AND new_findings IS NOT NULL`, [S])).toBe(first[3] - 1);
  });

  it('WDB-004 retention: old resolved issues, closed sprints and reports go; findings kept 13 months like their reports; open issues stay', async () => {
    if (!local) return;
    const co = (await pool.query(`SELECT company_id FROM teams WHERE id = $1`, [T])).rows[0].company_id;
    await pool.query(
      `INSERT INTO issues (company_id, team_id, external_id, issue_type, status_category, opened_at, resolved_at, day) VALUES
         ($1, $2, 'OLD-1', 'bug', 'done', $3, $4, CURRENT_DATE - 410), ($1, $2, 'OLD-OPEN', 'bug', 'todo', $3, NULL, CURRENT_DATE - 410)`, [co, T, ago(410), ago(405)]);
    await pool.query(`INSERT INTO issue_sprints (company_id, team_id, external_id, state, started_at, completed_at) VALUES ($1, $2, 'S-OLD', 'closed', $3, $4)`, [co, T, ago(420), ago(406)]);
    const rep = async (id: string, days: number) => {
      await pool.query(`INSERT INTO analysis_reports (id, company_id, team_id, tool, repo, commit_sha, analyzed_at, day, findings, low) VALUES ($1, $2, $3, 'ESLint', 'old-app', $1, $4, $4::timestamptz::date, 1, 1)`, [id, co, T, ago(days)]);
      await pool.query(`INSERT INTO analysis_findings (report_id, team_id, fingerprint, rule_id, severity) VALUES ($1, $2, 'fp', 'no-unused-vars', 'low')`, [id, T]);
    };
    await rep(`${T}-r400`, 400);
    await rep(`${T}-r300`, 300);
    await rep(`${T}-r40`, 40);
    await rep(`${T}-r30`, 30);
    const r = await cleanupRawData();
    expect(r.issues).toBeGreaterThanOrEqual(1);
    expect(r.analysisReports).toBeGreaterThanOrEqual(1);
    expect(await n(`SELECT COUNT(*) AS n FROM issues WHERE team_id = $1 AND external_id = 'OLD-1'`, [T])).toBe(0);
    expect(await n(`SELECT COUNT(*) AS n FROM issues WHERE team_id = $1 AND external_id = 'OLD-OPEN'`, [T])).toBe(1);
    expect(await n(`SELECT COUNT(*) AS n FROM issues WHERE team_id = $1 AND external_id = 'W-1'`, [T])).toBe(1);
    expect(await n(`SELECT COUNT(*) AS n FROM issue_sprints WHERE team_id = $1 AND external_id = 'S-OLD'`, [T])).toBe(0);
    expect(await n(`SELECT COUNT(*) AS n FROM analysis_reports WHERE id = $1`, [`${T}-r400`])).toBe(0);
    expect(await n(`SELECT COUNT(*) AS n FROM analysis_findings WHERE report_id = $1`, [`${T}-r400`])).toBe(0);
    // Older reports keep their findings for 13 months too, not only the latest of its repository and tool.
    for (const id of [`${T}-r300`, `${T}-r40`, `${T}-r30`]) {
      expect(await n(`SELECT COUNT(*) AS n FROM analysis_reports WHERE id = $1`, [id])).toBe(1);
      expect(await n(`SELECT COUNT(*) AS n FROM analysis_findings WHERE report_id = $1`, [id])).toBe(1);
    }
  });
});
