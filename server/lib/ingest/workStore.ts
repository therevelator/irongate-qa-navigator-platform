/**
 * Raw store writes of phase 3 (migration 20261201000000): sprints, issues with their changes, and
 * static-analysis reports with their findings, inside the caller's transaction.
 *   sprints   team + sprint id: created, then updated as they start and close
 *   issues    team + issue key: the same issue again writes nothing ("duplicate"); a changed issue updates
 *             the row ("updated") unless it is older than the stored one (out-of-order webhooks: only its
 *             new changes are added); changes are kept once per field + time + value
 *   reports   team + tool + repository + commit + run + attempt (raw_uploads keeps the request identity);
 *             findings are compared with the previous report of the same repository, branch and tool:
 *             new (not in the previous one) and fixed (in the previous one, not in this one)
 * Each function returns the days whose metrics depend on what changed.
 */
import type pg from 'pg';
import { sha256 } from './store';
import type { IssueEvent, SprintRef } from './issueEvents';
import { severityCounts, type ParsedAnalysis } from './sarif';

export type IssueStatus = 'written' | 'updated' | 'duplicate';
export interface StoredIssue { key: string; team: string; status: IssueStatus; days: string[] }

const dayOf = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Sprints: insert or update by team + sprint id (a value sent later fills what was missing). */
export async function storeSprints(client: pg.PoolClient, companyId: string, teamId: string, sprints: SprintRef[], uploadId: string | null, sample = false): Promise<{ changed: number; days: string[] }> {
  let changed = 0;
  const days: string[] = [];
  for (const s of sprints) {
    const state = s.state ?? (s.completedAt ? 'closed' : s.startedAt && s.startedAt.getTime() <= Date.now() ? 'active' : 'future');
    const r = await client.query(
      `INSERT INTO issue_sprints (company_id, team_id, upload_id, external_id, name, state, started_at, ends_at, completed_at, is_sample)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (team_id, external_id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, issue_sprints.name),
         state = CASE WHEN issue_sprints.state = 'closed' AND EXCLUDED.completed_at IS NULL THEN issue_sprints.state ELSE EXCLUDED.state END,
         started_at = COALESCE(EXCLUDED.started_at, issue_sprints.started_at), ends_at = COALESCE(EXCLUDED.ends_at, issue_sprints.ends_at),
         completed_at = COALESCE(EXCLUDED.completed_at, issue_sprints.completed_at), updated_at = now()
       WHERE issue_sprints.name IS DISTINCT FROM COALESCE(EXCLUDED.name, issue_sprints.name)
          OR issue_sprints.started_at IS DISTINCT FROM COALESCE(EXCLUDED.started_at, issue_sprints.started_at)
          OR issue_sprints.ends_at IS DISTINCT FROM COALESCE(EXCLUDED.ends_at, issue_sprints.ends_at)
          OR issue_sprints.completed_at IS DISTINCT FROM COALESCE(EXCLUDED.completed_at, issue_sprints.completed_at)
          OR (issue_sprints.state <> EXCLUDED.state AND NOT (issue_sprints.state = 'closed' AND EXCLUDED.completed_at IS NULL))
       RETURNING completed_at, started_at`,
      [companyId, teamId, uploadId, s.id, s.name, state, iso(s.startedAt), iso(s.endsAt), iso(s.completedAt), sample]
    );
    if (r.rows.length) {
      changed++;
      const c = r.rows[0].completed_at ?? r.rows[0].started_at;
      if (c) days.push(dayOf(c));
    }
  }
  return { changed, days };
}

