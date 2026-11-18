/**
 * Demo (sample) dataset: one fictional company with departments, teams, users and
 * ~120 days of mutually consistent history in every table of the schema.
 *
 * This module is pure: it builds the dataset and renders it as SQL text. It does not
 * touch a database (see demoSeed.ts for the DB writer and demoSql.ts for the file writer).
 *
 * Properties:
 *  - Every row is recognisable: its id starts with DEMO_PREFIX ('demo-'), or, for tables
 *    with an integer identity id / composite key (company_kpi_snapshots,
 *    developer_productivity_snapshots, team_members), it references a demo company/user.
 *  - Deterministic: values come from a hash-seeded PRNG keyed by (entity, metric, date),
 *    and ids are derived from the same keys, so a re-run on the same day produces exactly
 *    the same rows. Every INSERT is "ON CONFLICT DO NOTHING", so re-running never
 *    duplicates or overwrites anything (on a later day it only adds the new days).
 *  - qa_score / status of kpi_snapshots are never written: the DB trigger computes them.
 */

import { createHash } from 'crypto';
import { computeQaScore, computeDdps, TECH_DEBT_SEVERITY_WEIGHTS } from '../lib/metricFormulas';
import { calculateWorkloadBalance } from '../../src/data/advancedFeatures';
import { DEFAULT_METRIC_INTERVALS } from '../lib/metricIntervals';

// ============================================================================
// Identity of the demo company
// ============================================================================

export const DEMO_PREFIX = 'demo-';
export const DEMO_COMPANY_ID = 'demo-northwind';
export const DEMO_COMPANY_NAME = 'Northwind Payments (Sample data)';
export const DEMO_COMPANY_DOMAIN = 'northwind.example';
export const DEMO_PASSWORD = 'demo123';
/** bcrypt (cost 10) hash of DEMO_PASSWORD, fixed so the SQL output is reproducible. */
export const DEMO_PASSWORD_HASH = '$2b$10$puGdBtySdfzNUo5zCLPRg.fAMlRhZwSpwPCYe9QgHWhamOIJXfTXe';

/** Number of days of KPI history (today and the previous HISTORY_DAYS days). */
const HISTORY_DAYS = 120;
/** Days of event-level history (pipeline runs, test executions, suite runs). */
const EVENT_DAYS = 30;
const PERF_DAYS = 90;
const PIPELINE_COST_PER_MINUTE = 0.12;

// ============================================================================
// Deterministic randomness
// ============================================================================

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value in [0, 1) that depends only on the keys. */
function rnd(...keys: Array<string | number>): number {
  return mulberry32(hash32(keys.join('|')))();
}

