import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Calculator, Save, AlertCircle, CheckCircle, Info, ChevronDown, ChevronRight, History, Calendar, ArrowUp, Users, UserCircle, Zap, Wrench, DollarSign, TrendingUp, Headphones, GitBranch, Code, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import API_URL from '../config/api';

// Mapping from metric ID to database field name
const METRIC_DB_MAPPING: Record<string, string> = {
  'test-coverage': 'testCoverage',
  'flakiness-rate': 'testFlakinessRate',
  'defect-density': 'defectDensity',
  'defect-escape-rate': 'defectEscapeRate',
  'code-quality-score': 'codeQualityScore',
  'build-time': 'avgBuildTimeMinutes',
  'test-execution-time': 'testExecutionTimeMinutes',
  'deployment-frequency': 'deploymentFrequencyPerWeek',
  'lead-time': 'leadTimeDays',
  'mttr': 'mttrHours',
  'parallel-efficiency': 'parallelTestEfficiency',
  'sprint-velocity': 'sprintVelocity',
  'sprint-commitment': 'sprintCommitmentRate',
  'sprint-carryover': 'sprintCarryover',
  'first-time-pass': 'firstTimePassRate',
  'blocked-time': 'blockedTimeHours',
  'automation-coverage': 'automationCoverage',
  'automation-roi': 'automationRoi',
  'change-failure-rate': 'changeFailureRate',
  'mtbf': 'mtbfHours',
  'availability': 'systemAvailability',
  'infra-failures': 'infrastructureFailures'
};

interface ExistingMetrics {
  qaScore?: number;
  snapshotDate?: string;
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
}

interface MetricDefinition {
  id: string;
  name: string;
  category: 'quality' | 'speed' | 'agile' | 'reliability';
  description: string;
  formula: string;
  inputs: {
    id: string;
    label: string;
    type: 'number' | 'percentage' | 'hours' | 'minutes' | 'days' | 'count';
    placeholder: string;
    min?: number;
    max?: number;
    step?: number;
  }[];
  calculate: (inputs: Record<string, number>) => number;
  unit: string;
  target: string;
  lowerIsBetter?: boolean;
}

interface Team {
  id: string;
  name: string;
  department?: string;
  department_id?: string;
}

