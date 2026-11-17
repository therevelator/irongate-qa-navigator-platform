import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import type { FlakyTest } from '../data/advancedFeatures';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { API_URL } from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { Page, PageIntro, Card, Badge, StatTile, EmptyState, SegmentedControl, cx } from './ui';

interface FlakyTestIntelligenceProps {
  onBack?: () => void;
  /** Team chosen on the Analytics page; company-wide when undefined. */
  teamId?: string;
}

/** API row; total_runs / pass_count / root_cause_verified are optional until the server provides them. */
type FlakyTestRow = Omit<FlakyTest, 'root_cause' | 'suggested_fix'> & {
  root_cause?: string | null;
  suggested_fix?: string | null;
  total_runs?: number | null;
  pass_count?: number | null;
  root_cause_verified?: boolean;
};

// Canned strings the API maps from failure_pattern; no error log is actually analysed for these.
const CANNED_ROOT_CAUSES = new Set([
  'timeout keyword detected in error logs',
  'environment keyword detected in error logs',
  'assertion failed keyword detected in error logs',
  'ECONNREFUSED keyword detected in error logs',
  'No matching pattern found',
]);

const verifiedRootCause = (t: FlakyTestRow): string | null => {
  if (!t.root_cause) return null;
  // The API flags whether a root cause was actually stored for the test.
  if (typeof t.root_cause_verified === 'boolean') return t.root_cause_verified ? t.root_cause : null;
  return CANNED_ROOT_CAUSES.has(t.root_cause) ? null : t.root_cause;
};

const totalRunsOf = (t: FlakyTestRow): number | null => {
  if (t.total_runs != null) return Number(t.total_runs);
  if (t.pass_count != null && t.occurrences != null) return Number(t.pass_count) + Number(t.occurrences);
  return null;
};

type PatternFilter = 'all' | 'timing' | 'environment' | 'data' | 'network' | 'unknown';
const PATTERNS: { value: PatternFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'timing', label: 'Timing' },
  { value: 'environment', label: 'Environment' },
  { value: 'data', label: 'Data' },
  { value: 'network', label: 'Network' },
  { value: 'unknown', label: 'Unknown' },
];

const FlakyTestIntelligence: React.FC<FlakyTestIntelligenceProps> = ({ teamId }) => {
  const [selectedPattern, setSelectedPattern] = useState<PatternFilter>('all');
  const [flakyTests, setFlakyTests] = useState<FlakyTestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFlakyTests = async () => {
      try {
        const response = await fetch(`${API_URL}/analytics/flaky-tests${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`, { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          // Server-side placeholder rows (id 'sample-*') are not real detections.
          setFlakyTests((data.flakyTests || []).filter((t: FlakyTestRow) => !String(t.id).startsWith('sample-')));
        } else {
          setError('Could not load flaky tests.');
        }
      } catch (err) {
        console.error('Error fetching flaky tests:', err);
        setError('Could not load flaky tests.');
      } finally {
        setLoading(false);
      }
    };
    fetchFlakyTests();
  }, [teamId]);

  const filteredTests = selectedPattern === 'all' ? flakyTests : flakyTests.filter(t => t.failure_pattern === selectedPattern);

  const totalFlaky = flakyTests.length;
  const scored = flakyTests.filter(t => t.flakiness_score != null && !Number.isNaN(Number(t.flakiness_score)));
  const avgFlakiness = scored.length > 0 ? (scored.reduce((acc, t) => acc + Number(t.flakiness_score), 0) / scored.length).toFixed(1) : null;
  const criticalTests = flakyTests.filter(t => Number(t.flakiness_score) > 70).length;

  return (
    <Page>
      <PageIntro
        title="Flaky tests"
        description="Tests recorded as flaky, with their most recent executions. Failure patterns are stored classifications and have not been verified against logs."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Flaky tests tracked" value={loading ? '—' : totalFlaky} />
        <StatTile label="Mean flakiness score" value={avgFlakiness ?? '—'} caption="Stored score (0–100) per test" />
        <StatTile label="Score above 70" value={loading ? '—' : criticalTests} tone={criticalTests > 0 ? 'bad' : 'neutral'} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500 dark:text-slate-400">Pattern</span>
        <SegmentedControl value={selectedPattern} onChange={setSelectedPattern} options={PATTERNS} />
      </div>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading flaky tests…
          </div>
        </Card>
      ) : error ? (
        <Card><EmptyState title={error} description="Try reloading the page." /></Card>
      ) : totalFlaky === 0 ? (
        <Card>
          <EmptyState
            title="No flaky tests recorded"
            description="No tests have been recorded as flaky for this scope. Tests appear here once flaky results are recorded."
          />
        </Card>
      ) : filteredTests.length === 0 ? (
        <Card><EmptyState title="No tests with this pattern" /></Card>
      ) : (
        <div className="space-y-4">
          {filteredTests.map(test => (
            <FlakyTestCard key={test.id} test={test} />
          ))}
        </div>
      )}
    </Page>
  );
};