/** Issues: insert or update by team + key, with their changes. `teamOf` resolves each issue's team (already checked). */
export async function storeIssues(client: pg.PoolClient, companyId: string, issues: IssueEvent[], teamOf: (e: IssueEvent) => string, uploadOf: (team: string) => string | null): Promise<StoredIssue[]> {
  const out: StoredIssue[] = [];
  for (const e of issues) {
    const team = teamOf(e);
    const sprintIds = e.sprints.map((s) => s.id);
    const hash = sha256(JSON.stringify([e.title, e.type, e.typeLabel, e.status, e.statusCategory, e.resolution, e.priority, e.environment, e.storyPoints, e.estimateHours,
      e.timeLoggedHours, sprintIds, e.labels, e.components, iso(e.createdAt), iso(e.resolvedAt), e.url]));
    const prev = (await client.query('SELECT id, event_hash, source_updated_at, opened_at, resolved_at, sprint_ids FROM issues WHERE team_id = $1 AND external_id = $2', [team, e.key])).rows[0];
    const days = new Set<string>([dayOf(e.createdAt), ...(e.resolvedAt ? [dayOf(e.resolvedAt)] : [])]);
    let id: string;
    let status: IssueStatus;
    if (!prev) {
      const r = await client.query(
        `INSERT INTO issues (company_id, team_id, upload_id, external_id, source, title, issue_type, type_label, status, status_category, resolution, priority, environment, found_in,
                             story_points, estimate_hours, time_logged_hours, sprint_ids, labels, components, opened_at, resolved_at, source_updated_at, day, url, event_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::varchar[], $19::varchar[], $20::varchar[], $21, $22, $23, $24::date, $25, $26)
         RETURNING id`,
        [companyId, team, uploadOf(team), e.key, e.source, e.title, e.type, e.typeLabel, e.status, e.statusCategory, e.resolution, e.priority, e.environment, e.foundIn,
          e.storyPoints, e.estimateHours, e.timeLoggedHours, sprintIds, e.labels, e.components, iso(e.createdAt), iso(e.resolvedAt), iso(e.updatedAt), dayOf(e.createdAt), e.url, hash]
      );
      id = r.rows[0].id;
      status = 'written';
    } else {
      id = prev.id;
      const older = prev.source_updated_at && e.updatedAt && e.updatedAt.getTime() < new Date(prev.source_updated_at).getTime();
      if (prev.event_hash === hash || older) status = 'duplicate';
      else {
        // The sprints an issue has been in only grow (a webhook may name the current sprint only).
        const merged = Array.from(new Set([...(prev.sprint_ids ?? []), ...sprintIds]));
        await client.query(
          `UPDATE issues SET upload_id = COALESCE($3, upload_id), source = $4, title = $5, issue_type = $6, type_label = $7, status = $8, status_category = $9, resolution = $10,
                  priority = $11, environment = $12, found_in = $13, story_points = $14, estimate_hours = $15, time_logged_hours = $16, sprint_ids = $17::varchar[],
                  labels = $18::varchar[], components = $19::varchar[], opened_at = $20, resolved_at = $21, source_updated_at = COALESCE($22, source_updated_at),
                  day = $23::date, url = COALESCE($24, url), event_hash = $25, updated_at = now()
            WHERE team_id = $1 AND external_id = $2`,
          [team, e.key, uploadOf(team), e.source, e.title, e.type, e.typeLabel, e.status, e.statusCategory, e.resolution, e.priority, e.environment, e.foundIn,
            e.storyPoints, e.estimateHours, e.timeLoggedHours, merged, e.labels, e.components, iso(e.createdAt), iso(e.resolvedAt), iso(e.updatedAt), dayOf(e.createdAt), e.url, hash]
        );
        status = 'updated';
        days.add(dayOf(prev.opened_at));
        if (prev.resolved_at) days.add(dayOf(prev.resolved_at));
      }
    }
    if (e.transitions.length) {
      const r = await client.query(
        `INSERT INTO issue_transitions (issue_id, team_id, field, from_value, to_value, to_category, at, upload_id)
         SELECT $1, $2, x.f, x.fr, x.t, x.c, x.a, $3 FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[]) AS x(f, fr, t, c, a)
         ON CONFLICT (issue_id, field, at, to_value) DO NOTHING RETURNING at`,
        [id, team, uploadOf(team), e.transitions.map((t) => t.field), e.transitions.map((t) => t.from), e.transitions.map((t) => t.to.slice(0, 255)),
          e.transitions.map((t) => t.toCategory), e.transitions.map((t) => iso(t.at))]
      );
      for (const row of r.rows) days.add(dayOf(row.at));
      if (r.rows.length && status === 'duplicate') status = 'updated';
    }
    out.push({ key: e.key, team, status, days: status === 'duplicate' ? [] : Array.from(days) });
  }
  return out;
}

export interface AnalysisMeta {
  companyId: string;
  teamId: string;
  uploadId: string | null;
  repo: string;
  branch: string | null;
  commit: string;
  runId: string;
  attempt: number;
  analyzedAt: Date;
  linesOfCode: number | null;
  sample?: boolean;
  id?: string;
}

