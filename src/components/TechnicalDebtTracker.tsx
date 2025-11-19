import React, { useState } from 'react';
import { ArrowLeft, Wrench, AlertCircle, Clock, DollarSign, TrendingUp, Filter } from 'lucide-react';
import { generateTechnicalDebt } from '../data/advancedFeatures';
import type { TechnicalDebt } from '../data/advancedFeatures';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis } from 'recharts';

interface TechnicalDebtTrackerProps {
  onBack: () => void;
}

const TechnicalDebtTracker: React.FC<TechnicalDebtTrackerProps> = ({ onBack }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'effort' | 'cost'>('priority');
  
  const debtItems = generateTechnicalDebt();

  const filteredDebt = debtItems.filter(item => {
    const categoryMatch = selectedCategory === 'all' || item.category === selectedCategory;
    const severityMatch = selectedSeverity === 'all' || item.severity === selectedSeverity;
    return categoryMatch && severityMatch && item.status !== 'resolved';
  });

  const sortedDebt = [...filteredDebt].sort((a, b) => {
    if (sortBy === 'priority') return b.priority_score - a.priority_score;
    if (sortBy === 'effort') return a.estimated_effort_hours - b.estimated_effort_hours;
    return b.cost_of_delay - a.cost_of_delay;
  });

  const totalDebt = debtItems.filter(d => d.status !== 'resolved').length;
  const totalEffort = debtItems.reduce((acc, d) => d.status !== 'resolved' ? acc + d.estimated_effort_hours : acc, 0);
  const totalCost = debtItems.reduce((acc, d) => d.status !== 'resolved' ? acc + d.cost_of_delay : acc, 0);
  const inProgress = debtItems.filter(d => d.status === 'in_progress').length;

  const categories = [
    { id: 'all', name: 'All Categories', icon: '📋', color: 'gray' },
    { id: 'code_quality', name: 'Code Quality', icon: '🔧', color: 'blue' },
    { id: 'architecture', name: 'Architecture', icon: '🏗️', color: 'purple' },
    { id: 'testing', name: 'Testing', icon: '🧪', color: 'green' },
    { id: 'documentation', name: 'Documentation', icon: '📚', color: 'yellow' },
    { id: 'security', name: 'Security', icon: '🔒', color: 'red' }
  ];

  const severities = [
    { id: 'all', name: 'All Severities' },
    { id: 'critical', name: 'Critical' },
    { id: 'high', name: 'High' },
    { id: 'medium', name: 'Medium' },
    { id: 'low', name: 'Low' }
  ];

  // Prepare data for priority matrix
  const matrixData = filteredDebt.map(item => ({
    name: item.title,
    effort: item.estimated_effort_hours,
    impact: item.cost_of_delay / 1000,
    priority: item.priority_score,
    severity: item.severity
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
                <Wrench className="mr-3 text-orange-500" size={32} />
                Technical Debt Tracker
              </h1>
              <p className="text-gray-500 mt-1">Prioritize and manage technical debt across your codebase</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Total Items</p>
                <div className="text-3xl font-bold text-gray-900">{totalDebt}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Total Effort</p>
                <div className="text-3xl font-bold text-blue-600">{totalEffort}h</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Cost of Delay</p>
                <div className="text-3xl font-bold text-red-600">${(totalCost / 1000).toFixed(0)}K</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">In Progress</p>
                <div className="text-3xl font-bold text-green-600">{inProgress}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-8 py-6 bg-white border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Filter size={20} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Category:</span>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span className="mr-2">{cat.icon}</span>
                {cat.name}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-4">
            <span className="text-sm font-semibold text-gray-700">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="priority">Priority Score</option>
              <option value="effort">Effort (Low to High)</option>
              <option value="cost">Cost of Delay</option>
            </select>
          </div>
        </div>

        <div className="flex items-center space-x-4 mt-4">
          <span className="text-sm font-semibold text-gray-700">Severity:</span>
          {severities.map(sev => (
            <button
              key={sev.id}
              onClick={() => setSelectedSeverity(sev.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                selectedSeverity === sev.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {sev.name}
            </button>
          ))}
        </div>
      </div>

      {/* Priority Matrix */}
      <div className="px-8 py-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Priority Matrix (Effort vs Impact)</h2>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                <XAxis 
                  type="number" 
                  dataKey="effort" 
                  name="Effort (hours)" 
                  label={{ value: 'Effort (hours)', position: 'bottom', offset: 40 }}
                />
                <YAxis 
                  type="number" 
                  dataKey="impact" 
                  name="Impact ($K)" 
                  label={{ value: 'Impact ($K)', angle: -90, position: 'left', offset: 40 }}
                />
                <ZAxis type="number" dataKey="priority" range={[100, 1000]} />
                <Tooltip 
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg">
                          <p className="font-bold mb-1">{data.name}</p>
                          <p className="text-sm">Effort: {data.effort}h</p>
                          <p className="text-sm">Impact: ${data.impact}K</p>
                          <p className="text-sm">Priority: {data.priority.toFixed(1)}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Scatter data={matrixData} fill="#3b82f6">
                  {matrixData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={
                        entry.severity === 'critical' ? '#ef4444' :
                        entry.severity === 'high' ? '#f59e0b' :
                        entry.severity === 'medium' ? '#3b82f6' :
                        '#10b981'
                      }
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center space-x-6 mt-4 text-sm">
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div>
              <span>Critical</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
              <span>High</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
              <span>Medium</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
              <span>Low</span>
            </div>
          </div>
        </div>

        {/* Debt Items List */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Debt Items ({sortedDebt.length})</h2>
          {sortedDebt.map(item => (
            <DebtCard key={item.id} debt={item} />
          ))}
        </div>
      </div>
    </div>
  );
};

interface DebtCardProps {
  debt: TechnicalDebt;
}

const DebtCard: React.FC<DebtCardProps> = ({ debt }) => {
  const [expanded, setExpanded] = useState(false);

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-100 text-red-700 border-red-300',
      high: 'bg-orange-100 text-orange-700 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-700 border-yellow-300',
      low: 'bg-green-100 text-green-700 border-green-300'
    };
    return colors[severity] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, string> = {
      code_quality: '🔧',
      architecture: '🏗️',
      testing: '🧪',
      documentation: '📚',
      security: '🔒'
    };
    return icons[category] || '📋';
  };

  const daysSinceCreated = Math.floor((Date.now() - new Date(debt.created_date).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-2xl">{getCategoryIcon(debt.category)}</span>
              <h3 className="text-lg font-bold text-gray-900">{debt.title}</h3>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getSeverityColor(debt.severity)}`}>
                {debt.severity.toUpperCase()}
              </span>
              {debt.status === 'in_progress' && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                  IN PROGRESS
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600">{debt.description}</p>
          </div>
          
          <div className="text-right ml-6">
            <div className="text-3xl font-bold text-gray-900">{debt.priority_score.toFixed(1)}</div>
            <div className="text-xs text-gray-500">Priority Score</div>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <Clock size={16} className="mr-1" />
              <span className="text-xs font-semibold">Effort</span>
            </div>
            <div className="text-xl font-bold text-blue-900">{debt.estimated_effort_hours}h</div>
          </div>

          <div className="bg-red-50 rounded-lg p-3">
            <div className="flex items-center text-red-600 mb-1">
              <DollarSign size={16} className="mr-1" />
              <span className="text-xs font-semibold">Cost of Delay</span>
            </div>
            <div className="text-xl font-bold text-red-900">${(debt.cost_of_delay / 1000).toFixed(1)}K</div>
          </div>

          <div className="bg-purple-50 rounded-lg p-3">
            <div className="flex items-center text-purple-600 mb-1">
              <TrendingUp size={16} className="mr-1" />
              <span className="text-xs font-semibold">ROI</span>
            </div>
            <div className="text-xl font-bold text-purple-900">
              {((debt.cost_of_delay / (debt.estimated_effort_hours * 100)) * 100).toFixed(0)}%
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center text-gray-600 mb-1">
              <AlertCircle size={16} className="mr-1" />
              <span className="text-xs font-semibold">Age</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{daysSinceCreated}d</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            {expanded ? '▼ Show Less' : '▶ Show Details'}
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            Start Working
          </button>
          <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
            Mark as Resolved
          </button>
        </div>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Impact Analysis</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Slows down feature development</li>
                  <li>• Increases maintenance burden</li>
                  <li>• Risk of introducing bugs</li>
                  <li>• Developer productivity impact</li>
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Recommended Approach</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Break into smaller tasks</li>
                  <li>• Allocate 20% of sprint capacity</li>
                  <li>• Pair programming recommended</li>
                  <li>• Add comprehensive tests</li>
                </ul>
              </div>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-yellow-900 mb-2">⚠️ Priority Justification</h4>
              <p className="text-sm text-yellow-800">
                This item has a priority score of {debt.priority_score.toFixed(1)} based on its cost of delay (${(debt.cost_of_delay / 1000).toFixed(1)}K) 
                and estimated effort ({debt.estimated_effort_hours}h). Addressing this will provide significant ROI and reduce technical risk.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TechnicalDebtTracker;