const FlakyTestCard: React.FC<{ test: FlakyTestRow }> = ({ test }) => {
  const { isDark } = useTheme();
  const historyData = useMemo(() => {
    const seen = new Set<string>();
    return [...(test.history || [])]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .filter(entry => {
        const key = `${new Date(entry.date).getTime()}-${entry.passed}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [test.history]);

  const [expanded, setExpanded] = useState(false);

  const historyCount = historyData.length;
  const passRateNum = historyCount > 0 ? (historyData.filter(h => h.passed).length / historyCount) * 100 : null;
  const daysSinceFirst = test.first_detected ? Math.floor((Date.now() - new Date(test.first_detected).getTime()) / 86400000) : null;
  const totalRuns = totalRunsOf(test);
  const rootCause = verifiedRootCause(test);
  const score = test.flakiness_score != null ? Number(test.flakiness_score) : null;
  const scoreTone = score == null ? 'neutral' : score > 70 ? 'bad' : score > 40 ? 'warn' : 'neutral';

  return (
    <Card padded={false}>
      <div className="p-5">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{test.test_name}</h3>
              <Badge tone="neutral">Pattern: {test.failure_pattern || 'unknown'} (unverified)</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{test.occurrences ?? '—'} recorded failures</span>
              <span>{daysSinceFirst != null ? `First detected ${daysSinceFirst} days ago` : 'First detected —'}</span>
              <span>
                {passRateNum != null ? `${passRateNum.toFixed(1)}% passed in last ${historyCount} runs` : 'No executions recorded'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
            <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{score != null ? score.toFixed(1) : '—'}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Flakiness score</div>
            {score != null && <Badge tone={scoreTone}>{score > 70 ? 'High' : score > 40 ? 'Medium' : 'Low'}</Badge>}
          </div>
        </div>

        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Last {historyCount} runs</h4>
          {historyCount === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No executions recorded for this test.</p>
          ) : (
            <div className="h-20">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={[0, 1]} />
                  <Tooltip
                    content={({ payload }) => {
                      if (payload && payload.length) {
                        const p = payload[0].payload as { date: string; passed: boolean };
                        return (
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                            <p>{new Date(p.date).toLocaleString()}</p>
                            <p className="font-medium">{p.passed ? 'Passed' : 'Failed'}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Line
                    type="linear"
                    dataKey={(entry: { passed: boolean }) => (entry.passed ? 1 : 0)}
                    stroke={isDark ? '#475569' : '#cbd5e1'}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                    dot={(props: any) => {
                      const { cx: x, cy: y, payload, index } = props;
                      return (
                        <circle key={index} cx={x} cy={y} r={4} fill={payload.passed ? '#16a34a' : '#dc2626'} stroke="none" />
                      );
                    }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {expanded ? 'Hide details' : 'Show details'}
        </button>

        {expanded && (
          <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <h4 className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Root cause</h4>
              <p className="text-sm text-slate-800 dark:text-slate-200">
                {rootCause ?? `Not determined. The "${test.failure_pattern || 'unknown'}" pattern is a stored classification; no error logs have been analysed.`}
              </p>
              {test.suggested_fix && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">General guidance for this pattern: {test.suggested_fix}</p>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              {[
                ['First detected', test.first_detected ? new Date(test.first_detected).toLocaleDateString() : '—'],
                ['Last occurrence', test.last_occurrence ? new Date(test.last_occurrence).toLocaleDateString() : '—'],
                ['Total runs', totalRuns != null ? totalRuns.toLocaleString() : '—'],
                ['Failure rate (last runs)', passRateNum != null ? `${(100 - passRateNum).toFixed(1)}% of ${historyCount}` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">{k}:</dt>
                  <dd className="font-medium text-slate-900 dark:text-white">{v}</dd>
                </div>
              ))}
            </dl>

            {historyCount > 0 && (
              <div className="rounded-md border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-800">
                  <h5 className="text-sm font-semibold text-slate-900 dark:text-white">Recent runs</h5>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Last {historyCount} runs</span>
                </div>
                <div className="max-h-60 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                        <th className="px-4 py-2 text-left font-medium">Date</th>
                        <th className="px-4 py-2 text-left font-medium">Time</th>
                        <th className="px-4 py-2 text-left font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...historyData].reverse().map((run, idx) => {
                        const runDate = new Date(run.date);
                        return (
                          <tr key={`${run.date}-${idx}`} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-4 py-2 text-slate-800 dark:text-slate-200">
                              {runDate.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                              {runDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className={cx('px-4 py-2')}>
                              <Badge tone={run.passed ? 'good' : 'bad'}>{run.passed ? 'Passed' : 'Failed'}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default FlakyTestIntelligence;
