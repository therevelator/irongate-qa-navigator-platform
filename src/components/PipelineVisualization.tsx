import React, { useState, useEffect } from 'react';
import { ArrowLeft, GitBranch, Clock, CheckCircle, XCircle, AlertTriangle, Cpu, DollarSign, Loader2 } from 'lucide-react';
import type { PipelineStage } from '../data/advancedFeatures';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, AreaChart, Area, CartesianGrid } from 'recharts';
import { API_URL } from '../config/api';

// =============================================================================
// PRODUCTION-READY UTILITY FUNCTIONS (Commented for reference)
// =============================================================================

// /**
//  * Computes mean and standard deviation for a set of durations.
//  * Used for z-score normalization in bottleneck calculation.
//  * 
//  * @param durations - Array of duration values in seconds
//  * @returns Object with mean and stdDev properties
//  * 
//  * @example
//  * const { mean, stdDev } = computeDurationStats([120, 180, 300, 90, 150]);
//  * // mean = 168, stdDev = 73.5
//  */
// export function computeDurationStats(durations: number[]): { mean: number; stdDev: number } {
//   if (durations.length === 0) {
//     return { mean: 0, stdDev: 0 };
//   }
//
//   const mean = durations.reduce((sum, val) => sum + val, 0) / durations.length;
//   const variance = durations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / durations.length;
//   const stdDev = Math.sqrt(Math.max(variance, 1e-6)); // Prevent division by zero
//
//   return { mean, stdDev };
// }

// /**
//  * Calculates the bottleneck score for a pipeline stage using z-score normalization.
//  * 
//  * Formula breakdown:
//  * 1. durationZ = (stage_duration - mean) / stdDev
//  *    - Measures how many standard deviations from the mean
//  * 
//  * 2. durationFactor = clamp(((durationZ + 2) / 4) × 60, 0, 60)
//  *    - Maps z-score to 0-60 range
//  *    - z = -2 (very fast) → 0 points
//  *    - z = 0 (average) → 30 points
//  *    - z = +2 (very slow) → 60 points
//  * 
//  * 3. failureFactor = (1 - successRate/100) × 40
//  *    - Penalizes low success rates
//  *    - 100% success → 0 points
//  *    - 90% success → 4 points
//  *    - 50% success → 20 points
//  * 
//  * 4. bottleneck_score = durationFactor + failureFactor (capped at 100)
//  * 
//  * @param duration - Stage duration in seconds
//  * @param successRate - Stage success rate (0-100)
//  * @param mean - Mean duration across all stages
//  * @param stdDev - Standard deviation of durations
//  * @returns Bottleneck score (0-100)
//  * 
//  * @example
//  * // Stage with 300s duration (slow) and 92% success rate
//  * const score = calculateBottleneckScore(300, 92, 168, 73.5);
//  * // durationZ = 1.79, durationFactor = 56.9, failureFactor = 3.2
//  * // score = 60.1
//  */
// export function calculateBottleneckScore(
//   duration: number,
//   successRate: number,
//   mean: number,
//   stdDev: number
// ): number {
//   // Validate inputs
//   if (duration < 0) {
//     throw new Error('Duration cannot be negative');
//   }
//   if (successRate < 0 || successRate > 100) {
//     throw new Error('Success rate must be between 0 and 100');
//   }
//
//   // Calculate z-score for duration
//   const durationZ = stdDev > 0 ? (duration - mean) / stdDev : 0;
//
//   // Map z-score to 0-60 range using linear interpolation
//   // z = -2 maps to 0, z = +2 maps to 60
//   const durationFactor = Math.min(60, Math.max(0, ((durationZ + 2) / 4) * 60));
//
//   // Calculate failure penalty (0-40 range)
//   const successDecimal = Math.max(0, Math.min(1, successRate / 100));
//   const failureFactor = (1 - successDecimal) * 40;
//
//   // Combine factors and clamp to 0-100
//   const score = durationFactor + failureFactor;
//   return Math.round(Math.min(100, Math.max(0, score)) * 10) / 10;
// }

