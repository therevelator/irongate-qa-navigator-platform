import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Calculator, Save, AlertCircle, CheckCircle, Info, ChevronDown, ChevronRight, History, Calendar, ArrowUp, Users, UserCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
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
    }
  }, [selectedTeamId]);

  const fetchTeams = async () => {
    try {
      const token = localStorage.getItem('irongate_token');
      const response = await fetch(`${API_URL}/teams`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        let filteredTeams = data.teams || [];
        
        // Filter teams based on user role
        if (user?.role === 'manager') {
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
      const token = localStorage.getItem('irongate_token');
      const response = await fetch(`${API_URL}/teams/${teamId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
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
    const numValue = parseFloat(value) || 0;
    
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
      toast.error('Please select a team');
      return;
    }

    const metricsToSave = Object.entries(developerMetrics).filter(([_, metrics]) => 
      metrics.focusTimeHours > 0 || metrics.meetingTimeHours > 0 || metrics.prMergeTimeAvg > 0 || metrics.contextSwitchesPerDay > 0
    );

    if (metricsToSave.length === 0) {
      toast.error('Please enter metrics for at least one developer');
      return;
    }

    setSavingDeveloperMetrics(true);

    try {
      const token = localStorage.getItem('irongate_token');
      
      for (const [developerId, metrics] of metricsToSave) {
        const happinessScore = calculateHappinessScore(metrics);
        
        const response = await fetch(`${API_URL}/metrics/developer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
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

      toast.success(`Developer metrics saved for ${metricsToSave.length} developer(s)`);
    } catch (error) {
      console.error('Error saving developer metrics:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save developer metrics');
    } finally {
      setSavingDeveloperMetrics(false);
    }
  };

  const handleInputChange = (metricId: string, inputId: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    
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

  const handleSaveMetrics = async () => {
    if (!selectedTeamId) {
      toast.error('Please select a team');
      return;
    }

    // Check if any metrics have been calculated
    if (Object.keys(calculatedValues).length === 0) {
      toast.error('Please enter at least one metric');
      return;
    }

    setSaving(true);

    try {
      const token = localStorage.getItem('irongate_token');
      
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
        infrastructure_failures: calculatedValues['infra-failures']
      };

      const response = await fetch(`${API_URL}/metrics/manual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(metricsPayload)
      });

      if (response.ok) {
        const result = await response.json();
        const selectedTeam = teams.find(t => t.id === selectedTeamId);
        toast.success(`✅ ${selectedTeam?.name || 'Team'} metrics saved! QA Score: ${result.qaScore} (${result.status})`, {
          duration: 4000
        });
        // Show info about dashboard refresh
        setTimeout(() => {
          toast('💡 Go back to dashboard to see updated metrics', {
            icon: 'ℹ️',
            duration: 3000
          });
        }, 500);
        // Reset inputs after save and refresh existing metrics
        setMetricInputs({});
        setCalculatedValues({});
        // Refresh existing metrics to show the updated values
        fetchExistingMetrics(selectedTeamId);
      } else {
        const error = await response.json();
        toast.error(`❌ Failed to save: ${error.error || 'Unknown error'}`, {
          duration: 5000
        });
      }
    } catch (error) {
      console.error('Error saving metrics:', error);
      toast.error('❌ Failed to save metrics. Check console for details.', {
        duration: 5000
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
                  <div className="mb-4 p-4 bg-slate-700/50 rounded-lg flex items-center justify-between">
                    <span className="text-slate-300 font-medium">Overall QA Score</span>
                    <span className={`text-2xl font-bold ${
                      existingMetrics.qaScore >= 85 ? 'text-emerald-400' :
                      existingMetrics.qaScore >= 70 ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {existingMetrics.qaScore}/100
                    </span>
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
                              value={metricInputs[metric.id]?.[input.id] || ''}
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
                            value={metrics.prMergeTimeAvg || ''}
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
                            value={metrics.codeReviewTimeAvg || ''}
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
                            value={metrics.focusTimeHours || ''}
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
                            value={metrics.meetingTimeHours || ''}
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
                            value={metrics.contextSwitchesPerDay || ''}
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