/** A sequential PRNG seeded from keys (for loops). */
class Rng {
  private next: () => number;
  constructor(...keys: Array<string | number>) { this.next = mulberry32(hash32(keys.join('|'))); }
  float(): number { return this.next(); }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  int(lo: number, hi: number): number { return Math.floor(this.range(lo, hi + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
}

// ============================================================================
// Small helpers
// ============================================================================

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, dp = 0) => { const f = Math.pow(10, dp); return Math.round(v * f) / f; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

const DAY_MS = 86400000;
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const isWeekday = (date: string) => { const d = dow(date); return d >= 1 && d <= 5; };
const compact = (date: string) => date.replace(/-/g, '');
const ts = (date: string, hours: number, minutes = 0, seconds = 0) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + ((hours * 60 + minutes) * 60 + seconds) * 1000).toISOString();
const addSeconds = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();
const monthOf = (date: string) => date.slice(0, 7);
const daysInMonth = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
function addMonths(ym: string, n: number): string {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** Deterministic demo id (<= 36 chars). Long keys fall back to a hash. */
function did(...parts: Array<string | number>): string {
  const id = DEMO_PREFIX + parts.join('-');
  return id.length <= 36 ? id : DEMO_PREFIX + sha1(id).slice(0, 31);
}

// ============================================================================
// Dataset container and SQL rendering
// ============================================================================

export type SqlValue = string | number | boolean | null | undefined | { json: unknown } | { sql: string };
export type Row = Record<string, SqlValue>;

export type Segment =
  | { kind: 'insert'; table: string; rows: Row[] }
  | { kind: 'sql'; label: string; sql: string };

export class Dataset {
  readonly segments: Segment[] = [];
  private byTable = new Map<string, Row[]>();

  add(table: string, row: Row): void {
    let rows = this.byTable.get(table);
    if (!rows) {
      rows = [];
      this.byTable.set(table, rows);
      this.segments.push({ kind: 'insert', table, rows });
    }
    rows.push(row);
  }

  /** Fix the insert position of tables (parents before children) before rows are added. */
  reserve(...tables: string[]): void {
    for (const table of tables) {
      if (this.byTable.has(table)) continue;
      const rows: Row[] = [];
      this.byTable.set(table, rows);
      this.segments.push({ kind: 'insert', table, rows });
    }
  }

  sql(label: string, sql: string): void {
    this.segments.push({ kind: 'sql', label, sql });
  }

  tables(): string[] { return [...this.byTable.keys()]; }
  count(table: string): number { return this.byTable.get(table)?.length ?? 0; }
}

function literal(v: SqlValue): string {
  if (v === undefined) return 'DEFAULT';
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Non-finite number in demo data: ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  if ('json' in v) return `${literal(JSON.stringify(v.json))}::jsonb`;
  return v.sql;
}

export interface RenderedStatement { table: string; rows: number; sql: string }

/** Render every segment as SQL statements (INSERT … ON CONFLICT DO NOTHING), batched. */
export function renderStatements(ds: Dataset, maxBatchBytes = 200_000): RenderedStatement[] {
  const out: RenderedStatement[] = [];
  for (const seg of ds.segments) {
    if (seg.kind === 'sql') {
      out.push({ table: seg.label, rows: 0, sql: seg.sql });
      continue;
    }
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const r of seg.rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k); }
    const head = `INSERT INTO ${seg.table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES\n`;
    let batch: string[] = [];
    let size = head.length;
    const flush = () => {
      if (!batch.length) return;
      out.push({ table: seg.table, rows: batch.length, sql: `${head}${batch.join(',\n')}\nON CONFLICT DO NOTHING;` });
      batch = [];
      size = head.length;
    };
    for (const r of seg.rows) {
      const tuple = `(${columns.map(c => literal(r[c])).join(', ')})`;
      if (batch.length && size + tuple.length + 2 > maxBatchBytes) flush();
      batch.push(tuple);
      size += tuple.length + 2;
    }
    flush();
  }
  return out;
}

// ============================================================================
// Organisation
// ============================================================================

interface DeptDef { key: string; id: string; name: string; description: string; tz: string }
interface TeamDef {
  key: string; id: string; code: string; name: string; dept: string; platform: string; description: string;
  /** Health today (0..1) and change over the last 120 days (positive = improving). */
  h: number; change: number; phase: number; sprintOffset: number;
  areas: string[]; endpoints: Array<[string, string, number]>; revenue: number;
}
interface UserDef {
  id: string; first: string; last: string; email: string;
  role: 'super_admin' | 'qa_manager' | 'team_lead' | 'qa_engineer' | 'viewer';
  dept: string; team: string | null; insights: boolean; tz: string;
}

const DEPTS: DeptDef[] = [
  { key: 'payments', id: 'demo-dept-payments', name: 'Payments Platform', description: 'Checkout, ledger and card issuing services', tz: 'Europe/Dublin' },
  { key: 'digital', id: 'demo-dept-digital', name: 'Digital Channels', description: 'Mobile app, web portal and merchant dashboard', tz: 'Europe/London' },
  { key: 'risk', id: 'demo-dept-risk', name: 'Risk & Compliance', description: 'Fraud detection, KYC and regulatory reporting', tz: 'Europe/Berlin' },
  { key: 'platform', id: 'demo-dept-platform', name: 'Platform Engineering', description: 'Internal developer platform and data services', tz: 'America/New_York' },
];

const TEAMS: TeamDef[] = ([
  { key: 'checkout', code: 'CHK', name: 'Checkout Core', dept: 'payments', platform: 'Backend API', description: 'Payment intents, 3-D Secure and order confirmation', h: 0.90, change: 0.04, revenue: 2_400_000,
    areas: ['Payment intent', '3-D Secure challenge', 'Refund', 'Promo code', 'Tax calculation', 'Order confirmation', 'Currency conversion', 'Saved cards'],
    endpoints: [['/v1/payment-intents', 'POST', 110], ['/v1/payment-intents/{id}', 'GET', 38], ['/v1/refunds', 'POST', 140], ['/v1/checkout/sessions', 'POST', 95]] },
  { key: 'ledger', code: 'LDG', name: 'Ledger & Settlements', dept: 'payments', platform: 'Backend API', description: 'Double-entry ledger, payouts and reconciliation', h: 0.86, change: -0.02, revenue: 1_500_000,
    areas: ['Journal entry', 'Payout batch', 'Reconciliation', 'FX revaluation', 'Fee calculation', 'Settlement file', 'Balance snapshot', 'Chargeback posting'],
    endpoints: [['/v1/ledger/entries', 'POST', 70], ['/v1/balances', 'GET', 45], ['/v1/payouts', 'POST', 160], ['/v1/settlements/reports', 'GET', 210]] },
  { key: 'cards', code: 'CRD', name: 'Card Issuing', dept: 'payments', platform: 'Backend API', description: 'Virtual and physical card lifecycle and authorisations', h: 0.64, change: 0.10, revenue: 1_100_000,
    areas: ['Card activation', 'Authorisation', 'PIN change', 'Spend limits', 'Card freeze', 'Tokenisation', 'Statement', 'Dispute'],
    endpoints: [['/v1/cards', 'POST', 130], ['/v1/cards/{id}/authorisations', 'POST', 55], ['/v1/cards/{id}/limits', 'PUT', 80], ['/v1/cards/{id}', 'GET', 35]] },
  { key: 'mobile', code: 'MOB', name: 'Mobile Banking App', dept: 'digital', platform: 'iOS & Android', description: 'Customer mobile app for iOS and Android', h: 0.58, change: -0.10, revenue: 1_800_000,
    areas: ['Login', 'Biometric unlock', 'Transfer', 'Push notification', 'Account overview', 'Bill payment', 'Card controls', 'Onboarding'],
    endpoints: [['/mobile/v2/session', 'POST', 90], ['/mobile/v2/accounts', 'GET', 60], ['/mobile/v2/transfers', 'POST', 150], ['/mobile/v2/notifications', 'GET', 40]] },
  { key: 'web', code: 'WEB', name: 'Customer Web Portal', dept: 'digital', platform: 'Web', description: 'Customer self-service web portal', h: 0.78, change: 0.05, revenue: 1_300_000,
    areas: ['Sign-in', 'Statements', 'Profile settings', 'Transfers', 'Direct debits', 'Help centre', 'Document upload', 'Accessibility'],
    endpoints: [['/portal/api/session', 'POST', 85], ['/portal/api/statements', 'GET', 120], ['/portal/api/profile', 'PUT', 70], ['/portal/api/direct-debits', 'GET', 65]] },
  { key: 'merchant', code: 'MER', name: 'Merchant Dashboard', dept: 'digital', platform: 'Web', description: 'Dashboard for merchants: sales, payouts and disputes', h: 0.42, change: -0.06, revenue: 900_000,
    areas: ['Sales report', 'Payout schedule', 'Dispute evidence', 'Team invites', 'API keys', 'Webhooks', 'Export CSV', 'Branding'],
    endpoints: [['/merchant/api/reports/sales', 'GET', 260], ['/merchant/api/payouts', 'GET', 110], ['/merchant/api/disputes', 'POST', 140], ['/merchant/api/webhooks', 'PUT', 75]] },
  { key: 'fraud', code: 'FRD', name: 'Fraud Detection', dept: 'risk', platform: 'Data / ML', description: 'Real-time transaction risk scoring and rules engine', h: 0.93, change: 0.01, revenue: 700_000,
    areas: ['Risk score', 'Velocity rule', 'Device fingerprint', 'Manual review queue', 'Model rollout', 'Allow list', 'Chargeback feedback', 'Alerting'],
    endpoints: [['/v1/risk/score', 'POST', 28], ['/v1/risk/rules', 'GET', 45], ['/v1/risk/reviews', 'POST', 95], ['/v1/risk/feedback', 'POST', 60]] },
  { key: 'kyc', code: 'KYC', name: 'KYC & Onboarding', dept: 'risk', platform: 'Backend API', description: 'Identity verification and customer onboarding', h: 0.27, change: -0.05, revenue: 600_000,
    areas: ['Document check', 'Selfie match', 'Address verification', 'Sanctions screening', 'Onboarding flow', 'Business verification', 'Re-verification', 'Case management'],
    endpoints: [['/v1/kyc/checks', 'POST', 340], ['/v1/kyc/checks/{id}', 'GET', 70], ['/v1/kyc/documents', 'POST', 420], ['/v1/kyc/screening', 'POST', 260]] },
  { key: 'devplat', code: 'DPL', name: 'Developer Platform', dept: 'platform', platform: 'Infrastructure', description: 'CI/CD, service templates and internal tooling', h: 0.70, change: 0.12, revenue: 400_000,
    areas: ['Pipeline template', 'Service scaffold', 'Secrets rotation', 'Artifact cache', 'Preview environments', 'Feature flags', 'Canary deploy', 'Cost report'],
    endpoints: [['/platform/api/deployments', 'POST', 180], ['/platform/api/services', 'GET', 55], ['/platform/api/flags', 'GET', 25], ['/platform/api/environments', 'POST', 240]] },
  { key: 'data', code: 'DAT', name: 'Data & Reporting', dept: 'platform', platform: 'Data / ML', description: 'Data warehouse, regulatory and finance reporting', h: 0.50, change: 0.02, revenue: 500_000,
    areas: ['Daily ETL', 'Regulatory report', 'Finance dashboard', 'Data quality check', 'Schema migration', 'Backfill job', 'Customer export', 'Event stream'],
    endpoints: [['/data/api/reports', 'GET', 380], ['/data/api/exports', 'POST', 520], ['/data/api/metrics', 'GET', 150], ['/data/api/events', 'POST', 45]] },
] as Array<Omit<TeamDef, 'id' | 'phase' | 'sprintOffset'>>).map((t, i) => ({ ...t, id: `demo-team-${t.key}`, phase: i * 0.7, sprintOffset: i % 2 === 0 ? 0 : 7 }));

// [first, last, role, dept key, team key | null]
const PEOPLE: Array<[string, string, UserDef['role'], string, string | null]> = [
  ['Alex', 'Morgan', 'super_admin', 'platform', null],
  ['Priya', 'Raman', 'qa_manager', 'payments', null],
  ['Daniel', 'Okafor', 'qa_manager', 'digital', null],
  ['Sofia', 'Lindqvist', 'qa_manager', 'risk', null],
  ['Marcus', 'Chen', 'qa_manager', 'platform', null],
  ['Hannah', 'Brooks', 'viewer', 'digital', 'web'],
  ['Tomas', 'Herrera', 'viewer', 'risk', 'fraud'],
  ['Olivia', 'Bennett', 'team_lead', 'payments', 'checkout'],
  ['Rahul', 'Mehta', 'team_lead', 'payments', 'ledger'],
  ['Grace', 'Kim', 'team_lead', 'payments', 'cards'],
  ['Liam', "O'Connor", 'team_lead', 'digital', 'mobile'],
  ['Aisha', 'Khan', 'team_lead', 'digital', 'web'],
  ['Noah', 'Fischer', 'team_lead', 'digital', 'merchant'],
  ['Elena', 'Petrova', 'team_lead', 'risk', 'fraud'],
  ['Samuel', 'Adeyemi', 'team_lead', 'risk', 'kyc'],
  ['Chloe', 'Martin', 'team_lead', 'platform', 'devplat'],
  ['Ben', 'Carter', 'team_lead', 'platform', 'data'],
  ...([
    ['checkout', ['Mia', 'Thompson'], ['Lucas', 'Silva'], ['Zoe', 'Walker'], ['Arjun', 'Patel']],
    ['ledger', ['Emily', 'Davis'], ['Kenji', 'Tanaka'], ['Fatima', 'Haddad'], ['Jack', 'Wilson']],
    ['cards', ['Isla', 'Murphy'], ['Mateo', 'Garcia'], ['Nina', 'Novak'], ['Ryan', 'Hughes']],
    ['mobile', ['Camille', 'Dubois'], ['Ethan', 'Wright'], ['Leila', 'Farah'], ['Oscar', 'Nilsson']],
    ['web', ['Ava', 'Robinson'], ['Diego', 'Romero'], ['Sara', 'Jensen'], ['Tom', 'Gallagher']],
    ['merchant', ['Yuki', 'Sato'], ['Ella', 'Turner'], ['Omar', 'Aziz'], ['Luca', 'Rossi']],
    ['fraud', ['Nora', 'Hansen'], ['Victor', 'Mendes'], ['Amara', 'Obi'], ['Felix', 'Wagner']],
    ['kyc', ['Ruby', 'Clarke'], ['Ivan', 'Kowalski'], ['Maya', 'Shah'], ['Leo', 'Fitzgerald']],
    ['devplat', ['Sienna', 'Price'], ['Hugo', 'Laurent'], ['Anya', 'Ivanova'], ['Max', 'Becker']],
    ['data', ['Lily', 'Evans'], ['Samir', 'Nasser'], ['Julia', 'Costa'], ['Owen', 'Harris']],
  ] as Array<[string, ...Array<[string, string]>]>).flatMap(([team, ...people]) => {
    const dept = TEAMS.find(t => t.key === team)!.dept;
    return people.map(([f, l]) => [f, l, 'qa_engineer', dept, team] as [string, string, UserDef['role'], string, string | null]);
  }),
];

const USERS: UserDef[] = PEOPLE.map(([first, last, role, dept, team]) => {
  const local = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
  const id = `demo-u-${local.replace(/\./g, '-')}`;
  const isDev = role === 'qa_engineer' || role === 'team_lead';
  return {
    id, first, last, role, dept, team,
    email: `${local}@${DEMO_COMPANY_DOMAIN}`,
    insights: isDev && rnd('insights', id) >= 0.25,
    tz: DEPTS.find(d => d.key === dept)!.tz,
  };
});

/** Sign-in accounts worth listing (README / admin panel). */
export const DEMO_LOGINS = (['super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer'] as const).map(role => {
  const u = USERS.find(x => x.role === role)!;
  return { role, email: u.email, name: `${u.first} ${u.last}` };
});

const membersOf = (team: TeamDef) => USERS.filter(u => u.team === team.key);
const devsOf = (team: TeamDef) => membersOf(team).filter(u => u.role === 'qa_engineer' || u.role === 'team_lead');
const leadOf = (team: TeamDef) => USERS.find(u => u.team === team.key && u.role === 'team_lead')!;
const engineersOf = (team: TeamDef) => USERS.filter(u => u.team === team.key && u.role === 'qa_engineer');

// ============================================================================
// KPI model: every metric of a team as a smooth function of the date
// ============================================================================

interface MetricDef { col: string; bad: number; good: number; log?: boolean; dp: number; noise: number }

const KPI_METRICS: MetricDef[] = [
  { col: 'test_coverage', bad: 40, good: 93, dp: 2, noise: 0.03 },
  { col: 'test_flakiness_rate', bad: 9.5, good: 0.8, dp: 2, noise: 0.06 },
  { col: 'defect_density', bad: 2.4, good: 0.22, log: true, dp: 3, noise: 0.05 },
  { col: 'defect_escape_rate', bad: 30, good: 2, dp: 2, noise: 0.04 },
  { col: 'code_quality_score', bad: 40, good: 95, dp: 0, noise: 0.03 },
  { col: 'avg_build_time_minutes', bad: 34, good: 5, dp: 0, noise: 0.05 },
  { col: 'test_execution_time_minutes', bad: 52, good: 8, dp: 0, noise: 0.05 },
  { col: 'deployment_frequency_per_week', bad: 0.6, good: 16, log: true, dp: 2, noise: 0.06 },
  { col: 'lead_time_days', bad: 16, good: 0.6, log: true, dp: 2, noise: 0.05 },
  { col: 'mttr_hours', bad: 40, good: 0.7, log: true, dp: 2, noise: 0.06 },
  { col: 'parallel_test_efficiency', bad: 42, good: 94, dp: 2, noise: 0.04 },
  { col: 'first_time_pass_rate', bad: 58, good: 97, dp: 2, noise: 0.04 },
  { col: 'blocked_time_hours', bad: 22, good: 1, dp: 0, noise: 0.06 },
  { col: 'automation_coverage', bad: 32, good: 91, dp: 2, noise: 0.025 },
  { col: 'automation_roi', bad: 35, good: 340, dp: 2, noise: 0.04 },
  { col: 'change_failure_rate', bad: 35, good: 2, dp: 2, noise: 0.04 },
  { col: 'mtbf_hours', bad: 70, good: 1400, log: true, dp: 0, noise: 0.06 },
  { col: 'system_availability', bad: 98.1, good: 99.985, dp: 3, noise: 0.03 },
  { col: 'infrastructure_failures', bad: 7, good: 0, dp: 0, noise: 0.08 },
  { col: 'sizing_accuracy', bad: 1.65, good: 1.03, dp: 2, noise: 0.05 },
];
const SPRINT_COLS = ['sprint_velocity', 'sprint_commitment_rate', 'sprint_carryover'];
export const KPI_COLUMNS = [...KPI_METRICS.map(m => m.col), ...SPRINT_COLS];

/** Team health on a date, t days before today (0..1). */
function teamHealth(team: TeamDef, t: number): number {
  return clamp(team.h - team.change * (t / HISTORY_DAYS) + 0.025 * Math.sin((2 * Math.PI * t) / 41 + team.phase), 0.04, 0.98);
}

function metricValue(team: TeamDef, m: MetricDef, t: number, date: string): number {
  const offset = (rnd('offset', team.key, m.col) - 0.5) * 0.16;
  const noise = (rnd('kpi', team.key, m.col, date) - 0.5) * 2 * m.noise;
  const x = clamp(teamHealth(team, t) + offset + noise, 0, 1);
  const v = m.log ? m.bad * Math.pow(m.good / m.bad, x) : lerp(m.bad, m.good, x);
  return round(v, m.dp);
}

// ============================================================================
// Build
// ============================================================================

export interface BuildOptions { today?: string }

export interface DemoSummary {
  companyId: string;
  companyName: string;
  domain: string;
  today: string;
  teams: number;
  users: number;
  logins: typeof DEMO_LOGINS;
  password: string;
}

export function demoSummary(today: string): DemoSummary {
  return {
    companyId: DEMO_COMPANY_ID, companyName: DEMO_COMPANY_NAME, domain: DEMO_COMPANY_DOMAIN, today,
    teams: TEAMS.length, users: USERS.length, logins: DEMO_LOGINS, password: DEMO_PASSWORD,
  };
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildDemoDataset(opts: BuildOptions = {}): Dataset {
  const today = opts.today ?? todayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`Invalid date: ${today}`);
  const ds = new Dataset();
  const D = (t: number) => addDays(today, -t);
  const yesterday = D(1);
  const admin = USERS.find(u => u.role === 'super_admin')!;

  // --------------------------------------------------------------------------
  // Company, departments, teams, users, membership
  // --------------------------------------------------------------------------
  ds.add('companies', {
    id: DEMO_COMPANY_ID, name: DEMO_COMPANY_NAME, domain: DEMO_COMPANY_DOMAIN, logo_url: null,
    settings: { json: { sample_data: true, industry: 'Payments', note: 'Generated by npm run seed:demo' } },
    created_at: ts(D(720), 9), updated_at: ts(D(720), 9), is_active: true,
  });
  for (const d of DEPTS) {
    ds.add('departments', {
      id: d.id, company_id: DEMO_COMPANY_ID, name: d.name, description: d.description, manager_id: null,
      created_at: ts(D(700), 9), updated_at: ts(D(700), 9), is_active: true,
    });
  }
  for (const t of TEAMS) {
    ds.add('teams', {
      id: t.id, company_id: DEMO_COMPANY_ID, department_id: `demo-dept-${t.dept}`, name: t.name, description: t.description,
      platform: t.platform, lead_id: null, created_at: ts(D(650), 10), updated_at: ts(D(650), 10), is_active: true,
      ai_enabled: rnd('ai', t.key) < 0.6,
      // The background synthetic generators (ENABLE_SYNTHETIC_DATA) leave these teams alone.
      exclude_from_auto_sync: true,
    });
  }
  for (const [i, u] of USERS.entries()) {
    const created = D(600 - i * 7);
    ds.add('users', {
      id: u.id, email: u.email, password_hash: DEMO_PASSWORD_HASH, first_name: u.first, last_name: u.last,
      role: u.role, company_id: DEMO_COMPANY_ID, department_id: `demo-dept-${u.dept}`,
      primary_team_id: u.team ? `demo-team-${u.team}` : null,
      avatar_url: null, phone: `+353 1 555 ${String(100 + i).padStart(4, '0')}`, timezone: u.tz,
      created_at: ts(created, 9, 30), updated_at: ts(created, 9, 30),
      last_login: ts(D(1 + Math.floor(rnd('login', u.id) * 6)), 8 + Math.floor(rnd('loginh', u.id) * 9), 12),
      is_active: true, email_verified: true, email_verified_at: ts(created, 9, 45),
      password_reset_token: null, password_reset_expires: null, failed_login_attempts: 0, locked_until: null,
      created_by: u.role === 'super_admin' ? null : admin.id,
      developer_insights_enabled: u.insights,
    });
  }
  // Leads and department managers reference users, so they are set after the users exist
  // (only where still NULL: never overwrites a value someone changed in the app).
  ds.sql('teams.lead_id', `UPDATE teams SET lead_id = v.lead_id FROM (VALUES\n${TEAMS.map(t => `  (${literal(t.id)}, ${literal(leadOf(t).id)})`).join(',\n')}\n) AS v(id, lead_id)\nWHERE teams.id = v.id AND teams.lead_id IS NULL;`);
  ds.sql('departments.manager_id', `UPDATE departments SET manager_id = v.manager_id FROM (VALUES\n${DEPTS.map(d => `  (${literal(d.id)}, ${literal(USERS.find(u => u.dept === d.key && u.role === 'qa_manager')!.id)})`).join(',\n')}\n) AS v(id, manager_id)\nWHERE departments.id = v.id AND departments.manager_id IS NULL;`);

  // team_members: exactly one row per user with a primary team (lead for team leads), plus a
  // few secondary memberships (contributors) that do not contradict primary_team_id.
  for (const u of USERS) {
    if (!u.team) continue;
    ds.add('team_members', { user_id: u.id, team_id: `demo-team-${u.team}`, role: u.role === 'team_lead' ? 'lead' : 'member', joined_at: ts(D(540), 10) });
  }
  const contributors: Array<[string, string]> = [['demo-u-chloe-martin', 'checkout'], ['demo-u-hugo-laurent', 'mobile'], ['demo-u-lily-evans', 'fraud'], ['demo-u-kenji-tanaka', 'cards']];
  for (const [uid, team] of contributors) ds.add('team_members', { user_id: uid, team_id: `demo-team-${team}`, role: 'contributor', joined_at: ts(D(200), 10) });

  // --------------------------------------------------------------------------
  // Settings: configs, pipeline config, metric intervals, an example (revoked) API key
  // --------------------------------------------------------------------------
  const companyConfigs: Record<string, string> = {
    sla_response_time_ms: '500', sla_error_rate_percent: '1', sla_uptime_percent: '99.9',
    developer_hourly_rate: '85', support_ticket_cost: '30', revenue_per_user_monthly: '42',
    downtime_cost_per_minute: '180', sla_breach_penalty: '2500',
  };
  for (const [k, v] of Object.entries(companyConfigs)) {
    ds.add('configs', { id: did('cfg', k), company_id: DEMO_COMPANY_ID, department_id: null, team_id: null, config_key: k, config_value: v, created_at: ts(D(500), 12), updated_at: ts(D(500), 12) });
  }
  // Department and team overrides (inheritance: team > department > company).
  ds.add('configs', { id: did('cfg', 'risk', 'sla-rt'), company_id: DEMO_COMPANY_ID, department_id: 'demo-dept-risk', team_id: null, config_key: 'sla_response_time_ms', config_value: '800', created_at: ts(D(300), 12), updated_at: ts(D(300), 12) });
  ds.add('configs', { id: did('cfg', 'checkout', 'sla-er'), company_id: DEMO_COMPANY_ID, department_id: 'demo-dept-payments', team_id: 'demo-team-checkout', config_key: 'sla_error_rate_percent', config_value: '0.5', created_at: ts(D(250), 12), updated_at: ts(D(250), 12) });
  ds.add('configs', { id: did('cfg', 'data', 'sla-rt'), company_id: DEMO_COMPANY_ID, department_id: 'demo-dept-platform', team_id: 'demo-team-data', config_key: 'sla_response_time_ms', config_value: '1200', created_at: ts(D(250), 12), updated_at: ts(D(250), 12) });

  ds.add('pipeline_config', { id: 'demo-pipeline-config', company_id: DEMO_COMPANY_ID, time_savings_percent: 30, cost_savings_percent: 25, cost_per_minute: PIPELINE_COST_PER_MINUTE, created_at: ts(D(400), 12), updated_at: ts(D(400), 12) });

  for (const mi of DEFAULT_METRIC_INTERVALS) {
    ds.add('metric_update_intervals', {
      id: did('mi', mi.metric_key), company_id: DEMO_COMPANY_ID, metric_key: mi.metric_key,
      interval_value: mi.interval_value, interval_unit: mi.interval_unit, custom_label: mi.custom_label,
      updated_by: admin.id, created_at: ts(D(400), 12), updated_at: ts(D(400), 12),
    });
  }

  // A revoked example key: it can never authenticate (revoked_at is set and nobody has the
  // plaintext), it only shows what the API keys panel looks like.
  ds.add('api_keys', {
    id: 'demo-apikey-revoked', company_id: DEMO_COMPANY_ID, name: 'Example CI key (revoked sample)',
    key_prefix: 'igk_demo0000', key_hash: createHash('sha256').update('demo-revoked-example-key').digest('hex'),
    created_by: admin.id, created_at: ts(D(90), 11), last_used_at: ts(D(40), 3, 12), revoked_at: ts(D(35), 16, 5),
  });

  // --------------------------------------------------------------------------
  // Sprints (2-week cadence anchored on a fixed date, so names/ids are stable)
  // --------------------------------------------------------------------------
  interface Sprint { name: string; start: string; end: string; committed: number; delivered: number; carryover: number }
  const sprintsByTeam = new Map<string, Sprint[]>();
  const EPOCH = '2024-01-05'; // a Friday
  for (const team of TEAMS) {
    const sprints: Sprint[] = [];
    const daysSinceEpoch = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`)) / DAY_MS - team.sprintOffset;
    const lastK = Math.floor(daysSinceEpoch / 14);
    const size = devsOf(team).length;
    for (let k = lastK; k >= 0; k--) {
      const end = addDays(EPOCH, k * 14 + team.sprintOffset);
      const t = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`)) / DAY_MS;
      if (t > HISTORY_DAYS + 30) break;
      const h = clamp(teamHealth(team, t) + (rnd('sprint', team.key, k) - 0.5) * 0.12, 0.02, 1);
      const delivered = Math.round(lerp(4.2, 10.5, h) * size + (rnd('sprintv', team.key, k) - 0.5) * 6);
      const commitRate = clamp(lerp(64, 97, h) + (rnd('sprintc', team.key, k) - 0.5) * 6, 50, 100);
      const committed = Math.max(delivered, Math.round(delivered / (commitRate / 100)));
      sprints.push({ name: `Sprint ${k + 1}`, start: addDays(end, -13), end, committed, delivered, carryover: committed - delivered });
    }
    sprints.reverse();
    sprintsByTeam.set(team.key, sprints);
    for (const s of sprints) {
      ds.add('sprint_velocity', {
        id: did('sv', team.key, compact(s.end)), team_id: team.id, sprint_name: s.name, start_date: s.start, end_date: s.end,
        committed_points: s.committed, delivered_points: s.delivered, carryover_points: s.carryover, created_at: ts(s.end, 17),
      });
    }
  }
  const sprintAt = (team: TeamDef, date: string): Sprint | null => {
    const list = sprintsByTeam.get(team.key)!;
    let found: Sprint | null = null;
    for (const s of list) if (s.end <= date) found = s;
    return found;
  };

  // --------------------------------------------------------------------------
  // KPI snapshots: one per team per day, today and the previous HISTORY_DAYS days
  // --------------------------------------------------------------------------
  type KpiRow = Record<string, number>;
  const kpi = new Map<string, KpiRow>(); // `${team}|${date}`
  const kpiOf = (team: TeamDef, t: number): KpiRow => {
    const date = D(t);
    const k = `${team.key}|${date}`;
    let row = kpi.get(k);
    if (!row) {
      row = {};
      for (const m of KPI_METRICS) row[m.col] = metricValue(team, m, t, date);
      const s = sprintAt(team, date);
      if (s) {
        row.sprint_velocity = s.delivered;
        row.sprint_commitment_rate = round((s.delivered / s.committed) * 100, 2);
        row.sprint_carryover = round((s.carryover / s.committed) * 100, 2);
      }
      kpi.set(k, row);
    }
    return row;
  };
  const fieldSources = { json: Object.fromEntries(KPI_COLUMNS.map(c => [c, { source: 'synthetic' }])) };
  for (const team of TEAMS) {
    for (let t = HISTORY_DAYS; t >= 0; t--) {
      const date = D(t);
      const row = kpiOf(team, t);
      ds.add('kpi_snapshots', {
        id: did('kpi', team.key, compact(date)), team_id: team.id, snapshot_date: date,
        ...row, created_at: ts(date, 0, 5), manually_edited: false, field_sources: fieldSources,
      });
    }
  }

  // Last update per team and metric (today's snapshot); next update from the interval.
  const unitMs: Record<string, number> = { minutes: 60e3, hours: 3600e3, days: DAY_MS, weeks: 7 * DAY_MS, months: 30 * DAY_MS };
  for (const team of TEAMS) {
    for (const mi of DEFAULT_METRIC_INTERVALS) {
      const last = ts(today, 0, 5);
      ds.add('metric_last_updated', {
        id: did('mlu', team.key, KPI_COLUMNS.indexOf(mi.metric_key) >= 0 ? KPI_COLUMNS.indexOf(mi.metric_key) : mi.metric_key),
        company_id: DEMO_COMPANY_ID, team_id: team.id, metric_key: mi.metric_key, last_updated_at: last,
        next_update_at: new Date(Date.parse(last) + mi.interval_value * unitMs[mi.interval_unit]).toISOString(), created_at: ts(D(HISTORY_DAYS), 0, 5),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Developers: daily productivity snapshots (weekdays) and current developer_metrics
  // --------------------------------------------------------------------------
  interface DevDay { focus: number; pr: number; review: number; meetings: number; switches: number }
  const devDays = new Map<string, Map<string, DevDay>>(); // user -> date -> values
  for (const team of TEAMS) {
    for (const u of devsOf(team)) {
      const jitter = (rnd('devjit', u.id) - 0.5) * 0.3;
      const isLead = u.role === 'team_lead';
      const byDate = new Map<string, DevDay>();
      for (let t = HISTORY_DAYS; t >= 0; t--) {
        const date = D(t);
        if (!isWeekday(date)) continue;
        const n = (k: string) => (rnd('dev', u.id, k, date) - 0.5) * 2;
        const hp = clamp(0.15 + 0.85 * teamHealth(team, t) + jitter + n('h') * 0.06, 0.05, 0.98);
        byDate.set(date, {
          focus: round(clamp(1.8 + 4.0 * hp - (isLead ? 1.2 : 0) + n('f') * 0.6, 0.5, 7.5), 2),
          meetings: round(clamp(4.4 - 3.1 * hp + (isLead ? 1.3 : 0) + n('m') * 0.5, 0.25, 7), 2),
          switches: Math.round(clamp(10 - 7.5 * hp + (isLead ? 1.5 : 0) + n('s') * 1.4, 1, 15)),
          pr: round(clamp(52 * Math.pow(3.5 / 52, hp) * (1 + n('p') * 0.2), 1, 96), 2),
          review: round(clamp(10 * Math.pow(0.8 / 10, hp) * (1 + n('r') * 0.2), 0.25, 24), 2),
        });
      }
      devDays.set(u.id, byDate);
      for (const [date, v] of byDate) {
        const { score } = computeDdps({ focus_time_hours: v.focus, meeting_time_hours: v.meetings, context_switches_per_day: v.switches, pr_merge_time_avg: v.pr, code_review_time_avg: v.review });
        ds.add('developer_productivity_snapshots', {
          developer_id: u.id, snapshot_date: date,
          focus_time_hours: v.focus, pr_merge_time_avg: v.pr, code_review_time_avg: v.review, meeting_time_hours: v.meetings, context_switches_per_day: v.switches,
          focus_time_norm: round(Math.min(v.focus / 8, 1), 4), pr_time_norm: round(Math.min(v.pr / 24, 1), 4),
          review_time_norm: round(Math.min(v.review / 8, 1), 4), meeting_time_norm: round(Math.min(v.meetings / 8, 1), 4),
          context_switches_norm: round(Math.min(v.switches / 5, 1), 4),
          ddps_score: round((score ?? 0) / 100, 4), created_at: ts(date, 23, 30),
        });
      }
    }
  }
  /** Mean of a developer's last `n` weekday values up to and including `date`. */
  const devAverage = (uid: string, date: string, n = 10): DevDay | null => {
    const days = [...devDays.get(uid)!.entries()].filter(([d]) => d <= date).slice(-n).map(([, v]) => v);
    if (!days.length) return null;
    return {
      focus: mean(days.map(d => d.focus)), meetings: mean(days.map(d => d.meetings)), switches: mean(days.map(d => d.switches)),
      pr: mean(days.map(d => d.pr)), review: mean(days.map(d => d.review)),
    };
  };
  const workloadBalance = (v: DevDay) => calculateWorkloadBalance({
    focus_time_hours: v.focus, meeting_time_hours: v.meetings, context_switches_per_day: v.switches,
    pr_merge_time_avg: v.pr, code_review_time_avg: v.review,
  } as Parameters<typeof calculateWorkloadBalance>[0]);
  for (const team of TEAMS) {
    for (const u of devsOf(team)) {
      const avg = devAverage(u.id, today)!;
      const cur = { focus: round(avg.focus, 2), meetings: round(avg.meetings, 2), switches: Math.round(avg.switches), pr: round(avg.pr, 2), review: round(avg.review, 2) };
      ds.add('developer_metrics', {
        id: did('dm', u.id.slice(DEMO_PREFIX.length)), team_id: team.id, developer_id: u.id,
        pr_merge_time_avg: cur.pr, code_review_time_avg: cur.review, focus_time_hours: cur.focus, meeting_time_hours: cur.meetings,
        context_switches_per_day: cur.switches, happiness_score: round(workloadBalance(cur), 1),
        created_at: ts(D(HISTORY_DAYS), 18), updated_at: ts(yesterday, 18),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Test cases, executions, flaky tests, tags
  // --------------------------------------------------------------------------
  const TYPES: Array<{ type: string; n: number; dur: [number, number] }> = [
    { type: 'unit', n: 9, dur: [40, 450] }, { type: 'integration', n: 5, dur: [800, 5200] }, { type: 'api', n: 4, dur: [300, 2200] },
    { type: 'e2e', n: 3, dur: [15000, 90000] }, { type: 'performance', n: 1, dur: [120000, 300000] },
    { type: 'security', n: 1, dur: [30000, 90000] }, { type: 'manual', n: 1, dur: [600000, 1800000] },
  ];
  const SCENARIOS = [
    'happy path succeeds', 'rejects invalid input', 'retries after upstream timeout', 'handles concurrent updates',
    'respects boundary values', 'denies access without permission', 'ignores duplicate (idempotent) request',
    'handles large payload', 'rolls back on partial failure', 'emits audit event', 'localises amounts and dates', 'recovers after restart',
  ];
  const FAILURES: Record<string, Array<[string, string]>> = {
    timing: [['TimeoutError: waiting for selector "[data-test=submit]" exceeded 30000ms', 'at waitForSelector (tests/e2e/helpers/page.ts:41:11)'],
      ['AssertionError: expected job status "completed" but was "running" after 10s', 'at pollUntil (tests/support/poll.ts:22:9)']],
    environment: [['Error: connect ECONNREFUSED 10.20.3.17:5432 (staging database not ready)', 'at TCPConnectWrap.afterConnect (node:net:1555:16)'],
      ['Error: container "redis-test" exited with code 137 (out of memory)', 'at Testcontainers.start (tests/support/containers.ts:58:13)']],
    data: [['AssertionError: expected 1999 to equal 2000 (FX rounding)', 'at Context.<anonymous> (tests/integration/amounts.spec.ts:87:24)'],
      ['duplicate key value violates unique constraint "orders_reference_key"', 'at Parser.parseErrorMessage (node_modules/pg-protocol/dist/parser.js:283:98)']],
    network: [['FetchError: request to https://sandbox.psp.example/v1/charges failed, reason: socket hang up', 'at ClientRequest.<anonymous> (node_modules/node-fetch/lib/index.js:1491:11)'],
      ['Error: getaddrinfo EAI_AGAIN mock-idp.internal', 'at GetAddrInfoReqWrap.onlookup (node:dns:107:26)']],
  };
  const TAGS = ['smoke', 'regression', 'critical-path', 'api', 'ui', 'contract', 'nightly', 'pci', 'accessibility'];

  interface CaseInfo { id: string; type: string; flaky: boolean; pattern: string; active: boolean; area: string; n: number; scenario: string; status: string; spec: typeof TYPES[number] }
  ds.reserve('test_cases', 'test_case_tags', 'test_executions', 'flaky_tests');
  const casesByTeam = new Map<string, CaseInfo[]>();
  for (const team of TEAMS) {
    const rng = new Rng('cases', team.key);
    const lead = leadOf(team);
    const engineers = engineersOf(team);
    const cases: CaseInfo[] = [];
    let n = 0;
    for (const spec of TYPES) {
      for (let i = 0; i < spec.n; i++, n++) {
        const area = team.areas[(n * 3 + i) % team.areas.length];
        const scenario = SCENARIOS[(n * 5 + i * 7) % SCENARIOS.length];
        const status = n === 7 ? 'draft' : n === 12 ? 'obsolete' : n === 17 ? 'disabled' : 'active';
        cases.push({ id: did('tc', team.key, String(n).padStart(2, '0')), type: spec.type, flaky: false, pattern: 'unknown', active: status === 'active', area, n, scenario, status, spec });
      }
    }
    // Flaky share follows the team's test flakiness KPI.
    const flakeRate = kpiOf(team, 0).test_flakiness_rate;
    const candidates = cases.filter(c => c.active && ['e2e', 'integration', 'api'].includes(c.type));
    const nFlaky = clamp(Math.round(cases.filter(c => c.active).length * (flakeRate / 100) * 1.6), 1, 5);
    for (const c of candidates.sort((a, b) => rnd('flk', a.id) - rnd('flk', b.id)).slice(0, nFlaky)) {
      c.flaky = true;
      c.pattern = c.type === 'e2e' ? rng.pick(['timing', 'timing', 'network']) : c.type === 'api' ? rng.pick(['network', 'data']) : rng.pick(['environment', 'data', 'timing']);
    }
    casesByTeam.set(team.key, cases);

    const passBase = 0.975 + 0.02 * team.h;
    for (const c of cases) {
      const meta = c;
      const execs: Array<{ id: string; status: string; dur: number; at: string; err: [string, string] | null }> = [];
      const total = meta.status === 'draft' ? 0 : !c.active ? 6 : c.flaky ? 20 : 16;
      const span = c.active ? EVENT_DAYS : 90;
      for (let i = 0; i < total; i++) {
        const t = c.active ? Math.max(1, Math.round(((total - i) * span) / total)) : 60 + Math.round(((total - i) * 30) / total);
        const date = D(t);
        const r = rnd('exec', c.id, i);
        let status: string;
        if (c.flaky) status = r < 0.25 + 0.2 * rnd('flkp', c.id) ? 'failed' : 'passed';
        else if (c.type === 'manual') status = r < 0.06 ? 'blocked' : r < 0.1 ? 'failed' : 'passed';
        else status = r < 1 - passBase ? 'failed' : r < 1 - passBase + 0.01 ? 'skipped' : 'passed';
        const pattern = c.flaky ? c.pattern : c.type === 'e2e' ? 'timing' : 'data';
        const err = status === 'failed' ? FAILURES[pattern][Math.floor(rnd('err', c.id, i) * 2)] : status === 'blocked' ? ['Blocked: test environment unavailable', ''] as [string, string] : null;
        const [lo, hi] = meta.spec.dur;
        execs.push({
          id: did('te', team.key, String(meta.n).padStart(2, '0'), String(i).padStart(2, '0')), status,
          dur: status === 'skipped' ? 0 : Math.round(lerp(lo, hi, rnd('dur', c.id, i)) * (status === 'failed' && pattern === 'timing' ? 1.6 : 1)),
          at: ts(date, 1 + Math.floor(rnd('h', c.id, i) * 20), Math.floor(rnd('m', c.id, i) * 60)), err,
        });
      }
      for (const [i, e] of execs.entries()) {
        const manual = c.type === 'manual';
        ds.add('test_executions', {
          id: e.id, test_case_id: c.id, team_id: team.id, status: e.status, duration_ms: e.dur,
          error_message: e.err ? e.err[0] : null, stack_trace: e.err && e.err[1] ? `${e.err[0]}\n    ${e.err[1]}` : null,
          environment: c.type === 'unit' || c.type === 'integration' ? 'ci' : 'staging',
          build_number: `${team.key}-${4200 + Math.round((Date.parse(e.at) - Date.parse(`${D(EVENT_DAYS)}T00:00:00Z`)) / 3600000)}`,
          branch: rnd('br', c.id, i) < 0.8 ? 'main' : `feature/${team.code}-${200 + Math.floor(rnd('brn', c.id, i) * 300)}`,
          executed_by: manual ? engineers[i % engineers.length].id : null, executed_at: e.at,
        });
      }
      const ran = execs.filter(e => e.status !== 'skipped');
      const passed = execs.filter(e => e.status === 'passed').length;
      let flips = 0;
      for (let i = 1; i < ran.length; i++) if ((ran[i].status === 'passed') !== (ran[i - 1].status === 'passed')) flips++;
      const flakiness = ran.length > 1 ? round((flips / (ran.length - 1)) * 100, 2) : 0;
      let consecutive = 0;
      for (let i = execs.length - 1; i >= 0 && execs[i].status === 'failed'; i--) consecutive++;
      const last = execs[execs.length - 1];
      const avgMs = ran.length ? Math.round(mean(ran.map(e => e.dur))) : 0;
      const created = D(220 + Math.floor(rng.float() * 300));
      const slug = meta.area.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      ds.add('test_cases', {
        id: c.id, team_id: team.id, name: `${meta.area}: ${meta.scenario}`,
        description: `${meta.spec.type === 'manual' ? 'Manual' : 'Automated'} ${meta.spec.type} test. ${meta.area} ${meta.scenario}.`,
        test_type: c.type, priority: meta.n % 4 === 0 ? 'critical' : ['high', 'medium', 'low'][meta.n % 3], status: meta.status,
        requirement_id: `${team.code}-${100 + ((meta.n * 37) % 400)}`,
        file_path: c.type === 'unit' ? `src/${slug}/__tests__/${slug}.test.ts` : c.type === 'manual' ? null : `tests/${c.type}/${slug}.spec.ts`,
        class_name: c.type === 'manual' ? null : `${meta.area.replace(/[^A-Za-z0-9]+/g, '')}Spec`,
        method_name: c.type === 'manual' ? null : meta.scenario.replace(/[^a-zA-Z ]/g, '').split(' ').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(''),
        pass_rate: execs.length ? round((passed / execs.length) * 100, 2) : 0, execution_count: execs.length,
        last_execution_status: last ? last.status : null, last_executed: last ? last.at : null,
        avg_duration_ms: avgMs, avg_duration: round(avgMs / 1000, 2),
        flakiness_score: flakiness, consecutive_failures: consecutive, is_flaky: c.flaky,
        effectiveness_score: round(clamp(55 + 40 * team.h + (rnd('eff', c.id) - 0.5) * 20 - (c.flaky ? 15 : 0), 10, 99), 2),
        maintenance_cost_hours: round((c.flaky ? 6 : 0.5) + rnd('mc', c.id) * (c.type === 'e2e' ? 10 : 3), 2),
        created_by: rnd('cb', c.id) < 0.3 ? lead.id : engineers[meta.n % engineers.length].id,
        created_at: ts(created, 11), updated_at: last ? last.at : ts(created, 11),
      });
      const nTags = 1 + Math.floor(rnd('ntag', c.id) * 3);
      const tags = new Set<string>([c.type === 'e2e' ? 'ui' : c.type === 'api' ? 'api' : TAGS[meta.n % TAGS.length]]);
      for (let i = 0; tags.size < nTags && i < 10; i++) tags.add(TAGS[Math.floor(rnd('tag', c.id, i) * TAGS.length)]);
      [...tags].forEach((tag, i) => ds.add('test_case_tags', { id: did('tag', team.key, String(meta.n).padStart(2, '0'), i), test_case_id: c.id, tag, created_at: ts(created, 11, 5) }));

      if (c.flaky) {
        const fails = execs.filter(e => e.status === 'failed');
        const verified = rnd('verified', c.id) < 0.5;
        const ROOT: Record<string, [string, string]> = {
          timing: ['Animation on the payment button is not awaited before the click', 'Wait for the button to be enabled instead of a fixed sleep; disable animations in test runs'],
          environment: ['Shared staging database is reset by a parallel job', 'Use a per-run schema created by the test fixture'],
          data: ['Test relies on the FX rate of the day; rounding differs on some days', 'Freeze the FX rate in the fixture and assert with the stored rate'],
          network: ['Sandbox payment provider throttles bursts of requests', 'Mock the provider in CI and keep one nightly contract test against the sandbox'],
          unknown: ['', ''],
        };
        ds.add('flaky_tests', {
          id: did('flaky', team.key, String(meta.n).padStart(2, '0')), test_case_id: c.id, team_id: team.id, company_id: DEMO_COMPANY_ID,
          test_name: `${meta.area}: ${meta.scenario}`, failure_pattern: c.pattern, flakiness_score: flakiness,
          failure_count: fails.length, pass_count: passed, total_runs: execs.length,
          last_flaky_at: fails.length ? fails[fails.length - 1].at : null,
          root_cause: verified ? ROOT[c.pattern][0] : null, suggested_fix: verified ? ROOT[c.pattern][1] : null,
          is_quarantined: flakiness >= 45, created_at: fails.length ? fails[0].at : ts(D(EVENT_DAYS), 9), updated_at: last.at,
        });
      }
    }
  }

  // Suite runs (test execution timeline), last EVENT_DAYS days.
  for (const team of TEAMS) {
    const engineers = engineersOf(team);
    const e2eCase = casesByTeam.get(team.key)!.find(c => c.type === 'e2e' && c.active)!;
    const suites: Array<{ name: string; hour: number; days: number[]; dur: [number, number]; deps: string[]; caseId: string | null }> = [
      { name: 'Smoke', hour: 6, days: [0, 1, 2, 3, 4, 5, 6], dur: [180, 420], deps: [], caseId: null },
      { name: 'API contract', hour: 7, days: [1, 2, 3, 4, 5], dur: [300, 900], deps: ['Smoke'], caseId: null },
      { name: 'Regression', hour: 1, days: [1, 2, 3, 4, 5], dur: [1800, 4800], deps: ['Smoke'], caseId: null },
      { name: `E2E ${team.areas[0]}`, hour: 9, days: [1, 3, 5], dur: [900, 2400], deps: ['Smoke', 'API contract'], caseId: e2eCase.id },
    ];
    for (let t = EVENT_DAYS; t >= 1; t--) {
      const date = D(t);
      const h = teamHealth(team, t);
      const statusOf = new Map<string, string>();
      for (const [si, s] of suites.entries()) {
        if (!s.days.includes(dow(date))) continue;
        const r = rnd('suite', team.key, si, date);
        const depFailed = s.deps.some(d => statusOf.get(d) === 'failed' || statusOf.get(d) === 'blocked');
        const status = depFailed ? 'blocked' : r < 0.02 + 0.18 * (1 - h) ? 'failed' : r < 0.03 + 0.18 * (1 - h) ? 'skipped' : 'passed';
        statusOf.set(s.name, status);
        const start = ts(date, s.hour, Math.floor(rnd('sm', team.key, si, date) * 50));
        const dur = status === 'blocked' || status === 'skipped' ? 0 : Math.round(lerp(s.dur[0], s.dur[1], rnd('sd', team.key, si, date)) * (1.3 - 0.4 * h));
        ds.add('test_execution_runs', {
          id: did('ter', team.key, compact(date), si), company_id: DEMO_COMPANY_ID, team_id: team.id, test_suite: s.name, test_case_id: s.caseId,
          status, start_time: start, end_time: addSeconds(start, dur), duration_seconds: dur,
          assigned_to: engineers[(t + si) % engineers.length].id, dependencies: { json: s.deps },
          error_message: status === 'failed' ? `${1 + Math.floor(rnd('nf', team.key, si, date) * 6)} test(s) failed in ${s.name}` : status === 'blocked' ? `Blocked: dependency ${s.deps.join(', ')} did not pass` : status === 'skipped' ? 'Skipped: no changes since last run' : null,
          created_at: start,
        });
      }
    }
  }

  // Daily test totals per team (weekdays, full KPI history window).
  const tteByTeam = new Map<string, Map<string, { total: number; passed: number; failed: number; skipped: number; avg: number }>>();
  for (const team of TEAMS) {
    const byDate = new Map<string, { total: number; passed: number; failed: number; skipped: number; avg: number }>();
    for (let t = HISTORY_DAYS; t >= 1; t--) {
      const date = D(t);
      if (!isWeekday(date)) continue;
      const k = kpiOf(team, t);
      const total = Math.round((900 + team.revenue / 1200) * (0.6 + k.automation_coverage / 200) * (1 + (HISTORY_DAYS - t) * 0.0008));
      const failRate = ((100 - k.first_time_pass_rate) / 100) * 0.08 * (1 + (rnd('ttf', team.key, date) - 0.5) * 0.6);
      const failed = Math.round(total * failRate);
      const skipped = Math.round(total * (0.006 + rnd('tts', team.key, date) * 0.01));
      const blocked = Math.round(total * 0.002 * (1 - team.h) * 3);
      const passed = total - failed - skipped - blocked;
      const totalDur = Math.round(k.test_execution_time_minutes * 60 * (0.92 + rnd('ttd', team.key, date) * 0.16));
      const unit = Math.round(total * 0.62), integration = Math.round(total * 0.18), api = Math.round(total * 0.13);
      byDate.set(date, { total, passed, failed, skipped, avg: round(totalDur / total, 2) });
      ds.add('team_test_executions', {
        id: did('tte', team.key, compact(date)), team_id: team.id, execution_date: date, total_tests: total, passed, failed, skipped, blocked,
        total_duration_seconds: totalDur, avg_duration_seconds: round(totalDur / total, 2),
        unit_tests: unit, integration_tests: integration, e2e_tests: total - unit - integration - api, api_tests: api,
        environment: 'ci', build_number: `${team.key}-nightly-${compact(date)}`, created_at: ts(date, 23, 50),
      });
    }
    tteByTeam.set(team.key, byDate);
  }

  // --------------------------------------------------------------------------
  // CI/CD pipeline: stages, runs (stage executions), daily summaries, history
  // --------------------------------------------------------------------------
  const STAGES = [
    { name: 'Build', cpu: 72, mem: 58 }, { name: 'Unit Tests', cpu: 55, mem: 40 }, { name: 'Integration Tests', cpu: 63, mem: 55 },
    { name: 'Security Scan', cpu: 32, mem: 28 }, { name: 'Deploy to Staging', cpu: 38, mem: 33 }, { name: 'E2E Tests', cpu: 78, mem: 68 },
    { name: 'Deploy to Prod', cpu: 34, mem: 30 },
  ];
  const stageDuration = (si: number, k: KpiRow, h: number) => [
    k.avg_build_time_minutes * 60, k.test_execution_time_minutes * 60 * 0.22, k.test_execution_time_minutes * 60 * 0.33,
    100 + 80 * (1 - h), 70 + 90 * (1 - h), k.test_execution_time_minutes * 60 * 0.45, 55 + 80 * (1 - h),
  ][si];
  const stageSuccess = (si: number, h: number) => [0.985 + 0.012 * h, 0.93 + 0.065 * h, 0.88 + 0.1 * h, 0.975 + 0.02 * h, 0.96 + 0.035 * h, 0.8 + 0.17 * h, 0.97 + 0.028 * h][si];
  const STAGE_ERRORS = [
    'error TS2339: Property does not exist on type (compile failed)', '3 unit tests failed', 'Integration suite failed: 2 failures, 1 error',
    'High severity vulnerability found in dependency (CVE-2026-1042)', 'Helm upgrade timed out waiting for rollout', 'E2E: 4 scenarios failed',
    'Canary health check failed: error rate above threshold, rolled back',
  ];

  ds.reserve('pipeline_stages', 'pipeline_runs', 'pipeline_execution_summary', 'pipeline_stage_history', 'team_pipeline_metrics');
  interface RunAgg { durations: number[]; success: number; failed: number; cancelled: number }
  const allRuns: Array<{ team: string; si: number; date: string; status: string; dur: number }> = [];
  const authorsOf = (team: TeamDef) => devsOf(team).map(u => `${u.first.toLowerCase()}.${u.last.toLowerCase().replace(/[^a-z]/g, '')}`);
  for (const team of TEAMS) {
    const authors = authorsOf(team);
    const stageIds = STAGES.map((_, si) => did('stage', team.key, si + 1));
    const execsPerDay = new Map<string, { total: number; ok: number; failed: number; build: number[]; test: number[]; deploy: number[]; failsByStage: number[] }>();
    for (let t = EVENT_DAYS; t >= 1; t--) {
      const date = D(t);
      const k = kpiOf(team, t);
      const h = teamHealth(team, t);
      const wk = isWeekday(date);
      const rng = new Rng('pipe', team.key, date);
      const mainRuns = wk ? Math.max(1, Math.round((k.deployment_frequency_per_week / 5) * 1.15 + rng.float() - 0.5)) : rng.chance(0.15) ? 1 : 0;
      const featureRuns = wk ? 1 + rng.int(0, 2) : rng.chance(0.3) ? 1 : 0;
      const day = { total: 0, ok: 0, failed: 0, build: [] as number[], test: [] as number[], deploy: [] as number[], failsByStage: STAGES.map(() => 0) };
      const nExec = Math.min(mainRuns + featureRuns, 12);
      for (let e = 0; e < nExec; e++) {
        const isMain = e < mainRuns;
        const lastStage = isMain ? STAGES.length : 4;
        let clock = ts(date, 8 + Math.floor(((e + rng.float()) * 11) / Math.max(nExec, 1)), rng.int(0, 59), rng.int(0, 59));
        const branch = isMain ? 'main' : `feature/${team.code}-${200 + rng.int(0, 299)}-${team.areas[rng.int(0, team.areas.length - 1)].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 100);
        const author = authors[rng.int(0, authors.length - 1)];
        const sha = sha1(`${team.key}|${date}|${e}`);
        let outcome: 'ok' | 'failed' | 'cancelled' = 'ok';
        let testSecs = 0, deploySecs = 0;
        for (let si = 0; si < lastStage; si++) {
          const dur = Math.round(stageDuration(si, k, h) * (0.85 + rng.float() * 0.3));
          const cancelled = rng.chance(0.006);
          const failed = !cancelled && !rng.chance(stageSuccess(si, h));
          const status = cancelled ? 'cancelled' : failed ? 'failed' : 'success';
          const runDur = cancelled ? Math.round(dur * rng.float()) : dur;
          ds.add('pipeline_runs', {
            id: did('run', team.key, compact(date), e, si + 1), company_id: DEMO_COMPANY_ID, team_id: team.id, stage_id: stageIds[si],
            status, duration_seconds: runDur, triggered_by: isMain ? (e === 0 && rng.chance(0.3) ? 'schedule' : `merge:${author}`) : `push:${author}`,
            commit_sha: sha, branch, started_at: clock, completed_at: addSeconds(clock, runDur),
            error_message: failed ? STAGE_ERRORS[si] : cancelled ? `Cancelled by ${author}` : null,
          });
          allRuns.push({ team: team.key, si, date, status, dur: runDur });
          if (si === 0) day.build.push(runDur);
          if (si === 1 || si === 2 || si === 5) testSecs += runDur;
          if (si === 4 || si === 6) deploySecs += runDur;
          clock = addSeconds(clock, runDur + 5 + rng.int(0, 40));
          if (status !== 'success') { outcome = failed ? 'failed' : 'cancelled'; if (failed) day.failsByStage[si]++; break; }
        }
        day.total++;
        if (outcome === 'ok') day.ok++;
        if (outcome === 'failed') day.failed++;
        if (testSecs) day.test.push(testSecs);
        if (deploySecs) day.deploy.push(deploySecs);
      }
      if (day.total) execsPerDay.set(date, day);
    }

    // Per stage per day summary, history and the stage's current (30-day) aggregate.
    const teamRuns = allRuns.filter(r => r.team === team.key);
    const stageAgg: RunAgg[] = STAGES.map(() => ({ durations: [], success: 0, failed: 0, cancelled: 0 }));
    const dates = [...new Set(teamRuns.map(r => r.date))].sort();
    for (const date of dates) {
      const dayAgg: RunAgg[] = STAGES.map(() => ({ durations: [], success: 0, failed: 0, cancelled: 0 }));
      for (const r of teamRuns.filter(x => x.date === date)) {
        for (const agg of [dayAgg[r.si], stageAgg[r.si]]) {
          agg.durations.push(r.dur);
          if (r.status === 'success') agg.success++; else if (r.status === 'failed') agg.failed++; else agg.cancelled++;
        }
      }
      const dayBottleneck = bottleneckScores(dayAgg.map(a => (a.durations.length ? mean(a.durations) : null)), dayAgg.map(a => (a.success + a.failed ? (a.success / (a.success + a.failed)) * 100 : null)));
      dayAgg.forEach((a, si) => {
        if (!a.durations.length) return;
        const total = a.durations.length;
        ds.add('pipeline_execution_summary', {
          id: did('pes', team.key, si + 1, compact(date)), company_id: DEMO_COMPANY_ID, team_id: team.id, stage_id: stageIds[si], execution_date: date,
          total_runs: total, successful_runs: a.success, failed_runs: a.failed,
          avg_duration_seconds: Math.round(mean(a.durations)), min_duration_seconds: Math.min(...a.durations), max_duration_seconds: Math.max(...a.durations),
          total_cost: round((a.durations.reduce((s, d) => s + d, 0) / 60) * PIPELINE_COST_PER_MINUTE, 2), created_at: ts(date, 23, 55), updated_at: ts(date, 23, 55),
        });
        const avg = mean(a.durations);
        ds.add('pipeline_stage_history', {
          id: did('psh', team.key, si + 1, compact(date)), stage_id: stageIds[si], company_id: DEMO_COMPANY_ID, team_id: team.id, name: STAGES[si].name,
          duration_seconds: Math.round(avg), success_rate: a.success + a.failed ? round((a.success / (a.success + a.failed)) * 100, 2) : 100,
          cpu_usage: round(clamp(STAGES[si].cpu + (rnd('cpu', team.key, si, date) - 0.5) * 16, 5, 99), 2),
          memory_usage: round(clamp(STAGES[si].mem + (rnd('mem', team.key, si, date) - 0.5) * 14, 5, 99), 2),
          cost_per_run: round((avg / 60) * PIPELINE_COST_PER_MINUTE, 2), bottleneck_score: dayBottleneck[si] ?? 0, recorded_at: ts(date, 23, 58),
        });
      });
    }
    const stageBottleneck = bottleneckScores(stageAgg.map(a => (a.durations.length ? mean(a.durations) : null)), stageAgg.map(a => (a.success + a.failed ? (a.success / (a.success + a.failed)) * 100 : null)));
    STAGES.forEach((s, si) => {
      const a = stageAgg[si];
      const avg = a.durations.length ? mean(a.durations) : stageDuration(si, kpiOf(team, 1), teamHealth(team, 1));
      ds.add('pipeline_stages', {
        id: stageIds[si], company_id: DEMO_COMPANY_ID, team_id: team.id, name: s.name, stage_order: si + 1,
        avg_duration_seconds: Math.round(avg), success_rate: a.success + a.failed ? round((a.success / (a.success + a.failed)) * 100, 2) : 100,
        cpu_usage: round(clamp(s.cpu + (rnd('scpu', team.key, si) - 0.5) * 10, 5, 99), 2), memory_usage: round(clamp(s.mem + (rnd('smem', team.key, si) - 0.5) * 10, 5, 99), 2),
        cost_per_run: round((avg / 60) * PIPELINE_COST_PER_MINUTE, 2), bottleneck_score: stageBottleneck[si] ?? 0,
        manually_edited: false, is_active: true, created_at: ts(D(400), 10), updated_at: ts(yesterday, 23, 58),
      });
    });

    // Team pipeline metrics per day (from the runs above).
    for (const [date, d] of execsPerDay) {
      const slowestIdx = [0, 1, 2, 3, 4, 5, 6].map(si => {
        const durs = teamRuns.filter(r => r.date === date && r.si === si).map(r => r.dur);
        return { si, avg: durs.length ? mean(durs) : -1 };
      }).sort((a, b) => b.avg - a.avg)[0].si;
      const maxFails = Math.max(...d.failsByStage);
      ds.add('team_pipeline_metrics', {
        id: did('tpm', team.key, compact(date)), team_id: team.id, recorded_date: date,
        total_builds: d.total, successful_builds: d.ok, failed_builds: d.failed, build_success_rate: round((d.ok / d.total) * 100, 2),
        avg_build_time_minutes: round(mean(d.build) / 60, 2), avg_queue_time_minutes: round(0.4 + 3 * (1 - teamHealth(team, 0)) * rnd('queue', team.key, date) + 0.3, 2),
        avg_compile_time_minutes: round((mean(d.build) / 60) * 0.7, 2), avg_test_time_minutes: round(d.test.length ? mean(d.test) / 60 : 0, 2),
        avg_deploy_time_minutes: round(d.deploy.length ? mean(d.deploy) / 60 : 0, 2),
        slowest_stage: STAGES[slowestIdx].name, most_failing_stage: maxFails > 0 ? STAGES[d.failsByStage.indexOf(maxFails)].name : null,
        created_at: ts(date, 23, 59),
      });
    }
  }
  // Company-level default stages (shown for the company-wide view): aggregates over all teams.
  {
    const coAgg: RunAgg[] = STAGES.map(() => ({ durations: [], success: 0, failed: 0, cancelled: 0 }));
    for (const r of allRuns) {
      const a = coAgg[r.si];
      a.durations.push(r.dur);
      if (r.status === 'success') a.success++; else if (r.status === 'failed') a.failed++; else a.cancelled++;
    }
    const scores = bottleneckScores(coAgg.map(a => (a.durations.length ? mean(a.durations) : null)), coAgg.map(a => (a.success + a.failed ? (a.success / (a.success + a.failed)) * 100 : null)));
    STAGES.forEach((s, si) => {
      const a = coAgg[si];
      const avg = mean(a.durations);
      const id = did('stage', 'co', si + 1);
      ds.add('pipeline_stages', {
        id, company_id: DEMO_COMPANY_ID, team_id: null, name: s.name, stage_order: si + 1,
        avg_duration_seconds: Math.round(avg), success_rate: round((a.success / Math.max(1, a.success + a.failed)) * 100, 2),
        cpu_usage: s.cpu, memory_usage: s.mem, cost_per_run: round((avg / 60) * PIPELINE_COST_PER_MINUTE, 2), bottleneck_score: scores[si] ?? 0,
        manually_edited: false, is_active: true, created_at: ts(D(400), 10), updated_at: ts(yesterday, 23, 58),
      });
      // Weekly history of the company aggregate (no runs/summaries: those belong to team stages).
      for (let w = 0; w * 7 < EVENT_DAYS; w++) {
        const date = D(1 + w * 7);
        const runs = allRuns.filter(r => r.si === si && r.date <= date && r.date > addDays(date, -7));
        if (!runs.length) continue;
        const ok = runs.filter(r => r.status === 'success').length, bad = runs.filter(r => r.status === 'failed').length;
        const ravg = mean(runs.map(r => r.dur));
        ds.add('pipeline_stage_history', {
          id: did('psh', 'co', si + 1, compact(date)), stage_id: id, company_id: DEMO_COMPANY_ID, team_id: null, name: s.name,
          duration_seconds: Math.round(ravg), success_rate: round((ok / Math.max(1, ok + bad)) * 100, 2), cpu_usage: s.cpu, memory_usage: s.mem,
          cost_per_run: round((ravg / 60) * PIPELINE_COST_PER_MINUTE, 2), bottleneck_score: scores[si] ?? 0, recorded_at: ts(date, 23, 59),
        });
      }
    });
  }

  // --------------------------------------------------------------------------
  // Weekly team analytics (Monday..Sunday, complete weeks in the history window)
  // --------------------------------------------------------------------------
  for (const team of TEAMS) {
    const tte = tteByTeam.get(team.key)!;
    const devs = devsOf(team);
    let lastSunday = today;
    while (dow(lastSunday) !== 0 || lastSunday === today) lastSunday = addDays(lastSunday, -1);
    let bugsOpen = Math.round(6 + 30 * (1 - team.h));
    const weeks: string[] = [];
    for (let end = lastSunday; Date.parse(today) - Date.parse(addDays(end, -6)) <= HISTORY_DAYS * DAY_MS; end = addDays(end, -7)) weeks.push(end);
    for (const end of weeks.reverse()) {
      const start = addDays(end, -6);
      const days = [...Array(7)].map((_, i) => addDays(start, i));
      const ts_ = days.map(d => (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / DAY_MS);
      const ks = ts_.map(t => kpiOf(team, t));
      const avgK = (col: string) => mean(ks.map(k => k[col]));
      const runs = days.map(d => tte.get(d)).filter(Boolean) as Array<{ total: number; passed: number; failed: number; skipped: number; avg: number }>;
      const passedT = runs.reduce((s, r) => s + r.passed, 0), failedT = runs.reduce((s, r) => s + r.failed, 0), skippedT = runs.reduce((s, r) => s + r.skipped, 0);
      const totalT = runs.reduce((s, r) => s + r.total, 0);
      const deploys = Math.round(avgK('deployment_frequency_per_week'));
      const failedDeploys = Math.round(deploys * (avgK('change_failure_rate') / 100));
      const linesAdded = Math.round((1800 + 900 * devs.length) * (0.8 + rnd('la', team.key, start) * 0.4));
      const linesRemoved = Math.round(linesAdded * (0.35 + rnd('lr', team.key, start) * 0.3));
      const bugsCreated = Math.round(avgK('defect_density') * (linesAdded / 1000) * 1.5 + rnd('bc', team.key, start) * 2);
      const bugsResolved = Math.max(0, Math.round(bugsCreated * (0.8 + 0.35 * team.h + (rnd('br', team.key, start) - 0.5) * 0.3)));
      bugsOpen = Math.max(0, bugsOpen + bugsCreated - bugsResolved);
      const sprint = sprintAt(team, end) ?? sprintsByTeam.get(team.key)![0];
      const weekDev = devs.map(u => devAverage(u.id, end, 5)).filter(Boolean) as DevDay[];
      const prs = Math.round(devs.length * (3 + 5 * team.h) * (0.85 + rnd('prs', team.key, start) * 0.3));
      const testCases = casesByTeam.get(team.key)!.filter(c => c.active).length;
      ds.add('team_analytics', {
        id: did('ta', team.key, compact(start)), team_id: team.id, period_start: start, period_end: end, period_type: 'weekly',
        total_test_cases: runs.length ? runs[runs.length - 1].total : 0, passed_tests: passedT, failed_tests: failedT, skipped_tests: skippedT,
        test_pass_rate: totalT ? round((passedT / totalT) * 100, 2) : 0, avg_test_duration_seconds: runs.length ? round(mean(runs.map(r => r.avg)), 2) : 0,
        flaky_test_count: clamp(Math.round(testCases * (avgK('test_flakiness_rate') / 100) * 1.6), 1, 5), code_coverage: round(avgK('test_coverage'), 2),
        code_churn: linesAdded + linesRemoved, lines_added: linesAdded, lines_removed: linesRemoved,
        deployment_count: deploys, successful_deployments: deploys - failedDeploys, failed_deployments: failedDeploys,
        rollback_count: Math.min(failedDeploys, Math.round(failedDeploys * 0.6)), avg_deployment_time_minutes: round((125 + 170 * (1 - team.h)) / 60, 2),
        bugs_created: bugsCreated, bugs_resolved: bugsResolved, bugs_open: bugsOpen, critical_bugs: Math.round(bugsOpen * (avgK('defect_escape_rate') / 100)),
        avg_bug_resolution_hours: round(avgK('mttr_hours') * 3 + 6, 2),
        story_points_committed: Math.round(sprint.committed / 2), story_points_completed: Math.round(sprint.delivered / 2),
        velocity: round(sprint.delivered / 2, 2), carryover_points: Math.round(sprint.carryover / 2),
        avg_pr_merge_time_hours: weekDev.length ? round(mean(weekDev.map(v => v.pr)), 2) : 0,
        avg_code_review_time_hours: weekDev.length ? round(mean(weekDev.map(v => v.review)), 2) : 0,
        total_prs_merged: prs, total_code_reviews: Math.round(prs * 1.6), created_at: ts(addDays(end, 1), 2), updated_at: ts(addDays(end, 1), 2),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Performance metrics: each team's endpoints, daily
  // --------------------------------------------------------------------------
  for (const team of TEAMS) {
    for (let t = PERF_DAYS; t >= 1; t--) {
      const date = D(t);
      const h = teamHealth(team, t);
      const weekdayLoad = isWeekday(date) ? 1 : 0.55;
      team.endpoints.forEach(([path, method, base], ei) => {
        const n = (k: string) => rnd('perf', team.key, ei, k, date);
        const p50 = Math.round(base * (1 + 0.9 * (1 - h)) * (0.9 + n('p50') * 0.2));
        const p95 = Math.round(p50 * (2.1 + n('p95') * 0.9 + 0.8 * (1 - h)));
        const p99 = Math.round(p95 * (1.35 + n('p99') * 0.5));
        const errorRate = round(clamp(0.04 + 2.4 * Math.pow(1 - h, 2) * (0.6 + n('err') * 0.8), 0.01, 9), 2);
        const isWeb = team.platform === 'Web' || team.platform === 'iOS & Android';
        ds.add('performance_metrics', {
          id: did('perf', team.key, ei, compact(date)), team_id: team.id, recorded_date: date, endpoint: path, method,
          response_time_p50_ms: p50, response_time_p95_ms: p95, response_time_p99_ms: p99,
          throughput_per_minute: Math.round((2400 / (ei + 1)) * (team.revenue / 2_000_000) * weekdayLoad * (0.85 + n('tp') * 0.3)) + 5,
          error_rate: errorRate, cpu_usage_avg: round(clamp(28 + 45 * (1 - h) + n('cpu') * 12, 5, 98), 2), memory_usage_avg: round(clamp(42 + 35 * (1 - h) + n('mem') * 10, 10, 97), 2),
          disk_io_avg: round(5 + n('disk') * 40 + 20 * (1 - h), 2), network_io_avg: round(15 + n('net') * 160 * weekdayLoad, 2),
          db_query_time_avg_ms: Math.round(3 + 45 * (1 - h) * (0.7 + n('db') * 0.6)), db_connections_avg: Math.round(8 + 60 * weekdayLoad * (0.5 + n('dbc') * 0.5)),
          slow_queries_count: Math.round(40 * Math.pow(1 - h, 2) * (0.5 + n('sq'))),
          page_load_time_ms: Math.round((isWeb ? 900 : 600) + 2800 * (1 - h) * (0.8 + n('pl') * 0.4)),
          first_contentful_paint_ms: Math.round(380 + 1300 * (1 - h) * (0.8 + n('fcp') * 0.4)),
          largest_contentful_paint_ms: Math.round(1050 + 3200 * (1 - h) * (0.8 + n('lcp') * 0.4)),
          time_to_interactive_ms: Math.round(1450 + 4300 * (1 - h) * (0.8 + n('tti') * 0.4)),
          created_at: ts(date, 23, 45), company_id: DEMO_COMPANY_ID,
        });
      });
    }
  }

  // --------------------------------------------------------------------------
  // Technical debt with financial impact (cost of delay uses the company config)
  // --------------------------------------------------------------------------
  const DEBT: Array<[string, string, string, string]> = [
    ['Legacy payment adapter has no retry/backoff', 'code_quality', 'high', 'Synchronous calls to the provider fail on transient errors and surface as declines.'],
    ['E2E suite depends on shared staging data', 'testing', 'medium', 'Tests read and mutate shared fixtures, causing order-dependent failures.'],
    ['Missing runbook for settlement file failures', 'documentation', 'low', 'On-call has no documented recovery steps for a rejected settlement file.'],
    ['Single-AZ Redis for session cache', 'infrastructure', 'critical', 'A zone outage logs every customer out and blocks payments.'],
    ['Outdated TLS configuration on internal API gateway', 'security', 'high', 'Gateway still allows TLS 1.1 for some internal clients.'],
    ['N+1 queries on statement listing', 'performance', 'medium', 'Statement page issues one query per line item; p95 grows with history length.'],
    ['Hard-coded feature flags in mobile client', 'code_quality', 'medium', 'Flags require an app release to change.'],
    ['No contract tests for partner webhooks', 'testing', 'high', 'Breaking payload changes are found by merchants in production.'],
    ['Manual database migrations in release process', 'infrastructure', 'high', 'Migrations are run by hand during releases, which delays deploys and causes errors.'],
    ['Unpinned base images in CI', 'security', 'medium', 'Builds are not reproducible and pick up unreviewed image changes.'],
    ['Report generation blocks the request thread', 'performance', 'high', 'Large exports time out; should be an async job.'],
    ['API reference out of date', 'documentation', 'low', 'Several endpoints and error codes are missing from the reference.'],
    ['Duplicated currency rounding logic', 'code_quality', 'medium', 'Three implementations disagree on half-even rounding.'],
    ['Flaky screenshot comparison tests', 'testing', 'low', 'Visual diffs fail on font rendering differences between runners.'],
    ['Secrets in environment files on build agents', 'security', 'critical', 'Long-lived credentials are stored on shared CI agents.'],
    ['No autoscaling for batch workers', 'infrastructure', 'medium', 'Month-end batch jobs queue for hours.'],
  ];
  const debtItems: Array<{ team: string; severity: string; created: string; resolved: string | null; status: string }> = [];
  const cfg = { hourly: 85, ticket: 30, rpu: 42, downtime: 180, sla: 2500 };
  for (const team of TEAMS) {
    const rng = new Rng('debt', team.key);
    const count = 4 + Math.round(5 * (1 - team.h));
    const engineers = engineersOf(team);
    for (let i = 0; i < count; i++) {
      const [title, category, baseSeverity, description] = DEBT[(i * 5 + TEAMS.indexOf(team) * 3) % DEBT.length];
      const severity = rng.chance(0.25) ? rng.pick(['critical', 'high', 'medium', 'low']) : baseSeverity;
      const age = rng.int(10, 320);
      const created = D(age);
      const doneP = 0.25 + 0.4 * team.h;
      const status = rng.chance(doneP) ? (rng.chance(0.85) ? 'resolved' : 'wont_fix') : rng.chance(0.35) ? 'in_progress' : 'open';
      const resolved = status === 'resolved' || status === 'wont_fix' ? D(Math.max(1, Math.floor(age * rng.float()))) : null;
      const sevF = { critical: 1, high: 0.65, medium: 0.35, low: 0.15 }[severity as 'critical' | 'high' | 'medium' | 'low'];
      const affected = Math.round(team.revenue / 42 * 0.25 * sevF * rng.float());
      const tickets = Math.round(60 * sevF * rng.float());
      const downtime = category === 'infrastructure' || category === 'performance' ? Math.round(180 * sevF * rng.float()) : 0;
      const revenuePct = round(3.5 * sevF * rng.float(), 2);
      const slaBreaches = category === 'infrastructure' || category === 'performance' || category === 'security' ? Math.round(4 * sevF * rng.float()) : 0;
      const effort = round(rng.range(4, 24) + 100 * sevF * rng.float(), 2);
      const monthly = tickets * cfg.ticket + downtime * cfg.downtime + affected * cfg.rpu * (revenuePct / 100) + slaBreaches * cfg.sla;
      const investment = effort * cfg.hourly;
      const priority = round(clamp(25 * sevF + 55 * Math.min(1, (monthly * 12) / Math.max(investment * 4, 1)) + 20 * rng.float(), 1, 99.99), 2);
      const lead = leadOf(team);
      debtItems.push({ team: team.key, severity, created, resolved, status });
      ds.add('technical_debt', {
        id: did('td', team.key, String(i + 1).padStart(2, '0')), team_id: team.id, title, description, severity, category,
        impact_score: Math.round(clamp(100 * sevF * (0.6 + 0.4 * rng.float()), 1, 100)), effort_hours: effort, status,
        source: rng.pick(['SonarQube', 'Snyk', 'Incident review', 'Architecture review', 'Team retrospective']),
        file_path: category === 'documentation' ? `docs/${team.key}/runbook.md` : `services/${team.key}/src/${team.areas[i % team.areas.length].toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`,
        line_number: category === 'documentation' ? null : rng.int(12, 900),
        assigned_to: status === 'open' && rng.chance(0.4) ? null : engineers[i % engineers.length].id, created_by: lead.id,
        resolved_at: resolved ? ts(resolved, 15) : null, created_at: ts(created, 10), updated_at: ts(resolved ?? D(Math.min(age, rng.int(1, 20))), 15),
        company_id: DEMO_COMPANY_ID, cost_of_delay: round(monthly, 2), priority_score: priority,
        affected_users: affected, support_tickets_monthly: tickets, downtime_minutes_monthly: downtime, revenue_impact_percent: revenuePct,
        sla_breaches_monthly: slaBreaches, manually_edited: false,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Business impact: 12 months of quality metrics and business KPIs per team
  // --------------------------------------------------------------------------
  const thisMonth = monthOf(today);
  const months = [...Array(12)].map((_, i) => addMonths(thisMonth, i - 11));
  const tOf = (date: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
  const monthlyKpi = (team: TeamDef, ym: string) => {
    const days = [...Array(daysInMonth(ym))].map((_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`).filter(d => d <= today);
    const rows = days.map(d => kpiOf(team, tOf(d)));
    const avg = (c: string) => mean(rows.map(r => r[c]));
    return { avg, h: mean(days.map(d => teamHealth(team, tOf(d)))) };
  };
  const qualityByTeamMonth = new Map<string, Record<string, number>>();
  const kpisByTeamMonth = new Map<string, Record<string, number>>();
  const companyMonth = new Map<string, { revenue: number; users: number; nps: number[]; csat: number[]; churn: number[]; adoption: number[]; tickets: number; h: number[] }>();
  const CORR_METRICS: Array<[string, string]> = [['Test Coverage', 'test_coverage'], ['Code Quality', 'code_quality_score'], ['Deployment Frequency', 'deployment_frequency'], ['MTTR', 'mttr_hours'], ['Change Failure Rate', 'change_failure_rate']];
  for (const team of TEAMS) {
    const arpu = 18 + rnd('arpu', team.key) * 30;
    const growth = 0.006 + rnd('growth', team.key) * 0.02;
    let prevRevenue: number | null = null;
    let prevUsers: number | null = null;
    const qSeries: Record<string, number>[] = [];
    const kSeries: Record<string, number>[] = [];
    for (const [mi, ym] of months.entries()) {
      const { avg, h } = monthlyKpi(team, ym);
      const n = (k: string) => (rnd('bi', team.key, k, ym) - 0.5) * 2;
      const q = {
        test_coverage: round(avg('test_coverage'), 2), defect_density: round(avg('defect_density'), 4), defect_escape_rate: round(avg('defect_escape_rate'), 2),
        mttr_hours: round(avg('mttr_hours'), 2), deployment_frequency: round(avg('deployment_frequency_per_week'), 2), lead_time_days: round(avg('lead_time_days'), 2),
        code_quality_score: round(avg('code_quality_score'), 2), change_failure_rate: round(avg('change_failure_rate'), 2),
      };
      const holiday = ym.endsWith('-11') || ym.endsWith('-12');
      const revenue = round(team.revenue * Math.pow(1 + growth, mi) * (1 + 0.18 * (h - 0.6)) * (holiday ? 1.08 : 1) * (1 + n('rev') * 0.025), 2);
      const users = Math.round(revenue / arpu);
      const churn = round(clamp(5.2 - 4 * h + n('churn') * 0.35, 0.4, 12), 2);
      const kpis = {
        monthly_revenue: revenue, active_users: users, churn_rate: churn, feature_adoption_rate: round(clamp(24 + 50 * h + n('adopt') * 4, 5, 95), 2),
        new_customers: Math.max(0, Math.round(users * (growth + churn / 100) * (1 + n('new') * 0.15))),
        customer_lifetime_value: round((arpu * 12) / Math.max(churn / 100 * 12, 0.05), 2), nps_score: round(clamp(-12 + 78 * h + n('nps') * 5, -100, 100), 2),
        csat_score: round(clamp(68 + 27 * h + n('csat') * 2.5, 0, 100), 2), support_ticket_volume: Math.round(users * (0.012 + 0.05 * (1 - h)) * (1 + n('tix') * 0.12)),
        avg_resolution_time_hours: round(3 + 34 * (1 - h) * (1 + n('res') * 0.15), 2),
      };
      qSeries.push(q);
      kSeries.push(kpis);
      qualityByTeamMonth.set(`${team.key}|${ym}`, q);
      kpisByTeamMonth.set(`${team.key}|${ym}`, kpis);
      ds.add('business_impact_quality_metrics', { id: did('biq', team.key, ym), team_id: team.id, month_year: ym, ...q, manually_edited: false, data_source: 'synthetic', created_at: ts(`${ym}-01`, 6), updated_at: ts(`${ym}-01`, 6) });
      ds.add('business_impact_business_kpis', { id: did('bik', team.key, ym), team_id: team.id, month_year: ym, ...kpis, manually_edited: false, data_source: 'synthetic', created_at: ts(`${ym}-01`, 6), updated_at: ts(`${ym}-01`, 6) });
      const workingDays = [...Array(daysInMonth(ym))].filter((_, i) => isWeekday(`${ym}-${String(i + 1).padStart(2, '0')}`)).length;
      const deploysPerMonth = q.deployment_frequency * (daysInMonth(ym) / 7);
      const resolvedDebt = debtItems.filter(d => d.team === team.key && d.status === 'resolved' && d.resolved && monthOf(d.resolved) === ym).length;
      const availability = avg('system_availability');
      ds.add('business_impact_context', {
        id: did('bix', team.key, ym), team_id: team.id, month_year: ym, team_size: membersOf(team).length, sprint_length_days: 14, working_days: workingDays,
        feature_release_count: Math.max(1, Math.round(deploysPerMonth * 0.35)), bug_fix_count: Math.round(deploysPerMonth * 0.4 + q.defect_density * 6),
        tech_debt_items_resolved: resolvedDebt, user_growth_rate: prevUsers ? round(((users - prevUsers) / prevUsers) * 100, 2) : round(growth * 100, 2),
        total_user_base: users, is_holiday_season: holiday, marketing_spend: round(revenue * (0.04 + rnd('mkt', team.key, ym) * 0.03), 2),
        major_incident_count: Math.round((q.change_failure_rate / 100) * deploysPerMonth * 0.25), downtime_minutes: Math.round(((100 - availability) / 100) * daysInMonth(ym) * 1440),
        notes: mi === 11 ? 'Current month (partial).' : holiday ? 'Holiday trading peak.' : null, manually_edited: false,
        created_at: ts(`${ym}-01`, 6), updated_at: ts(`${ym}-01`, 6),
      });
      ds.add('business_impact_history', {
        id: did('bih', team.key, ym), team_id: team.id, month_year: ym,
        quality_score: computeQaScore({ test_coverage: q.test_coverage, defect_escape_rate: q.defect_escape_rate, change_failure_rate: q.change_failure_rate, code_quality_score: q.code_quality_score }).score ?? 0,
        revenue_impact: prevRevenue === null ? 0 : round(revenue - prevRevenue, 2), customer_satisfaction: kpis.csat_score, churn_rate: churn,
        // Shown on the Business impact configuration page, which lists entered history only.
        manually_edited: true, created_at: ts(`${ym}-01`, 6), updated_at: ts(`${ym}-01`, 6),
      });
      const cm = companyMonth.get(ym) ?? { revenue: 0, users: 0, nps: [], csat: [], churn: [], adoption: [], tickets: 0, h: [] };
      cm.revenue += revenue; cm.users += users; cm.nps.push(kpis.nps_score); cm.csat.push(kpis.csat_score); cm.churn.push(churn);
      cm.adoption.push(kpis.feature_adoption_rate); cm.tickets += kpis.support_ticket_volume; cm.h.push(h);
      companyMonth.set(ym, cm);
      prevRevenue = revenue;
      prevUsers = users;
    }

    // Correlations (same method as the API: Pearson r, two-sided t-test, BH-FDR).
    const QF = ['test_coverage', 'defect_density', 'defect_escape_rate', 'mttr_hours', 'deployment_frequency', 'lead_time_days', 'code_quality_score', 'change_failure_rate'];
    const KF = ['monthly_revenue', 'active_users', 'churn_rate', 'feature_adoption_rate', 'nps_score', 'csat_score', 'support_ticket_volume'];
    const tested: Array<{ qi: number; ki: number; r: number; p: number }> = [];
    QF.forEach((qf, qi) => KF.forEach((kf, ki) => {
      const res = pearson(qSeries.map(q => q[qf]), kSeries.map(k => k[kf]));
      if (res) tested.push({ qi, ki, ...res });
    }));
    const qv = benjaminiHochberg(tested.map(x => x.p));
    tested.forEach((x, i) => {
      const abs = Math.abs(x.r);
      ds.add('business_impact_correlations', {
        id: did('bic', team.key, x.qi, x.ki), team_id: team.id, quality_metric: QF[x.qi], business_kpi: KF[x.ki],
        pearson_correlation: round(x.r, 3), p_value: round(x.p, 8), sample_size: months.length, confidence_level: 95,
        start_month: months[0], end_month: months[months.length - 1],
        correlation_strength: abs >= 0.7 ? 'strong' : abs >= 0.5 ? 'moderate' : abs >= 0.3 ? 'weak' : 'none',
        is_significant: qv[i] < 0.05, calculated_at: ts(yesterday, 4), created_at: ts(yesterday, 4), updated_at: ts(yesterday, 4),
      });
    });
    ds.add('business_impact_data_status', {
      id: did('bis', team.key), team_id: team.id, months_with_quality_data: months.length, months_with_kpi_data: months.length,
      months_with_paired_data: months.length, earliest_month: months[0], latest_month: months[months.length - 1], is_correlation_ready: true,
      missing_quality_metrics: null, missing_kpi_metrics: null, last_validated_at: ts(yesterday, 4), created_at: ts(D(365), 4), updated_at: ts(yesterday, 4),
    });

    // Per-metric impact configuration (latest month), with the metric's revenue correlation.
    const latestQ = qSeries[qSeries.length - 1], latestK = kSeries[kSeries.length - 1];
    for (const [name, field] of CORR_METRICS) {
      const r = pearson(qSeries.map(q => q[field]), kSeries.map(k => k.monthly_revenue));
      const score = metricScore(field, latestQ[field]);
      ds.add('business_impact_config', {
        id: did('bicfg', team.key, CORR_METRICS.findIndex(m => m[0] === name)), team_id: team.id, metric_name: name, quality_score: round(score, 2),
        revenue_impact: round(latestK.monthly_revenue * Math.abs(r?.r ?? 0) * 0.05, 2), customer_satisfaction: latestK.csat_score,
        feature_adoption_rate: latestK.feature_adoption_rate, correlation_strength: round(r?.r ?? 0, 2),
        // The Business impact (v1) page lists configured (entered) values only.
        manually_edited: true, created_at: ts(D(60), 9), updated_at: ts(yesterday, 9),
      });
    }
  }
  // Company-level monthly impact per metric.
  for (const ym of months) {
    for (const [mi, [name, field]] of CORR_METRICS.entries()) {
      const scores = TEAMS.map(t => metricScore(field, qualityByTeamMonth.get(`${t.key}|${ym}`)![field]));
      const cm = companyMonth.get(ym)!;
      ds.add('business_impact_metrics', {
        id: did('bim', mi, ym), company_id: DEMO_COMPANY_ID, metric_name: name, quality_score: round(mean(scores), 2),
        revenue_impact: round(cm.revenue * 0.01 * (mean(scores) / 100), 2), customer_satisfaction: round(mean(cm.csat), 2),
        feature_adoption_rate: round(mean(cm.adoption), 2), correlation_strength: round(0.25 + 0.5 * mean(cm.h) * (1 - mi * 0.08), 4),
        recorded_date: `${ym}-01`, created_at: ts(`${ym}-01`, 6),
      });
    }
  }
  // Company business metrics, daily.
  for (let t = HISTORY_DAYS - 1; t >= 0; t--) {
    const date = D(t);
    const ym = monthOf(date);
    const cm = companyMonth.get(ym);
    if (!cm) continue;
    const n = (k: string) => (rnd('bm', k, date) - 0.5) * 2;
    const dailyRevenue = (cm.revenue / daysInMonth(ym)) * (isWeekday(date) ? 1.12 : 0.7) * (1 + n('rev') * 0.05);
    ds.add('business_metrics', {
      id: did('bm', compact(date)), company_id: DEMO_COMPANY_ID, metric_date: date, revenue: round(dailyRevenue, 2), mrr: round(cm.revenue, 2), arr: round(cm.revenue * 12, 2),
      customer_satisfaction_nps: Math.round(mean(cm.nps) + n('nps') * 2), customer_satisfaction_csat: round(mean(cm.csat) + n('csat') * 0.8, 2),
      churn_rate: round(mean(cm.churn), 2), feature_adoption_rate: round(mean(cm.adoption) + n('ad') * 0.5, 2),
      support_ticket_volume: Math.round((cm.tickets / daysInMonth(ym)) * (isWeekday(date) ? 1.15 : 0.6) * (1 + n('tix') * 0.1)),
      user_engagement_score: round(clamp(45 + 40 * mean(cm.h) + n('eng') * 3, 0, 100), 2), created_at: ts(date, 23, 59),
    });
  }

  // --------------------------------------------------------------------------
  // Company KPI snapshots: the dashboard's company metrics, one per day
  // --------------------------------------------------------------------------
  for (let t = HISTORY_DAYS; t >= 0; t--) {
    const date = D(t);
    const rows = TEAMS.map(team => kpiOf(team, t));
    const qa = rows.map(k => computeQaScore(k).score).filter((s): s is number => s !== null);
    const dora = rows.map(k => {
      const f = k.deployment_frequency_per_week, l = k.lead_time_days, c = k.change_failure_rate, m = k.mttr_hours;
      if (f >= 7 && l < 1 && c < 5 && m < 1) return 100;
      if (f >= 1 && l < 7 && c < 10 && m < 24) return 80;
      if (f >= 0.25 && l < 30 && c < 15 && m < 168) return 60;
      return 40;
    });
    const windowRuns = allRuns.filter(r => r.date <= date && r.date > addDays(date, -30) && r.status !== 'cancelled');
    const pipeline = windowRuns.length
      ? (windowRuns.filter(r => r.status === 'success').length / windowRuns.length) * 100
      : mean(TEAMS.map(team => mean(STAGES.map((_, si) => stageSuccess(si, teamHealth(team, t)))))) * 100;
    const openWeight = debtItems
      .filter(d => d.created <= date && !(d.resolved && d.resolved <= date))
      .reduce((s, d) => s + TECH_DEBT_SEVERITY_WEIGHTS[d.severity as keyof typeof TECH_DEBT_SEVERITY_WEIGHTS], 0);
    const debtScore = Math.max(0, 100 - Math.min(100, openWeight / TEAMS.length));
    let wellnessDate = date;
    while (!isWeekday(wellnessDate)) wellnessDate = addDays(wellnessDate, -1);
    const wellness = mean(TEAMS.flatMap(team => devsOf(team).map(u => {
      const v = devDays.get(u.id)!.get(wellnessDate) ?? devAverage(u.id, wellnessDate, 1);
      return v ? workloadBalance(v) : 0;
    })));
    const delivery = mean(dora);
    const health = delivery * 0.35 + pipeline * 0.25 + debtScore * 0.2 + wellness * 0.2;
    ds.add('company_kpi_snapshots', {
      company_id: DEMO_COMPANY_ID, snapshot_date: date,
      engineering_health_score: Math.round(health), delivery_performance_score: Math.round(delivery), developer_wellness_index: Math.round(wellness),
      tech_debt_status_score: round(debtScore, 1), pipeline_health_score: round(pipeline, 1), avg_qa_score: Math.round(mean(qa)),
      avg_test_coverage: round(mean(rows.map(k => k.test_coverage)), 1), avg_defect_escape_rate: round(mean(rows.map(k => k.defect_escape_rate)), 1),
      avg_flakiness_rate: round(mean(rows.map(k => k.test_flakiness_rate)), 1), automation_coverage: round(mean(rows.map(k => k.automation_coverage)), 1),
      created_at: ts(date, 0, 10),
    });
  }

  // One seeder run record (fixed id: inserted once, never duplicated).
  const total = ds.tables().reduce((s, tbl) => s + ds.count(tbl), 0);
  ds.add('seeder_runs', { id: 'demo-seeder-run', seeder_name: 'demo-seed', company_id: DEMO_COMPANY_ID, last_run_at: ts(today, 0, 1), records_affected: total, status: 'success', error_message: null });

  return ds;
}

// ============================================================================
// Statistics helpers (same definitions as server/routes/analytics.ts)
// ============================================================================

/** Bottleneck score per stage, as GET /analytics/pipeline-stages computes it. */
function bottleneckScores(durations: Array<number | null>, successRates: Array<number | null>): Array<number | null> {
  const ds = durations.filter((d): d is number => d !== null);
  const m = ds.length ? mean(ds) : 0;
  const variance = ds.length ? mean(ds.map(d => (d - m) ** 2)) : 0;
  const sd = Math.sqrt(Math.max(variance, 1e-6));
  return durations.map((d, i) => {
    const s = successRates[i];
    if (d === null || s === null) return null;
    const z = sd > 0 ? (d - m) / sd : 0;
    const durationFactor = Math.min(60, Math.max(0, ((z + 2) / 4) * 60));
    const failureFactor = (1 - Math.max(0, Math.min(1, s / 100))) * 40;
    return Math.round(Math.min(100, Math.max(0, durationFactor + failureFactor)) * 10) / 10;
  });
}

/** 0-100 "goodness" of a quality metric value (for business impact summaries). */
function metricScore(field: string, v: number): number {
  switch (field) {
    case 'test_coverage': return clamp(v, 0, 100);
    case 'code_quality_score': return clamp(v, 0, 100);
    case 'deployment_frequency': return clamp((Math.log(Math.max(v, 0.1)) / Math.log(20)) * 100, 0, 100);
    case 'mttr_hours': return clamp(100 - (Math.log(Math.max(v, 0.5)) / Math.log(48)) * 100, 0, 100);
    case 'change_failure_rate': return clamp(100 - v * 2.5, 0, 100);
    default: return 50;
  }
}

function logGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function pearson(x: number[], y: number[]): { r: number; p: number } | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  if (dx2 === 0 || dy2 === 0) return null;
  const r = Math.max(-1, Math.min(1, num / Math.sqrt(dx2 * dy2)));
  const df = n - 2;
  if (1 - Math.abs(r) < 1e-12) return { r, p: 0 };
  const t = r * Math.sqrt(df / (1 - r * r));
  return { r, p: Math.max(0, Math.min(1, incompleteBeta(df / (df + t * t), df / 2, 0.5))) };
}

function benjaminiHochberg(p: number[]): number[] {
  const idx = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const q = p.map(() => 1);
  let running = 1;
  for (let k = idx.length - 1; k >= 0; k--) {
    running = Math.min(running, (idx[k].v * idx.length) / (k + 1));
    q[idx[k].i] = Math.min(1, running);
  }
  return q;
}

// ============================================================================
// Removal (FK-safe order): only rows that belong to the demo company
// ============================================================================

const D_ = `'${DEMO_PREFIX}%'`;
/** Statements that delete every demo row, children before parents. */
export const CLEAR_STATEMENTS: Array<{ table: string; sql: string }> = [
  { table: 'team_members', sql: `DELETE FROM team_members WHERE user_id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'test_case_tags', sql: `DELETE FROM test_case_tags WHERE id LIKE ${D_} OR test_case_id IN (SELECT id FROM test_cases WHERE team_id LIKE ${D_})` },
  { table: 'flaky_tests', sql: `DELETE FROM flaky_tests WHERE id LIKE ${D_} OR team_id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'test_executions', sql: `DELETE FROM test_executions WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'test_execution_runs', sql: `DELETE FROM test_execution_runs WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'test_cases', sql: `DELETE FROM test_cases WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'team_test_executions', sql: `DELETE FROM team_test_executions WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'pipeline_runs', sql: `DELETE FROM pipeline_runs WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'pipeline_execution_summary', sql: `DELETE FROM pipeline_execution_summary WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'pipeline_stage_history', sql: `DELETE FROM pipeline_stage_history WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'pipeline_stages', sql: `DELETE FROM pipeline_stages WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'team_pipeline_metrics', sql: `DELETE FROM team_pipeline_metrics WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'pipeline_config', sql: `DELETE FROM pipeline_config WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'performance_metrics', sql: `DELETE FROM performance_metrics WHERE id LIKE ${D_} OR team_id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'technical_debt', sql: `DELETE FROM technical_debt WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'developer_productivity_snapshots', sql: `DELETE FROM developer_productivity_snapshots WHERE developer_id LIKE ${D_}` },
  { table: 'developer_metrics', sql: `DELETE FROM developer_metrics WHERE id LIKE ${D_} OR team_id LIKE ${D_} OR developer_id LIKE ${D_}` },
  { table: 'kpi_snapshots', sql: `DELETE FROM kpi_snapshots WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'sprint_velocity', sql: `DELETE FROM sprint_velocity WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'team_analytics', sql: `DELETE FROM team_analytics WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'metric_last_updated', sql: `DELETE FROM metric_last_updated WHERE id LIKE ${D_} OR company_id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'metric_update_intervals', sql: `DELETE FROM metric_update_intervals WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'business_impact_correlations', sql: `DELETE FROM business_impact_correlations WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'business_impact_data_status', sql: `DELETE FROM business_impact_data_status WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'business_impact_quality_metrics', sql: `DELETE FROM business_impact_quality_metrics WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'business_impact_business_kpis', sql: `DELETE FROM business_impact_business_kpis WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'business_impact_context', sql: `DELETE FROM business_impact_context WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'business_impact_history', sql: `DELETE FROM business_impact_history WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'business_impact_config', sql: `DELETE FROM business_impact_config WHERE id LIKE ${D_} OR team_id LIKE ${D_}` },
  { table: 'business_impact_metrics', sql: `DELETE FROM business_impact_metrics WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'business_metrics', sql: `DELETE FROM business_metrics WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'company_kpi_snapshots', sql: `DELETE FROM company_kpi_snapshots WHERE company_id LIKE ${D_}` },
  { table: 'configs', sql: `DELETE FROM configs WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'api_keys', sql: `DELETE FROM api_keys WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'seeder_runs', sql: `DELETE FROM seeder_runs WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'departments (manager_id)', sql: `UPDATE departments SET manager_id = NULL WHERE company_id LIKE ${D_} AND manager_id IS NOT NULL` },
  { table: 'teams (lead_id)', sql: `UPDATE teams SET lead_id = NULL WHERE company_id LIKE ${D_} AND lead_id IS NOT NULL` },
  { table: 'users', sql: `DELETE FROM users WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'teams', sql: `DELETE FROM teams WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'departments', sql: `DELETE FROM departments WHERE id LIKE ${D_} OR company_id LIKE ${D_}` },
  { table: 'companies', sql: `DELETE FROM companies WHERE id LIKE ${D_}` },
];

/** All application tables (for the per-table row count report). */
export const ALL_TABLES = [
  'api_keys', 'business_impact_business_kpis', 'business_impact_config', 'business_impact_context', 'business_impact_correlations',
  'business_impact_data_status', 'business_impact_history', 'business_impact_metrics', 'business_impact_quality_metrics', 'business_metrics',
  'companies', 'company_kpi_snapshots', 'configs', 'departments', 'developer_metrics', 'developer_productivity_snapshots', 'flaky_tests',
  'kpi_snapshots', 'metric_last_updated', 'metric_update_intervals', 'performance_metrics', 'pipeline_config', 'pipeline_execution_summary',
  'pipeline_runs', 'pipeline_stage_history', 'pipeline_stages', 'seeder_runs', 'sprint_velocity', 'team_analytics', 'team_members',
  'team_pipeline_metrics', 'team_test_executions', 'teams', 'technical_debt', 'test_case_tags', 'test_cases', 'test_execution_runs',
  'test_executions', 'users',
];

/** SQL condition selecting the demo rows of a table (for counts). */
export function demoRowCondition(table: string): string {
  switch (table) {
    case 'company_kpi_snapshots': return `company_id LIKE ${D_}`;
    case 'developer_productivity_snapshots': return `developer_id LIKE ${D_}`;
    case 'team_members': return `user_id LIKE ${D_}`;
    default: return `id LIKE ${D_}`;
  }
}
