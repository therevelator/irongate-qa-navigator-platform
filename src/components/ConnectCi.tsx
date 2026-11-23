import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, PlugZap } from 'lucide-react';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import { Badge, Card, CardHeader, buttonClass, cx, inputClass } from './ui';

/**
 * Admin console → Connect your CI (super admins; API keys are theirs too): copy-paste steps for
 * GitHub Actions, GitLab CI, Jenkins and Azure DevOps that send the raw test report, coverage
 * report and pipeline run to the v2 raw endpoints; a "send a test call" check (a dry run with a
 * small JUnit report: key, team and endpoint verified, nothing stored); and per team the last data
 * received per kind, with the main branch coverage and pass rate are calculated on.
 * Deployments and incidents (v2 phase 2): steps per CI tool that send the deployment and its commits,
 * steps for PagerDuty, Opsgenie or any other incident tool, and the service → team mapping used for
 * events that carry no team.
 * Issues and code quality (v2 phase 3): steps for Jira (automation webhook and a backfill of the
 * search API), Linear (webhook and GraphQL export) or any tracker (JSON), and the SARIF upload of
 * SonarQube, CodeQL and ESLint per CI tool.
 * Data: GET /api/ci/status, PUT /api/ci/teams/:id/main-branch, GET / PUT / DELETE /api/ci/services.
 */

interface TeamStatus {
  id: string; name: string; department: string | null; departmentId?: string | null; mainBranch: string | null;
  tests: Received; coverage: Received; pipelines: Received;
  deployments?: Received; commits?: Received; incidents?: Received; issues?: Received; staticAnalysis?: Received;
  /** Metrics queued for calculation in the background after the last data (server/lib/calc/queue.ts). */
  calculation?: { pending: boolean; from: string | null; to: string | null; since: string | null; failed: number };
}
interface ServiceMapping { service: string; teamId: string; teamName: string; updatedAt: string }
type Received = { at: string; uploads: number; format: string | null; sample?: boolean } | null;

type Tool = 'github' | 'gitlab' | 'jenkins' | 'azure';
const TOOLS: Array<{ id: Tool; label: string; file: string }> = [
  { id: 'github', label: 'GitHub Actions', file: '.github/workflows/ci.yml (steps at the end of the test job)' },
  { id: 'gitlab', label: 'GitLab CI', file: '.gitlab-ci.yml' },
  { id: 'jenkins', label: 'Jenkins', file: 'Jenkinsfile (declarative pipeline)' },
  { id: 'azure', label: 'Azure DevOps', file: 'azure-pipelines.yml' },
];

/** The absolute API base the CI calls (this site). */
export function apiBase(): string {
  try { return new URL(API_URL, window.location.origin).href.replace(/\/$/, ''); } catch { return API_URL; }
}

export function snippet(tool: Tool, base: string, team: string): string {
  const send = (kind: string, file: string, auth: string, common: string) =>
    `gzip -c ${file} | curl -sS --fail-with-body -X POST "${base}/ingest/${kind}?${common}" \\\n  -H "Authorization: Bearer ${auth}" -H "Content-Encoding: gzip" --data-binary @-`;
  if (tool === 'github') {
    const common = `team=${team}&commit=\${GITHUB_SHA}&branch=\${GITHUB_REF_NAME}&run=\${GITHUB_RUN_ID}&attempt=\${GITHUB_RUN_ATTEMPT}`;
    return `      # Add the key as a repository secret named QE_NAVIGATOR_API_KEY.
      - name: Send test and coverage reports to QE Navigator
        if: always()
        env:
          QE_NAVIGATOR_API_KEY: \${{ secrets.QE_NAVIGATOR_API_KEY }}
        run: |
          ${send('tests', 'test-results/junit.xml', '$QE_NAVIGATOR_API_KEY', common).replace(/\n/g, '\n          ')}
          ${send('coverage', 'coverage/lcov.info', '$QE_NAVIGATOR_API_KEY', common).replace(/\n/g, '\n          ')}

      - name: Send the pipeline run to QE Navigator
        if: always()
        env:
          QE_NAVIGATOR_API_KEY: \${{ secrets.QE_NAVIGATOR_API_KEY }}
          GH_TOKEN: \${{ github.token }}
        run: |
          STARTED=$(gh api repos/\${{ github.repository }}/actions/runs/\${{ github.run_id }} --jq .run_started_at)
          curl -sS --fail-with-body -X POST "${base}/ingest/pipelines?team=${team}" \\
            -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" \\
            -d "{\\"id\\":\\"\${GITHUB_RUN_ID}\\",\\"attempt\\":\${GITHUB_RUN_ATTEMPT},\\"name\\":\\"\${GITHUB_WORKFLOW}\\",\\"commit\\":\\"\${GITHUB_SHA}\\",\\"branch\\":\\"\${GITHUB_REF_NAME}\\",\\"startedAt\\":\\"$STARTED\\",\\"finishedAt\\":\\"$(date -u +%FT%TZ)\\",\\"result\\":\\"\${{ job.status }}\\",\\"url\\":\\"\${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/actions/runs/\${GITHUB_RUN_ID}\\"}"`;
  }
  if (tool === 'gitlab') {
    const common = `team=${team}&commit=\${CI_COMMIT_SHA}&branch=\${CI_COMMIT_REF_NAME}&run=\${CI_JOB_ID}`;
    const event = (result: string) => `curl -sS --fail-with-body -X POST "${base}/ingest/pipelines?team=${team}" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" -d "{\\"id\\":\\"$CI_PIPELINE_ID\\",\\"commit\\":\\"$CI_COMMIT_SHA\\",\\"branch\\":\\"$CI_COMMIT_REF_NAME\\",\\"startedAt\\":\\"$CI_PIPELINE_CREATED_AT\\",\\"finishedAt\\":\\"$(date -u +%FT%TZ)\\",\\"result\\":\\"${result}\\",\\"url\\":\\"$CI_PIPELINE_URL\\"}"`;
    return `# Add the key as a masked CI/CD variable named QE_NAVIGATOR_API_KEY.
test:
  stage: test
  script:
    - npm test            # writes junit.xml and coverage/lcov.info
  after_script:
    - ${send('tests', 'junit.xml', '$QE_NAVIGATOR_API_KEY', common).replace(/ \\\n  /g, ' ')}
    - ${send('coverage', 'coverage/lcov.info', '$QE_NAVIGATOR_API_KEY', common).replace(/ \\\n  /g, ' ')}

qe-navigator-pipeline-passed:
  stage: .post
  when: on_success
  script:
    - ${event('success')}

qe-navigator-pipeline-failed:
  stage: .post
  when: on_failure
  script:
    - ${event('failed')}`;
  }
  if (tool === 'jenkins') {
    const common = `team=${team}&commit=\${GIT_COMMIT}&branch=\${BRANCH_NAME}&run=\${BUILD_NUMBER}`;
    return `// Add the key as a "Secret text" credential with the id qe-navigator-api-key.
post {
  always {
    withCredentials([string(credentialsId: 'qe-navigator-api-key', variable: 'QE_NAVIGATOR_API_KEY')]) {
      sh '''
        # Every Surefire file (one per test class) in one upload: one run.
        curl -sS --fail-with-body -X POST "${base}/ingest/tests" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" \\
          -F team=${team} -F commit=$GIT_COMMIT -F branch=$BRANCH_NAME -F run=$BUILD_NUMBER \\
          $(for f in target/surefire-reports/TEST-*.xml; do printf -- '-F report=@%s ' "$f"; done)
        ${send('coverage', 'target/site/jacoco/jacoco.xml', '$QE_NAVIGATOR_API_KEY', common).replace(/\n/g, '\n        ')}
      '''
      script {
        def started = new Date(currentBuild.startTimeInMillis).format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone('UTC'))
        def body = groovy.json.JsonOutput.toJson([id: env.BUILD_TAG, commit: env.GIT_COMMIT, branch: env.BRANCH_NAME,
          startedAt: started, durationSeconds: (currentBuild.duration / 1000) as long, result: currentBuild.currentResult, url: env.BUILD_URL])
        writeFile file: 'qe-pipeline.json', text: body
      }
      sh 'curl -sS --fail-with-body -X POST "${base}/ingest/pipelines?team=${team}" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" --data-binary @qe-pipeline.json'
    }
  }
}`;
  }
  const common = `team=${team}&commit=$(Build.SourceVersion)&branch=$(Build.SourceBranchName)&run=$(Build.BuildId)&attempt=$(System.JobAttempt)`;
  return `# Add the key as a secret pipeline variable named QE_NAVIGATOR_API_KEY.
- script: |
    ${send('tests', '$(Agent.TempDirectory)/TestResults/*.trx', '$QE_NAVIGATOR_API_KEY', common).replace(/\n/g, '\n    ')}
    ${send('coverage', 'coverage/cobertura-coverage.xml', '$QE_NAVIGATOR_API_KEY', common).replace(/\n/g, '\n    ')}
    curl -sS --fail-with-body -X POST "${base}/ingest/pipelines?team=${team}" \\
      -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" \\
      -d "{\\"id\\":\\"$(Build.BuildId)\\",\\"attempt\\":$(System.JobAttempt),\\"commit\\":\\"$(Build.SourceVersion)\\",\\"branch\\":\\"$(Build.SourceBranchName)\\",\\"startedAt\\":\\"$(System.PipelineStartTime)\\",\\"finishedAt\\":\\"$(date -u +%FT%TZ)\\",\\"result\\":\\"$(Agent.JobStatus)\\"}"
  displayName: Send results to QE Navigator
  condition: always()
  env:
    QE_NAVIGATOR_API_KEY: $(QE_NAVIGATOR_API_KEY)`;
}

