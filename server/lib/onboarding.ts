/**
 * Onboarding checklist of a new organisation (GET /api/onboarding, dashboard
 * src/components/OnboardingChecklist.tsx). Progress is never stored: each step is computed from
 * the organisation's real state every time.
 *
 *   departments  at least one active department
 *   teams        at least one active team
 *   people       someone besides the administrators: another active user, or an invitation
 *                that is open or accepted
 *   targets      a KPI target set by a person (target_history row with changed_by; the built-in
 *                defaults copied in by the migration do not count), or the company-wide KPI
 *                targets or settings saved by a person in Parameters (audit_log: targets.* /
 *                config.* at company level, also when saved unchanged = confirmed)
 *   data         a first KPI value received through an API key or manual metrics (an accepted or
 *                partial ingestion log entry, or a stored value whose source is not generated
 *                sample data)
 *
 * The checklist shows on the dashboard of super_admins while any step is open, until one of
 * them hides it (onboarding_state.dismissed_at; it can be shown again). When every step is done
 * it is hidden for good (onboarding_state.completed_at is stored), even if a step later reads as open.
 */
import { queryOne } from '../../src/lib/db';

export type OnboardingStepKey = 'departments' | 'teams' | 'people' | 'targets' | 'collection' | 'data';

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  description: string;
  done: boolean;
  /** What was found (e.g. 3 departments); 0 when the step is open. */
  count: number;
  /** App view that completes the step. */
  view: string;
  actionLabel: string;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  complete: boolean;
  dismissed: boolean;
  dismissedAt: string | null;
  /** When every step was first done; from then on the checklist is not shown again. */
  completedAt: string | null;
  /** Show on the dashboard: incomplete and not dismissed. */
  show: boolean;
}

const n = (r: { n?: unknown } | null) => Number(r?.n) || 0;

export async function onboardingStatus(companyId: string): Promise<OnboardingStatus> {
  const departments = n(await queryOne(`SELECT COUNT(*) AS n FROM departments WHERE company_id = ? AND is_active = TRUE`, [companyId]));
  const teams = n(await queryOne(`SELECT COUNT(*) AS n FROM teams WHERE company_id = ? AND is_active = TRUE`, [companyId]));
  const otherUsers = n(await queryOne(
    `SELECT COUNT(*) AS n FROM users u
      WHERE u.company_id = ? AND u.is_active = TRUE
        AND NOT EXISTS (SELECT 1 FROM role_assignments ra
                         WHERE ra.user_id = u.id AND ra.role = 'super_admin' AND ra.revoked_at IS NULL)`,
    [companyId]
  ));
  const invitations = n(await queryOne(
    `SELECT COUNT(*) AS n FROM invitations WHERE company_id = ? AND revoked_at IS NULL AND (accepted_at IS NOT NULL OR expires_at > now())`,
    [companyId]
  ));
  // KPI targets set by a person, or the company-wide targets / settings saved (confirmed) by a person.
  const targets = n(await queryOne(`SELECT COUNT(*) AS n FROM target_history WHERE company_id = ? AND changed_by IS NOT NULL`, [companyId]))
    + n(await queryOne(
      `SELECT COUNT(*) AS n FROM audit_log WHERE company_id = ? AND entity_type = 'config' AND entity_id = ? AND actor_id IS NOT NULL
          AND action IN ('targets.update', 'targets.confirm', 'targets.apply_all', 'config.update', 'config.confirm', 'config.apply_all')`,
      [companyId, companyId]
    ));
  const ingested = n(await queryOne(`SELECT COUNT(*) AS n FROM ingestion_log WHERE company_id = ? AND status IN ('accepted', 'partial')`, [companyId]));
  const realValues = n(await queryOne(
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM metric_values WHERE company_id = ? AND COALESCE(source, '') <> 'synthetic' LIMIT 1) x`,
    [companyId]
  ));
  // A team whose collection frequency was chosen (or confirmed as recommended) by a person.
  const scheduled = n(await queryOne<{ n: unknown }>(`SELECT COUNT(DISTINCT team_id) AS n FROM collection_schedules WHERE company_id = ?`, [companyId]).catch(() => null));
  const state = await queryOne<{ dismissed_at: string | null; completed_at: string | null }>(
    `SELECT dismissed_at, completed_at FROM onboarding_state WHERE company_id = ?`, [companyId]
  );

  const steps: OnboardingStep[] = [
    {
      key: 'departments', label: 'Create departments', done: departments > 0, count: departments, view: 'departments', actionLabel: 'Open Departments',
      description: 'Group your teams into departments so managers can look after theirs.',
    },
    {
      key: 'teams', label: 'Add teams', done: teams > 0, count: teams, view: 'teams', actionLabel: 'Open Teams',
      description: 'Every KPI, score and comparison is per team.',
    },
    {
      key: 'people', label: 'Invite people', done: otherUsers + invitations > 0, count: otherUsers + invitations, view: 'users', actionLabel: 'Invite people',
      description: 'Invite managers, team leads and software engineers; they get the access of their role.',
    },
    {
      key: 'targets', label: 'Set KPI targets', done: targets > 0, count: targets, view: 'parameters-config', actionLabel: 'Open Parameters',
      description: 'Until you set your own, teams are judged against the built-in default targets.',
    },
    {
      key: 'collection', label: 'Choose how often data is collected', done: scheduled > 0, count: scheduled, view: 'metric-intervals', actionLabel: 'Open Update frequency',
      description: 'Per team: say how often it releases and accept or change the recommended intervals. Until then every source is read every 15 minutes.',
    },
    {
      key: 'data', label: 'Send the first data', done: ingested + realValues > 0, count: ingested + realValues, view: 'admin-panel', actionLabel: 'Create an API key',
      description: 'Push KPIs with an API key (POST /api/ingest/kpis) or enter them in Manual metrics. Sample data does not count.',
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  const dismissed = !!state?.dismissed_at;
  let completedAt = state?.completed_at ?? null;
  // Once every step has been done the checklist is not shown again, even if a step later reads
  // as open (for example the only invitation expired): the first completion is stored.
  if (completed === steps.length && !completedAt) {
    const row = await queryOne<{ completed_at: string }>(
      `INSERT INTO onboarding_state (company_id, completed_at, updated_at) VALUES (?, now(), now())
       ON CONFLICT (company_id) DO UPDATE SET completed_at = COALESCE(onboarding_state.completed_at, now()), updated_at = now()
       RETURNING completed_at`,
      [companyId]
    );
    completedAt = row?.completed_at ?? null;
  }
  return {
    steps,
    completed,
    total: steps.length,
    complete: completed === steps.length,
    dismissed,
    dismissedAt: state?.dismissed_at ?? null,
    completedAt,
    show: completed < steps.length && !dismissed && !completedAt,
  };
}
