import React from 'react';
import type { KPIMetric } from '../data/mockData';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface MetricCardProps {
  metric: KPIMetric;
}

const MetricCard: React.FC<MetricCardProps> = ({ metric }) => {
  const isGood = metric.status === 'good';
  const isWarning = metric.status === 'warning';

  const color = isGood ? '#10b981' : isWarning ? '#f59e0b' : '#ef4444'; // green-500, yellow-500, red-500

  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 hover:shadow-md transition-shadow flex flex-col h-48">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">{metric.name}</p>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {metric.value} <span className="text-sm text-gray-400 font-normal">{metric.unit}</span>
          </h3>
        </div>
        <span className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
          isGood ? 'bg-green-100 text-green-700' : 
          isWarning ? 'bg-yellow-100 text-yellow-700' : 
          'bg-red-100 text-red-700'
        }`}>
          {metric.change > 0 ? <ArrowUpRight size={14} /> : metric.change < 0 ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          <span>{Math.abs(metric.change)}%</span>
        </span>
      </div>

      <div className="flex-1 w-full min-h-0">
        {metric.history && metric.history.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={metric.history}>
              <defs>
                <linearGradient id={`color-${metric.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.1}/>
                  <stop offset="95%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Tooltip 
                contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ color: '#374151', fontSize: '12px' }}
                labelStyle={{ display: 'none' }}
                formatter={(value: number) => [value, '']}
              />
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke={color} 
                fill={`url(#color-${metric.id})`} 
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-800/50 rounded-lg">
            <p className="text-xs text-gray-500 dark:text-slate-400 text-center">
              Trend data available from day 2
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
