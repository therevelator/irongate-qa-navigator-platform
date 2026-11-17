import React, { useState, useEffect } from 'react';
import { Search, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ScatterChart, Scatter } from 'recharts';
import { API_URL } from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, SegmentedControl, ProgressBar, inputClass, cx } from './ui';
import type { Tone } from './ui';

interface TestCaseManagementProps {
  onBack?: () => void;
}

/** Row from GET /analytics/test-cases; numeric fields are null when not recorded. */
interface TestCaseRow {
  id: string;
  name: string;
  requirement_id: string;
  status: 'active' | 'obsolete' | 'redundant' | string;
  last_executed: string | null;
  pass_rate: number | null;
  execution_count: number | null;
  avg_duration: number | null; // seconds
  effectiveness_score: number | null;
  tags: string[];
}

type StatusFilter = 'all' | 'active' | 'obsolete' | 'redundant';
const STATUS_TONE: Record<string, Tone> = { active: 'good', obsolete: 'bad', redundant: 'warn' };

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const mean = (vals: Array<number | null>) => {
  const xs = vals.filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const fmt = (v: number | null, d = 1, suffix = '') => (v == null ? '—' : `${v.toFixed(d)}${suffix}`);

const TestCaseManagement: React.FC<TestCaseManagementProps> = () => {
  const { isDark } = useTheme();
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTestCase, setSelectedTestCase] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<TestCaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${API_URL}/analytics/test-cases`, { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          setTestCases(data.testCases || []);
        }
      } catch (error) {
        console.error('Error fetching test cases:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeTests = testCases.filter(t => t.status === 'active').length;
  const obsoleteTests = testCases.filter(t => t.status === 'obsolete').length;
  const redundantTests = testCases.filter(t => t.status === 'redundant').length;
  // Unweighted mean across test cases that have a recorded value.
  const avgPassRate = mean(testCases.map(t => num(t.pass_rate)));
  const avgEffectiveness = mean(testCases.map(t => num(t.effectiveness_score)));

  const filteredTests = testCases.filter(test => {
    const statusMatch = selectedStatus === 'all' || test.status === selectedStatus;
    const q = searchTerm.toLowerCase();
    const searchMatch = q === '' || test.name.toLowerCase().includes(q) || (test.requirement_id || '').toLowerCase().includes(q);
    return statusMatch && searchMatch;
  });

  const effectivenessData = testCases
    .filter(t => num(t.effectiveness_score) != null && num(t.execution_count) != null)
    .map(t => ({ name: t.name, effectiveness: num(t.effectiveness_score) as number, executions: num(t.execution_count) as number, passRate: num(t.pass_rate) }));

  const c = {
    grid: isDark ? '#1e293b' : '#e2e8f0',
    axis: isDark ? '#94a3b8' : '#64748b',
    dot: isDark ? '#79a4dc' : '#3567a5',
  };

  return (
    <Page>
      <PageIntro title="Test cases" description="Recorded test cases with pass rate, execution count and stored effectiveness score." />

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading test cases…
          </div>
        </Card>
      ) : testCases.length === 0 ? (
        <Card><EmptyState title="No test cases recorded" description="Test cases appear here once they are recorded for your company or team." /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Test cases" value={testCases.length} caption={`${activeTests} active, ${obsoleteTests} obsolete, ${redundantTests} redundant`} />
            <StatTile label="Mean pass rate" value={fmt(avgPassRate, 1)} unit={avgPassRate != null ? '%' : undefined} caption="Unweighted mean across test cases" />
            <StatTile label="Mean effectiveness score" value={fmt(avgEffectiveness, 1)} caption="Stored score per test case" />
            <StatTile label="Obsolete or redundant" value={obsoleteTests + redundantTests} tone={obsoleteTests + redundantTests > 0 ? 'warn' : 'neutral'} />
          </div>

          <Card className="mb-6">
            <CardHeader title="Effectiveness vs execution count" subtitle={`${effectivenessData.length} test cases with both values`} />
            {effectivenessData.length === 0 ? (
              <EmptyState title="Not enough data to plot" />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 16, bottom: 30, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                    <XAxis type="number" dataKey="executions" name="Executions" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid}
                      label={{ value: 'Executions', position: 'bottom', offset: 12, fontSize: 11, fill: c.axis }} />
                    <YAxis type="number" dataKey="effectiveness" name="Effectiveness" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid}
                      label={{ value: 'Effectiveness score', angle: -90, position: 'left', offset: 6, fontSize: 11, fill: c.axis }} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3', stroke: c.grid }}
                      content={({ payload }) => {
                        if (payload && payload.length) {
                          const d = payload[0].payload as { name: string; effectiveness: number; executions: number; passRate: number | null };
                          return (
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                              <p className="mb-1 font-medium">{d.name}</p>
                              <p>Effectiveness: {d.effectiveness.toFixed(1)}</p>
                              <p>Executions: {d.executions}</p>
                              <p>Pass rate: {fmt(d.passRate, 1, '%')}</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Scatter data={effectivenessData} fill={c.dot} isAnimationActive={false} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'obsolete', label: 'Obsolete' },
                { value: 'redundant', label: 'Redundant' },
              ]}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search tests or requirements"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={cx(inputClass, 'w-full pl-9 sm:w-80')}
              />
            </div>
          </div>

          {filteredTests.length === 0 ? (
            <Card><EmptyState title="No test cases match these filters" /></Card>
          ) : (
            <div className="space-y-3">
              {filteredTests.map(test => (
                <TestCaseCard
                  key={test.id}
                  testCase={test}
                  isSelected={selectedTestCase === test.id}
                  onSelect={() => setSelectedTestCase(selectedTestCase === test.id ? null : test.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
};

const TestCaseCard: React.FC<{ testCase: TestCaseRow; isSelected: boolean; onSelect: () => void }> = ({ testCase, isSelected, onSelect }) => {
  const daysSinceExecution = testCase.last_executed ? Math.floor((Date.now() - new Date(testCase.last_executed).getTime()) / 86400000) : null;
  const passRate = num(testCase.pass_rate);
  const effectiveness = num(testCase.effectiveness_score);

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{testCase.name}</h4>
            <Badge tone={STATUS_TONE[testCase.status] ?? 'neutral'}>{testCase.status}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Requirement: {testCase.requirement_id || '—'}</span>
            <span>Last run: {daysSinceExecution != null ? `${daysSinceExecution} days ago` : '—'}</span>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-x-6 text-sm">
          {[
            ['Pass rate', fmt(passRate, 1, '%')],
            ['Executions', testCase.execution_count != null ? String(testCase.execution_count) : '—'],
            ['Avg duration', fmt(num(testCase.avg_duration), 1, ' s')],
            ['Effectiveness', fmt(effectiveness, 0)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {passRate != null && <ProgressBar value={passRate} tone={passRate >= 95 ? 'good' : passRate >= 80 ? 'warn' : 'bad'} className="mt-3 max-w-xs" />}

      <button onClick={onSelect} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200">
        {isSelected ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {isSelected ? 'Hide details' : 'Details'}
      </button>

      {isSelected && (
        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Tags:</span>
            {testCase.tags.length ? testCase.tags.map(tag => <Badge key={tag}>{tag}</Badge>) : <span className="text-xs text-slate-500 dark:text-slate-400">None</span>}
          </div>
          <ul className="list-inside list-disc space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {testCase.status === 'obsolete' && <li>Marked obsolete: review whether it can be removed.</li>}
            {testCase.status === 'redundant' && <li>Marked redundant: review whether it overlaps with other tests.</li>}
            {passRate != null && passRate < 90 && testCase.status === 'active' && <li>Pass rate {passRate.toFixed(1)}%: investigate failures.</li>}
            {daysSinceExecution != null && daysSinceExecution > 30 && <li>Not executed in {daysSinceExecution} days.</li>}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default TestCaseManagement;