const DEPLOY_TOOLS: Array<{ id: Tool; label: string; file: string }> = [
  { id: 'github', label: 'GitHub Actions', file: '.github/workflows/deploy.yml (a step at the end of the production deploy job)' },
  { id: 'gitlab', label: 'GitLab CI', file: '.gitlab-ci.yml (the production deploy job), or a deployment webhook' },
  { id: 'jenkins', label: 'Jenkins', file: 'Jenkinsfile of the production deploy (declarative pipeline)' },
  { id: 'azure', label: 'Azure DevOps', file: 'azure-pipelines.yml (the production deployment job)' },
];

type IncidentTool = 'pagerduty' | 'opsgenie' | 'other';
const INCIDENT_TOOLS: Array<{ id: IncidentTool; label: string; file: string }> = [
  { id: 'pagerduty', label: 'PagerDuty', file: 'PagerDuty → Integrations → Generic Webhooks (v3), and a backfill from the REST API' },
  { id: 'opsgenie', label: 'Opsgenie', file: 'Opsgenie → Settings → Integrations → Webhook, and a backfill from the Alert API' },
  { id: 'other', label: 'Other tool (JSON)', file: 'Any incident tool or script: create an incident, then send its status updates with the same id' },
];

/** Steps that send the production deployment and its commits (QE Navigator calculates DORA from them). */
export function deliverySnippet(tool: Tool, base: string, team: string): string {
  const auth = '-H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json"';
  // The commits of the deploy, from git log (author e-mails are stored only as a salted hash).
  const commits = (id: string, prev: string, head: string, indent: string) => [
    `git log --format='%H%x09%aI%x09%cI%x09%ae' "${prev}..${head}" | jq -R -s -c --arg id "${id}" \\`,
    `  '{deployment: $id, commits: (split("\\n") | map(select(length > 0) | split("\\t") | {sha: .[0], authoredAt: .[1], committedAt: .[2], author: .[3]}))}' > qe-commits.json`,
    `curl -sS --fail-with-body -X POST "${base}/ingest/commits?team=${team}" ${auth} --data-binary @qe-commits.json`,
  ].join(`\n${indent}`);
  if (tool === 'github') {
    const i = '          ';
    return `      # In the production deploy job, after the deploy step (actions/checkout with fetch-depth: 0).
      # The tag "deployed-production" marks the last commit deployed; the commits since then are this deploy's.
      - name: Send the deployment to QE Navigator
        if: always()
        env:
          QE_NAVIGATOR_API_KEY: \${{ secrets.QE_NAVIGATOR_API_KEY }}
          RESULT: \${{ job.status }}
        run: |
          PREV=$(git rev-parse -q --verify refs/tags/deployed-production || git rev-list --max-parents=0 HEAD | tail -1)
          DEPLOY_ID="\${GITHUB_RUN_ID}-\${GITHUB_RUN_ATTEMPT}"
          ${commits('$DEPLOY_ID', '$PREV', '$GITHUB_SHA', i)}
          curl -sS --fail-with-body -X POST "${base}/ingest/deployments?team=${team}" ${auth} \\
            -d "{\\"id\\":\\"$DEPLOY_ID\\",\\"environment\\":\\"production\\",\\"service\\":\\"\${{ github.event.repository.name }}\\",\\"commit\\":\\"$GITHUB_SHA\\",\\"commitRange\\":\\"$PREV..$GITHUB_SHA\\",\\"finishedAt\\":\\"$(date -u +%FT%TZ)\\",\\"result\\":\\"$RESULT\\",\\"url\\":\\"\${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/actions/runs/\${GITHUB_RUN_ID}\\"}"
          if [ "$RESULT" = "success" ]; then git tag -f deployed-production "$GITHUB_SHA" && git push -f origin deployed-production; fi
      # Moving the tag needs "permissions: contents: write" for the job.
      # A hotfix deploy: add "hotfix": true to the JSON. A rollback: "rollbackOf": "<the id of the deploy it undoes>".`;
  }
  if (tool === 'gitlab') {
    const i = '    - ';
    return `# Add the key as a masked CI/CD variable named QE_NAVIGATOR_API_KEY. In the production deploy job:
deploy-production:
  stage: deploy
  environment: production
  script:
    - ./deploy.sh
  after_script:
    - PREV=$(git rev-parse -q --verify refs/tags/deployed-production || git rev-list --max-parents=0 HEAD | tail -1)
    - ${commits('$CI_JOB_ID', '$PREV', '$CI_COMMIT_SHA', i).replace(/ \\\n {4}- {2}/g, ' ')}
    - >-
      curl -sS --fail-with-body -X POST "${base}/ingest/deployments?team=${team}" ${auth}
      -d "{\\"id\\":\\"$CI_JOB_ID\\",\\"environment\\":\\"$CI_ENVIRONMENT_NAME\\",\\"service\\":\\"$CI_PROJECT_NAME\\",\\"commit\\":\\"$CI_COMMIT_SHA\\",\\"commitRange\\":\\"$PREV..$CI_COMMIT_SHA\\",\\"startedAt\\":\\"$CI_JOB_STARTED_AT\\",\\"finishedAt\\":\\"$(date -u +%FT%TZ)\\",\\"result\\":\\"$CI_JOB_STATUS\\",\\"url\\":\\"$CI_JOB_URL\\"}"
    # Move the "deployed-production" tag (QE_TAG_TOKEN: a project access token with write_repository).
    - if [ "$CI_JOB_STATUS" = "success" ]; then git tag -f deployed-production "$CI_COMMIT_SHA" && git push -f "https://oauth2:$QE_TAG_TOKEN@$CI_SERVER_HOST/$CI_PROJECT_PATH.git" refs/tags/deployed-production; fi

# Or, without a CI step: Settings → Webhooks → Deployment events, URL ${base}/ingest/deployments?team=${team}
# with the custom header Authorization: Bearer <key> (the GitLab deployment payload is understood as it is).`;
  }
  if (tool === 'jenkins') {
    const i = '        ';
    return `// In the production deploy pipeline. The git plugin sets GIT_PREVIOUS_SUCCESSFUL_COMMIT (the last commit built successfully).
post {
  always {
    withCredentials([string(credentialsId: 'qe-navigator-api-key', variable: 'QE_NAVIGATOR_API_KEY')]) {
      sh '''
        PREV=\${GIT_PREVIOUS_SUCCESSFUL_COMMIT:-$(git rev-list --max-parents=0 HEAD | tail -1)}
        ${commits('$BUILD_TAG', '$PREV', '$GIT_COMMIT', i)}
      '''
      script {
        def body = groovy.json.JsonOutput.toJson([id: env.BUILD_TAG, environment: 'production', service: env.JOB_BASE_NAME, commit: env.GIT_COMMIT,
          startedAt: new Date(currentBuild.startTimeInMillis).format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone('UTC')),
          finishedAt: new Date().format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone('UTC')), result: currentBuild.currentResult, url: env.BUILD_URL])
        writeFile file: 'qe-deployment.json', text: body
      }
      sh 'curl -sS --fail-with-body -X POST "${base}/ingest/deployments?team=${team}" ${auth} --data-binary @qe-deployment.json'
    }
  }
}`;
  }
  const i = '    ';
  return `# Add the key as a secret pipeline variable named QE_NAVIGATOR_API_KEY. In the production deployment job:
- script: |
    PREV=$(git rev-parse -q --verify refs/tags/deployed-production || git rev-list --max-parents=0 HEAD | tail -1)
    ${commits('$(Build.BuildId)-$(System.JobAttempt)', '$PREV', '$(Build.SourceVersion)', i)}
    curl -sS --fail-with-body -X POST "${base}/ingest/deployments?team=${team}" ${auth} \\
      -d "{\\"id\\":\\"$(Build.BuildId)-$(System.JobAttempt)\\",\\"environment\\":\\"production\\",\\"service\\":\\"$(Build.Repository.Name)\\",\\"commit\\":\\"$(Build.SourceVersion)\\",\\"commitRange\\":\\"$PREV..$(Build.SourceVersion)\\",\\"startedAt\\":\\"$(System.PipelineStartTime)\\",\\"finishedAt\\":\\"$(date -u +%FT%TZ)\\",\\"result\\":\\"$(Agent.JobStatus)\\"}"
    # Move the "deployed-production" tag (the job needs "Allow scripts to access the OAuth token" and Contribute permission).
    if [ "$(Agent.JobStatus)" = "Succeeded" ]; then git tag -f deployed-production "$(Build.SourceVersion)" && git -c http.extraheader="AUTHORIZATION: bearer $(System.AccessToken)" push -f origin refs/tags/deployed-production; fi
  displayName: Send the deployment to QE Navigator
  condition: always()
  env:
    QE_NAVIGATOR_API_KEY: $(QE_NAVIGATOR_API_KEY)`;
}

