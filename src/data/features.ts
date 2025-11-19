export interface FeatureModule {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  route: string;
  category: 'testing' | 'performance' | 'productivity' | 'business';
}

export const advancedFeatures: FeatureModule[] = [
  {
    id: 'test-execution-timeline',
    name: 'Test Execution Timeline',
    description: 'Gantt chart view of test execution with bottleneck identification',
    icon: 'BarChart3',
    enabled: true,
    route: '/test-execution-timeline',
    category: 'testing'
  },
  {
    id: 'test-case-management',
    name: 'Test Case Management',
    description: 'Link test cases to requirements and track effectiveness',
    icon: 'TestTube',
    enabled: true,
    route: '/test-cases',
    category: 'testing'
  },
  {
    id: 'flaky-test-intelligence',
    name: 'Flaky Test Intelligence',
    description: 'Dedicated tracker with pattern analysis and suggested fixes',
    icon: 'Zap',
    enabled: true,
    route: '/flaky-tests',
    category: 'testing'
  },
  {
    id: 'performance-metrics',
    name: 'Performance Testing',
    description: 'Response times, load test results, and capacity planning',
    icon: 'TrendingUp',
    enabled: true,
    route: '/performance',
    category: 'performance'
  },
  {
    id: 'developer-productivity',
    name: 'Developer Productivity',
    description: 'Code review time, PR metrics, and happiness scores',
    icon: 'Code',
    enabled: true,
    route: '/developer-metrics',
    category: 'productivity'
  },
  {
    id: 'technical-debt',
    name: 'Technical Debt Tracker',
    description: 'Debt inventory with prioritization and paydown velocity',
    icon: 'Wrench',
    enabled: true,
    route: '/technical-debt',
    category: 'productivity'
  },
  {
    id: 'pipeline-visualization',
    name: 'CI/CD Pipeline Insights',
    description: 'Interactive pipeline flow with optimization suggestions',
    icon: 'GitBranch',
    enabled: true,
    route: '/pipeline',
    category: 'performance'
  },
  {
    id: 'business-impact',
    name: 'Business Impact Analysis',
    description: 'Correlate quality metrics with business KPIs and revenue',
    icon: 'DollarSign',
    enabled: true,
    route: '/business-impact',
    category: 'business'
  },
  {
    id: 'team-gamification',
    name: 'Team Gamification',
    description: 'Leaderboards, badges, and achievements to motivate teams',
    icon: 'Trophy',
    enabled: true,
    route: '/team-gamification',
    category: 'business'
  }
];

export const getFeaturesByCategory = (category: string) => {
  return advancedFeatures.filter(f => f.category === category && f.enabled);
};

export const getEnabledFeatures = () => {
  return advancedFeatures.filter(f => f.enabled);
};
