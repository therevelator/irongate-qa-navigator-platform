import React, { useState } from 'react';
import { ArrowLeft, Calendar, Clock, PlayCircle, CheckCircle, XCircle, AlertCircle, Users, TrendingUp } from 'lucide-react';
import { generateTestExecutions } from '../data/advancedFeatures';
import type { TestExecution } from '../data/advancedFeatures';

interface TestExecutionTimelineProps {
  onBack: () => void;
}

const TestExecutionTimeline: React.FC<TestExecutionTimelineProps> = ({ onBack }) => {
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  
  const executions = generateTestExecutions();

  // Calculate statistics
  const runningTests = executions.filter(e => e.status === 'running').length;
  const passedTests = executions.filter(e => e.status === 'passed').length;
  const failedTests = executions.filter(e => e.status === 'failed').length;
  const blockedTests = executions.filter(e => e.status === 'blocked').length;
  const avgDuration = (executions.reduce((acc, e) => acc + e.duration, 0) / executions.length / 60).toFixed(1);

  // Sort executions by start time
  const sortedExecutions = [...executions].sort((a, b) => 
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  // Calculate timeline bounds
  const startTimes = sortedExecutions.map(e => new Date(e.start_time).getTime());
  const endTimes = sortedExecutions.map(e => new Date(e.end_time).getTime());
  const minTime = Math.min(...startTimes);
  const maxTime = Math.max(...endTimes);
  const timeRange = maxTime - minTime;

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
                <Calendar className="mr-3 text-blue-500" size={32} />
                Test Execution Timeline
              </h1>
              <p className="text-gray-500 mt-1">Visualize test execution flow and identify bottlenecks</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Running</p>
                <div className="text-3xl font-bold text-blue-600">{runningTests}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Passed</p>
                <div className="text-3xl font-bold text-green-600">{passedTests}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Failed</p>
                <div className="text-3xl font-bold text-red-600">{failedTests}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg Duration</p>
                <div className="text-3xl font-bold text-purple-600">{avgDuration}m</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="px-8 py-4 bg-white border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-semibold text-gray-700">View:</span>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'timeline'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              📊 Timeline View
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              📋 List View
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-4 text-sm">
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
                <span>Running</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
                <span>Passed</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div>
                <span>Failed</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
                <span>Blocked</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottleneck Alert */}
      {failedTests > 2 && (
        <div className="px-8 py-4 bg-red-50 border-b border-red-200">
          <div className="flex items-start">
            <AlertCircle className="text-red-600 mr-3 flex-shrink-0 mt-1" size={20} />
            <div>
              <h3 className="text-sm font-semibold text-red-900">Execution Bottleneck Detected</h3>
              <p className="text-sm text-red-800 mt-1">
                {failedTests} test suites have failed. This may be blocking dependent test executions.
                Review failed tests to unblock the pipeline.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="px-8 py-8">
        {viewMode === 'timeline' ? (
          <div className="space-y-6">
            {/* Timeline Header */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Gantt Chart - Test Execution Flow</h2>
              
              {/* Timeline */}
              <div className="space-y-3">
                {sortedExecutions.map((execution, index) => {
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
                        <div className="w-48 text-sm font-medium text-gray-700 truncate">
                          {execution.test_suite}
                        </div>
                        <div className="flex-1 relative h-10 bg-gray-100 rounded-lg overflow-hidden">
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
                        <div className="w-32 text-right text-xs text-gray-500 ml-4">
                          {new Date(execution.start_time).toLocaleTimeString()}
                        </div>
                      </div>
                      
                      {selectedExecution === execution.id && (
                        <div className="ml-48 mt-2 bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <ExecutionDetails execution={execution} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Time Scale */}
              <div className="mt-6 ml-48 flex justify-between text-xs text-gray-500 border-t pt-2">
                <span>{new Date(minTime).toLocaleTimeString()}</span>
                <span>Timeline Duration: {((timeRange / 60000).toFixed(0))} minutes</span>
                <span>{new Date(maxTime).toLocaleTimeString()}</span>
              </div>
            </div>

            {/* Insights */}
            <div className="grid grid-cols-3 gap-6">
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
            <h2 className="text-xl font-bold text-gray-900">Test Execution List</h2>
            {sortedExecutions.map(execution => (
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
    positive: 'bg-green-50 border-green-200',
    warning: 'bg-yellow-50 border-yellow-200',
    negative: 'bg-red-50 border-red-200'
  };

  return (
    <div className={`bg-white rounded-lg p-4 border ${statusColors[status]}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
          <p className="text-sm text-gray-600">{description}</p>
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
      running: 'bg-blue-100 text-blue-700 border-blue-300',
      passed: 'bg-green-100 text-green-700 border-green-300',
      failed: 'bg-red-100 text-red-700 border-red-300',
      blocked: 'bg-yellow-100 text-yellow-700 border-yellow-300'
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const durationMinutes = (execution.duration / 60).toFixed(1);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4 flex-1">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              execution.status === 'running' ? 'bg-blue-100' : 
              execution.status === 'passed' ? 'bg-green-100' : 
              execution.status === 'failed' ? 'bg-red-100' : 'bg-yellow-100'
            }`}>
              {getStatusIcon(execution.status)}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-1">
                <h3 className="text-lg font-bold text-gray-900">{execution.test_suite}</h3>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(execution.status)}`}>
                  {execution.status.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
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
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {isSelected ? '▼ Hide Details' : '▶ Show Execution Details'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200">
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
          <p className="text-xs text-gray-500 mb-1">Test Suite</p>
          <p className="text-sm font-semibold text-gray-900">{execution.test_suite}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Status</p>
          <p className="text-sm font-semibold text-gray-900">{execution.status.toUpperCase()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Assigned To</p>
          <p className="text-sm font-semibold text-gray-900">{execution.assigned_to}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Duration</p>
          <p className="text-sm font-semibold text-gray-900">{durationMinutes}m {durationSeconds}s</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Start Time</p>
          <p className="text-sm font-semibold text-gray-900">{new Date(execution.start_time).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">End Time</p>
          <p className="text-sm font-semibold text-gray-900">{new Date(execution.end_time).toLocaleString()}</p>
        </div>
      </div>

      {execution.dependencies.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">Dependencies</p>
          <div className="flex flex-wrap gap-2">
            {execution.dependencies.map(dep => (
              <span key={dep} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gray-50 rounded-lg p-3">
        <p className="text-xs font-semibold text-gray-700 mb-2">💡 Recommendations</p>
        <ul className="text-xs text-gray-600 space-y-1">
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
