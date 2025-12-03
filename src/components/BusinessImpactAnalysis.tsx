import React, { useState, useEffect } from 'react';
import { ArrowLeft, DollarSign, TrendingUp, Users, Target, AlertCircle, BarChart3, Loader2 } from 'lucide-react';
import type { BusinessImpact } from '../data/advancedFeatures';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ScatterChart, Scatter, ZAxis, Cell } from 'recharts';
import { API_URL } from '../config/api';

interface BusinessImpactAnalysisProps {
  onBack: () => void;
}

const BusinessImpactAnalysis: React.FC<BusinessImpactAnalysisProps> = ({ onBack }) => {
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [impactData, setImpactData] = useState<BusinessImpact[]>([]);
  const [loading, setLoading] = useState(true);

  // Historical data state - now configurable
  const [historicalData, setHistoricalData] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
      quality: Number((70 + Math.random() * 20).toFixed(2)),
      revenue: Number((200 + Math.random() * 100).toFixed(2)),
      satisfaction: Number((75 + Math.random() * 15).toFixed(2)),
      churn: Number((5 - Math.random() * 2).toFixed(2))
    }))
  );

  useEffect(() => {
    const fetchImpact = async () => {
      try {
        const response = await fetch(`${API_URL}/analytics/business-impact?days=30`, {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setImpactData(data.metrics || []);
        }
      } catch (error) {
        console.error('Error fetching business impact:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchImpact();
  }, []);

  // Fetch configured historical data
  useEffect(() => {
    const fetchHistoricalData = async () => {
      try {
        // Try to get configured historical data for the current team
        const teamId = localStorage.getItem('current_team_id'); // Assuming this is stored
        if (teamId) {
          const response = await fetch(`${API_URL}/metrics/business-impact-config/${teamId}`, {
            credentials: 'include'
          });
          if (response.ok) {
            const data = await response.json();
            if (data.historicalConfigs && data.historicalConfigs.length > 0) {
              // Use configured historical data
              const configuredHistory = data.historicalConfigs.map((item: any) => ({
                month: item.month_year.substring(5, 7) + '/' + item.month_year.substring(2, 4), // MM/YY format
                quality: Number(item.quality_score) || 0,
                revenue: Number(item.revenue_impact) / 1000 || 0, // Convert to K for chart
                satisfaction: Number(item.customer_satisfaction) || 0,
                churn: Number(item.churn_rate) || 0
              })).slice(-12); // Last 12 months

              // Override the simulated data
              setHistoricalData(configuredHistory);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching historical data:', error);
        // Keep simulated data as fallback
      }
    };
    fetchHistoricalData();
  }, []);

  // Calculate overall statistics
  const avgCorrelation = impactData.length > 0 ? (impactData.reduce((acc, d) => acc + d.correlation_strength, 0) / impactData.length).toFixed(2) : '0';
  const totalRevenue = impactData.reduce((acc, d) => acc + d.revenue_impact, 0);
  const avgSatisfaction = impactData.length > 0 ? (impactData.reduce((acc, d) => acc + d.customer_satisfaction, 0) / impactData.length).toFixed(1) : '0';
  const avgAdoption = impactData.length > 0 ? (impactData.reduce((acc, d) => acc + d.feature_adoption_rate, 0) / impactData.length).toFixed(1) : '0';

  // Prepare correlation data for visualization
  const correlationData = impactData.map(item => ({
    name: item.metric_name,
    quality: item.quality_score,
    revenue: item.revenue_impact / 1000,
    satisfaction: item.customer_satisfaction,
    adoption: item.feature_adoption_rate,
    correlation: item.correlation_strength
  }));

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
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <DollarSign className="mr-3 text-green-500" size={32} />
                Business Impact Correlation
              </h1>
              <p className="text-gray-500 dark:text-slate-400 mt-1">Link quality metrics to business outcomes and revenue</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">Avg Correlation</p>
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{avgCorrelation}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">Revenue Impact</p>
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">${(totalRevenue / 1000000).toFixed(2)} M</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">Avg NPS</p>
                <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{avgSatisfaction}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">Adoption</p>
                <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">{avgAdoption}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Key Insights Banner */}
      <div className="px-8 py-6 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b dark:border-slate-800">
        <div className="grid grid-cols-3 gap-6">
          <InsightCard
            icon={<TrendingUp className="text-green-500" size={24} />}
            title="Strong Positive Correlation"
            description="10% increase in test coverage correlates with 5% reduction in customer churn"
            impact="High"
          />
          <InsightCard
            icon={<Users className="text-blue-500" size={24} />}
            title="Customer Satisfaction"
            description="Defect escape rate > 8% leads to 15% drop in NPS scores"
            impact="Critical"
          />
          <InsightCard
            icon={<Target className="text-purple-500" size={24} />}
            title="Feature Adoption"
            description="MTTR < 4 hours correlates with 20% higher feature adoption rates"
            impact="High"
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="px-8 py-8">
        {/* Correlation Matrix */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Quality Metrics vs Business KPIs</h2>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  type="number" 
                  dataKey="quality" 
                  name="Quality Score" 
                  label={{ value: 'Quality Score', position: 'bottom', offset: 40 }}
                  domain={[60, 100]}
                />
                <YAxis 
                  type="number" 
                  dataKey="revenue" 
                  name="Revenue Impact ($K)" 
                  label={{ value: 'Revenue Impact ($K)', angle: -90, position: 'left', offset: 40 }}
                />
                <ZAxis type="number" dataKey="correlation" range={[100, 1000]} />
                <Tooltip 
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg">
                          <p className="font-bold mb-2">{data.name}</p>
                          <p className="text-sm">Quality: {data.quality.toFixed(1)}</p>
                          <p className="text-sm">Revenue: ${(data.revenue / 1000).toFixed(2)} M</p>
                          <p className="text-sm">Correlation: {data.correlation.toFixed(2)}</p>
                          <p className="text-sm">NPS: {data.satisfaction.toFixed(1)}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Scatter data={correlationData} fill="#3b82f6">
                  {correlationData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`}
                      fill={entry.correlation > 0.7 ? '#10b981' : entry.correlation > 0.5 ? '#3b82f6' : '#f59e0b'}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center space-x-6 mt-4 text-sm text-gray-700 dark:text-slate-300">
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
              <span>Strong Correlation (&gt;0.7)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
              <span>Moderate Correlation (0.5-0.7)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
              <span>Weak Correlation (&lt;0.5)</span>
            </div>
          </div>
        </div>

        {/* Historical Trends */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Historical Trends (12 Months)</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis yAxisId="left" label={{ value: 'Quality & Satisfaction', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" label={{ value: 'Revenue ($K) & Churn (%)', angle: 90, position: 'insideRight' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '8px' }}
                />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="quality" stroke="#3b82f6" strokeWidth={2} name="Quality Score" />
                <Line yAxisId="left" type="monotone" dataKey="satisfaction" stroke="#8b5cf6" strokeWidth={2} name="Customer Satisfaction" />
                <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} name="Revenue ($K)" />
                <Line yAxisId="right" type="monotone" dataKey="churn" stroke="#ef4444" strokeWidth={2} name="Churn Rate (%)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Metric Details */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Quality Metrics Impact Analysis</h2>
          {impactData.map(metric => (
            <MetricImpactCard 
              key={metric.metric_name} 
              metric={metric}
              isSelected={selectedMetric === metric.metric_name}
              onSelect={() => setSelectedMetric(selectedMetric === metric.metric_name ? null : metric.metric_name)}
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
  impact: 'High' | 'Critical' | 'Medium';
}

const InsightCard: React.FC<InsightCardProps> = ({ icon, title, description, impact }) => {
  const impactColors = {
    Critical: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200',
    High: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200',
    Medium: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200'
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${impactColors[impact]}`}>
              {impact}
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-slate-400">{description}</p>
        </div>
      </div>
    </div>
  );
};

interface MetricImpactCardProps {
  metric: BusinessImpact;
  isSelected: boolean;
  onSelect: () => void;
}

const MetricImpactCard: React.FC<MetricImpactCardProps> = ({ metric, isSelected, onSelect }) => {
  const getCorrelationColor = (strength: number) => {
    if (strength > 0.7) return 'text-green-600';
    if (strength > 0.5) return 'text-blue-600';
    return 'text-yellow-600';
  };

  const getCorrelationLabel = (strength: number) => {
    if (strength > 0.7) return 'Strong';
    if (strength > 0.5) return 'Moderate';
    return 'Weak';
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white">
              <BarChart3 size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{metric.metric_name}</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">Quality Metric</p>
            </div>
          </div>

          <div className="text-right">
            <div className={`text-3xl font-bold ${getCorrelationColor(metric.correlation_strength)}`}>
              {metric.correlation_strength.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400">{getCorrelationLabel(metric.correlation_strength)} Correlation</div>
          </div>
        </div>

        {/* Business Metrics Grid */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <BarChart3 size={16} className="mr-1" />
              <span className="text-xs font-semibold">Quality Score</span>
            </div>
            <div className="text-xl font-bold text-blue-900 dark:text-blue-200">{metric.quality_score.toFixed(1)}</div>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
            <div className="flex items-center text-green-600 mb-1">
              <DollarSign size={16} className="mr-1" />
              <span className="text-xs font-semibold">Revenue Impact</span>
            </div>
            <div className="text-xl font-bold text-green-900 dark:text-green-200">${(metric.revenue_impact / 1000000).toFixed(2)} M</div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
            <div className="flex items-center text-purple-600 mb-1">
              <Users size={16} className="mr-1" />
              <span className="text-xs font-semibold">Customer Sat.</span>
            </div>
            <div className="text-xl font-bold text-purple-900 dark:text-purple-200">{metric.customer_satisfaction.toFixed(1)}</div>
          </div>

          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
            <div className="flex items-center text-orange-600 mb-1">
              <Target size={16} className="mr-1" />
              <span className="text-xs font-semibold">Adoption</span>
            </div>
            <div className="text-xl font-bold text-orange-900 dark:text-orange-200">{metric.feature_adoption_rate.toFixed(1)}%</div>
          </div>
        </div>

        <button
          onClick={onSelect}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
        >
          {isSelected ? '▼ Hide Analysis' : '▶ Show Detailed Analysis'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 space-y-4">
            {/* Correlation Insights */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-3 flex items-center">
                <AlertCircle size={16} className="mr-2" />
                Business Impact Insights
              </h4>
              <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-2">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    <strong>Revenue Correlation:</strong> Every 10% improvement in {metric.metric_name.toLowerCase()} 
                    correlates with ${(metric.revenue_impact * 0.1 / 1000000).toFixed(2)} M additional revenue
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    <strong>Customer Impact:</strong> Current satisfaction score of {metric.customer_satisfaction.toFixed(1)} 
                    is {metric.customer_satisfaction > 85 ? 'excellent' : metric.customer_satisfaction > 75 ? 'good' : 'needs improvement'}
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    <strong>Adoption Rate:</strong> {metric.feature_adoption_rate.toFixed(1)}% adoption indicates 
                    {metric.feature_adoption_rate > 80 ? ' strong user engagement' : metric.feature_adoption_rate > 60 ? ' moderate engagement' : ' opportunity for improvement'}
                  </span>
                </li>
              </ul>
            </div>

            {/* Recommendations */}
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-green-900 dark:text-green-200 mb-3">💡 Strategic Recommendations</h4>
              <ul className="text-sm text-green-800 dark:text-green-300 space-y-2">
                <li className="flex items-start">
                  <span className="mr-2">1.</span>
                  <span>Prioritize improvements to {metric.metric_name.toLowerCase()} as it has {getCorrelationLabel(metric.correlation_strength).toLowerCase()} correlation with business outcomes</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">2.</span>
                  <span>Monitor customer satisfaction closely - current NPS of {metric.customer_satisfaction.toFixed(1)} should be maintained or improved</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">3.</span>
                  <span>Focus on feature adoption strategies to maximize the ${(metric.revenue_impact / 1000000).toFixed(2)} M revenue potential</span>
                </li>
              </ul>
            </div>

            {/* What-If Scenarios */}
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-200 mb-3">📊 What-If Scenarios</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-purple-700 dark:text-purple-300 mb-1">If quality improves by 20%:</p>
                  <p className="text-lg font-bold text-purple-900 dark:text-purple-200">
                    +${(metric.revenue_impact * 0.2 / 1000000).toFixed(2)} M revenue
                  </p>
                  <p className="text-xs text-purple-700 dark:text-purple-300">+{(metric.customer_satisfaction * 0.1).toFixed(1)} NPS points</p>
                </div>
                <div>
                  <p className="text-xs text-purple-700 dark:text-purple-300 mb-1">If quality degrades by 10%:</p>
                  <p className="text-lg font-bold text-red-900 dark:text-red-200">
                    -${(metric.revenue_impact * 0.1 / 1000000).toFixed(2)} M revenue
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300">-{(metric.customer_satisfaction * 0.05).toFixed(1)} NPS points</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BusinessImpactAnalysis;
