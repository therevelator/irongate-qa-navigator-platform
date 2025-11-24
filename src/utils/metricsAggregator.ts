/**
 * Technical Debt Score Calculator
 * 
 * Combines multiple signals to create a comprehensive technical debt index:
 * - SonarQube debt minutes
 * - Code hotspots (frequently changed + complex code)
 * - CI/CD pipeline friction
 * - Bug density relative to delivered value
 */
export function calculateTechnicalDebtScore(
  // Direct from SonarQube
  sonarDebtMinutes: number,
  linesOfCode: number,

  // Code hotspots (risk areas)
  changeFrequency: number,
  cyclomaticComplexity: number,

  // Pipeline friction metrics
  failedBuildRate: number,     // % of builds that fail
  flakyTestRate: number,       // % of tests that randomly fail/pass
  mttrPipeline: number,        // Mean time to restore pipeline

  // Product quality indicators
  productionBugs: number,
  storyPointsCompleted: number,

  // Weights (importance of each component)
  beta1: number = 0.4,    // Sonar debt importance
  beta2: number = 0.25,   // Hotspot risk importance
  beta3: number = 0.2,    // CI friction importance
  beta4: number = 0.15    // Bug density importance
): number {
  /**
   * TechnicalDebtScore =
   *   (β1 * SonarDebtNormalized) +
   *   (β2 * HotspotRisk) +
   *   (β3 * PipelineFriction) +
   *   (β4 * BugDensity)
   */

  // Normalize SonarQube technical debt to "per 1000 LOC"
  const sonarDebt = (sonarDebtMinutes / linesOfCode) * 1000;

  // A hotspot = frequently changed AND complex code
  const hotspotRisk = changeFrequency * cyclomaticComplexity;

  // CI pipeline pain signals
  const pipelineFriction =
    failedBuildRate * 2 +      // failed builds are expensive
    flakyTestRate * 1.5 +      // flaky tests waste engineer time
    mttrPipeline;              // time wasted waiting for fixes

  // Bugs created per unit of value delivered
  const bugDensity = productionBugs / storyPointsCompleted;

  // Final weighted technical debt index
  return (
    beta1 * sonarDebt +
    beta2 * hotspotRisk +
    beta3 * pipelineFriction +
    beta4 * bugDensity
  );
}

/**
 * Task Sizing Accuracy Calculator
 * 
 * Measures how accurately teams estimate work by comparing:
 * - Estimated effort (story points)
 * - Actual effort signals (commits, code changes, PR duration, CI time)
 * 
 * Result interpretation:
 * - 1.0 = Perfect estimation
 * - < 1.0 = Overestimated (delivered faster than expected)
 * - > 1.0 = Underestimated (took longer than expected)
 */
export function calculateTaskSizingAccuracy(
  // Estimated effort from Jira/Azure DevOps
  storyPoints: number,

  // Real engineering activity signals
  commitCount: number,
  linesChanged: number,
  prDurationHours: number,
  buildTimeMinutes: number,
  testTimeMinutes: number,

  // Adjustable weight coefficients
  alpha1: number = 1,      // weight for commit count
  alpha2: number = 0.05,   // weight for lines changed
  alpha3: number = 2,      // weight for PR duration
  alpha4: number = 0.3,    // weight for CI build time
  alpha5: number = 0.2     // weight for test time
): number {
  /**
   * TaskSizingAccuracy = ActualEffort / EstimatedEffort
   * EstimatedEffort = StoryPoints
   */

  // Each commit adds some engineering effort
  const effortCommits = alpha1 * commitCount;

  // Lines added/removed reflect coding effort
  const effortLoc = alpha2 * linesChanged;

  // Long PR cycles = complexity or heavy review
  const effortPr = alpha3 * prDurationHours;

  // Long builds = integration difficulty
  const effortBuild = alpha4 * buildTimeMinutes;

  // Slow tests = verification overhead
  const effortTest = alpha5 * testTimeMinutes;

  // Total measured effort
  const actualEffort =
    effortCommits +
    effortLoc +
    effortPr +
    effortBuild +
    effortTest;

  // Sizing accuracy (ideal = 1.0)
  return actualEffort / storyPoints;
}
