import React from 'react';
import type { Team } from '../data/mockData';
import { BarChart, Bar, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface TeamRowProps {
  team: Team;
  onClick: () => void;
}

const TeamRow: React.FC<TeamRowProps> = ({ team, onClick }) => {
  // Color based on QA Score ranges
  const getScoreColor = (score: number) => {
    if (score >= 75) return '#10b981'; // Green (75-100)
    if (score >= 50) return '#eab308'; // Yellow (50-75)
    if (score >= 30) return '#f97316'; // Orange (30-50)
    return '#ef4444'; // Red (0-30)
  };
  
  const scoreColor = getScoreColor(team.qaScore);
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (team.qaScore / 100) * circumference;

  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-2xl shadow-md hover:shadow-xl border border-slate-200/60 overflow-hidden transition-all duration-300 cursor-pointer group hover:scale-[1.01]"
    >
      <div className="flex items-center p-6 h-36">
        {/* Status Strip */}
        <div 
          className="w-2 self-stretch rounded-full mr-5"
          style={{
            background: team.qaScore >= 75 
              ? 'linear-gradient(to bottom, #34d399, #10b981)' // Green
              : team.qaScore >= 50 
              ? 'linear-gradient(to bottom, #fde047, #eab308)' // Yellow
              : team.qaScore >= 30 
              ? 'linear-gradient(to bottom, #fb923c, #f97316)' // Orange
              : 'linear-gradient(to bottom, #f87171, #ef4444)' // Red
          }}
        />

        {/* Team Info & Score */}
        <div className="w-64 flex items-center space-x-6">
          <div className="relative w-16 h-16 flex-shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="32"
                cy="32"
                r={radius}
                stroke="#e5e7eb"
                strokeWidth="5"
                fill="transparent"
              />
              <circle
                cx="32"
                cy="32"
                r={radius}
                stroke={scoreColor}
                strokeWidth="5"
                fill="transparent"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-700">
              {team.qaScore}
            </div>
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-xl mb-1">{team.name}</h3>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{team.department}</p>
          </div>
        </div>

        {/* Velocity Chart */}
        <div className="w-64 h-full px-6 border-l border-slate-200 flex flex-col justify-center">
           <p className="text-xs text-slate-500 font-medium mb-2 text-center">Velocity (Last 5 Sprints)</p>
           <div className="h-16 w-full">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={team.velocity} barGap={2}>
                 <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '6px', fontSize: '12px' }}
                    cursor={{ fill: 'transparent' }}
                 />
                 <Bar dataKey="committed" fill="#e5e7eb" radius={[2, 2, 0, 0]} />
                 <Bar dataKey="delivered" fill={scoreColor} radius={[2, 2, 0, 0]} />
               </BarChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="flex-1 grid grid-cols-4 gap-6 px-8 border-l border-slate-200">
          {team.metrics.map(metric => (
            <div key={metric.id} className="text-center">
              <p className="text-xs text-slate-500 font-medium mb-1.5">{metric.name}</p>
              <div className="font-bold text-slate-900 text-xl">
                {metric.value}
                <span className="text-sm font-normal text-slate-400 ml-0.5">{metric.unit}</span>
              </div>
              <div className={`flex items-center justify-center text-xs font-medium mt-1 ${
                metric.trend === 'up' ? (metric.id === 'coverage' ? 'text-green-600' : 'text-red-600') : 
                metric.trend === 'down' ? (metric.id === 'coverage' ? 'text-red-600' : 'text-green-600') : 'text-gray-500'
              }`}>
                {metric.change > 0 ? <TrendingUp size={12} className="mr-1"/> : metric.change < 0 ? <TrendingDown size={12} className="mr-1"/> : <Minus size={12} className="mr-1"/>}
                {Math.abs(metric.change)}%
              </div>
            </div>
          ))}
        </div>

        {/* Action */}
        <div className="pl-6 border-l border-slate-200">
          <button className="p-3 rounded-full bg-slate-50 group-hover:bg-blue-500 text-slate-400 group-hover:text-white transition-all duration-300">
            <ChevronRight size={22} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TeamRow;
