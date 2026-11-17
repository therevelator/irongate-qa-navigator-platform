import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Line, ComposedChart, CartesianGrid, Legend } from 'recharts';
import { API_URL } from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, ProgressBar, cx } from './ui';
import type { Tone } from './ui';

interface PipelineVisualizationProps {
  onBack?: () => void;
  teamId?: string;
}

interface PipelineConfig {
  time_savings_percent: number | null;
  cost_savings_percent: number | null;
  cost_per_minute: number | null;
  is_default?: boolean;
}

/** Stage as returned by GET /analytics/pipeline-stages (numbers may be null/strings). */
interface ApiStage {
  id: string;
  name: string;
  duration: number | null;
  success_rate: number | null;
  resource_usage?: { cpu: number | null; memory: number | null; cost: number | null };
  bottleneck_score?: number | null;
  updated_at?: string | null;
  stage_order?: number | null;
}

interface Stage {
  id: string;
  name: string;
  duration: number | null; // seconds
  success_rate: number | null; // 0-100
  cpu: number | null;
  memory: number | null;
  cost: number | null; // $ per run
  bottleneck_score: number | null;
}

interface PipelineHistoryPoint {
  date: string;
  total_runs: number | null;
  successful_runs: number | null;
  failed_runs: number | null;
  failure_rate: number | null;
  avg_duration_seconds: number | null;
  total_cost: number | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const formatDuration = (seconds: number | null): string => {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r > 0 ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};
const fmtMoney = (v: number | null) => (v == null ? '—' : `$${v.toFixed(2)}`);
const fmtPct = (v: number | null, d = 1) => (v == null ? '—' : `${v.toFixed(d)}%`);

/**
 * Remove duplicate stage names (the same stage can exist twice when two seeders created it).
 * Keeps the most recently updated row when updated_at is available, otherwise the last one returned.
 */
const dedupeStages = (raw: ApiStage[]): Stage[] => {
  const byName = new Map<string, ApiStage>();
  raw.forEach((s) => {
    const key = (s.name || '').trim().toLowerCase();
    const prev = byName.get(key);
    if (!prev) { byName.set(key, s); return; }
    const prevT = prev.updated_at ? new Date(prev.updated_at).getTime() : null;
    const curT = s.updated_at ? new Date(s.updated_at).getTime() : null;
    if (prevT == null || curT == null || curT >= prevT) byName.set(key, s);
  });
  // Preserve original pipeline order (position of first occurrence of each name).
  const order = new Map<string, number>();
  raw.forEach((s, i) => { const k = (s.name || '').trim().toLowerCase(); if (!order.has(k)) order.set(k, i); });
  return Array.from(byName.entries())
    .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([, s]) => ({
      id: s.id,
      name: s.name,
      duration: num(s.duration),
      success_rate: num(s.success_rate),
      cpu: num(s.resource_usage?.cpu),
      memory: num(s.resource_usage?.memory),
      cost: num(s.resource_usage?.cost),
      bottleneck_score: null,
    }));
};

/**
 * Bottleneck score (0–100), same formula as the API: duration z-score mapped to 0–60
 * plus (1 − success rate) × 40. Recomputed here over the de-duplicated stage list so
 * duplicate rows do not distort the mean and standard deviation.
 */
const withBottleneckScores = (stages: Stage[]): Stage[] => {
  const durations = stages.map(s => s.duration).filter((d): d is number => d != null);
  if (!durations.length) return stages;
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const variance = durations.reduce((a, b) => a + (b - mean) ** 2, 0) / durations.length;
  const sd = Math.sqrt(Math.max(variance, 1e-6));
  return stages.map(s => {
    if (s.duration == null || s.success_rate == null) return { ...s, bottleneck_score: null };
    const z = (s.duration - mean) / sd;
    const durationFactor = Math.min(60, Math.max(0, ((z + 2) / 4) * 60));
    const failureFactor = (1 - Math.max(0, Math.min(1, s.success_rate / 100))) * 40;
    return { ...s, bottleneck_score: Math.round(Math.min(100, durationFactor + failureFactor) * 10) / 10 };
  });
};

const successTone = (r: number | null): Tone => (r == null ? 'neutral' : r >= 95 ? 'good' : r >= 85 ? 'warn' : 'bad');
const bottleneckTone = (b: number | null): Tone => (b == null ? 'neutral' : b > 70 ? 'bad' : b > 40 ? 'warn' : 'neutral');

