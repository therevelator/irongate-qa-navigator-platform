import React, { useState, useEffect, useMemo } from 'react';
import type { Team } from '../data/mockData';
import { generateDetailedKPIs, getThreshold, statusFor, toNum } from '../data/detailedKPIs';
import type { KPIData, KPIStatus, Threshold } from '../data/detailedKPIs';
import {
  BURNOUT_DEFINITION,
  burnoutTone,
  calculateBurnoutRisk,
  chartTheme,
  developerStatusMeta,
  formatAsOf,
} from '../data/advancedFeatures';
import API_URL from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { TrendingUp, TrendingDown, Minus, Users, Info } from 'lucide-react';
import BatteryIndicator from './BatteryIndicator';
import { AreaChart, Area, Tooltip, ResponsiveContainer } from 'recharts';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, cx, toneText } from './ui';
import type { Tone } from './ui';

// Team as returned by GET /api/teams (NUMERIC columns may arrive as strings; missing values are null)
interface TeamWithKPI extends Omit<Team, 'qaScore'> {
  qaScore: number | string | null;
  kpiData?: KPIData;
  kpiThresholds?: Partial<Record<string, Partial<Threshold>>>;
}

// Business-friendly metric explanations for tooltips
export const METRIC_EXPLANATIONS: Record<string, { short: string; detailed: string }> = {
  // Quality & Testing
  'testCoverage': {
    short: 'How much of your code has automated tests',
    detailed: 'Percentage of code lines that are executed during automated tests. Higher coverage means fewer untested code paths that could contain bugs.'
  },
  'testFlakinessRate': {
    short: 'Tests that randomly pass or fail without code changes',
    detailed: 'Percentage of tests that produce inconsistent results. Flaky tests waste developer time investigating false failures and reduce trust in the test suite.'
  },
  'defectDensity': {
    short: 'Bugs per 1,000 lines of code written',
    detailed: 'Number of confirmed bugs divided by thousands of lines of code. Lower is better. Industry average is 1-5, elite teams achieve <0.5.'
  },
  'defectEscapeRate': {
    short: 'Bugs found in production vs. caught in testing',
    detailed: 'Percentage of bugs that escaped testing and were found by users in production. Lower is better. This measures how effective your QA process is.'
  },
  'codeQualityScore': {
    short: 'Overall code health score from static analysis',
    detailed: 'Aggregate score from code analysis tools measuring maintainability, complexity, duplication, and coding standards compliance. Higher is better.'
  },
  'firstPassRate': {
    short: 'Tests that pass on the first attempt',
    detailed: 'Percentage of test cases that pass without requiring fixes or retries. High rates indicate stable, well-written code and reliable tests.'
  },
  'automationCoverage': {
    short: 'How many tests are automated vs. manual',
    detailed: 'Percentage of test cases that run automatically. Higher automation means faster feedback, less manual effort, and more consistent testing.'
  },

  // Speed & Efficiency
  'avgBuildTimeMinutes': {
    short: 'Time to compile and build your application',
    detailed: 'Average minutes from code commit to completed build. Faster builds mean quicker feedback for developers and more deployments per day.'
  },
  'testExecutionTimeMinutes': {
    short: 'Time to run the full test suite',
    detailed: 'Average minutes to complete all automated tests. Faster tests enable more frequent runs and quicker release cycles.'
  },
  'leadTimeDays': {
    short: 'Days from code commit to production deployment',
    detailed: 'Time from first code commit to when it\'s live in production. Shorter lead time = faster delivery of features to customers. Elite: <1 day.'
  },
  'mttrHours': {
    short: 'Average hours to fix issues when they occur',
    detailed: 'Mean Time To Recovery - how quickly you restore service after an incident. Lower is better. Elite teams recover in <1 hour.'
  },
  'parallelTestEfficiency': {
    short: 'How well tests run in parallel',
    detailed: 'Ratio of sequential vs. parallel test duration. Higher means your tests effectively utilize parallel execution to save time.'
  },
  'deploymentFrequencyPerWeek': {
    short: 'How often you deploy to production',
    detailed: 'Number of production deployments per week. More frequent deploys = smaller changes = lower risk. Elite: multiple per day.'
  },

  // Agile & Process
  'sprintVelocity': {
    short: 'Story points delivered per sprint',
    detailed: 'Average amount of work completed in a sprint. Stable velocity helps predict delivery dates. Focus on consistency over absolute numbers.'
  },
  'sprintCommitmentRate': {
    short: 'Percentage of committed work actually delivered',
    detailed: 'How much of what you planned actually gets done. High rates indicate accurate estimation and reliable delivery promises.'
  },
  'sprintCarryover': {
    short: 'Work that moves to the next sprint',
    detailed: 'Percentage of incomplete work that rolls over. Lower is better. High carryover suggests overcommitment or blockers.'
  },
  'blockedTimeHours': {
    short: 'Time tasks spend waiting or blocked',
    detailed: 'Average hours that work items spend in blocked status. Lower indicates smoother workflow with fewer dependencies and bottlenecks.'
  },
  'sizingAccuracy': {
    short: 'How accurate your task estimates are',
    detailed: 'Ratio of actual vs. estimated effort. 1.0 = perfect estimation. <1.0 = overestimated, >1.0 = underestimated.'
  },
  'automationRoi': {
    short: 'Return on investment from test automation',
    detailed: 'Value generated by automation divided by its cost. Calculated as (Manual hours saved × hourly rate) ÷ Automation investment. Higher is better.'
  },

  // Reliability & Stability
  'changeFailureRate': {
    short: 'Percentage of deployments causing issues',
    detailed: 'Proportion of changes that result in failures requiring rollback or hotfix. Lower is better. Elite teams: <5%.'
  },
  'mtbfHours': {
    short: 'Hours between production failures',
    detailed: 'Mean Time Between Failures - average uptime between incidents. Higher means more stable systems. Target: >100 hours.'
  },
  'availability': {
    short: 'System uptime percentage',
    detailed: 'Percentage of time the system is operational. 99.9% = ~8.7 hours downtime/year. 99.99% = ~52 minutes downtime/year.'
  },
  'infraFailures': {
    short: 'Infrastructure incidents count',
    detailed: 'Number of infrastructure-related failures (servers, network, databases). Lower indicates more stable underlying systems.'
  },

  // Business Impact
  'qaScore': {
    short: 'Overall quality score for the team',
    detailed: 'Composite 0–100 quality score stored with the team\'s latest KPI snapshot. Higher is better.'
  },
  'technicalDebtScore': {
    short: 'Accumulated code issues needing attention',
    detailed: 'Score reflecting unaddressed code quality issues, outdated dependencies, and shortcuts taken. Lower is better. High debt slows future development.'
  },

  // Developer Productivity
  'prMergeTime': {
    short: 'Hours from PR creation to merge',
    detailed: 'Time pull requests spend in review before merging. Shorter times indicate efficient code review processes.'
  },
  'codeReviewTime': {
    short: 'Hours spent reviewing code',
    detailed: 'Average time to complete a code review. Balance speed with thoroughness - too fast may miss issues, too slow blocks progress.'
  },
  'focusTime': {
    short: 'Uninterrupted coding hours per day',
    detailed: 'Hours of concentrated work without meetings or interruptions. More uninterrupted time generally means more deep work.'
  },
  'meetingTime': {
    short: 'Hours spent in meetings per day',
    detailed: 'Average daily meeting time. Some meetings are essential, but excess meetings reduce productive coding time.'
  },
  'contextSwitches': {
    short: 'Task switches per day',
    detailed: 'Number of times developers switch between different tasks. Fewer switches = deeper focus = higher quality work.'
  },
  'happinessScore': {
    short: 'Wellbeing score (derived) — not a survey',
    detailed: 'Derived 0–100 workload-balance score calculated from focus time, meetings, context switches, PR and review time. It is not self-reported satisfaction.'
  }
};

