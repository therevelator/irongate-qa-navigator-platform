/**
 * Business impact → Details → Summary: a plain-language summary of the correlation matrix written
 * by fixed rules (no AI provider), so the panel is never empty. The AI summary (Groq) replaces it
 * when the provider is configured and answers; when it is not, or fails, this text is returned.
 * Output is simple HTML (h3, p, ul, li, strong); the page sanitises it like the AI text.
 */
import { studentTQuantile } from './stats';

export interface SummaryCorrelation {
  quality_metric: string;
  business_kpi: string;
  pearson_correlation: number;
  p_value: number;
  q_value: number;
  sample_size: number;
  is_significant: boolean;
}

export const BI_METRIC_LABELS: Record<string, string> = {
  test_coverage: 'test coverage', defect_density: 'defect density', defect_escape_rate: 'defect escape rate', mttr_hours: 'MTTR',
  deployment_frequency: 'deployment frequency', lead_time_days: 'lead time', code_quality_score: 'code quality', change_failure_rate: 'change failure rate',
  monthly_revenue: 'monthly revenue', active_users: 'active users', churn_rate: 'churn', feature_adoption_rate: 'feature adoption',
  nps_score: 'NPS', csat_score: 'CSAT', support_ticket_volume: 'support tickets',
};
const label = (k: string) => BI_METRIC_LABELS[k] ?? k.replace(/_/g, ' ');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fr = (r: number) => `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`;
const fp = (p: number) => (p < 0.001 ? '< 0.001' : `= ${p.toFixed(3)}`);
const ym = (m: string | null | undefined) => {
  if (!m) return '—';
  const [y, mo] = m.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1] ?? mo} ${y}`;
};

/** Smallest |r| that reaches p < 0.05 (two-sided) on its own with n months. */
export function criticalR(n: number, alpha = 0.05): number | null {
  if (n < 3) return null;
  const t = studentTQuantile(alpha, n - 2);
  return t / Math.sqrt(n - 2 + t * t);
}

const sentence = (c: SummaryCorrelation) => {
  const a = label(c.quality_metric), b = label(c.business_kpi);
  const how = c.pearson_correlation > 0 ? `months with higher ${a} tended to have higher ${b}` : `months with higher ${a} tended to have lower ${b}`;
  return `<strong>${esc(a[0].toUpperCase() + a.slice(1))} and ${esc(b)}</strong>: ${esc(how)} (r ${fr(c.pearson_correlation)}, q ${fp(c.q_value)}, ${c.sample_size} months).`;
};

export function correlationSummaryHtml(input: { correlations: SummaryCorrelation[]; pairedMonths: string[]; teamName?: string | null }): string {
  const { correlations, pairedMonths } = input;
  const n = pairedMonths.length;
  if (!correlations.length) {
    return `<p>No correlations yet: they need at least 6 months with both a quality metric and a business KPI recorded (${n} so far).</p>`;
  }
  const sorted = [...correlations].sort((x, y) => Math.abs(y.pearson_correlation) - Math.abs(x.pearson_correlation));
  const sig = sorted.filter(c => c.is_significant);
  const share = sig.length / correlations.length;
  const crit = criticalR(n);
  const out: string[] = [];
  out.push('<h3>In short</h3>');
  out.push(`<p>${n} months with both quality and business data (${ym(pairedMonths[0])} to ${ym(pairedMonths[n - 1])}); ${correlations.length} metric pairs tested; ` +
    `<strong>${sig.length}</strong> significant after the false-discovery correction (q &lt; 0.05).</p>`);
  if (sig.length) {
    out.push('<h3>Strongest reliable links</h3><ul>');
    for (const c of sig.slice(0, 5)) out.push(`<li>${sentence(c)}</li>`);
    out.push('</ul>');
    if (share >= 0.5) {
      out.push(`<p>${Math.round(share * 100)}% of all pairs are significant. When almost everything moves together, the likely reason is one shared movement over the year ` +
        '(quality and business results changed at the same time), not many separate effects. Read the pairs as one story, not as independent levers.</p>');
    }
  } else {
    const top = sorted[0];
    out.push('<h3>No reliable link yet</h3>');
    out.push(`<p>No pair is significant after the correction. The strongest is ${esc(label(top.quality_metric))} and ${esc(label(top.business_kpi))} ` +
      `(r ${fr(top.pearson_correlation)}, p ${fp(top.p_value)}, q ${fp(top.q_value)}).` +
      (crit !== null ? ` With ${n} months a single pair needs |r| of about ${crit.toFixed(2)} or more just to reach p &lt; 0.05, and more after testing ${correlations.length} pairs at once.` : '') +
      ' This usually means quality barely changed over these months (a steady team), so there is nothing for revenue or customers to move with.</p>');
  }
  out.push('<h3>What this does not say</h3>');
  out.push('<ul><li>Correlation is not causation: these are months that moved together, not proof that one metric drives the other.</li>' +
    '<li>Monthly series that share a trend (growth, seasonality, a reorganisation) can correlate without any direct link.</li>' +
    `<li>${n} months is a small sample: treat the results as leads to investigate, not as forecasts.</li></ul>`);
  return out.join('\n');
}
