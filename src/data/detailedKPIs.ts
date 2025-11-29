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

// Extended Team type that includes kpiData from the API
interface TeamWithKPI extends Team {
  kpiData?: {
    testCoverage?: number;
    testFlakinessRate?: number;
    defectDensity?: number;
    defectEscapeRate?: number;
    codeQualityScore?: number;
    avgBuildTimeMinutes?: number;
    testExecutionTimeMinutes?: number;
    deploymentFrequencyPerWeek?: number;
    leadTimeDays?: number;
    mttrHours?: number;
    parallelTestEfficiency?: number;
    sprintVelocity?: number;
    sprintCommitmentRate?: number;
    sprintCarryover?: number;
    firstTimePassRate?: number;
    blockedTimeHours?: number;
    automationCoverage?: number;
    automationRoi?: number;
    changeFailureRate?: number;
    mtbfHours?: number;
    systemAvailability?: number;
    infrastructureFailures?: number;
  };
}

// Helper to determine status based on value and thresholds
const getStatus = (value: number | null | undefined, goodThreshold: number, warningThreshold: number, lowerIsBetter = false): 'good' | 'warning' | 'critical' => {
  if (value === null || value === undefined) return 'warning';
  if (lowerIsBetter) {
    if (value <= goodThreshold) return 'good';
    if (value <= warningThreshold) return 'warning';
    return 'critical';
  } else {
    if (value >= goodThreshold) return 'good';
    if (value >= warningThreshold) return 'warning';
    return 'critical';
  }
};

