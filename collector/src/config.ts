/**
 * Configuration: one YAML or JSON file (no secrets) plus environment variables (secrets only).
 *
 * The file is validated strictly: unknown keys are refused (a typo never silently disables a
 * setting) and any key that looks like a credential (token, apiKey, password, secret, salt) is
 * refused, because secrets must come from the environment (VAR) or a file named by VAR_FILE
 * (Docker / Kubernetes secrets).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseYaml } from './yaml';
import { addSecret } from './log';

export class ConfigError extends Error {}

export type SourceType = 'jira' | 'linear' | 'pagerduty' | 'opsgenie' | 'github' | 'gitlab' | 'jenkins' | 'azure-devops' | 'sonarqube';
export const SOURCE_TYPES: SourceType[] = ['jira', 'linear', 'pagerduty', 'opsgenie', 'github', 'gitlab', 'jenkins', 'azure-devops', 'sonarqube'];
/** The CI and code-quality sources (read pipelines, tests, coverage, deployments, findings) as opposed to the issue and incident tools. */
export const CI_TYPES: SourceType[] = ['github', 'gitlab', 'jenkins', 'azure-devops', 'sonarqube'];

/**
 * What leaves your network (privacy.mode):
 *   full      minimised raw records (issues, incidents, test results, coverage per file, pipeline runs,
 *             deployments, findings) to the existing ingestion endpoints; QE Navigator calculates.
 *   evidence  (default) the metric values calculated here per team and day, with the evidence lists the app
 *             shows (flaky test names, least-covered files, slowest and failing stages, failed deploys,
 *             escaped issue keys); no raw records.
 *   metrics   the metric values and counts only: no names, keys, paths or titles at all.
 */
export type PrivacyMode = 'full' | 'evidence' | 'metrics';

export interface Privacy {
  mode: PrivacyMode;
  /** metrics mode: the URL of your local evidence page (qe-collector serve), shown in QE Navigator as a link. */
  localEvidenceUrl: string | null;
  /** Send issue / incident titles (default false: the key or id only). */
  sendTitles: boolean;
  /** Send a link back to the issue / incident (default false: it names your internal host). */
  sendLinks: boolean;
  /** none (default): no person is sent at all; hash: a salted HMAC of the assignee / first responder, computed here. */
  people: 'none' | 'hash';
}

export interface HttpSettings { timeoutSeconds: number; maxRetries: number; maxRetryWaitSeconds: number; caFile: string | null }

interface SourceBase {
  name: string;
  type: SourceType;
  /** Env var holding the source's token / API key. */
  tokenEnv: string;
  /** QE Navigator team id per project / team / service (see each source). */
  teams: Record<string, string>;
  defaultTeam: string | null;
  caFile: string | null;
  enabled: boolean;
}

export interface JiraSource extends SourceBase {
  type: 'jira';
  baseUrl: string;
  /** cloud: email + API token (Basic), REST v3; server: Data Center / Server Personal Access Token (Bearer), REST v2. */
  deployment: 'cloud' | 'server';
  email: string | null;
  emailEnv: string;
  jql: string;
  fields: { storyPoints: string | null; sprint: string | null; environment: string | null; flagged: string | null };
  pageSize: number;
}

export interface LinearSource extends SourceBase {
  type: 'linear';
  apiUrl: string;
  /** Linear team keys to read (default: the keys of `teams`; empty: every team the key can read). */
  teamKeys: string[];
  pageSize: number;
}

export interface PagerDutySource extends SourceBase {
  type: 'pagerduty';
  apiUrl: string;
  /** PagerDuty service name or id → team id (`teams` maps PagerDuty team names). */
  services: Record<string, string>;
  /** Service name → category (e.g. infrastructure). */
  categories: Record<string, string>;
  serviceIds: string[];
}

export interface OpsgenieSource extends SourceBase {
  type: 'opsgenie';
  region: 'us' | 'eu';
  apiUrl: string;
  /** Opsgenie alert query added to the time filter (e.g. "priority:(P1 OR P2)"). */
  query: string | null;
  services: Record<string, string>;
  categories: Record<string, string>;
}

/** Artifact names (globs, * and ?) whose files are read as test reports, coverage reports or SARIF; files are recognised by content. */
export interface ArtifactSettings { tests: string[]; coverage: string[]; sarif: string[]; maxMB: number }