interface TeamMember {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

interface DeveloperMetricsInput {
  prMergeTimeAvg: number;      // PR Time (hours)
  codeReviewTimeAvg: number;   // Review Time (hours)
  focusTimeHours: number;      // Focus Time (hours per day)
  meetingTimeHours: number;    // Meeting Time (hours per day)
  contextSwitchesPerDay: number; // Context Switches per day
}

interface TechnicalDebtItem {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  estimated_effort_hours: number;
  affected_users: number;
  support_tickets_monthly: number;
  downtime_minutes_monthly: number;
  revenue_impact_percent: number;
  sla_breaches_monthly: number;
  // Calculated fields
  investment_cost?: number;
  monthly_cost_of_delay?: number;
  annual_savings?: number;
  roi_percentage?: number;
  payback_months?: number;
}

interface PipelineStageItem {
  id: string;
  name: string;
  stage_order: number;
  duration: number; // seconds
  success_rate: number;
  cpu_usage: number;
  memory_usage: number;
  cost_per_run: number;
  bottleneck_score?: number;
}

// Calculate Happiness Score (0-100)
// Formula: Based on focus time ratio, low context switches, and reasonable meeting time
const calculateHappinessScore = (metrics: DeveloperMetricsInput): number => {
  const focusRatio = metrics.focusTimeHours / (metrics.focusTimeHours + metrics.meetingTimeHours);
  const focusScore = Math.min(focusRatio * 100, 100) * 0.4; // 40% weight
  
  // Context switches: fewer is better (ideal: 3-5, bad: 10+)
  const contextScore = Math.max(0, (10 - metrics.contextSwitchesPerDay) / 10 * 100) * 0.3; // 30% weight
  
  // Meeting time: 1-2 hours ideal, 4+ hours is bad
  const meetingScore = Math.max(0, (4 - metrics.meetingTimeHours) / 4 * 100) * 0.15; // 15% weight
  
  // PR and Review time: faster is better (ideal: <4 hours, bad: 24+ hours)
  const prScore = Math.max(0, (24 - metrics.prMergeTimeAvg) / 24 * 100) * 0.075; // 7.5% weight
  const reviewScore = Math.max(0, (8 - metrics.codeReviewTimeAvg) / 8 * 100) * 0.075; // 7.5% weight
  
  return Math.min(100, Math.max(0, focusScore + contextScore + meetingScore + prScore + reviewScore));
};

// Calculate Burnout Risk (Low, Moderate, High)
// Based on: high meeting time, low focus time, high context switches, long PR times
const calculateBurnoutRisk = (metrics: DeveloperMetricsInput, happinessScore: number): 'low' | 'moderate' | 'high' => {
  let riskScore = 0;
  
  // High meeting time increases risk
  if (metrics.meetingTimeHours > 4) riskScore += 30;
  else if (metrics.meetingTimeHours > 2.5) riskScore += 15;
  
  // Low focus time increases risk
  if (metrics.focusTimeHours < 3) riskScore += 30;
  else if (metrics.focusTimeHours < 4) riskScore += 15;
  
  // High context switches increase risk
  if (metrics.contextSwitchesPerDay > 8) riskScore += 25;
  else if (metrics.contextSwitchesPerDay > 5) riskScore += 10;
  
  // Low happiness score increases risk
  if (happinessScore < 60) riskScore += 25;
  else if (happinessScore < 75) riskScore += 10;
  
  if (riskScore >= 50) return 'high';
  if (riskScore >= 25) return 'moderate';
  return 'low';
};

interface ManualMetricsInputProps {
  onBack: () => void;
}

// All 22 metrics with their formulas and input fields
const METRICS: MetricDefinition[] = [
  // Quality Metrics
  {
    id: 'test-coverage',
    name: 'Test Coverage',
    category: 'quality',
    description: 'Percentage of codebase covered by automated tests',
    formula: '(Lines executed by tests ÷ Total LOC) × 100',
    inputs: [
      { id: 'linesExecuted', label: 'Lines Executed by Tests', type: 'number', placeholder: 'e.g., 8500', min: 0 },
      { id: 'totalLOC', label: 'Total Lines of Code', type: 'number', placeholder: 'e.g., 10000', min: 1 }
    ],
    calculate: (inputs) => inputs.totalLOC > 0 ? (inputs.linesExecuted / inputs.totalLOC) * 100 : 0,
    unit: '%',
    target: '>80% critical, >70% overall'
  },
  {
    id: 'flakiness-rate',
    name: 'Test Flakiness Rate',
    category: 'quality',
    description: 'Tests producing inconsistent results without code changes',
    formula: '(Flaky runs ÷ Total runs) × 100',
    inputs: [
      { id: 'flakyRuns', label: 'Flaky Test Runs', type: 'number', placeholder: 'e.g., 5', min: 0 },
      { id: 'totalRuns', label: 'Total Test Runs', type: 'number', placeholder: 'e.g., 500', min: 1 }
    ],
    calculate: (inputs) => inputs.totalRuns > 0 ? (inputs.flakyRuns / inputs.totalRuns) * 100 : 0,
    unit: '%',
    target: '<2%',
    lowerIsBetter: true
  },
  {
    id: 'defect-density',
    name: 'Defect Density',
    category: 'quality',
    description: 'Number of defects per thousand lines of code',
    formula: '(Total bugs ÷ Lines of code) × 1000',
    inputs: [
      { id: 'totalBugs', label: 'Total Bugs Found', type: 'number', placeholder: 'e.g., 12', min: 0 },
      { id: 'linesOfCode', label: 'Lines of Code (thousands)', type: 'number', placeholder: 'e.g., 50', min: 0.1, step: 0.1 }
    ],
    calculate: (inputs) => inputs.linesOfCode > 0 ? inputs.totalBugs / inputs.linesOfCode : 0,
    unit: '/1k LOC',
    target: '<0.5 per 1k LOC',
    lowerIsBetter: true
  },
  {
    id: 'defect-escape-rate',
    name: 'Defect Escape Rate',
    category: 'quality',
    description: 'Bugs found in production vs. caught during testing',
    formula: '(Production bugs ÷ Total bugs) × 100',
    inputs: [
      { id: 'productionBugs', label: 'Production Bugs', type: 'number', placeholder: 'e.g., 3', min: 0 },
      { id: 'totalBugs', label: 'Total Bugs Found', type: 'number', placeholder: 'e.g., 50', min: 1 }
    ],
    calculate: (inputs) => inputs.totalBugs > 0 ? (inputs.productionBugs / inputs.totalBugs) * 100 : 0,
    unit: '%',
    target: '<5%',
    lowerIsBetter: true
  },
  {
    id: 'code-quality-score',
    name: 'Code Quality Score',
    category: 'quality',
    description: 'Composite from static analysis (SonarQube ratings)',
    formula: 'Weighted avg: Maintainability×0.4 + Reliability×0.35 + Security×0.25',
    inputs: [
      { id: 'maintainability', label: 'Maintainability Rating (A=100, B=80, C=60, D=40, E=20)', type: 'number', placeholder: 'e.g., 85', min: 0, max: 100 },
      { id: 'reliability', label: 'Reliability Rating', type: 'number', placeholder: 'e.g., 90', min: 0, max: 100 },
      { id: 'security', label: 'Security Rating', type: 'number', placeholder: 'e.g., 95', min: 0, max: 100 }
    ],
    calculate: (inputs) => (inputs.maintainability * 0.4) + (inputs.reliability * 0.35) + (inputs.security * 0.25),
    unit: '/100',
    target: '>85 (A rating)'
  },

  // Speed Metrics
  {
    id: 'build-time',
    name: 'Average Build Time',
    category: 'speed',
    description: 'Mean CI/CD pipeline duration',
    formula: 'Sum(build durations) ÷ Build count',
    inputs: [
      { id: 'totalBuildTime', label: 'Total Build Time (minutes)', type: 'number', placeholder: 'e.g., 450', min: 0 },
      { id: 'buildCount', label: 'Number of Builds', type: 'number', placeholder: 'e.g., 30', min: 1 }
    ],
    calculate: (inputs) => inputs.buildCount > 0 ? inputs.totalBuildTime / inputs.buildCount : 0,
    unit: 'min',
    target: '<10 minutes',
    lowerIsBetter: true
  },
  {
    id: 'test-execution-time',
    name: 'Test Execution Time',
    category: 'speed',
    description: 'Total time to run automated test suite',
    formula: 'Direct input: Total test suite duration',
    inputs: [
      { id: 'executionTime', label: 'Test Suite Duration (minutes)', type: 'number', placeholder: 'e.g., 35', min: 0 }
    ],
    calculate: (inputs) => inputs.executionTime || 0,
    unit: 'min',
    target: '<30 min full, <5 min critical',
    lowerIsBetter: true
  },
  {
    id: 'deployment-frequency',
    name: 'Deployment Frequency',
    category: 'speed',
    description: 'Production deploys per week (DORA metric)',
    formula: 'Count(successful prod deploys) ÷ Weeks',
    inputs: [
      { id: 'successfulDeploys', label: 'Successful Production Deploys', type: 'number', placeholder: 'e.g., 12', min: 0 },
      { id: 'weeks', label: 'Number of Weeks', type: 'number', placeholder: 'e.g., 2', min: 1 }
    ],
    calculate: (inputs) => inputs.weeks > 0 ? inputs.successfulDeploys / inputs.weeks : 0,
    unit: '/week',
    target: '>5/week (daily for elite)'
  },
  {
    id: 'lead-time',
    name: 'Lead Time for Changes',
    category: 'speed',
    description: 'Time from commit to production (DORA metric)',
    formula: 'Median(deploy_timestamp - commit_timestamp)',
    inputs: [
      { id: 'leadTimeDays', label: 'Average Lead Time (days)', type: 'number', placeholder: 'e.g., 2.5', min: 0, step: 0.1 }
    ],
    calculate: (inputs) => inputs.leadTimeDays || 0,
    unit: 'days',
    target: '<1 day elite, <1 week high',
    lowerIsBetter: true
  },
  {
    id: 'mttr',
    name: 'Mean Time to Repair',
    category: 'speed',
    description: 'Time to restore service after incident (DORA metric)',
    formula: 'Avg(resolved_date - detected_date)',
    inputs: [
      { id: 'totalRepairTime', label: 'Total Repair Time (hours)', type: 'number', placeholder: 'e.g., 24', min: 0 },
      { id: 'incidentCount', label: 'Number of Incidents', type: 'number', placeholder: 'e.g., 5', min: 1 }
    ],
    calculate: (inputs) => inputs.incidentCount > 0 ? inputs.totalRepairTime / inputs.incidentCount : 0,
    unit: 'hours',
    target: '<1 hour elite, <1 day high',
    lowerIsBetter: true
  },
  {
    id: 'parallel-efficiency',
    name: 'Parallel Test Efficiency',
    category: 'speed',
    description: 'How effectively tests parallelize',
    formula: '(Sequential_time ÷ Parallel_time) ÷ Workers × 100',
    inputs: [
      { id: 'sequentialTime', label: 'Sequential Execution Time (min)', type: 'number', placeholder: 'e.g., 120', min: 0 },
      { id: 'parallelTime', label: 'Parallel Execution Time (min)', type: 'number', placeholder: 'e.g., 35', min: 1 },
      { id: 'workers', label: 'Number of Workers', type: 'number', placeholder: 'e.g., 4', min: 1 }
    ],
    calculate: (inputs) => inputs.parallelTime > 0 && inputs.workers > 0 
      ? ((inputs.sequentialTime / inputs.parallelTime) / inputs.workers) * 100 
      : 0,
    unit: '%',
    target: '>80% (near-linear)'
  },
  {
    id: 'env-startup-time',
    name: 'Environment Startup Time',
    category: 'speed',
    description: 'Time to provision test environments',
    formula: 'Avg(ready_time - request_time)',
    inputs: [
      { id: 'startupTime', label: 'Average Startup Time (minutes)', type: 'number', placeholder: 'e.g., 8', min: 0 }
    ],
    calculate: (inputs) => inputs.startupTime || 0,
    unit: 'min',
    target: '<5 min fast, <10 min ok',
    lowerIsBetter: true
  },

  // Agile Metrics
  {
    id: 'sprint-velocity',
    name: 'Sprint Velocity',
    category: 'agile',
    description: 'Story points completed per sprint',
    formula: 'Sum(story_points) WHERE status=Done',
    inputs: [
      { id: 'completedPoints', label: 'Completed Story Points', type: 'number', placeholder: 'e.g., 45', min: 0 }
    ],
    calculate: (inputs) => inputs.completedPoints || 0,
    unit: 'pts',
    target: 'Stable ±10% over 3-4 sprints'
  },
  {
    id: 'sprint-commitment',
    name: 'Sprint Commitment Rate',
    category: 'agile',
    description: 'Percentage of committed work completed',
    formula: '(Completed_points ÷ Committed_points) × 100',
    inputs: [
      { id: 'completedPoints', label: 'Completed Story Points', type: 'number', placeholder: 'e.g., 40', min: 0 },
      { id: 'committedPoints', label: 'Committed Story Points', type: 'number', placeholder: 'e.g., 45', min: 1 }
    ],
    calculate: (inputs) => inputs.committedPoints > 0 ? (inputs.completedPoints / inputs.committedPoints) * 100 : 0,
    unit: '%',
    target: '>85%'
  },
  {
    id: 'sprint-carryover',
    name: 'Sprint Carryover',
    category: 'agile',
    description: 'Work moved to next sprint',
    formula: '(Incomplete_points ÷ Committed_points) × 100',
    inputs: [
      { id: 'incompletePoints', label: 'Incomplete Story Points', type: 'number', placeholder: 'e.g., 5', min: 0 },
      { id: 'committedPoints', label: 'Committed Story Points', type: 'number', placeholder: 'e.g., 45', min: 1 }
    ],
    calculate: (inputs) => inputs.committedPoints > 0 ? (inputs.incompletePoints / inputs.committedPoints) * 100 : 0,
    unit: '%',
    target: '<10%',
    lowerIsBetter: true
  },
  {
    id: 'first-time-pass',
    name: 'First-Time Pass Rate',
    category: 'agile',
    description: 'Stories passing QA on first attempt',
    formula: '(Stories with 0 rejections ÷ Total stories) × 100',
    inputs: [
      { id: 'passedFirstTime', label: 'Stories Passed First Time', type: 'number', placeholder: 'e.g., 18', min: 0 },
      { id: 'totalStories', label: 'Total Stories Tested', type: 'number', placeholder: 'e.g., 24', min: 1 }
    ],
    calculate: (inputs) => inputs.totalStories > 0 ? (inputs.passedFirstTime / inputs.totalStories) * 100 : 0,
    unit: '%',
    target: '>75%'
  },
  {
    id: 'blocked-time',
    name: 'Blocked Time',
    category: 'agile',
    description: 'Hours tickets spend blocked per sprint',
    formula: 'Sum(unblock_time - block_time)',
    inputs: [
      { id: 'blockedHours', label: 'Total Blocked Hours', type: 'number', placeholder: 'e.g., 12', min: 0 }
    ],
    calculate: (inputs) => inputs.blockedHours || 0,
    unit: 'hrs',
    target: '<15 hours/sprint',
    lowerIsBetter: true
  },
  {
    id: 'automation-coverage',
    name: 'Test Automation Coverage',
    category: 'agile',
    description: 'Percentage of test cases automated',
    formula: '(Automated_tests ÷ Total_tests) × 100',
    inputs: [
      { id: 'automatedTests', label: 'Automated Test Cases', type: 'number', placeholder: 'e.g., 350', min: 0 },
      { id: 'totalTests', label: 'Total Test Cases', type: 'number', placeholder: 'e.g., 500', min: 1 }
    ],
    calculate: (inputs) => inputs.totalTests > 0 ? (inputs.automatedTests / inputs.totalTests) * 100 : 0,
    unit: '%',
    target: '>70% regression, >50% overall'
  },
  {
    id: 'automation-roi',
    name: 'Automation ROI',
    category: 'agile',
    description: 'Return on investment for test automation',
    formula: '(Time_saved - Time_invested) ÷ Time_invested × 100',
    inputs: [
      { id: 'timeSaved', label: 'Time Saved (hours)', type: 'number', placeholder: 'e.g., 200', min: 0 },
      { id: 'timeInvested', label: 'Time Invested (hours)', type: 'number', placeholder: 'e.g., 50', min: 1 }
    ],
    calculate: (inputs) => inputs.timeInvested > 0 ? ((inputs.timeSaved - inputs.timeInvested) / inputs.timeInvested) * 100 : 0,
    unit: '%',
    target: '>200%'
  },
  {
    id: 'sizing-accuracy',
    name: 'Sizing Accuracy',
    category: 'agile',
    description: 'How accurately the team estimates story points',
    formula: 'Actual_points ÷ Estimated_points (1.0 = perfect)',
    inputs: [
      { id: 'actualPoints', label: 'Actual Story Points Completed', type: 'number', placeholder: 'e.g., 42', min: 0 },
      { id: 'estimatedPoints', label: 'Estimated Story Points', type: 'number', placeholder: 'e.g., 45', min: 1 }
    ],
    calculate: (inputs) => inputs.estimatedPoints > 0 ? inputs.actualPoints / inputs.estimatedPoints : 0,
    unit: 'x',
    target: '0.9-1.1x (±10%)'
  },

  // Reliability Metrics
  {
    id: 'change-failure-rate',
    name: 'Change Failure Rate',
    category: 'reliability',
    description: 'Deployments causing failures/rollbacks (DORA metric)',
    formula: '(Failed_deploys ÷ Total_deploys) × 100',
    inputs: [
      { id: 'failedDeploys', label: 'Failed Deployments', type: 'number', placeholder: 'e.g., 2', min: 0 },
      { id: 'totalDeploys', label: 'Total Deployments', type: 'number', placeholder: 'e.g., 25', min: 1 }
    ],
    calculate: (inputs) => inputs.totalDeploys > 0 ? (inputs.failedDeploys / inputs.totalDeploys) * 100 : 0,
    unit: '%',
    target: '<5% elite, <15% high',
    lowerIsBetter: true
  },
  {
    id: 'mtbf',
    name: 'Mean Time Between Failures',
    category: 'reliability',
    description: 'Average time system operates without failure',
    formula: 'Total_operational_hours ÷ Failures',
    inputs: [
      { id: 'operationalHours', label: 'Total Operational Hours', type: 'number', placeholder: 'e.g., 720', min: 0 },
      { id: 'failures', label: 'Number of Failures', type: 'number', placeholder: 'e.g., 3', min: 1 }
    ],
    calculate: (inputs) => inputs.failures > 0 ? inputs.operationalHours / inputs.failures : inputs.operationalHours,
    unit: 'hours',
    target: '>100 hours'
  },
  {
    id: 'availability',
    name: 'System Availability',
    category: 'reliability',
    description: 'Percentage of time system is operational',
    formula: '(Total_time - Downtime) ÷ Total_time × 100',
    inputs: [
      { id: 'totalTime', label: 'Total Time (hours)', type: 'number', placeholder: 'e.g., 720', min: 1 },
      { id: 'downtime', label: 'Downtime (hours)', type: 'number', placeholder: 'e.g., 2', min: 0 }
    ],
    calculate: (inputs) => inputs.totalTime > 0 ? ((inputs.totalTime - inputs.downtime) / inputs.totalTime) * 100 : 0,
    unit: '%',
    target: '>99.9% (three nines)'
  },
  {
    id: 'infra-failures',
    name: 'Infrastructure Failures',
    category: 'reliability',
    description: 'Test failures from infrastructure issues',
    formula: 'Count of infra-caused test failures',
    inputs: [
      { id: 'infraFailures', label: 'Infrastructure Failure Count', type: 'number', placeholder: 'e.g., 3', min: 0 }
    ],
    calculate: (inputs) => inputs.infraFailures || 0,
    unit: 'count',
    target: '<5 per sprint',
    lowerIsBetter: true
  }
];

const CATEGORY_INFO = {
  quality: { name: 'Quality & Reliability', icon: '✅', color: 'from-emerald-500 to-green-600' },
  speed: { name: 'Speed & Efficiency', icon: '⚡', color: 'from-cyan-500 to-blue-600' },
  agile: { name: 'Agile & Process', icon: '🔄', color: 'from-violet-500 to-purple-600' },
  reliability: { name: 'Reliability & Stability', icon: '🛡️', color: 'from-amber-500 to-orange-600' }
};

// Quality level definitions for random data generation
type QualityLevel = 'excellent' | 'good' | 'average' | 'bad' | 'horrible';

const generateRandomMetrics = (level: QualityLevel): Record<string, Record<string, number>> => {
  const ranges: Record<QualityLevel, Record<string, [number, number]>> = {
    excellent: {
      'test-coverage': [99, 100],
      'flakiness-rate': [0, 0.1],
      'defect-density': [0, 0.05],
      'defect-escape-rate': [0, 0.5],
      'code-quality-score': [98, 100],
      'build-time': [3, 5],
      'test-execution-time': [10, 15],
      'deployment-frequency': [20, 30],
      'lead-time': [0.1, 0.5],
      'mttr': [0.1, 0.5],
      'parallel-efficiency': [95, 100],
      'sprint-velocity': [70, 100],
      'sprint-commitment': [95, 100],
      'sprint-carryover': [0, 2],
      'first-time-pass': [95, 100],
      'blocked-time': [0, 1],
      'automation-coverage': [95, 100],
      'automation-roi': [500, 1000],
      'change-failure-rate': [0, 1],
      'mtbf': [1000, 5000],
      'availability': [99.99, 99.999],
      'infra-failures': [0, 0]
    },
    good: {
      'test-coverage': [75, 89],
      'flakiness-rate': [1, 2],
      'defect-density': [0.2, 0.5],
      'defect-escape-rate': [2, 5],
      'code-quality-score': [80, 89],
      'build-time': [8, 12],
      'test-execution-time': [25, 35],
      'deployment-frequency': [5, 10],
      'lead-time': [1, 3],
      'mttr': [1, 4],
      'parallel-efficiency': [75, 85],
      'sprint-velocity': [35, 50],
      'sprint-commitment': [80, 90],
      'sprint-carryover': [5, 10],
      'first-time-pass': [75, 85],
      'blocked-time': [5, 15],
      'automation-coverage': [60, 80],
      'automation-roi': [150, 300],
      'change-failure-rate': [3, 8],
      'mtbf': [200, 500],
      'availability': [99.5, 99.9],
      'infra-failures': [2, 5]
    },
    average: {
      'test-coverage': [60, 74],
      'flakiness-rate': [2, 4],
      'defect-density': [0.5, 1],
      'defect-escape-rate': [5, 10],
      'code-quality-score': [70, 79],
      'build-time': [12, 18],
      'test-execution-time': [35, 50],
      'deployment-frequency': [2, 5],
      'lead-time': [3, 7],
      'mttr': [4, 12],
      'parallel-efficiency': [60, 75],
      'sprint-velocity': [20, 35],
      'sprint-commitment': [70, 80],
      'sprint-carryover': [10, 20],
      'first-time-pass': [60, 75],
      'blocked-time': [15, 30],
      'automation-coverage': [40, 60],
      'automation-roi': [50, 150],
      'change-failure-rate': [8, 15],
      'mtbf': [50, 200],
      'availability': [99, 99.5],
      'infra-failures': [5, 10]
    },
    bad: {
      'test-coverage': [40, 59],
      'flakiness-rate': [4, 8],
      'defect-density': [1, 2],
      'defect-escape-rate': [10, 20],
      'code-quality-score': [50, 69],
      'build-time': [18, 30],
      'test-execution-time': [50, 90],
      'deployment-frequency': [0.5, 2],
      'lead-time': [7, 14],
      'mttr': [12, 24],
      'parallel-efficiency': [40, 60],
      'sprint-velocity': [10, 20],
      'sprint-commitment': [50, 70],
      'sprint-carryover': [20, 40],
      'first-time-pass': [40, 60],
      'blocked-time': [30, 60],
      'automation-coverage': [20, 40],
      'automation-roi': [0, 50],
      'change-failure-rate': [15, 30],
      'mtbf': [10, 50],
      'availability': [98, 99],
      'infra-failures': [10, 20]
    },
    horrible: {
      'test-coverage': [0, 39],
      'flakiness-rate': [8, 20],
      'defect-density': [2, 5],
      'defect-escape-rate': [20, 50],
      'code-quality-score': [0, 49],
      'build-time': [30, 60],
      'test-execution-time': [90, 180],
      'deployment-frequency': [0, 0.5],
      'lead-time': [14, 30],
      'mttr': [24, 72],
      'parallel-efficiency': [20, 40],
      'sprint-velocity': [0, 10],
      'sprint-commitment': [0, 50],
      'sprint-carryover': [40, 80],
      'first-time-pass': [0, 40],
      'blocked-time': [60, 120],
      'automation-coverage': [0, 20],
      'automation-roi': [-100, 0],
      'change-failure-rate': [30, 50],
      'mtbf': [0, 10],
      'availability': [95, 98],
      'infra-failures': [20, 50]
    }
  };

  const result: Record<string, Record<string, number>> = {};
  const metricRanges = ranges[level];

  METRICS.forEach(metric => {
    const [min, max] = metricRanges[metric.id] || [0, 100];
    const targetValue = Math.random() * (max - min) + min;
    
    // Generate inputs based on the metric's formula to achieve the target value
    const inputs: Record<string, number> = {};
    
    // Handle specific metrics with known formulas
    if (metric.id === 'test-coverage') {
      // (Lines executed ÷ Total LOC) × 100 = targetValue
      inputs['totalLOC'] = 10000;
      inputs['linesExecuted'] = (targetValue / 100) * 10000;
    } else if (metric.id === 'flakiness-rate') {
      // (Flaky runs ÷ Total runs) × 100 = targetValue
      inputs['totalRuns'] = 500;
      inputs['flakyRuns'] = (targetValue / 100) * 500;
    } else if (metric.id === 'defect-density') {
      // (Total bugs ÷ Lines of code) × 1000 = targetValue
      inputs['linesOfCode'] = 50;
      inputs['totalBugs'] = (targetValue * 50) / 1000;
    } else if (metric.id === 'defect-escape-rate') {
      // (Production bugs ÷ Total bugs) × 100 = targetValue
      inputs['totalBugs'] = 50;
      inputs['productionBugs'] = (targetValue / 100) * 50;
    } else if (metric.id === 'code-quality-score') {
      // Weighted avg = targetValue
      inputs['maintainability'] = targetValue;
      inputs['reliability'] = targetValue;
      inputs['security'] = targetValue;
    } else if (metric.id === 'build-time') {
      // Average = targetValue
      inputs['buildCount'] = 30;
      inputs['totalBuildTime'] = targetValue * 30;
    } else if (metric.id === 'test-execution-time') {
      inputs['executionTime'] = targetValue;
    } else if (metric.id === 'deployment-frequency') {
      // Deploys ÷ Weeks = targetValue
      inputs['weeks'] = 2;
      inputs['successfulDeploys'] = targetValue * 2;
    } else if (metric.id === 'lead-time') {
      inputs['leadTimeDays'] = targetValue;
    } else if (metric.id === 'mttr') {
      // Total repair time ÷ Incident count = targetValue
      inputs['incidentCount'] = 5;
      inputs['totalRepairTime'] = targetValue * 5;
    } else if (metric.id === 'parallel-efficiency') {
      // (Sequential ÷ Parallel) ÷ Workers × 100 = targetValue
      inputs['workers'] = 4;
      inputs['parallelTime'] = 35;
      inputs['sequentialTime'] = (targetValue / 100) * 35 * 4;
    } else if (metric.id === 'sprint-velocity') {
      inputs['completedPoints'] = targetValue;
    } else if (metric.id === 'sprint-commitment') {
      // Completed ÷ Committed × 100 = targetValue
      inputs['committedPoints'] = 45;
      inputs['completedPoints'] = (targetValue / 100) * 45;
    } else if (metric.id === 'sprint-carryover') {
      // Incomplete ÷ Committed × 100 = targetValue
      inputs['committedPoints'] = 45;
      inputs['incompletePoints'] = (targetValue / 100) * 45;
    } else if (metric.id === 'first-time-pass') {
      // Passed first time ÷ Total stories × 100 = targetValue
      inputs['totalStories'] = 24;
      inputs['passedFirstTime'] = (targetValue / 100) * 24;
    } else if (metric.id === 'blocked-time') {
      inputs['blockedHours'] = targetValue;
    } else if (metric.id === 'automation-coverage') {
      // Automated ÷ Total × 100 = targetValue
      inputs['totalTests'] = 500;
      inputs['automatedTests'] = (targetValue / 100) * 500;
    } else if (metric.id === 'automation-roi') {
      // (Saved - Invested) ÷ Invested × 100 = targetValue
      inputs['timeInvested'] = 50;
      inputs['timeSaved'] = ((targetValue / 100) * 50) + 50;
    } else if (metric.id === 'change-failure-rate') {
      // Failed ÷ Total × 100 = targetValue
      inputs['totalDeploys'] = 25;
      inputs['failedDeploys'] = (targetValue / 100) * 25;
    } else if (metric.id === 'mtbf') {
      // Operational hours ÷ Failures = targetValue
      inputs['failures'] = 3;
      inputs['operationalHours'] = targetValue * 3;
    } else if (metric.id === 'availability') {
      // (Total - Downtime) ÷ Total × 100 = targetValue
      inputs['totalTime'] = 720;
      inputs['downtime'] = 720 - ((targetValue / 100) * 720);
    } else if (metric.id === 'infra-failures') {
      inputs['infraFailures'] = Math.round(targetValue);
    } else {
      // Fallback for unknown metrics
      metric.inputs.forEach((input) => {
        inputs[input.id] = targetValue;
      });
    }
    
    result[metric.id] = inputs;
  });

  return result;
};

const generateRandomDeveloperMetrics = (level: QualityLevel): DeveloperMetricsInput => {
  const ranges: Record<QualityLevel, Record<string, [number, number]>> = {
    excellent: {
      prMergeTimeAvg: [2, 4],
      codeReviewTimeAvg: [0.5, 1.5],
      focusTimeHours: [6, 8],
      meetingTimeHours: [0.5, 1.5],
      contextSwitchesPerDay: [1, 3]
    },
    good: {
      prMergeTimeAvg: [4, 8],
      codeReviewTimeAvg: [1.5, 3],
      focusTimeHours: [5, 6],
      meetingTimeHours: [1.5, 2.5],
      contextSwitchesPerDay: [3, 5]
    },
    average: {
      prMergeTimeAvg: [8, 16],
      codeReviewTimeAvg: [3, 6],
      focusTimeHours: [4, 5],
      meetingTimeHours: [2.5, 4],
      contextSwitchesPerDay: [5, 8]
    },
    bad: {
      prMergeTimeAvg: [16, 24],
      codeReviewTimeAvg: [6, 12],
      focusTimeHours: [2, 4],
      meetingTimeHours: [4, 6],
      contextSwitchesPerDay: [8, 12]
    },
    horrible: {
      prMergeTimeAvg: [24, 48],
      codeReviewTimeAvg: [12, 24],
      focusTimeHours: [0, 2],
      meetingTimeHours: [6, 8],
      contextSwitchesPerDay: [12, 20]
    }
  };

  const ranges_data = ranges[level];
  const result: DeveloperMetricsInput = {
    prMergeTimeAvg: Math.random() * (ranges_data.prMergeTimeAvg[1] - ranges_data.prMergeTimeAvg[0]) + ranges_data.prMergeTimeAvg[0],
    codeReviewTimeAvg: Math.random() * (ranges_data.codeReviewTimeAvg[1] - ranges_data.codeReviewTimeAvg[0]) + ranges_data.codeReviewTimeAvg[0],
    focusTimeHours: Math.random() * (ranges_data.focusTimeHours[1] - ranges_data.focusTimeHours[0]) + ranges_data.focusTimeHours[0],
    meetingTimeHours: Math.random() * (ranges_data.meetingTimeHours[1] - ranges_data.meetingTimeHours[0]) + ranges_data.meetingTimeHours[0],
    contextSwitchesPerDay: Math.floor(Math.random() * (ranges_data.contextSwitchesPerDay[1] - ranges_data.contextSwitchesPerDay[0]) + ranges_data.contextSwitchesPerDay[0])
  };

  return result;
};

const ManualMetricsInput: React.FC<ManualMetricsInputProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const metricRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const topRef = useRef<HTMLDivElement>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['quality']));
  const [metricInputs, setMetricInputs] = useState<Record<string, Record<string, number>>>({});
  const [calculatedValues, setCalculatedValues] = useState<Record<string, number>>({});
  const [existingMetrics, setExistingMetrics] = useState<ExistingMetrics | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  
  // Developer metrics state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [developerMetrics, setDeveloperMetrics] = useState<Record<string, DeveloperMetricsInput>>({});
  const [developerCalculated, setDeveloperCalculated] = useState<Record<string, { happinessScore: number; burnoutRisk: 'low' | 'moderate' | 'high' }>>({});
  const [expandedDevelopers, setExpandedDevelopers] = useState<boolean>(true);
  const [savingDeveloperMetrics, setSavingDeveloperMetrics] = useState(false);

  // Technical debt state
  const [technicalDebtItems, setTechnicalDebtItems] = useState<TechnicalDebtItem[]>([]);
  const [expandedTechnicalDebt, setExpandedTechnicalDebt] = useState<boolean>(true);
  const [savingTechnicalDebt, setSavingTechnicalDebt] = useState(false);
  const [financialConfig, setFinancialConfig] = useState<Record<string, number>>({
    developer_hourly_rate: 75,
    support_ticket_cost: 25,
    revenue_per_user_monthly: 50,
    downtime_cost_per_minute: 100,
    sla_breach_penalty: 1000
  });

  // Pipeline stages state
  const [pipelineStages, setPipelineStages] = useState<PipelineStageItem[]>([]);
  const [expandedPipeline, setExpandedPipeline] = useState<boolean>(true);
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [pipelineConfig, setPipelineConfig] = useState({
    time_savings_percent: 30,
    cost_savings_percent: 25,
    cost_per_minute: 0.50
  });
  const [savingPipelineConfig, setSavingPipelineConfig] = useState(false);

  // All metrics viewer state
  const [showMetricsViewer, setShowMetricsViewer] = useState(false);
  const [allMetricsData, setAllMetricsData] = useState<any>(null);
  const [loadingAllMetrics, setLoadingAllMetrics] = useState(false);

  // Business impact configuration state
  const [businessImpactConfig, setBusinessImpactConfig] = useState<{
    impactConfigs: Array<{
      metric_name: string;
      quality_score: string;
      revenue_impact: string;
      customer_satisfaction: string;
      correlation_strength: string;
    }>;
    historicalConfigs: Array<{
      month_year: string;
      quality_score: string;
      revenue_impact: string;
      customer_satisfaction: string;
      churn_rate: string;
    }>;
  }>({
    impactConfigs: [],
    historicalConfigs: []
  });
  const [loadingBusinessImpact, setLoadingBusinessImpact] = useState(false);
  const [savingBusinessImpact, setSavingBusinessImpact] = useState(false);

  // Check if user has access (super_admin, manager, or team_lead)
  const allowedRoles = ['super_admin', 'manager', 'team_lead'];
  if (!user || !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen bg-slate-900 p-8 flex items-center justify-center">
        <div className="bg-slate-800 rounded-xl p-8 text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400">This page is only accessible to Super Admins, Managers, and Team Leads.</p>
          <button
            onClick={onBack}
            className="mt-6 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  useEffect(() => {
    fetchTeams();
  }, []);

  // Fetch existing metrics when team changes
  useEffect(() => {
    if (selectedTeamId) {
      fetchExistingMetrics(selectedTeamId);
      fetchTechnicalDebt(selectedTeamId);
    }
    // Fetch pipeline stages for team
    fetchPipelineStages(selectedTeamId);
  }, [selectedTeamId]);

  const fetchTeams = async () => {
    try {
      const response = await fetch(`${API_URL}/teams`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        let filteredTeams = data.teams || [];
        
        // Filter teams based on user role
        if (user?.role === 'qa_manager') {
          // Manager: only teams in their department
          filteredTeams = filteredTeams.filter((t: Team) => 
            t.department_id === user.departmentId
          );
        } else if (user?.role === 'team_lead') {
          // Team Lead: only their own team
          filteredTeams = filteredTeams.filter((t: Team) => 
            t.id === user.primaryTeamId ||
            user.assignedTeams?.includes(t.id)
          );
        }
        // super_admin sees all teams (no filter)
        
        setTeams(filteredTeams);
        if (filteredTeams.length > 0) {
          setSelectedTeamId(filteredTeams[0].id);
        }
      }
    } catch (error) {
      console.error('Error fetching teams:', error);
      toast.error('Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const fetchExistingMetrics = async (teamId: string) => {
    setLoadingMetrics(true);
    try {
      const response = await fetch(`${API_URL}/teams/${teamId}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        const team = data.team;
        if (team?.kpiData) {
          setExistingMetrics({
            qaScore: team.qaScore,
            snapshotDate: team.kpiData.snapshotDate,
            ...team.kpiData
          });
        } else {
          setExistingMetrics(null);
        }
        
        // Also fetch team members
        if (team?.members) {
          setTeamMembers(team.members);
          // Initialize developer metrics for each member
          const initialMetrics: Record<string, DeveloperMetricsInput> = {};
          team.members.forEach((member: TeamMember) => {
            initialMetrics[member.id] = {
              prMergeTimeAvg: 0,
              codeReviewTimeAvg: 0,
              focusTimeHours: 0,
              meetingTimeHours: 0,
              contextSwitchesPerDay: 0
            };
          });
          setDeveloperMetrics(initialMetrics);
          setDeveloperCalculated({});
        }
      }
    } catch (error) {
      console.error('Error fetching existing metrics:', error);
      setExistingMetrics(null);
    } finally {
      setLoadingMetrics(false);
    }
  };

  // Fetch technical debt items for the team
  const fetchTechnicalDebt = async (teamId: string) => {
    try {
      const response = await fetch(`${API_URL}/analytics/technical-debt?teamId=${teamId}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setTechnicalDebtItems(data.debts || []);
        if (data.financial_config) {
          setFinancialConfig(data.financial_config);
        }
      }
    } catch (error) {
      console.error('Error fetching technical debt:', error);
    }
  };

  // Fetch pipeline stages for team
  const fetchPipelineStages = async (teamId?: string) => {
    try {
      const url = teamId 
        ? `${API_URL}/analytics/pipeline-stages?teamId=${teamId}`
        : `${API_URL}/analytics/pipeline-stages`;
      const response = await fetch(url, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        const stages = (data.stages || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          stage_order: s.stage_order || 0,
          duration: s.duration || 0,
          success_rate: s.success_rate || 100,
          cpu_usage: s.resource_usage?.cpu || 0,
          memory_usage: s.resource_usage?.memory || 0,
          cost_per_run: s.resource_usage?.cost || 0,
          bottleneck_score: s.bottleneck_score || 0
        }));
        setPipelineStages(stages);
        
        // Also get config from response
        if (data.config) {
          setPipelineConfig({
            time_savings_percent: data.config.time_savings_percent || 30,
            cost_savings_percent: data.config.cost_savings_percent || 25,
            cost_per_minute: data.config.cost_per_minute || 0.50
          });
        }
      }
    } catch (error) {
      console.error('Error fetching pipeline stages:', error);
    }
  };

  // Save pipeline config
  const handleSavePipelineConfig = async () => {
    setSavingPipelineConfig(true);
    try {
      const response = await fetch(`${API_URL}/analytics/pipeline-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(pipelineConfig)
      });

      if (response.ok) {
        toast.success('Pipeline configuration saved!');
      } else {
        toast.error('Failed to save pipeline configuration');
      }
    } catch (error) {
      console.error('Error saving pipeline config:', error);
      toast.error('Failed to save pipeline configuration');
    } finally {
      setSavingPipelineConfig(false);
    }
  };

  // Handle pipeline stage change
  const handlePipelineChange = (stageId: string, field: string, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;
    
    setPipelineStages(prev => prev.map(stage => {
      if (stage.id !== stageId) return stage;
      return { ...stage, [field]: numValue };
    }));
  };

  // Save pipeline stage metrics
  const handleSavePipeline = async () => {
    if (pipelineStages.length === 0) {
      toast.error('No pipeline stages to save');
      return;
    }

    setSavingPipeline(true);
    try {
      const promises = pipelineStages.map(stage => 
        fetch(`${API_URL}/analytics/pipeline-stages/${stage.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            team_id: selectedTeamId || null,
            duration: stage.duration,
            success_rate: stage.success_rate,
            cpu_usage: stage.cpu_usage,
            memory_usage: stage.memory_usage,
            cost_per_run: stage.cost_per_run
          })
        })
      );

      await Promise.all(promises);
      toast.success('Pipeline stages saved successfully!');
      
      // Refresh to get recalculated bottleneck scores
      fetchPipelineStages(selectedTeamId);
    } catch (error) {
      console.error('Error saving pipeline stages:', error);
      toast.error('Failed to save pipeline stages');
    } finally {
      setSavingPipeline(false);
    }
  };

  // Fetch all metrics for the team (primary + composite)
  const fetchAllMetrics = async () => {
    if (!selectedTeamId) {
      toast.error('Please select a team first');
      return;
    }

    setLoadingAllMetrics(true);
    try {
      const response = await fetch(`${API_URL}/metrics/team/${selectedTeamId}/all`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setAllMetricsData(data);
        setShowMetricsViewer(true);
      } else {
        toast.error('Failed to fetch metrics');
      }
    } catch (error) {
      console.error('Error fetching all metrics:', error);
      toast.error('Failed to fetch metrics');
    } finally {
      setLoadingAllMetrics(false);
    }
  };

  // Fetch business impact configuration
  const fetchBusinessImpactConfig = async () => {
    if (!selectedTeamId) {
      toast.error('Please select a team first');
      return;
    }

    setLoadingBusinessImpact(true);
    try {
      const response = await fetch(`${API_URL}/metrics/business-impact-config/${selectedTeamId}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();

        // Initialize with default months if no historical data
        const defaultMonths = Array.from({ length: 12 }, (_, i) => {
          const date = new Date();
          date.setMonth(date.getMonth() - (11 - i));
          return {
            month_year: date.toISOString().slice(0, 7), // YYYY-MM format
            quality_score: '',
            revenue_impact: '',
            customer_satisfaction: '',
            churn_rate: ''
          };
        });

        // Merge existing data with defaults
        const mergedHistorical = defaultMonths.map(defaultMonth => {
          const existing = data.historicalConfigs?.find((h: any) => h.month_year === defaultMonth.month_year);
          return existing || defaultMonth;
        });

        setBusinessImpactConfig({
          impactConfigs: data.impactConfigs || [],
          historicalConfigs: mergedHistorical
        });

        toast.success('Configuration loaded successfully');
      } else {
        // Initialize with empty defaults
        const defaultMonths = Array.from({ length: 12 }, (_, i) => {
          const date = new Date();
          date.setMonth(date.getMonth() - (11 - i));
          return {
            month_year: date.toISOString().slice(0, 7),
            quality_score: '',
            revenue_impact: '',
            customer_satisfaction: '',
            churn_rate: ''
          };
        });

        setBusinessImpactConfig({
          impactConfigs: [],
          historicalConfigs: defaultMonths
        });
      }
    } catch (error) {
      console.error('Error fetching business impact config:', error);
      toast.error('Failed to load configuration');
    } finally {
      setLoadingBusinessImpact(false);
    }
  };

  // Update business impact metric
  const updateBusinessImpactMetric = (metricName: string, field: string, value: string) => {
    setBusinessImpactConfig(prev => {
      const existingIndex = prev.impactConfigs.findIndex(c => c.metric_name === metricName);
      const updatedConfigs = [...prev.impactConfigs];

      if (existingIndex >= 0) {
        updatedConfigs[existingIndex] = {
          ...updatedConfigs[existingIndex],
          [field]: value
        };
      } else {
        updatedConfigs.push({
          metric_name: metricName,
          quality_score: field === 'quality_score' ? value : '',
          revenue_impact: field === 'revenue_impact' ? value : '',
          customer_satisfaction: field === 'customer_satisfaction' ? value : '',
          correlation_strength: field === 'correlation_strength' ? value : ''
        });
      }

      return {
        ...prev,
        impactConfigs: updatedConfigs
      };
    });
  };

  // Update historical metric
  const updateHistoricalMetric = (monthYear: string, field: string, value: string) => {
    setBusinessImpactConfig(prev => ({
      ...prev,
      historicalConfigs: prev.historicalConfigs.map(month =>
        month.month_year === monthYear
          ? { ...month, [field]: value }
          : month
      )
    }));
  };

  // Save business impact configuration
  const saveBusinessImpactConfig = async () => {
    if (!selectedTeamId) {
      toast.error('Please select a team first');
      return;
    }

    setSavingBusinessImpact(true);
    try {
      // Filter out empty configurations
      const filteredImpactConfigs = businessImpactConfig.impactConfigs.filter(config =>
        config.quality_score || config.revenue_impact || config.customer_satisfaction || config.correlation_strength
      );

      const filteredHistoricalConfigs = businessImpactConfig.historicalConfigs.filter(config =>
        config.quality_score || config.revenue_impact || config.customer_satisfaction || config.churn_rate
      );

      const response = await fetch(`${API_URL}/metrics/business-impact-config/${selectedTeamId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          impactConfigs: filteredImpactConfigs,
          historicalConfigs: filteredHistoricalConfigs
        })
      });

      if (response.ok) {
        toast.success('Business impact configuration saved successfully!');
      } else {
        toast.error('Failed to save configuration');
      }
    } catch (error) {
      console.error('Error saving business impact config:', error);
      toast.error('Failed to save configuration');
    } finally {
      setSavingBusinessImpact(false);
    }
  };

  // Calculate ROI for a debt item based on current financial config
  const calculateDebtROI = (item: TechnicalDebtItem, config: Record<string, number>): TechnicalDebtItem => {
    const effortHours = item.estimated_effort_hours || 0;
    const investmentCost = effortHours * (config.developer_hourly_rate || 75);
    
    // Calculate monthly cost of delay
    const supportCost = (item.support_tickets_monthly || 0) * (config.support_ticket_cost || 25);
    const downtimeCost = (item.downtime_minutes_monthly || 0) * (config.downtime_cost_per_minute || 100);
    const revenueLoss = (item.affected_users || 0) * (config.revenue_per_user_monthly || 50) * ((item.revenue_impact_percent || 0) / 100);
    const slaPenalties = (item.sla_breaches_monthly || 0) * (config.sla_breach_penalty || 1000);
    
    const monthlyCostOfDelay = supportCost + downtimeCost + revenueLoss + slaPenalties;
    const annualSavings = monthlyCostOfDelay * 12;
    
    // Calculate ROI percentage
    const roiPercentage = investmentCost > 0 
      ? Math.round(((annualSavings - investmentCost) / investmentCost) * 100)
      : 0;
    
    // Calculate payback period in months
    const paybackMonths = monthlyCostOfDelay > 0 
      ? Math.round((investmentCost / monthlyCostOfDelay) * 10) / 10
      : 0;
    
    return {
      ...item,
      investment_cost: Math.round(investmentCost),
      monthly_cost_of_delay: Math.round(monthlyCostOfDelay),
      annual_savings: Math.round(annualSavings),
      roi_percentage: roiPercentage,
      payback_months: paybackMonths
    };
  };

  // Handle technical debt impact change - recalculate ROI in real-time
  const handleDebtImpactChange = (debtId: string, field: string, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;
    
    setTechnicalDebtItems(prev => prev.map(item => {
      if (item.id !== debtId) return item;
      const updatedItem = { ...item, [field]: numValue };
      return calculateDebtROI(updatedItem, financialConfig);
    }));
  };

  // Save technical debt impact metrics
  const handleSaveTechnicalDebt = async () => {
    if (!selectedTeamId || technicalDebtItems.length === 0) {
      toast.error('No technical debt items to save');
      return;
    }

    setSavingTechnicalDebt(true);
    try {
      // Save each debt item's impact metrics
      const promises = technicalDebtItems.map(item => 
        fetch(`${API_URL}/analytics/technical-debt/${item.id}/impact`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            affected_users: item.affected_users,
            support_tickets_monthly: item.support_tickets_monthly,
            downtime_minutes_monthly: item.downtime_minutes_monthly,
            revenue_impact_percent: item.revenue_impact_percent,
            sla_breaches_monthly: item.sla_breaches_monthly,
            estimated_effort_hours: item.estimated_effort_hours
          })
        })
      );

      await Promise.all(promises);

      Swal.fire({
        icon: 'success',
        title: 'Technical Debt Impact Saved',
        text: `Updated impact metrics for ${technicalDebtItems.length} debt items`,
        confirmButtonColor: '#3b82f6',
      });

      // Emit event to notify TechnicalDebtTracker to refresh
      window.dispatchEvent(new CustomEvent('technical-debt-updated'));

      // Refresh to get updated ROI calculations from server
      fetchTechnicalDebt(selectedTeamId);
    } catch (error) {
      console.error('Error saving technical debt:', error);
      toast.error('Failed to save technical debt impact');
    } finally {
      setSavingTechnicalDebt(false);
    }
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const scrollToMetric = (metricId: string) => {
    const metric = METRICS.find(m => m.id === metricId);
    if (metric) {
      // Expand the category if not already expanded
      if (!expandedCategories.has(metric.category)) {
        setExpandedCategories(prev => new Set([...prev, metric.category]));
      }
      // Wait for DOM update then scroll
      setTimeout(() => {
        const element = metricRefs.current[metricId];
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Add highlight effect
          element.classList.add('ring-2', 'ring-cyan-400');
          setTimeout(() => {
            element.classList.remove('ring-2', 'ring-cyan-400');
          }, 2000);
        }
      }, 100);
    }
  };

  const scrollToTop = () => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Handle developer metrics input change
  const handleDeveloperMetricChange = (developerId: string, field: keyof DeveloperMetricsInput, value: string) => {
    // Allow 0 as valid input
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;
    
    setDeveloperMetrics(prev => {
      const updated = {
        ...prev,
        [developerId]: {
          ...prev[developerId],
          [field]: numValue
        }
      };
      
      // Calculate happiness score and burnout risk
      const metrics = updated[developerId];
      if (metrics.focusTimeHours > 0 || metrics.meetingTimeHours > 0) {
        const happinessScore = calculateHappinessScore(metrics);
        const burnoutRisk = calculateBurnoutRisk(metrics, happinessScore);
        
        setDeveloperCalculated(prevCalc => ({
          ...prevCalc,
          [developerId]: { happinessScore, burnoutRisk }
        }));
      }
      
      return updated;
    });
  };

  // Save developer metrics
  const handleSaveDeveloperMetrics = async () => {
    if (!selectedTeamId) {
      Swal.fire({
        icon: 'warning',
        title: 'No Team Selected',
        text: 'Please select a team first',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    const metricsToSave = Object.entries(developerMetrics).filter(([_, metrics]) => 
      metrics.focusTimeHours > 0 || metrics.meetingTimeHours > 0 || metrics.prMergeTimeAvg > 0 || metrics.contextSwitchesPerDay > 0
    );

    if (metricsToSave.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'No Developer Metrics',
        text: 'Please enter metrics for at least one developer',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    setSavingDeveloperMetrics(true);

    try {
      for (const [developerId, metrics] of metricsToSave) {
        const happinessScore = calculateHappinessScore(metrics);
        
        const response = await fetch(`${API_URL}/metrics/developer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            teamId: selectedTeamId,
            developerId,
            prMergeTimeAvg: metrics.prMergeTimeAvg,
            codeReviewTimeAvg: metrics.codeReviewTimeAvg,
            focusTimeHours: metrics.focusTimeHours,
            meetingTimeHours: metrics.meetingTimeHours,
            contextSwitchesPerDay: metrics.contextSwitchesPerDay,
            happinessScore
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to save developer metrics');
        }
      }

      Swal.fire({
        icon: 'success',
        title: 'Developer Metrics Saved',
        text: `Metrics saved for ${metricsToSave.length} developer(s)`,
        confirmButtonColor: '#3b82f6',
      });
    } catch (error) {
      console.error('Error saving developer metrics:', error);
      Swal.fire({
        icon: 'error',
        title: 'Failed to Save Developer Metrics',
        text: error instanceof Error ? error.message : 'Failed to save developer metrics',
        confirmButtonColor: '#3b82f6',
      });
    } finally {
      setSavingDeveloperMetrics(false);
    }
  };

  const handleInputChange = (metricId: string, inputId: string, value: string) => {
    // Allow 0 as valid input - only use 0 for empty/invalid strings
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;
    
    setMetricInputs(prev => ({
      ...prev,
      [metricId]: {
        ...prev[metricId],
        [inputId]: numValue
      }
    }));

    // Calculate the metric value
    const metric = METRICS.find(m => m.id === metricId);
    if (metric) {
      const inputs = {
        ...metricInputs[metricId],
        [inputId]: numValue
      };
      const calculated = metric.calculate(inputs);
      setCalculatedValues(prev => ({
        ...prev,
        [metricId]: calculated
      }));
    }
  };

  // Generate random team metrics
  const handleGenerateTeamMetrics = (level: QualityLevel) => {
    const randomMetrics = generateRandomMetrics(level);
    setMetricInputs(randomMetrics);
    
    // Calculate all values
    const calculated: Record<string, number> = {};
    METRICS.forEach(metric => {
      const inputs = randomMetrics[metric.id] || {};
      calculated[metric.id] = metric.calculate(inputs);
    });
    setCalculatedValues(calculated);
    
    toast.success(`Generated ${level} team metrics!`);
  };

  // Generate random developer metrics
  const handleGenerateDeveloperMetrics = (level: QualityLevel) => {
    const updated: Record<string, DeveloperMetricsInput> = {};
    const calculated: Record<string, { happinessScore: number; burnoutRisk: 'low' | 'moderate' | 'high' }> = {};
    
    teamMembers.forEach(member => {
      const metrics = generateRandomDeveloperMetrics(level);
      updated[member.id] = metrics;
      const happinessScore = calculateHappinessScore(metrics);
      const burnoutRisk = calculateBurnoutRisk(metrics, happinessScore);
      calculated[member.id] = { happinessScore, burnoutRisk };
    });
    
    setDeveloperMetrics(updated);
    setDeveloperCalculated(calculated);
    toast.success(`Generated ${level} developer metrics for all team members!`);
  };

  const handleSaveMetrics = async () => {
    if (!selectedTeamId) {
      Swal.fire({
        icon: 'warning',
        title: 'No Team Selected',
        text: 'Please select a team first',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    // Check if any metrics have been calculated
    if (Object.keys(calculatedValues).length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'No Metrics',
        text: 'Please enter at least one metric',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    setSaving(true);

    try {
      // Map calculated values to database column names
      const metricsPayload = {
        teamId: selectedTeamId,
        test_coverage: calculatedValues['test-coverage'],
        test_flakiness_rate: calculatedValues['flakiness-rate'],
        defect_density: calculatedValues['defect-density'],
        defect_escape_rate: calculatedValues['defect-escape-rate'],
        code_quality_score: calculatedValues['code-quality-score'],
        avg_build_time_minutes: calculatedValues['build-time'],
        test_execution_time_minutes: calculatedValues['test-execution-time'],
        deployment_frequency_per_week: calculatedValues['deployment-frequency'],
        lead_time_days: calculatedValues['lead-time'],
        mttr_hours: calculatedValues['mttr'],
        parallel_test_efficiency: calculatedValues['parallel-efficiency'],
        sprint_velocity: calculatedValues['sprint-velocity'],
        sprint_commitment_rate: calculatedValues['sprint-commitment'],
        sprint_carryover: calculatedValues['sprint-carryover'],
        first_time_pass_rate: calculatedValues['first-time-pass'],
        blocked_time_hours: calculatedValues['blocked-time'],
        automation_coverage: calculatedValues['automation-coverage'],
        automation_roi: calculatedValues['automation-roi'],
        change_failure_rate: calculatedValues['change-failure-rate'],
        mtbf_hours: calculatedValues['mtbf'],
        system_availability: calculatedValues['availability'],
        infrastructure_failures: calculatedValues['infra-failures'],
        sizing_accuracy: calculatedValues['sizing-accuracy']
      };

      const response = await fetch(`${API_URL}/metrics/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(metricsPayload)
      });

      if (response.ok) {
        const result = await response.json();
        const selectedTeam = teams.find(t => t.id === selectedTeamId);
        
        Swal.fire({
          icon: 'success',
          title: 'Team Metrics Saved',
          html: `<p><strong>${selectedTeam?.name || 'Team'}</strong> metrics saved successfully!</p><p>QA Score: <strong>${result.qaScore}/100</strong> (${result.status})</p>`,
          confirmButtonColor: '#3b82f6',
        });
        
        // Reset inputs after save and refresh existing metrics
        setMetricInputs({});
        setCalculatedValues({});
        // Refresh existing metrics to show the updated values
        fetchExistingMetrics(selectedTeamId);
      } else {
        const error = await response.json();
        Swal.fire({
          icon: 'error',
          title: 'Failed to Save Team Metrics',
          text: error.error || 'Unknown error occurred',
          confirmButtonColor: '#3b82f6',
        });
      }
    } catch (error) {
      console.error('Error saving metrics:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to save team metrics. Check console for details.',
        confirmButtonColor: '#3b82f6',
      });
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (metricId: string, value: number): string => {
    const metric = METRICS.find(m => m.id === metricId);
    if (!metric) return 'text-slate-400';

    // Parse target to determine good/bad thresholds
    const target = metric.target.toLowerCase();
    
    if (metric.lowerIsBetter) {
      // For metrics where lower is better
      if (target.includes('<')) {
        const threshold = parseFloat(target.match(/[\d.]+/)?.[0] || '0');
        if (value <= threshold) return 'text-emerald-400';
        if (value <= threshold * 1.5) return 'text-amber-400';
        return 'text-red-400';
      }
    } else {
      // For metrics where higher is better
      if (target.includes('>')) {
        const threshold = parseFloat(target.match(/[\d.]+/)?.[0] || '0');
        if (value >= threshold) return 'text-emerald-400';
        if (value >= threshold * 0.7) return 'text-amber-400';
        return 'text-red-400';
      }
    }
    
    return 'text-cyan-400';
  };

  const groupedMetrics = METRICS.reduce((acc, metric) => {
    if (!acc[metric.category]) acc[metric.category] = [];
    acc[metric.category].push(metric);
    return acc;
  }, {} as Record<string, MetricDefinition[]>);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 p-8 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-8 relative">
      <div ref={topRef} className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-400" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                <Calculator className="w-7 h-7 text-cyan-400" />
                Manual Metrics Input
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                Enter raw data to calculate and save team metrics manually
              </p>
            </div>
          </div>
          
          <button
            onClick={handleSaveMetrics}
            disabled={saving || Object.keys(calculatedValues).length === 0}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : 'Save All Metrics'}
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-slate-800/50 border border-cyan-500/30 rounded-xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-300">
            <p className="font-medium text-cyan-400 mb-1">Why Manual Input?</p>
            <p>While the aggregator is being set up, you can manually enter metrics data. 
            Enter the raw values for each formula, and the system will calculate and display the results on the dashboard automatically.</p>
          </div>
        </div>

        {/* Team Selector */}
        <div className="bg-slate-800 rounded-xl p-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">Select Team</label>
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          >
            <option value="">-- Select a team --</option>
            {teams.map(team => (
              <option key={team.id} value={team.id}>
                {team.name} {team.department ? `(${team.department})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Generate Team Metrics Buttons */}
        {selectedTeamId && (
          <div className="bg-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              Generate Team Metrics
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <button
                onClick={() => handleGenerateTeamMetrics('excellent')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
              >
                Excellent
              </button>
              <button
                onClick={() => handleGenerateTeamMetrics('good')}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium transition-colors"
              >
                Good
              </button>
              <button
                onClick={() => handleGenerateTeamMetrics('average')}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
              >
                Average
              </button>
              <button
                onClick={() => handleGenerateTeamMetrics('bad')}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
              >
                Bad
              </button>
              <button
                onClick={() => handleGenerateTeamMetrics('horrible')}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Horrible
              </button>
            </div>
          </div>
        )}

        {/* Existing Metrics History */}
        {selectedTeamId && (
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-purple-400" />
                Current Metrics for {teams.find(t => t.id === selectedTeamId)?.name}
              </h3>
              {existingMetrics?.snapshotDate && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Calendar className="w-4 h-4" />
                  Last updated: {new Date(existingMetrics.snapshotDate).toLocaleDateString()}
                </div>
              )}
            </div>
            
            {loadingMetrics ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
              </div>
            ) : existingMetrics ? (
              <>
                {/* QA Score Header */}
                {existingMetrics.qaScore !== undefined && (
                  <div className="mb-4 p-4 bg-slate-700/50 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-slate-300 font-medium">Overall QA Score</span>
                      <span className={`text-2xl font-bold ${
                        existingMetrics.qaScore >= 85 ? 'text-emerald-400' :
                        existingMetrics.qaScore >= 70 ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {existingMetrics.qaScore}/100
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 bg-slate-800/50 rounded px-3 py-2 font-mono">
                      <span className="text-cyan-400">Formula:</span> Test Coverage × 0.30 + (100 - Defect Escape Rate) × 0.25 + (100 - Change Failure Rate) × 0.25 + Code Quality × 0.20
                    </div>
                  </div>
                )}
                
                {/* Metrics Grid - Only show metrics that have values */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {METRICS.map(metric => {
                    const dbField = METRIC_DB_MAPPING[metric.id] as keyof ExistingMetrics;
                    const value = existingMetrics[dbField];
                    if (value === null || value === undefined) return null;
                    
                    return (
                      <div 
                        key={metric.id} 
                        onClick={() => scrollToMetric(metric.id)}
                        className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50 cursor-pointer hover:bg-slate-600/50 hover:border-cyan-500/50 transition-all"
                      >
                        <div className="text-xs text-slate-400 truncate mb-1">{metric.name}</div>
                        <div className={`text-lg font-bold ${getStatusColor(metric.id, Number(value))}`}>
                          {typeof value === 'number' ? value.toFixed(2) : value}{metric.unit}
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
                
                {/* No metrics message */}
                {!METRICS.some(m => {
                  const dbField = METRIC_DB_MAPPING[m.id] as keyof ExistingMetrics;
                  return existingMetrics[dbField] !== null && existingMetrics[dbField] !== undefined;
                }) && (
                  <div className="text-center py-6 text-slate-400">
                    <p>No metrics have been recorded for this team yet.</p>
                    <p className="text-sm mt-1">Use the form below to add metrics.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-6 text-slate-400">
                <p>No metrics history available for this team.</p>
                <p className="text-sm mt-1">Use the form below to add the first metrics.</p>
              </div>
            )}
          </div>
        )}

        {/* Calculated Summary */}
        {Object.keys(calculatedValues).length > 0 && (
          <div className="bg-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              Calculated Metrics ({Object.keys(calculatedValues).length})
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Object.entries(calculatedValues).map(([metricId, value]) => {
                const metric = METRICS.find(m => m.id === metricId);
                if (!metric) return null;
                return (
                  <div key={metricId} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="text-xs text-slate-400 truncate">{metric.name}</div>
                    <div className={`text-lg font-bold ${getStatusColor(metricId, value)}`}>
                      {value.toFixed(2)}{metric.unit}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Metrics by Category */}
        {Object.entries(groupedMetrics).map(([category, metrics]) => {
          const categoryInfo = CATEGORY_INFO[category as keyof typeof CATEGORY_INFO];
          const isExpanded = expandedCategories.has(category);
          
          return (
            <div key={category} className="bg-slate-800 rounded-xl overflow-hidden">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${categoryInfo.color} flex items-center justify-center text-xl`}>
                    {categoryInfo.icon}
                  </div>
                  <div className="text-left">
                    <h2 className="text-lg font-semibold text-white">{categoryInfo.name}</h2>
                    <p className="text-sm text-slate-400">{metrics.length} metrics</p>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                )}
              </button>

              {/* Metrics List */}
              {isExpanded && (
                <div className="px-6 pb-6 space-y-6">
                  {metrics.map(metric => (
                    <div 
                      key={metric.id} 
                      ref={(el) => { metricRefs.current[metric.id] = el; }}
                      className="bg-slate-700/30 rounded-xl p-5 transition-all"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-white font-medium">{metric.name}</h3>
                          <p className="text-sm text-slate-400 mt-1">{metric.description}</p>
                        </div>
                        {calculatedValues[metric.id] !== undefined && (
                          <div className="text-right">
                            <div className="text-xs text-slate-500">Result</div>
                            <div className={`text-xl font-bold ${getStatusColor(metric.id, calculatedValues[metric.id])}`}>
                              {calculatedValues[metric.id].toFixed(2)}{metric.unit}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Formula Display */}
                      <div className="bg-slate-800/50 rounded-lg px-4 py-2 mb-4">
                        <span className="text-xs text-slate-500">Formula: </span>
                        <span className="text-sm text-cyan-400 font-mono">{metric.formula}</span>
                      </div>

                      {/* Input Fields */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {metric.inputs.map(input => (
                          <div key={input.id}>
                            <label className="block text-xs text-slate-400 mb-1">{input.label}</label>
                            <input
                              type="number"
                              placeholder={input.placeholder}
                              min={input.min}
                              max={input.max}
                              step={input.step || 1}
                              value={metricInputs[metric.id]?.[input.id] ?? ''}
                              onChange={(e) => handleInputChange(metric.id, input.id, e.target.value)}
                              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                            />
                          </div>
                        ))}
                      </div>

                      {/* Target */}
                      <div className="mt-3 text-xs text-slate-500">
                        Target: <span className="text-emerald-400">{metric.target}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Developer Metrics Section */}
        {selectedTeamId && teamMembers.length > 0 && (
          <div className="bg-slate-800 rounded-xl overflow-hidden">
            {/* Section Header */}
            <button
              onClick={() => setExpandedDevelopers(!expandedDevelopers)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-semibold text-white">Developer Productivity Metrics</h2>
                  <p className="text-sm text-slate-400">{teamMembers.length} team members</p>
                </div>
              </div>
              {expandedDevelopers ? (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {/* Developer Metrics List */}
            {expandedDevelopers && (
              <div className="px-6 pb-6 space-y-4">
                <div className="bg-slate-700/30 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-300">
                      Enter productivity metrics for each developer. <strong>Happiness Score</strong> and <strong>Burnout Risk</strong> are calculated automatically based on the input values.
                    </p>
                  </div>
                </div>

                {/* Generate Developer Metrics Buttons */}
                <div className="bg-slate-700/30 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    Generate Developer Metrics
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <button
                      onClick={() => handleGenerateDeveloperMetrics('excellent')}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Excellent
                    </button>
                    <button
                      onClick={() => handleGenerateDeveloperMetrics('good')}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Good
                    </button>
                    <button
                      onClick={() => handleGenerateDeveloperMetrics('average')}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Average
                    </button>
                    <button
                      onClick={() => handleGenerateDeveloperMetrics('bad')}
                      className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Bad
                    </button>
                    <button
                      onClick={() => handleGenerateDeveloperMetrics('horrible')}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Horrible
                    </button>
                  </div>
                </div>

                {teamMembers.map(member => {
                  const metrics = developerMetrics[member.id] || {};
                  const calculated = developerCalculated[member.id];
                  
                  return (
                    <div key={member.id} className="bg-slate-700/30 rounded-xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center">
                            <UserCircle className="w-6 h-6 text-slate-300" />
                          </div>
                          <div>
                            <h3 className="text-white font-medium">{member.first_name} {member.last_name}</h3>
                            <p className="text-xs text-slate-400">{member.email}</p>
                          </div>
                        </div>
                        
                        {/* Calculated Results */}
                        {calculated && (
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-xs text-slate-500">Happiness</div>
                              <div className={`text-xl font-bold ${
                                calculated.happinessScore >= 80 ? 'text-emerald-400' :
                                calculated.happinessScore >= 60 ? 'text-amber-400' : 'text-red-400'
                              }`}>
                                {calculated.happinessScore.toFixed(0)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-slate-500">Burnout Risk</div>
                              <div className={`text-sm font-bold px-2 py-1 rounded ${
                                calculated.burnoutRisk === 'low' ? 'bg-emerald-500/20 text-emerald-400' :
                                calculated.burnoutRisk === 'moderate' ? 'bg-amber-500/20 text-amber-400' : 
                                'bg-red-500/20 text-red-400'
                              }`}>
                                {calculated.burnoutRisk === 'low' ? '✅ Low' :
                                 calculated.burnoutRisk === 'moderate' ? '⚠️ Moderate' : '❌ High'}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Input Fields */}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">PR Time (hours)</label>
                          <input
                            type="number"
                            placeholder="e.g., 8"
                            min={0}
                            step={0.5}
                            value={metrics.prMergeTimeAvg ?? ''}
                            onChange={(e) => handleDeveloperMetricChange(member.id, 'prMergeTimeAvg', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Review Time (hours)</label>
                          <input
                            type="number"
                            placeholder="e.g., 2"
                            min={0}
                            step={0.5}
                            value={metrics.codeReviewTimeAvg ?? ''}
                            onChange={(e) => handleDeveloperMetricChange(member.id, 'codeReviewTimeAvg', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Focus Time (hrs/day)</label>
                          <input
                            type="number"
                            placeholder="e.g., 5"
                            min={0}
                            max={8}
                            step={0.5}
                            value={metrics.focusTimeHours ?? ''}
                            onChange={(e) => handleDeveloperMetricChange(member.id, 'focusTimeHours', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Meetings (hrs/day)</label>
                          <input
                            type="number"
                            placeholder="e.g., 2"
                            min={0}
                            max={8}
                            step={0.5}
                            value={metrics.meetingTimeHours ?? ''}
                            onChange={(e) => handleDeveloperMetricChange(member.id, 'meetingTimeHours', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Context Switches</label>
                          <input
                            type="number"
                            placeholder="e.g., 5"
                            min={0}
                            max={20}
                            step={1}
                            value={metrics.contextSwitchesPerDay ?? ''}
                            onChange={(e) => handleDeveloperMetricChange(member.id, 'contextSwitchesPerDay', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Save Developer Metrics Button */}
                <div className="flex justify-end mt-4">
                  <button
                    onClick={handleSaveDeveloperMetrics}
                    disabled={savingDeveloperMetrics}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-600 text-white rounded-lg hover:from-pink-600 hover:to-rose-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                    {savingDeveloperMetrics ? 'Saving...' : 'Save Developer Metrics'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Technical Debt Impact Section */}
        {selectedTeamId && technicalDebtItems.length > 0 && (
          <div className="bg-slate-800 rounded-xl overflow-hidden">
            {/* Section Header */}
            <button
              onClick={() => setExpandedTechnicalDebt(!expandedTechnicalDebt)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                  <Wrench className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-semibold text-white">Technical Debt ROI Impact</h2>
                  <p className="text-sm text-slate-400">{technicalDebtItems.length} debt items</p>
                </div>
              </div>
              {expandedTechnicalDebt ? (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {/* Technical Debt Items List */}
            {expandedTechnicalDebt && (
              <div className="px-6 pb-6 space-y-4">
                <div className="bg-slate-700/30 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-300">
                      Configure business impact metrics for each technical debt item. <strong>ROI</strong>, <strong>Annual Savings</strong>, and <strong>Payback Period</strong> are calculated automatically based on financial settings.
                    </p>
                  </div>
                </div>

                {technicalDebtItems.map(item => {
                  const severityColors: Record<string, string> = {
                    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
                    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
                    medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                    low: 'bg-green-500/20 text-green-400 border-green-500/30'
                  };
                  
                  return (
                    <div key={item.id} className="bg-slate-700/30 rounded-xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center">
                            <Wrench className="w-5 h-5 text-orange-400" />
                          </div>
                          <div>
                            <h3 className="text-white font-medium">{item.title}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded border ${severityColors[item.severity]}`}>
                              {item.severity.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        
                        {/* Calculated ROI Results - Updates in real-time */}
                        {(item.investment_cost !== undefined || item.monthly_cost_of_delay !== undefined) && (
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="text-right">
                              <div className="text-xs text-slate-500">Investment</div>
                              <div className="text-sm font-bold text-blue-400">
                                ${(item.investment_cost || 0).toLocaleString()}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-slate-500">Monthly Loss</div>
                              <div className="text-sm font-bold text-red-400">
                                ${(item.monthly_cost_of_delay || 0).toLocaleString()}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-slate-500">Annual Savings</div>
                              <div className="text-sm font-bold text-green-400">
                                ${(item.annual_savings || 0).toLocaleString()}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-slate-500">ROI</div>
                              <div className={`text-lg font-bold ${
                                (item.roi_percentage || 0) > 200 ? 'text-emerald-400' :
                                (item.roi_percentage || 0) > 100 ? 'text-green-400' :
                                (item.roi_percentage || 0) > 0 ? 'text-amber-400' : 'text-red-400'
                              }`}>
                                {item.roi_percentage || 0}%
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Input Fields Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Effort (hours)</label>
                          <input
                            type="number"
                            placeholder="e.g., 40"
                            min={0}
                            step={1}
                            value={item.estimated_effort_hours || ''}
                            onChange={(e) => handleDebtImpactChange(item.id, 'estimated_effort_hours', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Affected Users</label>
                          <input
                            type="number"
                            placeholder="e.g., 500"
                            min={0}
                            step={1}
                            value={item.affected_users || ''}
                            onChange={(e) => handleDebtImpactChange(item.id, 'affected_users', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Support Tickets/mo</label>
                          <input
                            type="number"
                            placeholder="e.g., 25"
                            min={0}
                            step={1}
                            value={item.support_tickets_monthly || ''}
                            onChange={(e) => handleDebtImpactChange(item.id, 'support_tickets_monthly', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Downtime min/mo</label>
                          <input
                            type="number"
                            placeholder="e.g., 30"
                            min={0}
                            step={1}
                            value={item.downtime_minutes_monthly || ''}
                            onChange={(e) => handleDebtImpactChange(item.id, 'downtime_minutes_monthly', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Revenue Impact %</label>
                          <input
                            type="number"
                            placeholder="e.g., 2.5"
                            min={0}
                            max={100}
                            step={0.1}
                            value={item.revenue_impact_percent || ''}
                            onChange={(e) => handleDebtImpactChange(item.id, 'revenue_impact_percent', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">SLA Breaches/mo</label>
                          <input
                            type="number"
                            placeholder="e.g., 3"
                            min={0}
                            step={1}
                            value={item.sla_breaches_monthly || ''}
                            onChange={(e) => handleDebtImpactChange(item.id, 'sla_breaches_monthly', e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                          />
                        </div>
                      </div>

                      {/* Payback indicator */}
                      {item.payback_months && (
                        <div className="mt-3 text-xs text-slate-400">
                          <TrendingUp className="w-3 h-3 inline mr-1" />
                          Payback period: <span className="text-green-400 font-medium">{item.payback_months} months</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Save Technical Debt Button */}
                <div className="flex justify-end mt-4">
                  <button
                    onClick={handleSaveTechnicalDebt}
                    disabled={savingTechnicalDebt}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-lg hover:from-orange-600 hover:to-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                    {savingTechnicalDebt ? 'Saving...' : 'Save Technical Debt Impact'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================ */}
        {/* PIPELINE STAGES SECTION */}
        {/* ============================================ */}
        {pipelineStages.length > 0 && (
          <div className="bg-slate-800/50 rounded-2xl overflow-hidden border border-slate-700/50 backdrop-blur-sm">
            <button 
              onClick={() => setExpandedPipeline(!expandedPipeline)}
              className="w-full flex items-center justify-between p-6 hover:bg-slate-700/30 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                  <GitBranch className="w-6 h-6 text-white" />
                </div>
                <div className="text-left">
                  <h2 className="text-xl font-bold text-white">CI/CD Pipeline Stages</h2>
                  <p className="text-slate-400 text-sm">{pipelineStages.length} stages • Bottleneck score calculated from duration & success rate</p>
                </div>
              </div>
              <ChevronDown className={`w-6 h-6 text-slate-400 transition-transform ${expandedPipeline ? 'rotate-180' : ''}`} />
            </button>

            {expandedPipeline && (
              <div className="px-6 pb-6 space-y-4">
                <div className="bg-slate-700/30 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-300">
                      Configure pipeline stage metrics. <strong>Bottleneck Score</strong> is calculated automatically: 
                      <code className="text-xs bg-slate-800 px-1 rounded ml-1">(duration / avg) × 50 + (100 - success_rate) × 3</code>
                    </p>
                  </div>
                </div>

                {/* Pipeline Configuration */}
                <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 rounded-xl p-5 mb-4 border border-purple-500/30">
                  <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-purple-400" />
                    Pipeline Metrics Configuration
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Time Savings % (optimization potential)</label>
                      <input
                        type="number"
                        placeholder="30"
                        min={0}
                        max={100}
                        step={1}
                        value={pipelineConfig.time_savings_percent || ''}
                        onChange={(e) => setPipelineConfig(prev => ({ ...prev, time_savings_percent: parseFloat(e.target.value) || 0 }))}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                      />
                      <p className="text-xs text-slate-500 mt-1">Expected time reduction with optimizations</p>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Cost Savings % (optimization potential)</label>
                      <input
                        type="number"
                        placeholder="25"
                        min={0}
                        max={100}
                        step={1}
                        value={pipelineConfig.cost_savings_percent || ''}
                        onChange={(e) => setPipelineConfig(prev => ({ ...prev, cost_savings_percent: parseFloat(e.target.value) || 0 }))}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                      />
                      <p className="text-xs text-slate-500 mt-1">Expected cost reduction with optimizations</p>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Cost per Minute ($)</label>
                      <input
                        type="number"
                        placeholder="0.50"
                        min={0}
                        step={0.01}
                        value={pipelineConfig.cost_per_minute || ''}
                        onChange={(e) => setPipelineConfig(prev => ({ ...prev, cost_per_minute: parseFloat(e.target.value) || 0 }))}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                      />
                      <p className="text-xs text-slate-500 mt-1">Pipeline execution cost per minute</p>
                    </div>
                  </div>
                  <div className="flex justify-end mt-4">
                    <button
                      onClick={handleSavePipelineConfig}
                      disabled={savingPipelineConfig}
                      className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save className="w-3 h-3" />
                      {savingPipelineConfig ? 'Saving...' : 'Save Config'}
                    </button>
                  </div>
                </div>

                {pipelineStages.map(stage => (
                  <div key={stage.id} className="bg-slate-700/30 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center">
                          <span className="text-white font-bold text-sm">{stage.stage_order}</span>
                        </div>
                        <div>
                          <h3 className="text-white font-medium">{stage.name}</h3>
                          <span className="text-xs text-slate-400">Stage {stage.stage_order}</span>
                        </div>
                      </div>
                      
                      {/* Calculated Bottleneck Score */}
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Bottleneck Score</div>
                          <div className={`text-lg font-bold ${
                            (stage.bottleneck_score || 0) > 70 ? 'text-red-400' :
                            (stage.bottleneck_score || 0) > 40 ? 'text-amber-400' : 'text-green-400'
                          }`}>
                            {(stage.bottleneck_score || 0).toFixed(1)}
                          </div>
                        </div>
                        <div className="w-20 h-2 bg-slate-600 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${
                              (stage.bottleneck_score || 0) > 70 ? 'bg-red-500' :
                              (stage.bottleneck_score || 0) > 40 ? 'bg-amber-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(100, stage.bottleneck_score || 0)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Input Fields Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Duration (sec)</label>
                        <input
                          type="number"
                          placeholder="e.g., 120"
                          min={0}
                          step={1}
                          value={stage.duration || ''}
                          onChange={(e) => handlePipelineChange(stage.id, 'duration', e.target.value)}
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Success Rate %</label>
                        <input
                          type="number"
                          placeholder="e.g., 95"
                          min={0}
                          max={100}
                          step={0.1}
                          value={stage.success_rate || ''}
                          onChange={(e) => handlePipelineChange(stage.id, 'success_rate', e.target.value)}
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">CPU Usage %</label>
                        <input
                          type="number"
                          placeholder="e.g., 60"
                          min={0}
                          max={100}
                          step={1}
                          value={stage.cpu_usage || ''}
                          onChange={(e) => handlePipelineChange(stage.id, 'cpu_usage', e.target.value)}
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Memory %</label>
                        <input
                          type="number"
                          placeholder="e.g., 50"
                          min={0}
                          max={100}
                          step={1}
                          value={stage.memory_usage || ''}
                          onChange={(e) => handlePipelineChange(stage.id, 'memory_usage', e.target.value)}
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Cost/Run $</label>
                        <input
                          type="number"
                          placeholder="e.g., 0.15"
                          min={0}
                          step={0.01}
                          value={stage.cost_per_run || ''}
                          onChange={(e) => handlePipelineChange(stage.id, 'cost_per_run', e.target.value)}
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Save Pipeline Button */}
                <div className="flex justify-end mt-4">
                  <button
                    onClick={handleSavePipeline}
                    disabled={savingPipeline}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg hover:from-purple-600 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                    {savingPipeline ? 'Saving...' : 'Save Pipeline Stages'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Business Impact Configuration Section */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Business Impact Demo Configuration</h2>
              <p className="text-sm text-slate-400">Configure your company's business impact correlations for demo purposes</p>
            </div>
          </div>
          <button
            onClick={fetchBusinessImpactConfig}
            disabled={loadingBusinessImpact || !selectedTeamId}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loadingBusinessImpact ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                Loading...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4" />
                Load Config
              </>
            )}
          </button>
        </div>

        {/* Business Impact Metrics Configuration */}
        <div className="space-y-4 mb-6">
          <h3 className="text-md font-semibold text-white">Impact Correlations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Test Coverage */}
            <div className="bg-slate-700 rounded-lg p-4">
              <label className="block text-sm font-medium text-white mb-2">Test Coverage</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quality Score %</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="85.5"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'test_coverage')?.quality_score || ''}
                    onChange={(e) => updateBusinessImpactMetric('test_coverage', 'quality_score', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Revenue Impact $</label>
                  <input
                    type="number"
                    step="1000"
                    placeholder="4178000"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'test_coverage')?.revenue_impact || ''}
                    onChange={(e) => updateBusinessImpactMetric('test_coverage', 'revenue_impact', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">NPS Score</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="82.3"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'test_coverage')?.customer_satisfaction || ''}
                    onChange={(e) => updateBusinessImpactMetric('test_coverage', 'customer_satisfaction', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Correlation</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    placeholder="0.85"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'test_coverage')?.correlation_strength || ''}
                    onChange={(e) => updateBusinessImpactMetric('test_coverage', 'correlation_strength', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Defect Escape Rate */}
            <div className="bg-slate-700 rounded-lg p-4">
              <label className="block text-sm font-medium text-white mb-2">Defect Escape Rate</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quality Score %</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="12.2"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'defect_escape_rate')?.quality_score || ''}
                    onChange={(e) => updateBusinessImpactMetric('defect_escape_rate', 'quality_score', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Revenue Impact $</label>
                  <input
                    type="number"
                    step="1000"
                    placeholder="2896000"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'defect_escape_rate')?.revenue_impact || ''}
                    onChange={(e) => updateBusinessImpactMetric('defect_escape_rate', 'revenue_impact', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">NPS Score</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="76.8"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'defect_escape_rate')?.customer_satisfaction || ''}
                    onChange={(e) => updateBusinessImpactMetric('defect_escape_rate', 'customer_satisfaction', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Correlation</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    placeholder="0.72"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'defect_escape_rate')?.correlation_strength || ''}
                    onChange={(e) => updateBusinessImpactMetric('defect_escape_rate', 'correlation_strength', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Code Quality Score */}
            <div className="bg-slate-700 rounded-lg p-4">
              <label className="block text-sm font-medium text-white mb-2">Code Quality Score</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quality Score %</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="78.9"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'code_quality_score')?.quality_score || ''}
                    onChange={(e) => updateBusinessImpactMetric('code_quality_score', 'quality_score', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Revenue Impact $</label>
                  <input
                    type="number"
                    step="1000"
                    placeholder="3452000"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'code_quality_score')?.revenue_impact || ''}
                    onChange={(e) => updateBusinessImpactMetric('code_quality_score', 'revenue_impact', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">NPS Score</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="79.5"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'code_quality_score')?.customer_satisfaction || ''}
                    onChange={(e) => updateBusinessImpactMetric('code_quality_score', 'customer_satisfaction', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Correlation</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    placeholder="0.68"
                    value={businessImpactConfig.impactConfigs.find(c => c.metric_name === 'code_quality_score')?.correlation_strength || ''}
                    onChange={(e) => updateBusinessImpactMetric('code_quality_score', 'correlation_strength', e.target.value)}
                    className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Historical Trends Configuration */}
        <div className="space-y-4 mb-6">
          <h3 className="text-md font-semibold text-white">Historical Trends (12 Months)</h3>
          <div className="overflow-x-auto">
            <table className="w-full bg-slate-700 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-slate-600">
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-300">Month</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-300">Quality Score</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-300">Revenue ($K)</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-300">NPS</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-300">Churn %</th>
                </tr>
              </thead>
              <tbody>
                {businessImpactConfig.historicalConfigs.map((month, index) => (
                  <tr key={month.month_year} className="border-t border-slate-600">
                    <td className="px-3 py-2 text-sm text-white font-medium">
                      {new Date(month.month_year + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="70.0"
                        value={month.quality_score || ''}
                        onChange={(e) => updateHistoricalMetric(month.month_year, 'quality_score', e.target.value)}
                        className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="10"
                        placeholder="200"
                        value={month.revenue_impact || ''}
                        onChange={(e) => updateHistoricalMetric(month.month_year, 'revenue_impact', e.target.value)}
                        className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="75.0"
                        value={month.customer_satisfaction || ''}
                        onChange={(e) => updateHistoricalMetric(month.month_year, 'customer_satisfaction', e.target.value)}
                        className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="3.0"
                        value={month.churn_rate || ''}
                        onChange={(e) => updateHistoricalMetric(month.month_year, 'churn_rate', e.target.value)}
                        className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Save Business Impact Configuration */}
        <div className="flex justify-end">
          <button
            onClick={saveBusinessImpactConfig}
            disabled={savingBusinessImpact || !selectedTeamId}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {savingBusinessImpact ? 'Saving...' : 'Save Business Impact Config'}
          </button>
        </div>
      </div>
      <div className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Code className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">All Team Metrics (JSON)</h2>
              <p className="text-sm text-slate-400">View all primary and composite metrics with formulas</p>
            </div>
          </div>
          <button
            onClick={fetchAllMetrics}
            disabled={loadingAllMetrics || !selectedTeamId}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loadingAllMetrics ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                Loading...
              </>
            ) : (
              <>
                <Code className="w-4 h-4" />
                Fetch Metrics JSON
              </>
            )}
          </button>
        </div>

        {/* Metrics JSON Display Modal */}
        {showMetricsViewer && allMetricsData && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <div>
                  <h3 className="text-lg font-semibold text-white">Team Metrics - {selectedTeamId}</h3>
                  <p className="text-sm text-slate-400">Snapshot: {allMetricsData.snapshotDate} | Status: {allMetricsData.status}</p>
                </div>
                <button
                  onClick={() => setShowMetricsViewer(false)}
                  className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="overflow-auto flex-1 p-4">
                {/* Primary Metrics */}
                <div className="mb-6">
                  <h4 className="text-md font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                    <span className="w-3 h-3 bg-emerald-400 rounded-full"></span>
                    Primary Metrics ({allMetricsData.primaryMetrics?.length || 0})
                  </h4>
                  <pre className="bg-slate-900 rounded-lg p-4 text-sm text-slate-300 overflow-x-auto">
                    {JSON.stringify(allMetricsData.primaryMetrics, null, 2)}
                  </pre>
                </div>

                {/* Composite Metrics */}
                <div>
                  <h4 className="text-md font-semibold text-amber-400 mb-3 flex items-center gap-2">
                    <span className="w-3 h-3 bg-amber-400 rounded-full"></span>
                    Composite Metrics ({allMetricsData.compositeMetrics?.length || 0}) - Calculated with Formulas
                  </h4>
                  <pre className="bg-slate-900 rounded-lg p-4 text-sm text-slate-300 overflow-x-auto">
                    {JSON.stringify(allMetricsData.compositeMetrics, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="p-4 border-t border-slate-700 flex justify-end gap-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(allMetricsData, null, 2));
                    toast.success('Copied to clipboard!');
                  }}
                  className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                >
                  Copy JSON
                </button>
                <button
                  onClick={() => setShowMetricsViewer(false)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3" style={{ zIndex: 9999 }}>
        {/* Save Button */}
        <button
          onClick={handleSaveMetrics}
          disabled={saving || Object.keys(calculatedValues).length === 0}
          className="p-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-full shadow-lg hover:from-emerald-600 hover:to-green-700 transition-all hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          title={Object.keys(calculatedValues).length === 0 ? "Enter metrics to save" : "Save All Metrics"}
        >
          <Save className="w-5 h-5" />
        </button>

        {/* Back to Top Button */}
        <button
          onClick={scrollToTop}
          className="p-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-full shadow-lg hover:from-cyan-600 hover:to-blue-700 transition-all hover:scale-110"
          title="Back to Top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default ManualMetricsInput;
