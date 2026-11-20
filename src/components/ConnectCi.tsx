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
 * Data: GET /api/ci/status, PUT /api/ci/teams/:id/main-branch.
 */

interface TeamStatus {
  id: string; name: string; department: string | null; mainBranch: string | null;
  tests: Received; coverage: Received; pipelines: Received;
}
type Received = { at: string; uploads: number; format: string | null } | null;

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

const TEST_REPORT = '<?xml version="1.0"?><testsuites><testsuite name="QE Navigator connection check" time="0.3"><testcase classname="connection" name="the key is accepted" time="0.1"/><testcase classname="connection" name="the team is found" time="0.1"/><testcase classname="connection" name="the report is read" time="0.1"/></testsuite></testsuites>';

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

  const base = apiBase();
  const code = useMemo(() => snippet(tool, base, team || 'YOUR_TEAM_ID'), [tool, base, team]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code stays selectable */ }
  };

  const testCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setResult(null);
    try {
      const r = await fetch(`${API_URL}/ingest/tests?team=${encodeURIComponent(team)}&dryRun=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/xml' },
        body: TEST_REPORT,
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) setResult({ ok: true, text: `Connected. The key is valid, team “${teams.find((t) => t.id === team)?.name ?? team}” accepts data and the sample report was read (${body.counts?.total ?? 0} tests). Nothing was stored.` });
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

  const cell = (r: Received) => r
    ? <span title={`${r.uploads} upload${r.uploads === 1 ? '' : 's'}`}>{formatAsOf(r.at)}{r.format ? <span className="text-slate-500 dark:text-slate-400"> · {r.format}</span> : null}</span>
    : <span className="text-slate-400 dark:text-slate-500">none yet</span>;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="p-5" data-testid="connect-ci">
        <CardHeader
          title="Connect your CI"
          subtitle={<>Send the raw output your tools already produce — test reports, coverage reports and pipeline runs. QE Navigator calculates the metrics itself and shows the evidence on each team page. Use an API key from <span className="font-medium">API keys</span>{activeKeys === 0 ? ' (create one first)' : ''}.</>}
          action={<PlugZap size={18} className="text-slate-400" aria-hidden="true" />}
        />
        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300" role="alert">{error}</p>}

        <dl className="mb-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-3" data-testid="connect-ci-endpoints">
          {[['Test reports', 'tests', 'JUnit XML, TRX, Cucumber JSON'], ['Coverage', 'coverage', 'lcov, Cobertura, JaCoCo, Istanbul'], ['Pipeline runs', 'pipelines', 'JSON events']].map(([label, path, formats]) => (
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
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Paste a key to check it, the team and the endpoint with a small sample test report. The key is only used for this call and is not stored; nothing is saved.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="connect-ci-key" className="sr-only">API key</label>
            <input id="connect-ci-key" type="password" autoComplete="off" className={cx(inputClass, 'sm:w-96')} placeholder="igk_…" value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="submit" className={buttonClass.primary} disabled={testing || !key.trim() || !team}>{testing ? 'Sending…' : 'Send test call'}</button>
          </div>
          {result && (
            <p className={cx('mt-2 text-sm', result.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')} role="status" data-testid="connect-ci-test-result">{result.text}</p>
          )}
        </form>
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
              <tr><th scope="col" className="px-5 py-2 font-medium">Team</th><th scope="col" className="px-3 py-2 font-medium">Tests</th><th scope="col" className="px-3 py-2 font-medium">Coverage</th><th scope="col" className="px-3 py-2 font-medium">Pipelines</th><th scope="col" className="px-3 py-2 font-medium">Main branch</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {teams.map((t) => (
                <tr key={t.id} data-testid="connect-ci-row">
                  <td className="px-5 py-2"><p className="font-medium text-slate-900 dark:text-white">{t.name}</p><p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{t.id}</p></td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.tests)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.coverage)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{cell(t.pipelines)}</td>
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
  );
};

export default ConnectCi;