/** Steps that send incidents (created, acknowledged, resolved: QE Navigator calculates MTTR, MTBF and availability). */
export function incidentSnippet(tool: IncidentTool, base: string, team: string): string {
  if (tool === 'pagerduty') {
    return `# 1. Live: PagerDuty → Integrations → Generic Webhooks (v3) → New webhook
#    Webhook URL:     ${base}/ingest/incidents?team=${team}
#    Scope type:      the team's service (or the account, with the service → team mapping below)
#    Events:          incident.triggered, incident.acknowledged, incident.resolved, incident.reopened, incident.priority_updated
#    Custom header:   Authorization = Bearer <your QE Navigator API key>
#    Priority P1 / P2 counts as an outage for availability; urgency is used when there is no priority.
#
# 2. Backfill (once): the incidents of the last months, from the REST API, as they are.
curl -sS "https://api.pagerduty.com/incidents?since=2026-09-01T00:00:00Z&statuses%5B%5D=resolved&limit=100" \\
  -H "Authorization: Token token=$PAGERDUTY_API_TOKEN" -H "Accept: application/vnd.pagerduty+json;version=2" |
curl -sS --fail-with-body -X POST "${base}/ingest/incidents?team=${team}&format=pagerduty" \\
  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" --data-binary @-`;
  }
  if (tool === 'opsgenie') {
    return `# 1. Live: Opsgenie → Settings → Integrations → Webhook
#    Webhook URL:     ${base}/ingest/incidents?team=${team}
#    Alert actions:   Create, Acknowledge, Close (tick "Add alert details to payload")
#    Custom header:   Authorization = Bearer <your QE Navigator API key>
#    The service comes from the alert detail "service", a tag "service:<name>" or the alert entity.
#    Priority P1 / P2 counts as an outage for availability.
#
# 2. Backfill (once): closed alerts from the Alert API, as they are.
curl -sS "https://api.opsgenie.com/v2/alerts?query=status%3Aclosed&limit=100&sort=createdAt" \\
  -H "Authorization: GenieKey $OPSGENIE_API_KEY" |
curl -sS --fail-with-body -X POST "${base}/ingest/incidents?team=${team}&format=opsgenie" \\
  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" --data-binary @-`;
  }
  return `# Open an incident (severity: critical, high, medium, low, info, or SEV1–SEV5 / P1–P5).
# deploymentId links it to the deploy that caused it: that deploy counts as a failed change.
curl -sS --fail-with-body -X POST "${base}/ingest/incidents?team=${team}" \\
  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"id":"INC-1042","title":"Card payments failing","severity":"SEV2","service":"payments-api","openedAt":"2026-11-18T09:12:00Z","deploymentId":"rel-2026-11-18.3"}'

# Later: status updates with the same id (acknowledged, resolved, reopened).
curl -sS --fail-with-body -X POST "${base}/ingest/incidents?team=${team}" \\
  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"id":"INC-1042","status":"resolved","at":"2026-11-18T10:05:00Z"}'`;
}

type IssueTool = 'jira' | 'linear' | 'json';
const ISSUE_TOOLS: Array<{ id: IssueTool; label: string; file: string }> = [
  { id: 'jira', label: 'Jira', file: 'Jira automation rule (live) and a search export (backfill)' },
  { id: 'linear', label: 'Linear', file: 'Linear webhook (live) and a GraphQL export (backfill)' },
  { id: 'json', label: 'Other tracker (JSON)', file: 'Any script or tool' },
];

/** QE Navigator Exporter (exporter/ in the QE Navigator repository): setup page, config file, container, Kubernetes and plain Node. */
export type AgentTab = 'setup' | 'config' | 'docker' | 'kubernetes' | 'node';
export const AGENT_TABS: Array<{ id: AgentTab; label: string; file: string }> = [
  { id: 'setup', label: 'Setup page', file: 'qe-exporter setup: a local page (127.0.0.1 only, one-time token) to connect your tools and pick the team per source' },
  { id: 'config', label: 'Config file', file: 'qe-exporter.yaml, for people who prefer files (no secrets in it; your ids are filled in)' },
  { id: 'docker', label: 'Docker', file: 'Container: non-root, read-only file system, no shell' },
  { id: 'kubernetes', label: 'Kubernetes', file: 'CronJob every 15 minutes (exporter/deploy/kubernetes/cronjob.yaml)' },
  { id: 'node', label: 'Node 20 (no container)', file: 'One file, no dependencies: qe-exporter.mjs, with a cron or systemd timer' },
];
export const AGENT_VERSION = '0.5.0';

export type ExporterCi = 'github' | 'gitlab' | 'bitbucket' | 'jenkins' | 'azure-devops' | 'none';
export const EXPORTER_CIS: Array<{ id: ExporterCi; label: string; file: string }> = [
  { id: 'github', label: 'GitHub Actions', file: 'Fine-grained token (Actions, Contents, Deployments, Metadata: read), a GitHub App, or OAuth with your own OAuth app' },
  { id: 'gitlab', label: 'GitLab CI', file: 'Access token with the read_api scope (Reporter), or OAuth with your own GitLab application' },
  { id: 'bitbucket', label: 'Bitbucket', file: 'Cloud: app password or OAuth consumer (read scopes); Data Center: HTTP access token (read)' },
  { id: 'jenkins', label: 'Jenkins', file: 'User + API token (Overall/Read, Job/Read)' },
  { id: 'azure-devops', label: 'Azure DevOps', file: 'PAT: Build, Test Management, Code, Environment (Read)' },
  { id: 'none', label: 'No CI (issues and incidents only)', file: 'Jira, Linear, PagerDuty, Opsgenie' },
];

/** What the Exporter sends: the raw data, minimised; QE Navigator calculates everything. */
export const AGENT_FIELDS = {
  ci: 'test report and coverage files as they are (JUnit, TRX, Cucumber; lcov, Cobertura, JaCoCo, Istanbul), SARIF, pipeline runs with their jobs, steps and times, deployments with their commits (sha and times)',
  issues: 'key, type, status, status category, resolution, environment (production / pre-release only), story points, estimate and time logged, created / resolved / updated, sprints, status / sprint / flagged changes with their times',
  incidents: 'id, service, severity, status, opened / acknowledged / resolved, status changes with their times, linked deployment, category',
  never: 'your tool credentials, descriptions, comments, attachments, build logs, commit messages, names and e-mail addresses of people (commit authors become a salted hash on our side), custom free-text fields',
};