export interface GitHubSource extends SourceBase {
  type: 'github';
  apiUrl: string;
  /** token: a fine-grained or classic PAT (GITHUB_TOKEN); app: a GitHub App installation (app id, installation id, private key in GITHUB_APP_PRIVATE_KEY). */
  auth: 'token' | 'app';
  appId: string | null;
  installationId: string | null;
  privateKeyEnv: string;
  /** Workflow names or file names to read (empty: all). */
  workflows: string[];
  /** Branches to read runs of (empty: all). */
  branches: string[];
  /** Deployment environments that are production (default: production, prod, live). */
  environments: string[];
  artifacts: ArtifactSettings;
  maxRunsPerRepo: number;
}

export interface GitLabSource extends SourceBase {
  type: 'gitlab';
  apiUrl: string;
  environments: string[];
  artifacts: ArtifactSettings;
  maxRunsPerRepo: number;
}

export interface JenkinsSource extends SourceBase {
  type: 'jenkins';
  baseUrl: string;
  user: string | null;
  userEnv: string;
  /** Job path → team id for deployment jobs: each build of such a job is a deployment. */
  deployJobs: Record<string, string>;
  deployEnvironment: string;
  artifacts: ArtifactSettings;
  maxRunsPerRepo: number;
  allowHttp: boolean;
}

export interface AzureDevOpsSource extends SourceBase {
  type: 'azure-devops';
  orgUrl: string;
  project: string;
  environments: string[];
  /** Also read classic release pipelines' deployments (vsrm.dev.azure.com). */
  releases: boolean;
  releasesUrl: string;
  artifacts: ArtifactSettings;
  maxRunsPerRepo: number;
}

export interface SonarQubeSource extends SourceBase {
  type: 'sonarqube';
  baseUrl: string;
  auth: 'bearer' | 'basic';
  /** Branch to read (empty: the main branch). */
  branch: string | null;
  allowHttp: boolean;
}

export type CiSourceConfig = GitHubSource | GitLabSource | JenkinsSource | AzureDevOpsSource | SonarQubeSource;
export type SourceConfig = JiraSource | LinearSource | PagerDutySource | OpsgenieSource | CiSourceConfig;
export const isCiSource = (s: SourceConfig): s is CiSourceConfig => CI_TYPES.includes(s.type);

export interface Config {
  path: string;
  qeNavigator: { url: string; apiKeyEnv: string; caFile: string | null; requestsPerMinute: number; timeoutSeconds: number };
  privacy: Privacy;
  peopleSaltEnv: string;
  statePath: string;
  /** The local copy of the raw records (JSON lines, one folder per kind, one file per month): stays in your network. */
  store: { dir: string; retentionDays: number; detailDays: number };
  /** Days recalculated on every sync (values change while late data arrives). */
  recalcDays: number;
  /** A team's main branch when it is not main or master (coverage, pass rate and code quality use the main branch). */
  mainBranches: Record<string, string>;
  serve: { host: string; port: number; userEnv: string; passwordEnv: string };
  heartbeat: boolean;
  backfillDays: number;
  overlapMinutes: number;
  http: HttpSettings;
  sources: SourceConfig[];
}

const SECRET_KEY = /^(token|apiKey|api_key|apikey|password|passwd|secret|salt|pat|personalAccessToken|key|authorization)$/i;

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new ConfigError(`${where} must be a mapping`);
  return v as Obj;
}

function only(o: Obj, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) {
    if (SECRET_KEY.test(k)) throw new ConfigError(`${where}.${k}: secrets are never read from the config file; set the environment variable instead (see README, "Secrets")`);
    if (!allowed.includes(k)) throw new ConfigError(`${where}.${k} is not a known setting (allowed: ${allowed.join(', ')})`);
  }
}

