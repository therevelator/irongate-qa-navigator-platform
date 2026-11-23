import React from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { REVENUE_MIN_PAIRED_MONTHS, REVENUE_OVERLAP_R } from '../../server/lib/revenueImpact';

/**
 * "How this works" on Business impact: what goes in, how the correlations and the money figures
 * are calculated, which inputs are assumptions the company sets, what the confidence labels mean
 * and what the page does not claim. Kept in step with docs/metrics_and_calculations.md (Business impact) and the
 * code it describes (server/routes/analytics.ts computeCorrelationMatrix, server/lib/revenueImpact.ts).
 */
const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</h3>
);

const BusinessImpactHowItWorks: React.FC = () => (
  <details className="group mb-6 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" data-testid="bi-how-it-works">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-white [&::-webkit-details-marker]:hidden">
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400" aria-hidden="true" />
      <Info className="h-4 w-4 flex-shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
      How this works
      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">what goes in, how the figures are calculated, what they do not claim</span>
    </summary>
    <div className="grid grid-cols-1 gap-5 border-t border-slate-200 px-5 py-4 text-sm leading-relaxed text-slate-700 md:grid-cols-2 dark:border-slate-800 dark:text-slate-300" data-testid="bi-how-it-works-body">
      <section>
        <H>1. What goes in</H>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Quality metrics</strong>, one value per team and month: test coverage, defect density, defect escape rate, MTTR, deployment frequency (per month), lead time, code quality, change failure rate. Entered in <em>Data entry</em>; for sample data, the month's average of the team's daily KPI values (the values Team detail shows, calculated from CI data where it is connected).</li>
          <li><strong>Business KPIs</strong>, entered by the company (finance and product data, not measured by QE Navigator): monthly revenue, active users, churn, feature adoption, NPS, CSAT, support tickets.</li>
          <li><strong>Context</strong>: downtime minutes and incidents per month; the open technical-debt items with their impact; the KPI targets valid today (team, else department, else company, else default).</li>
          <li><strong>Assumptions the company sets</strong> (Parameters → Financial and ROI settings): developer hourly rate, support ticket cost, downtime cost per minute, revenue per user, SLA breach penalty. A built-in default is marked <em>Default rates</em>.</li>
        </ul>
      </section>
      <section>
        <H>2. How the links are found</H>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Correlations</strong> (Details): every quality metric is paired with every business KPI over the months where both have a value, in the same month (no lag). Pearson r, a two-sided Student t-test (df = n − 2), then the Benjamini–Hochberg false-discovery correction over all pairs tested for the team; a pair is <em>significant</em> when q &lt; 0.05. At least {REVENUE_MIN_PAIRED_MONTHS} paired months; a series that never changed is skipped. Recalculated from the stored months on every visit.</li>
          <li><strong>Revenue per metric</strong>: the straight-line slope of monthly revenue on the metric over the team's months (least squares, 95% interval, significant when p &lt; 0.05, not corrected: exploratory). When the team's own months are inconclusive (for example quality barely changed), the <em>company-wide</em> slope is used if it is significant: all teams fitted together, each against its own averages, then scaled to this team's average revenue. Sample and recorded months are never mixed.</li>
        </ul>
      </section>
      <section>
        <H>3. How the money figures are derived</H>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Quality below target</strong> = revenue slope × gap between the latest month and the target, for metrics with a significant slope; metrics that move together (|r| ≥ {REVENUE_OVERLAP_R}) are counted once.</li>
          <li><strong>Open technical debt</strong> = per open item: tickets × ticket cost + downtime minutes × cost per minute + affected users × revenue per user × revenue impact % + SLA breaches × penalty.</li>
          <li><strong>Downtime</strong> = latest month's downtime minutes × cost per minute; <strong>support</strong> = tickets × ticket cost; <strong>churn</strong> = churn % × that month's revenue.</li>
          <li>Per year = per month × 12. The causes overlap, so they are listed, not added up. <strong>What-if</strong> = slope × the change you enter, with the same 95% range.</li>
        </ul>
      </section>
      <section>
        <H>4. Confidence labels and limits</H>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Strong evidence</strong>: the team's own slope has p &lt; 0.01. <strong>Some evidence</strong>: p &lt; 0.05. <strong>Company-wide evidence</strong>: the team's own months are inconclusive; the company-wide slope is significant. <strong>Cost estimate</strong>: arithmetic on entered impact and your rates, no statistics.</li>
          <li className="text-amber-800 dark:text-amber-300"><strong>What this page does not claim</strong>: correlation is not causation. Figures are associations in the company's own history (revenue and quality can both follow growth, seasonality or a reorganisation), not forecasts and not a promise that fixing a metric brings the money back. Small samples (months) make every figure exploratory.</li>
        </ul>
      </section>
    </div>
  </details>
);

export default BusinessImpactHowItWorks;