const PipelineVisualization: React.FC<PipelineVisualizationProps> = ({ teamId }) => {
  const { isDark } = useTheme();
  const [rawStages, setRawStages] = useState<ApiStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [history, setHistory] = useState<PipelineHistoryPoint[]>([]);
  const [stagesSource, setStagesSource] = useState<'team' | 'company_default' | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const q = teamId ? `teamId=${encodeURIComponent(teamId)}` : '';
        const [stagesRes, historyRes] = await Promise.all([
          fetch(`${API_URL}/analytics/pipeline-stages${q ? `?${q}` : ''}`, { credentials: 'include' }),
          fetch(`${API_URL}/analytics/pipeline-history?days=14${q ? `&${q}` : ''}`, { credentials: 'include' }),
        ]);
        if (stagesRes.ok) {
          const data = await stagesRes.json();
          setRawStages(data.stages || []);
          setStagesSource(data.stages_source ?? null);
          if (data.config) {
            setConfig({
              time_savings_percent: num(data.config.time_savings_percent),
              cost_savings_percent: num(data.config.cost_savings_percent),
              cost_per_minute: num(data.config.cost_per_minute),
              is_default: data.config.is_default === true,
            });
          }
        } else {
          setError('Could not load pipeline stages.');
        }
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          setHistory(historyData.history || []);
        }
      } catch (err) {
        console.error('Error fetching pipeline stages:', err);
        setError('Could not load pipeline stages.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [teamId]);

  const stages = useMemo(() => withBottleneckScores(dedupeStages(rawStages)), [rawStages]);
  const duplicatesRemoved = rawStages.length - stages.length;
  const hasStages = stages.length > 0;

  const durations = stages.map(s => s.duration).filter((d): d is number => d != null);
  const totalDuration = durations.length === stages.length && hasStages ? durations.reduce((a, b) => a + b, 0) : null;
  const rates = stages.map(s => s.success_rate).filter((r): r is number => r != null);
  // End-to-end success of a sequential pipeline: every stage must pass → product of stage success rates.
  const endToEndSuccess = hasStages && rates.length === stages.length ? rates.reduce((acc, r) => acc * (r / 100), 1) * 100 : null;
  const costs = stages.map(s => s.cost).filter((c): c is number => c != null);
  const totalCost = hasStages && costs.length === stages.length ? costs.reduce((a, b) => a + b, 0) : null;
  const bottleneck = stages.reduce<Stage | null>((prev, cur) =>
    cur.bottleneck_score != null && (prev == null || (prev.bottleneck_score ?? -1) < cur.bottleneck_score) ? cur : prev, null);

  // History aggregates, weighted by run counts.
  const histTotals = history.reduce(
    (acc, p) => {
      const t = num(p.total_runs), f = num(p.failed_runs), d = num(p.avg_duration_seconds);
      if (t != null) acc.runs += t;
      if (f != null) acc.failed += f;
      if (t != null && d != null) { acc.durWeighted += d * t; acc.durRuns += t; }
      return acc;
    },
    { runs: 0, failed: 0, durWeighted: 0, durRuns: 0 },
  );
  const weightedFailureRate = histTotals.runs > 0 ? (histTotals.failed / histTotals.runs) * 100 : null;
  const weightedStageDuration = histTotals.durRuns > 0 ? histTotals.durWeighted / histTotals.durRuns : null;

  const c = {
    grid: isDark ? '#1e293b' : '#e2e8f0',
    axis: isDark ? '#94a3b8' : '#64748b',
    bar: isDark ? '#79a4dc' : '#3567a5',
    warn: isDark ? '#fbbf24' : '#d97706',
    bad: isDark ? '#f87171' : '#dc2626',
    good: isDark ? '#4ade80' : '#16a34a',
    tooltip: {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: 6,
      color: isDark ? '#f1f5f9' : '#0f172a',
      fontSize: 12,
    },
  };

  const historyChart = history.map(p => ({
    date: String(p.date).slice(0, 10),
    successful: num(p.successful_runs),
    failed: num(p.failed_runs),
    failure_rate: num(p.failure_rate),
  }));

  return (
    <Page>
      <PageIntro
        title="CI/CD pipeline"
        description={`Stage-level duration, success rate and cost${
          teamId
            ? stagesSource === 'company_default'
              ? '. The selected team has no stages of its own, so the company default pipeline is shown'
              : ' for the selected team'
            : ' for the company default pipeline'
        }.`}
      />

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pipeline…
          </div>
        </Card>
      ) : error ? (
        <Card><EmptyState title={error} description="Try reloading the page." /></Card>
      ) : !hasStages ? (
        <Card><EmptyState title="No pipeline stages recorded" description="Pipeline stages appear here once they are configured or recorded." /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Sequential duration"
              value={formatDuration(totalDuration)}
              caption={`Sum of ${stages.length} stage average durations`}
            />
            <StatTile
              label="Estimated end-to-end success"
              value={endToEndSuccess != null ? endToEndSuccess.toFixed(1) : '—'}
              unit={endToEndSuccess != null ? '%' : undefined}
              tone={successTone(endToEndSuccess)}
              caption="Product of stage success rates (assumes stages run in sequence and fail independently)"
            />
            <StatTile
              label="Cost per pipeline run"
              value={fmtMoney(totalCost)}
              caption="Sum of stage cost per run"
            />
          </div>
          {duplicatesRemoved > 0 && (
            <p className="-mt-3 mb-6 text-xs text-amber-700 dark:text-amber-400">
              {duplicatesRemoved} duplicate stage record{duplicatesRemoved > 1 ? 's were' : ' was'} found with the same name and excluded from these totals.
            </p>
          )}

          <Card className="mb-6">
            <CardHeader title="Pipeline flow" subtitle="Average duration and success rate per stage" />
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max items-center gap-2">
                {stages.map((stage, index) => (
                  <React.Fragment key={stage.id}>
                    <div className={cx(
                      'w-28 flex-shrink-0 rounded-md border bg-white p-3 text-center dark:bg-slate-900',
                      stage.bottleneck_score != null && stage.bottleneck_score > 70 ? 'border-red-300 dark:border-red-800'
                        : stage.bottleneck_score != null && stage.bottleneck_score > 40 ? 'border-amber-300 dark:border-amber-800'
                        : 'border-slate-200 dark:border-slate-700',
                    )}>
                      <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-300" title={stage.name}>{stage.name}</div>
                      <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{formatDuration(stage.duration)}</div>
                      <div className="mt-1"><Badge tone={successTone(stage.success_rate)}>{fmtPct(stage.success_rate)}</Badge></div>
                    </div>
                    {index < stages.length - 1 && <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-600" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </Card>

          <Card className="mb-6">
            <CardHeader title="Duration by stage" subtitle="Bar colour reflects bottleneck score (amber > 40, red > 70)" />
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stages} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="name" angle={-35} textAnchor="end" height={80} interval={0} tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid} />
                  <YAxis tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid} label={{ value: 'seconds', angle: -90, position: 'insideLeft', fill: c.axis, fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.08)' }}
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const d = payload[0].payload as Stage;
                      return (
                        <div style={c.tooltip} className="px-3 py-2 shadow-sm">
                          <p className="mb-1 font-medium">{d.name}</p>
                          <p>Duration: {formatDuration(d.duration)}</p>
                          <p>Success rate: {fmtPct(d.success_rate)}</p>
                          <p>Cost per run: {fmtMoney(d.cost)}</p>
                          <p>Bottleneck score: {d.bottleneck_score ?? '—'}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="duration" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {stages.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.bottleneck_score != null && entry.bottleneck_score > 70 ? c.bad : entry.bottleneck_score != null && entry.bottleneck_score > 40 ? c.warn : c.bar} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mb-6">
            <CardHeader
              title="Stage executions, last 14 days"
              subtitle="Each count is a stage execution, not a full pipeline run"
              action={
                history.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <span>Failure rate: <span className="font-medium text-slate-900 dark:text-white">{fmtPct(weightedFailureRate, 2)}</span> <span className="hidden sm:inline">(failed ÷ total executions)</span></span>
                    <span>Mean stage duration: <span className="font-medium text-slate-900 dark:text-white">{formatDuration(weightedStageDuration)}</span></span>
                  </div>
                ) : undefined
              }
            />
            {history.length === 0 ? (
              <EmptyState title="No pipeline runs recorded" description="No stage executions were recorded in the last 14 days." />
            ) : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={historyChart} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                    <XAxis dataKey="date" tick={{ fill: c.axis, fontSize: 11 }} stroke={c.grid} />
                    <YAxis yAxisId="left" tick={{ fill: c.axis, fontSize: 11 }} stroke={c.grid} />
                    <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fill: c.axis, fontSize: 11 }} stroke={c.grid} />
                    <Tooltip contentStyle={c.tooltip} labelStyle={{ color: c.tooltip.color }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: c.axis }} />
                    <Bar yAxisId="left" dataKey="successful" stackId="r" fill={c.good} name="Successful" isAnimationActive={false} />
                    <Bar yAxisId="left" dataKey="failed" stackId="r" fill={c.bad} name="Failed" isAnimationActive={false} />
                    <Line yAxisId="right" type="linear" dataKey="failure_rate" stroke={c.warn} strokeWidth={2} name="Failure %" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {bottleneck && bottleneck.bottleneck_score != null && bottleneck.bottleneck_score > 50 && (
            <Card className="mb-6 border-amber-200 dark:border-amber-900">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={bottleneckTone(bottleneck.bottleneck_score)}>Highest bottleneck score</Badge>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{bottleneck.name}</h3>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Average duration {formatDuration(bottleneck.duration)}, success rate {fmtPct(bottleneck.success_rate)}, bottleneck score {bottleneck.bottleneck_score.toFixed(1)}.
                Common options: run steps in parallel, cache dependencies, or use incremental builds and tests.
              </p>
            </Card>
          )}

          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Stage details</h3>
          <div className="space-y-3">
            {stages.map((stage, index) => (
              <StageDetailCard key={stage.id} stage={stage} stageIndex={index} totalStages={stages.length} config={config} />
            ))}
          </div>

          <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">How these figures are calculated</h3>
            <div className="grid grid-cols-1 gap-4 text-xs text-slate-500 md:grid-cols-2 dark:text-slate-400">
              <div className="space-y-2">
                <p><span className="font-medium text-slate-700 dark:text-slate-300">Cost:</span> the stored cost per run for each stage; the header sums these across stages.</p>
                <p><span className="font-medium text-slate-700 dark:text-slate-300">Bottleneck score:</span> duration z-score across stages mapped to 0–60, plus (1 − success rate) × 40. Higher means slower and/or less reliable relative to the other stages.</p>
                <p><span className="font-medium text-slate-700 dark:text-slate-300">End-to-end success:</span> the product of the stage success rates. It is an estimate; it is not measured from complete pipeline runs.</p>
              </div>
              <div className="space-y-2">
                <p><span className="font-medium text-slate-700 dark:text-slate-300">Data source:</span> stage values come from the stored pipeline stage records. They can be entered in Admin Panel &gt; Manual Metrics Input &gt; Pipeline Configuration, and records not marked as manually edited may also be updated by automated background jobs. This page does not show which applies to each value.</p>
                <p><span className="font-medium text-slate-700 dark:text-slate-300">Savings projections:</span> arithmetic what-ifs using the reduction percentages in the pipeline configuration{config?.time_savings_percent != null ? ` (currently ${config.time_savings_percent}% time, ${config.cost_savings_percent ?? '—'}% cost${config.is_default ? '; built-in default assumptions, not yet set by an admin' : ''})` : ''}. They are not forecasts.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </Page>
  );
};

interface StageDetailCardProps {
  stage: Stage;
  stageIndex: number;
  config: PipelineConfig | null;
  totalStages: number;
}

const StageDetailCard: React.FC<StageDetailCardProps> = ({ stage, stageIndex, totalStages, config }) => {
  const [expanded, setExpanded] = useState(false);
  const timePct = config?.time_savings_percent ?? null;
  const costPct = config?.cost_savings_percent ?? null;
  const timeSavings = stage.duration != null && timePct != null ? stage.duration * (timePct / 100) : null;
  const costSavings = stage.cost != null && costPct != null ? stage.cost * (costPct / 100) : null;

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{stage.name}</h4>
            {stage.bottleneck_score != null && stage.bottleneck_score > 40 && (
              <Badge tone={bottleneckTone(stage.bottleneck_score)}>Bottleneck {stage.bottleneck_score.toFixed(1)}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Stage {stageIndex + 1} of {totalStages}</p>
        </div>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
          {[
            ['Duration', formatDuration(stage.duration)],
            ['Success', fmtPct(stage.success_rate)],
            ['CPU', fmtPct(stage.cpu, 0)],
            ['Memory', fmtPct(stage.memory, 0)],
            ['Cost / run', fmtMoney(stage.cost)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className={cx('font-medium tabular-nums', k === 'Success' ? `${successTone(stage.success_rate) === 'bad' ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-white'}` : 'text-slate-900 dark:text-white')}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {stage.bottleneck_score != null && (
        <div className="mt-3 flex items-center gap-3">
          <span className="w-28 text-xs text-slate-500 dark:text-slate-400">Bottleneck score</span>
          <ProgressBar value={stage.bottleneck_score} tone={bottleneckTone(stage.bottleneck_score) === 'neutral' ? 'brand' : bottleneckTone(stage.bottleneck_score)} className="max-w-xs" />
          <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{stage.bottleneck_score.toFixed(1)}</span>
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {expanded ? 'Hide what-if' : 'What-if projection'}
      </button>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800/40">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">If duration fell by {timePct != null ? `${timePct}%` : '—'}</p>
            <p className="font-medium text-slate-900 dark:text-white">{timeSavings != null ? `${formatDuration(timeSavings)} saved per run` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">If cost fell by {costPct != null ? `${costPct}%` : '—'}</p>
            <p className="font-medium text-slate-900 dark:text-white">{costSavings != null ? `${fmtMoney(costSavings)} saved per run` : '—'}</p>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2 dark:text-slate-400">
            Percentages come from the pipeline configuration{config?.is_default ? ' (default assumptions, not set by an admin)' : ''}; this is arithmetic, not a forecast.
          </p>
        </div>
      )}
    </Card>
  );
};

export default PipelineVisualization;