const str = (v: unknown, where: string, def: string | null = null): string | null => {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v !== 'string' && typeof v !== 'number') throw new ConfigError(`${where} must be a string`);
  return String(v).trim();
};
const reqStr = (v: unknown, where: string): string => {
  const s = str(v, where);
  if (!s) throw new ConfigError(`${where} is required`);
  return s;
};
const bool = (v: unknown, where: string, def: boolean): boolean => {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'boolean') throw new ConfigError(`${where} must be true or false`);
  return v;
};
const int = (v: unknown, where: string, def: number, min: number, max: number): number => {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ConfigError(`${where} must be a whole number from ${min} to ${max}`);
  return v;
};
const TEAM_ID = /^[A-Za-z0-9_.:-]{1,36}$/;
function teamMap(v: unknown, where: string): Record<string, string> {
  const o = obj(v, where);
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(o)) {
    if (typeof t !== 'string' || !TEAM_ID.test(t)) throw new ConfigError(`${where}.${k} must be a QE Navigator team id (from Admin console → Connect your CI)`);
    out[k] = t;
  }
  return out;
}
function textMap(v: unknown, where: string): Record<string, string> {
  const o = obj(v, where);
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(o)) {
    if (typeof t !== 'string' || !t.trim()) throw new ConfigError(`${where}.${k} must be a string`);
    out[k] = t.trim().toLowerCase();
  }
  return out;
}
const team = (v: unknown, where: string): string | null => {
  const s = str(v, where);
  if (s && !TEAM_ID.test(s)) throw new ConfigError(`${where} must be a QE Navigator team id`);
  return s;
};
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const envName = (v: unknown, where: string, def: string): string => {
  const s = str(v, where, def)!;
  if (!ENV_NAME.test(s)) throw new ConfigError(`${where} must be an environment variable name (A-Z, 0-9, _)`);
  return s;
};

export function httpsUrl(v: unknown, where: string, def?: string, allowHttp = false): string {
  const s = str(v, where, def ?? null);
  if (!s) throw new ConfigError(`${where} is required`);
  let u: URL;
  try { u = new URL(s); } catch { throw new ConfigError(`${where} must be a URL (https://…)`); }
  if (u.username || u.password) throw new ConfigError(`${where} must not contain credentials`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (local || allowHttp))) throw new ConfigError(`${where} must use https:// (http:// only for localhost${allowHttp ? ' or with allowHttp: true' : ''})`);
  return s.replace(/\/+$/, '');
}

const DEFAULT_TOKEN_ENV: Record<SourceType, string> = {
  jira: 'JIRA_TOKEN', linear: 'LINEAR_API_KEY', pagerduty: 'PAGERDUTY_TOKEN', opsgenie: 'OPSGENIE_API_KEY',
  github: 'GITHUB_TOKEN', gitlab: 'GITLAB_TOKEN', jenkins: 'JENKINS_TOKEN', 'azure-devops': 'AZURE_DEVOPS_TOKEN', sonarqube: 'SONAR_TOKEN',
};
/** The key a source's team mapping is written under in the config (stored as `teams`). */
const MAP_KEY: Partial<Record<SourceType, string>> = { github: 'repos', gitlab: 'projects', jenkins: 'jobs', 'azure-devops': 'pipelines', sonarqube: 'projects' };
const DEFAULT_ARTIFACTS = {
  tests: ['*test*', '*junit*', '*result*', '*report*', '*.trx', '*cucumber*'],
  coverage: ['*coverage*', '*lcov*', '*cobertura*', '*jacoco*'],
  sarif: ['*sarif*', '*codeql*', '*semgrep*', '*analysis*'],
};
const list = (v: unknown, where: string, def: string[] = []): string[] => {
  if (v === undefined || v === null) return def;
  if (!Array.isArray(v)) throw new ConfigError(`${where} must be a list`);
  return v.map((x, j) => reqStr(x, `${where}[${j}]`));
};
function artifacts(v: unknown, where: string): ArtifactSettings {
  const o = obj(v, where);
  only(o, ['tests', 'coverage', 'sarif', 'maxMB'], where);
  return {
    tests: list(o.tests, `${where}.tests`, DEFAULT_ARTIFACTS.tests), coverage: list(o.coverage, `${where}.coverage`, DEFAULT_ARTIFACTS.coverage),
    sarif: list(o.sarif, `${where}.sarif`, DEFAULT_ARTIFACTS.sarif), maxMB: int(o.maxMB, `${where}.maxMB`, 50, 1, 500),
  };
}
const NAME = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const FIELD_ID = /^(customfield_\d+|[a-z][A-Za-z0-9_]{0,63})$/;

