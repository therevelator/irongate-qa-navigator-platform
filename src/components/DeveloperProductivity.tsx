import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { API_URL } from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, SegmentedControl, inputClass } from './ui';
import {
  BURNOUT_DEFINITION,
  DDPS_FORMULA,
  DDPS_MAX_RAW,
  burnoutTone,
  calculateBurnoutRisk,
  calculateDDPS,
  chartTheme,
  ddpsBand,
  developerStatusMeta,
  formatAsOf,
} from '../data/advancedFeatures';
import type { BurnoutRisk, DeveloperInputs } from '../data/advancedFeatures';
import { toNum } from '../data/detailedKPIs';

interface DeveloperProductivityProps {
  onBack?: () => void;
  teamId?: string;
}

type TeamSummary = { id: string; name: string };

type DevRow = DeveloperInputs & {
  developer_id: string;
  name: string;
  email?: string;
  role?: string;
  team_id: string;
  team_name: string;
  wellbeing: number | null;   // stored happiness_score (derived workload balance, 0–100)
  ddps: number;               // 0–100
  estimatedHours: number;
  isOvertime: boolean;
  burnout: BurnoutRisk;
};

type AIInsights = {
  aiEnabled: boolean;
  teamInsight?: string;
  developers?: Array<{ name: string; status?: string; summary?: string; strengths?: string[]; concerns?: string[]; suggestion?: string; notMeasured?: string[]; dataQualityWarnings?: string[] }>;
  message?: string;
  source?: string;
};

type DdpsHistory = {
  startDate?: string;
  endDate?: string;
  stats?: { totalSnapshots?: number };
  chartData?: { date: string; ddps: number; developers: number }[];
};

