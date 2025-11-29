import cron from 'node-cron';
import { query } from '../../src/lib/db';

console.log('📊 Analytics sync job initializing...');

// ============================================================================
// DATA GENERATORS
// ============================================================================

const randomBetween = (min: number, max: number, decimals = 0): number => {
  const value = min + Math.random() * (max - min);
  return decimals > 0 ? Number(value.toFixed(decimals)) : Math.floor(value);
};

const randomFromArray = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const generateId = (prefix: string): string => 
  `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// ============================================================================
// SEED FUNCTIONS
// ============================================================================

// Seed pipeline stages for a company
async function seedPipelineStages(companyId: string): Promise<void> {
  const stages = [
    { name: 'Checkout', order: 0 },
    { name: 'Install Dependencies', order: 1 },
    { name: 'Lint & Format', order: 2 },
    { name: 'Unit Tests', order: 3 },
    { name: 'Build', order: 4 },
    { name: 'Integration Tests', order: 5 },
    { name: 'Deploy Staging', order: 6 },
    { name: 'E2E Tests', order: 7 },
    { name: 'Deploy Production', order: 8 },
  ];

  for (const stage of stages) {
    const existing = await query<any>(
      'SELECT id FROM pipeline_stages WHERE company_id = ? AND name = ?',
      [companyId, stage.name]
    );

    if (existing.length === 0) {
      await query(`
        INSERT INTO pipeline_stages (id, company_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        generateId('ps'),
        companyId,
        stage.name,
        stage.order,
        randomBetween(30, 300),
        randomBetween(85, 99, 2),
        randomBetween(20, 80, 2),
        randomBetween(30, 70, 2),
        randomBetween(0.1, 3, 2),
        randomBetween(0, 60, 2)
      ]);
    }
  }
  console.log(`  ✓ Pipeline stages seeded for company ${companyId}`);
}

