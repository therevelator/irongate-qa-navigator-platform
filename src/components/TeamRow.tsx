import React from 'react';
import type { Team } from '../data/mockData';
import { BarChart, Bar, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface TeamRowProps {
  team: Team;
  onClick: () => void;
}

const TeamRow: React.FC<TeamRowProps> = ({ team, onClick }) => {
  const scoreColor = team.status === 'good' ? '#10b981' : team.status === 'warning' ? '#f59e0b' : '#ef4444';
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (team.qaScore / 100) * circumference;

  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-center p-4 h-32">
        {/* Status Strip */}
        <div className={`w-1.5 self-stretch rounded-full mr-4 ${
          team.status === 'good' ? 'bg-green-500' : team.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
        }`} />

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
            <h3 className="font-bold text-gray-900 text-lg">{team.name}</h3>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{team.department}</p>
          </div>
        </div>

        {/* Velocity Chart */}
        <div className="w-64 h-full px-4 border-l border-gray-100 flex flex-col justify-center">
           <p className="text-xs text-gray-400 mb-2 text-center">Velocity (Last 5 Sprints)</p>
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
        <div className="flex-1 grid grid-cols-4 gap-4 px-6 border-l border-gray-100">
          {team.metrics.map(metric => (
            <div key={metric.id} className="text-center">
              <p className="text-xs text-gray-400 mb-1">{metric.name}</p>
              <div className="font-bold text-gray-900 text-lg">
                {metric.value}
                <span className="text-xs font-normal text-gray-400 ml-0.5">{metric.unit}</span>
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
        <div className="pl-4 border-l border-gray-100">
          <button className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TeamRow;