const yamlKey = (k: string) => (/^[A-Za-z0-9_./-]+$/.test(k) ? k : JSON.stringify(k));

/** qe-exporter.yaml for a CI, with the company, department and team ids filled in. */
export function agentConfigSnippet(origin: string, companyId: string, teams: Array<{ id: string; name: string; departmentId?: string | null }>, services: Array<{ service: string; teamId: string }> = [], ci: ExporterCi = 'github'): string {
  const list = teams.length ? teams : [{ id: '<team id>', name: 'your team', departmentId: '<department id>' }];
  const keyLines = (placeholder: string, indent = '      ') => list.map((t, i) => `${indent}${i === 0 ? '' : '# '}${placeholder}${i === 0 ? '' : String(i + 1)}: ${t.id}   # ${t.name.replace(/[\r\n#]/g, ' ')}`).join('\n');
  const svc = services.length ? services.map((m) => `      ${yamlKey(m.service)}: ${m.teamId}`).join('\n') : keyLines('payments-api');
  const secrets = ci === 'github' ? 'GITHUB_TOKEN' : ci === 'gitlab' ? 'GITLAB_TOKEN' : ci === 'bitbucket' ? 'BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD (Data Center: BITBUCKET_TOKEN)' : ci === 'jenkins' ? 'JENKINS_USER + JENKINS_TOKEN' : ci === 'azure-devops' ? 'AZURE_DEVOPS_TOKEN' : '';
  const ciSource = ci === 'github' ? `  - name: github
    type: github
    # apiUrl: https://github.example.com/api/v3   # GitHub Enterprise Server
    repos:   # owner/name → team id
${keyLines('your-org/your-repo')}
    environments: [production]   # deployments to these environments count
`
    : ci === 'gitlab' ? `  - name: gitlab
    type: gitlab
    # apiUrl: https://gitlab.example.com/api/v4   # self-managed
    projects:   # group/project → team id
${keyLines('your-group/your-project')}
    environments: [production]
`
    : ci === 'bitbucket' ? `  - name: bitbucket
    type: bitbucket            # Bitbucket Cloud (bitbucket-dc: Data Center, with baseUrl)
    repos:   # workspace/repo → team id
${keyLines('your-workspace/your-repo')}
    environments: [production]
`
    : ci === 'jenkins' ? `  - name: jenkins
    type: jenkins
    baseUrl: https://jenkins.example.com
    user: qe-exporter
    jobs:   # folder/job → team id
${keyLines('your-folder/your-job')}
`
    : ci === 'azure-devops' ? `  - name: azure
    type: azure-devops
    orgUrl: https://dev.azure.com/your-org
    project: YourProject
    pipelines:   # pipeline name (or definition id) → team id
${keyLines('your-pipeline')}
    environments: [Production]
`
    : '';
  const deps = Array.from(new Map(list.map((t) => [t.id, t.departmentId ?? '<department id>'])).entries());
  return `# qe-exporter ${AGENT_VERSION} configuration (or run "qe-exporter setup" and do this on a local page).
# Secrets are NOT in this file: set them as environment variables (or let the setup page keep them in its
# credentials file): QE_API_KEY (an igk_ key from Admin console → API keys)${secrets ? `, ${secrets}` : ''}, and
# for the other sources SONAR_TOKEN, JIRA_TOKEN (+ JIRA_EMAIL), LINEAR_API_KEY, PAGERDUTY_TOKEN, OPSGENIE_API_KEY.
# Every request carries companyId, departmentId and teamId; QE Navigator refuses any id that is not yours.
qeNavigator:
  url: ${origin}
  companyId: ${companyId || '<company id>'}
teams:   # team id → its department id
${deps.map(([t, d]) => `  ${t}: ${d}`).join('\n')}
state:
  path: /var/lib/qe-exporter/state.json   # cursors only; no data is kept
backfillDays: 90
sources:
${ciSource}  - name: jira
    type: jira
    baseUrl: https://your-site.atlassian.net   # Server / Data Center: your Jira URL and auth: bearer
    auth: basic
    email: qe-exporter@your-company.example
    jql: project in (PAY)
    teams:   # Jira project key → team id
${keyLines('PAY')}
  - name: pagerduty
    type: pagerduty
    services:   # PagerDuty service name → team id
${svc}
`;
}

export function agentRunSnippet(tab: AgentTab, origin: string, ci: ExporterCi = 'github'): string {
  let host = origin;
  try { host = new URL(origin).host; } catch { /* keep as given */ }
  const token = ci === 'github' ? '-e GITHUB_TOKEN' : ci === 'gitlab' ? '-e GITLAB_TOKEN' : ci === 'bitbucket' ? '-e BITBUCKET_USERNAME -e BITBUCKET_APP_PASSWORD' : ci === 'jenkins' ? '-e JENKINS_USER -e JENKINS_TOKEN' : ci === 'azure-devops' ? '-e AZURE_DEVOPS_TOKEN' : '';
  const ciHost = ci === 'github' ? 'api.github.com' : ci === 'gitlab' ? 'gitlab.com (or yours)' : ci === 'bitbucket' ? 'api.bitbucket.org (or your Bitbucket)' : ci === 'jenkins' ? 'your Jenkins' : ci === 'azure-devops' ? 'dev.azure.com' : 'your tools';
  if (tab === 'setup') return `# 1. Start the setup page (bound to 127.0.0.1 only; it prints a one-time link with a token)
docker run --rm -it -p 127.0.0.1:8788:8788 -v qe-exporter:/var/lib/qe-exporter qe-exporter:${AGENT_VERSION} setup
#    or, without Docker:  node qe-exporter.mjs setup

# 2. Open the printed link (http://127.0.0.1:8788/?token=…) and:
#    - paste your QE Navigator API key (Admin console → API keys): the page loads your company, departments and teams
#    - connect each tool (token, app password, service account, or OAuth with your own OAuth app) and test it
#    - pick the department and team for each repository, project, pipeline or service
#    - save: the config is written to the volume, the credentials to a 0600 file in a 0700 folder (never sent to us)

# 3. See exactly what would be sent (the JSON with the three ids; nothing is sent), then sync
docker run --rm -v qe-exporter:/var/lib/qe-exporter qe-exporter:${AGENT_VERSION} preview
docker run --rm -v qe-exporter:/var/lib/qe-exporter qe-exporter:${AGENT_VERSION} sync`;
  if (tab === 'docker') return `# Build the image from the repository root, or load the image you were given:
docker build -f exporter/Dockerfile -t qe-exporter:${AGENT_VERSION} .

# 1. Check the config, each source and QE Navigator (prints what would be read; never prints secrets)
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \\
  -v "$PWD/qe-exporter.yaml:/etc/qe-exporter/qe-exporter.yaml:ro" -v qe-exporter:/var/lib/qe-exporter \\
  -e QE_API_KEY ${token} -e JIRA_TOKEN -e JIRA_EMAIL qe-exporter:${AGENT_VERSION} check

# 2. See exactly what would be sent: every JSON body with companyId, departmentId and teamId (nothing is sent)
docker run --rm --read-only ... qe-exporter:${AGENT_VERSION} preview --out /var/lib/qe-exporter/preview.json

# 3. Sync: reads backfillDays the first time, then what changed; sends the raw data; heartbeat
docker run --rm --read-only ... qe-exporter:${AGENT_VERSION} sync`;
  if (tab === 'kubernetes') return `kubectl create namespace qe-exporter
kubectl -n qe-exporter create secret generic qe-exporter-secrets \\
  --from-literal=QE_API_KEY=igk_... ${token ? `--from-literal=${token.replace(/-e /g, '').split(' ')[0]}=...` : ''} --from-literal=JIRA_TOKEN=...
kubectl -n qe-exporter create configmap qe-exporter-config --from-file=qe-exporter.yaml
kubectl -n qe-exporter apply -f exporter/deploy/kubernetes/cronjob.yaml -f exporter/deploy/kubernetes/networkpolicy.yaml

# Egress: only TCP 443 to ${host} and ${ciHost} (and your other tools); no ingress at all.
kubectl -n qe-exporter create job --from=cronjob/qe-exporter qe-exporter-first-run   # run once now
kubectl -n qe-exporter logs job/qe-exporter-first-run`;
  if (tab === 'node') return `# Node 20 or later; the Exporter is one file without dependencies. Verify it first:
sha256sum -c SHA256SUMS            # qe-exporter.mjs: OK
node qe-exporter.mjs --version     # qe-exporter ${AGENT_VERSION}

export QE_API_KEY=igk_... ${token.replace(/-e (\w+)/g, '$1=...')}
node qe-exporter.mjs check   -c qe-exporter.yaml
node qe-exporter.mjs preview -c qe-exporter.yaml --offline   # reads your tools, sends nothing
node qe-exporter.mjs sync    -c qe-exporter.yaml

# Every 15 minutes (cron); exit codes: 0 ok, 2 config, 3 a source, 4 QE Navigator, 5 still running, 6 some records refused
*/15 * * * * qe-exporter  . /etc/qe-exporter/env && node /opt/qe-exporter/qe-exporter.mjs sync -c /etc/qe-exporter/qe-exporter.yaml --log-format json >> /var/log/qe-exporter.log 2>&1
# or the systemd timer in exporter/deploy/systemd/`;
  return '';
}