const ENGINEER_ROLES = new Set(['engineer', 'qa_engineer', 'team_lead']);
const fmt = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const DeveloperProductivity: React.FC<DeveloperProductivityProps> = ({ teamId }) => {
  const { isDark } = useTheme();
  const ct = chartTheme(isDark);
  const [sortBy, setSortBy] = useState<'ddps' | 'pr' | 'review'>('ddps');
  const [developers, setDevelopers] = useState<DevRow[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>(teamId || 'all');
  const [selectedDeveloperId, setSelectedDeveloperId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [history, setHistory] = useState<DdpsHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Members + recorded metrics per team. Members without a metrics row are excluded (never zero-filled).
  useEffect(() => {
    const fetchTeamDevelopers = async (team: TeamSummary): Promise<DevRow[]> => {
      try {
        const [teamRes, metricsRes] = await Promise.all([
          fetch(`${API_URL}/teams/${team.id}`, { credentials: 'include' }),
          fetch(`${API_URL}/analytics/developer-metrics?teamId=${team.id}`, { credentials: 'include' }),
        ]);
        const members: any[] = teamRes.ok ? (await teamRes.json()).team?.members || [] : [];
        const lookup: Record<string, any> = {};
        if (metricsRes.ok) {
          ((await metricsRes.json()).developers || []).forEach((m: any) => { if (m.developer_id) lookup[String(m.developer_id)] = m; });
        }
        return members.flatMap((member: any): DevRow[] => {
          const m = lookup[String(member.id)];
          if (!m) return [];
          const inputs = {
            pr_merge_time_avg: toNum(m.pr_merge_time_avg),
            code_review_time_avg: toNum(m.code_review_time_avg),
            focus_time_hours: toNum(m.focus_time_hours),
            meeting_time_hours: toNum(m.meeting_time_hours),
            context_switches_per_day: toNum(m.context_switches_per_day),
          };
          // A row with any missing input cannot be scored; skip rather than invent zeros.
          if (Object.values(inputs).some(v => v == null)) return [];
          const d = inputs as DeveloperInputs;
          const ddps = calculateDDPS(d);
          return [{
            ...d,
            developer_id: String(member.id),
            name: [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || member.email,
            email: member.email,
            role: member.role,
            team_id: team.id,
            team_name: team.name,
            wellbeing: toNum(m.happiness_score),
            ddps: ddps.score,
            estimatedHours: ddps.estimatedHours,
            isOvertime: ddps.isOvertime,
            burnout: calculateBurnoutRisk(d),
          }];
        });
      } catch (error) {
        console.error(`Error fetching developers for team ${team.name}`, error);
        return [];
      }
    };

    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/teams`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch teams');
        const data = await res.json();
        const summaries: TeamSummary[] = (data.teams || []).map((t: any) => ({ id: String(t.id), name: t.name || 'Unnamed team' }));
        setTeams(summaries);
        const results = await Promise.all(summaries.map(fetchTeamDevelopers));
        setDevelopers(results.flat());
      } catch (error) {
        console.error('Error fetching developer productivity data:', error);
        setDevelopers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => { setSelectedTeam(teamId || 'all'); }, [teamId]);
  useEffect(() => { setSelectedDeveloperId('all'); }, [selectedTeam]);

  const eligible = useMemo(
    () => developers.filter(d => !d.role || ENGINEER_ROLES.has(d.role)),
    [developers],
  );

  const filtered = useMemo(() => eligible.filter(d =>
    (selectedTeam === 'all' || d.team_id === selectedTeam) &&
    (selectedDeveloperId === 'all' || d.developer_id === selectedDeveloperId),
  ), [eligible, selectedTeam, selectedDeveloperId]);

  const dropdownDevs = useMemo(() => {
    const map = new Map<string, DevRow>();
    eligible.filter(d => selectedTeam === 'all' || d.team_id === selectedTeam).forEach(d => { if (!map.has(d.developer_id)) map.set(d.developer_id, d); });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [eligible, selectedTeam]);

  const avgDDPS = avg(filtered.map(d => d.ddps));
  const avgPR = avg(filtered.map(d => d.pr_merge_time_avg));
  const avgReview = avg(filtered.map(d => d.code_review_time_avg));
  const avgFocus = avg(filtered.map(d => d.focus_time_hours));
  const avgMeetings = avg(filtered.map(d => d.meeting_time_hours));
  const burnoutCounts = { high: 0, moderate: 0, low: 0 } as Record<BurnoutRisk, number>;
  filtered.forEach(d => { burnoutCounts[d.burnout]++; });
  const band = ddpsBand(avgDDPS);

  const sorted = [...filtered].sort((a, b) =>
    sortBy === 'ddps' ? b.ddps - a.ddps : sortBy === 'pr' ? a.pr_merge_time_avg - b.pr_merge_time_avg : a.code_review_time_avg - b.code_review_time_avg,
  );

  const comparisonData = sorted.map(d => ({ name: d.name.split(' ')[0], ddps: d.ddps, focus: d.focus_time_hours }));

  // Stored DDPS snapshots (real rows only)
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    const params = new URLSearchParams({ range: '6m' });
    if (selectedTeam !== 'all') params.set('teamId', selectedTeam);
    if (selectedDeveloperId !== 'all') params.set('developerId', selectedDeveloperId);
    fetch(`${API_URL}/analytics/ddps-history?${params}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setHistory(d); })
      .catch(() => { if (!cancelled) setHistory(null); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTeam, selectedDeveloperId]);

  const historyData = (history?.chartData || [])
    .map(p => ({ date: p.date, ddps: toNum(p.ddps), developers: p.developers }))
    .filter((p): p is { date: string; ddps: number; developers: number } => p.ddps != null)
    .map(p => ({ ...p, ddps: Math.round(p.ddps * 100) })); // stored 0–1 → 0–100

  useEffect(() => {
    if (selectedTeam === 'all') { setAiInsights(null); return; }
    let cancelled = false;
    setAiLoading(true);
    fetch(`${API_URL}/teams/${selectedTeam}/developer-ai-suggestions`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setAiInsights(d); })
      .catch(() => { if (!cancelled) setAiInsights(null); })
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTeam]);

  const count = filtered.length;

  return (
    <Page className="space-y-6">
      <PageIntro
        title="Developer productivity"
        description="Recorded developer workload metrics and the derived Daily Developer Productivity Score (DDPS, 0–100). Only developers with recorded metrics are included."
        actions={
          <>
            <select aria-label="Team" value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} className={`${inputClass} w-52`}>
              <option value="all">All teams</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select aria-label="Developer" value={selectedDeveloperId} onChange={e => setSelectedDeveloperId(e.target.value)} className={`${inputClass} w-52`}>
              <option value="all">All developers</option>
              {dropdownDevs.map(d => <option key={d.developer_id} value={d.developer_id}>{d.name}</option>)}
            </select>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Avg DDPS" value={avgDDPS == null ? '—' : Math.round(avgDDPS)} unit={avgDDPS == null ? undefined : '/100'} tone={band.tone} caption={loading ? 'Loading…' : `${band.label} · ${count} developer${count === 1 ? '' : 's'}`} />
        <StatTile label="Avg PR merge time" value={fmt(avgPR)} unit={avgPR == null ? undefined : 'h'} caption="Open to merge (elapsed)" />
        <StatTile label="Avg review time" value={fmt(avgReview)} unit={avgReview == null ? undefined : 'h'} />
        <StatTile label="Avg focus time" value={fmt(avgFocus)} unit={avgFocus == null ? undefined : 'h/day'} />
        <StatTile label="Avg meeting time" value={fmt(avgMeetings)} unit={avgMeetings == null ? undefined : 'h/day'} />
        <StatTile
          label="Burnout risk"
          value={count ? burnoutCounts.high : '—'}
          unit={count ? 'high' : undefined}
          tone={!count ? 'neutral' : burnoutCounts.high ? 'bad' : burnoutCounts.moderate ? 'warn' : 'good'}
          caption={count ? `${burnoutCounts.moderate} moderate · ${burnoutCounts.low} low` : 'No data recorded'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="DDPS by developer" subtitle="Live score from each developer's latest recorded metrics (0–100) and focus hours per day" />
          {comparisonData.length === 0 ? (
            <EmptyState title="No developer metrics recorded" description="Add developer metrics in Manual metrics to see scores here." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: ct.axis, fontSize: 12 }} axisLine={{ stroke: ct.grid }} tickLine={false} />
                  <YAxis yAxisId="l" domain={[0, 100]} tick={{ fill: ct.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: ct.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={ct.tooltip.contentStyle} labelStyle={ct.tooltip.labelStyle} itemStyle={ct.tooltip.itemStyle} cursor={{ fill: isDark ? '#1e293b' : '#f1f5f9' }} />
                  <Legend wrapperStyle={{ color: ct.axis, fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="ddps" name="DDPS (0–100)" fill={ct.series} radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="r" dataKey="focus" name="Focus (h/day)" fill={ct.series2} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Recorded DDPS snapshots"
            subtitle="Daily average of stored productivity snapshots over the last 6 months (stored 0–1 values × 100). Snapshots are written by the snapshot job, not by this page."
          />
          {historyLoading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
          ) : historyData.length === 0 ? (
            <EmptyState
              title="No snapshots recorded"
              description={`No DDPS snapshots between ${formatAsOf(history?.startDate) ?? 'the start of the period'} and ${formatAsOf(history?.endDate) ?? 'today'}.`}
            />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: ct.axis, fontSize: 12 }} axisLine={{ stroke: ct.grid }} tickLine={false} minTickGap={24} />
                  <YAxis domain={[0, 100]} tick={{ fill: ct.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={ct.tooltip.contentStyle} labelStyle={ct.tooltip.labelStyle} itemStyle={ct.tooltip.itemStyle} />
                  <Line type="monotone" dataKey="ddps" name="Avg DDPS" stroke={ct.series} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 p-5 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <CardHeader title="Developers" subtitle={<>Burnout risk: {BURNOUT_DEFINITION}</>} />
          <SegmentedControl
            value={sortBy}
            onChange={setSortBy}
            options={[{ value: 'ddps', label: 'DDPS' }, { value: 'pr', label: 'PR' }, { value: 'review', label: 'Review' }]}
          />
        </div>
        {loading ? (
          <p className="px-5 pb-5 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : sorted.length === 0 ? (
          <EmptyState title="No developer metrics recorded" description="No engineers in this selection have recorded metrics." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-2.5">Developer</th>
                  <th className="px-3 py-2.5 text-right">DDPS</th>
                  <th className="px-3 py-2.5 text-right">PR merge (h)</th>
                  <th className="px-3 py-2.5 text-right">Review (h)</th>
                  <th className="px-3 py-2.5 text-right">Focus (h/day)</th>
                  <th className="px-3 py-2.5 text-right">Meetings (h/day)</th>
                  <th className="px-3 py-2.5 text-right">Context switches</th>
                  <th className="px-3 py-2.5 text-right">Focus + meetings (h/day)</th>
                  <th className="px-3 py-2.5 text-right">Workload balance (derived)</th>
                  <th className="px-5 py-2.5">Burnout risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sorted.map(d => {
                  const b = ddpsBand(d.ddps);
                  return (
                    <tr key={`${d.team_id}-${d.developer_id}`} className="text-slate-700 dark:text-slate-300">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{d.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{d.team_name}</div>
                      </td>
                      <td className="px-3 py-3 text-right"><Badge tone={b.tone}>{Math.round(d.ddps)}/100</Badge></td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(d.pr_merge_time_avg)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(d.code_review_time_avg)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(d.focus_time_hours)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(d.meeting_time_hours)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(d.context_switches_per_day, 0)}</td>
                      <td className={`px-3 py-3 text-right tabular-nums ${d.isOvertime ? 'text-red-700 dark:text-red-400' : ''}`}>{fmt(d.estimatedHours)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{d.wellbeing == null ? '—' : Math.round(d.wellbeing)}</td>
                      <td className="px-5 py-3"><Badge tone={burnoutTone(d.burnout)}>{d.burnout[0].toUpperCase() + d.burnout.slice(1)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedTeam !== 'all' && (
        <Card>
          <CardHeader
            title="Developer recommendations"
            subtitle={aiInsights?.source === 'groq' ? 'Generated by an AI model. May contain inaccuracies.' : aiInsights?.source === 'rule-based' ? 'Rule-based analysis of recorded developer metrics.' : undefined}
            action={aiInsights?.source ? <Badge>{aiInsights.source === 'groq' ? 'AI' : 'Rule-based'}</Badge> : undefined}
          />
          {aiLoading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
          ) : !aiInsights ? (
            <EmptyState title="No recommendations available" description="Recommendations could not be loaded for this team." />
          ) : !aiInsights.aiEnabled ? (
            <EmptyState title="Recommendations disabled" description="Enable AI for this team in the admin console to see developer recommendations." />
          ) : !aiInsights.developers?.length ? (
            <EmptyState title="No developer recommendations" description={aiInsights.message || 'No developer metrics recorded for this team.'} />
          ) : (
            <>
              {aiInsights.teamInsight && <p className="mb-4 text-sm text-slate-700 dark:text-slate-300">{aiInsights.teamInsight}</p>}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {aiInsights.developers.map((dev, idx) => {
                  const meta = developerStatusMeta(dev.status);
                  return (
                    <div key={idx} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{dev.name}</h4>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                      {dev.summary && <p className="mb-2 text-sm text-slate-700 dark:text-slate-300">{dev.summary}</p>}
                      {!!dev.notMeasured?.length && (
                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Not measured: {dev.notMeasured.join(', ')}</p>
                      )}
                      {!!dev.dataQualityWarnings?.length && (
                        <ul className="mb-2 space-y-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          {dev.dataQualityWarnings.map((w, i) => <li key={i}>Data quality: {w}</li>)}
                        </ul>
                      )}
                      {!!dev.concerns?.length && <div className="mb-2 flex flex-wrap gap-1">{dev.concerns.map((c, i) => <Badge key={i} tone="warn">{c}</Badge>)}</div>}
                      {!!dev.strengths?.length && <div className="mb-2 flex flex-wrap gap-1">{dev.strengths.map((s, i) => <Badge key={i} tone="good">{s}</Badge>)}</div>}
                      {dev.suggestion && (
                        <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-800">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Recommendation</p>
                          <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{dev.suggestion}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="How DDPS is calculated" subtitle="Daily Developer Productivity Score, 0–100. Same definition as the API (server/lib/metricFormulas.ts)." />
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
          {DDPS_FORMULA}
        </p>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Bands: 80–100 exceptional, 60–79 high, 40–59 moderate, 0–39 low. The maximum raw total is {DDPS_MAX_RAW} points, which maps to 100.
          Workload balance (derived) is the stored workload-balance value calculated from the same inputs — it is not a survey result.
        </p>
      </Card>
    </Page>
  );
};

export default DeveloperProductivity;
