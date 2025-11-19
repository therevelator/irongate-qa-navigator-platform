/**
 * Data Aggregator Service
 * 
 * This service aggregates data from multiple sources (Jenkins, Jira, SonarQube, etc.)
 * Currently uses mock data, but structured to easily swap in real API calls.
 * 
 * TO CONNECT REAL APIs:
 * 1. Replace mock functions with actual API calls
 * 2. Add API credentials to .env file
 * 3. Uncomment the real API implementations below
 */

// ============================================================================
// CONFIGURATION - Replace with real API endpoints
// ============================================================================

const API_CONFIG = {
  jenkins: {
    baseUrl: import.meta.env.VITE_JENKINS_URL || 'https://jenkins.example.com',
    username: import.meta.env.VITE_JENKINS_USER || 'demo-user',
    token: import.meta.env.VITE_JENKINS_TOKEN || 'demo-token',
  },
  jira: {
    baseUrl: import.meta.env.VITE_JIRA_URL || 'https://company.atlassian.net',
    email: import.meta.env.VITE_JIRA_EMAIL || 'demo@example.com',
    token: import.meta.env.VITE_JIRA_TOKEN || 'demo-token',
  },
  sonarqube: {
    baseUrl: import.meta.env.VITE_SONAR_URL || 'https://sonarqube.example.com',
    token: import.meta.env.VITE_SONAR_TOKEN || 'demo-token',
  },
  github: {
    baseUrl: 'https://api.github.com',
    token: import.meta.env.VITE_GITHUB_TOKEN || 'demo-token',
    org: import.meta.env.VITE_GITHUB_ORG || 'demo-org',
  },
  testrail: {
    baseUrl: import.meta.env.VITE_TESTRAIL_URL || 'https://company.testrail.io',
    email: import.meta.env.VITE_TESTRAIL_EMAIL || 'demo@example.com',
    apiKey: import.meta.env.VITE_TESTRAIL_KEY || 'demo-key',
  },
  datadog: {
    baseUrl: 'https://api.datadoghq.com',
    apiKey: import.meta.env.VITE_DATADOG_API_KEY || 'demo-key',
    appKey: import.meta.env.VITE_DATADOG_APP_KEY || 'demo-app-key',
  },
};

// ============================================================================
// JENKINS AGGREGATOR
// ============================================================================

export class JenkinsAggregator {
  private baseUrl: string;
  private auth: string;

  constructor() {
    this.baseUrl = API_CONFIG.jenkins.baseUrl;
    this.auth = btoa(`${API_CONFIG.jenkins.username}:${API_CONFIG.jenkins.token}`);
  }

  /**
   * Get build metrics for a team
   * Real API: GET /job/{jobName}/api/json
   */
  async getBuildMetrics(jobName: string): Promise<BuildMetrics> {
    // DEMO MODE - Using mock data
    return this.getMockBuildMetrics();

    /* PRODUCTION MODE - Uncomment to use real API:
    try {
      const response = await fetch(`${this.baseUrl}/job/${jobName}/api/json`, {
        headers: {
          'Authorization': `Basic ${this.auth}`,
        },
      });
      
      if (!response.ok) throw new Error('Jenkins API error');
      
      const data = await response.json();
      
      return {
        buildTime: data.lastBuild?.duration || 0,
        successRate: this.calculateSuccessRate(data.builds),
        lastBuildStatus: data.lastBuild?.result || 'UNKNOWN',
        buildFrequency: this.calculateBuildFrequency(data.builds),
      };
    } catch (error) {
      console.error('Jenkins API Error:', error);
      return this.getMockBuildMetrics();
    }
    */
  }

  /**
   * Get test execution metrics
   * Real API: GET /job/{jobName}/lastBuild/testReport/api/json
   */
  async getTestMetrics(jobName: string): Promise<TestMetrics> {
    // DEMO MODE
    return this.getMockTestMetrics();

    /* PRODUCTION MODE:
    try {
      const response = await fetch(
        `${this.baseUrl}/job/${jobName}/lastBuild/testReport/api/json`,
        {
          headers: { 'Authorization': `Basic ${this.auth}` },
        }
      );
      
      const data = await response.json();
      
      return {
        totalTests: data.totalCount || 0,
        passedTests: data.passCount || 0,
        failedTests: data.failCount || 0,
        skippedTests: data.skipCount || 0,
        duration: data.duration || 0,
        flakyTests: this.detectFlakyTests(data.suites),
      };
    } catch (error) {
      console.error('Jenkins Test API Error:', error);
      return this.getMockTestMetrics();
    }
    */
  }