interface TeamMember {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  avatar_url?: string;
}

interface DevMetricRow {
  developerId?: string;
  name: string;
  prMergeTimeHours: number | null;
  codeReviewTimeHours: number | null;
  focusTimeHours: number | null;
  meetingTimeHours: number | null;
  contextSwitchesPerDay: number | null;
  happinessScore: number | null;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  metrics: DevMetricRow | null;
}

interface TeamAISuggestions {
  teamId: string;
  teamName: string;
  qaScore: number | null;
  aiEnabled: boolean;
  source?: 'groq' | 'rule-based';
  message?: string;
  strongpoints: string[];
  areasOfImprovement: string[];
  actionPlan: { priority: string; initiative: string; owner: string; timebox: string; kpi: string }[];
}

interface DeveloperAISuggestion {
  name: string;
  developerId?: string;
  status?: string;
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  suggestion?: string;
}

interface DeveloperAISuggestions {
  teamId: string;
  aiEnabled: boolean;
  source?: 'groq' | 'rule-based';
  developers?: DeveloperAISuggestion[];
  teamInsight?: string;
  metrics?: DevMetricRow[];
  message?: string;
}

type HistoryPoint = { date: string; value: number };

interface TeamDetailViewProps {
  team: TeamWithKPI;
  onBack: () => void;
}

