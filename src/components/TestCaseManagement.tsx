import React, { useState } from 'react';
import { ArrowLeft, TestTube, Link, CheckCircle, XCircle, AlertTriangle, TrendingUp, Filter, Search } from 'lucide-react';
import { generateTestCases } from '../data/advancedFeatures';
import type { TestCase } from '../data/advancedFeatures';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ScatterChart, Scatter, ZAxis } from 'recharts';

interface TestCaseManagementProps {
  onBack: () => void;
}

const TestCaseManagement: React.FC<TestCaseManagementProps> = ({ onBack }) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTestCase, setSelectedTestCase] = useState<string | null>(null);
  
  const testCases = generateTestCases();

  // Calculate statistics
  const activeTests = testCases.filter(t => t.status === 'active').length;
  const obsoleteTests = testCases.filter(t => t.status === 'obsolete').length;
  const redundantTests = testCases.filter(t => t.status === 'redundant').length;
  const avgPassRate = (testCases.reduce((acc, t) => acc + t.pass_rate, 0) / testCases.length).toFixed(1);
  const avgEffectiveness = (testCases.reduce((acc, t) => acc + t.effectiveness_score, 0) / testCases.length).toFixed(1);

  // Filter test cases
  const filteredTests = testCases.filter(test => {
    const statusMatch = selectedStatus === 'all' || test.status === selectedStatus;
    const searchMatch = searchTerm === '' || 
      test.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      test.requirement_id.toLowerCase().includes(searchTerm.toLowerCase());
    return statusMatch && searchMatch;
  });

  // Prepare data for status distribution
  const statusData = [
    { name: 'Active', value: activeTests, color: '#10b981' },
    { name: 'Obsolete', value: obsoleteTests, color: '#ef4444' },
    { name: 'Redundant', value: redundantTests, color: '#f59e0b' }
  ];

  // Prepare data for effectiveness vs execution
  const effectivenessData = testCases.map(t => ({
    name: t.name.substring(0, 20),
    effectiveness: t.effectiveness_score,
    executions: t.execution_count,
    passRate: t.pass_rate
  }));

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
            <span className="font-medium">Back to Features</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <TestTube className="mr-3 text-green-500" size={32} />
                Test Case Management
              </h1>
              <p className="text-gray-500 mt-1">Optimize test suites and track test effectiveness</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Total Tests</p>
                <div className="text-3xl font-bold text-gray-900">{testCases.length}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Active</p>
                <div className="text-3xl font-bold text-green-600">{activeTests}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg Pass Rate</p>
                <div className="text-3xl font-bold text-blue-600">{avgPassRate}%</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Effectiveness</p>
                <div className="text-3xl font-bold text-purple-600">{avgEffectiveness}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="px-8 py-4 bg-white border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Filter size={20} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Status:</span>
            {['all', 'active', 'obsolete', 'redundant'].map(status => (
              <button
                key={status}
                onClick={() => setSelectedStatus(status)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedStatus === status
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Search tests or requirements..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-80"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(obsoleteTests > 0 || redundantTests > 0) && (
        <div className="px-8 py-4 bg-yellow-50 border-b border-yellow-200">
          <div className="flex items-start">
            <AlertTriangle className="text-yellow-600 mr-3 flex-shrink-0 mt-1" size={20} />
            <div>
              <h3 className="text-sm font-semibold text-yellow-900">Test Suite Optimization Needed</h3>
              <p className="text-sm text-yellow-800 mt-1">
                Found {obsoleteTests} obsolete and {redundantTests} redundant test cases. 
                Consider removing or updating these tests to improve suite efficiency.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="px-8 py-8">
        {/* Overview Charts */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Test Status Distribution</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
                  Active Tests
                </span>
                <span className="font-bold">{activeTests} ({((activeTests/testCases.length)*100).toFixed(0)}%)</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div>
                  Obsolete Tests
                </span>
                <span className="font-bold">{obsoleteTests} ({((obsoleteTests/testCases.length)*100).toFixed(0)}%)</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
                  Redundant Tests
                </span>
                <span className="font-bold">{redundantTests} ({((redundantTests/testCases.length)*100).toFixed(0)}%)</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Effectiveness vs Execution Count</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="executions" 
                    name="Executions"
                    label={{ value: 'Execution Count', position: 'bottom', offset: 40 }}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="effectiveness" 
                    name="Effectiveness"
                    label={{ value: 'Effectiveness Score', angle: -90, position: 'left', offset: 40 }}
                  />
                  <ZAxis type="number" dataKey="passRate" range={[50, 400]} />
                  <Tooltip 
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ payload }) => {
                      if (payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg">
                            <p className="font-bold mb-1">{data.name}</p>
                            <p className="text-sm">Effectiveness: {data.effectiveness.toFixed(1)}</p>
                            <p className="text-sm">Executions: {data.executions}</p>
                            <p className="text-sm">Pass Rate: {data.passRate.toFixed(1)}%</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter data={effectivenessData} fill="#3b82f6" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Test Cases List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              Test Cases ({filteredTests.length})
            </h2>
            {filteredTests.length !== testCases.length && (
              <button
                onClick={() => { setSelectedStatus('all'); setSearchTerm(''); }}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Clear Filters
              </button>
            )}
          </div>
          
          {filteredTests.map(test => (
            <TestCaseCard 
              key={test.id}
              testCase={test}
              isSelected={selectedTestCase === test.id}
              onSelect={() => setSelectedTestCase(selectedTestCase === test.id ? null : test.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface TestCaseCardProps {
  testCase: TestCase;
  isSelected: boolean;
  onSelect: () => void;
}

const TestCaseCard: React.FC<TestCaseCardProps> = ({ testCase, isSelected, onSelect }) => {
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700 border-green-300',
      obsolete: 'bg-red-100 text-red-700 border-red-300',
      redundant: 'bg-yellow-100 text-yellow-700 border-yellow-300'
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const getStatusIcon = (status: string) => {
    if (status === 'active') return <CheckCircle className="text-green-600" size={24} />;
    if (status === 'obsolete') return <XCircle className="text-red-600" size={24} />;
    return <AlertTriangle className="text-yellow-600" size={24} />;
  };

  const daysSinceExecution = Math.floor((Date.now() - new Date(testCase.last_executed).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4 flex-1">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              testCase.status === 'active' ? 'bg-green-100' : 
              testCase.status === 'obsolete' ? 'bg-red-100' : 'bg-yellow-100'
            }`}>
              {getStatusIcon(testCase.status)}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-1">
                <h3 className="text-lg font-bold text-gray-900">{testCase.name}</h3>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(testCase.status)}`}>
                  {testCase.status.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <span className="flex items-center">
                  <Link size={14} className="mr-1" />
                  Req: {testCase.requirement_id}
                </span>
                <span>Last run: {daysSinceExecution} days ago</span>
                <span>Executions: {testCase.execution_count}</span>
              </div>
            </div>
          </div>

          <div className="text-right ml-6">
            <div className="text-3xl font-bold text-gray-900">{testCase.effectiveness_score.toFixed(0)}</div>
            <div className="text-xs text-gray-500">Effectiveness</div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <TrendingUp size={14} className="mr-1" />
              <span className="text-xs font-semibold">Pass Rate</span>
            </div>
            <div className="text-xl font-bold text-blue-900">{testCase.pass_rate.toFixed(1)}%</div>
          </div>

          <div className="bg-green-50 rounded-lg p-3">
            <div className="flex items-center text-green-600 mb-1">
              <CheckCircle size={14} className="mr-1" />
              <span className="text-xs font-semibold">Executions</span>
            </div>
            <div className="text-xl font-bold text-green-900">{testCase.execution_count}</div>
          </div>

          <div className="bg-purple-50 rounded-lg p-3">
            <div className="flex items-center text-purple-600 mb-1">
              <TestTube size={14} className="mr-1" />
              <span className="text-xs font-semibold">Avg Duration</span>
            </div>
            <div className="text-xl font-bold text-purple-900">{testCase.avg_duration.toFixed(1)}s</div>
          </div>

          <div className="bg-orange-50 rounded-lg p-3">
            <div className="flex items-center text-orange-600 mb-1">
              <TrendingUp size={14} className="mr-1" />
              <span className="text-xs font-semibold">Score</span>
            </div>
            <div className="text-xl font-bold text-orange-900">{testCase.effectiveness_score.toFixed(0)}</div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center space-x-2 mb-4">
          <span className="text-xs font-semibold text-gray-500">Tags:</span>
          {testCase.tags.map(tag => (
            <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
              {tag}
            </span>
          ))}
        </div>

        <button
          onClick={onSelect}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {isSelected ? '▼ Hide Details' : '▶ Show Detailed Analysis'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
            {/* Effectiveness Analysis */}
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-3">📊 Effectiveness Analysis</h4>
              <div className="grid grid-cols-2 gap-4 text-sm text-blue-800">
                <div>
                  <p className="font-medium mb-1">Test Value:</p>
                  <p>
                    {testCase.effectiveness_score > 80 ? '✅ High - Critical test case' :
                     testCase.effectiveness_score > 60 ? '⚠️ Moderate - Useful but could improve' :
                     '❌ Low - Consider reviewing or removing'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Execution Frequency:</p>
                  <p>
                    {testCase.execution_count > 100 ? '✅ High - Frequently validated' :
                     testCase.execution_count > 50 ? '⚠️ Moderate - Regular execution' :
                     '❌ Low - Rarely executed'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Reliability:</p>
                  <p>
                    {testCase.pass_rate > 95 ? '✅ Excellent - Very stable' :
                     testCase.pass_rate > 80 ? '⚠️ Good - Mostly stable' :
                     '❌ Poor - Needs investigation'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Performance:</p>
                  <p>
                    {testCase.avg_duration < 5 ? '✅ Fast - Efficient test' :
                     testCase.avg_duration < 15 ? '⚠️ Moderate - Acceptable' :
                     '❌ Slow - Consider optimization'}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-green-900 mb-3">💡 Recommendations</h4>
              <ul className="text-sm text-green-800 space-y-2">
                {testCase.status === 'obsolete' && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span><strong>Remove Test:</strong> This test is obsolete and should be removed from the suite</span>
                  </li>
                )}
                {testCase.status === 'redundant' && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span><strong>Consolidate:</strong> This test is redundant - merge with similar tests</span>
                  </li>
                )}
                {testCase.pass_rate < 90 && testCase.status === 'active' && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span><strong>Stabilize:</strong> Pass rate is {testCase.pass_rate.toFixed(1)}% - investigate failures</span>
                  </li>
                )}
                {testCase.avg_duration > 10 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span><strong>Optimize:</strong> Test takes {testCase.avg_duration.toFixed(1)}s - consider performance improvements</span>
                  </li>
                )}
                {daysSinceExecution > 30 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span><strong>Review:</strong> Not executed in {daysSinceExecution} days - verify if still needed</span>
                  </li>
                )}
                {testCase.effectiveness_score > 80 && testCase.status === 'active' && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span><strong>Maintain:</strong> High-value test - keep in suite and monitor regularly</span>
                  </li>
                )}
              </ul>
            </div>

            {/* Coverage Matrix */}
            <div className="bg-purple-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-purple-900 mb-3">🎯 Coverage Information</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-purple-700 mb-1">Requirement Coverage:</p>
                  <p className="text-lg font-bold text-purple-900">
                    {testCase.requirement_id}
                  </p>
                  <p className="text-xs text-purple-600">Linked requirement ID</p>
                </div>
                <div>
                  <p className="text-xs text-purple-700 mb-1">Test Category:</p>
                  <p className="text-lg font-bold text-purple-900">
                    {testCase.tags[0] || 'Uncategorized'}
                  </p>
                  <p className="text-xs text-purple-600">Primary classification</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TestCaseManagement;
