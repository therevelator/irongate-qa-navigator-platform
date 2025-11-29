import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, Clock, PlayCircle, CheckCircle, XCircle, AlertCircle, Users, TrendingUp, Loader2, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { TestExecution } from '../data/advancedFeatures';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

interface TestExecutionTimelineProps {
  onBack: () => void;
}

const TestExecutionTimeline: React.FC<TestExecutionTimelineProps> = ({ onBack }) => {
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const [executions, setExecutions] = useState<TestExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusSort, setStatusSort] = useState<'all' | 'running' | 'passed' | 'failed' | 'blocked'>('all');
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSuite, setSelectedSuite] = useState<string>('all');
  const [chartPeriod, setChartPeriod] = useState<'1h' | '6h' | '24h' | '7d'>('24h');

  useEffect(() => {
    const fetchExecutions = async () => {
      try {
        const token = localStorage.getItem('irongate_token');
        const response = await fetch(`${API_URL}/analytics/test-executions?days=7`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setExecutions(data.executions || []);
        }
      } catch (error) {
        console.error('Error fetching test executions:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchExecutions();
  }, []);

  // Calculate statistics
  const runningTests = executions.filter(e => e.status === 'running').length;
  const passedTests = executions.filter(e => e.status === 'passed').length;
  const failedTests = executions.filter(e => e.status === 'failed').length;
  const blockedTests = executions.filter(e => e.status === 'blocked').length;
  const avgDuration = executions.length
    ? (executions.reduce((acc, e) => acc + e.duration, 0) / executions.length / 60).toFixed(1)
    : '0.0';

  // Filter by status ("all" shows everything)
  const filteredExecutions = statusSort === 'all'
    ? executions
    : executions.filter(e => e.status === statusSort);

  // Sort executions by status (optional) and then by start time
  const statusOrder: Array<'running' | 'passed' | 'failed' | 'blocked'> = ['running', 'passed', 'failed', 'blocked'];

  // Grouping & chart data by test suite
  const uniqueSuites = Array.from(new Set(filteredExecutions.map(e => e.test_suite)));

  // Time window for chart (relative to latest execution, not client "now")
  const latestTimestamp = filteredExecutions.length
    ? Math.max(...filteredExecutions.map(e => new Date(e.start_time).getTime()))
    : Date.now();

  const periodMs =
    chartPeriod === '1h' ? 1 * 60 * 60 * 1000 :
    chartPeriod === '6h' ? 6 * 60 * 60 * 1000 :
    chartPeriod === '24h' ? 24 * 60 * 60 * 1000 :
    7 * 24 * 60 * 60 * 1000;

  const chartWindowExecutions = filteredExecutions.filter(e => {
    const t = new Date(e.start_time).getTime();
    return t >= latestTimestamp - periodMs && t <= latestTimestamp;
  });

  const timelineExecutionsSource = selectedSuite === 'all'
    ? chartWindowExecutions
    : chartWindowExecutions.filter(e => e.test_suite === selectedSuite);

  const sortedExecutions = [...timelineExecutionsSource].sort((a, b) => {
    const aIndex = statusOrder.indexOf(a.status as any);
    const bIndex = statusOrder.indexOf(b.status as any);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedExecutions.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageExecutions = sortedExecutions.slice(startIndex, endIndex);

  // Calculate timeline bounds for current page
  const startTimes = pageExecutions.map(e => new Date(e.start_time).getTime());
  const endTimes = pageExecutions.map(e => new Date(e.end_time).getTime());
  const minTime = startTimes.length ? Math.min(...startTimes) : Date.now();
  const maxTime = endTimes.length ? Math.max(...endTimes) : minTime + 1;
  const timeRange = Math.max(1, maxTime - minTime);

  const effectiveSelectedSuite = selectedSuite === 'all' && uniqueSuites.length > 0
    ? uniqueSuites[0]
    : selectedSuite;

  const suiteExecutions = effectiveSelectedSuite === 'all'
    ? []
    : chartWindowExecutions
        .filter(e => e.test_suite === effectiveSelectedSuite)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const suiteChartData = suiteExecutions.map(e => {
    const date = new Date(e.start_time);
    // For 7d view, show day/date; for shorter ranges, show time of day
    const label = chartPeriod === '7d'
      ? date.toLocaleDateString()
      : date.toLocaleTimeString();

    return {
      label,
      durationMin: Number((e.duration / 60).toFixed(1)),
      status: e.status,
    };
  });

  const periodLabelMap: Record<typeof chartPeriod, string> = {
    '1h': 'Last 1 hour',
    '6h': 'Last 6 hours',
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days'
  };
  const suiteLabel = selectedSuite === 'all' ? 'All suites' : selectedSuite;

  const handleExportPdf = async () => {
    if (!timelineExecutionsSource.length) return;

    // Load IronGate logo from public folder
    let logoDataUrl: string | null = null;
    try {
      const res = await fetch('/irongate-logo.png');
      if (res.ok) {
        const blob = await res.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    } catch (e) {
      // If logo fails to load, continue without it
      logoDataUrl = null;
    }

    const doc = new jsPDF();
    const title = 'Test Execution Timeline Report';
    const filterLabel = statusSort === 'all' ? 'All statuses' : statusSort.toUpperCase();
    const generatedAt = new Date().toLocaleString();

    // Table of the currently filtered executions (period + suite)
    const tableBody = timelineExecutionsSource.map(e => {
      const durationMin = (e.duration / 60).toFixed(1);
      return [
        e.test_suite,
        e.status,
        new Date(e.start_time).toLocaleString(),
        new Date(e.end_time).toLocaleString(),
        durationMin,
        e.assigned_to || 'Unassigned'
      ];
    });

    autoTable(doc, {
      startY: 40,
      margin: { top: 40 },
      head: [[
        'Test Suite',
        'Status',
        'Start Time',
        'End Time',
        'Duration (min)',
        'Assignee'
      ]],
      body: tableBody,
      styles: {
        fontSize: 8,
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
      },
      alternateRowStyles: {
        fillColor: [249, 250, 251],
      },
      didDrawPage: (data) => {
        const pageWidth = doc.internal.pageSize.getWidth();

        // Header background line
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.5);
        doc.line(10, 20, pageWidth - 10, 20);

        // Logo
        if (logoDataUrl) {
          try {
            doc.addImage(logoDataUrl, 'PNG', 10, 5, 12, 12);
          } catch {
            // Ignore logo errors
          }
        }

        // Brand name
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('IronGate QA Navigator', 26, 12);

        // Report title & meta
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(title, pageWidth / 2, 10, { align: 'center' });
        doc.setFontSize(8);
        doc.text(
          `Status: ${filterLabel} | Period: ${periodLabelMap[chartPeriod]} | Suite: ${suiteLabel} | Executions: ${timelineExecutionsSource.length}`,
          pageWidth / 2,
          16,
          { align: 'center' }
        );

        // Summary line under table header on first page only
        if (data.pageNumber === 1) {
          const summary = `Running: ${runningTests}  |  Passed: ${passedTests}  |  Failed: ${failedTests}  |  Blocked: ${blockedTests}  |  Avg duration: ${avgDuration} min`;
          doc.text(summary, pageWidth / 2, 24, { align: 'center' });
        }

        // Footer with page number and generated timestamp
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Generated: ${generatedAt} | Page ${data.pageNumber}`,
          pageWidth / 2,
          pageHeight - 8,
          { align: 'center' }
        );
      },
    });

    doc.save('test-execution-timeline-report.pdf');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b dark:border-slate-800 sticky top-0 z-10">
        <div className="px-4 sm:px-8 py-4 sm:py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Features</span>
          </button>
          
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <Calendar className="mr-2 sm:mr-3 text-blue-500" size={24} />
                Test Execution Timeline
              </h1>
              <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Visualize test execution flow and identify bottlenecks</p>
            </div>
            
            <div className="grid grid-cols-4 gap-2 sm:flex sm:items-center sm:space-x-6">
              <div className="text-center">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Running</p>
                <div className="text-xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">{runningTests}</div>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Passed</p>
                <div className="text-xl sm:text-3xl font-bold text-green-600 dark:text-green-400">{passedTests}</div>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Failed</p>
                <div className="text-xl sm:text-3xl font-bold text-red-600 dark:text-red-400">{failedTests}</div>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Avg</p>
                <div className="text-xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">{avgDuration}m</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Suite-level chart - outside the sticky header */}
      {uniqueSuites.length > 0 && (
        <div className="px-4 sm:px-8 py-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Test Suite Run History
              </h3>
              <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 space-y-2 sm:space-y-0 text-xs text-gray-600 dark:text-slate-300">
                <div className="flex items-center space-x-2">
                  <span>Period:</span>
                  <select
                    value={chartPeriod}
                    onChange={(e) => setChartPeriod(e.target.value as any)}
                    className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="1h">Last 1 hour</option>
                    <option value="6h">Last 6 hours</option>
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2">
                  <span>Suite:</span>
                  <select
                    value={selectedSuite}
                    onChange={(e) => {
                      setSelectedSuite(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="all">All suites</option>
                    {uniqueSuites.map(suite => (
                      <option key={suite} value={suite}>{suite}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {suiteChartData.length > 0 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={suiteChartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="text-slate-700" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={40} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: 'Duration (min)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <Tooltip formatter={(value: any) => [`${value} min`, 'Duration']} />
                    <Line type="linear" dataKey="durationMin" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Select a test suite to see its execution history.
              </p>
            )}
          </div>
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="px-4 sm:px-8 py-3 sm:py-4 bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">View:</span>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                viewMode === 'timeline'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
              }`}
            >
              📊 Timeline
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
              }`}
            >
              📋 List
            </button>
            <button
              onClick={handleExportPdf}
              className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium bg-purple-600 text-white shadow-md hover:bg-purple-700 transition-colors flex items-center space-x-1 sm:space-x-2"
            >
              <FileText size={14} />
              <span>Export PDF</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center space-x-3 text-xs sm:text-sm text-gray-700 dark:text-slate-300">
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-blue-500 mr-1.5"></div>
                <span>Running</span>
              </div>
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-green-500 mr-1.5"></div>
                <span>Passed</span>
              </div>
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-500 mr-1.5"></div>
                <span>Failed</span>
              </div>
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-yellow-500 mr-1.5"></div>
                <span>Blocked</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <label className="text-xs font-semibold text-gray-500 dark:text-slate-400" htmlFor="status-sort">
                Filter:
              </label>
              <select
                id="status-sort"
                value={statusSort}
                onChange={(e) => {
                  setStatusSort(e.target.value as any);
                  setCurrentPage(1);
                }}
                className="text-xs rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="running">Running</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Bottleneck Alert */}
      {failedTests > 2 && (
        <div className="px-8 py-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-700">
          <div className="flex items-start">
            <AlertCircle className="text-red-600 mr-3 flex-shrink-0 mt-1" size={20} />
            <div>
              <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">Execution Bottleneck Detected</h3>
              <p className="text-sm text-red-800 dark:text-red-300 mt-1">
                {failedTests} test suites have failed. This may be blocking dependent test executions.
                Review failed tests to unblock the pipeline.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="px-4 sm:px-8 py-4 sm:py-8">
        {/* Pagination controls */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-slate-300">
            <div className="flex items-center space-x-2">
              <span>Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  const size = Number(e.target.value) as 10 | 20 | 50;
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <span>Period:</span>
              <select
                value={chartPeriod}
                onChange={(e) => {
                  setChartPeriod(e.target.value as '1h' | '6h' | '24h' | '7d');
                  setCurrentPage(1);
                }}
                className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="1h">Last hour</option>
                <option value="6h">Last 6 hours</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <span>Suite:</span>
              <select
                value={selectedSuite}
                onChange={(e) => {
                  setSelectedSuite(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All suites</option>
                {uniqueSuites.map(suite => (
                  <option key={suite} value={suite}>{suite}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-xs text-gray-600 dark:text-slate-300">
            <span>
              Page {safeCurrentPage} of {totalPages}
            </span>
            <button
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className={`px-2 py-1 rounded-md border text-xs font-medium ${
                safeCurrentPage <= 1
                  ? 'text-gray-400 border-gray-200 dark:border-slate-700 cursor-not-allowed'
                  : 'text-gray-700 dark:text-slate-200 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              Prev
            </button>
            <button
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className={`px-2 py-1 rounded-md border text-xs font-medium ${
                safeCurrentPage >= totalPages
                  ? 'text-gray-400 border-gray-200 dark:border-slate-700 cursor-not-allowed'
                  : 'text-gray-700 dark:text-slate-200 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              Next
            </button>
          </div>
        </div>

        {viewMode === 'timeline' ? (
          <div className="space-y-6">
            {/* Timeline Header */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4">Gantt Chart - Test Execution Flow</h2>
              
              {/* Timeline */}
              <div className="space-y-3">
                {pageExecutions.map((execution, index) => {
                  const startTime = new Date(execution.start_time).getTime();
                  const endTime = new Date(execution.end_time).getTime();
                  const duration = endTime - startTime;
                  
                  const leftPercent = ((startTime - minTime) / timeRange) * 100;
                  const widthPercent = (duration / timeRange) * 100;
                  
                  const statusColors = {
                    running: 'bg-blue-500',
                    passed: 'bg-green-500',
                    failed: 'bg-red-500',
                    blocked: 'bg-yellow-500'
                  };

                  return (
                    <div key={execution.id} className="relative">
                      <div className="flex items-center mb-1">
                        <div className="w-20 sm:w-48 text-xs sm:text-sm font-medium text-gray-700 dark:text-slate-300 truncate">
                          {execution.test_suite}
                        </div>
                        <div className="flex-1 relative h-8 sm:h-10 bg-gray-100 dark:bg-slate-800 rounded-lg overflow-hidden">
                          <div
                            className={`absolute h-full ${statusColors[execution.status]} rounded-lg cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center text-white text-xs font-semibold`}
                            style={{
                              left: `${leftPercent}%`,
                              width: `${Math.max(widthPercent, 2)}%`
                            }}
                            onClick={() => setSelectedExecution(selectedExecution === execution.id ? null : execution.id)}
                          >
                            {(duration / 60000).toFixed(0)}m
                          </div>
                        </div>
                        <div className="hidden sm:block w-32 text-right text-xs text-gray-500 dark:text-slate-400 ml-4">
                          {new Date(execution.start_time).toLocaleTimeString()}
                        </div>
                      </div>
                      
                      {selectedExecution === execution.id && (
                        <div className="ml-0 sm:ml-48 mt-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 sm:p-4">
                          <ExecutionDetails execution={execution} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Time Scale */}
              <div className="mt-4 sm:mt-6 ml-20 sm:ml-48 flex justify-between text-xs text-gray-500 dark:text-slate-400 border-t dark:border-slate-700 pt-2">
                <span className="hidden sm:inline">{new Date(minTime).toLocaleTimeString()}</span>
                <span>Duration: {((timeRange / 60000).toFixed(0))}m</span>
                <span className="hidden sm:inline">{new Date(maxTime).toLocaleTimeString()}</span>
              </div>
            </div>

            {/* Insights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              <InsightCard
                icon={<TrendingUp className="text-blue-500" size={24} />}
                title="Parallel Execution"
                description={`${runningTests} tests running concurrently - good resource utilization`}
                status="positive"
              />
              <InsightCard
                icon={<Clock className="text-purple-500" size={24} />}
                title="Average Duration"
                description={`${avgDuration} minutes per test suite - within acceptable range`}
                status="positive"
              />
              <InsightCard
                icon={failedTests > 0 ? <XCircle className="text-red-500" size={24} /> : <CheckCircle className="text-green-500" size={24} />}
                title={failedTests > 0 ? "Failures Detected" : "All Tests Passing"}
                description={failedTests > 0 ? `${failedTests} test suites failed - review and fix` : "No failures detected in current execution"}
                status={failedTests > 0 ? "negative" : "positive"}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white dark:text-white">Test Execution List</h2>
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
      </div>
    </div>
  );
};

interface InsightCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: 'positive' | 'warning' | 'negative';
}

const InsightCard: React.FC<InsightCardProps> = ({ icon, title, description, status }) => {
  const statusColors = {
    positive: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700',
    negative: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
  };

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-lg p-4 border ${statusColors[status]}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-slate-400">{description}</p>
        </div>
      </div>
    </div>
  );
};

interface ExecutionCardProps {
  execution: TestExecution;
  isSelected: boolean;
  onSelect: () => void;
}

const ExecutionCard: React.FC<ExecutionCardProps> = ({ execution, isSelected, onSelect }) => {
  const getStatusIcon = (status: string) => {
    if (status === 'running') return <PlayCircle className="text-blue-600" size={24} />;
    if (status === 'passed') return <CheckCircle className="text-green-600" size={24} />;
    if (status === 'failed') return <XCircle className="text-red-600" size={24} />;
    return <AlertCircle className="text-yellow-600" size={24} />;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      running: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-blue-300 dark:border-blue-700',
      passed: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 border-green-300 dark:border-green-700',
      failed: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 border-red-300 dark:border-red-700',
      blocked: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700'
    };
    return colors[status] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700';
  };

  const durationMinutes = (execution.duration / 60).toFixed(1);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4 flex-1">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              execution.status === 'running' ? 'bg-blue-100 dark:bg-blue-900/30' : 
              execution.status === 'passed' ? 'bg-green-100 dark:bg-green-900/30' : 
              execution.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30'
            }`}>
              {getStatusIcon(execution.status)}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-1">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white dark:text-white">{execution.test_suite}</h3>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(execution.status)}`}>
                  {execution.status.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-slate-400">
                <span className="flex items-center">
                  <Users size={14} className="mr-1" />
                  {execution.assigned_to}
                </span>
                <span className="flex items-center">
                  <Clock size={14} className="mr-1" />
                  {durationMinutes} minutes
                </span>
                <span>Started: {new Date(execution.start_time).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={onSelect}
          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
        >
          {isSelected ? '▼ Hide Details' : '▶ Show Execution Details'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 dark:border-slate-800">
            <ExecutionDetails execution={execution} />
          </div>
        )}
      </div>
    </div>
  );
};

interface ExecutionDetailsProps {
  execution: TestExecution;
}

const ExecutionDetails: React.FC<ExecutionDetailsProps> = ({ execution }) => {
  const durationMinutes = (execution.duration / 60).toFixed(1);
  const durationSeconds = execution.duration % 60;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Test Suite</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{execution.test_suite}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Status</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{execution.status.toUpperCase()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Assigned To</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{execution.assigned_to}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Duration</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{durationMinutes}m {durationSeconds}s</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Start Time</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{new Date(execution.start_time).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">End Time</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{new Date(execution.end_time).toLocaleString()}</p>
        </div>
      </div>

      {execution.dependencies.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">Dependencies</p>
          <div className="flex flex-wrap gap-2">
            {execution.dependencies.map(dep => (
              <span key={dep} className="px-2 py-1 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 rounded text-xs">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
        <p className="text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2">💡 Recommendations</p>
        <ul className="text-xs text-gray-600 dark:text-slate-400 space-y-1">
          {execution.status === 'failed' && (
            <li>• Review test logs and fix failing test cases immediately</li>
          )}
          {execution.status === 'blocked' && (
            <li>• Check dependencies and resolve blocking issues</li>
          )}
          {execution.duration > 1800 && (
            <li>• Consider optimizing test suite - duration exceeds 30 minutes</li>
          )}
          {execution.status === 'running' && (
            <li>• Monitor progress and check for any hanging tests</li>
          )}
          {execution.status === 'passed' && (
            <li>• Test suite completed successfully - no action needed</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default TestExecutionTimeline;
