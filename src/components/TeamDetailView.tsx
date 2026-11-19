import React, { useState, useEffect, useMemo } from 'react';
import { LastUpdatedNote } from './LastUpdatedNote';
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
  QA_SCORE_FORMULA,
} from '../data/advancedFeatures';
import API_URL from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { canViewIndividualDevelopers, canViewTeamAnalytics, canViewTeamTv, canUseFormulaMode } from '../../server/lib/userPolicy';
import { policyActorOf } from '../lib/policyActor';
import { TrendingUp, TrendingDown, Minus, Users, Info, MonitorPlay, Mail, Link2, ArrowUpRight, ArrowDownRight, Trophy, Target, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { tvMailto, tvShareUrl } from './tv/tvNavigation';
import HeroBattery from './HeroBattery';
import { AreaChart, Area, Tooltip, ResponsiveContainer, YAxis, ReferenceLine } from 'recharts';
import { statusWithTarget, targetLabel, watchBand } from '../lib/targetText';
import { qaScoreInputLosses } from '../../server/lib/metricFormulas';
import { ROLE_LABELS, ROLE_LABELS_PLURAL } from '../../server/lib/roleLabels';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, cx, toneText, buttonClass } from './ui';
import type { Tone } from './ui';
import MetricInfoTrigger from './MetricInfoTrigger';
import { FormulaSwitch } from './FormulaNote';
import { useShowFormulas } from '../hooks/useShowFormulas';
import { SIZING_ACCURACY_TOLERANCE } from '../data/metricCatalog';
import type { MetricCatalogKey } from '../data/metricCatalog';
import { changeOverDays, describeChange, lastDays, type HistoryPoint } from '../data/kpiTrend';
import { ConfidenceNote, SampleMarker, StaleNote, type ConfidenceInfo } from './MetricQuality';
import SampleDataBanner from './SampleDataBanner';
import { PulseTeamSummary } from './PulseSurveyResults';
import ActionsPanel, { type ActionDraft } from './ActionsPanel';
import { canWriteTeamData } from '../../server/lib/userPolicy';

// Team as returned by GET /api/teams (NUMERIC columns may arrive as strings; missing values are null)
interface TeamWithKPI extends Omit<Team, 'qaScore'> {
  qaScore: number | string | null;
  kpiData?: KPIData;
  kpiThresholds?: Partial<Record<string, Partial<Threshold>>>;
  /** Per-field provenance from GET /api/teams: { column: { source, recorded_at } }. */
  kpiFieldSources?: Record<string, { source?: string; recorded_at?: string; carried_forward?: boolean } | undefined>;
  /** What the QA score is based on: stale and missing inputs are left out (GET /api/teams). */
  qaScoreConfidence?: ConfidenceInfo | null;
  /** camelCase KPI key -> staleness of its latest value (server/lib/staleness.ts). */
  kpiStaleness?: Record<string, { recordedAt: string | null; stale: boolean; staleSince: string | null; source: string | null } | undefined>;
  /** Any value of the latest snapshot is generated sample data. */
  sampleData?: boolean;
}

const INTERVAL_UNIT_MS: Record<string, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
  months: 30 * 86_400_000,
};

/** "manual · as of 17 Nov 2026" caption for a KPI, or null when no provenance is recorded. */
const sourceCaption = (fs?: { source?: string; recorded_at?: string }): string | null => {
  if (!fs?.source) return null;
  const label = fs.source === 'manual' ? 'Manual entry' : fs.source === 'unknown' ? 'Source not recorded' : fs.source;
  const asOf = formatAsOf(fs.recorded_at);
  return asOf ? `${label} · as of ${asOf}` : label;
};

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
    detailed: QA_SCORE_FORMULA
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
    short: 'Workload balance (derived) — not a survey',
    detailed: 'Derived 0–100 workload-balance score calculated from focus time, meetings, context switches, PR and review time. A workload signal: it is not self-reported satisfaction and not wellbeing (see Wellbeing (survey)).'
  }
};

interface TeamPerson { name: string; jobTitle: string | null }

/** Header facts from GET /api/teams/:id (server/routes/teams.ts). */
interface TeamFacts {
  qaRank: { position: number; of: number; scope: 'company' | 'scope' } | null;
  memberCount: number | null;
  memberRoles: Record<string, number>;
  teamLeads: TeamPerson[];
  productOwners: TeamPerson[];
  membersHidden: boolean;
}