function source(raw: unknown, i: number, names: Set<string>): SourceConfig {
  const where = `sources[${i}]`;
  const o = obj(raw, where);
  const type = str(o.type, `${where}.type`) as SourceType;
  if (!SOURCE_TYPES.includes(type)) throw new ConfigError(`${where}.type must be one of ${SOURCE_TYPES.join(', ')}`);
  const name = str(o.name, `${where}.name`, type)!;
  if (!NAME.test(name)) throw new ConfigError(`${where}.name must be lowercase letters, digits, "-" or "_" (it keys the state file)`);
  if (names.has(name)) throw new ConfigError(`${where}.name "${name}" is used twice`);
  names.add(name);
  const mapKey = MAP_KEY[type];
  const base = {
    name, type, tokenEnv: envName(o.tokenEnv, `${where}.tokenEnv`, DEFAULT_TOKEN_ENV[type]),
    teams: mapKey ? teamMap(o[mapKey], `${where}.${mapKey}`) : teamMap(o.teams, `${where}.teams`),
    defaultTeam: team(o.defaultTeam, `${where}.defaultTeam`), caFile: str(o.caFile, `${where}.caFile`), enabled: bool(o.enabled, `${where}.enabled`, true),
  };
  const common = ['type', 'name', 'tokenEnv', mapKey ?? 'teams', 'defaultTeam', 'caFile', 'enabled'];
  if (mapKey && !Object.keys(base.teams).length && !base.defaultTeam) throw new ConfigError(`${where}.${mapKey} must map at least one ${mapKey.replace(/s$/, '')} to a QE Navigator team id (or set defaultTeam)`);
  const ciCommon = [...common, 'artifacts', 'maxRunsPerRepo'];
  const maxRuns = () => int(o.maxRunsPerRepo, `${where}.maxRunsPerRepo`, 500, 1, 10000);
  const envs = () => list(o.environments, `${where}.environments`, ['production', 'prod', 'live']);
  if (type === 'github') {
    only(o, [...ciCommon, 'apiUrl', 'auth', 'appId', 'installationId', 'privateKeyEnv', 'workflows', 'branches', 'environments'], where);
    const auth = str(o.auth, `${where}.auth`, 'token');
    if (auth !== 'token' && auth !== 'app') throw new ConfigError(`${where}.auth must be token (a personal access token) or app (a GitHub App installation)`);
    const appId = str(o.appId, `${where}.appId`);
    const installationId = str(o.installationId, `${where}.installationId`);
    if (auth === 'app' && (!appId || !/^\d+$/.test(appId) || !installationId || !/^\d+$/.test(installationId))) throw new ConfigError(`${where}: auth: app needs appId and installationId (numbers, from the app's settings and its installation URL)`);
    for (const r of Object.keys(base.teams)) if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) throw new ConfigError(`${where}.repos.${r} must be owner/name`);
    return {
      ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://api.github.com'), auth, appId, installationId,
      privateKeyEnv: envName(o.privateKeyEnv, `${where}.privateKeyEnv`, 'GITHUB_APP_PRIVATE_KEY'), workflows: list(o.workflows, `${where}.workflows`),
      branches: list(o.branches, `${where}.branches`), environments: envs(), artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns(),
    };
  }
  if (type === 'gitlab') {
    only(o, [...ciCommon, 'apiUrl', 'environments'], where);
    return { ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://gitlab.com/api/v4'), environments: envs(), artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns() };
  }
  if (type === 'jenkins') {
    only(o, [...ciCommon, 'baseUrl', 'user', 'userEnv', 'deployJobs', 'deployEnvironment', 'allowHttp'], where);
    const allowHttp = bool(o.allowHttp, `${where}.allowHttp`, false);
    return {
      ...base, type, baseUrl: httpsUrl(o.baseUrl, `${where}.baseUrl`, undefined, allowHttp), user: str(o.user, `${where}.user`), userEnv: envName(o.userEnv, `${where}.userEnv`, 'JENKINS_USER'),
      deployJobs: teamMap(o.deployJobs, `${where}.deployJobs`), deployEnvironment: str(o.deployEnvironment, `${where}.deployEnvironment`, 'production')!,
      artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns(), allowHttp,
    };
  }
  if (type === 'azure-devops') {
    only(o, [...ciCommon, 'orgUrl', 'project', 'environments', 'releases', 'releasesUrl'], where);
    const orgUrl = httpsUrl(o.orgUrl, `${where}.orgUrl`);
    const org = new URL(orgUrl).pathname.split('/').filter(Boolean)[0] ?? new URL(orgUrl).hostname.split('.')[0];
    return {
      ...base, type, orgUrl, project: reqStr(o.project, `${where}.project`), environments: envs(), releases: bool(o.releases, `${where}.releases`, false),
      releasesUrl: httpsUrl(o.releasesUrl, `${where}.releasesUrl`, `https://vsrm.dev.azure.com/${org}`), artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns(),
    };
  }
  if (type === 'sonarqube') {
    only(o, [...common, 'baseUrl', 'auth', 'branch', 'allowHttp'], where);
    const auth = str(o.auth, `${where}.auth`, 'bearer');
    if (auth !== 'bearer' && auth !== 'basic') throw new ConfigError(`${where}.auth must be bearer (SonarQube 10+, SonarCloud) or basic (older SonarQube: the token as user name)`);
    const allowHttp = bool(o.allowHttp, `${where}.allowHttp`, false);
    return { ...base, type, baseUrl: httpsUrl(o.baseUrl, `${where}.baseUrl`, 'https://sonarcloud.io', allowHttp), auth, branch: str(o.branch, `${where}.branch`), allowHttp };
  }
  if (type === 'jira') {
    only(o, [...common, 'baseUrl', 'deployment', 'auth', 'email', 'emailEnv', 'jql', 'fields', 'pageSize', 'allowHttp'], where);
    const auth = str(o.auth, `${where}.auth`);
    let deployment = str(o.deployment, `${where}.deployment`) as 'cloud' | 'server' | null;
    if (auth && !['basic', 'bearer'].includes(auth)) throw new ConfigError(`${where}.auth must be basic (Jira Cloud: e-mail + API token) or bearer (Server / Data Center: Personal Access Token)`);
    const baseUrl = httpsUrl(o.baseUrl, `${where}.baseUrl`, undefined, bool(o.allowHttp, `${where}.allowHttp`, false));
    if (!deployment) deployment = auth === 'bearer' ? 'server' : auth === 'basic' ? 'cloud' : /\.atlassian\.net$/i.test(new URL(baseUrl).hostname) ? 'cloud' : 'server';
    if (!['cloud', 'server'].includes(deployment)) throw new ConfigError(`${where}.deployment must be cloud or server`);
    const f = obj(o.fields, `${where}.fields`);
    only(f, ['storyPoints', 'sprint', 'environment', 'flagged'], `${where}.fields`);
    const fid = (k: string) => { const s = str(f[k], `${where}.fields.${k}`); if (s && !FIELD_ID.test(s)) throw new ConfigError(`${where}.fields.${k} must be a Jira field id such as customfield_10016`); return s; };
    const jql = reqStr(o.jql, `${where}.jql`);
    if (/\border\s+by\b/i.test(jql)) throw new ConfigError(`${where}.jql must not contain ORDER BY (the Collector adds "updated >= … ORDER BY updated")`);
    return {
      ...base, type, baseUrl, deployment, email: str(o.email, `${where}.email`), emailEnv: envName(o.emailEnv, `${where}.emailEnv`, 'JIRA_EMAIL'), jql,
      fields: { storyPoints: fid('storyPoints'), sprint: fid('sprint'), environment: fid('environment'), flagged: fid('flagged') },
      pageSize: int(o.pageSize, `${where}.pageSize`, 100, 1, 100),
    };
  }
  if (type === 'linear') {
    only(o, [...common, 'apiUrl', 'teamKeys', 'pageSize'], where);
    const keys = o.teamKeys === undefined ? Object.keys(base.teams) : Array.isArray(o.teamKeys) ? o.teamKeys.map((k, j) => reqStr(k, `${where}.teamKeys[${j}]`)) : (() => { throw new ConfigError(`${where}.teamKeys must be a list`); })();
    return { ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://api.linear.app/graphql'), teamKeys: keys, pageSize: int(o.pageSize, `${where}.pageSize`, 50, 1, 100) };
  }
  if (type === 'pagerduty') {
    only(o, [...common, 'apiUrl', 'services', 'categories', 'serviceIds'], where);
    const ids = o.serviceIds === undefined ? [] : Array.isArray(o.serviceIds) ? o.serviceIds.map((k, j) => reqStr(k, `${where}.serviceIds[${j}]`)) : (() => { throw new ConfigError(`${where}.serviceIds must be a list`); })();
    return { ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://api.pagerduty.com'), services: teamMap(o.services, `${where}.services`), categories: textMap(o.categories, `${where}.categories`), serviceIds: ids };
  }
  only(o, [...common, 'region', 'apiUrl', 'query', 'services', 'categories'], where);
  const region = (str(o.region, `${where}.region`, 'us') as 'us' | 'eu');
  if (!['us', 'eu'].includes(region)) throw new ConfigError(`${where}.region must be us or eu`);
  return {
    ...base, type: 'opsgenie', region, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, region === 'eu' ? 'https://api.eu.opsgenie.com' : 'https://api.opsgenie.com'),
    query: str(o.query, `${where}.query`), services: teamMap(o.services, `${where}.services`), categories: textMap(o.categories, `${where}.categories`),
  };
}

/** ./qe-collector-state.json, or ./qe-agent-state.json when only that exists (a state file of an earlier release). */
export function defaultStatePath(): string {
  return !existsSync('./qe-collector-state.json') && existsSync('./qe-agent-state.json') ? './qe-agent-state.json' : './qe-collector-state.json';
}

export function parseConfig(raw: unknown, path = '(inline)'): Config {
  const o = obj(raw, 'config');
  only(o, ['qeNavigator', 'privacy', 'state', 'serve', 'heartbeat', 'recalcDays', 'mainBranches', 'backfillDays', 'overlapMinutes', 'http', 'sources'], 'config');
  const qe = obj(o.qeNavigator, 'qeNavigator');
  only(qe, ['url', 'apiKeyEnv', 'caFile', 'requestsPerMinute', 'timeoutSeconds'], 'qeNavigator');
  const pr = obj(o.privacy, 'privacy');
  only(pr, ['mode', 'localEvidenceUrl', 'sendTitles', 'sendLinks', 'people', 'saltEnv'], 'privacy');
  const mode = str(pr.mode, 'privacy.mode', 'evidence') as PrivacyMode;
  if (!['full', 'evidence', 'metrics'].includes(mode)) throw new ConfigError('privacy.mode must be full, evidence or metrics');
  const localEvidenceUrl = pr.localEvidenceUrl === undefined || pr.localEvidenceUrl === null ? null : (() => {
    const v = reqStr(pr.localEvidenceUrl, 'privacy.localEvidenceUrl');
    let u: URL;
    try { u = new URL(v); } catch { throw new ConfigError('privacy.localEvidenceUrl must be a URL (http:// or https://), e.g. http://qe-collector.internal:8787/'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ConfigError('privacy.localEvidenceUrl must be http:// or https://');
    if (u.username || u.password) throw new ConfigError('privacy.localEvidenceUrl must not contain credentials');
    return v;
  })();
  const people = str(pr.people, 'privacy.people', 'none');
  if (people !== 'none' && people !== 'hash') throw new ConfigError('privacy.people must be none or hash');
  const st = obj(o.state, 'state');
  only(st, ['path', 'dataDir', 'retentionDays', 'detailDays'], 'state');
  const sv = obj(o.serve, 'serve');
  only(sv, ['host', 'port', 'userEnv', 'passwordEnv'], 'serve');
  const h = obj(o.http, 'http');
  only(h, ['timeoutSeconds', 'maxRetries', 'maxRetryWaitSeconds', 'caFile'], 'http');
  if (!Array.isArray(o.sources) || o.sources.length === 0) throw new ConfigError(`sources must list at least one source (${SOURCE_TYPES.join(', ')})`);
  const names = new Set<string>();
  const statePath = str(st.path, 'state.path', defaultStatePath())!;
  return {
    path,
    qeNavigator: {
      url: httpsUrl(qe.url, 'qeNavigator.url', 'https://app.irongate.ie'), apiKeyEnv: envName(qe.apiKeyEnv, 'qeNavigator.apiKeyEnv', 'QE_API_KEY'),
      caFile: str(qe.caFile, 'qeNavigator.caFile'), requestsPerMinute: int(qe.requestsPerMinute, 'qeNavigator.requestsPerMinute', 50, 1, 60),
      timeoutSeconds: int(qe.timeoutSeconds, 'qeNavigator.timeoutSeconds', 120, 5, 600),
    },
    privacy: { mode, localEvidenceUrl, sendTitles: bool(pr.sendTitles, 'privacy.sendTitles', false), sendLinks: bool(pr.sendLinks, 'privacy.sendLinks', false), people },
    peopleSaltEnv: envName(pr.saltEnv, 'privacy.saltEnv', 'QE_PEOPLE_SALT'),
    statePath,
    store: {
      dir: str(st.dataDir, 'state.dataDir', join(dirname(statePath), 'qe-collector-data'))!,
      retentionDays: int(st.retentionDays, 'state.retentionDays', 400, 30, 3650), detailDays: int(st.detailDays, 'state.detailDays', 35, 7, 400),
    },
    recalcDays: int(o.recalcDays, 'recalcDays', 35, 1, 400),
    mainBranches: (() => {
      const m = obj(o.mainBranches, 'mainBranches');
      const out: Record<string, string> = {};
      for (const [t, b] of Object.entries(m)) {
        if (!TEAM_ID.test(t)) throw new ConfigError(`mainBranches.${t} must be keyed by a QE Navigator team id`);
        if (typeof b !== 'string' || !b.trim() || /\s/.test(b.trim())) throw new ConfigError(`mainBranches.${t} must be a branch name`);
        out[t] = b.trim().replace(/^refs\/heads\//, '');
      }
      return out;
    })(),
    serve: {
      host: str(sv.host, 'serve.host', '127.0.0.1')!, port: int(sv.port, 'serve.port', 8787, 1, 65535),
      userEnv: envName(sv.userEnv, 'serve.userEnv', 'QE_SERVE_USER'), passwordEnv: envName(sv.passwordEnv, 'serve.passwordEnv', 'QE_SERVE_PASSWORD'),
    },
    heartbeat: bool(o.heartbeat, 'heartbeat', true),
    backfillDays: int(o.backfillDays, 'backfillDays', 90, 1, 365),
    overlapMinutes: int(o.overlapMinutes, 'overlapMinutes', 10, 0, 1440),
    http: {
      timeoutSeconds: int(h.timeoutSeconds, 'http.timeoutSeconds', 30, 1, 600), maxRetries: int(h.maxRetries, 'http.maxRetries', 5, 0, 10),
      maxRetryWaitSeconds: int(h.maxRetryWaitSeconds, 'http.maxRetryWaitSeconds', 120, 1, 3600), caFile: str(h.caFile, 'http.caFile'),
    },
    sources: o.sources.map((s, i) => source(s, i, names)),
  };
}

export function loadConfig(path: string): Config {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (e) { throw new ConfigError(`Cannot read the config file ${path}: ${(e as Error).message}`); }
  let raw: unknown;
  try {
    raw = /\.json$/i.test(path) || /^\s*[{[]/.test(text) ? JSON.parse(text) : parseYaml(text);
  } catch (e) {
    throw new ConfigError(`${path}: ${(e as Error).message}`);
  }
  return parseConfig(raw, path);
}

/** A secret from the environment: VAR, or the contents of the file named by VAR_FILE. Registered for redaction. */
export function secret(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let v = env[name];
  if ((v === undefined || v === '') && env[`${name}_FILE`]) {
    try { v = readFileSync(env[`${name}_FILE`]!, 'utf8'); } catch (e) { throw new ConfigError(`${name}_FILE: cannot read ${env[`${name}_FILE`]}: ${(e as Error).message}`); }
  }
  const s = v?.trim() || null;
  addSecret(s);
  return s;
}

export function requireSecret(name: string, what: string, env: NodeJS.ProcessEnv = process.env): string {
  const s = secret(name, env);
  if (!s) throw new ConfigError(`${what}: set the environment variable ${name} (or ${name}_FILE with the path of a file that holds it)`);
  return s;
}

/** The QE Navigator team id of a record, from the source's mapping; null when unmapped. */
export function teamFor(src: SourceConfig, keys: Array<string | null | undefined>): string | null {
  for (const k of keys) if (k && src.teams[k]) return src.teams[k];
  return src.defaultTeam;
}
