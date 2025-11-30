// Extended data models for advanced features

export interface TestCase {
  id: string;
  name: string;
  requirement_id: string;
  status: 'active' | 'obsolete' | 'redundant';
  last_executed: string;
  pass_rate: number;
  execution_count: number;
  avg_duration: number;
  effectiveness_score: number;
  tags: string[];
}

export interface FlakyTest {
  id: string;
  test_name: string;
  flakiness_score: number;
  failure_pattern: 'timing' | 'environment' | 'data' | 'network' | 'unknown';
  occurrences: number;
  first_detected: string;
  last_occurrence: string;
  suggested_fix: string;
  root_cause: string;
  history: { date: string; passed: boolean }[];
}

export interface PipelineStage {
  id: string;
  name: string;
  duration: number;
  success_rate: number;
  resource_usage: {
    cpu: number;
    memory: number;
    cost: number;
  };
  bottleneck_score: number;
}

export interface PerformanceMetric {
  id: string;
  endpoint: string;
  response_time_p50: number;
  response_time_p95: number;
  response_time_p99: number;
  throughput: number;
  error_rate: number;
  timestamp: string;
}

export interface DeveloperMetric {
  developer_id: string;
  name: string;
  code_review_time_avg: number;
  pr_merge_time_avg: number;
  happiness_score: number;
  context_switches_per_day: number;
  focus_time_hours: number;
  meeting_time_hours: number;
}

export interface TechnicalDebt {
  id: string;
  title: string;
  description: string;
  category: 'code_quality' | 'architecture' | 'testing' | 'documentation' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimated_effort_hours: number;
  cost_of_delay: number;
  priority_score: number;
  created_date: string;
  status: 'open' | 'in_progress' | 'resolved';
}

export interface BusinessImpact {
  metric_name: string;
  quality_score: number;
  revenue_impact: number;
  customer_satisfaction: number;
  feature_adoption_rate: number;
  correlation_strength: number;
}

export interface GamificationData {
  enabled: boolean;
  leaderboard: {
    team_id: string;
    team_name: string;
    points: number;
    badges: string[];
    rank: number;
    achievements: Achievement[];
  }[];
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned_date: string;
  category: 'quality' | 'speed' | 'collaboration' | 'innovation';
}

export interface TestExecution {
  id: string;
  test_suite: string;
  start_time: string;
  end_time: string;
  duration: number;
  status: 'running' | 'passed' | 'failed' | 'blocked';
  assigned_to: string;
  dependencies: string[];
}

// Mock data generators for new features