  /**
   * Get pipeline stage metrics
   * Real API: GET /job/{jobName}/lastBuild/wfapi/describe
   */
  async getPipelineMetrics(jobName: string): Promise<PipelineMetrics> {
    // DEMO MODE
    return this.getMockPipelineMetrics();

    /* PRODUCTION MODE:
    try {
      const response = await fetch(
        `${this.baseUrl}/job/${jobName}/lastBuild/wfapi/describe`,
        {
          headers: { 'Authorization': `Basic ${this.auth}` },
        }
      );
      
      const data = await response.json();
      
      return {
        stages: data.stages.map((stage: any) => ({
          name: stage.name,
          duration: stage.durationMillis,
          status: stage.status,
        })),
        totalDuration: data.durationMillis,
        bottleneck: this.identifyBottleneck(data.stages),
      };
    } catch (error) {
      console.error('Jenkins Pipeline API Error:', error);
      return this.getMockPipelineMetrics();
    }
    */
  }

  // Mock data generators
  private getMockBuildMetrics(): BuildMetrics {
    return {
      buildTime: 180000 + Math.random() * 60000, // 3-4 minutes
      successRate: 85 + Math.random() * 10,
      lastBuildStatus: Math.random() > 0.2 ? 'SUCCESS' : 'FAILURE',
      buildFrequency: 15 + Math.floor(Math.random() * 10),
    };
  }

  private getMockTestMetrics(): TestMetrics {
    const total = 1000 + Math.floor(Math.random() * 500);
    const failed = Math.floor(Math.random() * 50);
    const skipped = Math.floor(Math.random() * 20);
    const passed = total - failed - skipped;

    return {
      totalTests: total,
      passedTests: passed,
      failedTests: failed,
      skippedTests: skipped,
      duration: 300 + Math.random() * 200,
      flakyTests: Math.floor(Math.random() * 15),
    };
  }

  private getMockPipelineMetrics(): PipelineMetrics {
    return {
      stages: [
        { name: 'Build', duration: 45000, status: 'SUCCESS' },
        { name: 'Test', duration: 120000, status: 'SUCCESS' },
        { name: 'Quality Gate', duration: 30000, status: 'SUCCESS' },
        { name: 'Deploy', duration: 60000, status: 'SUCCESS' },
      ],
      totalDuration: 255000,
      bottleneck: 'Test',
    };
  }
}

// ============================================================================
// JIRA AGGREGATOR
// ============================================================================

export class JiraAggregator {
  private baseUrl: string;
  private auth: string;

  constructor() {
    this.baseUrl = API_CONFIG.jira.baseUrl;
    this.auth = btoa(`${API_CONFIG.jira.email}:${API_CONFIG.jira.token}`);
  }

  /**
   * Get sprint metrics
   * Real API: GET /rest/agile/1.0/sprint/{sprintId}/issue
   */
  async getSprintMetrics(sprintId: string): Promise<SprintMetrics> {
    // DEMO MODE
    return this.getMockSprintMetrics();

    /* PRODUCTION MODE:
    try {
      const response = await fetch(
        `${this.baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const data = await response.json();
      
      const completedIssues = data.issues.filter(
        (issue: any) => issue.fields.status.name === 'Done'
      );
      
      const velocity = completedIssues.reduce(
        (sum: number, issue: any) => sum + (issue.fields.customfield_10016 || 0),
        0
      );
      
      return {
        velocity,
        committedPoints: this.calculateCommittedPoints(data.issues),
        completedPoints: velocity,
        carryover: data.issues.length - completedIssues.length,
        commitmentRate: (velocity / this.calculateCommittedPoints(data.issues)) * 100,
      };
    } catch (error) {
      console.error('Jira Sprint API Error:', error);
      return this.getMockSprintMetrics();
    }
    */
  }

  /**
   * Get defect metrics
   * Real API: GET /rest/api/3/search with JQL
   */
  async getDefectMetrics(projectKey: string): Promise<DefectMetrics> {
    // DEMO MODE
    return this.getMockDefectMetrics();

    /* PRODUCTION MODE:
    try {
      // Get all bugs
      const allBugsJql = `project = ${projectKey} AND issuetype = Bug AND created >= -30d`;
      const allBugsResponse = await fetch(
        `${this.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(allBugsJql)}`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const allBugs = await allBugsResponse.json();
      
      // Get production bugs
      const prodBugsJql = `${allBugsJql} AND environment = Production`;
      const prodBugsResponse = await fetch(
        `${this.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(prodBugsJql)}`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const prodBugs = await prodBugsResponse.json();
      
      return {
        totalDefects: allBugs.total,
        productionDefects: prodBugs.total,
        defectEscapeRate: (prodBugs.total / allBugs.total) * 100,
        mttr: this.calculateMTTR(allBugs.issues),
        blockedTime: this.calculateBlockedTime(allBugs.issues),
      };
    } catch (error) {
      console.error('Jira Defect API Error:', error);
      return this.getMockDefectMetrics();
    }
    */
  }

