import React, { useState, useEffect } from 'react';
import { ArrowLeft, AlertTriangle, TrendingDown, Clock, Zap, Loader2 } from 'lucide-react';
import type { FlakyTest } from '../data/advancedFeatures';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

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
        <div className="px-8 py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Dashboard</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <Zap className="mr-3 text-yellow-500" size={32} />
                Flaky Test Intelligence
              </h1>
              <p className="text-gray-500 dark:text-slate-400 mt-1">Identify, analyze, and fix unstable tests</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">Total Flaky</p>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">{totalFlaky}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">Avg Flakiness</p>
                <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{avgFlakiness}%</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">Critical</p>
                <div className="text-3xl font-bold text-red-600 dark:text-red-400">{criticalTests}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pattern Filter */}
      <div className="px-8 py-6 bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">Filter by Pattern:</span>
          {patterns.map(pattern => (
            <button
              key={pattern.id}
              onClick={() => setSelectedPattern(pattern.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedPattern === pattern.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
              }`}
            >
              <span className="mr-2">{pattern.icon}</span>
              {pattern.name}
            </button>
          ))}
        </div>
      </div>

      {/* Flaky Tests List */}
      <div className="px-8 py-8">
        <div className="space-y-6">
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
  const [expanded, setExpanded] = useState(false);
  
  const passRate = ((test.history.filter(h => h.passed).length / test.history.length) * 100).toFixed(1);
  const daysSinceFirst = Math.floor((Date.now() - new Date(test.first_detected).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{test.test_name}</h3>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getPatternColor(test.failure_pattern)}`}>
                {test.failure_pattern.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center space-x-6 text-sm text-gray-600 dark:text-slate-400">
              <span className="flex items-center">
                <AlertTriangle size={16} className="mr-1 text-yellow-500" />
                {test.occurrences} failures
              </span>
              <span className="flex items-center">
                <Clock size={16} className="mr-1 text-blue-500" />
                {daysSinceFirst} days old
              </span>
              <span className="flex items-center">
                <TrendingDown size={16} className="mr-1 text-green-500" />
                {passRate}% pass rate
              </span>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-900 dark:text-white">{test.flakiness_score.toFixed(1)}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400">Flakiness Score</div>
            <div className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
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
              <AreaChart data={test.history}>
                <defs>
                  <linearGradient id={`gradient-${test.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
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
                <Area 
                  type="stepAfter" 
                  dataKey={(entry) => entry.passed ? 1 : 0}
                  stroke="#ef4444" 
                  fill={`url(#gradient-${test.id})`}
                  strokeWidth={2}
                />
              </AreaChart>
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
            <div className="grid grid-cols-2 gap-4 text-sm text-gray-900 dark:text-white">
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
                <li>Check for race conditions or timing dependencies</li>
                <li>Verify test environment consistency</li>
                <li>Consider quarantining if flakiness persists</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlakyTestIntelligence;