export const generateFlakyTests = (): FlakyTest[] => {
  const patterns = ['timing', 'environment', 'data', 'network', 'unknown'] as const;
  const testNames = [
    'LoginFlowTest',
    'CheckoutProcessTest',
    'PaymentGatewayTest',
    'SearchFunctionalityTest',
    'UserRegistrationTest'
  ];

  return testNames.map((name, index) => {
    const pattern = patterns[index % patterns.length];
    return {
      id: `flaky-${index}`,
      test_name: name,
      flakiness_score: Number((Math.random() * 100).toFixed(1)),
      failure_pattern: pattern,
      occurrences: Math.floor(Math.random() * 50) + 5,
      first_detected: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      last_occurrence: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      suggested_fix: getSuggestedFix(pattern),
      root_cause: getRootCause(pattern),
      history: Array.from({ length: 20 }, (_, i) => ({
        date: new Date(Date.now() - (19 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        passed: Math.random() > 0.3
      }))
    };
  });
};

const getSuggestedFix = (pattern: string): string => {
  const fixes: Record<string, string> = {
    timing: 'Add explicit waits or increase timeout values',
    environment: 'Ensure consistent test environment setup',
    data: 'Use data factories or fixtures for consistent test data',
    network: 'Mock external APIs or add retry logic',
    unknown: 'Add detailed logging to identify root cause'
  };
  return fixes[pattern] || 'Investigate test implementation';
};

const getRootCause = (pattern: string): string => {
  const causes: Record<string, string> = {
    timing: 'timeout keyword detected in error logs',
    environment: 'environment keyword detected in error logs',
    data: 'assertion failed keyword detected in error logs',
    network: 'ECONNREFUSED keyword detected in error logs',
    unknown: 'No matching pattern found'
  };
  return causes[pattern] || 'Pattern analysis pending';
};

export const generatePipelineStages = (): PipelineStage[] => {
  const stages = ['Build', 'Unit Tests', 'Integration Tests', 'Security Scan', 'Deploy to Staging', 'E2E Tests', 'Deploy to Prod'];
  
  return stages.map((name, index) => ({
    id: `stage-${index}`,
    name,
    duration: Math.floor(Math.random() * 300) + 60,
    success_rate: Number((85 + Math.random() * 15).toFixed(1)),
    resource_usage: {
      cpu: Number((Math.random() * 80 + 20).toFixed(1)),
      memory: Number((Math.random() * 70 + 30).toFixed(1)),
      cost: Number((Math.random() * 5 + 0.5).toFixed(2))
    },
    bottleneck_score: Number((Math.random() * 100).toFixed(1))
  }));
};

export const generatePerformanceMetrics = (): PerformanceMetric[] => {
  const endpoints = ['/api/users', '/api/products', '/api/checkout', '/api/search', '/api/orders'];
  
  return endpoints.map((endpoint, index) => ({
    id: `perf-${index}`,
    endpoint,
    response_time_p50: Math.floor(Math.random() * 200) + 50,
    response_time_p95: Math.floor(Math.random() * 500) + 200,
    response_time_p99: Math.floor(Math.random() * 1000) + 500,
    throughput: Math.floor(Math.random() * 1000) + 100,
    error_rate: Number((Math.random() * 2).toFixed(2)),
    timestamp: new Date().toISOString()
  }));
};

export const generateDeveloperMetrics = (): DeveloperMetric[] => {
  const names = ['Alice Johnson', 'Bob Smith', 'Carol Davis', 'David Lee', 'Emma Wilson'];
  
  return names.map((name, index) => ({
    developer_id: `dev-${index}`,
    name,
    code_review_time_avg: Number((Math.random() * 4 + 1).toFixed(1)),
    pr_merge_time_avg: Number((Math.random() * 24 + 2).toFixed(1)),
    happiness_score: Math.floor(Math.random() * 30) + 70,
    context_switches_per_day: Math.floor(Math.random() * 10) + 3,
    focus_time_hours: Number((Math.random() * 4 + 2).toFixed(1)),
    meeting_time_hours: Number((Math.random() * 3 + 1).toFixed(1))
  }));
};

export const generateTechnicalDebt = (): TechnicalDebt[] => {
  const categories = ['code_quality', 'architecture', 'testing', 'documentation', 'security'] as const;
  const severities = ['low', 'medium', 'high', 'critical'] as const;
  
  return Array.from({ length: 10 }, (_, index) => ({
    id: `debt-${index}`,
    title: `Technical Debt Item ${index + 1}`,
    description: 'Legacy code needs refactoring to improve maintainability',
    category: categories[Math.floor(Math.random() * categories.length)],
    severity: severities[Math.floor(Math.random() * severities.length)],
    estimated_effort_hours: Math.floor(Math.random() * 40) + 8,
    cost_of_delay: Math.floor(Math.random() * 10000) + 1000,
    priority_score: Number((Math.random() * 100).toFixed(1)),
    created_date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: ['open', 'in_progress', 'resolved'][Math.floor(Math.random() * 3)] as any
  }));
};

export const generateBusinessImpact = (): BusinessImpact[] => {
  const metrics = ['Test Coverage', 'Defect Density', 'MTTR', 'Deployment Frequency', 'Change Failure Rate'];
  
  return metrics.map(metric => ({
    metric_name: metric,
    quality_score: Number((Math.random() * 40 + 60).toFixed(1)),
    revenue_impact: Math.floor(Math.random() * 500000) + 100000,
    customer_satisfaction: Number((Math.random() * 20 + 75).toFixed(1)),
    feature_adoption_rate: Number((Math.random() * 30 + 60).toFixed(1)),
    correlation_strength: Number((Math.random() * 0.5 + 0.5).toFixed(2))
  }));
};

export const generateTestExecutions = (): TestExecution[] => {
  const suites = ['Smoke Tests', 'Regression Suite', 'API Tests', 'UI Tests', 'Performance Tests'];
  const statuses = ['running', 'passed', 'failed', 'blocked'] as const;
  
  return Array.from({ length: 15 }, (_, index) => {
    const start = new Date(Date.now() - Math.random() * 2 * 60 * 60 * 1000);
    const duration = Math.floor(Math.random() * 3600) + 300;
    
    return {
      id: `exec-${index}`,
      test_suite: suites[Math.floor(Math.random() * suites.length)],
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + duration * 1000).toISOString(),
      duration,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      assigned_to: `Tester ${Math.floor(Math.random() * 5) + 1}`,
      dependencies: []
    };
  });
};

export const generateGamificationData = (): GamificationData => {
  const teams = ['Checkout Service', 'User Auth', 'Inventory Core', 'Payment Gateway', 'Mobile App'];
  
  return {
    enabled: true,
    leaderboard: teams.map((name, index) => ({
      team_id: `team-${index}`,
      team_name: name,
      points: Math.floor(Math.random() * 5000) + 1000,
      badges: ['🏆', '⭐', '🎯'].slice(0, Math.floor(Math.random() * 3) + 1),
      rank: index + 1,
      achievements: [
        {
          id: `ach-${index}-1`,
          name: 'Quality Champion',
          description: 'Maintained 95%+ test coverage for 3 sprints',
          icon: '🏆',
          earned_date: new Date().toISOString(),
          category: 'quality'
        }
      ]
    }))
  };
};

export const generateTestCases = (): TestCase[] => {
  const testNames = [
    'User Login Flow',
    'Product Search Functionality',
    'Checkout Process',
    'Payment Gateway Integration',
    'User Registration',
    'Password Reset',
    'Shopping Cart Operations',
    'Order History Display',
    'Product Filtering',
    'User Profile Update',
    'Email Notifications',
    'API Authentication',
    'Database Connection',
    'File Upload',
    'Data Validation'
  ];
  
  const statuses = ['active', 'obsolete', 'redundant'] as const;
  const tags = [['smoke', 'critical'], ['regression', 'api'], ['ui', 'e2e'], ['integration'], ['performance']];
  
  return testNames.map((name, index) => ({
    id: `test-${index}`,
    name,
    requirement_id: `REQ-${1000 + index}`,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    last_executed: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString(),
    pass_rate: Number((Math.random() * 30 + 70).toFixed(1)),
    execution_count: Math.floor(Math.random() * 200) + 10,
    avg_duration: Number((Math.random() * 20 + 2).toFixed(1)),
    effectiveness_score: Number((Math.random() * 40 + 60).toFixed(1)),
    tags: tags[Math.floor(Math.random() * tags.length)]
  }));
};