  private getMockSprintMetrics(): SprintMetrics {
    const committed = 50 + Math.floor(Math.random() * 30);
    const completed = Math.floor(committed * (0.8 + Math.random() * 0.15));

    return {
      velocity: completed,
      committedPoints: committed,
      completedPoints: completed,
      carryover: Math.floor(Math.random() * 5),
      commitmentRate: (completed / committed) * 100,
    };
  }

  private getMockDefectMetrics(): DefectMetrics {
    const total = 30 + Math.floor(Math.random() * 20);
    const production = Math.floor(total * (0.1 + Math.random() * 0.1));

    return {
      totalDefects: total,
      productionDefects: production,
      defectEscapeRate: (production / total) * 100,
      mttr: 4 + Math.random() * 4, // 4-8 hours
      blockedTime: Math.random() * 10, // 0-10 hours
    };
  }

  private calculateMTTR(issues: any[]): number {
    // Calculate average time from created to resolved
    return 6; // Mock: 6 hours average
  }

  private calculateBlockedTime(issues: any[]): number {
    // Sum time spent in "Blocked" status
    return 5; // Mock: 5 hours total
  }

  private calculateCommittedPoints(issues: any[]): number {
    return 50; // Mock
  }
}

// ============================================================================
// SONARQUBE AGGREGATOR
// ============================================================================

export class SonarQubeAggregator {
  private baseUrl: string;
  private auth: string;

  constructor() {
    this.baseUrl = API_CONFIG.sonarqube.baseUrl;
    this.auth = btoa(`${API_CONFIG.sonarqube.token}:`);
  }

  /**
   * Get code quality metrics
   * Real API: GET /api/measures/component
   */
  async getQualityMetrics(projectKey: string): Promise<QualityMetrics> {
    // DEMO MODE
    return this.getMockQualityMetrics();

    /* PRODUCTION MODE:
    try {
      const metrics = [
        'coverage',
        'sqale_rating',
        'reliability_rating',
        'security_rating',
        'code_smells',
        'bugs',
        'vulnerabilities',
        'ncloc',
      ].join(',');
      
      const response = await fetch(
        `${this.baseUrl}/api/measures/component?component=${projectKey}&metricKeys=${metrics}`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
          },
        }
      );
      
      const data = await response.json();
      const measures = data.component.measures;
      
      return {
        coverage: this.getMeasureValue(measures, 'coverage'),
        maintainabilityRating: this.getMeasureValue(measures, 'sqale_rating'),
        reliabilityRating: this.getMeasureValue(measures, 'reliability_rating'),
        securityRating: this.getMeasureValue(measures, 'security_rating'),
        codeSmells: parseInt(this.getMeasureValue(measures, 'code_smells')),
        bugs: parseInt(this.getMeasureValue(measures, 'bugs')),
        vulnerabilities: parseInt(this.getMeasureValue(measures, 'vulnerabilities')),
        linesOfCode: parseInt(this.getMeasureValue(measures, 'ncloc')),
        qualityScore: this.calculateQualityScore(measures),
      };
    } catch (error) {
      console.error('SonarQube API Error:', error);
      return this.getMockQualityMetrics();
    }
    */
  }

  /**
   * Get technical debt
   * Real API: GET /api/issues/search
   */
  async getTechnicalDebt(projectKey: string): Promise<TechnicalDebtItem[]> {
    // DEMO MODE
    return this.getMockTechnicalDebt();

    /* PRODUCTION MODE:
    try {
      const response = await fetch(
        `${this.baseUrl}/api/issues/search?componentKeys=${projectKey}&types=CODE_SMELL,BUG,VULNERABILITY&ps=500`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
          },
        }
      );
      
      const data = await response.json();
      
      return data.issues.map((issue: any) => ({
        id: issue.key,
        title: issue.message,
        category: this.mapIssueType(issue.type),
        severity: issue.severity.toLowerCase(),
        effort: this.parseEffort(issue.debt),
        costOfDelay: this.calculateCostOfDelay(issue),
        priorityScore: this.calculatePriorityScore(issue),
        createdDate: issue.creationDate,
      }));
    } catch (error) {
      console.error('SonarQube Issues API Error:', error);
      return this.getMockTechnicalDebt();
    }
    */
  }