/** Store one report and its findings; new / fixed against the previous report of the series (and re-link the next one). */
export async function storeAnalysis(client: pg.PoolClient, m: AnalysisMeta, a: ParsedAnalysis): Promise<{ reportId: string | null; duplicate: boolean; day: string; newFindings: number | null; fixedFindings: number | null }> {
  const c = severityCounts(a.findings);
  const day = dayOf(m.analyzedAt);
  const r = await client.query(
    `INSERT INTO analysis_reports (${m.id ? 'id, ' : ''}company_id, team_id, upload_id, tool, tool_version, repo, branch, commit_sha, run_id, attempt, analyzed_at, day, lines_of_code,
                                   findings, critical, high, medium, low, info, suppressed, rules, is_sample)
     VALUES (${m.id ? '$23, ' : ''}$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     ON CONFLICT (team_id, tool, repo, commit_sha, run_id, attempt) DO NOTHING RETURNING id`,
    [m.companyId, m.teamId, m.uploadId, a.tool, a.toolVersion, m.repo, m.branch, m.commit, m.runId, m.attempt, m.analyzedAt.toISOString(), day, m.linesOfCode,
      a.findings.length, c.critical, c.high, c.medium, c.low, c.info, a.suppressed, a.rules, !!m.sample, ...(m.id ? [m.id] : [])]
  );
  if (!r.rows.length) return { reportId: null, duplicate: true, day, newFindings: null, fixedFindings: null };
  const reportId: string = r.rows[0].id;
  const CHUNK = 2000;
  for (let i = 0; i < a.findings.length; i += CHUNK) {
    const part = a.findings.slice(i, i + CHUNK);
    await client.query(
      `INSERT INTO analysis_findings (report_id, team_id, fingerprint, rule_id, rule_name, severity, level, category, message, path, line)
       SELECT $1, $2, x.fp, x.rule, x.rn, x.sev, x.lvl, x.cat, x.msg, x.path, x.line
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::int[]) AS x(fp, rule, rn, sev, lvl, cat, msg, path, line)
       ON CONFLICT (report_id, fingerprint) DO NOTHING`,
      [reportId, m.teamId, part.map((f) => f.fingerprint), part.map((f) => f.ruleId), part.map((f) => f.ruleName), part.map((f) => f.severity), part.map((f) => f.level),
        part.map((f) => f.category), part.map((f) => f.message), part.map((f) => f.path), part.map((f) => f.line)]
    );
  }
  const linked = await relinkSeries(client, m.teamId, reportId);
  return { reportId, duplicate: false, day, newFindings: linked.newFindings, fixedFindings: linked.fixedFindings };
}

/**
 * New / fixed findings of a report against the previous report of its series (team + repository + branch +
 * tool), and of the report after it (a late upload changes what the next report counts as new).
 */
export async function relinkSeries(client: pg.PoolClient, teamId: string, reportId: string): Promise<{ newFindings: number | null; fixedFindings: number | null }> {
  const me = (await client.query('SELECT id, repo, branch, tool, analyzed_at FROM analysis_reports WHERE id = $1', [reportId])).rows[0];
  const series = (await client.query(
    `SELECT id FROM analysis_reports WHERE team_id = $1 AND repo = $2 AND tool = $3 AND branch IS NOT DISTINCT FROM $4
       AND analyzed_at >= (SELECT COALESCE(MAX(analyzed_at), '-infinity'::timestamptz) FROM analysis_reports
                             WHERE team_id = $1 AND repo = $2 AND tool = $3 AND branch IS NOT DISTINCT FROM $4 AND analyzed_at < $5)
     ORDER BY analyzed_at, created_at LIMIT 3`, [teamId, me.repo, me.tool, me.branch, me.analyzed_at])).rows.map((x: any) => x.id as string);
  const at = series.indexOf(reportId);
  let mine = { newFindings: null as number | null, fixedFindings: null as number | null };
  for (let i = Math.max(1, at); i < Math.min(series.length, at + 2); i++) {
    const cur = series[i];
    const prev = series[i - 1];
    if (!prev || prev === cur) continue;
    await client.query(
      `UPDATE analysis_findings f SET is_new = NOT EXISTS (SELECT 1 FROM analysis_findings p WHERE p.report_id = $2 AND p.fingerprint = f.fingerprint) WHERE f.report_id = $1`, [cur, prev]);
    const r = (await client.query(
      `UPDATE analysis_reports SET previous_report_id = $2::text,
              new_findings = (SELECT COUNT(*) FROM analysis_findings WHERE report_id = $1::text AND is_new)::int,
              fixed_findings = (SELECT COUNT(*) FROM analysis_findings p WHERE p.report_id = $2::text AND NOT EXISTS (SELECT 1 FROM analysis_findings f WHERE f.report_id = $1::text AND f.fingerprint = p.fingerprint))::int
        WHERE id = $1::text RETURNING new_findings, fixed_findings`, [cur, prev])).rows[0];
    if (cur === reportId) mine = { newFindings: r.new_findings, fixedFindings: r.fixed_findings };
  }
  return mine;
}