// Seed business impact metrics with historical data
async function seedBusinessImpactHistory(companyId: string, days: number = 30): Promise<void> {
  const metrics = ['Test Coverage', 'Code Quality', 'Deployment Frequency', 'MTTR', 'Change Failure Rate'];
  
  for (const metricName of metrics) {
    for (let d = 0; d < days; d++) {
      const recordedDate = new Date();
      recordedDate.setDate(recordedDate.getDate() - d);
      const dateStr = recordedDate.toISOString().split('T')[0];

      const existing = await query<any>(
        'SELECT id FROM business_impact_metrics WHERE company_id = ? AND metric_name = ? AND recorded_date = ?',
        [companyId, metricName, dateStr]
      );

      if (existing.length === 0) {
        await query(`
          INSERT INTO business_impact_metrics (id, company_id, metric_name, quality_score, revenue_impact, customer_satisfaction, feature_adoption_rate, correlation_strength, recorded_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          generateId('bim'),
          companyId,
          metricName,
          randomBetween(60, 95, 2),
          randomBetween(5000, 50000, 2),
          randomBetween(70, 95, 2),
          randomBetween(50, 95, 2),
          randomBetween(0.5, 0.95, 4),
          dateStr
        ]);
      }
    }
  }
  console.log(`  ✓ Business impact history seeded (${days} days)`);
}

// Seed test cases for Test Case Management
async function seedTestCases(companyId: string, teamIds: string[], count: number = 30): Promise<void> {
  const testNames = [
    'Login with valid credentials',
    'Login with invalid password',
    'User registration flow',
    'Password reset functionality',
    'Session timeout handling',
    'Add item to cart',
    'Remove item from cart',
    'Checkout with credit card',
    'Checkout with PayPal',
    'Apply discount code',
    'Search products by name',
    'Filter products by category',
    'Sort products by price',
    'Product detail page load',
    'User profile update',
    'Email notification settings',
    'Two-factor authentication',
    'API rate limiting',
    'Database connection pooling',
    'File upload validation',
    'Export data to CSV',
    'Import data from Excel',
    'Concurrent user handling',
    'Memory leak detection',
    'Cross-browser compatibility',
    'Mobile responsive layout',
    'Accessibility compliance',
    'SSL certificate validation',
    'Data encryption at rest',
    'Audit log generation'
  ];
  const testTypes = ['unit', 'integration', 'e2e', 'api', 'performance', 'security'] as const;
  const priorities = ['critical', 'high', 'medium', 'low'] as const;
  const statuses = ['active', 'active', 'active', 'obsolete', 'draft'] as const;
  const requirements = ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005', 'REQ-006', 'REQ-007', 'REQ-008'];

  for (let i = 0; i < count; i++) {
    const id = generateId('tc');
    const teamId = randomFromArray(teamIds);
    const isFlaky = Math.random() < 0.15; // 15% chance of being flaky
    
    await query(`
      INSERT INTO test_cases (id, team_id, name, description, test_type, priority, status, requirement_id, pass_rate, execution_count, effectiveness_score, avg_duration_ms, flakiness_score, is_flaky, last_executed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      teamId,
      testNames[i % testNames.length],
      `Automated test case for ${testNames[i % testNames.length]}`,
      randomFromArray([...testTypes]),
      randomFromArray([...priorities]),
      randomFromArray([...statuses]),
      randomFromArray(requirements),
      randomBetween(60, 100, 2),
      randomBetween(10, 500),
      randomBetween(50, 100, 2),
      randomBetween(500, 30000), // ms
      isFlaky ? randomBetween(20, 80, 2) : randomBetween(0, 10, 2),
      isFlaky ? 1 : 0,
      new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    ]);

    // Add some tags
    const tags = ['smoke', 'regression', 'critical', 'api', 'ui', 'integration', 'performance'];
    const numTags = randomBetween(1, 3);
    for (let t = 0; t < numTags; t++) {
      await query(`INSERT INTO test_case_tags (test_case_id, tag) VALUES (?, ?)`, [
        id, randomFromArray(tags)
      ]);
    }
  }
  console.log(`  ✓ Test cases seeded (${count} cases)`);
}

// Seed flaky tests for Flaky Test Intelligence (links to test_cases marked as flaky)
async function seedFlakyTests(companyId: string, teamIds: string[]): Promise<void> {
  const rootCauses = ['timing_issue', 'race_condition', 'external_dependency', 'data_pollution', 'environment_specific'];
  const fixes = [
    'Add explicit waits or increase timeout values',
    'Ensure consistent test environment setup',
    'Use data factories or fixtures for consistent test data',
    'Mock external API calls or add retry logic',
    'Investigate test stability and add better error handling'
  ];

  // Get flaky test cases that don't have flaky_tests entries yet
  const flakyTestCases = await query<any>(`
    SELECT tc.id, tc.team_id 
    FROM test_cases tc
    LEFT JOIN flaky_tests ft ON tc.id = ft.test_case_id
    WHERE tc.is_flaky = 1 AND tc.team_id IN (?) AND ft.id IS NULL
  `, [teamIds]);

  for (const tc of flakyTestCases) {
    const failureCount = randomBetween(5, 50);
    const passCount = randomBetween(50, 200);
    
    await query(`
      INSERT INTO flaky_tests (id, test_case_id, team_id, flakiness_score, failure_count, pass_count, total_runs, root_cause, suggested_fix, last_flaky_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      generateId('ft'),
      tc.id,
      tc.team_id,
      randomBetween(20, 90, 2),
      failureCount,
      passCount,
      failureCount + passCount,
      randomFromArray(rootCauses),
      randomFromArray(fixes),
      new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    ]);
  }
  console.log(`  ✓ Flaky tests seeded (${flakyTestCases.length} tests)`);
}

// Seed test execution runs with historical data
async function seedTestExecutionHistory(companyId: string, teamIds: string[], count: number = 100): Promise<void> {
  const testSuites = [
    'Authentication Suite',
    'User Management Tests',
    'Checkout Flow',
    'Payment Integration',
    'API Integration Tests',
    'Performance Suite',
    'Smoke Tests',
    'Regression Suite',
    'Security Scan',
    'Accessibility Tests'
  ];
  const statuses = ['passed', 'failed', 'blocked'] as const;

  for (let i = 0; i < count; i++) {
    const startTime = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000);
    const duration = randomBetween(30, 600);
    const status = randomFromArray([...statuses, 'passed', 'passed', 'passed']); // Bias towards passed

    await query(`
      INSERT INTO test_execution_runs (id, company_id, team_id, test_suite, status, start_time, end_time, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      generateId('ter'),
      companyId,
      randomFromArray(teamIds),
      randomFromArray(testSuites),
      status,
      startTime,
      new Date(startTime.getTime() + duration * 1000),
      duration
    ]);
  }
  console.log(`  ✓ Test execution history seeded (${count} runs)`);
}

// Seed performance metrics with historical data
async function seedPerformanceHistory(companyId: string, teamIds: string[], days: number = 30): Promise<void> {
  const endpoints = [
    '/api/auth/login',
    '/api/users',
    '/api/teams',
    '/api/metrics',
    '/api/dashboard',
    '/api/reports',
    '/api/search',
    '/api/notifications'
  ];
  const methods = ['GET', 'POST', 'PUT', 'DELETE'];

  for (let d = 0; d < days; d++) {
    const recordedDate = new Date();
    recordedDate.setDate(recordedDate.getDate() - d);
    const dateStr = recordedDate.toISOString().split('T')[0];

    for (const endpoint of endpoints.slice(0, 5)) { // Top 5 endpoints
      const existing = await query<any>(
        'SELECT id FROM performance_metrics WHERE company_id = ? AND endpoint = ? AND recorded_date = ?',
        [companyId, endpoint, dateStr]
      );

      if (existing.length === 0) {
        const id = generateId('pm');
        await query(`
          INSERT INTO performance_metrics (id, company_id, team_id, endpoint, method, response_time_p50_ms, response_time_p95_ms, response_time_p99_ms, throughput_per_minute, error_rate, recorded_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id,
          companyId,
          randomFromArray(teamIds),
          endpoint,
          randomFromArray(methods),
          randomBetween(50, 150),
          randomBetween(150, 400),
          randomBetween(400, 800),
          randomBetween(100, 1000),
          randomBetween(0, 5, 2),
          dateStr
        ]);
      }
    }
  }
  console.log(`  ✓ Performance metrics history seeded (${days} days)`);
}

// Seed technical debt items
async function seedTechnicalDebt(companyId: string, teamIds: string[], count: number = 20): Promise<void> {
  const titles = [
    'Refactor authentication module',
    'Update deprecated dependencies',
    'Improve test coverage for API',
    'Optimize database queries',
    'Add error handling to payment flow',
    'Migrate to new logging framework',
    'Fix memory leak in worker process',
    'Update API documentation',
    'Implement rate limiting',
    'Add input validation',
    'Refactor legacy code in reports',
    'Security audit findings',
    'Performance optimization needed',
    'Code duplication in services',
    'Missing unit tests for core module'
  ];
  // Match actual enum values in DB
  const categories = ['code_quality', 'testing', 'documentation', 'infrastructure', 'security', 'performance'] as const;
  const severities = ['low', 'medium', 'high', 'critical'] as const;
  const statuses = ['open', 'in_progress'] as const;

  for (let i = 0; i < count; i++) {
    const createdAt = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000);
    const id = generateId('td');
    
    // Check if we already have enough items
    const existing = await query<any>(
      'SELECT COUNT(*) as cnt FROM technical_debt WHERE company_id = ?',
      [companyId]
    );
    if (existing[0]?.cnt >= count) break;
    
    await query(`
      INSERT INTO technical_debt (id, company_id, team_id, title, description, category, severity, effort_hours, cost_of_delay, priority_score, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      companyId,
      randomFromArray(teamIds),
      titles[i % titles.length],
      `This item needs attention to improve overall system quality and maintainability.`,
      randomFromArray([...categories]),
      randomFromArray([...severities]),
      randomBetween(4, 80),
      randomBetween(100, 5000, 2),
      randomBetween(20, 100, 2),
      randomFromArray([...statuses]),
      createdAt
    ]);
  }
  console.log(`  ✓ Technical debt items seeded (${count} items)`);
}

// Seed developer metrics history
async function seedDeveloperMetricsHistory(companyId: string, days: number = 30): Promise<void> {
  // Get all developers in the company
  const developers = await query<any>(`
    SELECT DISTINCT u.id 
    FROM users u
    JOIN team_members tm ON u.id = tm.user_id
    JOIN teams t ON tm.team_id = t.id
    WHERE t.company_id = ?
  `, [companyId]);

  for (const dev of developers) {
    for (let d = 0; d < days; d++) {
      const recordedDate = new Date();
      recordedDate.setDate(recordedDate.getDate() - d);
      const dateStr = recordedDate.toISOString().split('T')[0];

      const existing = await query<any>(
        'SELECT id FROM developer_metrics WHERE user_id = ? AND recorded_date = ?',
        [dev.id, dateStr]
      );

      if (existing.length === 0) {
        await query(`
          INSERT INTO developer_metrics (user_id, pr_merge_time_avg, code_review_time_avg, focus_time_hours, meeting_time_hours, context_switches_per_day, happiness_score, recorded_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          dev.id,
          randomBetween(4, 24, 2),
          randomBetween(1, 8, 2),
          randomBetween(3, 7, 2),
          randomBetween(1, 4, 2),
          randomBetween(3, 15),
          randomBetween(5, 10, 1),
          dateStr
        ]);
      }
    }
  }
  console.log(`  ✓ Developer metrics history seeded (${developers.length} devs × ${days} days)`);
}

// ============================================================================
// DAILY UPDATE FUNCTIONS
// ============================================================================

async function updateDailyAnalytics(): Promise<void> {
  console.log('📊 [DAILY ANALYTICS] Starting update...', new Date().toISOString());

  try {
    // Get all companies
    const companies = await query<any>('SELECT id FROM companies WHERE is_active = true');

    for (const company of companies) {
      const companyId = company.id;
      
      // Get teams for this company
      const teams = await query<any>('SELECT id FROM teams WHERE company_id = ? AND is_active = true', [companyId]);
      const teamIds = teams.map((t: any) => t.id);

      if (teamIds.length === 0) continue;

      // 1. Update pipeline stage metrics (slight variations)
      await query(`
        UPDATE pipeline_stages 
        SET 
          avg_duration_seconds = avg_duration_seconds + FLOOR(RAND() * 20) - 10,
          success_rate = LEAST(99.99, GREATEST(80, success_rate + (RAND() * 4) - 2)),
          cpu_usage = LEAST(95, GREATEST(10, cpu_usage + (RAND() * 10) - 5)),
          memory_usage = LEAST(95, GREATEST(10, memory_usage + (RAND() * 10) - 5)),
          bottleneck_score = LEAST(100, GREATEST(0, bottleneck_score + (RAND() * 10) - 5))
        WHERE company_id = ?
      `, [companyId]);

      // 2. Add today's business impact metrics
      const today = new Date().toISOString().split('T')[0];
      const metrics = ['Test Coverage', 'Code Quality', 'Deployment Frequency', 'MTTR', 'Change Failure Rate'];
      
      for (const metricName of metrics) {
        const existing = await query<any>(
          'SELECT id FROM business_impact_metrics WHERE company_id = ? AND metric_name = ? AND recorded_date = ?',
          [companyId, metricName, today]
        );

        if (existing.length === 0) {
          await query(`
            INSERT INTO business_impact_metrics (id, company_id, metric_name, quality_score, revenue_impact, customer_satisfaction, feature_adoption_rate, correlation_strength, recorded_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            generateId('bim'),
            companyId,
            metricName,
            randomBetween(60, 95, 2),
            randomBetween(5000, 50000, 2),
            randomBetween(70, 95, 2),
            randomBetween(50, 95, 2),
            randomBetween(0.5, 0.95, 4),
            today
          ]);
        }
      }

      // 3. Add some test execution runs for today
      const testSuites = ['Smoke Tests', 'Regression Suite', 'API Tests', 'E2E Tests'];
      for (let i = 0; i < randomBetween(5, 15); i++) {
        const startTime = new Date(Date.now() - Math.random() * 12 * 60 * 60 * 1000);
        const duration = randomBetween(60, 300);
        const status = randomFromArray(['passed', 'passed', 'passed', 'failed', 'blocked']);

        await query(`
          INSERT INTO test_execution_runs (id, company_id, team_id, test_suite, status, start_time, end_time, duration_seconds)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          generateId('ter'),
          companyId,
          randomFromArray(teamIds),
          randomFromArray(testSuites),
          status,
          startTime,
          new Date(startTime.getTime() + duration * 1000),
          duration
        ]);
      }

      // 4. Add performance metrics for today
      const endpoints = ['/api/auth/login', '/api/users', '/api/teams', '/api/metrics', '/api/dashboard'];
      for (const endpoint of endpoints) {
        const existingPm = await query<any>(
          'SELECT id FROM performance_metrics WHERE company_id = ? AND endpoint = ? AND recorded_date = ?',
          [companyId, endpoint, today]
        );
        if (existingPm.length === 0) {
          await query(`
            INSERT INTO performance_metrics (id, company_id, team_id, endpoint, method, response_time_p50_ms, response_time_p95_ms, response_time_p99_ms, throughput_per_minute, error_rate, recorded_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            generateId('pm'),
            companyId,
            randomFromArray(teamIds),
            endpoint,
            'GET',
            randomBetween(50, 150),
            randomBetween(150, 400),
            randomBetween(400, 800),
            randomBetween(100, 1000),
            randomBetween(0, 3, 2),
            today
          ]);
        }
      }

      // 5. Developer metrics - skip, entered via Manual Metrics Input
      // const developers = await query<any>(`...

      console.log(`  ✓ Company ${companyId} analytics updated`);
    }

    console.log('📊 [DAILY ANALYTICS] ✅ Complete!');
  } catch (error) {
    console.error('📊 [DAILY ANALYTICS] ❌ Failed:', error);
  }
}

// ============================================================================
// FULL SEED FUNCTION (for initial setup)
// ============================================================================

export async function seedAllAnalyticsData(): Promise<void> {
  console.log('📊 Seeding all analytics data...');

  try {
    const companies = await query<any>('SELECT id FROM companies WHERE is_active = true');

    for (const company of companies) {
      const companyId = company.id;
      console.log(`\nSeeding company: ${companyId}`);

      // Get teams
      const teams = await query<any>('SELECT id FROM teams WHERE company_id = ? AND is_active = true', [companyId]);
      const teamIds = teams.map((t: any) => t.id);

      if (teamIds.length === 0) {
        console.log('  ⚠ No teams found, skipping');
        continue;
      }

      // Seed all analytics data
      await seedPipelineStages(companyId);           // CI/CD Pipeline Insights
      await seedBusinessImpactHistory(companyId, 30); // Business Impact Analysis
      await seedTestCases(companyId, teamIds, 30);    // Test Case Management
      await seedFlakyTests(companyId, teamIds);        // Flaky Test Intelligence
      await seedTestExecutionHistory(companyId, teamIds, 100); // Test Execution Timeline
      await seedPerformanceHistory(companyId, teamIds, 30);    // Performance Testing
      await seedTechnicalDebt(companyId, teamIds, 20);         // Technical Debt Tracker
      // Developer Productivity - uses data from Manual Metrics Input (developer_metrics table)
    }

    console.log('\n📊 ✅ All analytics data seeded successfully!');
  } catch (error) {
    console.error('📊 ❌ Seeding failed:', error);
    throw error;
  }
}

// ============================================================================
// CRON SCHEDULE
// ============================================================================

// Daily at 00:30 - Update analytics data
cron.schedule('30 0 * * *', updateDailyAnalytics);
console.log('  📊 Daily analytics job scheduled: 30 0 * * * (daily at 00:30)');

console.log('✅ Analytics sync job initialized!');

// ============================================================================
// EXPORTS
// ============================================================================

export {
  updateDailyAnalytics,
  seedPipelineStages,
  seedBusinessImpactHistory,
  seedTestExecutionHistory,
  seedPerformanceHistory,
  seedTechnicalDebt,
  seedDeveloperMetricsHistory
};
