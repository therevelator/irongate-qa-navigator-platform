import React, { useState } from 'react';
import { ArrowLeft, Code, Clock, GitPullRequest, Smile, Zap, Coffee, Calendar, TrendingUp, AlertCircle } from 'lucide-react';
import { generateDeveloperMetrics } from '../data/advancedFeatures';
import type { DeveloperMetric } from '../data/advancedFeatures';
import { BarChart, Bar, LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts';

interface DeveloperProductivityProps {
  onBack: () => void;
}

const DeveloperProductivity: React.FC<DeveloperProductivityProps> = ({ onBack }) => {
  const [selectedDeveloper, setSelectedDeveloper] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'happiness' | 'pr_time' | 'review_time'>('happiness');
  
  const developers = generateDeveloperMetrics();

  // Calculate team averages
  const avgReviewTime = (developers.reduce((acc, d) => acc + d.code_review_time_avg, 0) / developers.length).toFixed(1);
  const avgPRTime = (developers.reduce((acc, d) => acc + d.pr_merge_time_avg, 0) / developers.length).toFixed(1);
  const avgHappiness = (developers.reduce((acc, d) => acc + d.happiness_score, 0) / developers.length).toFixed(1);
  const avgFocusTime = (developers.reduce((acc, d) => acc + d.focus_time_hours, 0) / developers.length).toFixed(1);

  // Sort developers
  const sortedDevelopers = [...developers].sort((a, b) => {
    if (sortBy === 'happiness') return b.happiness_score - a.happiness_score;
    if (sortBy === 'pr_time') return a.pr_merge_time_avg - b.pr_merge_time_avg;
    return a.code_review_time_avg - b.code_review_time_avg;
  });

  // Prepare data for team overview chart
  const teamOverviewData = developers.map(d => ({
    name: d.name.split(' ')[0],
    happiness: d.happiness_score,
    focusTime: d.focus_time_hours,
    prTime: d.pr_merge_time_avg / 10, // Scale down for visibility
    reviewTime: d.code_review_time_avg / 10
  }));

  // Prepare radar chart data for team balance
  const teamBalanceData = [
    { metric: 'Happiness', value: parseFloat(avgHappiness) * 10, fullMark: 100 },
    { metric: 'Focus Time', value: parseFloat(avgFocusTime) * 10, fullMark: 100 },
    { metric: 'PR Speed', value: 100 - (parseFloat(avgPRTime) / 2), fullMark: 100 },
    { metric: 'Review Speed', value: 100 - (parseFloat(avgReviewTime) / 2), fullMark: 100 },
    { metric: 'Work-Life', value: (8 - developers[0].meeting_time_hours) * 12.5, fullMark: 100 }
  ];

  // Historical trend data (mock)
  const trendData = Array.from({ length: 12 }, (_, i) => ({
    month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
    happiness: 7 + Math.random() * 2,
    focusTime: 5 + Math.random() * 2,
    prTime: 20 + Math.random() * 10
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
                <Code className="mr-3 text-purple-500" size={32} />
                Developer Productivity Metrics
              </h1>
              <p className="text-gray-500 mt-1">Track team efficiency, happiness, and work-life balance</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg Happiness</p>
                <div className="text-3xl font-bold text-purple-600">{avgHappiness}/10</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg PR Time</p>
                <div className="text-3xl font-bold text-blue-600">{avgPRTime}h</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg Review</p>
                <div className="text-3xl font-bold text-green-600">{avgReviewTime}h</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Focus Time</p>
                <div className="text-3xl font-bold text-orange-600">{avgFocusTime}h/day</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="px-8 py-4 bg-white border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-semibold text-gray-700">Sort by:</span>
            <button
              onClick={() => setSortBy('happiness')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                sortBy === 'happiness'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              😊 Happiness Score
            </button>
            <button
              onClick={() => setSortBy('pr_time')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                sortBy === 'pr_time'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              ⚡ PR Merge Time
            </button>
            <button
              onClick={() => setSortBy('review_time')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                sortBy === 'review_time'
                  ? 'bg-green-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              👀 Review Time
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-4 py-2 bg-green-50 rounded-lg">
              <Smile className="text-green-500" size={20} />
              <span className="text-sm font-medium text-green-700">Team Health: Good</span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Insights */}
      <div className="px-8 py-6 bg-gradient-to-r from-purple-50 to-blue-50 border-b">
        <div className="grid grid-cols-3 gap-6">
          <InsightCard
            icon={<Smile className="text-purple-500" size={24} />}
            title="High Team Morale"
            description={`Average happiness score of ${avgHappiness}/10 indicates strong team satisfaction`}
            status="positive"
          />
          <InsightCard
            icon={<Zap className="text-blue-500" size={24} />}
            title="Efficient PR Process"
            description={`${avgPRTime}h average PR merge time is within industry best practices`}
            status="positive"
          />
          <InsightCard
            icon={<Coffee className="text-orange-500" size={24} />}
            title="Good Focus Time"
            description={`${avgFocusTime}h daily focus time allows for deep work and productivity`}
            status="positive"
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="px-8 py-8">
        {/* Team Balance Radar */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Team Balance Overview</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={teamBalanceData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} />
                  <Radar name="Team Score" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-gray-600 mt-4 text-center">
              Balanced teams perform better. All metrics should be above 70 for optimal productivity.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Team Comparison</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamOverviewData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '8px' }}
                  />
                  <Legend />
                  <Bar dataKey="happiness" fill="#8b5cf6" name="Happiness" />
                  <Bar dataKey="focusTime" fill="#3b82f6" name="Focus Time" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Historical Trends */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">12-Month Trends</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis yAxisId="left" label={{ value: 'Score / Hours', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" label={{ value: 'PR Time (hours)', angle: 90, position: 'insideRight' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '8px' }}
                />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="happiness" stroke="#8b5cf6" strokeWidth={3} name="Happiness Score" />
                <Line yAxisId="left" type="monotone" dataKey="focusTime" stroke="#10b981" strokeWidth={3} name="Focus Time (h)" />
                <Line yAxisId="right" type="monotone" dataKey="prTime" stroke="#3b82f6" strokeWidth={3} name="PR Merge Time (h)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Developer Cards */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Individual Developer Metrics</h2>
          {sortedDevelopers.map(dev => (
            <DeveloperCard 
              key={dev.developer_id}
              developer={dev}
              isSelected={selectedDeveloper === dev.developer_id}
              onSelect={() => setSelectedDeveloper(selectedDeveloper === dev.developer_id ? null : dev.developer_id)}
            />
          ))}
        </div>
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
    positive: 'bg-green-100 border-green-200',
    warning: 'bg-yellow-100 border-yellow-200',
    negative: 'bg-red-100 border-red-200'
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

interface DeveloperCardProps {
  developer: DeveloperMetric;
  isSelected: boolean;
  onSelect: () => void;
}

const DeveloperCard: React.FC<DeveloperCardProps> = ({ developer, isSelected, onSelect }) => {
  const getHappinessColor = (score: number) => {
    if (score >= 8) return 'text-green-600';
    if (score >= 6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getHappinessEmoji = (score: number) => {
    if (score >= 8) return '😊';
    if (score >= 6) return '😐';
    return '😟';
  };

  const workLifeBalance = ((developer.focus_time_hours / (developer.focus_time_hours + developer.meeting_time_hours)) * 100).toFixed(0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-2xl font-bold">
              {developer.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">{developer.name}</h3>
              <p className="text-sm text-gray-500">Developer ID: {developer.developer_id}</p>
            </div>
          </div>

          <div className="text-right">
            <div className={`text-4xl font-bold ${getHappinessColor(developer.happiness_score)}`}>
              {getHappinessEmoji(developer.happiness_score)} {developer.happiness_score.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500">Happiness Score</div>
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-5 gap-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <GitPullRequest size={14} className="mr-1" />
              <span className="text-xs font-semibold">PR Time</span>
            </div>
            <div className="text-lg font-bold text-blue-900">{developer.pr_merge_time_avg.toFixed(1)}h</div>
          </div>

          <div className="bg-green-50 rounded-lg p-3">
            <div className="flex items-center text-green-600 mb-1">
              <Code size={14} className="mr-1" />
              <span className="text-xs font-semibold">Review Time</span>
            </div>
            <div className="text-lg font-bold text-green-900">{developer.code_review_time_avg.toFixed(1)}h</div>
          </div>

          <div className="bg-orange-50 rounded-lg p-3">
            <div className="flex items-center text-orange-600 mb-1">
              <Coffee size={14} className="mr-1" />
              <span className="text-xs font-semibold">Focus Time</span>
            </div>
            <div className="text-lg font-bold text-orange-900">{developer.focus_time_hours.toFixed(1)}h</div>
          </div>

          <div className="bg-purple-50 rounded-lg p-3">
            <div className="flex items-center text-purple-600 mb-1">
              <Calendar size={14} className="mr-1" />
              <span className="text-xs font-semibold">Meetings</span>
            </div>
            <div className="text-lg font-bold text-purple-900">{developer.meeting_time_hours.toFixed(1)}h</div>
          </div>

          <div className="bg-red-50 rounded-lg p-3">
            <div className="flex items-center text-red-600 mb-1">
              <Zap size={14} className="mr-1" />
              <span className="text-xs font-semibold">Context Sw.</span>
            </div>
            <div className="text-lg font-bold text-red-900">{developer.context_switches_per_day}</div>
          </div>
        </div>

        {/* Work-Life Balance Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">Work-Life Balance</span>
            <span className="text-sm font-bold text-gray-900">{workLifeBalance}% Focus Time</span>
          </div>
          <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-blue-500"
              style={{ width: `${workLifeBalance}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Focus: {developer.focus_time_hours}h</span>
            <span>Meetings: {developer.meeting_time_hours}h</span>
          </div>
        </div>

        <button
          onClick={onSelect}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {isSelected ? '▼ Hide Insights' : '▶ Show Detailed Insights'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
            {/* Productivity Analysis */}
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center">
                <TrendingUp size={16} className="mr-2" />
                Productivity Analysis
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm text-blue-800">
                <div>
                  <p className="font-medium mb-1">PR Efficiency:</p>
                  <p>
                    {developer.pr_merge_time_avg < 24 ? '✅ Excellent - Fast turnaround' :
                     developer.pr_merge_time_avg < 48 ? '⚠️ Good - Room for improvement' :
                     '❌ Slow - Review process bottleneck'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Review Speed:</p>
                  <p>
                    {developer.code_review_time_avg < 4 ? '✅ Fast - Responsive reviewer' :
                     developer.code_review_time_avg < 8 ? '⚠️ Moderate - Acceptable pace' :
                     '❌ Slow - May block team progress'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Focus Quality:</p>
                  <p>
                    {developer.focus_time_hours > 5 ? '✅ High - Deep work enabled' :
                     developer.focus_time_hours > 3 ? '⚠️ Moderate - Could improve' :
                     '❌ Low - Too many interruptions'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Context Switching:</p>
                  <p>
                    {developer.context_switches_per_day < 5 ? '✅ Low - Good focus' :
                     developer.context_switches_per_day < 10 ? '⚠️ Moderate - Manageable' :
                     '❌ High - Productivity impact'}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-green-900 mb-3">💡 Personalized Recommendations</h4>
              <ul className="text-sm text-green-800 space-y-2">
                {developer.happiness_score < 7 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Schedule 1-on-1 to discuss concerns and improve satisfaction</span>
                  </li>
                )}
                {developer.pr_merge_time_avg > 36 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Streamline PR review process - consider smaller, more frequent PRs</span>
                  </li>
                )}
                {developer.focus_time_hours < 4 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Block calendar for focus time - aim for 4+ hours of uninterrupted work</span>
                  </li>
                )}
                {developer.context_switches_per_day > 8 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Reduce context switching - batch similar tasks and limit interruptions</span>
                  </li>
                )}
                {developer.meeting_time_hours > 4 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Optimize meeting schedule - decline non-essential meetings</span>
                  </li>
                )}
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Maintain current happiness score through regular feedback and recognition</span>
                </li>
              </ul>
            </div>

            {/* Wellness Check */}
            <div className="bg-purple-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-purple-900 mb-3 flex items-center">
                <AlertCircle size={16} className="mr-2" />
                Wellness & Balance Check
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-purple-700 mb-1">Work-Life Balance:</p>
                  <p className="text-lg font-bold text-purple-900">
                    {parseInt(workLifeBalance) > 70 ? '✅ Healthy' : parseInt(workLifeBalance) > 50 ? '⚠️ Fair' : '❌ Concerning'}
                  </p>
                  <p className="text-xs text-purple-600">{workLifeBalance}% productive time</p>
                </div>
                <div>
                  <p className="text-xs text-purple-700 mb-1">Burnout Risk:</p>
                  <p className="text-lg font-bold text-purple-900">
                    {developer.happiness_score > 7 && developer.focus_time_hours > 4 ? '✅ Low' :
                     developer.happiness_score > 5 ? '⚠️ Moderate' : '❌ High'}
                  </p>
                  <p className="text-xs text-purple-600">Based on happiness & workload</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeveloperProductivity;
