import React, { useState, useEffect } from 'react';
import { Loader2, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { TestExecution } from '../data/advancedFeatures';
import { API_URL } from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import ExportCsvButton from './ExportCsvButton';
import { loadErrorMessage, NETWORK_ERROR } from '../lib/loadError';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, SegmentedControl, buttonClass, inputClass, cx } from './ui';
import type { Tone } from './ui';

interface TestExecutionTimelineProps {
  onBack?: () => void;
  /** Team chosen on the Analytics page; company-wide when undefined. */
  teamId?: string;
}

const FETCH_DAYS = 7;
const API_ROW_LIMIT = 100;

/** Seconds → "Xm Ys" (or "Ys" under a minute). */
const formatDuration = (seconds: number | null | undefined): string => {
  if (seconds == null || Number.isNaN(Number(seconds))) return '—';
  const total = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
};

const STATUS_TONE: Record<TestExecution['status'], Tone> = {
  running: 'brand',
  passed: 'good',
  failed: 'bad',
  blocked: 'warn',
};
const STATUS_BAR: Record<TestExecution['status'], string> = {
  running: 'bg-brand-600',
  passed: 'bg-green-600',
  failed: 'bg-red-600',
  blocked: 'bg-amber-500',
};

type Period = '1h' | '6h' | '24h' | '7d';
type StatusFilter = 'all' | 'running' | 'passed' | 'failed' | 'blocked';

