import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, AlertTriangle, TrendingDown, Clock, Zap, Loader2 } from 'lucide-react';
import type { FlakyTest } from '../data/advancedFeatures';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { API_URL } from '../config/api';

interface FlakyTestIntelligenceProps {
  onBack: () => void;
}

const FlakyTestIntelligence: React.FC<FlakyTestIntelligenceProps> = ({ onBack }) => {
  const [selectedPattern, setSelectedPattern] = useState<string>('all');
  const [flakyTests, setFlakyTests] = useState<FlakyTest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFlakyTests = async () => {
      try {
        const token = localStorage.getItem('irongate_token');
        const response = await fetch(`${API_URL}/analytics/flaky-tests`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setFlakyTests(data.flakyTests || []);
        }
      } catch (error) {
        console.error('Error fetching flaky tests:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchFlakyTests();
  }, []);

  const filteredTests = selectedPattern === 'all' 
    ? flakyTests 
    : flakyTests.filter(t => t.failure_pattern === selectedPattern);

  const patterns = [
    { id: 'all', name: 'All Patterns', color: 'gray', icon: '🔍' },
    { id: 'timing', name: 'Timing Issues', color: 'blue', icon: '⏱️' },
    { id: 'environment', name: 'Environment', color: 'green', icon: '🌍' },
    { id: 'data', name: 'Data Issues', color: 'purple', icon: '📊' },
    { id: 'network', name: 'Network', color: 'orange', icon: '🌐' },
    { id: 'unknown', name: 'Unknown', color: 'red', icon: '❓' }
  ];

  const getPatternColor = (pattern: string) => {
    const colors: Record<string, string> = {
      timing: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-blue-300 dark:border-blue-700',
      environment: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 border-green-300 dark:border-green-700',
      data: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200 border-purple-300 dark:border-purple-700',
      network: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200 border-orange-300 dark:border-orange-700',
      unknown: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 border-red-300 dark:border-red-700'
    };
    return colors[pattern] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700';
  };

  const totalFlaky = flakyTests.length;
  const avgFlakiness = (flakyTests.reduce((acc, t) => acc + t.flakiness_score, 0) / totalFlaky).toFixed(1);
  const criticalTests = flakyTests.filter(t => t.flakiness_score > 70).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b dark:border-slate-800 sticky top-0 z-10">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Dashboard</span>
          </button>
          
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <Zap className="mr-2 sm:mr-3 text-yellow-500" size={24} />
                Flaky Test Intelligence
              </h1>
              <p className="text-gray-500 dark:text-slate-400 mt-1 text-sm sm:text-base">Identify, analyze, and fix unstable tests</p>
            </div>
            
            <div className="grid grid-cols-3 gap-4 sm:gap-6">
              <div className="text-center">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Total Flaky</p>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">{totalFlaky}</div>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Avg Flakiness</p>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-yellow-600 dark:text-yellow-400">{avgFlakiness}%</div>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Critical</p>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-red-600 dark:text-red-400">{criticalTests}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pattern Filter */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-sm font-semibold text-gray-700 dark:text-slate-300 whitespace-nowrap">Filter by Pattern:</span>
          <div className="flex flex-wrap gap-2">
            {patterns.map(pattern => (
              <button
                key={pattern.id}
                onClick={() => setSelectedPattern(pattern.id)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  selectedPattern === pattern.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
              >
                <span className="mr-1 sm:mr-2">{pattern.icon}</span>
                <span className="hidden sm:inline">{pattern.name}</span>
                <span className="sm:hidden">{pattern.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Flaky Tests List */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <div className="space-y-4 sm:space-y-6">
          {filteredTests.map(test => (
            <FlakyTestCard key={test.id} test={test} getPatternColor={getPatternColor} />
          ))}
        </div>
      </div>
    </div>
  );
};

interface FlakyTestCardProps {
  test: FlakyTest;
  getPatternColor: (pattern: string) => string;
}

const FlakyTestCard: React.FC<FlakyTestCardProps> = ({ test, getPatternColor }) => {
  const historyData = useMemo(() => {
    const seen = new Set<string>();
    return [...test.history]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .filter(entry => {
        const key = `${new Date(entry.date).getTime()}-${entry.passed}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [test.history]);

  const [expanded, setExpanded] = useState(false);
  
  const passRate = ((test.history.filter(h => h.passed).length / test.history.length) * 100).toFixed(1);
  const daysSinceFirst = Math.floor((Date.now() - new Date(test.first_detected).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">{test.test_name}</h3>
              <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${getPatternColor(test.failure_pattern)}`}>
                {test.failure_pattern.toUpperCase()}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs sm:text-sm text-gray-600 dark:text-slate-400">
              <span className="flex items-center">
                <AlertTriangle size={14} className="mr-1 text-yellow-500" />
                {test.occurrences} failures
              </span>
              <span className="flex items-center">
                <Clock size={14} className="mr-1 text-blue-500" />
                {daysSinceFirst} days old
              </span>
              <span className="flex items-center">
                <TrendingDown size={14} className="mr-1 text-green-500" />
                {passRate}% pass rate
              </span>
            </div>
          </div>
          
          <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 sm:text-right">
            <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{test.flakiness_score.toFixed(1)}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 hidden sm:block">Flakiness Score</div>
            <div className={`sm:mt-2 px-2 sm:px-3 py-1 rounded-full text-xs font-semibold ${
              test.flakiness_score > 70 ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' :
              test.flakiness_score > 40 ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' :
              'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200'
            }`}>
              {test.flakiness_score > 70 ? 'CRITICAL' : test.flakiness_score > 40 ? 'WARNING' : 'MODERATE'}
            </div>
          </div>
        </div>

        {/* Suggested Fix */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 mb-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm">💡</span>
              </div>
            </div>
            <div className="ml-3 flex-1">
              <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-1">Suggested Fix</h4>
              <p className="text-sm text-blue-800 dark:text-blue-300">{test.suggested_fix}</p>
            </div>
          </div>
        </div>

        {/* History Chart */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">20-Day History</h4>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <XAxis dataKey="date" hide />
                <YAxis hide domain={[0, 1]} />
                <Tooltip 
                  content={({ payload }) => {
                    if (payload && payload.length) {
                      return (
                        <div className="bg-gray-900 text-white px-3 py-2 rounded-lg text-xs">
                          <p>{payload[0].payload.date}</p>
                          <p className="font-bold">{payload[0].payload.passed ? '✅ Passed' : '❌ Failed'}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line 
                  type="linear" 
                  dataKey={(entry) => entry.passed ? 1 : 0}
                  stroke="#9ca3af"
                  strokeWidth={2}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill={payload.passed ? '#22c55e' : '#ef4444'}
                        stroke={payload.passed ? '#16a34a' : '#dc2626'}
                        strokeWidth={2}
                      />
                    );
                  }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Expand Button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
        >
          {expanded ? '▼ Show Less' : '▶ Show More Details'}
        </button>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 space-y-3">
            {/* Failure Reason / Detection */}
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm">🔍</span>
                  </div>
                </div>
                <div className="ml-3 flex-1">
                  <h4 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-1">Most Common Failure Reason</h4>
                  <p className="text-sm text-red-800 dark:text-red-300">{test.root_cause || 'Pattern analysis pending'}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm text-gray-900 dark:text-white">
              <div>
                <span className="text-gray-500 dark:text-slate-400">First Detected:</span>
                <span className="ml-2 font-medium">{new Date(test.first_detected).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-slate-400">Last Occurrence:</span>
                <span className="ml-2 font-medium">{new Date(test.last_occurrence).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-slate-400">Total Runs:</span>
                <span className="ml-2 font-medium">{test.history.length}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-slate-400">Failure Rate:</span>
                <span className="ml-2 font-medium">{(100 - parseFloat(passRate)).toFixed(1)}%</span>
              </div>
            </div>
            
            <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Recommended Actions</h5>
              <ul className="text-sm text-gray-600 dark:text-slate-400 space-y-1 list-disc list-inside">
                <li>Review test logs for common failure patterns</li>
                <li>Verify test environment consistency</li>
                <li>Consider quarantining if flakiness persists</li>
              </ul>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
              <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                <h5 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Runs</h5>
                <span className="text-xs text-gray-500 dark:text-slate-400">Last {historyData.length} events</span>
              </div>
              <div className="max-h-60 overflow-x-auto overflow-y-auto">
                <table className="min-w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400">
                      <th className="px-4 py-2 text-left font-semibold">Date</th>
                      <th className="px-4 py-2 text-left font-semibold">Time</th>
                      <th className="px-4 py-2 text-left font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.map((run, idx) => {
                      const runDate = new Date(run.date);
                      return (
                        <tr key={`${run.date}-${idx}`} className="border-t border-gray-100 dark:border-slate-800">
                          <td className="px-4 py-2 text-gray-800 dark:text-slate-200">
                            {runDate.toLocaleDateString(undefined, {
                              weekday: 'short',
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </td>
                          <td className="px-4 py-2 text-gray-600 dark:text-slate-400">
                            {runDate.toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            })}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${run.passed ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                              {run.passed ? 'Passed' : 'Failed'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlakyTestIntelligence;
