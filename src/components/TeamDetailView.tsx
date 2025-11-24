import React from 'react';
import type { Team } from '../data/mockData';
import { generateDetailedKPIs } from '../data/detailedKPIs';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { AreaChart, Area, Tooltip, ResponsiveContainer } from 'recharts';

interface TeamDetailViewProps {
  team: Team;
  onBack: () => void;
}

const TeamDetailView: React.FC<TeamDetailViewProps> = ({ team, onBack }) => {
  const detailedKPIs = generateDetailedKPIs(team);
  
  const categories = [
    { id: 'quality', name: 'Quality & Testing', color: 'blue' },
    { id: 'speed', name: 'Speed & Efficiency', color: 'purple' },
    { id: 'agile', name: 'Agile & Process', color: 'green' },
    { id: 'reliability', name: 'Reliability & Stability', color: 'orange' }
  ];

  const getKPIsByCategory = (category: string) => {
    return detailedKPIs.filter(kpi => kpi.category === category);
  };

  const scoreColor = team.status === 'good' ? '#10b981' : team.status === 'warning' ? '#f59e0b' : '#ef4444';

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
            <span className="font-medium">Back to Teams</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{team.name}</h1>
              <p className="text-gray-500 dark:text-slate-400 mt-1">{team.department} • Detailed Quality Metrics</p>
            </div>
            
            <div className="flex items-center space-x-8">
              {/* Technical Debt Score */}
              {team.technicalDebtScore !== undefined && (
                <div className="text-right">
                  <p className="text-sm text-gray-500 dark:text-slate-400">Technical Debt</p>
                  <div className="flex items-baseline space-x-1">
                    <div className={`text-3xl font-bold ${
                      team.technicalDebtScore < 30 ? 'text-green-600 dark:text-green-400' :
                      team.technicalDebtScore < 60 ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      {team.technicalDebtScore}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-slate-400">/100</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Lower is better</p>
                </div>
              )}
              
              {/* Task Sizing Accuracy */}
              {team.taskSizingAccuracy !== undefined && (
                <div className="text-right">
                  <p className="text-sm text-gray-500 dark:text-slate-400">Sizing Accuracy</p>
                  <div className="flex items-baseline space-x-1">
                    <div className={`text-3xl font-bold ${
                      Math.abs(team.taskSizingAccuracy - 1.0) < 0.15 ? 'text-green-600 dark:text-green-400' :
                      Math.abs(team.taskSizingAccuracy - 1.0) < 0.3 ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      {team.taskSizingAccuracy.toFixed(2)}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-slate-400">x</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                    {team.taskSizingAccuracy < 0.85 ? 'Overestimated' : 
                     team.taskSizingAccuracy > 1.15 ? 'Underestimated' : 
                     'Well estimated'}
                  </p>
                </div>
              )}
              
              {/* QA Score */}
              <div className="text-right">
                <p className="text-sm text-gray-500 dark:text-slate-400">Team QA Score</p>
                <div className="text-4xl font-bold text-gray-900 dark:text-white">{team.qaScore}/100</div>
              </div>
              <div className="relative w-20 h-20">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="40" cy="40" r="35" stroke="#e5e7eb" strokeWidth="6" fill="transparent" className="dark:stroke-slate-700" />
                  <circle 
                    cx="40" 
                    cy="40" 
                    r="35" 
                    stroke={scoreColor} 
                    strokeWidth="6" 
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 35}
                    strokeDashoffset={2 * Math.PI * 35 - (team.qaScore / 100) * 2 * Math.PI * 35}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xl font-bold text-gray-900 dark:text-white">
                  {team.qaScore}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-8">
        {categories.map(category => {
          const kpis = getKPIsByCategory(category.id);
          return (
            <div key={category.id} className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center">
                <span className={`w-1 h-8 bg-${category.color}-500 rounded-full mr-3`}></span>
                {category.name}
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {kpis.map(kpi => (
                  <div key={kpi.id} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{kpi.name}</h3>
                        <p className="text-xs text-gray-500 dark:text-slate-400">{kpi.description}</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ml-2 flex-shrink-0 ${
                        kpi.status === 'good' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 
                        kpi.status === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 
                        'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}>
                        {kpi.status}
                      </span>
                    </div>

                    <div className="mb-4">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">
                        {kpi.value}
                        <span className="text-lg font-normal text-gray-400 dark:text-slate-500 ml-1">{kpi.unit}</span>
                      </div>
                      <div className={`flex items-center text-sm font-medium mt-1 ${
                        kpi.change > 0 ? 'text-green-600 dark:text-green-400' : kpi.change < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'
                      }`}>
                        {kpi.change > 0 ? <TrendingUp size={16} className="mr-1"/> : 
                         kpi.change < 0 ? <TrendingDown size={16} className="mr-1"/> : 
                         <Minus size={16} className="mr-1"/>}
                        {Math.abs(kpi.change)}% vs last period
                      </div>
                    </div>

                    <div className="h-24">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={kpi.history}>
                          <defs>
                            <linearGradient id={`gradient-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={scoreColor} stopOpacity={0.2}/>
                              <stop offset="95%" stopColor={scoreColor} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#1f2937', 
                              color: '#fff', 
                              borderRadius: '8px', 
                              border: 'none',
                              fontSize: '12px'
                            }}
                            labelStyle={{ color: '#9ca3af' }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke={scoreColor} 
                            fill={`url(#gradient-${kpi.id})`}
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TeamDetailView;