interface TeamMember {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  avatar_url?: string;
  developer_insights_enabled?: boolean | null;
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
  /** The person turned developer insights off, so their metrics are not shown. */
  insightsDisabled: boolean;
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
  notMeasured?: string[];
  dataQualityWarnings?: string[];
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

interface TeamDetailViewProps {
  team: TeamWithKPI;
  onBack: () => void;
  /** Open this team in TV / meeting mode (/tv?team=…). */
  onOpenTv?: (teamId: string) => void;
  /** Open this team's wellbeing pulse (answer the survey, full results). */
  onOpenPulse?: (teamId: string) => void;
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

/** "Target ≥ 80% · Watch: 70–80%": the target valid at the value's date and the watch band (src/lib/targetText.ts). */
const thresholdText = (t: Threshold | null, unit: string) => {
  if (!t) return null;
  return `${targetLabel(t, unit)} · ${watchBand(t, unit)}`;
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
    <Info size={13} className="text-slate-500 dark:text-slate-400 cursor-help" aria-label={text} />
    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {text}
    </span>
  </span>
);

const TeamDetailView: React.FC<TeamDetailViewProps> = ({ team, onBack, onOpenTv, onOpenPulse }) => {
  const detailedKPIs = useMemo(() => generateDetailedKPIs(team), [team]);
  const { isDark } = useTheme();
  const { user } = useAuth();
  const ct = chartTheme(isDark);

  // "Show formulas & data sources" (super admin demo aid; same preference as Manual metrics).
  const [showFormulasPref, setShowFormulas] = useShowFormulas();
  const canShowFormulas = !!user && canUseFormulaMode(policyActorOf(user));
  const showFormulas = canShowFormulas && showFormulasPref;

  // Opening a team keeps the same app view, so start the detail page at the top.
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [team.id]);

  const isOwnTeam =
    (user?.primaryTeamId != null && team?.id != null && String(user.primaryTeamId) === String(team.id)) ||
    (Array.isArray(user?.assignedTeams) && team?.id != null && user!.assignedTeams!.some(tid => String(tid) === String(team.id)));

  // Shared rules (server/lib/userPolicy.ts): other developers' stats and AI insights for
  // super_admin (any team), qa_manager (own department) and team_lead (own team); a
  // qa_engineer / viewer sees only their own row, on their own team. The API enforces both.
  const policyActor = user ? policyActorOf(user) : null;
  const policyTeam = { id: String(team.id), department_id: (team as any).department_id != null ? String((team as any).department_id) : null };
  const canViewDeveloperInsights = !!policyActor && canViewIndividualDevelopers(policyActor, policyTeam);
  const canViewOwnRow = !canViewDeveloperInsights && !!policyActor && canViewTeamAnalytics(policyActor, policyTeam);
  // TV mode: any team of the company, for every role (canViewTeamTv; GET /api/tv/teams/:id).
  const canOpenTv = !!policyActor && canViewTeamTv(policyActor, policyTeam);

