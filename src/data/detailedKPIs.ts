import type { Team } from '../data/mockData';

export interface DetailedKPI {
  id: string;
  name: string;
  value: number | string;
  unit?: string;
  change: number;
  trend: 'up' | 'down' | 'neutral';
  status: 'good' | 'warning' | 'critical';
  category: 'quality' | 'speed' | 'agile' | 'reliability';
  description: string;
  history: { date: string; value: number }[];
}

export const generateDetailedKPIs = (team: Team): DetailedKPI[] => {
  const generateHistory = (base: number, variance: number) => {
    const dates = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return d.toISOString().split('T')[0];
    });
    return dates.map(date => ({
      date,
      value: Number((base + (Math.random() * variance * 2 - variance)).toFixed(2))
    }));
  };

  return [
    // Quality & Reliability
    {
      id: 'test-coverage',
      name: 'Test Coverage',
      value: Math.floor(60 + Math.random() * 35),
      unit: '%',
      change: Number((Math.random() * 5 - 2).toFixed(1)),
      trend: 'up',
      status: 'good',
      category: 'quality',
      description: 'Percentage of code covered by automated tests',
      history: generateHistory(75, 5)
    },
    {
      id: 'flakiness-rate',
      name: 'Test Flakiness Rate',
      value: Number((Math.random() * 5).toFixed(1)),
      unit: '%',
      change: Number((Math.random() * 2 - 1).toFixed(1)),
      trend: 'down',
      status: Math.random() > 0.7 ? 'warning' : 'good',
      category: 'quality',
      description: 'Tests that fail intermittently without code changes',
      history: generateHistory(2.5, 1)
    },
    {
      id: 'defect-density',
      name: 'Defect Density',
      value: Number((Math.random() * 1.5).toFixed(2)),
      unit: '/1k LOC',
      change: -0.1,
      trend: 'down',
      status: 'good',
      category: 'quality',
      description: 'Number of defects per thousand lines of code',
      history: generateHistory(0.8, 0.2)
    },
    {
      id: 'defect-escape-rate',
      name: 'Defect Escape Rate',
      value: Number((Math.random() * 8).toFixed(1)),
      unit: '%',
      change: -0.5,
      trend: 'down',
      status: 'good',
      category: 'quality',
      description: 'Bugs found in production vs. caught in testing',
      history: generateHistory(4, 1)
    },
    {
      id: 'code-quality-score',
      name: 'Code Quality Score',
      value: Math.floor(70 + Math.random() * 25),
      unit: '/100',
      change: 2,
      trend: 'up',
      status: 'good',
      category: 'quality',
      description: 'SonarQube or similar static analysis score',
      history: generateHistory(85, 5)
    },

    // Speed & Efficiency
    {
      id: 'build-time',
      name: 'Avg Build Time',
      value: Math.floor(5 + Math.random() * 15),
      unit: 'min',
      change: -1.5,
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Average time to complete CI/CD build',
      history: generateHistory(12, 3)
    },
    {
      id: 'test-execution-time',
      name: 'Test Execution Time',
      value: Math.floor(20 + Math.random() * 40),
      unit: 'min',
      change: -2,
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Total time to run all automated tests',
      history: generateHistory(45, 8)
    },
    {
      id: 'deployment-frequency',
      name: 'Deployment Frequency',
      value: Math.floor(5 + Math.random() * 15),
      unit: '/week',
      change: 3,
      trend: 'up',
      status: 'good',
      category: 'speed',
      description: 'Number of deployments to production per week',
      history: generateHistory(8, 2)
    },
    {
      id: 'lead-time',
      name: 'Lead Time for Changes',
      value: Number((1 + Math.random() * 4).toFixed(1)),
      unit: 'days',
      change: -0.3,
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Time from commit to production deployment',
      history: generateHistory(2.5, 0.5)
    },
    {
      id: 'mttr',
      name: 'Mean Time to Repair',
      value: Number((2 + Math.random() * 8).toFixed(1)),
      unit: 'hours',
      change: -1,
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Average time to diagnose and fix failures',
      history: generateHistory(5, 2)
    },
    {
      id: 'parallel-efficiency',
      name: 'Parallel Test Efficiency',
      value: Math.floor(70 + Math.random() * 25),
      unit: '%',
      change: 2,
      trend: 'up',
      status: 'good',
      category: 'speed',
      description: 'Efficiency of parallel test execution',
      history: generateHistory(82, 5)
    },

    // Agile & Process
    {
      id: 'sprint-velocity',
      name: 'Sprint Velocity',
      value: Math.floor(30 + Math.random() * 30),
      unit: 'pts',
      change: 5,
      trend: 'up',
      status: 'good',
      category: 'agile',
      description: 'Story points completed per sprint',
      history: generateHistory(45, 8)
    },
    {
      id: 'sprint-commitment',
      name: 'Sprint Commitment Rate',
      value: Math.floor(75 + Math.random() * 20),
      unit: '%',
      change: -2,
      trend: 'down',
      status: 'warning',
      category: 'agile',
      description: 'Percentage of committed work completed',
      history: generateHistory(88, 5)
    },
    {
      id: 'sprint-carryover',
      name: 'Sprint Carryover',
      value: Math.floor(5 + Math.random() * 20),
      unit: '%',
      change: 3,
      trend: 'up',
      status: 'warning',
      category: 'agile',
      description: 'Work not completed and moved to next sprint',
      history: generateHistory(12, 4)
    },
    {
      id: 'first-time-pass',
      name: 'First-Time Pass Rate',
      value: Math.floor(60 + Math.random() * 30),
      unit: '%',
      change: 2,
      trend: 'up',
      status: 'warning',
      category: 'agile',
      description: 'Stories passing QA on first attempt',
      history: generateHistory(70, 8)
    },
    {
      id: 'blocked-time',
      name: 'Blocked Time',
      value: Math.floor(10 + Math.random() * 20),
      unit: 'hrs',
      change: -4,
      trend: 'down',
      status: 'good',
      category: 'agile',
      description: 'Total hours tickets spent blocked per sprint',
      history: generateHistory(18, 5)
    },
    {
      id: 'automation-coverage',
      name: 'Test Automation Coverage',
      value: Math.floor(60 + Math.random() * 35),
      unit: '%',
      change: 3,
      trend: 'up',
      status: 'good',
      category: 'agile',
      description: 'Percentage of test cases automated',
      history: generateHistory(75, 5)
    },
    {
      id: 'automation-roi',
      name: 'Automation ROI',
      value: Math.floor(200 + Math.random() * 200),
      unit: '%',
      change: 15,
      trend: 'up',
      status: 'good',
      category: 'agile',
      description: 'Return on investment for test automation',
      history: generateHistory(280, 30)
    },

    // Reliability
    {
      id: 'change-failure-rate',
      name: 'Change Failure Rate',
      value: Number((Math.random() * 10).toFixed(1)),
      unit: '%',
      change: 0.5,
      trend: 'up',
      status: 'warning',
      category: 'reliability',
      description: 'Deployments causing failures or rollbacks',
      history: generateHistory(5, 2)
    },
    {
      id: 'mtbf',
      name: 'Mean Time Between Failures',
      value: Math.floor(80 + Math.random() * 80),
      unit: 'hours',
      change: 10,
      trend: 'up',
      status: 'good',
      category: 'reliability',
      description: 'Average time between system failures',
      history: generateHistory(120, 20)
    },
    {
      id: 'availability',
      name: 'System Availability',
      value: Number((99 + Math.random()).toFixed(2)),
      unit: '%',
      change: 0.1,
      trend: 'up',
      status: 'good',
      category: 'reliability',
      description: 'Uptime percentage',
      history: generateHistory(99.5, 0.3)
    },
    {
      id: 'infra-failures',
      name: 'Infrastructure Failures',
      value: Math.floor(Math.random() * 8),
      unit: 'count',
      change: -1,
      trend: 'down',
      status: 'good',
      category: 'reliability',
      description: 'Test failures due to infrastructure issues',
      history: generateHistory(3, 2)
    },
    {
      id: 'env-startup-time',
      name: 'Environment Startup Time',
      value: Math.floor(5 + Math.random() * 15),
      unit: 'min',
      change: 1,
      trend: 'up',
      status: 'warning',
      category: 'reliability',
      description: 'Time to provision test environments',
      history: generateHistory(10, 3)
    }
  ];
};
