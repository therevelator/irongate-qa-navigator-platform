import React, { useState } from 'react';
import { ArrowLeft, AlertTriangle, TrendingDown, Clock, Zap } from 'lucide-react';
import { generateFlakyTests } from '../data/advancedFeatures';
import type { FlakyTest } from '../data/advancedFeatures';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface FlakyTestIntelligenceProps {
  onBack: () => void;
}

const FlakyTestIntelligence: React.FC<FlakyTestIntelligenceProps> = ({ onBack }) => {
  const [selectedPattern, setSelectedPattern] = useState<string>('all');
  const flakyTests = generateFlakyTests();

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
      timing: 'bg-blue-100 text-blue-700 border-blue-300',
      environment: 'bg-green-100 text-green-700 border-green-300',
      data: 'bg-purple-100 text-purple-700 border-purple-300',
      network: 'bg-orange-100 text-orange-700 border-orange-300',
      unknown: 'bg-red-100 text-red-700 border-red-300'
    };
    return colors[pattern] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const totalFlaky = flakyTests.length;
  const avgFlakiness = (flakyTests.reduce((acc, t) => acc + t.flakiness_score, 0) / totalFlaky).toFixed(1);
  const criticalTests = flakyTests.filter(t => t.flakiness_score > 70).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="px-8 py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Dashboard</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Zap className="mr-3 text-yellow-500" size={32} />
                Flaky Test Intelligence
              </h1>
              <p className="text-gray-500 mt-1">Identify, analyze, and fix unstable tests</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Total Flaky</p>
                <div className="text-3xl font-bold text-gray-900">{totalFlaky}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg Flakiness</p>
                <div className="text-3xl font-bold text-yellow-600">{avgFlakiness}%</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Critical</p>
                <div className="text-3xl font-bold text-red-600">{criticalTests}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pattern Filter */}
      <div className="px-8 py-6 bg-white border-b">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-semibold text-gray-700">Filter by Pattern:</span>
          {patterns.map(pattern => (
            <button
              key={pattern.id}
              onClick={() => setSelectedPattern(pattern.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedPattern === pattern.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="text-lg font-bold text-gray-900">{test.test_name}</h3>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getPatternColor(test.failure_pattern)}`}>
                {test.failure_pattern.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center space-x-6 text-sm text-gray-600">
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
            <div className="text-3xl font-bold text-gray-900">{test.flakiness_score.toFixed(1)}</div>
            <div className="text-xs text-gray-500">Flakiness Score</div>
            <div className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
              test.flakiness_score > 70 ? 'bg-red-100 text-red-700' :
              test.flakiness_score > 40 ? 'bg-yellow-100 text-yellow-700' :
              'bg-green-100 text-green-700'
            }`}>
              {test.flakiness_score > 70 ? 'CRITICAL' : test.flakiness_score > 40 ? 'WARNING' : 'MODERATE'}
            </div>
          </div>
        </div>

        {/* Suggested Fix */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm">💡</span>
              </div>
            </div>
            <div className="ml-3 flex-1">
              <h4 className="text-sm font-semibold text-blue-900 mb-1">Suggested Fix</h4>
              <p className="text-sm text-blue-800">{test.suggested_fix}</p>
            </div>
          </div>
        </div>

        {/* History Chart */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">20-Day History</h4>
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
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {expanded ? '▼ Show Less' : '▶ Show More Details'}
        </button>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">First Detected:</span>
                <span className="ml-2 font-medium">{new Date(test.first_detected).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-500">Last Occurrence:</span>
                <span className="ml-2 font-medium">{new Date(test.last_occurrence).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-500">Total Runs:</span>
                <span className="ml-2 font-medium">{test.history.length}</span>
              </div>
              <div>
                <span className="text-gray-500">Failure Rate:</span>
                <span className="ml-2 font-medium">{(100 - parseFloat(passRate)).toFixed(1)}%</span>
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-gray-700 mb-2">Recommended Actions</h5>
              <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
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
