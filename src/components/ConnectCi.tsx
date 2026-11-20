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
 * Data: GET /api/ci/status, PUT /api/ci/teams/:id/main-branch, GET / PUT / DELETE /api/ci/services.
 */

interface TeamStatus {
  id: string; name: string; department: string | null; mainBranch: string | null;
  tests: Received; coverage: Received; pipelines: Received;
  deployments?: Received; commits?: Received; incidents?: Received;
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

const TEST_REPORT = '<?xml version="1.0"?><testsuites><testsuite name="QE Navigator connection check" time="0.3"><testcase classname="connection" name="the key is accepted" time="0.1"/><testcase classname="connection" name="the team is found" time="0.1"/><testcase classname="connection" name="the report is read" time="0.1"/></testsuite></testsuites>';

type TestKind = 'tests' | 'deployments' | 'incidents';
const testBody = (kind: TestKind): { type: string; body: string } => {
  const now = new Date(Date.now() - 60_000).toISOString();
  if (kind === 'deployments') return { type: 'application/json', body: JSON.stringify({ id: 'qe-connection-check', environment: 'production', service: 'connection-check', commit: '0000000', finishedAt: now, result: 'success' }) };
  if (kind === 'incidents') return { type: 'application/json', body: JSON.stringify({ id: 'qe-connection-check', title: 'Connection check', severity: 'low', service: 'connection-check', openedAt: now }) };
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
      const what = testKind === 'tests' ? `the sample report was read (${body.counts?.total ?? 0} tests)` : `the sample ${testKind === 'deployments' ? 'deployment' : 'incident'} was read (${body.events ?? 0} event)`;
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
            ['Deployments', 'deployments', 'JSON, GitHub / GitLab webhooks'], ['Commits', 'commits', 'JSON (git log), push webhooks'], ['Incidents', 'incidents', 'JSON, PagerDuty, Opsgenie']].map(([label, path, formats]) => (
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

      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="px-5 pt-4">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Last data received</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Coverage and pass rate are calculated on each team’s main branch (empty: main or master).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 min-w-full text-sm" data-testid="connect-ci-status">
            <caption className="sr-only">Last data received per team</caption>
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr><th scope="col" className="px-5 py-2 font-medium">Team</th><th scope="col" className="px-3 py-2 font-medium">Tests</th><th scope="col" className="px-3 py-2 font-medium">Coverage</th><th scope="col" className="px-3 py-2 font-medium">Pipelines</th><th scope="col" className="px-3 py-2 font-medium">Deployments</th><th scope="col" className="px-3 py-2 font-medium">Incidents</th><th scope="col" className="px-3 py-2 font-medium">Main branch</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {teams.map((t) => (
                <tr key={t.id} data-testid="connect-ci-row">
                  <td className="px-5 py-2"><p className="font-medium text-slate-900 dark:text-white">{t.name}</p><p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{t.id}</p></td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.tests)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.coverage)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.pipelines)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.deployments ?? null)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.incidents ?? null)}</td>
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