  private getMockQualityMetrics(): QualityMetrics {
    return {
      coverage: 75 + Math.random() * 20,
      maintainabilityRating: 'A',
      reliabilityRating: 'A',
      securityRating: 'B',
      codeSmells: 150 + Math.floor(Math.random() * 100),
      bugs: 10 + Math.floor(Math.random() * 20),
      vulnerabilities: 3 + Math.floor(Math.random() * 7),
      linesOfCode: 150000 + Math.floor(Math.random() * 50000),
      qualityScore: 80 + Math.random() * 15,
    };
  }

  private getMockTechnicalDebt(): TechnicalDebtItem[] {
    const categories = ['code_quality', 'architecture', 'testing', 'documentation', 'security'];
    const severities = ['low', 'medium', 'high', 'critical'];

    return Array.from({ length: 10 }, (_, i) => ({
      id: `debt-${i}`,
      title: `Technical Debt Item ${i + 1}`,
      category: categories[Math.floor(Math.random() * categories.length)] as any,
      severity: severities[Math.floor(Math.random() * severities.length)] as any,
      effort: 4 + Math.floor(Math.random() * 36), // 4-40 hours
      costOfDelay: 1000 + Math.floor(Math.random() * 9000),
      priorityScore: Math.random() * 100,
      createdDate: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
    }));
  }

  private getMeasureValue(measures: any[], key: string): string {
    const measure = measures.find((m: any) => m.metric === key);
    return measure?.value || '0';
  }

  private calculateQualityScore(measures: any[]): number {
    // Convert ratings to numeric scores
    return 85; // Mock
  }

  private mapIssueType(type: string): string {
    const mapping: Record<string, string> = {
      'CODE_SMELL': 'code_quality',
      'BUG': 'testing',
      'VULNERABILITY': 'security',
    };
    return mapping[type] || 'code_quality';
  }

  private parseEffort(debt: string): number {
    // Parse "30min" to hours
    return 2; // Mock
  }

  private calculateCostOfDelay(issue: any): number {
    return 5000; // Mock
  }

  private calculatePriorityScore(issue: any): number {
    return 75; // Mock
  }
}

// ============================================================================
// GITHUB AGGREGATOR
// ============================================================================

export class GitHubAggregator {
  private baseUrl: string;
  private token: string;
  private org: string;

  constructor() {
    this.baseUrl = API_CONFIG.github.baseUrl;
    this.token = API_CONFIG.github.token;
    this.org = API_CONFIG.github.org;
  }

  /**
   * Get PR metrics for developer productivity
   * Real API: GET /repos/{owner}/{repo}/pulls
   */
  async getPRMetrics(repo: string, developer?: string): Promise<PRMetrics> {
    // DEMO MODE
    return this.getMockPRMetrics();

    /* PRODUCTION MODE:
    try {
      const url = developer
        ? `${this.baseUrl}/repos/${this.org}/${repo}/pulls?state=closed&per_page=100`
        : `${this.baseUrl}/repos/${this.org}/${repo}/pulls?state=closed&per_page=100`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      
      const prs = await response.json();
      
      const mergedPRs = prs.filter((pr: any) => pr.merged_at);
      
      const mergeTimes = mergedPRs.map((pr: any) => {
        const created = new Date(pr.created_at).getTime();
        const merged = new Date(pr.merged_at).getTime();
        return (merged - created) / (1000 * 60 * 60); // hours
      });
      
      return {
        totalPRs: mergedPRs.length,
        avgMergeTime: mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length,
        avgReviewTime: await this.calculateAvgReviewTime(mergedPRs),
      };
    } catch (error) {
      console.error('GitHub API Error:', error);
      return this.getMockPRMetrics();
    }
    */
  }

  private getMockPRMetrics(): PRMetrics {
    return {
      totalPRs: 45 + Math.floor(Math.random() * 20),
      avgMergeTime: 12 + Math.random() * 12, // 12-24 hours
      avgReviewTime: 2 + Math.random() * 3, // 2-5 hours
    };
  }

  private async calculateAvgReviewTime(prs: any[]): Promise<number> {
    return 3.5; // Mock: 3.5 hours average
  }
}

// ============================================================================
// MASTER AGGREGATOR - Combines all sources
// ============================================================================

export class MasterDataAggregator {
  private jenkins: JenkinsAggregator;
  private jira: JiraAggregator;
  private sonarqube: SonarQubeAggregator;
  private github: GitHubAggregator;

  constructor() {
    this.jenkins = new JenkinsAggregator();
    this.jira = new JiraAggregator();
    this.sonarqube = new SonarQubeAggregator();
    this.github = new GitHubAggregator();
  }