export interface ExporterStatus {
  apiKeyName: string | null; keyRevoked: boolean; version: string;
  sources: Array<{ name: string; type: string; lastSuccessAt: string | null; errors: number; lastErrorAt: string | null; lastErrorKind: string | null }>;
  firstSeen: string; lastSeen: string; beats: number; outdated: boolean; latestVersion: string; stale: boolean;
}

/** Steps that send issues (QE Navigator calculates escape rate, density, velocity, commitment, carryover, blocked time, sizing accuracy). */
export function issueSnippet(tool: IssueTool, base: string, team: string): string {
  if (tool === 'jira') {
    return `# 1. Live: Jira → Project settings → Automation → Create rule
#    When:  Issue created / Issue transitioned / Field value changed (Sprint, Story points, Flagged)
#    Then:  Send web request
#      URL:     ${base}/ingest/issues?team=${team}&format=jira
#      Headers: Authorization = Bearer <your QE Navigator API key>, Content-Type = application/json
#      Body:    Issue data (Jira format)
#
# 2. Backfill (once, a page of 100 at a time): the issues of the last year with their changelog.
#    expand=changelog,names lets QE Navigator find the Story points and Sprint fields by name
#    (or pass &storyPointsField=customfield_10016&sprintField=customfield_10020).
curl -sS -u "$JIRA_EMAIL:$JIRA_API_TOKEN" -G "https://your-site.atlassian.net/rest/api/3/search/jql" \\
  --data-urlencode "jql=project = PAY AND updated >= -365d ORDER BY updated" \\
  --data-urlencode "fields=*all" --data-urlencode "expand=changelog,names" --data-urlencode "maxResults=100" |
curl -sS --fail-with-body -X POST "${base}/ingest/issues?team=${team}&format=jira" \\
  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" --data-binary @-
# Escaped defects: set the bug's Environment field (Production, Staging, …) or a label such as
# "production" / "env:staging"; a custom "Found in" field works with &environmentField=customfield_…`;
  }
  if (tool === 'linear') {
    return `# 1. Live: Linear → Settings → API → Webhooks → New webhook
#    URL:       ${base}/ingest/issues?team=${team}&format=linear
#    Resources: Issues
#    Linear signs its webhooks; add the header Authorization = Bearer <your QE Navigator API key>
#    through a small relay if your Linear plan cannot set headers.
#
# 2. Backfill: the issues with their state history and cycles (story points = estimate).
curl -sS https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"query":"{ issues(first: 250, filter: { team: { key: { eq: \\"PAY\\" } } }) { nodes { identifier title url createdAt updatedAt completedAt canceledAt estimate state { name type } labels { nodes { name } } cycle { id number startsAt endsAt completedAt } history(first: 50) { nodes { createdAt fromState { name type } toState { name type } } } } } }"}' |
curl -sS --fail-with-body -X POST "${base}/ingest/issues?team=${team}&format=linear" \\
  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" --data-binary @-
# Escaped defects: label bugs "Bug" and the environment as "env:production" / "env:staging".`;
  }
  return `# Issues with their status changes; sprints once with their dates (closed sprints with completedAt).
curl -sS --fail-with-body -X POST "${base}/ingest/issues?team=${team}" \\
  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" -d '{
  "sprints": [{"id":"S-47","name":"Sprint 47","startedAt":"2026-11-09T09:00:00Z","completedAt":"2026-11-20T15:00:00Z"}],
  "issues": [
    {"key":"PAY-101","type":"story","title":"Refund to card","status":"Done","createdAt":"2026-11-03T10:00:00Z","resolvedAt":"2026-11-18T14:00:00Z",
     "storyPoints":5,"estimateHours":16,"timeLoggedHours":19,"sprint":"S-47",
     "transitions":[{"at":"2026-11-10T09:00:00Z","to":"In Progress"},{"at":"2026-11-12T09:00:00Z","to":"Blocked"},{"at":"2026-11-12T15:00:00Z","to":"In Progress"},{"at":"2026-11-18T14:00:00Z","to":"Done"}]},
    {"key":"PAY-102","type":"bug","title":"Wrong fee on refunds","status":"Open","environment":"production","createdAt":"2026-11-19T08:30:00Z"}
  ]}'`;
}

type QualityTool = Tool;
/** Steps that upload a SARIF report (QE Navigator calculates the code quality score, findings by severity and rule, new and fixed). */
export function sarifSnippet(tool: QualityTool, base: string, team: string): string {
  const upload = (indent: string, file: string, commit: string, branch: string, run: string) =>
    `curl -sS --fail-with-body -X POST "${base}/ingest/static-analysis?team=${team}&commit=${commit}&branch=${branch}&run=${run}" \\\n${indent}  -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -F report=@${file}`;
  if (tool === 'github') {
    return `# After CodeQL (github/codeql-action/analyze writes results/<language>.sarif) or ESLint:
#   npx eslint . -f @microsoft/eslint-formatter-sarif -o eslint.sarif
- name: Send static analysis to QE Navigator
  if: always() && github.ref_name == github.event.repository.default_branch
  run: |
    for f in results/*.sarif eslint.sarif; do [ -f "$f" ] || continue
      ${upload('      ', '"$f"', '${{ github.sha }}', '${{ github.ref_name }}', '${{ github.run_id }}-$(basename $f)')}
    done
  env:
    QE_NAVIGATOR_API_KEY: \${{ secrets.QE_NAVIGATOR_API_KEY }}`;
  }
  if (tool === 'gitlab') {
    return `qe-navigator-static-analysis:
  stage: .post
  rules: [{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' }]
  script:
    # SonarQube: the project's issues as SARIF (sonar.sarifReportPaths / the SARIF export);
    # ESLint: npx eslint . -f @microsoft/eslint-formatter-sarif -o eslint.sarif
    - ${upload('      ', 'sonar.sarif', '$CI_COMMIT_SHA', '$CI_COMMIT_BRANCH', '$CI_PIPELINE_ID')}`;
  }
  if (tool === 'jenkins') {
    return `post {
  always {
    withCredentials([string(credentialsId: 'qe-navigator-api-key', variable: 'QE_NAVIGATOR_API_KEY')]) {
      sh '''
        ${upload('        ', 'eslint.sarif', '$GIT_COMMIT', '$BRANCH_NAME', '$BUILD_NUMBER')}
      '''
    }
  }
}`;
  }
  return `- script: |
    ${upload('    ', '$(Build.ArtifactStagingDirectory)/CodeAnalysisLogs/codeql.sarif', '$(Build.SourceVersion)', '$(Build.SourceBranchName)', '$(Build.BuildId)')}
  displayName: Send static analysis to QE Navigator
  condition: always()
  env:
    QE_NAVIGATOR_API_KEY: $(QE_NAVIGATOR_API_KEY)`;
}