export const generateDetailedKPIs = (team: TeamWithKPI): DetailedKPI[] => {
  const kpi = team.kpiData || {};
  
  // Check if we have real KPI data (any real metric value)
  const hasRealData = Object.values(kpi).some(val => val !== null && val !== undefined);
  
  const generateHistory = (base: number, variance: number) => {
    // If we have real data, only generate today's data point (day 1)
    // If no real data (mock mode), generate 30 days of history
    const days = hasRealData ? 1 : 30;
    const dates = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      return d.toISOString().split('T')[0];
    });
    return dates.map(date => ({
      date,
      value: Number((base + (Math.random() * variance * 2 - variance)).toFixed(2))
    }));
  };

  // Use real data from kpiData if available, otherwise generate mock data
  const getValue = (realValue: number | null | undefined, mockMin: number, mockMax: number): number => {
    if (realValue !== null && realValue !== undefined) {
      return Number(realValue);
    }
    return Number((mockMin + Math.random() * (mockMax - mockMin)).toFixed(2));
  };

  // Generate change value - 0 for day 1 (real data), random for mock data
  const getChange = (mockChange: number): number => {
    return hasRealData ? 0 : mockChange;
  };

  // Generate trend - neutral for day 1 (real data), random for mock data
  const getTrend = (mockTrend: 'up' | 'down' | 'neutral'): 'up' | 'down' | 'neutral' => {
    return hasRealData ? 'neutral' : mockTrend;
  };

  return [
    // Quality & Reliability
    
    // TEST COVERAGE - Target: >80% for critical paths, >70% overall
    {
      id: 'test-coverage',
      name: 'Test Coverage',
      value: getValue(kpi.testCoverage, 60, 95),
      unit: '%',
      change: getChange(Number((Math.random() * 5 - 2).toFixed(1))),
      trend: getTrend('up'),
      status: getStatus(kpi.testCoverage, 80, 70),
      category: 'quality',
      description: 'Percentage of code covered by automated tests',
      history: generateHistory(getValue(kpi.testCoverage, 75, 75), 5)
    },
    
    // TEST FLAKINESS RATE - Target: <2% (lower is better)
    {
      id: 'flakiness-rate',
      name: 'Test Flakiness Rate',
      value: getValue(kpi.testFlakinessRate, 0, 5),
      unit: '%',
      change: getChange(Number((Math.random() * 2 - 1).toFixed(1))),
      trend: getTrend('down'),
      status: getStatus(kpi.testFlakinessRate, 2, 5, true),
      category: 'quality',
      description: 'Tests that fail intermittently without code changes',
      history: generateHistory(getValue(kpi.testFlakinessRate, 2.5, 2.5), 1)
    },
    
    // DEFECT DENSITY - Target: <0.5 defects per 1k LOC
    {
      id: 'defect-density',
      name: 'Defect Density',
      value: getValue(kpi.defectDensity, 0, 1.5),
      unit: '/1k LOC',
      change: getChange(-0.1),
      trend: getTrend('down'),
      status: getStatus(kpi.defectDensity, 0.5, 1.0, true),
      category: 'quality',
      description: 'Number of defects per thousand lines of code',
      history: generateHistory(getValue(kpi.defectDensity, 0.8, 0.8), 0.2)
    },
    
    // DEFECT ESCAPE RATE - Target: <5%
    {
      id: 'defect-escape-rate',
      name: 'Defect Escape Rate',
      value: getValue(kpi.defectEscapeRate, 0, 8),
      unit: '%',
      change: getChange(-0.5),
      trend: getTrend('down'),
      status: getStatus(kpi.defectEscapeRate, 5, 10, true),
      category: 'quality',
      description: 'Bugs found in production vs. caught in testing',
      history: generateHistory(getValue(kpi.defectEscapeRate, 4, 4), 1)
    },
    
    // CODE QUALITY SCORE - Target: >85/100
    {
      id: 'code-quality-score',
      name: 'Code Quality Score',
      value: getValue(kpi.codeQualityScore, 70, 95),
      unit: '/100',
      change: getChange(2),
      trend: getTrend('up'),
      status: getStatus(kpi.codeQualityScore, 85, 70),
      category: 'quality',
      description: 'SonarQube or similar static analysis score',
      history: generateHistory(getValue(kpi.codeQualityScore, 85, 85), 5)
    },

    // Speed & Efficiency
    
    // AVERAGE BUILD TIME - Target: <10 minutes
    {
      id: 'build-time',
      name: 'Avg Build Time',
      value: getValue(kpi.avgBuildTimeMinutes, 5, 20),
      unit: 'min',
      change: getChange(-1.5),
      trend: getTrend('down'),
      status: getStatus(kpi.avgBuildTimeMinutes, 10, 15, true),
      category: 'speed',
      description: 'Average time to complete CI/CD build',
      history: generateHistory(getValue(kpi.avgBuildTimeMinutes, 12, 12), 3)
    },
    
    // TEST EXECUTION TIME - Target: <30 minutes
    {
      id: 'test-execution-time',
      name: 'Test Execution Time',
      value: getValue(kpi.testExecutionTimeMinutes, 20, 60),
      unit: 'min',
      change: getChange(-2),
      trend: getTrend('down'),
      status: getStatus(kpi.testExecutionTimeMinutes, 30, 45, true),
      category: 'speed',
      description: 'Total time to run all automated tests',
      history: generateHistory(getValue(kpi.testExecutionTimeMinutes, 45, 45), 8)
    },
    
    // DEPLOYMENT FREQUENCY - Target: >5 per week
    {
      id: 'deployment-frequency',
      name: 'Deployment Frequency',
      value: getValue(kpi.deploymentFrequencyPerWeek, 5, 20),
      unit: '/week',
      change: getChange(3),
      trend: getTrend('up'),
      status: getStatus(kpi.deploymentFrequencyPerWeek, 5, 2),
      category: 'speed',
      description: 'Number of deployments to production per week',
      history: generateHistory(getValue(kpi.deploymentFrequencyPerWeek, 8, 8), 2)
    },
    
    // LEAD TIME FOR CHANGES - Target: <1 day (elite), <7 days (high)
    {
      id: 'lead-time',
      name: 'Lead Time for Changes',
      value: getValue(kpi.leadTimeDays, 1, 5),
      unit: 'days',
      change: getChange(-0.3),
      trend: getTrend('down'),
      status: getStatus(kpi.leadTimeDays, 1, 7, true),
      category: 'speed',
      description: 'Time from commit to production deployment',
      history: generateHistory(getValue(kpi.leadTimeDays, 2.5, 2.5), 0.5)
    },
    
    // MEAN TIME TO REPAIR - Target: <1 hour (elite), <24 hours (high)
    {
      id: 'mttr',
      name: 'Mean Time to Repair',
      value: getValue(kpi.mttrHours, 2, 10),
      unit: 'hours',
      change: getChange(-1),
      trend: getTrend('down'),
      status: getStatus(kpi.mttrHours, 1, 24, true),
      category: 'speed',
      description: 'Average time to diagnose and fix failures',
      history: generateHistory(getValue(kpi.mttrHours, 5, 5), 2)
    },
    
    // PARALLEL TEST EFFICIENCY - Target: >80%
    {
      id: 'parallel-efficiency',
      name: 'Parallel Test Efficiency',
      value: getValue(kpi.parallelTestEfficiency, 70, 95),
      unit: '%',
      change: getChange(2),
      trend: getTrend('up'),
      status: getStatus(kpi.parallelTestEfficiency, 80, 60),
      category: 'speed',
      description: 'Efficiency of parallel test execution',
      history: generateHistory(getValue(kpi.parallelTestEfficiency, 82, 82), 5)
    },

    // Agile & Process
    
    // SPRINT VELOCITY - Target: Stable velocity (±10%)
    {
      id: 'sprint-velocity',
      name: 'Sprint Velocity',
      value: getValue(kpi.sprintVelocity, 30, 60),
      unit: 'pts',
      change: getChange(5),
      trend: getTrend('up'),
      status: 'good', // Velocity doesn't have good/bad, just consistency
      category: 'agile',
      description: 'Story points completed per sprint',
      history: generateHistory(getValue(kpi.sprintVelocity, 45, 45), 8)
    },
    
    // SPRINT COMMITMENT RATE - Target: >85%
    {
      id: 'sprint-commitment',
      name: 'Sprint Commitment Rate',
      value: getValue(kpi.sprintCommitmentRate, 75, 95),
      unit: '%',
      change: getChange(-2),
      trend: getTrend('down'),
      status: getStatus(kpi.sprintCommitmentRate, 85, 70),
      category: 'agile',
      description: 'Percentage of committed work completed',
      history: generateHistory(getValue(kpi.sprintCommitmentRate, 88, 88), 5)
    },
    
    // SPRINT CARRYOVER - Target: <10%
    {
      id: 'sprint-carryover',
      name: 'Sprint Carryover',
      value: getValue(kpi.sprintCarryover, 5, 25),
      unit: '%',
      change: getChange(3),
      trend: getTrend('up'),
      status: getStatus(kpi.sprintCarryover, 10, 20, true),
      category: 'agile',
      description: 'Work not completed and moved to next sprint',
      history: generateHistory(getValue(kpi.sprintCarryover, 12, 12), 4)
    },
    
    // FIRST-TIME PASS RATE - Target: >75%
    {
      id: 'first-time-pass',
      name: 'First-Time Pass Rate',
      value: getValue(kpi.firstTimePassRate, 60, 90),
      unit: '%',
      change: getChange(2),
      trend: getTrend('up'),
      status: getStatus(kpi.firstTimePassRate, 75, 60),
      category: 'agile',
      description: 'Stories passing QA on first attempt',
      history: generateHistory(getValue(kpi.firstTimePassRate, 70, 70), 8)
    },
    
    // BLOCKED TIME - Target: <15 hours per sprint
    {
      id: 'blocked-time',
      name: 'Blocked Time',
      value: getValue(kpi.blockedTimeHours, 10, 30),
      unit: 'hrs',
      change: getChange(-4),
      trend: getTrend('down'),
      status: getStatus(kpi.blockedTimeHours, 15, 25, true),
      category: 'agile',
      description: 'Total hours tickets spent blocked per sprint',
      history: generateHistory(getValue(kpi.blockedTimeHours, 18, 18), 5)
    },
    
    // TEST AUTOMATION COVERAGE - Target: >70%
    {
      id: 'automation-coverage',
      name: 'Test Automation Coverage',
      value: getValue(kpi.automationCoverage, 60, 95),
      unit: '%',
      change: getChange(3),
      trend: getTrend('up'),
      status: getStatus(kpi.automationCoverage, 70, 50),
      category: 'agile',
      description: 'Percentage of test cases automated',
      history: generateHistory(getValue(kpi.automationCoverage, 75, 75), 5)
    },
    
    // AUTOMATION ROI - Target: >200%
    {
      id: 'automation-roi',
      name: 'Automation ROI',
      value: getValue(kpi.automationRoi, 200, 400),
      unit: '%',
      change: getChange(15),
      trend: getTrend('up'),
      status: getStatus(kpi.automationRoi, 200, 100),
      category: 'agile',
      description: 'Return on investment for test automation',
      history: generateHistory(getValue(kpi.automationRoi, 280, 280), 30)
    },

    // Reliability
    
    // CHANGE FAILURE RATE - Target: <5% (elite), <15% (high)
    {
      id: 'change-failure-rate',
      name: 'Change Failure Rate',
      value: getValue(kpi.changeFailureRate, 0, 10),
      unit: '%',
      change: getChange(0.5),
      trend: getTrend('up'),
      status: getStatus(kpi.changeFailureRate, 5, 15, true),
      category: 'reliability',
      description: 'Deployments causing failures or rollbacks',
      history: generateHistory(getValue(kpi.changeFailureRate, 5, 5), 2)
    },
    
    // MEAN TIME BETWEEN FAILURES - Target: >100 hours
    {
      id: 'mtbf',
      name: 'Mean Time Between Failures',
      value: getValue(kpi.mtbfHours, 80, 160),
      unit: 'hours',
      change: getChange(10),
      trend: getTrend('up'),
      status: getStatus(kpi.mtbfHours, 100, 50),
      category: 'reliability',
      description: 'Average time between system failures',
      history: generateHistory(getValue(kpi.mtbfHours, 120, 120), 20)
    },
    
    // SYSTEM AVAILABILITY - Target: >99.9%
    {
      id: 'availability',
      name: 'System Availability',
      value: getValue(kpi.systemAvailability, 99, 100),
      unit: '%',
      change: getChange(0.1),
      trend: getTrend('up'),
      status: getStatus(kpi.systemAvailability, 99.9, 99),
      category: 'reliability',
      description: 'Uptime percentage',
      history: generateHistory(getValue(kpi.systemAvailability, 99.5, 99.5), 0.3)
    },
    
    // INFRASTRUCTURE FAILURES - Target: <5 per sprint
    {
      id: 'infra-failures',
      name: 'Infrastructure Failures',
      value: getValue(kpi.infrastructureFailures, 0, 8),
      unit: 'count',
      change: getChange(-1),
      trend: getTrend('down'),
      status: getStatus(kpi.infrastructureFailures, 5, 10, true),
      category: 'reliability',
      description: 'Test failures due to infrastructure issues',
      history: generateHistory(getValue(kpi.infrastructureFailures, 3, 3), 2)
    },
    
    // ENVIRONMENT STARTUP TIME - Target: <5 minutes (fast), <10 minutes (ok)
    {
      id: 'env-startup-time',
      name: 'Environment Startup Time',
      value: Math.floor(5 + Math.random() * 15), // No kpiData field for this yet
      unit: 'min',
      change: getChange(1),
      trend: getTrend('up'),
      status: 'warning',
      category: 'reliability',
      description: 'Time to provision test environments',
      history: generateHistory(10, 3)
    }
  ];
};
