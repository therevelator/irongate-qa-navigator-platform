import React, { useState } from 'react';
import { ArrowLeft, DollarSign, TrendingUp, Users, Target, AlertCircle, BarChart3 } from 'lucide-react';
import { generateBusinessImpact } from '../data/advancedFeatures';
import type { BusinessImpact } from '../data/advancedFeatures';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ScatterChart, Scatter, ZAxis, Cell } from 'recharts';

interface BusinessImpactAnalysisProps {
  onBack: () => void;
}

const BusinessImpactAnalysis: React.FC<BusinessImpactAnalysisProps> = ({ onBack }) => {
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const impactData = generateBusinessImpact();

  // Calculate overall statistics
  const avgCorrelation = (impactData.reduce((acc, d) => acc + d.correlation_strength, 0) / impactData.length).toFixed(2);
  const totalRevenue = impactData.reduce((acc, d) => acc + d.revenue_impact, 0);
  const avgSatisfaction = (impactData.reduce((acc, d) => acc + d.customer_satisfaction, 0) / impactData.length).toFixed(1);
  const avgAdoption = (impactData.reduce((acc, d) => acc + d.feature_adoption_rate, 0) / impactData.length).toFixed(1);

  // Prepare correlation data for visualization
  const correlationData = impactData.map(item => ({
    name: item.metric_name,
    quality: item.quality_score,
    revenue: item.revenue_impact / 1000,
    satisfaction: item.customer_satisfaction,
    adoption: item.feature_adoption_rate,
    correlation: item.correlation_strength
  }));

  // Historical trend simulation (mock data)
  const historicalData = Array.from({ length: 12 }, (_, i) => ({
    month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
    quality: 70 + Math.random() * 20,
    revenue: 200 + Math.random() * 100,
    satisfaction: 75 + Math.random() * 15,
    churn: 5 - Math.random() * 2
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
                <DollarSign className="mr-3 text-green-500" size={32} />
                Business Impact Correlation
              </h1>
              <p className="text-gray-500 mt-1">Link quality metrics to business outcomes and revenue</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg Correlation</p>
                <div className="text-3xl font-bold text-blue-600">{avgCorrelation}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Revenue Impact</p>
                <div className="text-3xl font-bold text-green-600">${(totalRevenue / 1000).toFixed(0)}K</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Avg NPS</p>
                <div className="text-3xl font-bold text-purple-600">{avgSatisfaction}</div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500">Adoption</p>
                <div className="text-3xl font-bold text-orange-600">{avgAdoption}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Key Insights Banner */}
      <div className="px-8 py-6 bg-gradient-to-r from-blue-50 to-purple-50 border-b">
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Quality Metrics vs Business KPIs</h2>
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
                          <p className="text-sm">Revenue: ${data.revenue.toFixed(0)}K</p>
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
          <div className="flex items-center justify-center space-x-6 mt-4 text-sm">
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Historical Trends (12 Months)</h2>
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
          <h2 className="text-xl font-bold text-gray-900">Quality Metrics Impact Analysis</h2>
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
    Critical: 'bg-red-100 text-red-700',
    High: 'bg-orange-100 text-orange-700',
    Medium: 'bg-yellow-100 text-yellow-700'
  };

  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${impactColors[impact]}`}>
              {impact}
            </span>
          </div>
          <p className="text-sm text-gray-600">{description}</p>
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white">
              <BarChart3 size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">{metric.metric_name}</h3>
              <p className="text-sm text-gray-500">Quality Metric</p>
            </div>
          </div>

          <div className="text-right">
            <div className={`text-3xl font-bold ${getCorrelationColor(metric.correlation_strength)}`}>
              {metric.correlation_strength.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">{getCorrelationLabel(metric.correlation_strength)} Correlation</div>
          </div>
        </div>

        {/* Business Metrics Grid */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <BarChart3 size={16} className="mr-1" />
              <span className="text-xs font-semibold">Quality Score</span>
            </div>
            <div className="text-xl font-bold text-blue-900">{metric.quality_score.toFixed(1)}</div>
          </div>

          <div className="bg-green-50 rounded-lg p-3">
            <div className="flex items-center text-green-600 mb-1">
              <DollarSign size={16} className="mr-1" />
              <span className="text-xs font-semibold">Revenue Impact</span>
            </div>
            <div className="text-xl font-bold text-green-900">${(metric.revenue_impact / 1000).toFixed(0)}K</div>
          </div>

          <div className="bg-purple-50 rounded-lg p-3">
            <div className="flex items-center text-purple-600 mb-1">
              <Users size={16} className="mr-1" />
              <span className="text-xs font-semibold">Customer Sat.</span>
            </div>
            <div className="text-xl font-bold text-purple-900">{metric.customer_satisfaction.toFixed(1)}</div>
          </div>

          <div className="bg-orange-50 rounded-lg p-3">
            <div className="flex items-center text-orange-600 mb-1">
              <Target size={16} className="mr-1" />
              <span className="text-xs font-semibold">Adoption</span>
            </div>
            <div className="text-xl font-bold text-orange-900">{metric.feature_adoption_rate.toFixed(1)}%</div>
          </div>
        </div>

        <button
          onClick={onSelect}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {isSelected ? '▼ Hide Analysis' : '▶ Show Detailed Analysis'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
            {/* Correlation Insights */}
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center">
                <AlertCircle size={16} className="mr-2" />
                Business Impact Insights
              </h4>
              <ul className="text-sm text-blue-800 space-y-2">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    <strong>Revenue Correlation:</strong> Every 10% improvement in {metric.metric_name.toLowerCase()} 
                    correlates with ${(metric.revenue_impact * 0.1 / 1000).toFixed(1)}K additional revenue
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
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-green-900 mb-3">💡 Strategic Recommendations</h4>
              <ul className="text-sm text-green-800 space-y-2">
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
                  <span>Focus on feature adoption strategies to maximize the ${(metric.revenue_impact / 1000).toFixed(0)}K revenue potential</span>
                </li>
              </ul>
            </div>

            {/* What-If Scenarios */}
            <div className="bg-purple-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-purple-900 mb-3">📊 What-If Scenarios</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-purple-700 mb-1">If quality improves by 20%:</p>
                  <p className="text-lg font-bold text-purple-900">
                    +${(metric.revenue_impact * 0.2 / 1000).toFixed(1)}K revenue
                  </p>
                  <p className="text-xs text-purple-700">+{(metric.customer_satisfaction * 0.1).toFixed(1)} NPS points</p>
                </div>
                <div>
                  <p className="text-xs text-purple-700 mb-1">If quality degrades by 10%:</p>
                  <p className="text-lg font-bold text-red-900">
                    -${(metric.revenue_impact * 0.1 / 1000).toFixed(1)}K revenue
                  </p>
                  <p className="text-xs text-red-700">-{(metric.customer_satisfaction * 0.05).toFixed(1)} NPS points</p>
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
