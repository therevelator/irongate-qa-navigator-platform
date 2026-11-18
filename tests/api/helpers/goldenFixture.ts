import bcrypt from 'bcrypt';
import type { Client } from 'pg';

/**
 * A fixed dataset for the golden tests (tests/api/golden.test.ts): one company with teams of
 * different sizes and different data provenance, written straight into the tables as the
 * pre-Phase-2 write path left them (kpi_snapshots + field_sources). All dates are relative to
 * the database's CURRENT_DATE, so the API outputs are the same on every day the test runs
 * (the test normalises dates to offsets such as "D-3").
 *
 *   golden-team-big      6 members, daily synthetic values (seed style: source only, no recorded_at)
 *   golden-team-small    2 members, daily ingestion (source jenkins, recorded_at at 00:00 UTC)
 *   golden-team-stale    3 members, coverage and escape rate last recorded 12 days ago and
 *                        carried forward since (both past their expected interval)
 *   golden-team-partial  4 members, escape rate last recorded 10 days ago (past its weekly
 *                        interval), every other input daily
 *   golden-team-empty    1 member, no snapshots
 *   golden-team-inactive inactive team with snapshots (must never be counted)
 *
 * Every row id starts with "golden-"; remove() deletes them (company cascade + explicit rows).
 */

export const GOLDEN_COMPANY = 'golden-co';
export const GOLDEN_ADMIN_EMAIL = 'golden.admin@golden.example';
export const GOLDEN_PASSWORD = 'demo123';
export const GOLDEN_DAYS = 20;

export const GOLDEN_TEAMS = ['golden-team-big', 'golden-team-small', 'golden-team-stale', 'golden-team-partial', 'golden-team-empty', 'golden-team-inactive'] as const;

const KPI_COLS = [
  'test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate', 'code_quality_score',
  'avg_build_time_minutes', 'test_execution_time_minutes', 'deployment_frequency_per_week', 'lead_time_days',
  'mttr_hours', 'parallel_test_efficiency', 'sprint_velocity', 'sprint_commitment_rate', 'sprint_carryover',
  'first_time_pass_rate', 'blocked_time_hours', 'automation_coverage', 'automation_roi', 'change_failure_rate',
  'mtbf_hours', 'system_availability', 'infrastructure_failures', 'sizing_accuracy',
] as const;
type Col = (typeof KPI_COLS)[number];
const INT_COLS = new Set<Col>(['code_quality_score', 'avg_build_time_minutes', 'test_execution_time_minutes', 'sprint_velocity', 'blocked_time_hours', 'mtbf_hours', 'infrastructure_failures']);

/** Deterministic value of a column for a team profile at day offset t (t days before today). */
function value(profile: 'big' | 'small' | 'stale' | 'partial' | 'inactive', col: Col, t: number): number {
  const base: Record<string, Record<Col, number>> = {
    big: { test_coverage: 88, test_flakiness_rate: 1.5, defect_density: 0.4, defect_escape_rate: 4, code_quality_score: 91, avg_build_time_minutes: 8, test_execution_time_minutes: 12, deployment_frequency_per_week: 9, lead_time_days: 0.8, mttr_hours: 0.6, parallel_test_efficiency: 88, sprint_velocity: 64, sprint_commitment_rate: 93, sprint_carryover: 6, first_time_pass_rate: 91, blocked_time_hours: 3, automation_coverage: 84, automation_roi: 210, change_failure_rate: 4, mtbf_hours: 900, system_availability: 99.95, infrastructure_failures: 1, sizing_accuracy: 1.05 },
    small: { test_coverage: 76, test_flakiness_rate: 4.2, defect_density: 1.6, defect_escape_rate: 12, code_quality_score: 74, avg_build_time_minutes: 19, test_execution_time_minutes: 31, deployment_frequency_per_week: 2, lead_time_days: 4.5, mttr_hours: 9, parallel_test_efficiency: 61, sprint_velocity: 21, sprint_commitment_rate: 78, sprint_carryover: 22, first_time_pass_rate: 72, blocked_time_hours: 14, automation_coverage: 58, automation_roi: 35, change_failure_rate: 14, mtbf_hours: 160, system_availability: 99.2, infrastructure_failures: 7, sizing_accuracy: 1.35 },
    stale: { test_coverage: 71, test_flakiness_rate: 3.1, defect_density: 1.1, defect_escape_rate: 18, code_quality_score: 80, avg_build_time_minutes: 14, test_execution_time_minutes: 22, deployment_frequency_per_week: 3, lead_time_days: 3, mttr_hours: 5, parallel_test_efficiency: 70, sprint_velocity: 30, sprint_commitment_rate: 82, sprint_carryover: 15, first_time_pass_rate: 80, blocked_time_hours: 9, automation_coverage: 66, automation_roi: 80, change_failure_rate: 9, mtbf_hours: 300, system_availability: 99.6, infrastructure_failures: 4, sizing_accuracy: 1.2 },
    partial: { test_coverage: 82, test_flakiness_rate: 2.5, defect_density: 0.8, defect_escape_rate: 8, code_quality_score: 85, avg_build_time_minutes: 11, test_execution_time_minutes: 18, deployment_frequency_per_week: 5, lead_time_days: 1.5, mttr_hours: 2, parallel_test_efficiency: 79, sprint_velocity: 41, sprint_commitment_rate: 88, sprint_carryover: 10, first_time_pass_rate: 85, blocked_time_hours: 6, automation_coverage: 72, automation_roi: 140, change_failure_rate: 11, mtbf_hours: 500, system_availability: 99.8, infrastructure_failures: 2, sizing_accuracy: 1.1 },
    inactive: { test_coverage: 40, test_flakiness_rate: 9, defect_density: 3, defect_escape_rate: 30, code_quality_score: 50, avg_build_time_minutes: 40, test_execution_time_minutes: 60, deployment_frequency_per_week: 0.5, lead_time_days: 12, mttr_hours: 30, parallel_test_efficiency: 40, sprint_velocity: 10, sprint_commitment_rate: 60, sprint_carryover: 40, first_time_pass_rate: 50, blocked_time_hours: 30, automation_coverage: 20, automation_roi: -10, change_failure_rate: 30, mtbf_hours: 40, system_availability: 97, infrastructure_failures: 15, sizing_accuracy: 1.8 },
  };
  // A slow, deterministic drift so trends and the 7–14 day comparison are non-trivial.
  const drift: Partial<Record<Col, number>> = { test_coverage: -0.15, defect_escape_rate: 0.05, code_quality_score: -0.2, automation_coverage: -0.1, change_failure_rate: 0.04, test_flakiness_rate: 0.02 };
  const v = base[profile][col] + (drift[col] ?? 0) * t;
  return INT_COLS.has(col) ? Math.round(v) : Math.round(v * 100) / 100;
}

