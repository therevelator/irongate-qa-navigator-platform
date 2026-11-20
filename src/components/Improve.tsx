import React, { useCallback, useEffect, useId, useState } from 'react';
import { ChevronDown, ListPlus, RefreshCw, TrendingDown, TrendingUp, Minus, Undo2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { ComposedChart, Area, Line, Tooltip, ResponsiveContainer, YAxis, XAxis, ReferenceLine } from 'recharts';
import Modal from './Modal';
import { Badge, Card, EmptyState, buttonClass, cx, inputClass, type Tone } from './ui';
import { api } from './NotificationParts';
import { crossingRangeText, forecastTargetText, forecastValue, shortDay, type ForecastTarget } from '../lib/forecastText';
import type { HistoryPoint } from '../data/kpiTrend';
import type { chartTheme } from '../data/advancedFeatures';

/**
 * Team detail → Improve (v2 phase 4): the forecast line of each KPI tile, the trend charts with the
 * projected band and the target crossing, and the Recommendations section (top 3 visible, the rest
 * and the decided ones in accordions like the Action plan; "Add to Action plan" creates a tracked
 * action linked to the recommendation and its metric; "Dismiss" asks for a reason).
 * Data: GET /api/improve/teams/:id (server/routes/improve.ts), analytics scope.
 */

export interface Forecast {
  metric: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean | null;
  status: 'ok' | 'insufficient';
  reason: string | null;
  asOf: string;
  pointsUsed: number;
  historyFrom: string | null;
  historyTo: string | null;
  lastValue: number | null;
  lastDay: string | null;
  slopePerWeek: number | null;
  trend: 'improving' | 'worsening' | 'flat' | null;
  projection: Array<{ day: string; value: number; low: number; high: number }>;
  outlook: 'on_track' | 'will_miss' | 'will_reach' | 'stays_off' | 'no_target' | null;
  crossing: { day: string; earliest: string; latest: string | null } | null;
  targetNow: ForecastTarget | null;
  confidence: 'high' | 'medium' | 'low' | null;
  computedAt: string;
  text: string;
}

export interface Movement {
  metric: string; label: string; unit: string; lowerIsBetter: boolean;
  before: { value: number; day: string } | null; after: { value: number; day: string } | null;
  change: number | null; verdict: 'improved' | 'unchanged' | 'worse' | 'no_data';
}

export interface Recommendation {
  id: string;
  ruleKey: string;
  title: string;
  evidence: Array<{ label: string; value: string; detail?: string }>;
  items: Array<{ kind: string; name: string; detail: string }>;
  nextStep: string;
  metric: { key: string; label: string; unit: string } | null;
  effect: { basis: string; kind: 'improve' | 'hold' } | null;
  effectText: string | null;
  confidence: 'high' | 'medium' | 'low';
  rank: number | null;
  status: 'open' | 'accepted' | 'dismissed';
  dismissReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  action: { id: string; title: string; status: string; owner: string | null; dueDate: string | null; createdAt: string; movement: Movement | null } | null;
}

export interface ImproveData {
  teamId: string;
  canManage: boolean;
  computedAt: string | null;
  forecasts: Forecast[];
  recommendations: { open: Recommendation[]; accepted: Recommendation[]; dismissed: Recommendation[] };
  dismissReasons: string[];
  text: { forecastMethod: string; forecastBand: string; horizonWeeks: number; recommendations: string };
}

export function useImprove(teamId: string) {
  const [data, setData] = useState<ImproveData | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setData(await api<ImproveData>(`/improve/teams/${encodeURIComponent(teamId)}`));
      setError(null);
    } catch (e: any) {
      setError({ status: e.status, message: e.message });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [teamId]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  const forecastOf = useCallback((metric: string) => data?.forecasts.find((f) => f.metric === metric) ?? null, [data]);
  return { data, error, loading, reload: load, setData, forecastOf };
}

const OUTLOOK_TONE: Record<NonNullable<Forecast['outlook']>, Tone> = { on_track: 'good', will_reach: 'good', will_miss: 'bad', stays_off: 'warn', no_target: 'neutral' };
export const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

/** "Forecast: Misses target ≥ 80% around 18 Dec" under a KPI tile (or the reason there is none). */
export const ForecastNote: React.FC<{ f: Forecast | null; className?: string; testId?: string }> = ({ f, className, testId }) => {
  if (!f) return null;
  const ok = f.status === 'ok';
  const Icon = !ok ? Minus : f.trend === 'improving' ? TrendingUp : f.trend === 'worsening' ? TrendingDown : Minus;
  const range = ok ? crossingRangeText(f.crossing) : null;
  return (
    <p className={cx('flex items-start gap-1 text-xs', className)} data-testid={testId ?? `forecast-${f.metric}`} data-outlook={ok ? f.outlook ?? undefined : 'insufficient'}
      title={ok ? `${f.text}${range ? ` (${range})` : ''}. ${f.confidence ? CONFIDENCE_LABEL[f.confidence] : ''}; trend of ${f.pointsUsed} weeks with values.` : f.text}>
      <Icon size={13} aria-hidden className="mt-px flex-shrink-0 text-slate-400" />
      <span>
        <span className="font-medium text-slate-600 dark:text-slate-300">Forecast: </span>
        {ok ? (
          <span className={cx(f.outlook === 'will_miss' ? 'font-medium text-red-700 dark:text-red-300' : f.outlook === 'stays_off' ? 'text-amber-800 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300')}>
            {f.text}{range && <span className="text-slate-500 dark:text-slate-400"> ({range})</span>}
          </span>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">not enough data ({f.reason?.replace(/\.$/, '')})</span>
        )}
      </span>
    </p>
  );
};

const dayNum = (d: string) => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/**
 * A KPI trend chart with the forecast: the history (area), then the projected line with its band
 * (shaded) for 8 weeks, the target (dashed) and the expected crossing (dotted vertical line).
 */
export const TrendWithForecast: React.FC<{
  history: HistoryPoint[];
  forecast: Forecast | null;
  unit?: string;
  name: string;
  chart: ReturnType<typeof chartTheme>;
  heightClass?: string;
  testId?: string;
}> = ({ history, forecast, unit, name, chart, heightClass = 'h-20', testId }) => {
  const f = forecast?.status === 'ok' && forecast.projection.length ? forecast : null;
  const last = history[history.length - 1];
  type Pt = { t: number; date: string; value?: number; proj?: number; band?: [number, number] };
  const data: Pt[] = history.map((h) => ({ t: dayNum(h.date), date: h.date, value: h.value }));
  if (f && last) {
    data[data.length - 1] = { ...data[data.length - 1], proj: last.value, band: [last.value, last.value] };
    for (const p of f.projection) data.push({ t: dayNum(p.day), date: p.day, proj: p.value, band: [p.low, p.high] });
  }
  const target = f?.targetNow && f.targetNow.kind !== 'band' ? f.targetNow.good : null;
  const crossing = f?.crossing ? dayNum(f.crossing.day) : null;
  const fmtV = (v: number) => forecastValue(v, unit);
  const label = f
    ? `${name}: ${history.length ? `from ${fmtV(history[0].value)} to ${fmtV(last.value)} in the last ${history.length} snapshots, ` : ''}forecast ${f.text}${f.targetNow ? `, target ${forecastTargetText(f.targetNow, unit)}` : ''}`
    : `${name} over the last ${history.length} snapshots`;
  return (
    <div className={heightClass} role="img" aria-label={label} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis hide domain={[(min: number) => Math.min(min, target ?? min), (max: number) => Math.max(max, target ?? max)]} />
          <Tooltip
            contentStyle={chart.tooltip.contentStyle}
            labelStyle={chart.tooltip.labelStyle}
            itemStyle={chart.tooltip.itemStyle}
            labelFormatter={(_l: any, p: any) => { const d = p?.[0]?.payload?.date; return d ? shortDay(d) : ''; }}
            formatter={(v: any, key: any) => {
              if (Array.isArray(v)) return [`${fmtV(Number(v[0]))} – ${fmtV(Number(v[1]))}`, 'Forecast band'];
              return [fmtV(Number(v)), key === 'proj' ? 'Forecast' : name];
            }}
          />
          {f && <Area type="linear" dataKey="band" stroke="none" fill={chart.series} fillOpacity={0.12} isAnimationActive={false} connectNulls />}
          <Area type="monotone" dataKey="value" stroke={chart.series} fill={chart.series} fillOpacity={0.08} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
          {f && <Line type="linear" dataKey="proj" stroke={chart.series} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />}
          {target !== null && <ReferenceLine y={target} stroke={chart.axis} strokeDasharray="3 3" strokeWidth={1} />}
          {crossing !== null && <ReferenceLine x={crossing} stroke={f?.outlook === 'will_miss' ? '#dc2626' : chart.axis} strokeDasharray="2 2" strokeWidth={1} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Recommendations
 * ---------------------------------------------------------------------------------------- */

const CONF_TONE: Record<'high' | 'medium' | 'low', Tone> = { high: 'good', medium: 'brand', low: 'neutral' };
const VERDICT: Record<Movement['verdict'], { label: string; tone: Tone }> = {
  improved: { label: 'Improved', tone: 'good' }, unchanged: { label: 'Unchanged', tone: 'neutral' }, worse: { label: 'Worse', tone: 'bad' }, no_data: { label: 'No new data yet', tone: 'neutral' },
};
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };

/** "Test coverage 55.7% (12 Nov) → 61.2% (3 Dec): improved" */
export const MovementLine: React.FC<{ m: Movement; testId?: string }> = ({ m, testId }) => (
  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-600 dark:text-slate-300" data-testid={testId ?? 'movement'}>
    <span className="font-medium">Since it was added:</span>
    {m.before ? <span className="tabular-nums">{m.label} {forecastValue(m.before.value, m.unit)} ({shortDay(m.before.day)})</span> : <span>no value before</span>}
    <span aria-hidden>→</span>
    {m.after ? <span className="tabular-nums">{forecastValue(m.after.value, m.unit)} ({shortDay(m.after.day)})</span> : <span>no newer snapshot</span>}
    <Badge tone={VERDICT[m.verdict].tone}>{VERDICT[m.verdict].label}</Badge>
  </p>
);

const RecommendationCard: React.FC<{
  r: Recommendation;
  canManage: boolean;
  busy: boolean;
  onAccept: (r: Recommendation) => void;
  onDismiss: (r: Recommendation) => void;
  onReopen: (r: Recommendation) => void;
}> = ({ r, canManage, busy, onAccept, onDismiss, onReopen }) => {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <li className="py-4 first:pt-1" data-testid="recommendation" data-rule={r.ruleKey} data-status={r.status}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {r.status === 'open' && r.rank !== null && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-[11px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900" aria-label={`Rank ${r.rank}`}>{r.rank}</span>}
            <p className="text-sm font-medium text-slate-900 dark:text-white" data-testid="recommendation-title">{r.title}</p>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={CONF_TONE[r.confidence]}>{CONFIDENCE_LABEL[r.confidence]}</Badge>
            {r.metric && <span className="text-xs text-slate-500 dark:text-slate-400">Metric: {r.metric.label}</span>}
          </div>
          {r.effectText && (
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200" data-testid="recommendation-effect">
              <span className="font-medium">Expected effect: </span>{r.effectText}
              {r.effect?.basis && <span className="block text-xs text-slate-500 dark:text-slate-400">Based on {r.effect.basis}.</span>}
            </p>
          )}
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-200" data-testid="recommendation-next-step"><span className="font-medium">Next step: </span>{r.nextStep}</p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen(!open)}
            data-testid="recommendation-evidence-toggle"
          >
            <ChevronDown size={14} aria-hidden className={cx('transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />
            Evidence ({r.evidence.length + r.items.length})
          </button>
          <div id={detailsId} hidden={!open} className="mt-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/60" data-testid="recommendation-evidence">
            <dl className="space-y-1 text-xs">
              {r.evidence.map((e, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:gap-2">
                  <dt className="text-slate-500 dark:text-slate-400 sm:w-1/2">{e.label}</dt>
                  <dd className="text-slate-800 dark:text-slate-100"><span className="font-medium tabular-nums">{e.value}</span>{e.detail && <span className="text-slate-500 dark:text-slate-400"> · {e.detail}</span>}</dd>
                </div>
              ))}
            </dl>
            {r.items.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs dark:border-slate-700" data-testid="recommendation-items">
                {r.items.map((it, i) => (
                  <li key={i} className="min-w-0">
                    <span className="break-all font-mono text-[11px] text-slate-800 dark:text-slate-100">{it.name}</span>
                    <span className="text-slate-500 dark:text-slate-400"> · {it.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {r.status === 'accepted' && r.action && (
            <div className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-xs dark:border-slate-700" data-testid="recommendation-action">
              <p className="text-slate-700 dark:text-slate-200">
                In the Action plan: <span className="font-medium">{r.action.title}</span> · {STATUS_LABEL[r.action.status] ?? r.action.status}
                {r.action.owner ? ` · ${r.action.owner}` : ' · unassigned'}{r.action.dueDate ? ` · due ${shortDay(r.action.dueDate)}` : ''}
              </p>
              {r.action.movement && <MovementLine m={r.action.movement} testId="recommendation-movement" />}
            </div>
          )}
          {r.status === 'accepted' && !r.action && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Its action was deleted.</p>}
          {r.status === 'dismissed' && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="recommendation-dismissed">
              Dismissed{r.decidedBy ? ` by ${r.decidedBy}` : ''}{r.decidedAt ? ` on ${shortDay(r.decidedAt)}` : ''}: {r.dismissReason}
            </p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
            {r.status === 'open' && (
              <>
                <button type="button" className={buttonClass.primary} disabled={busy} onClick={() => onAccept(r)} data-testid="recommendation-accept">
                  <ListPlus size={15} aria-hidden /> Add to Action plan
                </button>
                <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => onDismiss(r)} data-testid="recommendation-dismiss">
                  <X size={15} aria-hidden /> Dismiss
                </button>
              </>
            )}
            {(r.status === 'dismissed' || (r.status === 'accepted' && !r.action)) && (
              <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => onReopen(r)} data-testid="recommendation-reopen">
                <Undo2 size={15} aria-hidden /> Reopen
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

const Group: React.FC<{ id: string; label: string; count: number; defaultOpen?: boolean; testId: string; children: React.ReactNode }> = ({ id, label, count, defaultOpen = false, testId, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border border-slate-200 dark:border-slate-800" data-testid={testId} data-count={count}>
      <h4 className="text-sm">
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60"
          aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} data-testid={`${testId}-toggle`}>
          <ChevronDown size={15} aria-hidden className={cx('flex-shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400', !open && '-rotate-90')} />
          <span>{label} ({count})</span>
        </button>
      </h4>
      <div id={id} hidden={!open} className="border-t border-slate-100 px-3 dark:border-slate-800">{children}</div>
    </section>
  );
};

export const RECOMMENDATIONS_VISIBLE = 3;

export const RecommendationsPanel: React.FC<{
  teamId: string;
  teamName: string;
  improve: ReturnType<typeof useImprove>;
  /** Called after a recommendation became an action (the Action plan reloads). */
  onActionCreated?: (actionId: string) => void;
}> = ({ teamId, teamName, improve, onActionCreated }) => {
  const { data, error, loading, reload, setData } = improve;
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<Recommendation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const baseId = useId();

  if (error?.status === 403) return null;

  const accept = async (r: Recommendation) => {
    setBusy(r.id);
    try {
      const res = await api<{ actionId: string }>(`/improve/recommendations/${r.id}/accept`, { method: 'POST', json: {} });
      toast.success('Added to the Action plan; its outcome is measured on ' + (r.metric?.label.toLowerCase() ?? 'the linked metric'));
      await reload();
      onActionCreated?.(res.actionId);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  const reopen = async (r: Recommendation) => {
    setBusy(r.id);
    try { await api(`/improve/recommendations/${r.id}/reopen`, { method: 'POST', json: {} }); toast.success('Recommendation reopened'); await reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try { setData(await api<ImproveData>(`/improve/teams/${encodeURIComponent(teamId)}/refresh`, { method: 'POST', json: {} })); toast.success('Forecasts and recommendations recalculated'); }
    catch (e: any) { toast.error(e.message); } finally { setRefreshing(false); }
  };

  const open = data?.recommendations.open ?? [];
  const top = open.slice(0, RECOMMENDATIONS_VISIBLE);
  const more = open.slice(RECOMMENDATIONS_VISIBLE);
  const decided = [...(data?.recommendations.accepted ?? []), ...(data?.recommendations.dismissed ?? [])];
  const card = (r: Recommendation) => (
    <RecommendationCard key={r.id} r={r} canManage={!!data?.canManage} busy={busy === r.id} onAccept={accept} onDismiss={setDismissing} onReopen={reopen} />
  );

  return (
    <Card>
      <div data-testid="recommendations">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Recommendations{open.length > 0 && <span className="font-normal text-slate-500 dark:text-slate-400"> ({open.length})</span>}
            </h3>
            <p className="mt-0.5 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
              What to do next, ranked by expected effect, from this team’s own numbers. Each one shows its evidence, a next step and the expected effect as a range.
            </p>
          </div>
          {data?.canManage && (
            <button type="button" className={cx(buttonClass.secondary, 'whitespace-nowrap')} onClick={refresh} disabled={refreshing} data-testid="improve-refresh">
              <RefreshCw size={15} aria-hidden className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} /> {refreshing ? 'Recalculating…' : 'Recalculate'}
            </button>
          )}
        </div>
        {loading && !data ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading recommendations…</p>
        ) : error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{error.message}</p>
        ) : open.length === 0 && decided.length === 0 ? (
          <EmptyState title="No recommendations right now" description="Nothing in this team’s numbers calls for a change: the tracked metrics are on target or already improving towards it." />
        ) : (
          <>
            {top.length > 0 ? (
              <ol className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="recommendations-top">{top.map(card)}</ol>
            ) : (
              <p className="py-2 text-sm text-slate-500 dark:text-slate-400">No open recommendations.</p>
            )}
            <div className="mt-2 space-y-2">
              {more.length > 0 && (
                <Group id={`${baseId}-more`} label="More recommendations" count={more.length} testId="recommendations-more">
                  <ol className="divide-y divide-slate-100 dark:divide-slate-800">{more.map(card)}</ol>
                </Group>
              )}
              {decided.length > 0 && (
                <Group id={`${baseId}-decided`} label="Added to the Action plan or dismissed" count={decided.length} testId="recommendations-decided">
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">{decided.map(card)}</ul>
                </Group>
              )}
            </div>
          </>
        )}
        {data && (
          <p className="mt-3 max-w-3xl border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400" data-testid="recommendations-method">
            {data.text.recommendations}{data.computedAt ? ` Calculated ${shortDay(data.computedAt)} ${new Date(data.computedAt).toISOString().slice(11, 16)} UTC.` : ''}
          </p>
        )}
      </div>
      {dismissing && data && (
        <DismissDialog
          rec={dismissing}
          teamName={teamName}
          reasons={data.dismissReasons}
          onClose={() => setDismissing(null)}
          onDone={async () => { setDismissing(null); toast.success('Recommendation dismissed'); await reload(); }}
        />
      )}
    </Card>
  );
};

const DismissDialog: React.FC<{ rec: Recommendation; teamName: string; reasons: string[]; onClose: () => void; onDone: () => void }> = ({ rec, teamName, reasons, onClose, onDone }) => {
  const [choice, setChoice] = useState(reasons[0] ?? 'Other');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = choice === 'Other';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const reason = other ? note.trim() : note.trim() ? `${choice}: ${note.trim()}` : choice;
    if (reason.length < 3) { setError('Give a reason of at least 3 characters'); return; }
    setSaving(true); setError(null);
    try { await api(`/improve/recommendations/${rec.id}/dismiss`, { method: 'POST', json: { reason } }); onDone(); }
    catch (err: any) { setError(err.message); } finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Dismiss recommendation" subtitle={teamName} size="prose">
      <form onSubmit={submit} className="space-y-4" data-testid="dismiss-form">
        <p className="text-sm text-slate-700 dark:text-slate-200">{rec.title}</p>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Reason</legend>
          <div className="mt-2 space-y-1.5">
            {reasons.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="radio" name="dismiss-reason" value={r} checked={choice === r} onChange={() => setChoice(r)} data-autofocus={r === reasons[0] ? true : undefined} />
                {r}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{other ? 'Reason' : 'Note'} <span className="font-normal text-slate-500 dark:text-slate-400">{other ? '(required)' : '(optional)'}</span>
          <textarea maxLength={400} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputClass, 'mt-1 h-auto w-full py-2')} data-testid="dismiss-note" required={other} />
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">The team sees who dismissed it and why. It can be reopened later.</p>
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
          <button type="submit" disabled={saving} className={buttonClass.primary} data-testid="dismiss-save">{saving ? 'Saving…' : 'Dismiss'}</button>
        </div>
      </form>
    </Modal>
  );
};

export { OUTLOOK_TONE };