  const kpi: KPIData = team.kpiData || {};
  const [snapshotDate, setSnapshotDate] = useState<string | null>(team.snapshotDate ?? kpi.snapshotDate ?? null);
  // Newest value time, and whether it is over a day old ("Last updated", FI-22).
  const [freshness, setFreshness] = useState<{ at: string | null; outdated: boolean }>({ at: team.lastUpdated ?? null, outdated: !!team.dataOutdated });
  useEffect(() => { setFreshness({ at: team.lastUpdated ?? null, outdated: !!team.dataOutdated }); }, [team.lastUpdated, team.dataOutdated]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [aiSuggestions, setAISuggestions] = useState<TeamAISuggestions | null>(null);
  // Tracked actions (ActionsPanel): "Create action" on a recommendation opens its form pre-filled.
  const [actionDraft, setActionDraft] = useState<ActionDraft | null>(null);
  const clearActionDraft = React.useCallback(() => setActionDraft(null), []);
  const [aiLoading, setAILoading] = useState(false);
  const [aiError, setAIError] = useState<string | null>(null);
  const [devAISuggestions, setDevAISuggestions] = useState<DeveloperAISuggestions | null>(null);
  const [devAILoading, setDevAILoading] = useState(false);
  const [devMetricsUnavailable, setDevMetricsUnavailable] = useState<string | null>(null);
  const [metricIntervals, setMetricIntervals] = useState<Record<string, { interval_value: number; interval_unit: string }>>({});
  const [kpiHistory, setKpiHistory] = useState<Record<string, HistoryPoint[]>>({});
  // GET /api/teams/:id extras for the header: rank in the caller's scope, people per role, leads and Product Owners.
  const [teamFacts, setTeamFacts] = useState<TeamFacts | null>(null);
  const [trendDays, setTrendDays] = useState<30 | 90>(30);
  const [historyForbidden, setHistoryForbidden] = useState(false);

  const intervalLabel = (historyKey: string): string | null => {
    const interval = metricIntervals[historyKey];
    if (!interval) return null;
    const { interval_value, interval_unit } = interval;
    const unitLabel = interval_value === 1 ? interval_unit.replace(/s$/, '') : interval_unit;
    return `${interval_value} ${unitLabel}`;
  };

  const getIntervalText = (historyKey: string): string => {
    const every = intervalLabel(historyKey);
    return every ? `No snapshots in the last 90 days · expected every ${every}` : 'No snapshots in the last 90 days';
  };

  /**
   * Stale = the latest value is older than its expected update frequency. The API decides
   * (kpiStaleness, the same rule that leaves stale values out of the QA score); for a team
   * object without it, the same rule is applied here to field_sources.recorded_at.
   */
  const staleOf = (k: { key: string; historyKey: string }): { staleSince: string | null; recordedAt: string | null } | null => {
    const server = team.kpiStaleness?.[k.key];
    if (team.kpiStaleness) return server?.stale ? { staleSince: server.staleSince, recordedAt: server.recordedAt } : null;
    const interval = metricIntervals[k.historyKey];
    // Per-field recorded_at (ingestion provenance); for older snapshots without provenance,
    // the snapshot date is the latest date the value is known to be from.
    const recordedAt = team.kpiFieldSources?.[k.historyKey]?.recorded_at ?? snapshotDate ?? undefined;
    if (!interval || !recordedAt) return null;
    const t = new Date(recordedAt).getTime();
    if (!Number.isFinite(t)) return null;
    const ms = interval.interval_value * (INTERVAL_UNIT_MS[interval.interval_unit] ?? 0);
    if (!ms || Date.now() - t <= ms) return null;
    return { staleSince: new Date(t + ms).toISOString(), recordedAt: new Date(t).toISOString() };
  };
  const isSample = (historyKey: string) => team.kpiFieldSources?.[historyKey]?.source === 'synthetic';

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
    setHistoryForbidden(false);
    fetch(`${API_URL}/teams/${team.id}/kpi-history?days=90`, { credentials: 'include' })
      .then(r => {
        // KPI history follows the analytics scope: outside it the trends are not shown.
        if (r.status === 403) setHistoryForbidden(true);
        return r.ok ? r.json() : null;
      })
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
        if (!cancelled && data.team) setFreshness({ at: data.team.lastUpdated ?? null, outdated: !!data.team.dataOutdated });
        if (!cancelled && data.team) {
          setTeamFacts({
            qaRank: data.team.qaRank ?? null,
            memberCount: toNum(data.team.memberCount),
            memberRoles: data.team.memberRoles ?? {},
            teamLeads: data.team.teamLeads ?? [],
            productOwners: data.team.productOwners ?? [],
            membersHidden: !!data.team.membersHidden,
          });
        }

        let byId: Record<string, DevMetricRow> = {};
        let byName: Record<string, DevMetricRow> = {};
        if (canViewDeveloperInsights) {
          // Recorded metrics come from developer-metrics (independent of the team's AI toggle;
          // it applies the per-person opt-out). AI recommendations are loaded separately.
          const [metricsResponse, aiResponse] = await Promise.all([
            fetch(`${API_URL}/analytics/developer-metrics?teamId=${encodeURIComponent(team.id)}`, { credentials: 'include' }),
            fetch(`${API_URL}/teams/${team.id}/developer-ai-suggestions`, { credentials: 'include' }),
          ]);
          if (aiResponse.ok) {
            const aiData: DeveloperAISuggestions = await aiResponse.json();
            if (!cancelled) setDevAISuggestions(aiData);
          }
          if (metricsResponse.ok) {
            const metricsData = await metricsResponse.json();
            (metricsData.developers || []).forEach((m: any) => {
              const row = metricFromDeveloperMetricsRow(m);
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
        } else if (canViewOwnRow) {
          // Own row only: the API returns nothing but the caller's own developer metrics.
          const metricsResponse = await fetch(`${API_URL}/analytics/developer-metrics?teamId=${encodeURIComponent(team.id)}`, { credentials: 'include' });
          if (metricsResponse.ok) {
            ((await metricsResponse.json()).developers || []).forEach((m: any) => {
              const row = metricFromDeveloperMetricsRow(m);
              if (row.developerId) byId[String(row.developerId)] = row;
            });
          }
          if (!cancelled) setDevMetricsUnavailable(null);
        } else if (!cancelled) {
          setDevMetricsUnavailable('Individual developer metrics are visible to team leads, managers and admins within their scope.');
        }

        if (!cancelled) {
          setMembers(list.map((m) => {
            const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email;
            const metrics = byId[String(m.id)] ?? byName[name.toLowerCase()] ?? null;
            return { id: String(m.id), name, email: m.email, metrics, insightsDisabled: !metrics && m.developer_insights_enabled === false };
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
  }, [team.id, canViewDeveloperInsights, canViewOwnRow]);

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
  // What costs the QA score most (stale inputs left out, as the score itself): shared formula.
  const qaLosses = useMemo(() => {
    const st = team.kpiStaleness ?? {};
    const stale = (['test_coverage', 'defect_escape_rate', 'change_failure_rate', 'code_quality_score'] as const)
      .filter((col) => st[QA_INPUT_KEY[col]]?.stale);
    return qaScoreInputLosses({
      test_coverage: toNum(kpi.testCoverage), defect_escape_rate: toNum(kpi.defectEscapeRate),
      change_failure_rate: toNum(kpi.changeFailureRate), code_quality_score: toNum(kpi.codeQualityScore),
    }, stale).map((l) => {
      const key = QA_INPUT_KEY[l.key];
      const threshold = getThreshold(key, team.kpiThresholds);
      return { ...l, threshold, unit: key === 'codeQualityScore' ? '/100' : '%', status: statusFor(l.value, threshold) };
    });
  }, [team.kpiStaleness, team.kpiThresholds, kpi.testCoverage, kpi.defectEscapeRate, kpi.changeFailureRate, kpi.codeQualityScore]);
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

  // Members visible to this viewer: without individual access only their own row.
  const visibleMembers = members.filter(m => (canViewDeveloperInsights ? true : m.id === String(user?.id)));
  const showMembers = canViewDeveloperInsights || canViewOwnRow;

  /** Wraps a container so it opens its catalog entry while the formulas switch is on. */
  const info = (
    metricKey: MetricCatalogKey,
    child: React.ReactNode,
    opts: { value?: React.ReactNode; variant?: 'card' | 'section'; context?: string; key?: React.Key; className?: string } = {},
  ) => (
    <MetricInfoTrigger
      key={opts.key}
      enabled={showFormulas}
      metricKey={metricKey}
      currentValue={opts.value}
      sources={team.kpiFieldSources}
      snapshotDate={snapshotDate}
      teamId={String(team.id)}
      context={opts.context ?? team.name}
      variant={opts.variant}
      className={opts.className}
    >
      {child}
    </MetricInfoTrigger>
  );
  const shown = (v: string | number | null | undefined, unit?: string) =>
    v == null || v === '—' ? '— (not recorded)' : `${v}${unit ? (unit.startsWith('%') || unit.startsWith('/') ? unit : ` ${unit}`) : ''}`;

  const metricsFor = (dev: DeveloperAISuggestion): DevMetricRow | undefined =>
    devAISuggestions?.metrics?.map(normalizeMetric).find(m =>
      (dev.developerId && m.developerId && String(m.developerId) === String(dev.developerId)) || m.name === dev.name,
    );

  return (
    <Page className="space-y-6" >
      <div data-testid="team-detail">
        <SampleDataBanner show={!!team.sampleData} />
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
              {team.teamLead ? <>Lead: {team.teamLead}</> : 'No team lead'}
              {' · '}
              {asOf ? <>KPI snapshot as of {asOf}</> : 'No KPI snapshot recorded'}
              {freshness.outdated && <>{' · '}<LastUpdatedNote at={freshness.at} outdated /></>}
            </>
          }
          actions={(canShowFormulas || (onOpenTv && canOpenTv)) ? (
            <>
              {canShowFormulas && <FormulaSwitch checked={showFormulasPref} onChange={setShowFormulas} />}
              {onOpenTv && canOpenTv && (
                <>
                  <button type="button" className={buttonClass.secondary} onClick={() => onOpenTv(String(team.id))} data-testid="open-tv-mode">
                    <MonitorPlay size={15} aria-hidden /> Open TV mode
                  </button>
                  <a
                    href={tvMailto(String(team.id), team.name)}
                    className={buttonClass.secondary}
                    title="E-mail the TV mode link of this team (for the meeting-room screen)"
                    data-testid="email-tv-link"
                  >
                    <Mail size={15} aria-hidden /> E-mail TV link
                  </a>
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(tvShareUrl(String(team.id))); toast.success('TV mode link copied'); }
                      catch { toast.error(`Copy failed. The link is ${tvShareUrl(String(team.id))}`); }
                    }}
                    title="Copy the TV mode link of this team"
                    data-testid="copy-tv-link"
                  >
                    <Link2 size={15} aria-hidden /> Copy link
                  </button>
                </>
              )}
            </>
          ) : undefined}
        />
        {showFormulas && (
          <p className="-mt-3 mb-4 text-xs text-slate-500 dark:text-slate-400" data-testid="formula-mode-hint">
            Select any tile, chart or section to see how it is calculated and where its data comes from.
          </p>
        )}

        {/* Headline scores */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="team-kpis">
          {info('qa_score', <QaScoreCard
            qaScore={qaScore}
            threshold={qaThreshold}
            status={qaStatus}
            history={kpiHistory.qa_score || []}
            trendDays={trendDays}
            onTrendDays={setTrendDays}
            confidence={team.qaScoreConfidence}
            facts={teamFacts}
            losses={qaLosses}
            memberCountFallback={toNum(team.memberCount)}
            chart={ct}
          />, { value: shown(qaScore == null ? null : Math.round(qaScore), '/100'), className: 'sm:col-span-2' })}
          {info('technical_debt_score', <StatTile
            label="Technical debt score"
            value={debt == null ? '—' : Math.round(debt)}
            unit={debt == null ? undefined : '/100'}
            tone={statusTone(debtStatus)}
            caption={debt == null ? 'No data recorded' : <span data-testid="debt-target">Lower is better · {statusWithTarget(debtThreshold, '/100', debtStatus)}</span>}
          />, { value: shown(debt == null ? null : Math.round(debt), '/100') })}
          {info('sizing_accuracy', <StatTile
            label="Task sizing accuracy"
            value={sizing == null ? '—' : sizing.toFixed(2)}
            unit={sizing == null ? undefined : '× estimate'}
            tone={sizing == null ? 'neutral' : Math.abs(sizing - 1) <= SIZING_ACCURACY_TOLERANCE.good ? 'good' : Math.abs(sizing - 1) <= SIZING_ACCURACY_TOLERANCE.warning ? 'warn' : 'bad'}
            caption={sizing == null ? 'No data recorded' : <>
              {sizing < 1 - SIZING_ACCURACY_TOLERANCE.good ? 'Overestimated (actual < estimate)' : sizing > 1 + SIZING_ACCURACY_TOLERANCE.good ? 'Underestimated (actual > estimate)' : `Within ±${Math.round(SIZING_ACCURACY_TOLERANCE.good * 100)}% of estimate`}
              <span className="block text-slate-500 dark:text-slate-400" data-testid="sizing-target">Target 1.00 ± {SIZING_ACCURACY_TOLERANCE.good.toFixed(2)} · Watch: up to ± {SIZING_ACCURACY_TOLERANCE.warning.toFixed(2)}</span>
            </>}
          />, { value: shown(sizing == null ? null : sizing.toFixed(2), '× estimate') })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6" data-testid="team-headline-kpis">
          {headline.map(h => {
            const k = kpiById(h.key);
            const stale = k.value == null ? null : staleOf(k);
            return info(k.historyKey as MetricCatalogKey, (
              <StatTile
                label={h.label}
                value={k.value == null ? '—' : <span className={stale ? 'text-slate-500 dark:text-slate-400' : undefined}>{fmt(k.value, k.key === 'defectDensity' ? 2 : 1)}</span>}
                unit={k.value == null ? undefined : k.unit}
                tone={stale ? 'neutral' : statusTone(k.status)}
                caption={k.value == null
                  ? <>No data recorded{k.threshold && <span className="block text-slate-500 dark:text-slate-400">{targetLabel(k.threshold, k.unit)}</span>}</>
                  : stale
                    ? <><StaleNote staleSince={stale.staleSince} recordedAt={stale.recordedAt} testId={`kpi-headline-stale-${k.historyKey}`} />{k.threshold && <span className="block text-slate-500 dark:text-slate-400">{targetLabel(k.threshold, k.unit)}</span>}</>
                    : <span data-testid={`kpi-headline-target-${k.historyKey}`}>{statusWithTarget(k.threshold, k.unit, k.status) ?? STATUS_BADGE[k.status].label}{showFormulas && isSample(k.historyKey) && <SampleMarker className="ml-1.5" />}</span>}
              />
            ), { key: h.key, value: shown(k.value == null ? null : fmt(k.value, k.key === 'defectDensity' ? 2 : 1), k.unit) });
          })}
        </div>
      </div>

      {/* Team members */}
      {showMembers && info('team_members', (
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
                      <span className="inline-flex items-center gap-1">Workload balance (derived) <InfoTip text={METRIC_EXPLANATIONS.happinessScore.detailed} /></span>
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
                          <td colSpan={7} className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{devMetricsUnavailable ? 'Not available' : m.insightsDisabled ? 'Developer insights turned off for this person' : 'No metrics recorded'}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ), { variant: 'section', value: membersLoading ? undefined : `${visibleMembers.length} ${visibleMembers.length === 1 ? 'member' : 'members'}` })}

      {/* Wellbeing (survey): anonymous pulse results of the team (k-anonymous, closed periods only) */}
      {info('wellbeing_survey', <PulseTeamSummary teamId={String(team.id)} onOpen={onOpenPulse ? () => onOpenPulse(String(team.id)) : undefined} />, { variant: 'section' })}

      {/* KPI categories */}
      {categories.map(category => (
        <section key={category.id}>
          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{category.name}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {detailedKPIs.filter(k => k.category === category.id).map(k => {
              const history = kpiHistory[k.historyKey] || [];
              const change = describeChange(history, k.lowerIsBetter, !!k.threshold);
              const target = thresholdText(k.threshold, k.unit);
              const stale = k.value == null ? null : staleOf(k);
              return info(k.historyKey as MetricCatalogKey, (
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white">{k.name}</h4>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{k.description}</p>
                    </div>
                    {stale
                      ? <Badge tone="neutral" className="shrink-0">Stale</Badge>
                      : <Badge tone={statusTone(k.status)} className="shrink-0">{STATUS_BADGE[k.status].label}</Badge>}
                  </div>
                  <p className="mt-3 flex items-baseline gap-1">
                    <span className={cx('text-2xl font-semibold tabular-nums', stale ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white')} data-stale={stale ? 'true' : undefined}>
                      {k.value == null ? '—' : fmt(k.value, DIGITS[k.key] ?? 1)}
                    </span>
                    {k.value != null && k.unit && <span className="text-sm text-slate-500 dark:text-slate-400">{k.unit}</span>}
                    {k.value != null && showFormulas && isSample(k.historyKey) && <SampleMarker className="ml-1.5 self-center" />}
                  </p>
                  {k.value != null && sourceCaption(team.kpiFieldSources?.[k.historyKey]) && (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid={`kpi-source-${k.historyKey}`}>
                      {sourceCaption(team.kpiFieldSources?.[k.historyKey])}
                    </p>
                  )}
                  {stale && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid={`kpi-stale-${k.historyKey}`}>
                      <StaleNote staleSince={stale.staleSince} recordedAt={stale.recordedAt} />
                      {intervalLabel(k.historyKey) && <> · expected every {intervalLabel(k.historyKey)}; not judged against the target</>}
                    </p>
                  )}
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
                      {historyForbidden ? 'Trends are shown for teams in your analytics scope.' : history.length === 1 ? `1 snapshot in the last 90 days (${formatAsOf(history[0].date)})` : getIntervalText(k.historyKey)}
                    </p>
                  )}
                  {change && target && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{target}</p>}
                </Card>
              ), { key: k.id, value: shown(k.value == null ? null : fmt(k.value, DIGITS[k.key] ?? 1), k.unit) });
            })}
          </div>
        </section>
      ))}

      <ActionsPanel teamId={String(team.id)} teamName={team.name} draft={actionDraft} onDraftUsed={clearActionDraft} />

      {/* Team recommendations */}
      {canViewDeveloperInsights && info('team_recommendations', (
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
                      {policyActor && canWriteTeamData(policyActor, policyTeam) && (
                        <button type="button" onClick={() => setActionDraft({ title: item.initiative, description: `${item.priority} · ${item.timebox} · suggested owner: ${item.owner}`, kpi: item.kpi, origin: 'recommendation' })} className="mt-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" data-testid="recommendation-create-action">
                          Create action
                        </button>
                      )}
                    </div>
                  )) : <p className="text-sm text-slate-500 dark:text-slate-400">No action items</p>}
                </div>
              </div>
            </div>
          )}
        </Card>
      ), {
        variant: 'section',
        value: aiSuggestions && aiSuggestions.aiEnabled !== false
          ? `${aiSuggestions.source === 'groq' ? 'AI' : 'Rule-based'} · ${aiSuggestions.strongpoints?.length ?? 0} strengths, ${aiSuggestions.areasOfImprovement?.length ?? 0} areas to improve, ${aiSuggestions.actionPlan?.length ?? 0} actions`
          : undefined,
      })}