  /**
   * Aggregate all metrics for a team
   * This is the main entry point for the dashboard
   */
  async aggregateTeamMetrics(teamConfig: TeamConfig): Promise<AggregatedTeamMetrics> {
    console.log(`🔄 Aggregating metrics for team: ${teamConfig.name}`);

    try {
      // Fetch data from all sources in parallel
      const [buildMetrics, testMetrics, pipelineMetrics, sprintMetrics, defectMetrics, qualityMetrics, prMetrics] =
        await Promise.all([
          this.jenkins.getBuildMetrics(teamConfig.jenkinsJob),
          this.jenkins.getTestMetrics(teamConfig.jenkinsJob),
          this.jenkins.getPipelineMetrics(teamConfig.jenkinsJob),
          this.jira.getSprintMetrics(teamConfig.sprintId),
          this.jira.getDefectMetrics(teamConfig.jiraProject),
          this.sonarqube.getQualityMetrics(teamConfig.sonarProject),
          this.github.getPRMetrics(teamConfig.githubRepo),
        ]);

      // Calculate derived metrics
      const qaScore = this.calculateQAScore({
        testCoverage: qualityMetrics.coverage,
        defectEscapeRate: defectMetrics.defectEscapeRate,
        buildSuccessRate: buildMetrics.successRate,
        codeQualityScore: qualityMetrics.qualityScore,
      });

      console.log(`✅ Metrics aggregated successfully for ${teamConfig.name}`);

      return {
        teamName: teamConfig.name,
        qaScore,
        buildMetrics,
        testMetrics,
        pipelineMetrics,
        sprintMetrics,
        defectMetrics,
        qualityMetrics,
        prMetrics,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`❌ Error aggregating metrics for ${teamConfig.name}:`, error);
      throw error;
    }
  }

  /**
   * Calculate overall QA Score (0-100)
   * Weighted average of key metrics
   */
  private calculateQAScore(metrics: {
    testCoverage: number;
    defectEscapeRate: number;
    buildSuccessRate: number;
    codeQualityScore: number;
  }): number {
    const weights = {
      testCoverage: 0.3,
      defectEscapeRate: 0.25,
      buildSuccessRate: 0.25,
      codeQualityScore: 0.2,
    };

    const score =
      metrics.testCoverage * weights.testCoverage +
      (100 - metrics.defectEscapeRate) * weights.defectEscapeRate +
      metrics.buildSuccessRate * weights.buildSuccessRate +
      metrics.codeQualityScore * weights.codeQualityScore;

    return Math.round(score);
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface TeamConfig {
  name: string;
  jenkinsJob: string;
  jiraProject: string;
  sprintId: string;
  sonarProject: string;
  githubRepo: string;
}

export interface BuildMetrics {
  buildTime: number;
  successRate: number;
  lastBuildStatus: string;
  buildFrequency: number;
}

export interface TestMetrics {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;
  flakyTests: number;
}

export interface PipelineMetrics {
  stages: Array<{
    name: string;
    duration: number;
    status: string;
  }>;
  totalDuration: number;
  bottleneck: string;
}

export interface SprintMetrics {
  velocity: number;
  committedPoints: number;
  completedPoints: number;
  carryover: number;
  commitmentRate: number;
}

export interface DefectMetrics {
  totalDefects: number;
  productionDefects: number;
  defectEscapeRate: number;
  mttr: number;
  blockedTime: number;
}

export interface QualityMetrics {
  coverage: number;
  maintainabilityRating: string;
  reliabilityRating: string;
  securityRating: string;
  codeSmells: number;
  bugs: number;
  vulnerabilities: number;
  linesOfCode: number;
  qualityScore: number;
}

export interface PRMetrics {
  totalPRs: number;
  avgMergeTime: number;
  avgReviewTime: number;
}

export interface TechnicalDebtItem {
  id: string;
  title: string;
  category: 'code_quality' | 'architecture' | 'testing' | 'documentation' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  effort: number;
  costOfDelay: number;
  priorityScore: number;
  createdDate: string;
}

export interface AggregatedTeamMetrics {
  teamName: string;
  qaScore: number;
  buildMetrics: BuildMetrics;
  testMetrics: TestMetrics;
  pipelineMetrics: PipelineMetrics;
  sprintMetrics: SprintMetrics;
  defectMetrics: DefectMetrics;
  qualityMetrics: QualityMetrics;
  prMetrics: PRMetrics;
  lastUpdated: string;
}

// ============================================================================
// EXPORT SINGLETON INSTANCE
// ============================================================================

export const dataAggregator = new MasterDataAggregator();
