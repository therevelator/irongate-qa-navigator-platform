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
    
    /**
     * TEST COVERAGE
     * What: Percentage of codebase covered by automated tests (unit, integration, E2E)
     * Why: Higher coverage reduces risk of undetected bugs and increases confidence in refactoring
     * How: (Lines of code executed by tests / Total lines of code) × 100
     * Target: >80% for critical paths, >70% overall
     */
    {
      id: 'test-coverage',
      name: 'Test Coverage',
      value: Math.floor(60 + Math.random() * 35), // Mock: Random 60-95%. PROD: From coverage reports (Jest/Istanbul/Jacoco)
      unit: '%',
      change: Number((Math.random() * 5 - 2).toFixed(1)), // Mock: Random -2 to +5. PROD: Compare current vs previous sprint
      trend: 'up',
      status: 'good',
      category: 'quality',
      description: 'Percentage of code covered by automated tests',
      history: generateHistory(75, 5) // Mock: 30 days of data around 75%. PROD: Daily coverage from CI/CD pipeline
    },
    
    /**
     * TEST FLAKINESS RATE
     * What: Tests that produce inconsistent results without code changes
     * Why: Flaky tests erode trust in CI/CD, waste developer time, and mask real issues
     * How: (Number of flaky test runs / Total test runs) × 100
     * Target: <2% (lower is better)
     */
    {
      id: 'flakiness-rate',
      name: 'Test Flakiness Rate',
      value: Number((Math.random() * 5).toFixed(1)), // Mock: Random 0-5%. PROD: Track test reruns in CI (Jenkins/CircleCI/GitHub Actions)
      unit: '%',
      change: Number((Math.random() * 2 - 1).toFixed(1)), // Mock: Random -1 to +2. PROD: Week-over-week comparison
      trend: 'down',
      status: Math.random() > 0.7 ? 'warning' : 'good',
      category: 'quality',
      description: 'Tests that fail intermittently without code changes',
      history: generateHistory(2.5, 1) // Mock: 30 days around 2.5%. PROD: Daily flaky test count from test runner logs
    },
    
    /**
     * DEFECT DENSITY
     * What: Number of confirmed defects per thousand lines of code
     * Why: Indicates code quality and helps predict maintenance effort
     * How: (Total defects found / Total lines of code) × 1000
     * Target: <0.5 defects per 1k LOC for mature code
     */
    {
      id: 'defect-density',
      name: 'Defect Density',
      value: Number((Math.random() * 1.5).toFixed(2)), // Mock: Random 0-1.5. PROD: Jira bugs / SonarQube LOC count
      unit: '/1k LOC',
      change: -0.1, // Mock: Fixed -0.1. PROD: Current sprint vs previous sprint density
      trend: 'down',
      status: 'good',
      category: 'quality',
      description: 'Number of defects per thousand lines of code',
      history: generateHistory(0.8, 0.2) // Mock: 30 days around 0.8. PROD: Sprint-by-sprint defect density from bug tracker
    },
    
    /**
     * DEFECT ESCAPE RATE
     * What: Percentage of defects found in production vs. caught during testing
     * Why: Measures testing effectiveness and user impact of quality issues
     * How: (Defects found in production / Total defects found) × 100
     * Target: <5% (most bugs caught before production)
     */
    {
      id: 'defect-escape-rate',
      name: 'Defect Escape Rate',
      value: Number((Math.random() * 8).toFixed(1)), // Mock: Random 0-8%. PROD: Production bugs / Total bugs from Jira labels
      unit: '%',
      change: -0.5, // Mock: Fixed -0.5. PROD: Compare production bug ratio sprint-over-sprint
      trend: 'down',
      status: 'good',
      category: 'quality',
      description: 'Bugs found in production vs. caught in testing',
      history: generateHistory(4, 1) // Mock: 30 days around 4%. PROD: Weekly production incident count
    },
    
    /**
     * CODE QUALITY SCORE
     * What: Composite score from static analysis tools (SonarQube, CodeClimate, etc.)
     * Why: Identifies technical debt, security vulnerabilities, and maintainability issues
     * How: Weighted average of complexity, duplication, security issues, and code smells
     * Target: >85/100 (A rating)
     */
    {
      id: 'code-quality-score',
      name: 'Code Quality Score',
      value: Math.floor(70 + Math.random() * 25), // Mock: Random 70-95. PROD: SonarQube/CodeClimate API quality gate score
      unit: '/100',
      change: 2, // Mock: Fixed +2. PROD: Current scan vs previous scan score delta
      trend: 'up',
      status: 'good',
      category: 'quality',
      description: 'SonarQube or similar static analysis score',
      history: generateHistory(85, 5) // Mock: 30 days around 85. PROD: Daily SonarQube scan results
    },

    // Speed & Efficiency
    
    /**
     * AVERAGE BUILD TIME
     * What: Mean duration for CI/CD pipeline to compile, test, and package code
     * Why: Faster builds enable quicker feedback and more frequent deployments
     * How: Sum of all build times / Number of builds (over last 30 days)
     * Target: <10 minutes for fast feedback loop
     */
    {
      id: 'build-time',
      name: 'Avg Build Time',
      value: Math.floor(5 + Math.random() * 15), // Mock: Random 5-20 min. PROD: Average from Jenkins/CircleCI build duration API
      unit: 'min',
      change: -1.5, // Mock: Fixed -1.5. PROD: This week's avg vs last week's avg
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Average time to complete CI/CD build',
      history: generateHistory(12, 3) // Mock: 30 days around 12 min. PROD: Daily average build times from CI system
    },
    
    /**
     * TEST EXECUTION TIME
     * What: Total time to run entire automated test suite (unit + integration + E2E)
     * Why: Long test times slow down CI/CD and reduce deployment frequency
     * How: Sum of execution time for all test types in the pipeline
     * Target: <30 minutes for full suite, <5 minutes for critical path
     */
    {
      id: 'test-execution-time',
      name: 'Test Execution Time',
      value: Math.floor(20 + Math.random() * 40), // Mock: Random 20-60 min. PROD: Sum of test stage durations from CI pipeline
      unit: 'min',
      change: -2, // Mock: Fixed -2. PROD: Current sprint avg vs previous sprint avg
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Total time to run all automated tests',
      history: generateHistory(45, 8) // Mock: 30 days around 45 min. PROD: Daily test execution time from test runner
    },
    
    /**
     * DEPLOYMENT FREQUENCY
     * What: Number of successful production deployments per week
     * Why: High deployment frequency indicates mature DevOps practices and faster value delivery
     * How: Count of production deployments / Number of weeks
     * Target: >5 per week (daily or more for elite performers)
     */
    {
      id: 'deployment-frequency',
      name: 'Deployment Frequency',
      value: Math.floor(5 + Math.random() * 15), // Mock: Random 5-20/week. PROD: Count production deploys from CD tool (Spinnaker/ArgoCD)
      unit: '/week',
      change: 3, // Mock: Fixed +3. PROD: This week's count vs last week's count
      trend: 'up',
      status: 'good',
      category: 'speed',
      description: 'Number of deployments to production per week',
      history: generateHistory(8, 2) // Mock: 30 days around 8/week. PROD: Daily deployment count aggregated weekly
    },
    
    /**
     * LEAD TIME FOR CHANGES
     * What: Time from code commit to running in production (DORA metric)
     * Why: Shorter lead time means faster feature delivery and bug fixes
     * How: Median time between commit timestamp and production deployment timestamp
     * Target: <1 day (elite), <1 week (high), <1 month (medium)
     */
    {
      id: 'lead-time',
      name: 'Lead Time for Changes',
      value: Number((1 + Math.random() * 4).toFixed(1)), // Mock: Random 1-5 days. PROD: Median(deploy_time - commit_time) from Git + CD logs
      unit: 'days',
      change: -0.3, // Mock: Fixed -0.3. PROD: Current period median vs previous period
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Time from commit to production deployment',
      history: generateHistory(2.5, 0.5) // Mock: 30 days around 2.5 days. PROD: Daily median lead time calculation
    },
    
    /**
     * MEAN TIME TO REPAIR (MTTR)
     * What: Average time to restore service after an incident (DORA metric)
     * Why: Measures team's ability to quickly diagnose and fix production issues
     * How: Sum of (incident resolution time - incident detection time) / Number of incidents
     * Target: <1 hour (elite), <1 day (high)
     */
    {
      id: 'mttr',
      name: 'Mean Time to Repair',
      value: Number((2 + Math.random() * 8).toFixed(1)), // Mock: Random 2-10 hrs. PROD: Avg(resolved_time - detected_time) from PagerDuty/Jira
      unit: 'hours',
      change: -1, // Mock: Fixed -1. PROD: This month's MTTR vs last month's MTTR
      trend: 'down',
      status: 'good',
      category: 'speed',
      description: 'Average time to diagnose and fix failures',
      history: generateHistory(5, 2) // Mock: 30 days around 5 hrs. PROD: Daily incident resolution times
    },
    
    /**
     * PARALLEL TEST EFFICIENCY
     * What: How effectively tests run in parallel vs. sequential execution
     * Why: Better parallelization reduces total test time and speeds up CI/CD
     * How: (Sequential time / Parallel time) / Number of parallel workers × 100
     * Target: >80% (near-linear scaling with workers)
     */
    {
      id: 'parallel-efficiency',
      name: 'Parallel Test Efficiency',
      value: Math.floor(70 + Math.random() * 25), // Mock: Random 70-95%. PROD: (Sequential time / Parallel time) / Workers from test logs
      unit: '%',
      change: 2, // Mock: Fixed +2. PROD: Current efficiency vs previous sprint
      trend: 'up',
      status: 'good',
      category: 'speed',
      description: 'Efficiency of parallel test execution',
      history: generateHistory(82, 5) // Mock: 30 days around 82%. PROD: Daily parallel execution metrics
    },

    // Agile & Process
    
    /**
     * SPRINT VELOCITY
     * What: Total story points completed in a sprint
     * Why: Helps predict capacity and plan future sprints
     * How: Sum of story points for all completed user stories in the sprint
     * Target: Stable velocity (±10%) over 3-4 sprints indicates predictability
     */
    {
      id: 'sprint-velocity',
      name: 'Sprint Velocity',
      value: Math.floor(30 + Math.random() * 30), // Mock: Random 30-60 pts. PROD: Sum of completed story points from Jira/Azure DevOps
      unit: 'pts',
      change: 5, // Mock: Fixed +5. PROD: Current sprint vs previous sprint velocity
      trend: 'up',
      status: 'good',
      category: 'agile',
      description: 'Story points completed per sprint',
      history: generateHistory(45, 8) // Mock: 30 days around 45 pts. PROD: Sprint-by-sprint velocity history
    },
    
    /**
     * SPRINT COMMITMENT RATE
     * What: Percentage of committed sprint work actually completed
     * Why: Indicates planning accuracy and team's ability to meet commitments
     * How: (Completed story points / Committed story points) × 100
     * Target: >85% (high predictability)
     */
    {
      id: 'sprint-commitment',
      name: 'Sprint Commitment Rate',
      value: Math.floor(75 + Math.random() * 20), // Mock: Random 75-95%. PROD: (Completed points / Committed points) from sprint board
      unit: '%',
      change: -2, // Mock: Fixed -2. PROD: Current sprint rate vs previous sprint rate
      trend: 'down',
      status: 'warning',
      category: 'agile',
      description: 'Percentage of committed work completed',
      history: generateHistory(88, 5) // Mock: 30 days around 88%. PROD: Sprint-by-sprint commitment tracking
    },
    
    /**
     * SPRINT CARRYOVER
     * What: Work items not completed and moved to the next sprint
     * Why: High carryover indicates poor estimation, scope creep, or blockers
     * How: (Incomplete story points / Total committed story points) × 100
     * Target: <10% (most work completed within sprint)
     */
    {
      id: 'sprint-carryover',
      name: 'Sprint Carryover',
      value: Math.floor(5 + Math.random() * 20), // Mock: Random 5-25%. PROD: (Incomplete points / Committed points) from Jira query
      unit: '%',
      change: 3, // Mock: Fixed +3. PROD: Current sprint carryover vs previous sprint
      trend: 'up',
      status: 'warning',
      category: 'agile',
      description: 'Work not completed and moved to next sprint',
      history: generateHistory(12, 4) // Mock: 30 days around 12%. PROD: Sprint-by-sprint carryover percentage
    },
    
    /**
     * FIRST-TIME PASS RATE
     * What: User stories that pass QA testing on the first attempt
     * Why: Higher rate means better quality from development and clearer acceptance criteria
     * How: (Stories passing QA first time / Total stories tested) × 100
     * Target: >75% (most stories meet acceptance criteria initially)
     */
    {
      id: 'first-time-pass',
      name: 'First-Time Pass Rate',
      value: Math.floor(60 + Math.random() * 30), // Mock: Random 60-90%. PROD: Stories with 0 QA rejections / Total stories from workflow
      unit: '%',
      change: 2, // Mock: Fixed +2. PROD: Current sprint FTP vs previous sprint
      trend: 'up',
      status: 'warning',
      category: 'agile',
      description: 'Stories passing QA on first attempt',
      history: generateHistory(70, 8) // Mock: 30 days around 70%. PROD: Sprint-by-sprint first-time pass tracking
    },
    
    /**
     * BLOCKED TIME
     * What: Total hours work items spend in "blocked" status per sprint
     * Why: Identifies process bottlenecks and external dependencies
     * How: Sum of (unblock time - block time) for all blocked tickets
     * Target: <15 hours per sprint (minimal blocking)
     */
    {
      id: 'blocked-time',
      name: 'Blocked Time',
      value: Math.floor(10 + Math.random() * 20), // Mock: Random 10-30 hrs. PROD: Sum of time in 'Blocked' status from Jira workflow
      unit: 'hrs',
      change: -4, // Mock: Fixed -4. PROD: Current sprint blocked time vs previous sprint
      trend: 'down',
      status: 'good',
      category: 'agile',
      description: 'Total hours tickets spent blocked per sprint',
      history: generateHistory(18, 5) // Mock: 30 days around 18 hrs. PROD: Daily blocked time aggregated per sprint
    },
    
    /**
     * TEST AUTOMATION COVERAGE
     * What: Percentage of test cases that are automated vs. manual
     * Why: Automation enables faster regression testing and continuous delivery
     * How: (Automated test cases / Total test cases) × 100
     * Target: >70% for regression tests, >50% overall
     */
    {
      id: 'automation-coverage',
      name: 'Test Automation Coverage',
      value: Math.floor(60 + Math.random() * 35), // Mock: Random 60-95%. PROD: (Automated tests / Total test cases) from TestRail/Zephyr
      unit: '%',
      change: 3, // Mock: Fixed +3. PROD: Current coverage vs previous sprint coverage
      trend: 'up',
      status: 'good',
      category: 'agile',
      description: 'Percentage of test cases automated',
      history: generateHistory(75, 5) // Mock: 30 days around 75%. PROD: Sprint-by-sprint automation coverage growth
    },
    
    /**
     * AUTOMATION ROI
     * What: Return on investment from test automation efforts
     * Why: Justifies automation investment and identifies high-value automation opportunities
     * How: (Time saved by automation / Time invested in automation) × 100
     * Target: >200% (automation saves more time than it costs)
     */
    {
      id: 'automation-roi',
      name: 'Automation ROI',
      value: Math.floor(200 + Math.random() * 200), // Mock: Random 200-400%. PROD: (Time saved / Time invested) × 100 from time tracking
      unit: '%',
      change: 15, // Mock: Fixed +15. PROD: Current quarter ROI vs previous quarter
      trend: 'up',
      status: 'good',
      category: 'agile',
      description: 'Return on investment for test automation',
      history: generateHistory(280, 30) // Mock: 30 days around 280%. PROD: Monthly ROI calculation from automation metrics
    },

    // Reliability
    
    /**
     * CHANGE FAILURE RATE
     * What: Percentage of deployments that cause production failures (DORA metric)
     * Why: Measures deployment quality and risk; lower rate means more stable releases
     * How: (Failed deployments requiring hotfix or rollback / Total deployments) × 100
     * Target: <5% (elite), <15% (high), <30% (medium)
     */
    {
      id: 'change-failure-rate',
      name: 'Change Failure Rate',
      value: Number((Math.random() * 10).toFixed(1)), // Mock: Random 0-10%. PROD: (Failed deploys / Total deploys) from CD logs + incidents
      unit: '%',
      change: 0.5, // Mock: Fixed +0.5. PROD: This month's CFR vs last month's CFR
      trend: 'up',
      status: 'warning',
      category: 'reliability',
      description: 'Deployments causing failures or rollbacks',
      history: generateHistory(5, 2) // Mock: 30 days around 5%. PROD: Daily deployment success/failure tracking
    },
    
    /**
     * MEAN TIME BETWEEN FAILURES (MTBF)
     * What: Average time the system operates without failure
     * Why: Indicates system stability and reliability; higher is better
     * How: Total operational time / Number of failures
     * Target: >100 hours (stable system with infrequent failures)
     */
    {
      id: 'mtbf',
      name: 'Mean Time Between Failures',
      value: Math.floor(80 + Math.random() * 80), // Mock: Random 80-160 hrs. PROD: Total uptime / Incident count from monitoring tools
      unit: 'hours',
      change: 10, // Mock: Fixed +10. PROD: Current period MTBF vs previous period
      trend: 'up',
      status: 'good',
      category: 'reliability',
      description: 'Average time between system failures',
      history: generateHistory(120, 20) // Mock: 30 days around 120 hrs. PROD: Daily MTBF calculation from incident logs
    },
    
    /**
     * SYSTEM AVAILABILITY
     * What: Percentage of time the system is operational and accessible
     * Why: Critical for user satisfaction and SLA compliance
     * How: (Total uptime / Total time) × 100
     * Target: >99.9% (three nines), >99.99% (four nines for critical systems)
     */
    {
      id: 'availability',
      name: 'System Availability',
      value: Number((99 + Math.random()).toFixed(2)), // Mock: Random 99-100%. PROD: (Uptime / Total time) × 100 from Datadog/New Relic
      unit: '%',
      change: 0.1, // Mock: Fixed +0.1. PROD: Current month vs previous month availability
      trend: 'up',
      status: 'good',
      category: 'reliability',
      description: 'Uptime percentage',
      history: generateHistory(99.5, 0.3) // Mock: 30 days around 99.5%. PROD: Hourly uptime checks aggregated daily
    },
    
    /**
     * INFRASTRUCTURE FAILURES
     * What: Test failures caused by infrastructure issues (not code defects)
     * Why: Identifies environmental instability that impacts test reliability
     * How: Count of test failures attributed to infrastructure (network, DB, services)
     * Target: <5 per sprint (stable test infrastructure)
     */
    {
      id: 'infra-failures',
      name: 'Infrastructure Failures',
      value: Math.floor(Math.random() * 8), // Mock: Random 0-8 count. PROD: Count of test failures tagged 'infrastructure' in test results
      unit: 'count',
      change: -1, // Mock: Fixed -1. PROD: Current sprint count vs previous sprint count
      trend: 'down',
      status: 'good',
      category: 'reliability',
      description: 'Test failures due to infrastructure issues',
      history: generateHistory(3, 2) // Mock: 30 days around 3 failures. PROD: Daily infrastructure failure count
    },
    
    /**
     * ENVIRONMENT STARTUP TIME
     * What: Time required to provision and start test environments
     * Why: Faster startup enables quicker test execution and better developer experience
     * How: Average time from environment request to ready state
     * Target: <5 minutes (fast feedback), <10 minutes (acceptable)
     */
    {
      id: 'env-startup-time',
      name: 'Environment Startup Time',
      value: Math.floor(5 + Math.random() * 15), // Mock: Random 5-20 min. PROD: Avg time from Docker/K8s provision to ready state
      unit: 'min',
      change: 1, // Mock: Fixed +1. PROD: Current week avg vs previous week avg
      trend: 'up',
      status: 'warning',
      category: 'reliability',
      description: 'Time to provision test environments',
      history: generateHistory(10, 3) // Mock: 30 days around 10 min. PROD: Daily environment startup time tracking
    }
  ];
};