      {/* Developer recommendations */}
      {canViewDeveloperInsights && info('developer_recommendations', (
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
                  return info('developer_recommendations', (
                    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
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
                      {!!dev.notMeasured?.length && (
                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Not measured: {dev.notMeasured.join(', ')}</p>
                      )}
                      {!!dev.dataQualityWarnings?.length && (
                        <ul className="mb-2 space-y-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          {dev.dataQualityWarnings.map((w, i) => <li key={i}>Data quality: {w}</li>)}
                        </ul>
                      )}
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
                  ), { key: `${dev.name}-${idx}`, context: dev.name, value: meta.label });
                })}
              </div>
            </>
          )}
        </Card>
      ), {
        variant: 'section',
        value: devAISuggestions?.developers?.length ? `${devAISuggestions.developers.length} developers · ${devAISuggestions.source === 'groq' ? 'AI' : 'rule-based'}` : undefined,
      })}
    </Page>
  );
};

/** QA score inputs (snake_case formula keys) -> team KPI keys. */
const QA_INPUT_KEY = {
  test_coverage: 'testCoverage',
  defect_escape_rate: 'defectEscapeRate',
  change_failure_rate: 'changeFailureRate',
  code_quality_score: 'codeQualityScore',
} as const;

type QaLoss = ReturnType<typeof qaScoreInputLosses>[number] & { threshold: Threshold | null; unit: string; status: KPIStatus };