const TestExecutionTimeline: React.FC<TestExecutionTimelineProps> = ({ teamId }) => {
  const { isDark } = useTheme();
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const [executions, setExecutions] = useState<TestExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusSort, setStatusSort] = useState<StatusFilter>('all');
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSuite, setSelectedSuite] = useState<string>('all');
  const [chartPeriod, setChartPeriod] = useState<Period>('7d');

  useEffect(() => {
    const fetchExecutions = async () => {
      try {
        const response = await fetch(`${API_URL}/analytics/test-executions?days=${FETCH_DAYS}${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}`, { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          setExecutions(data.executions || []);
          setLoadError(null);
        } else {
          setLoadError(await loadErrorMessage(response, 'the test runs'));
        }
      } catch (error) {
        console.error('Error fetching test executions:', error);
        setLoadError(NETWORK_ERROR('the test runs'));
      } finally {
        setLoading(false);
      }
    };
    fetchExecutions();
  }, [teamId]);

  const truncated = executions.length >= API_ROW_LIMIT;
  const runningTests = executions.filter(e => e.status === 'running').length;
  const passedTests = executions.filter(e => e.status === 'passed').length;
  const failedTests = executions.filter(e => e.status === 'failed').length;
  const blockedTests = executions.filter(e => e.status === 'blocked').length;
  const meanDuration = (list: TestExecution[]) => {
    const ds = list.map(e => e.duration).filter((d): d is number => d != null && !Number.isNaN(Number(d))).map(Number);
    return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
  };
  const avgDurationSec = meanDuration(executions);

  const filteredExecutions = statusSort === 'all' ? executions : executions.filter(e => e.status === statusSort);
  const statusOrder: Array<TestExecution['status']> = ['running', 'passed', 'failed', 'blocked'];
  const uniqueSuites = Array.from(new Set(executions.map(e => e.test_suite)));

  // Time window for chart (relative to latest execution, not client "now")
  const latestTimestamp = filteredExecutions.length ? Math.max(...filteredExecutions.map(e => new Date(e.start_time).getTime())) : Date.now();
  const periodMs = chartPeriod === '1h' ? 3600000 : chartPeriod === '6h' ? 6 * 3600000 : chartPeriod === '24h' ? 24 * 3600000 : 7 * 24 * 3600000;

  const chartWindowExecutions = filteredExecutions.filter(e => {
    const t = new Date(e.start_time).getTime();
    return t >= latestTimestamp - periodMs && t <= latestTimestamp;
  });

  const timelineExecutionsSource = selectedSuite === 'all' ? chartWindowExecutions : chartWindowExecutions.filter(e => e.test_suite === selectedSuite);

  const sortedExecutions = [...timelineExecutionsSource].sort((a, b) => {
    const aIndex = statusOrder.indexOf(a.status);
    const bIndex = statusOrder.indexOf(b.status);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });

  const totalPages = Math.max(1, Math.ceil(sortedExecutions.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const pageExecutions = sortedExecutions.slice(startIndex, startIndex + pageSize);

  const startTimes = pageExecutions.map(e => new Date(e.start_time).getTime());
  const endTimes = pageExecutions.map(e => new Date(e.end_time).getTime());
  const minTime = startTimes.length ? Math.min(...startTimes) : Date.now();
  const maxTime = endTimes.length ? Math.max(...endTimes) : minTime + 1;
  const timeRange = Math.max(1, maxTime - minTime);

  const suiteUniqueInWindow = Array.from(new Set(chartWindowExecutions.map(e => e.test_suite)));
  const effectiveSelectedSuite = selectedSuite === 'all' ? suiteUniqueInWindow[0] ?? 'all' : selectedSuite;
  const suiteExecutions = effectiveSelectedSuite === 'all'
    ? []
    : chartWindowExecutions
        .filter(e => e.test_suite === effectiveSelectedSuite)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const suiteChartData = suiteExecutions.map(e => {
    const date = new Date(e.start_time);
    return {
      label: chartPeriod === '7d' ? date.toLocaleDateString() : date.toLocaleTimeString(),
      durationMin: e.duration != null ? Number((Number(e.duration) / 60).toFixed(2)) : null,
      status: e.status,
    };
  });

  const periodLabelMap: Record<Period, string> = {
    '1h': 'Last 1 hour',
    '6h': 'Last 6 hours',
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
  };
  const suiteLabel = selectedSuite === 'all' ? 'All suites' : selectedSuite;

  const c = {
    grid: isDark ? '#1e293b' : '#e2e8f0',
    axis: isDark ? '#94a3b8' : '#64748b',
    line: isDark ? '#79a4dc' : '#3567a5',
    tooltip: {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: 6,
      color: isDark ? '#f1f5f9' : '#0f172a',
      fontSize: 12,
    },
  };

  const handleExportPdf = async () => {
    if (!timelineExecutionsSource.length) return;

    let logoDataUrl: string | null = null;
    try {
      const res = await fetch('/brand/irongate-logo-pdf.png');
      if (res.ok) {
        const blob = await res.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      logoDataUrl = null;
    }

    const doc = new jsPDF();
    const title = 'Test Execution Timeline Report';
    const filterLabel = statusSort === 'all' ? 'All statuses' : statusSort.toUpperCase();
    const generatedAt = new Date().toLocaleString();

    const tableBody = timelineExecutionsSource.map(e => [
      e.test_suite,
      e.status,
      new Date(e.start_time).toLocaleString(),
      new Date(e.end_time).toLocaleString(),
      formatDuration(e.duration),
      e.assigned_to || 'Unassigned',
    ]);

    const pdfSource = timelineExecutionsSource;
    const pdfSummary = `Running: ${pdfSource.filter(e => e.status === 'running').length}  |  Passed: ${pdfSource.filter(e => e.status === 'passed').length}  |  Failed: ${pdfSource.filter(e => e.status === 'failed').length}  |  Blocked: ${pdfSource.filter(e => e.status === 'blocked').length}  |  Mean duration: ${formatDuration(meanDuration(pdfSource))}`;

    autoTable(doc, {
      startY: 40,
      margin: { top: 40 },
      head: [['Test Suite', 'Status', 'Start Time', 'End Time', 'Duration', 'Assignee']],
      body: tableBody,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [38, 83, 138], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: (data) => {
        const pageWidth = doc.internal.pageSize.getWidth();
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(10, 20, pageWidth - 10, 20);
        if (logoDataUrl) {
          try { doc.addImage(logoDataUrl, 'PNG', 10, 5, 8.2, 12); } catch { /* ignore */ }
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('QE Navigator', 26, 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(title, pageWidth / 2, 10, { align: 'center' });
        doc.setFontSize(8);
        doc.text(
          `Status: ${filterLabel} | Period: ${periodLabelMap[chartPeriod]} (relative to latest run) | Suite: ${suiteLabel} | Executions: ${pdfSource.length}`,
          pageWidth / 2, 16, { align: 'center' },
        );
        if (data.pageNumber === 1) doc.text(pdfSummary, pageWidth / 2, 24, { align: 'center' });
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Generated: ${generatedAt} | Page ${data.pageNumber}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      },
    });

    doc.save('test-execution-timeline-report.pdf');
  };

  const selectClass = cx(inputClass, 'h-8 text-xs');

  if (loading) {
    return (
      <Page>
        <PageIntro title="Test execution timeline" />
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading test runs…
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageIntro
        title="Test execution timeline"
        description={`Test suite runs recorded in the last ${FETCH_DAYS} days${truncated ? ` (showing the ${API_ROW_LIMIT} most recent; counts below cover only these)` : ''}.`}
        actions={
          executions.length > 0 ? (
            <>
            <ExportCsvButton
              what="Test runs"
              rows={filteredExecutions}
              columns={[
                { header: 'Test suite', value: (e) => e.test_suite },
                { header: 'Status', value: (e) => e.status },
                { header: 'Start', value: (e) => e.start_time },
                { header: 'End', value: (e) => e.end_time },
                { header: 'Duration', value: (e) => formatDuration(e.duration), raw: (e) => (e.duration == null ? null : Number(e.duration)) },
                { header: 'Assigned to', value: (e) => e.assigned_to ?? '' },
              ]}
            />
            <button onClick={handleExportPdf} className={buttonClass.secondary} disabled={!timelineExecutionsSource.length}>
              <FileText className="h-4 w-4" /> Export PDF
            </button>
            </>
          ) : undefined
        }
      />

      {loadError ? (
        <div role="alert" data-testid="load-error" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
        </div>
      ) : executions.length === 0 ? (
        <Card>
          <EmptyState
            title="No test runs in this period"
            description={`No test suite runs have been recorded in the last ${FETCH_DAYS} days. Runs appear here once they are recorded for your company or team.`}
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile label="Running" value={runningTests} />
            <StatTile label="Passed" value={passedTests} />
            <StatTile label="Failed" value={failedTests} tone={failedTests > 0 ? 'bad' : 'neutral'} caption={failedTests > 0 ? 'Review failed runs' : undefined} />
            <StatTile label="Blocked" value={blockedTests} />
            <StatTile label="Mean run duration" value={formatDuration(avgDurationSec)} caption={`Across ${executions.length} runs`} />
          </div>

          <Card className="mb-6">
            <CardHeader
              title="Suite run history"
              subtitle={effectiveSelectedSuite !== 'all' ? `Duration per run · ${effectiveSelectedSuite}` : 'Duration per run'}
            />
            {suiteChartData.length > 0 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={suiteChartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: c.axis }} stroke={c.grid} angle={-30} textAnchor="end" height={40} />
                    <YAxis tick={{ fontSize: 10, fill: c.axis }} stroke={c.grid} label={{ value: 'Duration (min)', angle: -90, position: 'insideLeft', fontSize: 10, fill: c.axis }} />
                    <Tooltip contentStyle={c.tooltip} labelStyle={{ color: c.tooltip.color }} formatter={(value: any) => [formatDuration(Number(value) * 60), 'Duration']} />
                    <Line type="linear" dataKey="durationMin" stroke={c.line} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No runs for the selected suite in this period.</p>
            )}
          </Card>

          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
              <SegmentedControl
                value={viewMode}
                onChange={setViewMode}
                options={[{ value: 'timeline', label: 'Timeline' }, { value: 'list', label: 'List' }]}
              />
              <label className="flex items-center gap-2">
                Status
                <select value={statusSort} onChange={(e) => { setStatusSort(e.target.value as StatusFilter); setCurrentPage(1); }} className={selectClass}>
                  <option value="all">All</option>
                  <option value="running">Running</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="blocked">Blocked</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                Period
                <select value={chartPeriod} onChange={(e) => { setChartPeriod(e.target.value as Period); setCurrentPage(1); }} className={selectClass}>
                  <option value="1h">Last hour</option>
                  <option value="6h">Last 6 hours</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                Suite
                <select value={selectedSuite} onChange={(e) => { setSelectedSuite(e.target.value); setCurrentPage(1); }} className={selectClass}>
                  <option value="all">All suites</option>
                  {uniqueSuites.map(suite => <option key={suite} value={suite}>{suite}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                Rows
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value) as 10 | 20 | 50); setCurrentPage(1); }} className={selectClass}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
              <span>Page {safeCurrentPage} of {totalPages}</span>
              <button disabled={safeCurrentPage <= 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50')}>Prev</button>
              <button disabled={safeCurrentPage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50')}>Next</button>
            </div>
          </div>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Period windows are measured back from the most recent run shown, not from the current time.</p>

          {pageExecutions.length === 0 ? (
            <Card><EmptyState title="No runs match these filters" /></Card>
          ) : viewMode === 'timeline' ? (
            <Card>
              <CardHeader
                title="Execution flow"
                action={
                  <div className="hidden items-center gap-3 text-xs text-slate-600 sm:flex dark:text-slate-300">
                    {(['running', 'passed', 'failed', 'blocked'] as const).map(st => (
                      <span key={st} className="flex items-center gap-1.5">
                        <span className={cx('h-2.5 w-2.5 rounded-sm', STATUS_BAR[st])} />
                        <span className="capitalize">{st}</span>
                      </span>
                    ))}
                  </div>
                }
              />
              <div className="space-y-2">
                {pageExecutions.map(execution => {
                  const startTime = new Date(execution.start_time).getTime();
                  const endTime = new Date(execution.end_time).getTime();
                  const duration = endTime - startTime;
                  const leftPercent = ((startTime - minTime) / timeRange) * 100;
                  const widthPercent = (duration / timeRange) * 100;
                  return (
                    <div key={execution.id}>
                      <div className="flex items-center">
                        <div className="w-24 truncate text-xs font-medium text-slate-700 sm:w-48 sm:text-sm dark:text-slate-300">{execution.test_suite}</div>
                        <div className="relative h-7 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                          <button
                            type="button"
                            className={cx('absolute flex h-full items-center justify-center rounded text-[11px] font-medium text-white hover:opacity-90', STATUS_BAR[execution.status])}
                            style={{ left: `${leftPercent}%`, width: `${Math.max(widthPercent, 2)}%` }}
                            onClick={() => setSelectedExecution(selectedExecution === execution.id ? null : execution.id)}
                            title={formatDuration(execution.duration)}
                          >
                            {widthPercent > 8 ? formatDuration(execution.duration) : ''}
                          </button>
                        </div>
                        <div className="ml-4 hidden w-28 text-right text-xs text-slate-500 sm:block dark:text-slate-400">
                          {new Date(execution.start_time).toLocaleTimeString()}
                        </div>
                      </div>
                      {selectedExecution === execution.id && (
                        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-4 sm:ml-48 dark:border-slate-800 dark:bg-slate-800/40">
                          <ExecutionDetails execution={execution} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-between border-t border-slate-200 pt-2 text-xs text-slate-500 sm:ml-48 dark:border-slate-800 dark:text-slate-400">
                <span className="hidden sm:inline">{new Date(minTime).toLocaleString()}</span>
                <span>Span: {formatDuration(timeRange / 1000)}</span>
                <span className="hidden sm:inline">{new Date(maxTime).toLocaleString()}</span>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {pageExecutions.map(execution => (
                <ExecutionCard
                  key={execution.id}
                  execution={execution}
                  isSelected={selectedExecution === execution.id}
                  onSelect={() => setSelectedExecution(selectedExecution === execution.id ? null : execution.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
};

const ExecutionCard: React.FC<{ execution: TestExecution; isSelected: boolean; onSelect: () => void }> = ({ execution, isSelected, onSelect }) => (
  <Card>
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{execution.test_suite}</h3>
      <Badge tone={STATUS_TONE[execution.status] ?? 'neutral'}>{execution.status}</Badge>
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      <span>{execution.assigned_to || 'Unassigned'}</span>
      <span>{formatDuration(execution.duration)}</span>
      <span>Started {new Date(execution.start_time).toLocaleString()}</span>
    </div>
    <button onClick={onSelect} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200">
      {isSelected ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      {isSelected ? 'Hide details' : 'Show details'}
    </button>
    {isSelected && (
      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        <ExecutionDetails execution={execution} />
      </div>
    )}
  </Card>
);

const ExecutionDetails: React.FC<{ execution: TestExecution }> = ({ execution }) => {
  const deps = Array.isArray(execution.dependencies) ? execution.dependencies : [];
  const fields: [string, string][] = [
    ['Test suite', execution.test_suite],
    ['Status', execution.status],
    ['Assigned to', execution.assigned_to || 'Unassigned'],
    ['Duration', formatDuration(execution.duration)],
    ['Start time', new Date(execution.start_time).toLocaleString()],
    ['End time', execution.end_time ? new Date(execution.end_time).toLocaleString() : '—'],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4">
        {fields.map(([k, v]) => (
          <div key={k}>
            <dt className="mb-1 text-xs text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="text-sm font-medium text-slate-900 dark:text-white">{v}</dd>
          </div>
        ))}
      </dl>
      {deps.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Dependencies</p>
          <div className="flex flex-wrap gap-2">
            {deps.map(dep => <Badge key={dep}>{dep}</Badge>)}
          </div>
        </div>
      )}
    </div>
  );
};

export default TestExecutionTimeline;
