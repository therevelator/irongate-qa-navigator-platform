import React, { useState, useEffect } from 'react';
import { ArrowLeft, GitBranch, Clock, CheckCircle, XCircle, AlertTriangle, Cpu, DollarSign, Loader2 } from 'lucide-react';
import type { PipelineStage } from '../data/advancedFeatures';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

interface PipelineVisualizationProps {
  onBack: () => void;
}

const PipelineVisualization: React.FC<PipelineVisualizationProps> = ({ onBack }) => {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStages = async () => {
      try {
        const token = localStorage.getItem('irongate_token');
        const response = await fetch(`${API_URL}/analytics/pipeline-stages`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setStages(data.stages || []);
        }
      } catch (error) {
        console.error('Error fetching pipeline stages:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchStages();
  }, []);
  
  const totalDuration = stages.reduce((acc, s) => acc + s.duration, 0);
  const avgSuccessRate = (stages.reduce((acc, s) => acc + s.success_rate, 0) / stages.length).toFixed(1);
  const totalCost = stages.reduce((acc, s) => acc + s.resource_usage.cost, 0);
  const bottleneck = stages.reduce((prev, current) => 
    current.bottleneck_score > prev.bottleneck_score ? current : prev
  );

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
            <span className="font-medium">Back to Features</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white dark:text-white flex items-center">
                <GitBranch className="mr-3 text-purple-500" size={32} />
                CI/CD Pipeline Insights
              </h1>
              <p className="text-gray-500 dark:text-slate-400 mt-1">Optimize your deployment pipeline with data-driven insights</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400 dark:text-slate-400">Total Duration</p>
                <div className="text-3xl font-bold text-gray-900 dark:text-white dark:text-white">{Math.floor(totalDuration / 60)}m</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400 dark:text-slate-400">Success Rate</p>
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">{avgSuccessRate}%</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400 dark:text-slate-400">Cost per Run</p>
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">${totalCost.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Flow Visualization */}
      <div className="px-8 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white dark:text-white mb-6">Pipeline Flow</h2>
          
          <div className="flex items-center justify-between mb-8">
            {stages.map((stage, index) => (
              <React.Fragment key={stage.id}>
                <PipelineStageNode stage={stage} />
                {index < stages.length - 1 && (
                  <div className="flex-1 mx-4">
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

        {/* Duration Breakdown */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Duration Breakdown</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stages}>
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Duration (seconds)', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  content={({ payload }) => {
                    if (payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg">
                          <p className="font-bold mb-2">{data.name}</p>
                          <p className="text-sm">Duration: {Math.floor(data.duration / 60)}m {data.duration % 60}s</p>
                          <p className="text-sm">Success Rate: {data.success_rate}%</p>
                          <p className="text-sm">Cost: ${data.resource_usage.cost}</p>
                        </div>
                      );
                    }
                    return null;
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
          </div>
        </div>

        {/* Bottleneck Alert */}
        {bottleneck.bottleneck_score > 50 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-8">
            <div className="flex items-start">
              <AlertTriangle className="text-red-600 mr-3 flex-shrink-0" size={24} />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-900 mb-2">Bottleneck Detected: {bottleneck.name}</h3>
                <p className="text-red-800 mb-4">
                  This stage is taking {Math.floor(bottleneck.duration / 60)} minutes and has a bottleneck score of {bottleneck.bottleneck_score.toFixed(1)}. 
                  Consider optimization to reduce overall pipeline time.
                </p>
                <div className="space-y-2">
                  <h4 className="font-semibold text-red-900 dark:text-red-200">Optimization Suggestions:</h4>
                  <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
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
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white dark:text-white">Stage Details</h2>
          {stages.map((stage, index) => (
            <StageDetailCard key={stage.id} stage={stage} stageIndex={index} totalStages={stages.length} />
          ))}
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
    <div className={`relative bg-white dark:bg-slate-900 rounded-lg border-2 ${getBottleneckColor()} p-4 w-32 text-center shadow-md hover:shadow-lg transition-shadow`}>
      <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full ${getStatusColor()} border-2 border-white dark:border-slate-900`}></div>
      <div className="text-xs font-semibold text-gray-900 dark:text-white mb-2 truncate">{stage.name}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-white">{Math.floor(stage.duration / 60)}m</div>
      <div className="text-xs text-gray-500 dark:text-slate-400">{stage.success_rate}%</div>
    </div>
  );
};

interface StageDetailCardProps {
  stage: PipelineStage;
  stageIndex: number;
  totalStages: number;
}

const StageDetailCard: React.FC<StageDetailCardProps> = ({ stage, stageIndex, totalStages }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              stage.success_rate >= 95 ? 'bg-green-100 dark:bg-green-900/30' : stage.success_rate >= 85 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-red-100 dark:bg-red-900/30'
            }`}>
              {stage.success_rate >= 95 ? (
                <CheckCircle className="text-green-600" size={24} />
              ) : stage.success_rate >= 85 ? (
                <AlertTriangle className="text-yellow-600" size={24} />
              ) : (
                <XCircle className="text-red-600" size={24} />
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white dark:text-white">{stage.name}</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400 dark:text-slate-400">Stage {stageIndex + 1} of {totalStages}</p>
            </div>
          </div>

          <div className="flex items-center space-x-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white dark:text-white">{Math.floor(stage.duration / 60)}m {stage.duration % 60}s</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Duration</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${stage.success_rate >= 95 ? 'text-green-600' : stage.success_rate >= 85 ? 'text-yellow-600' : 'text-red-600'}`}>
                {stage.success_rate}%
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Success Rate</div>
            </div>
          </div>
        </div>

        {/* Resource Usage */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <Cpu size={16} className="mr-1" />
              <span className="text-xs font-semibold">CPU Usage</span>
            </div>
            <div className="text-xl font-bold text-blue-900 dark:text-blue-200">{stage.resource_usage.cpu}%</div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
            <div className="flex items-center text-purple-600 dark:text-purple-400 mb-1">
              <Cpu size={16} className="mr-1" />
              <span className="text-xs font-semibold">Memory</span>
            </div>
            <div className="text-xl font-bold text-purple-900 dark:text-purple-200">{stage.resource_usage.memory}%</div>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
            <div className="flex items-center text-green-600 mb-1">
              <DollarSign size={16} className="mr-1" />
              <span className="text-xs font-semibold">Cost</span>
            </div>
            <div className="text-xl font-bold text-green-900 dark:text-green-200">${stage.resource_usage.cost}</div>
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h5 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Potential Time Savings</h5>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">-{Math.floor(stage.duration * 0.3 / 60)}m</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">With recommended optimizations</p>
              </div>
              <div>
                <h5 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Potential Cost Savings</h5>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">-${(stage.resource_usage.cost * 0.25).toFixed(2)}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Per pipeline run</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineVisualization;
