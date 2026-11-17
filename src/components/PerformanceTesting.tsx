import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { API_URL } from '../config/api';
import { fetchSLAConfig, invalidateSLACache, type SLAConfig } from '../utils/slaConfig';
import { useTheme } from '../contexts/ThemeContext';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, SegmentedControl, inputClass, cx } from './ui';

interface PerformanceTestingProps {
  onBack?: () => void;
}

/** One row of performance_metrics: one endpoint on one recorded_date. Throughput is per minute. */
interface PerfRow {
  id: string;
  endpoint: string;
  method?: string | null;
  response_time_p50: number | null;
  response_time_p95: number | null;
  response_time_p99: number | null;
  throughput: number | null; // requests per minute
  error_rate: number | null; // percent
  timestamp: string; // recorded_date
}

type Range = '7' | '30' | '90';

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const dayKey = (ts: string) => String(ts).slice(0, 10);
const fmtDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const fmtMs = (v: number | null) => (v == null ? '—' : `${Math.round(v).toLocaleString()} ms`);
const fmtPct = (v: number | null, digits = 2) => (v == null ? '—' : `${v.toFixed(digits)}%`);
const fmtRpm = (v: number | null) => (v == null ? '—' : `${Math.round(v).toLocaleString()} /min`);
const endpointKey = (r: PerfRow) => `${r.method ?? ''} ${r.endpoint}`.trim();

/** One threshold set for the whole page: the SLA configuration. */
const slaStatus = (r: PerfRow, sla: SLAConfig | null): 'within' | 'outside' | 'unknown' => {
  if (!sla) return 'unknown';
  const p95 = num(r.response_time_p95);
  const err = num(r.error_rate);
  if (p95 == null && err == null) return 'unknown';
  const p95Bad = p95 != null && p95 > sla.responseTimeMs;
  const errBad = err != null && err > sla.errorRatePercent;
  return p95Bad || errBad ? 'outside' : 'within';
};