export interface GoldenIds {
  admin: string;
}

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

/** Delete every golden row (idempotent). */
export async function removeGolden(db: Client): Promise<void> {
  await db.query(`DELETE FROM kpi_snapshots WHERE team_id LIKE 'golden-%'`);
  // Tables added later (metric_values, ingestion_log, target_history) cascade from companies/teams.
  await db.query(`DELETE FROM role_assignments WHERE company_id = $1`, [GOLDEN_COMPANY]);
  await db.query(`DELETE FROM team_members WHERE team_id LIKE 'golden-%'`);
  await db.query(`DELETE FROM audit_log WHERE company_id = $1`, [GOLDEN_COMPANY]).catch(() => undefined);
  await db.query(`DELETE FROM users WHERE company_id = $1`, [GOLDEN_COMPANY]);
  await db.query(`DELETE FROM teams WHERE company_id = $1`, [GOLDEN_COMPANY]);
  await db.query(`DELETE FROM departments WHERE company_id = $1`, [GOLDEN_COMPANY]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [GOLDEN_COMPANY]);
}

/** Create the fixture (removes any previous copy first). */
export async function createGolden(db: Client): Promise<GoldenIds> {
  await removeGolden(db);
  const [{ today }] = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`)).rows;
  const day = (t: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - t);
    return d.toISOString().slice(0, 10);
  };
  const pw = await hash(GOLDEN_PASSWORD);

  await db.query(
    `INSERT INTO companies (id, name, domain, created_at, updated_at, is_active)
     VALUES ($1, 'Golden Fixture Co', 'golden.example', $2::date - 400, $2::date - 400, TRUE)`,
    [GOLDEN_COMPANY, today]
  );
  await db.query(
    `INSERT INTO departments (id, company_id, name, description, created_at, updated_at, is_active) VALUES
       ('golden-dept-a', $1, 'Alpha', 'Fixture department A', $2::date - 390, $2::date - 390, TRUE),
       ('golden-dept-b', $1, 'Beta', 'Fixture department B', $2::date - 390, $2::date - 390, TRUE)`,
    [GOLDEN_COMPANY, today]
  );
  const teams: Array<[string, string, string, boolean, number]> = [
    ['golden-team-big', 'Big Team', 'golden-dept-a', true, 6],
    ['golden-team-small', 'Small Team', 'golden-dept-a', true, 2],
    ['golden-team-stale', 'Stale Team', 'golden-dept-b', true, 3],
    ['golden-team-partial', 'Partial Team', 'golden-dept-b', true, 4],
    ['golden-team-empty', 'Empty Team', 'golden-dept-b', true, 1],
    ['golden-team-inactive', 'Inactive Team', 'golden-dept-a', false, 2],
  ];
  for (const [id, name, dept, active] of teams) {
    await db.query(
      `INSERT INTO teams (id, company_id, department_id, name, description, platform, created_at, updated_at, is_active, ai_enabled, exclude_from_auto_sync)
       VALUES ($1, $2, $3, $4, 'Fixture team', 'web', $5::date - 380, $5::date - 380, $6, FALSE, TRUE)`,
      [id, GOLDEN_COMPANY, dept, name, today, active]
    );
  }

  const admin = 'golden-u-admin';
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, created_at, updated_at, is_active, email_verified)
     VALUES ($1, $2, $3, 'Gail', 'Admin', 'super_admin', $4, 'golden-dept-a', NULL, $5::date - 370, $5::date - 370, TRUE, TRUE)`,
    [admin, GOLDEN_ADMIN_EMAIL, pw, GOLDEN_COMPANY, today]
  );
  await db.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id, created_at)
     VALUES ('golden-ra-admin', $1, $2, 'super_admin', 'company', $1, $3::date - 370)`,
    [GOLDEN_COMPANY, admin, today]
  );
  for (const [teamId, , dept, , size] of teams) {
    for (let i = 0; i < size; i++) {
      const uid = `${teamId.replace('golden-team-', 'golden-u-')}-${i + 1}`;
      const role = i === 0 ? 'team_lead' : 'qa_engineer';
      await db.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, created_at, updated_at, is_active, email_verified, developer_insights_enabled)
         VALUES ($1, $2, $3, $4, 'Fixture', $5, $6, $7, $8, $9::date - 360, $9::date - 360, TRUE, TRUE, TRUE)`,
        [uid, `${uid.replace('golden-u-', '')}@golden.example`, pw, `Member${i + 1}`, role, GOLDEN_COMPANY, dept, teamId, today]
      );
      await db.query(
        `INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES ($1, $2, $3, $4::date - 360)`,
        [uid, teamId, i === 0 ? 'lead' : 'member', today]
      );
      await db.query(
        `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id, created_at)
         VALUES ($1, $2, $3, $4, 'team', $5, $6::date - 360)`,
        [`golden-ra-${uid.replace('golden-u-', '')}`, GOLDEN_COMPANY, uid, role, teamId, today]
      );
      if (i === 0) await db.query('UPDATE teams SET lead_id = $1 WHERE id = $2', [uid, teamId]);
    }
  }

  // KPI snapshots, D-20 .. D0.
  type Prof = 'big' | 'small' | 'stale' | 'partial' | 'inactive';
  const plan: Array<[string, Prof]> = [
    ['golden-team-big', 'big'], ['golden-team-small', 'small'], ['golden-team-stale', 'stale'],
    ['golden-team-partial', 'partial'], ['golden-team-inactive', 'inactive'],
  ];
  // Columns whose last real value is older (carried forward afterwards, kpiIngest style).
  const frozen: Record<string, Partial<Record<Col, number>>> = {
    'golden-team-stale': { test_coverage: 12, defect_escape_rate: 12 },
    'golden-team-partial': { defect_escape_rate: 10 },
  };
  const source: Record<string, string> = {
    'golden-team-big': 'synthetic', 'golden-team-small': 'jenkins', 'golden-team-stale': 'sonarqube',
    'golden-team-partial': 'jenkins', 'golden-team-inactive': 'synthetic',
  };
  for (const [teamId, prof] of plan) {
    for (let t = GOLDEN_DAYS; t >= 0; t--) {
      const d = day(t);
      const row: Record<string, number> = {};
      const fs: Record<string, any> = {};
      for (const c of KPI_COLS) {
        const frozenAt = frozen[teamId]?.[c];
        const effT = frozenAt !== undefined && t < frozenAt ? frozenAt : t;
        row[c] = value(prof, c, effT);
        if (source[teamId] === 'synthetic') {
          fs[c] = { source: 'synthetic' };
        } else {
          fs[c] = { source: source[teamId], recorded_at: `${day(effT)}T00:00:00.000Z`, recorded_by: 'api_key:golden-key' };
          if (effT !== t) fs[c].carried_forward = true;
        }
      }
      const cols = Object.keys(row);
      await db.query(
        `INSERT INTO kpi_snapshots (id, team_id, snapshot_date, field_sources, created_at, ${cols.join(', ')})
         VALUES ($1, $2, $3::date, $4::jsonb, $3::date + time '00:05', ${cols.map((_, i) => `$${i + 5}`).join(', ')})`,
        [`golden-kpi-${teamId.replace('golden-team-', '')}-${t}`, teamId, d, JSON.stringify(fs), ...cols.map((c) => row[c])]
      );
    }
  }
  return { admin };
}

/** Replace absolute dates relative to `today` by offsets ("D-3", "D-3T06:00:00.000Z"). */
export function normaliseDates(value: unknown, today: string): unknown {
  const base = Date.parse(`${today}T00:00:00Z`);
  const rel = (s: string) => {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
    if (!m) return s;
    const off = Math.round((Date.parse(`${m[1]}T00:00:00Z`) - base) / 86400000);
    return `D${off >= 0 ? '+' : ''}${off}${m[2]}`;
  };
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}/.test(value) ? rel(value) : value.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (x) => rel(x));
  if (Array.isArray(value)) return value.map((v) => normaliseDates(v, today));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normaliseDates(v, today);
    return out;
  }
  return value;
}
