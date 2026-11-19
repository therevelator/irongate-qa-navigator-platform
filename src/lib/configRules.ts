/**
 * Rules for the configuration values of Parameters → Performance SLA / Financial and ROI settings:
 * the ONE definition used by the page (ParametersConfiguration.tsx) and by the API
 * (POST /api/admin/configs, server/routes/admin.ts), so the server never stores a value the page
 * would refuse. Pure, no dependencies.
 *
 * Every value is a number of 0 or more up to a sensible maximum, or empty (= inherit from the
 * level above). Other (older) keys stored through the same endpoint keep their free-text value, but
 * the key must look like a key and the value must be short plain text.
 */
export interface ConfigRule { key: string; label: string; min: number; max: number }

export const CONFIG_RULES: readonly ConfigRule[] = [
  { key: 'sla_response_time_ms', label: 'P95 response time (ms)', min: 0, max: 600000 },
  { key: 'sla_error_rate_percent', label: 'Error rate threshold (%)', min: 0, max: 100 },
  { key: 'developer_hourly_rate', label: 'Developer hourly rate ($)', min: 0, max: 100000 },
  { key: 'support_ticket_cost', label: 'Support ticket cost ($)', min: 0, max: 1000000 },
  { key: 'revenue_per_user_monthly', label: 'Revenue per user per month ($)', min: 0, max: 1000000 },
  { key: 'downtime_cost_per_minute', label: 'Downtime cost per minute ($)', min: 0, max: 10000000 },
  { key: 'sla_breach_penalty', label: 'SLA breach penalty ($)', min: 0, max: 100000000 },
];

const BY_KEY = new Map(CONFIG_RULES.map((r) => [r.key, r]));
export const configRuleFor = (key: string): ConfigRule | undefined => BY_KEY.get(key);

export const CONFIG_KEY_RE = /^[a-z][a-z0-9_.-]{0,99}$/;
export const CONFIG_TEXT_MAX = 2000;

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Why a value cannot be stored for this key, as a sentence (null when it is fine). Empty / null
 * means "inherit" and is always fine.
 */
export function configValueProblem(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const rule = configRuleFor(key);
  if (rule) {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    const n = text === '' ? NaN : Number(text);
    if (!Number.isFinite(n) || n < rule.min) return `${rule.label}: enter a number of ${fmt(rule.min)} or more, or leave it empty to inherit.`;
    if (n > rule.max) return `${rule.label}: enter a number from ${fmt(rule.min)} to ${fmt(rule.max)}, or leave it empty to inherit.`;
    return null;
  }
  if (!CONFIG_KEY_RE.test(key)) return `"${key.slice(0, 40)}" is not a valid setting name.`;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return `The value of ${key} must be text or a number.`;
  if (String(value).length > CONFIG_TEXT_MAX) return `The value of ${key} is too long (at most ${fmt(CONFIG_TEXT_MAX)} characters).`;
  return null;
}