const PerformanceTesting: React.FC<PerformanceTestingProps> = () => {
  const { isDark } = useTheme();
  const [selectedEndpoint, setSelectedEndpoint] = useState<string | null>(null);
  const [selectedTrendEndpoint, setSelectedTrendEndpoint] = useState<string>('');
  const [range, setRange] = useState<Range>('30');
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slaConfig, setSlaConfig] = useState<SLAConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await fetch(`${API_URL}/analytics/performance-metrics?days=${range}`, { credentials: 'include' });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        if (!cancelled) setRows(data.metrics || []);
      } catch (err) {
        console.error('Error fetching performance metrics:', err);
        if (!cancelled) { setRows([]); setError('Could not load performance metrics.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range]);

  useEffect(() => {
    fetchSLAConfig().then(setSlaConfig);
    const handler = () => { invalidateSLACache(); fetchSLAConfig().then(setSlaConfig); };
    window.addEventListener('slaConfigUpdated', handler as EventListener);
    return () => window.removeEventListener('slaConfigUpdated', handler as EventListener);
  }, []);

  // Rows grouped per endpoint, sorted oldest → newest by recorded_date.
  const byEndpoint = useMemo(() => {
    const map = new Map<string, PerfRow[]>();
    for (const r of rows) {
      const k = endpointKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    for (const list of map.values()) list.sort((a, b) => dayKey(a.timestamp).localeCompare(dayKey(b.timestamp)));
    return map;
  }, [rows]);

  // Latest row per endpoint — used for the endpoint cards and the "outside SLA" count.
  const latestPerEndpoint = useMemo(
    () => Array.from(byEndpoint.entries()).map(([key, list]) => ({ key, row: list[list.length - 1], history: list })),
    [byEndpoint],
  );

  const asOf = rows.length ? rows.map(r => dayKey(r.timestamp)).sort().at(-1)! : null;

  // Summary statistics over all endpoint-day rows in range.
  const p95Values = rows.map(r => num(r.response_time_p95)).filter((v): v is number => v != null);
  const meanDailyP95 = p95Values.length ? p95Values.reduce((a, b) => a + b, 0) / p95Values.length : null;
  const tpValues = rows.map(r => num(r.throughput)).filter((v): v is number => v != null);
  const meanThroughput = tpValues.length ? tpValues.reduce((a, b) => a + b, 0) / tpValues.length : null;
  // Error rate weighted by request volume (throughput) so busy endpoints count more.
  const weighted = rows.filter(r => num(r.error_rate) != null && num(r.throughput) != null);
  const totalTp = weighted.reduce((a, r) => a + (num(r.throughput) as number), 0);
  const weightedErrorRate = totalTp > 0 ? weighted.reduce((a, r) => a + (num(r.error_rate) as number) * (num(r.throughput) as number), 0) / totalTp : null;
  const outsideSla = latestPerEndpoint.filter(e => slaStatus(e.row, slaConfig) === 'outside').length;

  useEffect(() => {
    if (!latestPerEndpoint.length) { if (selectedTrendEndpoint) setSelectedTrendEndpoint(''); return; }
    if (!byEndpoint.has(selectedTrendEndpoint)) setSelectedTrendEndpoint(latestPerEndpoint[0].key);
  }, [latestPerEndpoint, byEndpoint, selectedTrendEndpoint]);

  const trendData = useMemo(() => {
    const list = byEndpoint.get(selectedTrendEndpoint) || [];
    return list.map(r => ({
      label: fmtDay(dayKey(r.timestamp)),
      p50: num(r.response_time_p50),
      p95: num(r.response_time_p95),
      p99: num(r.response_time_p99),
    }));
  }, [byEndpoint, selectedTrendEndpoint]);

  const c = {
    grid: isDark ? '#1e293b' : '#e2e8f0',
    axis: isDark ? '#94a3b8' : '#64748b',
    p50: isDark ? '#94a3b8' : '#64748b',
    p95: isDark ? '#79a4dc' : '#3567a5',
    p99: isDark ? '#fbbf24' : '#b45309',
    sla: isDark ? '#f87171' : '#dc2626',
    tooltip: {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: 6,
      color: isDark ? '#f1f5f9' : '#0f172a',
      fontSize: 12,
    },
  };

  const rangeLabel = `last ${range} days`;

  return (
    <Page>
      <PageIntro
        title="Performance"
        description={
          asOf
            ? `Daily response-time, throughput and error-rate records per endpoint, ${rangeLabel}. Data as of ${fmtDay(asOf)}.`
            : `Daily response-time, throughput and error-rate records per endpoint, ${rangeLabel}.`
        }
        actions={
          <SegmentedControl
            value={range}
            onChange={setRange}
            options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]}
          />
        }
      />

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading performance metrics…
          </div>
        </Card>
      ) : error ? (
        <Card><EmptyState title={error} description="Try reloading the page." /></Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No performance data recorded"
            description={`No endpoint performance metrics have been recorded in the ${rangeLabel}.`}
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Mean of daily p95"
              value={meanDailyP95 != null ? Math.round(meanDailyP95).toLocaleString() : '—'}
              unit="ms"
              caption={`Average of ${p95Values.length} endpoint-day p95 values; not a true p95`}
            />
            <StatTile
              label="Mean throughput"
              value={meanThroughput != null ? Math.round(meanThroughput).toLocaleString() : '—'}
              unit="/min"
              caption="Requests per minute, per endpoint-day"
            />
            <StatTile
              label="Error rate"
              value={weightedErrorRate != null ? weightedErrorRate.toFixed(2) : '—'}
              unit="%"
              caption="Weighted by throughput"
            />
            <StatTile
              label="Endpoints outside SLA"
              value={slaConfig ? `${outsideSla} of ${latestPerEndpoint.length}` : '—'}
              tone={outsideSla > 0 ? 'bad' : 'neutral'}
              caption={slaConfig ? `Latest day: p95 > ${slaConfig.responseTimeMs} ms or errors > ${slaConfig.errorRatePercent}%` : 'SLA configuration not loaded'}
            />
          </div>

          <Card className="mb-6">
            <CardHeader
              title="Response time by day"
              subtitle="Recorded daily p50 / p95 / p99 for one endpoint"
              action={
                <select
                  aria-label="Endpoint"
                  value={selectedTrendEndpoint}
                  onChange={(e) => setSelectedTrendEndpoint(e.target.value)}
                  className={cx(inputClass, 'h-8 text-xs')}
                >
                  {latestPerEndpoint.map(e => <option key={e.key} value={e.key}>{e.key}</option>)}
                </select>
              }
            />
            {trendData.length === 0 ? (
              <EmptyState title="No data for this endpoint" />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid} label={{ value: 'ms', angle: -90, position: 'insideLeft', fill: c.axis, fontSize: 11 }} />
                    <Tooltip contentStyle={c.tooltip} labelStyle={{ color: c.tooltip.color }} formatter={(v) => fmtMs(num(v))} />
                    <Legend wrapperStyle={{ fontSize: 12, color: c.axis }} />
                    {slaConfig && (
                      <ReferenceLine y={slaConfig.responseTimeMs} stroke={c.sla} strokeDasharray="4 4" label={{ value: `SLA ${slaConfig.responseTimeMs} ms`, fill: c.sla, fontSize: 11, position: 'insideTopRight' }} />
                    )}
                    <Line type="linear" dataKey="p50" name="p50" stroke={c.p50} strokeWidth={1.5} dot={trendData.length < 40} connectNulls={false} isAnimationActive={false} />
                    <Line type="linear" dataKey="p95" name="p95" stroke={c.p95} strokeWidth={2} dot={trendData.length < 40} connectNulls={false} isAnimationActive={false} />
                    <Line type="linear" dataKey="p99" name="p99" stroke={c.p99} strokeWidth={1.5} dot={trendData.length < 40} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Endpoints</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Most recent recorded day per endpoint</p>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {latestPerEndpoint.map(e => (
                <EndpointRow
                  key={e.key}
                  label={e.key}
                  row={e.row}
                  history={e.history}
                  isSelected={selectedEndpoint === e.key}
                  onSelect={() => setSelectedEndpoint(selectedEndpoint === e.key ? null : e.key)}
                  slaConfig={slaConfig}
                  isDark={isDark}
                />
              ))}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
};

interface EndpointRowProps {
  label: string;
  row: PerfRow;
  history: PerfRow[];
  isSelected: boolean;
  onSelect: () => void;
  slaConfig: SLAConfig | null;
  isDark: boolean;
}

const EndpointRow: React.FC<EndpointRowProps> = ({ label, row, history, isSelected, onSelect, slaConfig, isDark }) => {
  const status = slaStatus(row, slaConfig);
  const p95 = num(row.response_time_p95);
  const err = num(row.error_rate);
  const spark = history.map(h => ({ v: num(h.response_time_p95) }));

  return (
    <div className="px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 lg:w-64">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm text-slate-900 dark:text-white">{label}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{fmtDay(dayKey(row.timestamp))}</span>
            {status === 'within' && <Badge tone="good">Within SLA</Badge>}
            {status === 'outside' && <Badge tone="bad">Outside SLA</Badge>}
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ['p50', fmtMs(num(row.response_time_p50))],
            ['p95', fmtMs(p95)],
            ['p99', fmtMs(num(row.response_time_p99))],
            ['Throughput', fmtRpm(num(row.throughput))],
            ['Error rate', fmtPct(err)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="h-10 w-full lg:w-40" title={`Recorded daily p95, ${history.length} days`}>
          {spark.length > 1 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark}>
                <YAxis hide domain={['auto', 'auto']} />
                <Line type="linear" dataKey="v" stroke={isDark ? '#79a4dc' : '#3567a5'} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <button
        onClick={onSelect}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
      >
        {isSelected ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {isSelected ? 'Hide SLA detail' : 'SLA detail'}
      </button>

      {isSelected && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800/40">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">p95 target</p>
            <p className="font-medium text-slate-900 dark:text-white">{slaConfig ? `≤ ${slaConfig.responseTimeMs} ms` : '—'}</p>
            <p className="mt-1 text-xs">
              {slaConfig && p95 != null ? (
                p95 <= slaConfig.responseTimeMs
                  ? <span className="text-green-700 dark:text-green-400">Met on latest day ({fmtMs(p95)})</span>
                  : <span className="text-red-700 dark:text-red-400">Not met on latest day ({fmtMs(p95)})</span>
              ) : <span className="text-slate-500 dark:text-slate-400">No data</span>}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Error-rate target</p>
            <p className="font-medium text-slate-900 dark:text-white">{slaConfig ? `≤ ${slaConfig.errorRatePercent}%` : '—'}</p>
            <p className="mt-1 text-xs">
              {slaConfig && err != null ? (
                err <= slaConfig.errorRatePercent
                  ? <span className="text-green-700 dark:text-green-400">Met on latest day ({fmtPct(err)})</span>
                  : <span className="text-red-700 dark:text-red-400">Not met on latest day ({fmtPct(err)})</span>
              ) : <span className="text-slate-500 dark:text-slate-400">No data</span>}
            </p>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2 dark:text-slate-400">
            Uptime is not recorded in this data set, so uptime SLA compliance is not shown.
          </p>
        </div>
      )}
    </div>
  );
};

export default PerformanceTesting;