const peopleText = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const ROLE_ORDER = ['team_lead', 'qa_engineer', 'viewer', 'qa_manager', 'super_admin'];

/**
 * The QA score card of Team detail: the 3D battery (horizontal, animated liquid), the score with
 * its status and target, the change over 30 days, a 30 / 90 day trend, the rank among the teams
 * the viewer may see, the input that costs the score most, and the team's people. Every number
 * comes from the API (latest snapshot, /kpi-history, GET /api/teams/:id); missing ones are left out.
 */
const QaScoreCard: React.FC<{
  qaScore: number | null;
  threshold: Threshold | null;
  status: KPIStatus;
  history: HistoryPoint[];
  trendDays: 30 | 90;
  onTrendDays: (d: 30 | 90) => void;
  confidence?: ConfidenceInfo | null;
  facts: TeamFacts | null;
  losses: QaLoss[];
  memberCountFallback: number | null;
  chart: ReturnType<typeof chartTheme>;
}> = ({ qaScore, threshold, status, history, trendDays, onTrendDays, confidence, facts, losses, memberCountFallback, chart }) => {
  const change = changeOverDays(history, 30, false, true);
  const points = lastDays(history, trendDays);
  const weakest = losses.find((l) => l.pointsLost >= 0.5) ?? null;
  const memberCount = facts?.memberCount ?? memberCountFallback;
  const roles = facts ? ROLE_ORDER.filter((r) => (facts.memberRoles[r] ?? 0) > 0)
    .map((r) => `${facts.memberRoles[r]} ${(facts.memberRoles[r] === 1 ? ROLE_LABELS[r] : ROLE_LABELS_PLURAL[r]).toLowerCase()}`) : [];
  const leads = facts?.teamLeads ?? [];
  const owners = facts?.productOwners ?? [];
  const statusLine = statusWithTarget(threshold, '/100', status);

  return (
    <div className="h-full rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:col-span-2" data-testid="team-qa-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <HeroBattery value={qaScore} size="md" orientation="horizontal" liquid label="QA score" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              QA score <InfoTip text={METRIC_EXPLANATIONS.qaScore.detailed} />
            </p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-white" data-testid="team-qa-score">
              {qaScore == null ? '—' : Math.round(qaScore)}
              <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">/100</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={statusTone(status)}>{STATUS_BADGE[status].label}</Badge>
              {threshold && <span className="text-xs text-slate-600 dark:text-slate-300" data-testid="team-qa-target">{status === 'warning' ? statusLine : targetLabel(threshold, '/100')}</span>}
            </div>
            <p className="mt-1.5 text-xs" data-testid="team-qa-change">
              {change ? (
                <span className="inline-flex flex-wrap items-center gap-x-1">
                  <span className={cx('inline-flex items-center gap-0.5 whitespace-nowrap font-medium', toneText(change.tone))}>
                    {change.direction === 'up' ? <ArrowUpRight size={14} aria-hidden /> : change.direction === 'down' ? <ArrowDownRight size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
                    {change.direction === 'flat' ? '±0' : `${change.delta > 0 ? '+' : '−'}${Math.abs(change.delta).toFixed(0)}`} pts
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">vs 30 days ago ({formatAsOf(change.prevDate)})</span>
                </span>
              ) : <span className="text-slate-500 dark:text-slate-400">No snapshot 30 days back to compare</span>}
            </p>
            <ConfidenceNote c={confidence} className="mt-1" testId="team-qa-confidence" />
          </div>
        </div>

        {/* 30 / 90 day trend */}
        <div className="w-full lg:w-56 lg:flex-shrink-0" data-testid="team-qa-trend">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">Trend</p>
            <div className="inline-flex rounded border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label="Trend period">
              {([30, 90] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={trendDays === d}
                  onClick={() => onTrendDays(d)}
                  className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                    trendDays === d ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}
                  data-testid={`team-qa-trend-${d}`}
                >
                  {d} d
                </button>
              ))}
            </div>
          </div>
          {points.length >= 2 ? (
            <div className="h-14" role="img" aria-label={`QA score over the last ${trendDays} days: from ${Math.round(points[0].value)} to ${Math.round(points[points.length - 1].value)}${threshold ? `, target ${threshold.good}` : ''}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
                  <YAxis hide domain={[(min: number) => Math.max(0, Math.floor(Math.min(min, threshold?.good ?? min) - 5)), (max: number) => Math.min(100, Math.ceil(Math.max(max, threshold?.good ?? max) + 3))]} />
                  {threshold && <ReferenceLine y={threshold.good} stroke={chart.axis} strokeDasharray="3 3" strokeWidth={1} />}
                  <Tooltip contentStyle={chart.tooltip.contentStyle} labelStyle={chart.tooltip.labelStyle} itemStyle={chart.tooltip.itemStyle}
                    labelFormatter={(_l: any, p: any) => formatAsOf(p?.[0]?.payload?.date) ?? ''}
                    formatter={(v: any) => [`${Math.round(Number(v))}/100`, 'QA score']} />
                  <Area type="monotone" dataKey="value" stroke={chart.series} fill={chart.series} fillOpacity={0.1} strokeWidth={1.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="flex h-14 items-center text-xs text-slate-500 dark:text-slate-400">Not enough snapshots in the last {trendDays} days</p>
          )}
          {threshold && points.length >= 2 && <p className="text-[11px] text-slate-500 dark:text-slate-400">Dashed line: target {threshold.good}</p>}
        </div>
      </div>

      {/* Facts */}
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 border-t border-slate-100 pt-3 text-xs dark:border-slate-800 sm:grid-cols-2" data-testid="team-qa-facts">
        {facts?.qaRank && (
          <div className="flex items-start gap-2" data-testid="team-qa-rank">
            <Trophy size={14} className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden />
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Rank by QA score</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{facts.qaRank.position} of {facts.qaRank.of} {facts.qaRank.scope === 'company' ? 'teams in the company' : 'teams you can see'}</dd>
            </div>
          </div>
        )}
        {weakest && (
          <div className="flex items-start gap-2" data-testid="team-qa-weakest">
            <Target size={14} className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0">
              <dt className="text-slate-500 dark:text-slate-400">Costs the score most</dt>
              <dd className="font-medium text-slate-900 dark:text-white">
                {weakest.label} {fmt(weakest.value, weakest.unit === '%' ? 1 : 0)}{weakest.unit === '%' ? '%' : '/100'}
                <span className="font-normal text-slate-500 dark:text-slate-400"> · −{weakest.pointsLost.toFixed(0)} pts{weakest.threshold ? ` · ${targetLabel(weakest.threshold, weakest.unit)}` : ''}</span>
              </dd>
            </div>
          </div>
        )}
        {memberCount != null && (
          <div className="flex items-start gap-2" data-testid="team-qa-people">
            <Users size={14} className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden />
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Team</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{peopleText(memberCount)}{roles.length > 0 && <span className="font-normal text-slate-500 dark:text-slate-400"> · {roles.join(', ')}</span>}</dd>
            </div>
          </div>
        )}
        {(leads.length > 0 || owners.length > 0) && (
          <div className="flex items-start gap-2" data-testid="team-qa-roles">
            <UserRound size={14} className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0 space-y-0.5">
              {leads.map((p) => (
                <div key={`lead-${p.name}`}><dt className="inline text-slate-500 dark:text-slate-400">{p.jobTitle && /scrum master/i.test(p.jobTitle) ? 'Scrum Master' : 'Team lead'}: </dt><dd className="inline font-medium text-slate-900 dark:text-white">{p.name}</dd></div>
              ))}
              {owners.map((p) => (
                <div key={`po-${p.name}`}><dt className="inline text-slate-500 dark:text-slate-400">Product Owner: </dt><dd className="inline font-medium text-slate-900 dark:text-white">{p.name}</dd></div>
              ))}
            </div>
          </div>
        )}
      </dl>
    </div>
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

/** Row of GET /analytics/developer-metrics (snake_case). */
function metricFromDeveloperMetricsRow(m: any): DevMetricRow {
  return {
    developerId: m.developer_id,
    name: m.name ?? '',
    prMergeTimeHours: toNum(m.pr_merge_time_avg),
    codeReviewTimeHours: toNum(m.code_review_time_avg),
    focusTimeHours: toNum(m.focus_time_hours),
    meetingTimeHours: toNum(m.meeting_time_hours),
    contextSwitchesPerDay: toNum(m.context_switches_per_day),
    happinessScore: toNum(m.happiness_score),
  };
}

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
