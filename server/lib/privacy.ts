/**
 * Privacy rules for aggregates of individual data (k-anonymity). The ONE definition used by
 * every endpoint that returns an average, count or distribution built from individual
 * developers' data (team / company averages of developer metrics, DDPS team statistics,
 * workload balance, burnout and status counts) and by the wellbeing pulse survey results.
 *
 *   An aggregate is shown only when at least K_ANONYMITY_MIN (3) people contribute to it.
 *   Otherwise the API returns no value (null) with suppressed: true and SUPPRESSED_TEXT, and
 *   does not say how many people there were.
 *
 *   Developer metrics: only active developers who opted in to developer insights
 *   (users.developer_insights_enabled = TRUE) contribute to an aggregate. Someone who has not
 *   opted in (or opted out again) is left out of every aggregate, also the ones they can see.
 *   Individual rows keep the existing rules (server/lib/userPolicy.ts canViewDeveloperRow).
 *
 *   Company figures are built only from groups (teams) that themselves reach the threshold, so a
 *   company value minus the visible team values can never reveal a suppressed team.
 *
 * Pure functions, no DB (the SQL fragment is a string).
 */

/** Smallest number of contributors an aggregate of individual data may be shown for. */
export const K_ANONYMITY_MIN = 3;

/** What the UI shows instead of a suppressed aggregate. */
export const SUPPRESSED_TEXT = `Not shown: fewer than ${K_ANONYMITY_MIN} contributors`;

/** One sentence for formula mode / metric explanations. */
export const K_ANONYMITY_RULE =
  `Aggregates of individual data are shown only when at least ${K_ANONYMITY_MIN} people contribute ` +
  '(developers who opted in to developer insights; survey respondents). Otherwise they are not shown, ' +
  'and the number of contributors is not revealed.';

export interface PrivacyInfo {
  /** true when the aggregate is withheld because too few people contribute. */
  suppressed: boolean;
  /** Contributors when shown; null when suppressed (the count is not revealed). */
  contributors: number | null;
  /** SUPPRESSED_TEXT when suppressed. */
  reason: string | null;
  /** The threshold (3). */
  minContributors: number;
}

/** Is an aggregate over `contributors` people allowed? */
export function meetsKAnonymity(contributors: number, min = K_ANONYMITY_MIN): boolean {
  return Number.isFinite(contributors) && contributors >= min;
}

/** Privacy info for an aggregate over `contributors` people. */
export function privacyInfo(contributors: number, min = K_ANONYMITY_MIN): PrivacyInfo {
  const ok = meetsKAnonymity(contributors, min);
  return { suppressed: !ok, contributors: ok ? contributors : null, reason: ok ? null : SUPPRESSED_TEXT, minContributors: min };
}

/** The value when enough people contribute, else null. */
export function kAnonymous<T>(value: T | null | undefined, contributors: number, min = K_ANONYMITY_MIN): T | null {
  return meetsKAnonymity(contributors, min) ? (value ?? null) : null;
}

/** Apply kAnonymous to every value of an object (one contributor count for all of them). */
export function kAnonymousAll<T extends Record<string, unknown>>(values: T, contributors: number, min = K_ANONYMITY_MIN): { [K in keyof T]: T[K] | null } {
  const ok = meetsKAnonymity(contributors, min);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) out[k] = ok ? (v ?? null) : null;
  return out as { [K in keyof T]: T[K] | null };
}

/**
 * SQL condition: user `<alias>` contributes to aggregates of developer data (active and opted
 * in to developer insights).
 */
export const optedInDeveloperSql = (alias = 'u') =>
  `(${alias}.is_active = TRUE AND ${alias}.developer_insights_enabled = TRUE)`;