const TEST_SARIF = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'QE Navigator connection check', rules: [{ id: 'check/sample', defaultConfiguration: { level: 'note' } }] } }, results: [{ ruleId: 'check/sample', message: { text: 'Connection check finding' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/check.ts' }, region: { startLine: 1 } } }] }] }] });

const TEST_REPORT = '<?xml version="1.0"?><testsuites><testsuite name="QE Navigator connection check" time="0.3"><testcase classname="connection" name="the key is accepted" time="0.1"/><testcase classname="connection" name="the team is found" time="0.1"/><testcase classname="connection" name="the report is read" time="0.1"/></testsuite></testsuites>';

type TestKind = 'tests' | 'deployments' | 'incidents' | 'issues' | 'static-analysis';
const testBody = (kind: TestKind): { type: string; body: string } => {
  const now = new Date(Date.now() - 60_000).toISOString();
  if (kind === 'deployments') return { type: 'application/json', body: JSON.stringify({ id: 'qe-connection-check', environment: 'production', service: 'connection-check', commit: '0000000', finishedAt: now, result: 'success' }) };
  if (kind === 'incidents') return { type: 'application/json', body: JSON.stringify({ id: 'qe-connection-check', title: 'Connection check', severity: 'low', service: 'connection-check', openedAt: now }) };
  if (kind === 'issues') return { type: 'application/json', body: JSON.stringify({ issues: [{ key: 'QE-1', type: 'bug', title: 'Connection check', status: 'Open', environment: 'staging', createdAt: now }] }) };
  if (kind === 'static-analysis') return { type: 'application/json', body: TEST_SARIF };
  return { type: 'application/xml', body: TEST_REPORT };
};

const ConnectCi: React.FC = () => {
  const [teams, setTeams] = useState<TeamStatus[]>([]);
  const [activeKeys, setActiveKeys] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('github');
  const [team, setTeam] = useState('');
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [deployTool, setDeployTool] = useState<Tool>('github');
  const [incidentTool, setIncidentTool] = useState<IncidentTool>('pagerduty');
  const [issueTool, setIssueTool] = useState<IssueTool>('jira');
  const [agentTab, setAgentTab] = useState<AgentTab>('setup');
  const [exporterCi, setExporterCi] = useState<ExporterCi>('github');
  const [exporters, setExporters] = useState<ExporterStatus[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [sarifTool, setSarifTool] = useState<QualityTool>('github');
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const [testKind, setTestKind] = useState<TestKind>('tests');
  const [mappings, setMappings] = useState<ServiceMapping[]>([]);
  const [seenServices, setSeenServices] = useState<string[]>([]);
  const [newService, setNewService] = useState('');
  const [newServiceTeam, setNewServiceTeam] = useState('');
  const [mappingMsg, setMappingMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/ci/status`, { credentials: 'include' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Failed to load the CI status');
      setTeams(body.teams || []);
      setActiveKeys(body.activeKeys ?? 0);
      setExporters(body.exporters || []);
      setCompanyId(body.companyId || '');
      setBranches(Object.fromEntries((body.teams || []).map((t: TeamStatus) => [t.id, t.mainBranch ?? ''])));
      setTeam((cur) => cur || body.teams?.[0]?.id || '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the CI status');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadServices = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/ci/services`, { credentials: 'include' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Failed to load the service mappings');
      setMappings(body.mappings || []);
      setSeenServices(Array.from(new Set<string>((body.seen || []).map((x: { service: string }) => x.service))));
    } catch (e) {
      setMappingMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to load the service mappings' });
    }
  }, []);
  useEffect(() => { loadServices(); }, [loadServices]);

  const saveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    const service = newService.trim();
    const teamId = newServiceTeam || team;
    const r = await fetch(`${API_URL}/ci/services`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, teamId }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setMappingMsg({ ok: false, text: body.error || 'Failed to save the mapping' }); return; }
    setMappingMsg({ ok: true, text: `Events of service “${body.service}” without a team now go to ${body.teamName}.` });
    setNewService('');
    loadServices();
  };

  const removeMapping = async (service: string) => {
    const r = await fetch(`${API_URL}/ci/services/${encodeURIComponent(service)}`, { method: 'DELETE', credentials: 'include' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setMappingMsg({ ok: false, text: body.error || 'Failed to remove the mapping' }); return; }
    setMappingMsg({ ok: true, text: `Mapping of “${service}” removed.` });
    loadServices();
  };

  const base = apiBase();
  const code = useMemo(() => snippet(tool, base, team || 'YOUR_TEAM_ID'), [tool, base, team]);
  const deployCode = useMemo(() => deliverySnippet(deployTool, base, team || 'YOUR_TEAM_ID'), [deployTool, base, team]);
  const incidentCode = useMemo(() => incidentSnippet(incidentTool, base, team || 'YOUR_TEAM_ID'), [incidentTool, base, team]);
  const issueCode = useMemo(() => issueSnippet(issueTool, base, team || 'YOUR_TEAM_ID'), [issueTool, base, team]);
  const agentOrigin = base.replace(/\/api$/, '');
  const agentCode = useMemo(
    () => (agentTab === 'config'
      ? agentConfigSnippet(agentOrigin, companyId, teams.map((t) => ({ id: t.id, name: t.name, departmentId: t.departmentId ?? null })), mappings.map((m) => ({ service: m.service, teamId: m.teamId })), exporterCi)
      : agentRunSnippet(agentTab, agentOrigin, exporterCi)),
    [agentTab, agentOrigin, companyId, teams, mappings, exporterCi],
  );
  const sarifCode = useMemo(() => sarifSnippet(sarifTool, base, team || 'YOUR_TEAM_ID'), [sarifTool, base, team]);
  const copyBlock = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedBlock(id); setTimeout(() => setCopiedBlock((c) => (c === id ? null : c)), 2000); } catch { /* the code stays selectable */ }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code stays selectable */ }
  };

  const testCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setResult(null);
    try {
      const t = testBody(testKind);
      const r = await fetch(`${API_URL}/ingest/${testKind}?team=${encodeURIComponent(team)}&dryRun=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': t.type },
        body: t.body,
      });
      const body = await r.json().catch(() => ({}));
      const what = testKind === 'tests' ? `the sample report was read (${body.counts?.total ?? 0} tests)`
        : testKind === 'issues' ? `the sample issue was read (${body.issues ?? 0} issue)`
        : testKind === 'static-analysis' ? `the sample SARIF report was read (${body.reports?.[0]?.findings ?? 0} finding)`
        : `the sample ${testKind === 'deployments' ? 'deployment' : 'incident'} was read (${body.events ?? 0} event)`;
      if (r.ok) setResult({ ok: true, text: `Connected. The key is valid, team “${teams.find((x) => x.id === team)?.name ?? team}” accepts data and ${what}. Nothing was stored.` });
      else setResult({ ok: false, text: `${r.status === 401 ? 'The key was refused' : r.status === 403 ? 'The key cannot write this team' : 'The test call failed'}: ${body.error || r.statusText}` });
    } catch {
      setResult({ ok: false, text: 'The endpoint could not be reached from this browser.' });
    } finally {
      setTesting(false);
    }
  };

  const saveBranch = async (id: string) => {
    const r = await fetch(`${API_URL}/ci/teams/${encodeURIComponent(id)}/main-branch`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mainBranch: branches[id] ?? '' }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setError(body.error || 'Failed to save the main branch'); return; }
    setSaved(id);
    setTimeout(() => setSaved((s) => (s === id ? null : s)), 2000);
    load();
  };

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TOOLS[(i + (e.key === 'ArrowRight' ? 1 : TOOLS.length - 1)) % TOOLS.length];
    setTool(next.id);
    tabRefs.current[next.id]?.focus();
  };

  /** A tool tablist (arrow keys move between the tabs) with its code panel and a Copy button. */
  const toolTabs = <T extends string>(prefix: string, label: string, list: Array<{ id: T; label: string; file: string }>, current: T, set: (t: T) => void, text: string, testId: string) => (
    <div>
      <div role="tablist" aria-label={label} className="mb-2 inline-flex flex-wrap rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
        {list.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[`${prefix}-${t.id}`] = el; }}
            type="button" role="tab" id={`${prefix}-tab-${t.id}`} aria-selected={current === t.id} aria-controls={`${prefix}-tabpanel`} tabIndex={current === t.id ? 0 : -1}
            onClick={() => set(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
              set(next.id);
              tabRefs.current[`${prefix}-${next.id}`]?.focus();
            }}
            className={cx('rounded px-3 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              current === t.id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${prefix}-tabpanel`} aria-labelledby={`${prefix}-tab-${current}`} tabIndex={0} className="rounded-md border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">{list.find((t) => t.id === current)!.file}. The team id is filled in.</p>
          <button type="button" onClick={() => copyBlock(prefix, text)} className={cx(buttonClass.secondary, 'h-8 shrink-0')} data-testid={`${testId}-copy`} aria-label={`Copy the ${label.toLowerCase()} steps`}>
            {copiedBlock === prefix ? <CheckCircle2 size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copiedBlock === prefix ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre tabIndex={0} aria-label={`${label}: ${list.find((t) => t.id === current)!.label}`} className="max-h-80 overflow-auto bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:bg-slate-950 dark:text-slate-200" data-testid={testId}><code>{text}</code></pre>
      </div>
    </div>
  );

  const cell = (r: Received) => r
    ? <span title={`${r.uploads} upload${r.uploads === 1 ? '' : 's'}`}>{formatAsOf(r.at)}{r.format ? <span className="text-slate-500 dark:text-slate-400"> · {r.format}</span> : null}{r.sample ? <span className="text-slate-500 dark:text-slate-400"> · sample data</span> : null}</span>
    : <span className="text-slate-400 dark:text-slate-500">none yet</span>;

  return (
    <div data-testid="connect-ci">
    <Card padded={false} className="overflow-hidden">
      <div className="p-5">
        <CardHeader
          title="Connect your CI"
          subtitle={<>Send the raw output your tools already produce — test reports, coverage reports and pipeline runs. QE Navigator calculates the metrics itself and shows the evidence on each team page. Use an API key from <span className="font-medium">API keys</span>{activeKeys === 0 ? ' (create one first)' : ''}.</>}
          action={<PlugZap size={18} className="text-slate-400" aria-hidden="true" />}
        />
        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300" role="alert">{error}</p>}

        <dl className="mb-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-3" data-testid="connect-ci-endpoints">
          {[['Test reports', 'tests', 'JUnit XML, TRX, Cucumber JSON'], ['Coverage', 'coverage', 'lcov, Cobertura, JaCoCo, Istanbul'], ['Pipeline runs', 'pipelines', 'JSON events'],
            ['Deployments', 'deployments', 'JSON, GitHub / GitLab webhooks'], ['Commits', 'commits', 'JSON (git log), push webhooks'], ['Incidents', 'incidents', 'JSON, PagerDuty, Opsgenie'],
            ['Issues', 'issues', 'Jira, Linear, JSON'], ['Static analysis', 'static-analysis', 'SARIF 2.1.0 (SonarQube, CodeQL, ESLint)']].map(([label, path, formats]) => (
            <div key={path} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label} · {formats}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-slate-800 dark:text-slate-200">POST {base}/ingest/{path}</dd>
            </div>
          ))}
        </dl>

        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div role="tablist" aria-label="CI tool" className="inline-flex flex-wrap rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {TOOLS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                type="button"
                role="tab"
                id={`ci-tab-${t.id}`}
                aria-selected={tool === t.id}
                aria-controls="ci-tabpanel"
                tabIndex={tool === t.id ? 0 : -1}
                onClick={() => setTool(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cx('rounded px-3 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  tool === t.id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span>Team</span>
            <select className={cx(inputClass, 'max-w-[16rem]')} value={team} onChange={(e) => setTeam(e.target.value)} data-testid="connect-ci-team">
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>

        <div role="tabpanel" id="ci-tabpanel" aria-labelledby={`ci-tab-${tool}`} tabIndex={0} className="rounded-md border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">{TOOLS.find((t) => t.id === tool)!.file}. Adjust the report paths to your project; the team id is filled in.</p>
            <button type="button" onClick={copy} className={cx(buttonClass.secondary, 'h-8 shrink-0')} data-testid="connect-ci-copy">
              {copied ? <CheckCircle2 size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="max-h-80 overflow-auto bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200" data-testid="connect-ci-snippet"><code>{code}</code></pre>
        </div>

        <form onSubmit={testCall} className="mt-4 rounded-md border border-slate-200 p-3 dark:border-slate-800" data-testid="connect-ci-test">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Send a test call</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Paste a key to check it, the team and the endpoint with a small sample (test report, deployment or incident). The key is only used for this call and is not stored; nothing is saved.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="connect-ci-test-kind" className="sr-only">Endpoint to test</label>
            <select id="connect-ci-test-kind" className={cx(inputClass, 'sm:w-44')} value={testKind} onChange={(e) => setTestKind(e.target.value as TestKind)} data-testid="connect-ci-test-kind">
              <option value="tests">Test reports</option>
              <option value="deployments">Deployments</option>
              <option value="incidents">Incidents</option>
              <option value="issues">Issues</option>
              <option value="static-analysis">Static analysis</option>
            </select>
            <label htmlFor="connect-ci-key" className="sr-only">API key</label>
            <input id="connect-ci-key" type="password" autoComplete="off" className={cx(inputClass, 'sm:w-96')} placeholder="igk_…" value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="submit" className={buttonClass.primary} disabled={testing || !key.trim() || !team}>{testing ? 'Sending…' : 'Send test call'}</button>
          </div>
          {result && (
            <p className={cx('mt-2 text-sm', result.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')} role="status" data-testid="connect-ci-test-result">{result.text}</p>
          )}
        </form>
      </div>

      <div className="space-y-5 border-t border-slate-200 p-5 dark:border-slate-800" data-testid="connect-ci-delivery">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Deployments and incidents</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Send each production deployment with its commits, and your incidents as they open and close. QE Navigator calculates deployment frequency, lead time for changes,
            change failure rate (rollbacks, hotfixes within 72 h and linked incidents), MTTR, MTBF and availability; computed values are not accepted. Author e-mails are kept only as a hash.
          </p>
        </div>
        <div>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">1. Deployments and commits, from the deploy job</h5>
          {toolTabs('deploy', 'Deployment steps', DEPLOY_TOOLS, deployTool, setDeployTool, deployCode, 'connect-ci-deploy-snippet')}
        </div>
        <div>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">2. Incidents, from the incident tool</h5>
          {toolTabs('incident', 'Incident steps', INCIDENT_TOOLS, incidentTool, setIncidentTool, incidentCode, 'connect-ci-incident-snippet')}
        </div>
        <div data-testid="connect-ci-services">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">3. Service → team mapping</h5>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">For events that carry no team (e.g. one PagerDuty webhook for the whole account): the event’s service decides the team. Applies to events received from now on.</p>
          {mappingMsg && <p className={cx('mt-2 text-sm', mappingMsg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')} role="status" data-testid="connect-ci-services-result">{mappingMsg.text}</p>}
          <form onSubmit={saveMapping} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
              <span>Service</span>
              <input className={cx(inputClass, 'sm:w-56')} list="connect-ci-seen-services" placeholder="e.g. payments-api" value={newService} onChange={(e) => setNewService(e.target.value)} data-testid="connect-ci-service-name" />
              <datalist id="connect-ci-seen-services">{seenServices.map((x) => <option key={x} value={x} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
              <span>Team</span>
              <select className={cx(inputClass, 'sm:w-56')} value={newServiceTeam || team} onChange={(e) => setNewServiceTeam(e.target.value)} data-testid="connect-ci-service-team">
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <button type="submit" className={buttonClass.primary} disabled={!newService.trim() || !(newServiceTeam || team)}>Map service</button>
          </form>
          {mappings.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="connect-ci-service-mappings">
                <caption className="sr-only">Service to team mappings</caption>
                <thead className="text-left text-xs text-slate-500 dark:text-slate-400"><tr><th scope="col" className="py-1 pr-3 font-medium">Service</th><th scope="col" className="py-1 pr-3 font-medium">Team</th><th scope="col" className="py-1 font-medium"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {mappings.map((m) => (
                    <tr key={m.service} data-testid="connect-ci-service-mapping">
                      <td className="py-1.5 pr-3 font-mono text-xs text-slate-800 dark:text-slate-200">{m.service}</td>
                      <td className="py-1.5 pr-3 text-xs text-slate-700 dark:text-slate-300">{m.teamName}</td>
                      <td className="py-1.5 text-right"><button type="button" className={cx(buttonClass.secondary, 'h-7 px-2 text-xs')} onClick={() => removeMapping(m.service)} aria-label={`Remove the mapping of ${m.service}`}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="connect-ci-no-mappings">No services mapped yet: events must carry their team.</p>
          )}
        </div>
      </div>

      <div className="space-y-5 border-t border-slate-200 p-5 dark:border-slate-800" data-testid="connect-ci-work">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Issues and code quality</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Send your issues as the tracker has them and the SARIF report of your static analysis. QE Navigator calculates defect escape rate, defect density (code size from the coverage
            reports), velocity, commitment, carryover, blocked time, sizing accuracy and the code quality score, with new and fixed findings; computed values are not accepted.
            A Jira project key or Linear team key can be mapped to a team like a service (Service → team mapping, above).
          </p>
        </div>
        <div>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">1. Issues, from the tracker</h5>
          {toolTabs('issues', 'Issue steps', ISSUE_TOOLS, issueTool, setIssueTool, issueCode, 'connect-ci-issue-snippet')}
        </div>
        <div>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">2. Static analysis (SARIF), from the pipeline</h5>
          {toolTabs('sarif', 'Static analysis steps', TOOLS, sarifTool, setSarifTool, sarifCode, 'connect-ci-sarif-snippet')}
        </div>
      </div>

      <div className="space-y-4 border-t border-slate-200 p-5 dark:border-slate-800" data-testid="connect-ci-agent">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">QE Navigator Exporter</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            No pipeline changes: a small program you run inside your network (a Docker container or one file) reads GitHub Actions, GitLab CI, Bitbucket, Jenkins or
            Azure DevOps (runs, jobs, test, coverage and SARIF files, deployments), SonarQube, Jira, Linear, PagerDuty and Opsgenie with your own read-only credentials,
            and sends the raw data to this site as JSON over outbound HTTPS with an API key from Admin console → API keys (use “QE Navigator Exporter”: it also reads your departments and teams). QE Navigator calculates every value; the
            Exporter calculates nothing. Each request names your company, the department and the team, and is refused if any of them is not yours. Your credentials
            stay in your network and <span className="font-mono">qe-exporter preview</span> shows exactly what would be sent. Security review: <span className="font-mono">exporter/SECURITY.md</span>.
          </p>
          {companyId && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Your company id: <span className="font-mono" data-testid="connect-ci-company-id">{companyId}</span> (department and team ids are in the table below and on the setup page).</p>}
        </div>
        <dl className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2" data-testid="connect-ci-agent-fields">
          {([['CI data sent', AGENT_FIELDS.ci], ['Issue fields sent', AGENT_FIELDS.issues], ['Incident fields sent', AGENT_FIELDS.incidents], ['Never sent', AGENT_FIELDS.never]] as const).map(([k, v]) => (
            <div key={k} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <dt className="font-medium text-slate-700 dark:text-slate-300">{k}</dt>
              <dd className="mt-1 text-slate-600 dark:text-slate-400">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Your CI</h5>
          <div role="radiogroup" aria-label="CI the Exporter reads" className="inline-flex flex-wrap rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900" data-testid="connect-ci-exporter-ci">
            {EXPORTER_CIS.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={exporterCi === c.id} onClick={() => setExporterCi(c.id)} title={c.file}
                className={cx('rounded px-3 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  exporterCi === c.id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{EXPORTER_CIS.find((c) => c.id === exporterCi)!.file}.</p>
        </div>
        {toolTabs('agent', 'Exporter setup', AGENT_TABS, agentTab, setAgentTab, agentCode, 'connect-ci-agent-snippet')}
        <div data-testid="connect-ci-exporter-status">
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Exporter status</h5>
          {exporters.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No Exporter has reported yet. Each sync ends with a heartbeat (version, sources and their last success; no data).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <caption className="sr-only">QE Navigator Exporters that reported, with their last heartbeat</caption>
                <thead className="text-left text-slate-500 dark:text-slate-400"><tr><th scope="col" className="py-1 pr-3 font-medium">API key</th><th scope="col" className="py-1 pr-3 font-medium">Last seen</th><th scope="col" className="py-1 pr-3 font-medium">Version</th><th scope="col" className="py-1 font-medium">Sources</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {exporters.map((c, i) => (
                    <tr key={`${c.apiKeyName}${i}`} data-testid="connect-ci-exporter-row">
                      <td className="py-1.5 pr-3 align-top text-slate-800 dark:text-slate-200">{c.apiKeyName ?? 'deleted key'}{c.keyRevoked && <> <Badge tone="bad">revoked</Badge></>}</td>
                      <td className="py-1.5 pr-3 align-top">{formatAsOf(c.lastSeen)}{c.stale && <> <Badge tone="warn">not seen for over 2 hours</Badge></>}</td>
                      <td className="py-1.5 pr-3 align-top">{c.version}{c.outdated && <> <Badge tone="warn">outdated: {c.latestVersion} is available</Badge></>}</td>
                      <td className="py-1.5 align-top">
                        <ul className="space-y-0.5">
                          {c.sources.map((s) => (
                            <li key={s.name}>{s.name} ({s.type}): {s.lastSuccessAt ? `last success ${formatAsOf(s.lastSuccessAt)}` : 'no success yet'}{s.errors > 0 && <> <Badge tone="bad">{s.errors} failed run{s.errors === 1 ? '' : 's'}{s.lastErrorKind ? ` (${s.lastErrorKind})` : ''}</Badge></>}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="px-5 pt-4">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Last data received</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Coverage and pass rate are calculated on each team’s main branch (empty: main or master).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 min-w-full text-sm" data-testid="connect-ci-status">
            <caption className="sr-only">Last data received per team</caption>
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr><th scope="col" className="px-5 py-2 font-medium">Team</th><th scope="col" className="px-3 py-2 font-medium">Tests</th><th scope="col" className="px-3 py-2 font-medium">Coverage</th><th scope="col" className="px-3 py-2 font-medium">Pipelines</th><th scope="col" className="px-3 py-2 font-medium">Deployments</th><th scope="col" className="px-3 py-2 font-medium">Incidents</th><th scope="col" className="px-3 py-2 font-medium">Issues</th><th scope="col" className="px-3 py-2 font-medium">Static analysis</th><th scope="col" className="px-3 py-2 font-medium">Main branch</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {teams.map((t) => (
                <tr key={t.id} data-testid="connect-ci-row">
                  <td className="px-5 py-2">
                    <p className="font-medium text-slate-900 dark:text-white">{t.name}</p><p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{t.id}</p>
                    {t.calculation?.pending && (
                      <span data-testid="connect-ci-calc-pending" title={t.calculation.from && t.calculation.to ? `Days ${t.calculation.from} to ${t.calculation.to} are being recalculated` : undefined}>
                        <Badge tone="warn" className="mt-1">Calculation pending</Badge>
                      </span>
                    )}
                    {!t.calculation?.pending && (t.calculation?.failed ?? 0) > 0 && <Badge tone="bad" className="mt-1">Calculation failed</Badge>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.tests)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.coverage)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.pipelines)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.deployments ?? null)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.incidents ?? null)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.issues ?? null)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.staticAnalysis ?? null)}</td>
                  <td className="px-3 py-2">
                    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); saveBranch(t.id); }}>
                      <label htmlFor={`mb-${t.id}`} className="sr-only">Main branch of {t.name}</label>
                      <input id={`mb-${t.id}`} className={cx(inputClass, 'h-8 w-32 text-xs')} placeholder="main / master" value={branches[t.id] ?? ''} onChange={(e) => setBranches((b) => ({ ...b, [t.id]: e.target.value }))} />
                      <button type="submit" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} disabled={(branches[t.id] ?? '') === (t.mainBranch ?? '')}>Save</button>
                      {saved === t.id && <Badge tone="good">Saved</Badge>}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
    </div>
  );
};

export default ConnectCi;