// /**
//  * Calculates bottleneck scores for all stages in a pipeline.
//  * Automatically computes mean and stdDev from the provided stages.
//  * 
//  * @param stages - Array of pipeline stages with duration and success_rate
//  * @returns Array of stages with calculated bottleneck_score
//  * 
//  * @example
//  * const stages = [
//  *   { id: '1', name: 'Build', duration: 120, success_rate: 99 },
//  *   { id: '2', name: 'Test', duration: 300, success_rate: 92 }
//  * ];
//  * const withScores = calculateAllBottleneckScores(stages);
//  * // [{ ...stage1, bottleneck_score: 20.7 }, { ...stage2, bottleneck_score: 60.1 }]
//  */
// export function calculateAllBottleneckScores<T extends { duration: number; success_rate: number }>(
//   stages: T[]
// ): (T & { bottleneck_score: number })[] {
//   if (stages.length === 0) {
//     return [];
//   }
//
//   const durations = stages.map(s => s.duration);
//   const { mean, stdDev } = computeDurationStats(durations);
//
//   return stages.map(stage => ({
//     ...stage,
//     bottleneck_score: calculateBottleneckScore(
//       stage.duration,
//       stage.success_rate,
//       mean,
//       stdDev
//     )
//   }));
// }

// /**
//  * Identifies the bottleneck stage (highest bottleneck score).
//  * 
//  * @param stages - Array of pipeline stages with bottleneck_score
//  * @returns The stage with the highest bottleneck score, or null if empty
//  */
// export function findBottleneckStage<T extends { bottleneck_score: number }>(
//   stages: T[]
// ): T | null {
//   if (stages.length === 0) return null;
//   return stages.reduce((prev, current) =>
//     current.bottleneck_score > prev.bottleneck_score ? current : prev
//   );
// }

// /**
//  * Calculates potential time savings based on bottleneck optimization.
//  * 
//  * @param bottleneckDuration - Duration of the bottleneck stage in seconds
//  * @param timeSavingsPercent - Expected time savings percentage (0-100)
//  * @returns Potential time savings in seconds
//  */
// export function calculateTimeSavings(
//   bottleneckDuration: number,
//   timeSavingsPercent: number
// ): number {
//   return bottleneckDuration * (timeSavingsPercent / 100);
// }

// /**
//  * Calculates potential cost savings based on total pipeline cost.
//  * 
//  * @param totalCost - Total cost of all pipeline stages
//  * @param costSavingsPercent - Expected cost savings percentage (0-100)
//  * @returns Potential cost savings in dollars
//  */
// export function calculateCostSavings(
//   totalCost: number,
//   costSavingsPercent: number
// ): number {
//   return totalCost * (costSavingsPercent / 100);
// }

// /**
//  * Formats duration in seconds to human-readable string.
//  * 
//  * @param seconds - Duration in seconds
//  * @returns Formatted string (e.g., "5m 30s" or "2h 15m")
//  */
// export function formatDuration(seconds: number): string {
//   if (seconds < 60) {
//     return `${Math.round(seconds)}s`;
//   }
//   if (seconds < 3600) {
//     const mins = Math.floor(seconds / 60);
//     const secs = Math.round(seconds % 60);
//     return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
//   }
//   const hours = Math.floor(seconds / 3600);
//   const mins = Math.round((seconds % 3600) / 60);
//   return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
// }

// /**
//  * Gets severity level based on bottleneck score.
//  * 
//  * @param score - Bottleneck score (0-100)
//  * @returns Severity level and recommended action
//  */
// export function getBottleneckSeverity(score: number): {
//   level: 'low' | 'medium' | 'high' | 'critical';
//   color: string;
//   action: string;
// } {
//   if (score < 25) {
//     return { level: 'low', color: 'green', action: 'No immediate action needed' };
//   }
//   if (score < 50) {
//     return { level: 'medium', color: 'yellow', action: 'Monitor and optimize when convenient' };
//   }
//   if (score < 75) {
//     return { level: 'high', color: 'orange', action: 'Prioritize optimization' };
//   }
//   return { level: 'critical', color: 'red', action: 'Immediate attention required' };
// }

// =============================================================================
// END PRODUCTION-READY UTILITY FUNCTIONS
// =============================================================================

interface PipelineVisualizationProps {
  onBack: () => void;
  teamId?: string;
}

interface PipelineConfig {
  time_savings_percent: number;
  cost_savings_percent: number;
  cost_per_minute: number;
}

interface PipelineHistoryPoint {
  date: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  failure_rate: number;
  avg_duration_seconds: number;
  total_cost: number;
}

