import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useHideSampleNotice } from '../contexts/AuthContext';
import { API_URL } from '../config/api';
import ExportCsvButton from './ExportCsvButton';
import MetricInfoTrigger from './MetricInfoTrigger';
import SampleDataBanner from './SampleDataBanner';
import { Badge, Card, CardHeader, EmptyState, SegmentedControl, StatTile, buttonClass, cx, inputClass, type Tone } from './ui';
import {
  whatIf, CONFIDENCE_TEXT, REVENUE_CAVEATS, REVENUE_POOLED_FORMULA, REVENUE_MIN_PAIRED_MONTHS, WHAT_IF_FORMULA, REVENUE_SENSITIVITY_FORMULA, REVENUE_ROLLUP_FORMULA,
  type CurrentValue, type DebtAtRisk, type FinancialParamUsed, type GainItem, type MoneyLine, type MoneySummary, type RevenueAtStake,
  type RevenueRollup, type RevenueSensitivity, type SimpleMonthlyFigure, type TargetToday, type TeamRevenueFigures,
} from '../../server/lib/revenueImpact';

/**
 * Revenue impact on Delivery → Business impact (formulas: server/lib/revenueImpact.ts; API:
 * GET /api/revenue-impact/teams/:teamId and /rollup). Plain-language money summary first; every
 * figure keeps its "How is this calculated?" detail one click away.
 */