const STATUS_BADGE: Record<KPIStatus, { tone: Tone; label: string }> = {
  good: { tone: 'good', label: 'On target' },
  warning: { tone: 'warn', label: 'Watch' },
  critical: { tone: 'bad', label: 'Off target' },
  neutral: { tone: 'neutral', label: 'Tracked' },
  'no-data': { tone: 'neutral', label: 'No data' },
};

const DIGITS: Partial<Record<string, number>> = { defectDensity: 2, systemAvailability: 3, infrastructureFailures: 0, sprintVelocity: 0, deploymentFrequencyPerWeek: 1 };

const statusTone = (s: KPIStatus): Tone => STATUS_BADGE[s].tone;

const fmt = (v: number | null | undefined, digits = 1) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(digits));

const thresholdText = (t: Threshold | null, unit: string) => {
  if (!t) return null;
  const u = unit && !unit.startsWith('/') && unit !== '%' ? ` ${unit}` : unit;
  return t.lowerIsBetter ? `Target ≤ ${t.good}${u} · watch ≤ ${t.warning}${u}` : `Target ≥ ${t.good}${u} · watch ≥ ${t.warning}${u}`;
};

/** Change between the last two snapshots; tone respects metric polarity. */
const describeChange = (history: HistoryPoint[], lowerIsBetter: boolean, hasDirection: boolean) => {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const delta = last.value - prev.value;
  const direction: 'up' | 'down' | 'flat' = Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'up' : 'down';
  const improved = direction === 'flat' ? null : lowerIsBetter ? direction === 'down' : direction === 'up';
  const tone: Tone = !hasDirection || improved === null ? 'neutral' : improved ? 'good' : 'bad';
  const pct = prev.value !== 0 ? (delta / Math.abs(prev.value)) * 100 : null;
  return { delta, pct, direction, tone, prevDate: prev.date };
};

const TrendLine: React.FC<{ change: ReturnType<typeof describeChange>; unit?: string; usePoints?: boolean }> = ({ change, unit = '', usePoints }) => {
  if (!change) return null;
  const Icon = change.direction === 'up' ? TrendingUp : change.direction === 'down' ? TrendingDown : Minus;
  const amount = usePoints || change.pct == null
    ? `${change.delta > 0 ? '+' : ''}${change.delta.toFixed(1)}${unit}`
    : `${change.pct > 0 ? '+' : ''}${change.pct.toFixed(1)}%`;
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', toneText(change.tone))}>
      <Icon size={13} aria-hidden />
      {amount} vs {formatAsOf(change.prevDate) ?? 'previous snapshot'}
    </span>
  );
};

const InfoTip: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative group inline-flex">
    <Info size={13} className="text-slate-400 dark:text-slate-500 cursor-help" aria-label={text} />
    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {text}
    </span>
  </span>
);