const PipelineVisualization: React.FC<PipelineVisualizationProps> = ({ onBack, teamId }) => {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<PipelineConfig>({
    time_savings_percent: 30,
    cost_savings_percent: 25,
    cost_per_minute: 0.50
  });
  const [history, setHistory] = useState<PipelineHistoryPoint[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('irongate_token');
        const stagesUrl = teamId
          ? `${API_URL}/analytics/pipeline-stages?teamId=${teamId}`
          : `${API_URL}/analytics/pipeline-stages`;
        const historyUrl = teamId
          ? `${API_URL}/analytics/pipeline-history?days=14&teamId=${teamId}`
          : `${API_URL}/analytics/pipeline-history?days=14`;
        const [stagesRes, historyRes] = await Promise.all([
          fetch(stagesUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(historyUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);

        if (stagesRes.ok) {
          const data = await stagesRes.json();
          setStages(data.stages || []);
          if (data.config) {
            setConfig({
              time_savings_percent: data.config.time_savings_percent || 30,
              cost_savings_percent: data.config.cost_savings_percent || 25,
              cost_per_minute: data.config.cost_per_minute || 0.50
            });
          }
        }

        if (historyRes.ok) {
          const historyData = await historyRes.json();
          setHistory(historyData.history || []);
        }
      } catch (error) {
        console.error('Error fetching pipeline stages:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [teamId]);
  
  const hasStages = stages.length > 0;
  const totalDuration = hasStages ? stages.reduce((acc, s) => acc + s.duration, 0) : 0;
  const avgSuccessRate = hasStages
    ? (stages.reduce((acc, s) => acc + s.success_rate, 0) / stages.length).toFixed(1)
    : '0.0';
  const totalCost = hasStages ? stages.reduce((acc, s) => acc + s.resource_usage.cost, 0) : 0;
  const bottleneck = hasStages
    ? stages.reduce((prev, current) =>
        current.bottleneck_score > prev.bottleneck_score ? current : prev
      )
    : null;

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
            <span className="font-medium">Back to Features</span>
          </button>
          
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <GitBranch className="mr-2 sm:mr-3 text-purple-500" size={24} />
                CI/CD Pipeline Insights
              </h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Optimize your deployment pipeline with data-driven insights</p>
            </div>
            
            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
              <div className="text-center bg-gray-50 dark:bg-slate-800 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Duration</p>
                <div className="text-lg sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">{Math.floor(totalDuration / 60)}m</div>
              </div>
              <div className="text-center bg-green-50 dark:bg-green-900/20 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Success</p>
                <div className="text-lg sm:text-2xl lg:text-3xl font-bold text-green-600 dark:text-green-400">{avgSuccessRate}%</div>
              </div>
              <div className="text-center bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Cost</p>
                <div className="text-lg sm:text-2xl lg:text-3xl font-bold text-blue-600 dark:text-blue-400">${totalCost.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Flow Visualization */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 mb-6 sm:mb-8">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4 sm:mb-6">Pipeline Flow</h2>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          ) : stages.length === 0 ? (
            <div className="text-center py-12">
              <GitBranch className="w-12 h-12 text-gray-400 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-slate-400">No pipeline stages available</p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-4">
              <div className="flex items-center justify-between min-w-max gap-2">
                {stages.map((stage, index) => (
                  <React.Fragment key={stage.id}>
                    <PipelineStageNode stage={stage} />
                    {index < stages.length - 1 && (
                      <div className="flex-1 min-w-8 mx-1 sm:mx-2">
                        <div className="h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full relative">
                          <div className="absolute right-0 top-1/2 transform -translate-y-1/2">
                            <div className="w-0 h-0 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-8 border-l-purple-500"></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Duration Breakdown */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 mb-6 sm:mb-8">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4">Duration Breakdown</h2>
          <div className="h-48 sm:h-56 lg:h-64">
            {stages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 dark:text-slate-400">No data available</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stages}>
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                  <YAxis label={{ value: 'Duration (seconds)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg">
                          <p className="font-bold mb-2">{data.name}</p>
                          <p className="text-sm">Duration: {Math.floor(data.duration / 60)}m {data.duration % 60}s</p>
                          <p className="text-sm">Success Rate: {data.success_rate}%</p>
                          <p className="text-sm">Cost: ${data.resource_usage.cost}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="duration" radius={[8, 8, 0, 0]}>
                    {stages.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`}
                        fill={entry.bottleneck_score > 70 ? '#ef4444' : entry.bottleneck_score > 40 ? '#f59e0b' : '#3b82f6'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Historical Trends */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 mb-6 sm:mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Pipeline Performance (14 days)</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">Success vs failed runs with average duration</p>
            </div>
            {history.length > 0 && (
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-slate-400 mr-1">Avg Failure Rate:</span>
                  <span className="font-semibold text-red-500 dark:text-red-400">
                    {(
                      history.reduce((acc, point) => acc + point.failure_rate, 0) / history.length
                    ).toFixed(2)}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-slate-400 mr-1">Avg Duration:</span>
                  <span className="font-semibold text-blue-500 dark:text-blue-400">
                    {(history.reduce((acc, point) => acc + point.avg_duration_seconds, 0) / history.length / 60).toFixed(1)}m
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="h-60">
            {history.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 dark:text-slate-400">No historical data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="date" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.5rem', color: '#fff' }} />
                  <Area yAxisId="left" type="monotone" dataKey="successful_runs" stroke="#22c55e" fillOpacity={1} fill="url(#successGradient)" name="Successful" />
                  <Area yAxisId="left" type="monotone" dataKey="failed_runs" stroke="#ef4444" fillOpacity={1} fill="url(#failedGradient)" name="Failed" />
                  <Line yAxisId="right" type="monotone" dataKey="failure_rate" stroke="#f59e0b" strokeWidth={2} name="Failure %" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bottleneck Alert */}
        {bottleneck && bottleneck.bottleneck_score > 50 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 sm:p-6 mb-6 sm:mb-8">
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              <AlertTriangle className="text-red-600 dark:text-red-400 flex-shrink-0" size={24} />
              <div className="flex-1">
                <h3 className="text-base sm:text-lg font-bold text-red-900 dark:text-red-200 mb-2">Bottleneck Detected: {bottleneck.name}</h3>
                <p className="text-sm text-red-800 dark:text-red-300 mb-4">
                  This stage is taking {Math.floor(bottleneck.duration / 60)} minutes and has a bottleneck score of {bottleneck.bottleneck_score.toFixed(1)}. 
                  Consider optimization to reduce overall pipeline time.
                </p>
                <div className="space-y-2">
                  <h4 className="font-semibold text-red-900 dark:text-red-200">Optimization Suggestions:</h4>
                  <ul className="text-xs sm:text-sm text-red-800 dark:text-red-300 space-y-1 list-disc list-inside">
                    <li>Implement parallel execution where possible</li>
                    <li>Cache dependencies to reduce build time</li>
                    <li>Use incremental builds/tests</li>
                    <li>Optimize resource allocation (currently {bottleneck.resource_usage.cpu}% CPU)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stage Details */}
        <div className="space-y-3 sm:space-y-4">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Stage Details</h2>
          {stages.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
              <GitBranch className="w-12 h-12 text-gray-400 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-slate-400">No stages to display</p>
            </div>
          ) : (
            stages.map((stage, index) => (
              <StageDetailCard key={stage.id} stage={stage} stageIndex={index} totalStages={stages.length} config={config} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

interface PipelineStageNodeProps {
  stage: PipelineStage;
}

const PipelineStageNode: React.FC<PipelineStageNodeProps> = ({ stage }) => {
  const getStatusColor = () => {
    if (stage.success_rate >= 95) return 'bg-green-500';
    if (stage.success_rate >= 85) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getBottleneckColor = () => {
    if (stage.bottleneck_score > 70) return 'border-red-500';
    if (stage.bottleneck_score > 40) return 'border-yellow-500';
    return 'border-blue-500';
  };

  return (
    <div className={`relative bg-white dark:bg-slate-900 rounded-lg border-2 ${getBottleneckColor()} p-2 sm:p-4 w-20 sm:w-28 lg:w-32 text-center shadow-md hover:shadow-lg transition-shadow flex-shrink-0`}>
      <div className={`absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 w-4 h-4 sm:w-6 sm:h-6 rounded-full ${getStatusColor()} border-2 border-white dark:border-slate-900`}></div>
      <div className="text-[10px] sm:text-xs font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2 truncate">{stage.name}</div>
      <div className="text-sm sm:text-lg font-bold text-gray-900 dark:text-white">{Math.floor(stage.duration / 60)}m</div>
      <div className="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400">{stage.success_rate}%</div>
    </div>
  );
};

interface StageDetailCardProps {
  stage: PipelineStage;
  stageIndex: number;
  config: PipelineConfig;
  totalStages: number;
}

const StageDetailCard: React.FC<StageDetailCardProps> = ({ stage, stageIndex, totalStages, config }) => {
  const [expanded, setExpanded] = useState(false);
  
  // Calculate savings based on config
  const timeSavingsMinutes = Math.max(0, Math.floor(stage.duration * (config.time_savings_percent / 100) / 60));
  const costSavings = Math.max(0, stage.resource_usage.cost * (config.cost_savings_percent / 100));

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden">
      <div className="p-4 sm:p-6">
        {/* Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center ${
              stage.success_rate >= 95 ? 'bg-green-100 dark:bg-green-900/30' : stage.success_rate >= 85 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-red-100 dark:bg-red-900/30'
            }`}>
              {stage.success_rate >= 95 ? (
                <CheckCircle className="text-green-600 dark:text-green-400" size={20} />
              ) : stage.success_rate >= 85 ? (
                <AlertTriangle className="text-yellow-600 dark:text-yellow-400" size={20} />
              ) : (
                <XCircle className="text-red-600 dark:text-red-400" size={20} />
              )}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">{stage.name}</h3>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Stage {stageIndex + 1} of {totalStages}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <div className="text-center">
              <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{Math.floor(stage.duration / 60)}m {stage.duration % 60}s</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Duration</div>
            </div>
            <div className="text-center">
              <div className={`text-lg sm:text-2xl font-bold ${stage.success_rate >= 95 ? 'text-green-600 dark:text-green-400' : stage.success_rate >= 85 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                {stage.success_rate}%
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Success Rate</div>
            </div>
          </div>
        </div>

        {/* Resource Usage */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 sm:p-3">
            <div className="flex items-center text-blue-600 dark:text-blue-400 mb-1">
              <Cpu size={14} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold truncate">CPU</span>
            </div>
            <div className="text-base sm:text-xl font-bold text-blue-900 dark:text-blue-200">{stage.resource_usage.cpu}%</div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 sm:p-3">
            <div className="flex items-center text-purple-600 dark:text-purple-400 mb-1">
              <Cpu size={14} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold truncate">Memory</span>
            </div>
            <div className="text-base sm:text-xl font-bold text-purple-900 dark:text-purple-200">{stage.resource_usage.memory}%</div>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 sm:p-3">
            <div className="flex items-center text-green-600 dark:text-green-400 mb-1">
              <DollarSign size={14} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold truncate">Cost</span>
            </div>
            <div className="text-base sm:text-xl font-bold text-green-900 dark:text-green-200">${stage.resource_usage.cost}</div>
          </div>
        </div>

        {/* Bottleneck Score */}
        {stage.bottleneck_score > 50 && (
          <div className={`rounded-lg p-3 mb-4 ${
            stage.bottleneck_score > 70 ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm font-semibold ${stage.bottleneck_score > 70 ? 'text-red-900 dark:text-red-200' : 'text-yellow-900 dark:text-yellow-200'}`}>
                  ⚠️ Bottleneck Score: {stage.bottleneck_score.toFixed(1)}
                </span>
                <p className={`text-xs ${stage.bottleneck_score > 70 ? 'text-red-700 dark:text-red-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                  This stage is slowing down your pipeline
                </p>
              </div>
              <div className="w-24 h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${stage.bottleneck_score > 70 ? 'bg-red-500' : 'bg-yellow-500'}`}
                  style={{ width: `${stage.bottleneck_score}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
        >
          {expanded ? '▼ Hide Recommendations' : '▶ Show Optimization Recommendations'}
        </button>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 space-y-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-3">💡 Optimization Recommendations</h4>
              <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-2">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Consider caching dependencies to reduce build time by 30-40%</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Implement parallel test execution to improve efficiency</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Use incremental builds to only rebuild changed components</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Optimize resource allocation - current CPU usage is {stage.resource_usage.cpu}%</span>
                </li>
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="bg-green-50 dark:bg-green-900/10 rounded-lg p-3">
                <h5 className="text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1 sm:mb-2">Potential Time Savings</h5>
                <p className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">-{timeSavingsMinutes}m</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">With {config.time_savings_percent}% optimization</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/10 rounded-lg p-3">
                <h5 className="text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1 sm:mb-2">Potential Cost Savings</h5>
                <p className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">-${costSavings.toFixed(2)}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">With {config.cost_savings_percent}% optimization</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineVisualization;