export interface TeamRevenueData {
  teamId: string;
  teamName: string;
  sampleData: boolean;
  months: { paired: number; withRevenue: number; first: string | null; last: string | null; source: 'measured' | 'sample' | null; excludedOtherSource: number };
  sensitivities: RevenueSensitivity[];
  current: Record<string, CurrentValue | null>;
  targets: Record<string, TargetToday | null>;
  stake: RevenueAtStake;
  debt: DebtAtRisk;
  incidents: SimpleMonthlyFigure;
  churn: SimpleMonthlyFigure;
  support: SimpleMonthlyFigure;
  summary: MoneySummary;
  financialParameters: FinancialParamUsed[];
  latestRevenue: { month: string; value: number } | null;
  calculatedAt: string;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** $850, $12.4k, $149k, $1.24M; null → "—". */
export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  let s: string;
  if (a >= 1e6) s = `$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  else if (a >= 1e5) s = `$${Math.round(a / 1e3)}k`;
  else if (a >= 1e3) s = `$${(a / 1e3).toFixed(1)}k`;
  else s = `$${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
}
const fmtRange = (lo: number | null, hi: number | null) => (lo === null || hi === null ? null : `${fmtMoney(lo)} to ${fmtMoney(hi)}`);
const fmtNum = (v: number | null | undefined, dp = 2) => (v === null || v === undefined ? '—' : Number(v.toFixed(dp)).toString());
/** Payback: days under a month, else months with one decimal. */
const fmtPayback = (m: number | null) => (m === null ? '—' : m < 1 ? `${Math.max(1, Math.round(m * 30))} day${Math.round(m * 30) <= 1 ? '' : 's'}` : `${fmtNum(m, 1)} months`);
const fmtP = (p: number | null) => (p === null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (ym: string | null) => {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

const CONFIDENCE_TONE: Record<GainItem['confidence'], Tone> = { strong: 'good', some: 'brand', company: 'brand', estimate: 'neutral' };
const CONFIDENCE_SHORT: Record<GainItem['confidence'], string> = { strong: 'Strong evidence', some: 'Some evidence', company: 'Company-wide evidence', estimate: 'Cost estimate' };

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** "How this was calculated" disclosure (native details/summary: keyboard and screen-reader friendly). */
export const HowCalculated: React.FC<{ children: React.ReactNode; label?: string; className?: string; testId?: string }> = ({ children, label = 'How this was calculated', className, testId }) => (
  <details className={cx('group mt-1.5', className)} data-testid={testId}>
    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-brand-300 [&::-webkit-details-marker]:hidden">
      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" aria-hidden="true" />
      {label}
    </summary>
    <div className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300">{children}</div>
  </details>
);

/** A collapsed section (secondary content). */
export const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; testId?: string; defaultOpen?: boolean }> = ({ title, subtitle, children, testId, defaultOpen }) => (
  <details className="group rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" data-testid={testId} open={defaultOpen}>
    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
        {subtitle && <span className="block text-xs text-slate-500 dark:text-slate-400">{subtitle}</span>}
      </span>
    </summary>
    <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">{children}</div>
  </details>
);

const Params: React.FC<{ params: FinancialParamUsed[] }> = ({ params }) =>
  params.length ? (
    <p>
      Rates (Parameters → Financial and ROI settings):{' '}
      {params.map((p, i) => (
        <span key={p.key}>
          {i > 0 && ', '}
          {p.label} {fmtMoney(p.value)}{p.isDefault && <span className="font-medium text-amber-700 dark:text-amber-400"> (default)</span>}
        </span>
      ))}
      .
    </p>
  ) : null;

const Amount: React.FC<{ monthly: number | null; annual: number | null; low?: number | null; high?: number | null; reason?: string | null; testId?: string; className?: string }> = ({ monthly, annual, low = null, high = null, reason, testId, className }) => (
  <div className={cx('flex-shrink-0 sm:text-right', className)} data-testid={testId}>
    {monthly === null ? (
      <>
        <p className="text-base font-semibold tabular-nums text-slate-500 dark:text-slate-400">—</p>
        {reason && <p className="max-w-[16rem] text-xs text-slate-500 dark:text-slate-400">{reason}</p>}
      </>
    ) : (
      <>
        <p className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">
          {fmtMoney(monthly)}<span className="text-xs font-normal text-slate-500 dark:text-slate-400">/month</span>
        </p>
        <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmtMoney(annual)}/year</p>
        {fmtRange(low, high) && <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">range {fmtRange(low, high)}/month</p>}
      </>
    )}
  </div>
);

const ShowAll: React.FC<{ total: number; shown: number; open: boolean; onToggle: () => void; what: string }> = ({ total, shown, open, onToggle, what }) =>
  total > shown || open ? (
    <button type="button" onClick={onToggle} className={cx(buttonClass.secondary, 'mt-3 h-8 text-xs')} aria-expanded={open}>
      {open ? 'Show fewer' : `Show all ${total} ${what}`}
    </button>
  ) : null;

const LIMIT = 5;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export function useRevenueImpact(teamId: string | null, reloadKey: unknown) {
  const [data, setData] = useState<TeamRevenueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/revenue-impact/teams/${encodeURIComponent(teamId)}`, { credentials: 'include' })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) { setData(null); setError(body?.error || 'Failed to load the revenue impact'); return; }
        setData(body);
      })
      .catch(() => { if (!cancelled) { setData(null); setError('Failed to load the revenue impact'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [teamId, reloadKey]);
  return { data, loading, error };
}

const Loading: React.FC<{ what: string }> = ({ what }) => (
  <Card>
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading {what}…
    </div>
  </Card>
);

const sensitivityOf = (d: TeamRevenueData, metric: string) => d.sensitivities.find((s) => s.metric === metric) ?? null;

const pText = (p: number | null) => ((p ?? 1) < 0.001 ? '< 0.001' : `= ${fmtP(p)}`);

const SensitivityFacts: React.FC<{ s: RevenueSensitivity }> = ({ s }) =>
  s.status === 'fitted' && s.basis === 'company' && s.pooled ? (
    <>
      <p>
        This team's own months ({s.own?.n ?? s.n}, {fmtMonth(s.firstMonth)} to {fmtMonth(s.lastMonth)}): {s.own?.slope == null
          ? `the metric did not change (${fmtNum(s.own?.minX)}), so no slope`
          : `${fmtMoney(s.own.slope)}/month per +1 ${s.unit}, r = ${fmtNum(s.own.r, 3)}, p ${pText(s.own.pValue)} (not significant; the metric moved only between ${fmtNum(s.own.minX)} and ${fmtNum(s.own.maxX)})`}.
      </p>
      <p>
        Company-wide (within each team, {s.pooled.teams} teams, {s.pooled.n} months): monthly revenue changes by{' '}
        <span className="font-medium tabular-nums">{fmtNum(s.pooled.share * 100, 2)}%</span> per +1 {s.unit} (95% range {fmtNum(s.pooled.shareLow * 100, 2)}% to {fmtNum(s.pooled.shareHigh * 100, 2)}%),
        r = {fmtNum(s.pooled.r, 3)}, p {pText(s.pooled.pValue)}. For this team: × its average monthly revenue ={' '}
        <span className="font-medium tabular-nums">{fmtMoney(s.slope)}/month</span> (95% range {fmtMoney(s.ciLow)} to {fmtMoney(s.ciHigh)}).
      </p>
      <p>{REVENUE_POOLED_FORMULA}</p>
    </>
  ) : s.status === 'fitted' ? (
    <p>
      Revenue per +1 {s.unit}: <span className="font-medium tabular-nums">{fmtMoney(s.slope)}/month</span> (95% range {fmtMoney(s.ciLow)} to {fmtMoney(s.ciHigh)});{' '}
      n = {s.n} months ({fmtMonth(s.firstMonth)} to {fmtMonth(s.lastMonth)}), r = {fmtNum(s.r, 3)}, R² = {fmtNum(s.r2, 3)}, p {pText(s.pValue)}
      {s.significant ? '' : ' (not significant)'}.
    </p>
  ) : (
    <p>{s.reason}</p>
  );

// ---------------------------------------------------------------------------
// Money tab
// ---------------------------------------------------------------------------

const LineDetail: React.FC<{ line: MoneyLine; data: TeamRevenueData }> = ({ line, data }) => {
  const fig = line.key === 'downtime' ? data.incidents : line.key === 'support' ? data.support : line.key === 'churn' ? data.churn : null;
  return (
    <HowCalculated>
      <p>{line.formula}</p>
      {line.key === 'debt' && data.debt.components && (
        <p>
          {data.debt.itemsWithImpact} of {data.debt.openItems} open items have impact data. Lost users' revenue {fmtMoney(data.debt.components.revenueLoss)}, support{' '}
          {fmtMoney(data.debt.components.support)}, downtime {fmtMoney(data.debt.components.downtime)}, SLA penalties {fmtMoney(data.debt.components.sla)} a month.
        </p>
      )}
      {line.key === 'debt' && <Params params={data.debt.parameters} />}
      {fig && fig.month && (
        <p>
          Month used: {fmtMonth(fig.month)}. Inputs:{' '}
          {Object.entries(fig.inputs).filter(([, v]) => v !== null).map(([k, v]) => `${k.replace(/_/g, ' ')} ${k.includes('revenue') ? fmtMoney(v as number) : k.endsWith('rate') ? `${fmtNum(v as number)}%` : fmtNum(v as number)}`).join(', ')}.
        </p>
      )}
      {fig && <Params params={fig.parameters} />}
      {line.key === 'quality_gaps' && (
        <>
          {data.stake.rows.filter((r) => r.included).length === 0 && (
            <p>
              {data.stake.rows.filter((r) => r.targetMet === true).length} of {data.stake.rows.filter((r) => r.target).length} metrics with a target are at or better than it.{' '}
              {data.stake.rows.filter((r) => r.targetMet === false).map((r) => `${r.label}: ${fmtNum(r.current?.value)} vs target ${fmtNum(r.target?.good)} (${r.reason ?? 'not counted'})`).join('; ')}
            </p>
          )}
          {data.stake.rows.some((r) => r.included && r.gap === 0) && (
            <p>At or better than target (adds $0): {data.stake.rows.filter((r) => r.included && r.gap === 0).map((r) => `${r.label} ${fmtNum(r.current?.value)} vs ${fmtNum(r.target?.good)}`).join(', ')}.</p>
          )}
          {data.stake.rows.filter((r) => r.included && r.gap !== 0).map((r) => {
            const s = sensitivityOf(data, r.metric);
            return (
              <p key={r.metric}>
                {r.label}: {fmtNum(r.current?.value)} now ({fmtMonth(r.current?.month ?? null)}), target {fmtNum(r.target?.good)} ({r.target?.scope} target valid today) →{' '}
                {fmtMoney(r.monthly)}/month{s?.pValue !== null && s?.pValue !== undefined ? `, p ${pText(s.pValue)}` : ''}{s?.basis === 'company' ? ' (company-wide link)' : ''}.
              </p>
            );
          })}
          {REVENUE_CAVEATS.map((c) => <p key={c} className="text-amber-700 dark:text-amber-400">{c}</p>)}
        </>
      )}
    </HowCalculated>
  );
};

const GainDetail: React.FC<{ g: GainItem; data: TeamRevenueData }> = ({ g, data }) => {
  const metric = g.kind === 'quality' ? g.id.slice('quality:'.length) : null;
  const s = metric ? sensitivityOf(data, metric) : null;
  return (
    <HowCalculated>
      <p>{g.formula}</p>
      {s && <SensitivityFacts s={s} />}
      {g.movesWith.length > 0 && <p>Moves together with {g.movesWith.join(', ')} (|r| ≥ 0.7): reaching this target is the same movement, so they are not added again.</p>}
      {g.fixCost !== null && (
        <p>
          Fix cost = effort hours × developer hourly rate = {fmtMoney(g.fixCost)}; return = yearly gain ÷ fix cost = {fmtNum(g.returnPerDollar, (g.returnPerDollar ?? 0) >= 10 ? 0 : 1)}; pays back in{' '}
          {fmtPayback(g.paybackMonths)}.
        </p>
      )}
      {g.kind !== 'quality' && <Params params={data.financialParameters.filter((p) => g.kind === 'downtime' ? p.key === 'downtime_cost_per_minute' : true)} />}
      <p>How sure are we? {CONFIDENCE_TEXT[g.confidence]}.</p>
    </HowCalculated>
  );
};

export const RevenueMoneyView: React.FC<{ data: TeamRevenueData; showFormulas: boolean }> = ({ data, showFormulas }) => {
  const [allGains, setAllGains] = useState(false);
  const [allFixes, setAllFixes] = useState(false);
  const [order, setOrder] = useState<'gain' | 'return'>('gain');
  const { summary } = data;
  const byId = useMemo(() => new Map(summary.gains.map((g) => [g.id, g])), [summary.gains]);
  const gains = allGains ? summary.gains : summary.gains.slice(0, LIMIT);
  const fixIds = order === 'gain' ? summary.priorities.byGain : summary.priorities.byReturn;
  const fixes = (allFixes ? fixIds : fixIds.slice(0, LIMIT)).map((id) => byId.get(id)!).filter(Boolean);

  const basis = data.months.paired
    ? `Based on ${data.months.paired} months (${fmtMonth(data.months.first)} to ${fmtMonth(data.months.last)}) of ${data.months.source === 'sample' ? 'sample' : 'recorded'} data.`
    : 'No months with both quality metrics and business KPIs yet.';

  return (
    <div className="space-y-6" data-testid="revenue-money">
      <SampleDataBanner show={data.sampleData} />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {basis} Amounts per month and per year (month × 12). Quality figures are associations in the team's own history, not causes.
      </p>

      <MetricInfoTrigger enabled={showFormulas} metricKey="revenue_at_risk" variant="section" teamId={data.teamId}>
        <Card>
          <CardHeader title="Where the money is going now" subtitle={summary.text.goingNow} />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="money-going-now">
            {summary.goingNow.map((line) => (
              <li key={line.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{line.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{line.sentence}</p>
                  <LineDetail line={line} data={data} />
                </div>
                <Amount monthly={line.monthly} annual={line.annual} low={line.monthlyLow} high={line.monthlyHigh} reason={line.reason} testId={`going-now-${line.key}`} />
              </li>
            ))}
          </ul>
        </Card>
      </MetricInfoTrigger>

      <MetricInfoTrigger enabled={showFormulas} metricKey="revenue_at_stake" variant="section" teamId={data.teamId}>
        <Card>
          <CardHeader title="What you gain when these are fixed" subtitle={summary.text.gains} />
          {summary.gains.length === 0 ? (
            <EmptyState
              title="No gain can be shown yet"
              description={data.stake.reason ?? 'No issue with a cost or a significant revenue association is below its target.'}
            />
          ) : (
            <>
              <ol className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="money-gains">
                {gains.map((g, i) => (
                  <li key={g.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 w-5 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                          {g.label}
                          <Badge tone={CONFIDENCE_TONE[g.confidence]}>{CONFIDENCE_SHORT[g.confidence]}</Badge>
                          {g.usesDefaults && <Badge tone="warn">Default rates</Badge>}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {g.sentence}
                          {g.movesWith.length > 0 && ` Moves together with ${g.movesWith.length === 1 ? g.movesWith[0].toLowerCase() : `${g.movesWith.length} other metrics`}, counted once.`}
                        </p>
                        <GainDetail g={g} data={data} />
                      </div>
                    </div>
                    <Amount monthly={g.monthly} annual={g.annual} low={g.monthlyLow} high={g.monthlyHigh} className="pl-8 sm:pl-0" />
                  </li>
                ))}
              </ol>
              <ShowAll total={summary.gains.length} shown={LIMIT} open={allGains} onToggle={() => setAllGains((v) => !v)} what="gains" />
              {summary.gainsLeftOut.length > 0 && (
                <HowCalculated label={`${summary.gainsLeftOut.length} target${summary.gainsLeftOut.length === 1 ? '' : 's'} not counted as a gain`}>
                  {summary.gainsLeftOut.map((o) => <p key={o.label}>{o.label}: {o.reason}</p>)}
                </HowCalculated>
              )}
            </>
          )}
        </Card>
      </MetricInfoTrigger>

      <Card>
        <CardHeader title="Where to put the money first" subtitle={summary.text.priorities} />
        {summary.priorities.byReturn.length > 0 && (
          <div className="-mt-1 mb-3">
            <SegmentedControl
              value={order}
              onChange={setOrder}
              options={[{ value: 'gain', label: 'Biggest gain' }, { value: 'return', label: 'Best return on cost' }]}
            />
          </div>
        )}
        {fixes.length === 0 ? (
          <EmptyState title="Nothing to rank yet" description="Fixes appear here once an issue has a monthly gain (see above)." />
        ) : (
          <>
            <ol className="space-y-2" data-testid="money-priorities">
              {fixes.map((g, i) => (
                <li key={g.id} className="flex flex-col gap-1 rounded-md border border-slate-200 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-slate-800">
                  <span className="min-w-0 text-slate-900 dark:text-white">
                    <span className="mr-2 font-semibold tabular-nums text-slate-500 dark:text-slate-400">{i + 1}.</span>
                    {g.label}
                  </span>
                  <span className="flex-shrink-0 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-900 dark:text-white">+{fmtMoney(g.monthly)}/month</span>
                    {g.fixCost !== null
                      ? ` · costs ${fmtMoney(g.fixCost)} · returns ${fmtNum(g.returnPerDollar, (g.returnPerDollar ?? 0) >= 10 ? 0 : 1)}× a year · pays back in ${fmtPayback(g.paybackMonths)}`
                      : ' · fix cost not estimated'}
                  </span>
                </li>
              ))}
            </ol>
            <ShowAll total={fixIds.length} shown={LIMIT} open={allFixes} onToggle={() => setAllFixes((v) => !v)} what="fixes" />
          </>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// What-if tab
// ---------------------------------------------------------------------------

export const RevenueWhatIf: React.FC<{ data: TeamRevenueData; showFormulas: boolean }> = ({ data, showFormulas }) => {
  const fitted = data.sensitivities.filter((s) => s.status === 'fitted');
  const [metric, setMetric] = useState<string>(() => (data.sensitivities.find((s) => s.significant) ?? fitted[0] ?? data.sensitivities[0])?.metric ?? '');
  const [changeText, setChangeText] = useState('1');
  const s = data.sensitivities.find((x) => x.metric === metric) ?? null;
  const cur = data.current[metric] ?? null;
  const tgt = data.targets[metric] ?? null;
  const change = Number(changeText);
  const res = s ? whatIf(s, changeText === '' ? NaN : change, cur) : null;
  const toTarget = () => { if (cur && tgt) setChangeText(String(Number((tgt.good - cur.value).toFixed(2)))); };

  return (
    <MetricInfoTrigger enabled={showFormulas} metricKey="revenue_sensitivity" variant="section" teamId={data.teamId}>
      <Card>
        <CardHeader title="What if a metric changes?" subtitle="Pick a metric and a change; the projection uses the team's own revenue association for that metric, or the company-wide one where the team's own months are inconclusive." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Metric</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value)} className={cx(inputClass, 'w-full')} data-testid="whatif-metric">
              {data.sensitivities.map((m) => (
                <option key={m.metric} value={m.metric}>
                  {m.label}{m.significant ? (m.basis === 'company' ? ' (company-wide link)' : '') : m.status === 'fitted' ? ' (no reliable link)' : ' (not enough data)'}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Change ({s?.unit ?? 'unit'}s, use − for a decrease)</span>
            <input type="number" step="0.1" value={changeText} onChange={(e) => setChangeText(e.target.value)} className={cx(inputClass, 'w-full')} data-testid="whatif-change" />
          </label>
          <div className="text-xs text-slate-500 dark:text-slate-400 sm:pt-5">
            Now {cur ? `${fmtNum(cur.value)} (${fmtMonth(cur.month)})` : '—'}; target {tgt ? fmtNum(tgt.good) : '—'}.
            {cur && tgt && (tgt.lowerIsBetter ? cur.value > tgt.good : cur.value < tgt.good) && (
              <button type="button" onClick={toTarget} className="ml-1 font-medium text-brand-700 hover:underline dark:text-brand-300">Use the gap to target</button>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-md border border-slate-200 p-4 dark:border-slate-800" data-testid="whatif-result" aria-live="polite">
          {!res || !res.enabled ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-900 dark:text-white">No projection.</span> {res?.reason ?? 'Choose a metric.'}
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="text-sm text-slate-700 dark:text-slate-300">
                <p>
                  {s!.label} {change >= 0 ? '+' : '−'}{fmtNum(Math.abs(change))} {s!.unit}{Math.abs(change) === 1 ? '' : 's'}
                  {res.projectedValue !== null ? ` (to ${fmtNum(res.projectedValue)})` : ''} is associated with this change in monthly revenue.
                </p>
                {res.extrapolation && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Outside the values recorded ({fmtNum(s!.minX)} to {fmtNum(s!.maxX)}): an extrapolation, treat with extra care.
                  </p>
                )}
              </div>
              <Amount monthly={res.monthly} annual={res.annual} low={res.monthlyLow} high={res.monthlyHigh} testId="whatif-amount" />
            </div>
          )}
          <HowCalculated>
            <p>{WHAT_IF_FORMULA}</p>
            {s && <SensitivityFacts s={s} />}
          </HowCalculated>
        </div>
      </Card>
    </MetricInfoTrigger>
  );
};

// ---------------------------------------------------------------------------
// Details: revenue per metric
// ---------------------------------------------------------------------------

export const RevenueSensitivityTable: React.FC<{ data: TeamRevenueData }> = ({ data }) => {
  const rows = data.sensitivities;
  const anyFitted = rows.some((r) => r.status === 'fitted');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          $ per month associated with +1 unit of each metric. Exploratory, not corrected for multiple comparisons; "associated with", not "causes".
        </p>
        <ExportCsvButton
          what="Revenue per metric"
          compact
          rows={rows}
          columns={[
            { header: 'Metric', value: (r) => r.label },
            { header: 'Unit', value: (r) => r.unit },
            { header: '$ per month per +1 unit', value: (r) => fmtMoney(r.slope), raw: (r) => r.slope },
            { header: '95% low', value: (r) => fmtMoney(r.ciLow), raw: (r) => r.ciLow },
            { header: '95% high', value: (r) => fmtMoney(r.ciHigh), raw: (r) => r.ciHigh },
            { header: 'n months', value: (r) => r.n },
            { header: 'r', value: (r) => fmtNum(r.r, 3), raw: (r) => r.r },
            { header: 'R²', value: (r) => fmtNum(r.r2, 3), raw: (r) => r.r2 },
            { header: 'p', value: (r) => fmtP(r.pValue), raw: (r) => r.pValue },
            { header: 'Significant (p < 0.05)', value: (r) => (r.significant ? 'yes' : 'no') },
            { header: 'Basis', value: (r) => (r.basis === 'company' ? 'company-wide' : 'team') },
            { header: 'Note', value: (r) => r.reason ?? '' },
          ]}
        />
      </div>
      {!anyFitted ? (
        <EmptyState
          title="Not enough months yet"
          description={`${rows[0]?.reason ?? ''} Revenue per metric needs at least ${REVENUE_MIN_PAIRED_MONTHS} months with both the metric and monthly revenue.`}
        />
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="revenue-sensitivity-table">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <th className="px-5 py-2 text-left font-medium">Metric</th>
                <th className="px-3 py-2 text-right font-medium">$/month per +1</th>
                <th className="px-3 py-2 text-right font-medium">95% range</th>
                <th className="px-3 py-2 text-right font-medium">n</th>
                <th className="px-3 py-2 text-right font-medium">r</th>
                <th className="px-3 py-2 text-right font-medium">p</th>
                <th className="px-5 py-2 text-left font-medium">How sure are we?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r.metric}>
                  <td className="px-5 py-2 text-slate-900 dark:text-white">{r.label}<span className="block text-xs text-slate-500 dark:text-slate-400">per {r.unit}</span></td>
                  <td className={cx('px-3 py-2 text-right tabular-nums', r.significant ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400')}>{fmtMoney(r.slope)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtRange(r.ciLow, r.ciHigh) ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{r.n}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtNum(r.r, 2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtP(r.pValue)}</td>
                  <td className="px-5 py-2 text-xs">
                    {r.status !== 'fitted' ? (
                      <span className="text-slate-500 dark:text-slate-400">{r.status === 'insufficient_data' ? `Needs ${r.monthsMissing} more months` : 'No variation'}</span>
                    ) : r.significant && r.basis === 'company' ? (
                      <Badge tone="brand">Company-wide evidence</Badge>
                    ) : r.significant ? (
                      <Badge tone={(r.pValue ?? 1) < 0.01 ? 'good' : 'brand'}>{(r.pValue ?? 1) < 0.01 ? 'Strong evidence' : 'Some evidence'}</Badge>
                    ) : (
                      <Badge tone="warn">Not significant</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <HowCalculated>
        <p>{REVENUE_SENSITIVITY_FORMULA}</p>
        {rows.some((r) => r.basis === 'company') && <p>{REVENUE_POOLED_FORMULA}</p>}
        {data.months.excludedOtherSource > 0 && (
          <p>{data.months.excludedOtherSource} earlier months of {data.months.source === 'sample' ? 'recorded' : 'sample'} data are left out (sample and recorded data are not fitted together).</p>
        )}
        {REVENUE_CAVEATS.map((c) => <p key={c}>{c}</p>)}
      </HowCalculated>
    </div>
  );
};

// ---------------------------------------------------------------------------
// All teams (roll-up)
// ---------------------------------------------------------------------------

interface RollupResponse { rollup: RevenueRollup; teams: TeamRevenueFigures[]; sampleData: boolean }

export const RevenueRollupView: React.FC<{ departments: Array<{ id: string; name: string }>; showFormulas: boolean }> = ({ departments, showFormulas }) => {
  const [dept, setDept] = useState('all');
  const hideSampleNotice = useHideSampleNotice();
  const [data, setData] = useState<RollupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/revenue-impact/rollup${d !== 'all' ? `?departmentId=${encodeURIComponent(d)}` : ''}`, { credentials: 'include' });
      const body = await r.json().catch(() => null);
      if (!r.ok) { setData(null); setError(body?.error || 'Failed to load the roll-up'); return; }
      setData(body);
    } catch {
      setError('Failed to load the roll-up');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(dept); }, [dept, load]);

  const r = data?.rollup;
  return (
    <div className="space-y-6" data-testid="revenue-rollup">
      <div className="flex flex-wrap items-center gap-3">
        {departments.length > 1 && (
          <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={inputClass}>
            <option value="all">All teams in your scope</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {data && (
          <ExportCsvButton
            what="Revenue impact by team"
            compact
            rows={data.teams}
            columns={[
              { header: 'Team', value: (t) => t.teamName },
              { header: 'Department', value: (t) => t.departmentName ?? '' },
              { header: 'Quality gaps $/month', value: (t) => fmtMoney(t.stake.monthly), raw: (t) => t.stake.monthly },
              { header: 'Range low $/month', value: (t) => fmtMoney(t.stake.monthlyLow), raw: (t) => t.stake.monthlyLow },
              { header: 'Range high $/month', value: (t) => fmtMoney(t.stake.monthlyHigh), raw: (t) => t.stake.monthlyHigh },
              { header: 'Open debt $/month', value: (t) => fmtMoney(t.debt.monthly), raw: (t) => t.debt.monthly },
              { header: 'Note', value: (t) => [t.stake.reason, t.debt.reason].filter(Boolean).join(' ') },
              ...(hideSampleNotice ? [] : [{ header: 'Sample data', value: (t: TeamRevenueFigures) => (t.sampleData ? 'yes' : 'no') }]),
            ]}
          />
        )}
      </div>
      {loading ? (
        <Loading what="the roll-up" />
      ) : error || !r || !data ? (
        <Card><EmptyState title="Roll-up not available" description={error ?? undefined} /></Card>
      ) : (
        <>
          <SampleDataBanner show={data.sampleData} />
          <MetricInfoTrigger enabled={showFormulas} metricKey="revenue_rollup" variant="section">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <StatTile
                  label="Revenue associated with quality gaps"
                  value={r.stake.monthly === null ? '—' : `${fmtMoney(r.stake.monthly)}/month`}
                  caption={r.stake.monthly === null ? 'No team has a figure' : `${fmtMoney(r.stake.annual)}/year · range ${fmtRange(r.stake.monthlyLow, r.stake.monthlyHigh)}/month`}
                />
                <HowCalculated testId="rollup-how-stake">
                  <p>Sum of each team's "Quality below target" figure: {data.teams.filter((t) => t.stake.monthly !== null).map((t) => `${t.teamName} ${fmtMoney(t.stake.monthly)}`).join(' + ') || 'none'}.</p>
                  <p>Each team's figure = its revenue slope per metric × the gap to the KPI target valid today, each movement counted once (Money tab).</p>
                </HowCalculated>
              </div>
              <div>
                <StatTile
                  label="Open technical debt"
                  value={r.debt.monthly === null ? '—' : `${fmtMoney(r.debt.monthly)}/month`}
                  caption={r.debt.monthly === null ? 'No team has debt with impact data' : `${fmtMoney(r.debt.annual)}/year`}
                />
                <HowCalculated testId="rollup-how-debt">
                  <p>Sum of each team's cost of delay of open debt items: {data.teams.filter((t) => t.debt.monthly !== null).map((t) => `${t.teamName} ${fmtMoney(t.debt.monthly)}`).join(' + ') || 'none'}.</p>
                  <p>Per item: tickets × ticket cost + downtime minutes × cost per minute + affected users × revenue per user × revenue impact % + SLA breaches × penalty (Parameters → Financial and ROI settings).</p>
                </HowCalculated>
              </div>
              <div>
                <StatTile label="Teams with a figure" value={`${r.stake.contributing.length} of ${r.teams}`} caption="Quality gaps; the others are listed below" />
                <HowCalculated testId="rollup-how-teams">
                  <p>Teams in your scope with a "Quality below target" figure, out of all active teams in your scope. A team has none when it has fewer than 6 months of data or no significant revenue link (its own or company-wide).</p>
                </HowCalculated>
              </div>
            </div>
          </MetricInfoTrigger>
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <th className="px-5 py-2 text-left font-medium">Team</th>
                    <th className="px-3 py-2 text-right font-medium">Quality gaps</th>
                    <th className="px-3 py-2 text-right font-medium">Open debt</th>
                    <th className="px-5 py-2 text-left font-medium">Why no figure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.teams.map((t) => (
                    <tr key={t.teamId}>
                      <td className="px-5 py-2 text-slate-900 dark:text-white">{t.teamName}<span className="block text-xs text-slate-500 dark:text-slate-400">{t.departmentName ?? 'No department'}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{t.stake.monthly === null ? '—' : `${fmtMoney(t.stake.monthly)}/mo`}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{t.debt.monthly === null ? '—' : `${fmtMoney(t.debt.monthly)}/mo`}</td>
                      <td className="max-w-xs px-5 py-2 text-xs text-slate-500 dark:text-slate-400">{[t.stake.monthly === null ? t.stake.reason : null, t.debt.monthly === null ? t.debt.reason : null].filter(Boolean).join(' ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 pb-4">
              <HowCalculated><p>{REVENUE_ROLLUP_FORMULA}</p></HowCalculated>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export const RevenueLoadState: React.FC<{ loading: boolean; error: string | null }> = ({ loading, error }) =>
  loading ? <Loading what="the revenue impact" /> : <Card><EmptyState title="Revenue impact not available" description={error ?? undefined} /></Card>;