const TeamDetailView: React.FC<TeamDetailViewProps> = ({ team, onBack }) => {
  const detailedKPIs = useMemo(() => generateDetailedKPIs(team), [team]);
  const { isDark } = useTheme();
  const { user } = useAuth();
  const ct = chartTheme(isDark);

  const isOwnTeam =
    (user?.primaryTeamId != null && team?.id != null && String(user.primaryTeamId) === String(team.id)) ||
    (Array.isArray(user?.assignedTeams) && team?.id != null && user!.assignedTeams!.some(tid => String(tid) === String(team.id)));

  // Only leads (own team), managers and admins can see developer stats and AI insights
  const canViewDeveloperInsights =
    user?.role === 'super_admin' ||
    user?.role === 'qa_manager' ||
    (user?.role === 'team_lead' && isOwnTeam);

  const kpi: KPIData = team.kpiData || {};
  const [snapshotDate, setSnapshotDate] = useState<string | null>(team.snapshotDate ?? kpi.snapshotDate ?? null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [aiSuggestions, setAISuggestions] = useState<TeamAISuggestions | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [aiError, setAIError] = useState<string | null>(null);
  const [devAISuggestions, setDevAISuggestions] = useState<DeveloperAISuggestions | null>(null);
  const [devAILoading, setDevAILoading] = useState(false);
  const [devMetricsUnavailable, setDevMetricsUnavailable] = useState<string | null>(null);
  const [metricIntervals, setMetricIntervals] = useState<Record<string, { interval_value: number; interval_unit: string }>>({});
  const [kpiHistory, setKpiHistory] = useState<Record<string, HistoryPoint[]>>({});

  const getIntervalText = (historyKey: string): string => {
    const interval = metricIntervals[historyKey];
    if (!interval) return 'No snapshots in the last 90 days';
    const { interval_value, interval_unit } = interval;
    const unitLabel = interval_value === 1 ? interval_unit.replace(/s$/, '') : interval_unit;
    return `No snapshots in the last 90 days · updates every ${interval_value} ${unitLabel}`;
  };

  useEffect(() => {
    fetch(`${API_URL}/settings/metric-intervals`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        const map: Record<string, { interval_value: number; interval_unit: string }> = {};
        data.intervals?.forEach((i: any) => { map[i.metric_key] = { interval_value: i.interval_value, interval_unit: i.interval_unit }; });
        setMetricIntervals(map);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/teams/${team.id}/kpi-history?days=90`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => setKpiHistory(data?.history || {}))
      .catch(() => setKpiHistory({}));
  }, [team.id]);

  // Team members + their recorded developer metrics (no placeholders for members without a row)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setMembersLoading(true);
      try {
        const response = await fetch(`${API_URL}/teams/${team.id}`, { credentials: 'include' });
        if (!response.ok) { if (!cancelled) setMembers([]); return; }
        const data = await response.json();
        const list: TeamMember[] = data.team?.members || [];
        const snap = data.team?.kpiData?.snapshotDate ?? data.team?.snapshotDate ?? null;
        if (!cancelled && snap) setSnapshotDate(snap);

        let byId: Record<string, DevMetricRow> = {};
        let byName: Record<string, DevMetricRow> = {};
        if (canViewDeveloperInsights) {
          const metricsResponse = await fetch(`${API_URL}/teams/${team.id}/developer-ai-suggestions`, { credentials: 'include' });
          if (metricsResponse.ok) {
            const metricsData: DeveloperAISuggestions = await metricsResponse.json();
            if (!cancelled) setDevAISuggestions(metricsData);
            (metricsData.metrics || []).forEach((m: any) => {
              const row = normalizeMetric(m);
              if (row.developerId) byId[String(row.developerId)] = row;
              if (row.name) byName[row.name.toLowerCase()] = row;
            });
            if (!cancelled) setDevMetricsUnavailable(null);
          } else if (!cancelled) {
            setDevMetricsUnavailable(
              metricsResponse.status === 429
                ? 'Developer metrics could not be loaded (rate limited). Try again in a minute.'
                : 'Developer metrics are not available for your role.',
            );
          }
        } else if (!cancelled) {
          setDevMetricsUnavailable('Developer metrics are visible to team leads, managers and admins.');
        }

        if (!cancelled) {
          setMembers(list.map((m) => {
            const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email;
            return { id: String(m.id), name, email: m.email, metrics: byId[String(m.id)] ?? byName[name.toLowerCase()] ?? null };
          }));
        }
      } catch (error) {
        console.error('Error fetching team members:', error);
        if (!cancelled) setMembers([]);
      } finally {
        if (!cancelled) { setMembersLoading(false); setDevAILoading(false); }
      }
    };
    if (canViewDeveloperInsights) setDevAILoading(true);
    load();
    return () => { cancelled = true; };
  }, [team.id, canViewDeveloperInsights]);

  useEffect(() => {
    if (!canViewDeveloperInsights) return;
    let cancelled = false;
    setAILoading(true);
    setAIError(null);
    fetch(`${API_URL}/teams/${team.id}/ai-suggestions`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          if (!cancelled) setAIError(err.error || 'Failed to load recommendations');
          return;
        }
        const data = await r.json();
        if (!cancelled) setAISuggestions(data as TeamAISuggestions);
      })
      .catch(() => { if (!cancelled) setAIError('Failed to load recommendations'); })
      .finally(() => { if (!cancelled) setAILoading(false); });
    return () => { cancelled = true; };
  }, [team.id, canViewDeveloperInsights]);

  const asOf = formatAsOf(snapshotDate);
  const qaScore = toNum(team.qaScore);
  const qaThreshold = getThreshold('qaScore', team.kpiThresholds);
  const qaStatus = statusFor(qaScore, qaThreshold);
  const qaChange = describeChange(kpiHistory.qa_score || [], false, true);
  const debt = toNum(team.technicalDebtScore);
  const debtThreshold = getThreshold('technicalDebtScore', team.kpiThresholds);
  const debtStatus = statusFor(debt, debtThreshold);
  const sizing = toNum(team.taskSizingAccuracy);

  const headline: { key: string; label: string }[] = [
    { key: 'test-coverage', label: 'Test coverage' },
    { key: 'defect-density', label: 'Defect density' },
    { key: 'automation-coverage', label: 'Automation coverage' },
    { key: 'build-time', label: 'Avg build time' },
    { key: 'mttr', label: 'Mean time to recovery' },
    { key: 'mtbf', label: 'Mean time between failures' },
  ];
  const kpiById = (id: string) => detailedKPIs.find(k => k.id === id)!;

  const categories = [
    { id: 'quality', name: 'Quality & testing' },
    { id: 'speed', name: 'Speed & efficiency' },
    { id: 'agile', name: 'Agile & process' },
    { id: 'reliability', name: 'Reliability & stability' },
  ] as const;

  // Members visible to this viewer: QA engineers only see themselves
  const visibleMembers = members.filter(m => (user?.role === 'qa_engineer' ? m.id === String(user.id) : true));
  const showMembers =
    canViewDeveloperInsights || (user?.role === 'qa_engineer' && String(team.id) === String(user?.primaryTeamId));

  const metricsFor = (dev: DeveloperAISuggestion): DevMetricRow | undefined =>
    devAISuggestions?.metrics?.map(normalizeMetric).find(m =>
      (dev.developerId && m.developerId && String(m.developerId) === String(dev.developerId)) || m.name === dev.name,
    );

  return (
    <Page className="space-y-6" >
      <div data-testid="team-detail">
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
          <button onClick={onBack} className="hover:text-slate-900 hover:underline dark:hover:text-white" data-testid="back-to-dashboard">
            Overview
          </button>
          <span aria-hidden>/</span>
          <span className="text-slate-700 dark:text-slate-300">{team.name}</span>
        </nav>
        <PageIntro
          title={team.name}
          description={
            <>
              {team.department}
              {' · '}
              {asOf ? <>KPI snapshot as of {asOf}</> : 'No KPI snapshot recorded'}
            </>
          }
        />

        {/* Headline scores */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="team-kpis">
          <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <BatteryIndicator percentage={qaScore} size="md" good={qaThreshold?.good} warn={qaThreshold?.warning} label="QA score" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                QA score <InfoTip text={METRIC_EXPLANATIONS.qaScore.detailed} />
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {qaScore == null ? '—' : Math.round(qaScore)}
                <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">/100</span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(qaStatus)}>{STATUS_BADGE[qaStatus].label}</Badge>
                {qaChange ? <TrendLine change={qaChange} usePoints unit=" pts" /> : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">No earlier snapshot to compare</span>
                )}
              </div>
            </div>
          </div>
          <StatTile
            label="Technical debt score"
            value={debt == null ? '—' : Math.round(debt)}
            unit={debt == null ? undefined : '/100'}
            tone={statusTone(debtStatus)}
            caption={debt == null ? 'No data recorded' : `Lower is better · ${STATUS_BADGE[debtStatus].label.toLowerCase()}`}
          />
          <StatTile
            label="Task sizing accuracy"
            value={sizing == null ? '—' : sizing.toFixed(2)}
            unit={sizing == null ? undefined : '× estimate'}
            tone={sizing == null ? 'neutral' : Math.abs(sizing - 1) <= 0.15 ? 'good' : Math.abs(sizing - 1) <= 0.3 ? 'warn' : 'bad'}
            caption={sizing == null ? 'No data recorded' : sizing < 0.85 ? 'Overestimated (actual < estimate)' : sizing > 1.15 ? 'Underestimated (actual > estimate)' : 'Within ±15% of estimate'}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {headline.map(h => {
            const k = kpiById(h.key);
            return (
              <StatTile
                key={h.key}
                label={h.label}
                value={k.value == null ? '—' : fmt(k.value, k.key === 'defectDensity' ? 2 : 1)}
                unit={k.value == null ? undefined : k.unit}
                tone={statusTone(k.status)}
                caption={k.value == null ? 'No data recorded' : STATUS_BADGE[k.status].label}
              />
            );
          })}
        </div>
      </div>

      {/* Team members */}
      {showMembers && (
        <Card padded={false}>
          <div className="flex items-start justify-between gap-4 p-5 pb-0">
            <CardHeader
              title="Team members"
              subtitle={<>Latest recorded developer metrics. Burnout risk: {BURNOUT_DEFINITION}</>}
            />
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
              {membersLoading ? 'Loading…' : `${visibleMembers.length} ${visibleMembers.length === 1 ? 'member' : 'members'}`}
            </span>
          </div>
          {membersLoading ? (
            <div className="px-5 pb-5 text-sm text-slate-500 dark:text-slate-400">Loading members…</div>
          ) : visibleMembers.length === 0 ? (
            <EmptyState title="No team members" description="This team doesn't have any members assigned yet." icon={<Users size={28} />} />
          ) : (
            <div className="overflow-x-auto" data-testid="team-members-section">
              {devMetricsUnavailable && (
                <p className="px-5 pb-3 text-xs text-slate-500 dark:text-slate-400">{devMetricsUnavailable}</p>
              )}
              <table className="min-w-full text-sm">
                <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-2.5">Member</th>
                    <th className="px-3 py-2.5 text-right">PR merge (h)</th>
                    <th className="px-3 py-2.5 text-right">Review (h)</th>
                    <th className="px-3 py-2.5 text-right">Focus (h/day)</th>
                    <th className="px-3 py-2.5 text-right">Meetings (h/day)</th>
                    <th className="px-3 py-2.5 text-right">Context switches</th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1">Wellbeing score (derived) <InfoTip text={METRIC_EXPLANATIONS.happinessScore.detailed} /></span>
                    </th>
                    <th className="px-5 py-2.5">Burnout risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleMembers.map(m => {
                    const x = m.metrics;
                    const risk = x && x.focusTimeHours != null && x.meetingTimeHours != null && x.contextSwitchesPerDay != null
                      ? calculateBurnoutRisk({ focus_time_hours: x.focusTimeHours, meeting_time_hours: x.meetingTimeHours, context_switches_per_day: x.contextSwitchesPerDay })
                      : null;
                    return (
                      <tr key={m.id} data-testid="team-member-card" className="text-slate-700 dark:text-slate-300">
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-900 dark:text-white">{m.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{m.email}</div>
                        </td>
                        {x ? (
                          <>
                            <td className="px-3 py-3 text-right tabular-nums">{fmt(x.prMergeTimeHours)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{fmt(x.codeReviewTimeHours)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{fmt(x.focusTimeHours)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{fmt(x.meetingTimeHours)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{fmt(x.contextSwitchesPerDay, 0)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{x.happinessScore == null ? '—' : `${Math.round(x.happinessScore)}/100`}</td>
                            <td className="px-5 py-3">
                              {risk ? <Badge tone={burnoutTone(risk)}>{risk[0].toUpperCase() + risk.slice(1)}</Badge> : <span className="text-slate-400">—</span>}
                            </td>
                          </>
                        ) : (
                          <td colSpan={7} className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{devMetricsUnavailable ? 'Not available' : 'No metrics recorded'}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* KPI categories */}
      {categories.map(category => (
        <section key={category.id}>
          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{category.name}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {detailedKPIs.filter(k => k.category === category.id).map(k => {
              const history = kpiHistory[k.historyKey] || [];
              const change = describeChange(history, k.lowerIsBetter, !!k.threshold);
              const target = thresholdText(k.threshold, k.unit);
              return (
                <Card key={k.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white">{k.name}</h4>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{k.description}</p>
                    </div>
                    <Badge tone={statusTone(k.status)} className="shrink-0">{STATUS_BADGE[k.status].label}</Badge>
                  </div>
                  <p className="mt-3 flex items-baseline gap-1">
                    <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                      {k.value == null ? '—' : fmt(k.value, DIGITS[k.key] ?? 1)}
                    </span>
                    {k.value != null && k.unit && <span className="text-sm text-slate-500 dark:text-slate-400">{k.unit}</span>}
                  </p>
                  <div className="mt-1 min-h-[1.25rem]">
                    {change ? <TrendLine change={change} /> : (
                      <span className="text-xs text-slate-500 dark:text-slate-400">{target ?? (k.lowerIsBetter ? 'Lower is better' : 'No target set')}</span>
                    )}
                  </div>
                  {history.length >= 2 ? (
                    <div className="mt-3 h-20">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={history} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                          <Tooltip
                            contentStyle={ct.tooltip.contentStyle}
                            labelStyle={ct.tooltip.labelStyle}
                            itemStyle={ct.tooltip.itemStyle}
                            formatter={(v: any) => [`${Number(v).toFixed(2)}${k.unit ? ` ${k.unit}` : ''}`, k.name]}
                          />
                          <Area type="monotone" dataKey="value" stroke={ct.series} fill={ct.series} fillOpacity={0.08} strokeWidth={1.5} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                      {history.length === 1 ? `1 snapshot in the last 90 days (${formatAsOf(history[0].date)})` : getIntervalText(k.historyKey)}
                    </p>
                  )}
                  {change && target && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{target}</p>}
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      {/* Team recommendations */}
      {canViewDeveloperInsights && (
        <Card>
          <div data-testid="ai-insights-header">
            <CardHeader
              title="Team recommendations"
              subtitle={
                aiLoading ? 'Generating recommendations…' :
                  aiSuggestions?.source === 'groq' ? 'Generated by an AI model from the metrics above. May contain inaccuracies — verify before acting.' :
                    aiSuggestions?.source === 'rule-based' ? 'Rule-based analysis of the metrics above.' : undefined
              }
              action={aiSuggestions?.source ? <Badge tone="neutral">{aiSuggestions.source === 'groq' ? 'AI' : 'Rule-based'}</Badge> : undefined}
            />
          </div>
          {aiError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">{aiError}</p>
          ) : aiLoading ? null : !aiSuggestions ? (
            <EmptyState title="No recommendations yet" description="Recommendations appear once metrics are recorded for this team." />
          ) : aiSuggestions.aiEnabled === false ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Recommendations are disabled for this team. Enable them in the admin console.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ListBlock title="Strengths" tone="good" items={aiSuggestions.strongpoints} empty="None identified" />
              <ListBlock title="Areas to improve" tone="warn" items={aiSuggestions.areasOfImprovement} empty="None identified" />
              <div>
                <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Action plan ({aiSuggestions.actionPlan?.length ?? 0})</p>
                <div className="space-y-2">
                  {(aiSuggestions.actionPlan?.length ?? 0) > 0 ? aiSuggestions.actionPlan.map((item, idx) => (
                    <div key={idx} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Badge tone={item.priority === 'Urgent' ? 'bad' : item.priority === 'Moderate' ? 'warn' : 'neutral'}>{item.priority}</Badge>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{item.timebox}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{item.initiative}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Owner: {item.owner} · KPI: {item.kpi}</p>
                    </div>
                  )) : <p className="text-sm text-slate-500 dark:text-slate-400">No action items</p>}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Developer recommendations */}
      {canViewDeveloperInsights && (
        <Card>
          <CardHeader
            title="Developer recommendations"
            subtitle={
              devAILoading ? 'Analysing developer metrics…' :
                devAISuggestions?.source === 'groq' ? 'Generated by an AI model. May contain inaccuracies.' :
                  devAISuggestions?.source === 'rule-based' ? 'Rule-based analysis of recorded developer metrics.' : undefined
            }
            action={devAISuggestions?.source ? <Badge tone="neutral">{devAISuggestions.source === 'groq' ? 'AI' : 'Rule-based'}</Badge> : undefined}
          />
          {devAILoading ? null : !devAISuggestions ? (
            <EmptyState title="No developer recommendations" description={devMetricsUnavailable ?? 'Developer recommendations could not be loaded.'} />
          ) : devAISuggestions.aiEnabled === false ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {devAISuggestions.message || 'Recommendations are disabled for this team.'}
            </p>
          ) : !devAISuggestions.developers?.length ? (
            <EmptyState title="No developer metrics recorded" description={devAISuggestions.message || 'Add developer metrics in Manual metrics.'} />
          ) : (
            <>
              {devAISuggestions.teamInsight && (
                <p className="mb-4 text-sm text-slate-700 dark:text-slate-300">{devAISuggestions.teamInsight}</p>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {devAISuggestions.developers.map((dev, idx) => {
                  const meta = developerStatusMeta(dev.status);
                  const m = metricsFor(dev);
                  return (
                    <div key={`${dev.name}-${idx}`} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{dev.name}</h4>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                      {m && (
                        <dl className="mb-3 grid grid-cols-5 gap-1 text-center">
                          {[
                            ['PR', m.prMergeTimeHours, 'h'],
                            ['Review', m.codeReviewTimeHours, 'h'],
                            ['Focus', m.focusTimeHours, 'h'],
                            ['Mtgs', m.meetingTimeHours, 'h'],
                            ['Ctx', m.contextSwitchesPerDay, ''],
                          ].map(([label, v, u]) => (
                            <div key={label as string} className="rounded bg-slate-50 px-1 py-1.5 dark:bg-slate-800/60">
                              <dt className="text-[10px] uppercase text-slate-500 dark:text-slate-400">{label as string}</dt>
                              <dd className="text-xs font-semibold tabular-nums text-slate-900 dark:text-white">
                                {v == null ? '—' : `${fmt(v as number, u ? 1 : 0)}${u}`}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {dev.summary && <p className="mb-2 text-sm text-slate-700 dark:text-slate-300">{dev.summary}</p>}
                      {!!dev.concerns?.length && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {dev.concerns.map((c, i) => <Badge key={i} tone="warn">{c}</Badge>)}
                        </div>
                      )}
                      {!!dev.strengths?.length && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {dev.strengths.map((s, i) => <Badge key={i} tone="good">{s}</Badge>)}
                        </div>
                      )}
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
    </Page>
  );
};

const ListBlock: React.FC<{ title: string; tone: Tone; items?: string[]; empty: string }> = ({ title, tone, items, empty }) => (
  <div>
    <p className={cx('mb-2 text-xs font-medium', toneText(tone))}>{title} ({items?.length ?? 0})</p>
    {items && items.length > 0 ? (
      <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
        {items.map((p, i) => (
          <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden />{p}</li>
        ))}
      </ul>
    ) : <p className="text-sm text-slate-500 dark:text-slate-400">{empty}</p>}
  </div>
);

/** Server rows can carry NUMERIC strings or nulls; never coerce missing values to 0. */
function normalizeMetric(m: any): DevMetricRow {
  return {
    developerId: m.developerId ?? m.developer_id,
    name: m.name ?? '',
    prMergeTimeHours: toNum(m.prMergeTimeHours),
    codeReviewTimeHours: toNum(m.codeReviewTimeHours),
    focusTimeHours: toNum(m.focusTimeHours),
    meetingTimeHours: toNum(m.meetingTimeHours),
    contextSwitchesPerDay: toNum(m.contextSwitchesPerDay),
    happinessScore: toNum(m.happinessScore),
  };
}

export default TeamDetailView;
