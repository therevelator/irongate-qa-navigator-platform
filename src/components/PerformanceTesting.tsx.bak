import React, { useState } from 'react';
import { ArrowLeft, TrendingUp, Activity, AlertTriangle, Zap, Clock, Users, Server } from 'lucide-react';
import { generatePerformanceMetrics } from '../data/advancedFeatures';
import type { PerformanceMetric } from '../data/advancedFeatures';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface PerformanceTestingProps {
  onBack: () => void;
}

// Extended metric type with calculated fields
type ExtendedPerformanceMetric = PerformanceMetric & {
  performance_score: number;
  method: string;
  response_times: {
    p50: number;
    p95: number;
    p99: number;
  };
};

// Calculate performance score based on response times and error rate
const calculatePerformanceScore = (metric: PerformanceMetric): number => {
  const p95Score = metric.response_time_p95 < 200 ? 100 : metric.response_time_p95 < 500 ? 80 : 50;
  const errorScore = metric.error_rate < 1 ? 100 : metric.error_rate < 5 ? 70 : 40;
  const throughputScore = metric.throughput > 500 ? 100 : metric.throughput > 200 ? 80 : 60;
  
  return (p95Score * 0.4 + errorScore * 0.4 + throughputScore * 0.2);
};

const PerformanceTesting: React.FC<PerformanceTestingProps> = ({ onBack }) => {
  const [selectedEndpoint, setSelectedEndpoint] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d');
  
  const metrics = generatePerformanceMetrics();

  // Calculate overall statistics
  const avgP95 = (metrics.reduce((acc, m) => acc + m.response_time_p95, 0) / metrics.length).toFixed(0);
  const avgThroughput = (metrics.reduce((acc, m) => acc + m.throughput, 0) / metrics.length).toFixed(0);
  const avgErrorRate = (metrics.reduce((acc, m) => acc + m.error_rate, 0) / metrics.length).toFixed(2);
  
  // Calculate performance score for each metric
  const metricsWithScore: ExtendedPerformanceMetric[] = metrics.map(m => ({
    ...m,
    performance_score: calculatePerformanceScore(m),
    method: 'GET', // Default method
    response_times: {
      p50: m.response_time_p50,
      p95: m.response_time_p95,
      p99: m.response_time_p99
    }
  }));
  const degradedEndpoints = metricsWithScore.filter(m => m.performance_score < 70).length;

  // Prepare data for response time trends
  const trendData = Array.from({ length: 24 }, (_, i) => ({
    hour: `${i}:00`,
    p50: 80 + Math.random() * 40,
    p95: 150 + Math.random() * 100,
    p99: 250 + Math.random() * 150
  }));

  // Prepare data for load test results
  const loadTestData = Array.from({ length: 10 }, (_, i) => ({
    users: (i + 1) * 100,
    responseTime: 100 + (i * 15) + Math.random() * 20,
    throughput: 1000 - (i * 50) + Math.random() * 100,
    errorRate: i > 7 ? (i - 7) * 2 : 0
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
                <Activity className="mr-3 text-blue-500" size={32} />
                Performance Testing Metrics
              </h1>
              <p className="text-gray-500 mt-1">Monitor response times, load capacity, and performance trends</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg P95</p>
                <div className="text-3xl font-bold text-blue-600">{avgP95}ms</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Throughput</p>
                <div className="text-3xl font-bold text-green-600">{avgThroughput}/s</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Error Rate</p>
                <div className="text-3xl font-bold text-red-600">{avgErrorRate}%</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Degraded</p>
                <div className="text-3xl font-bold text-orange-600">{degradedEndpoints}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Time Range Selector */}
      <div className="px-8 py-4 bg-white border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-semibold text-gray-700">Time Range:</span>
            {(['24h', '7d', '30d'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  timeRange === range
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {range === '24h' ? 'Last 24 Hours' : range === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-4 py-2 bg-green-50 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-sm font-medium text-green-700">Live Monitoring</span>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Alerts */}
      {degradedEndpoints > 0 && (
        <div className="px-8 py-4 bg-red-50 border-b border-red-200">
          <div className="flex items-start">
            <AlertTriangle className="text-red-600 mr-3 flex-shrink-0 mt-1" size={20} />
            <div>
              <h3 className="text-sm font-semibold text-red-900">
                Performance Degradation Detected
              </h3>
              <p className="text-sm text-red-800 mt-1">
                {degradedEndpoints} endpoint{degradedEndpoints > 1 ? 's are' : ' is'} experiencing performance issues. 
                P95 response times are above acceptable thresholds.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="px-8 py-8">
        {/* Response Time Trends */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Response Time Trends (24 Hours)</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorP50" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorP95" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorP99" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '8px' }}
                />
                <Legend />
                <Area type="monotone" dataKey="p50" stroke="#10b981" fill="url(#colorP50)" strokeWidth={2} name="P50 (Median)" />
                <Area type="monotone" dataKey="p95" stroke="#3b82f6" fill="url(#colorP95)" strokeWidth={2} name="P95" />
                <Area type="monotone" dataKey="p99" stroke="#ef4444" fill="url(#colorP99)" strokeWidth={2} name="P99" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-sm text-green-700 font-medium">P50 (Median)</p>
              <p className="text-2xl font-bold text-green-900">
                {trendData[trendData.length - 1].p50.toFixed(0)}ms
              </p>
              <p className="text-xs text-green-600">50% of requests</p>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700 font-medium">P95</p>
              <p className="text-2xl font-bold text-blue-900">
                {trendData[trendData.length - 1].p95.toFixed(0)}ms
              </p>
              <p className="text-xs text-blue-600">95% of requests</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-sm text-red-700 font-medium">P99</p>
              <p className="text-2xl font-bold text-red-900">
                {trendData[trendData.length - 1].p99.toFixed(0)}ms
              </p>
              <p className="text-xs text-red-600">99% of requests</p>
            </div>
          </div>
        </div>

        {/* Load Test Results */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Load Test Results - Capacity Planning</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={loadTestData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="users" 
                  label={{ value: 'Concurrent Users', position: 'bottom', offset: -5 }}
                />
                <YAxis 
                  yAxisId="left"
                  label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft' }}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right"
                  label={{ value: 'Throughput (req/s)', angle: 90, position: 'insideRight' }}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '8px' }}
                />
                <Legend />
                <Line 
                  yAxisId="left" 
                  type="monotone" 
                  dataKey="responseTime" 
                  stroke="#ef4444" 
                  strokeWidth={3}
                  name="Response Time (ms)"
                  dot={{ fill: '#ef4444', r: 5 }}
                />
                <Line 
                  yAxisId="right" 
                  type="monotone" 
                  dataKey="throughput" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  name="Throughput (req/s)"
                  dot={{ fill: '#10b981', r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 Capacity Insights</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• <strong>Optimal Capacity:</strong> System performs well up to ~700 concurrent users</li>
              <li>• <strong>Degradation Point:</strong> Response times increase significantly after 800 users</li>
              <li>• <strong>Recommendation:</strong> Scale horizontally before reaching 700 concurrent users</li>
              <li>• <strong>Current Headroom:</strong> 40% capacity available for traffic spikes</li>
            </ul>
          </div>
        </div>

        {/* Endpoint Performance Details */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Endpoint Performance Analysis</h2>
          {metricsWithScore.map(metric => (
            <EndpointCard 
              key={metric.endpoint}
              metric={metric}
              isSelected={selectedEndpoint === metric.endpoint}
              onSelect={() => setSelectedEndpoint(selectedEndpoint === metric.endpoint ? null : metric.endpoint)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface EndpointCardProps {
  metric: ExtendedPerformanceMetric;
  isSelected: boolean;
  onSelect: () => void;
}

const EndpointCard: React.FC<EndpointCardProps> = ({ metric, isSelected, onSelect }) => {
  const getPerformanceColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPerformanceLabel = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    return 'Poor';
  };

  const getStatusBadge = (score: number) => {
    if (score >= 90) return 'bg-green-100 text-green-700 border-green-300';
    if (score >= 70) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    return 'bg-red-100 text-red-700 border-red-300';
  };

  // Generate mini trend data
  const miniTrend = Array.from({ length: 20 }, () => ({
    value: metric.response_times.p95 + (Math.random() - 0.5) * 50
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              metric.performance_score >= 90 ? 'bg-green-100' : 
              metric.performance_score >= 70 ? 'bg-yellow-100' : 'bg-red-100'
            }`}>
              {metric.performance_score >= 90 ? (
                <Zap className="text-green-600" size={24} />
              ) : metric.performance_score >= 70 ? (
                <Clock className="text-yellow-600" size={24} />
              ) : (
                <AlertTriangle className="text-red-600" size={24} />
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">{metric.endpoint}</h3>
              <p className="text-sm text-gray-500">{metric.method}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusBadge(metric.performance_score)}`}>
              {getPerformanceLabel(metric.performance_score)}
            </span>
          </div>

          <div className="text-right">
            <div className={`text-3xl font-bold ${getPerformanceColor(metric.performance_score)}`}>
              {metric.performance_score.toFixed(0)}
            </div>
            <div className="text-xs text-gray-500">Performance Score</div>
          </div>
        </div>

        {/* Response Time Metrics */}
        <div className="grid grid-cols-5 gap-4 mb-4">
          <div className="bg-green-50 rounded-lg p-3">
            <div className="flex items-center text-green-600 mb-1">
              <TrendingUp size={14} className="mr-1" />
              <span className="text-xs font-semibold">P50</span>
            </div>
            <div className="text-lg font-bold text-green-900">{metric.response_times.p50}ms</div>
          </div>

          <div className="bg-blue-50 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <Activity size={14} className="mr-1" />
              <span className="text-xs font-semibold">P95</span>
            </div>
            <div className="text-lg font-bold text-blue-900">{metric.response_times.p95}ms</div>
          </div>

          <div className="bg-purple-50 rounded-lg p-3">
            <div className="flex items-center text-purple-600 mb-1">
              <Activity size={14} className="mr-1" />
              <span className="text-xs font-semibold">P99</span>
            </div>
            <div className="text-lg font-bold text-purple-900">{metric.response_times.p99}ms</div>
          </div>

          <div className="bg-orange-50 rounded-lg p-3">
            <div className="flex items-center text-orange-600 mb-1">
              <Users size={14} className="mr-1" />
              <span className="text-xs font-semibold">Throughput</span>
            </div>
            <div className="text-lg font-bold text-orange-900">{metric.throughput}/s</div>
          </div>

          <div className="bg-red-50 rounded-lg p-3">
            <div className="flex items-center text-red-600 mb-1">
              <AlertTriangle size={14} className="mr-1" />
              <span className="text-xs font-semibold">Error Rate</span>
            </div>
            <div className="text-lg font-bold text-red-900">{metric.error_rate}%</div>
          </div>
        </div>

        {/* Mini Trend */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-2">P95 Response Time Trend (Last Hour)</p>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={miniTrend}>
                <defs>
                  <linearGradient id={`gradient-${metric.endpoint}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#3b82f6" 
                  fill={`url(#gradient-${metric.endpoint})`}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <button
          onClick={onSelect}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {isSelected ? '▼ Hide Details' : '▶ Show Detailed Analysis'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
            {/* Performance Analysis */}
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center">
                <Server size={16} className="mr-2" />
                Performance Analysis
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm text-blue-800">
                <div>
                  <p className="font-medium mb-1">Response Time Assessment:</p>
                  <p>
                    {metric.response_times.p95 < 200 ? '✅ Excellent - Well within acceptable range' :
                     metric.response_times.p95 < 500 ? '⚠️ Acceptable - Monitor for degradation' :
                     '❌ Poor - Immediate optimization needed'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Throughput Capacity:</p>
                  <p>
                    {metric.throughput > 500 ? '✅ High capacity - Can handle traffic spikes' :
                     metric.throughput > 200 ? '⚠️ Moderate - Consider scaling for growth' :
                     '❌ Low - Scale immediately'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Error Rate Status:</p>
                  <p>
                    {metric.error_rate < 1 ? '✅ Healthy - Error rate within SLA' :
                     metric.error_rate < 5 ? '⚠️ Elevated - Investigate root causes' :
                     '❌ Critical - Immediate action required'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Overall Health:</p>
                  <p className="font-bold">
                    {metric.performance_score >= 90 ? '✅ Excellent Performance' :
                     metric.performance_score >= 70 ? '⚠️ Needs Monitoring' :
                     '❌ Requires Optimization'}
                  </p>
                </div>
              </div>
            </div>

            {/* Optimization Recommendations */}
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-green-900 mb-3">💡 Optimization Recommendations</h4>
              <ul className="text-sm text-green-800 space-y-2">
                {metric.response_times.p95 > 200 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Implement caching to reduce P95 response times by 30-40%</span>
                  </li>
                )}
                {metric.throughput < 300 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Consider horizontal scaling to improve throughput capacity</span>
                  </li>
                )}
                {metric.error_rate > 1 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Investigate error logs to identify and fix recurring issues</span>
                  </li>
                )}
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Set up alerts for P95 &gt; {metric.response_times.p95 * 1.5}ms to catch degradation early</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Run load tests monthly to validate capacity planning assumptions</span>
                </li>
              </ul>
            </div>

            {/* SLA Compliance */}
            <div className="bg-purple-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-purple-900 mb-3">📊 SLA Compliance</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-purple-700 mb-1">Target P95:</p>
                  <p className="text-lg font-bold text-purple-900">&lt; 500ms</p>
                  <p className="text-xs text-purple-600">
                    {metric.response_times.p95 < 500 ? '✅ Meeting SLA' : '❌ Violating SLA'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-purple-700 mb-1">Target Error Rate:</p>
                  <p className="text-lg font-bold text-purple-900">&lt; 1%</p>
                  <p className="text-xs text-purple-600">
                    {metric.error_rate < 1 ? '✅ Meeting SLA' : '❌ Violating SLA'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-purple-700 mb-1">Uptime Target:</p>
                  <p className="text-lg font-bold text-purple-900">99.9%</p>
                  <p className="text-xs text-purple-600">✅ Meeting SLA</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerformanceTesting;
