/**
 * Configuration: one YAML or JSON file (no secrets) plus the secrets, from environment variables (VAR, or a file
 * named by VAR_FILE: Docker / Kubernetes secrets) or the credentials file the setup page writes (0600, in a 0700
 * folder; never logged, never sent to QE Navigator).
 *
 * The file is validated strictly: unknown keys are refused (a typo never silently disables a setting) and any key
 * that looks like a credential (token, apiKey, password, secret, salt) is refused. Settings of releases before 0.3.0
 * that no longer apply (privacy.mode, the local copy, recalcDays, serve, mainBranches) are accepted and ignored,
 * with a warning, so an existing config keeps working.
 *
 * Every request names the company, the department and the team: qeNavigator.companyId, and `teams` (team id → its
 * department id); each source maps its repositories / projects / services to team ids.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseYaml } from './yaml';
import { addSecret } from './log';
import { credentialValue, loadCredentials } from './credentials';

export class ConfigError extends Error {}

export type SourceType = 'jira' | 'linear' | 'pagerduty' | 'opsgenie' | 'github' | 'gitlab' | 'bitbucket' | 'bitbucket-dc' | 'jenkins' | 'azure-devops' | 'sonarqube' | 'kpis'
  | 'testrail' | 'xray' | 'zephyr' | 'google-calendar' | 'microsoft-365';
export const SOURCE_TYPES: SourceType[] = ['jira', 'linear', 'pagerduty', 'opsgenie', 'github', 'gitlab', 'bitbucket', 'bitbucket-dc', 'jenkins', 'azure-devops', 'sonarqube', 'kpis',
  'testrail', 'xray', 'zephyr', 'google-calendar', 'microsoft-365'];
/** The CI and code-quality sources (read pipelines, tests, coverage, deployments, findings) as opposed to the issue and incident tools. */
export const CI_TYPES: SourceType[] = ['github', 'gitlab', 'bitbucket', 'bitbucket-dc', 'jenkins', 'azure-devops', 'sonarqube', 'testrail', 'xray', 'zephyr', 'google-calendar', 'microsoft-365'];

/** What issue and incident records may carry (people are never sent by name; titles and links only when enabled). */
export interface Privacy {
  /** Send issue / incident titles (default false: the key or id only). */
  sendTitles: boolean;
  /** Send a link back to the issue / incident (default false: it names your internal host). */
  sendLinks: boolean;
  /** none (default): no person is sent at all; hash: a salted HMAC of the assignee / first responder, computed here. */
  people: 'none' | 'hash';
  /**
   * Developer metrics (default false). When true, the author of a pull request and the person of a calendar day are sent as
   * a pseudonym QE Navigator can match to its own users: sha256(lower(e-mail) + ':' + company id). QE Navigator keeps it only
   * for a user who enabled developer insights. When false, pull requests are sent without an author and calendars are not read.
   */
  developerMetrics: boolean;
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
  /** Jira labels that mark test-automation work (e.g. automation, qa-automation): such an issue is sent with the label "test-automation" (its time logged is the time invested of automation ROI). */
  automationLabels: string[];
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
export interface ArtifactSettings { tests: string[]; coverage: string[]; sarif: string[]; /** Load-test results: k6 summary export, JMeter statistics.json, Gatling stats.json. */ performance: string[]; maxMB: number }

export interface GitHubSource extends SourceBase {
  type: 'github';
  apiUrl: string;
  /** token: a fine-grained or classic PAT (GITHUB_TOKEN); app: a GitHub App installation (app id, installation id, private key in GITHUB_APP_PRIVATE_KEY); oauth: a token from your own OAuth app (setup page). */
  auth: 'token' | 'app' | 'oauth';
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
  /** Read the pull requests of the mapped repositories (developer metrics). */
  pullRequests?: boolean;
}

export interface GitLabSource extends SourceBase {
  type: 'gitlab';
  apiUrl: string;
  /** token: a personal / group / project access token (PRIVATE-TOKEN); oauth: a token from your own GitLab application (setup page). */
  auth: 'token' | 'oauth';
  environments: string[];
  artifacts: ArtifactSettings;
  maxRunsPerRepo: number;
  /** Read the pull requests of the mapped repositories (developer metrics). */
  pullRequests?: boolean;
}

/** Bitbucket Cloud (api.bitbucket.org): app password (username + app password) or OAuth with your own OAuth consumer. */
export interface BitbucketSource extends SourceBase {
  type: 'bitbucket';
  apiUrl: string;
  auth: 'app-password' | 'oauth';
  username: string | null;
  usernameEnv: string;
  environments: string[];
  artifacts: ArtifactSettings;
  maxRunsPerRepo: number;
  /** Read the pull requests of the mapped repositories (developer metrics). */
  pullRequests?: boolean;
}

/** Bitbucket Data Center / Server: an HTTP access token (Bearer) with read permission; builds from the build status API, deployments from the deployments API (8.x and later). */
export interface BitbucketDcSource extends SourceBase {
  type: 'bitbucket-dc';
  baseUrl: string;
  environments: string[];
  maxRunsPerRepo: number;
  allowHttp: boolean;
}

/**
 * KPI values that no tool records as raw data (automation coverage, automation ROI, …): read from a JSON file your
 * own scripts write (path), sent as the envelope kind kpis. teams: the file's team key → QE Navigator team id.
 */
export interface KpisSource extends SourceBase {
  type: 'kpis';
  path: string;
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
  /** Read the pull requests of the mapped repositories (developer metrics). */
  pullRequests?: boolean;
}

export interface SonarQubeSource extends SourceBase {
  type: 'sonarqube';
  baseUrl: string;
  auth: 'bearer' | 'basic';
  /** Branch to read (empty: the main branch). */
  branch: string | null;
  /**
   * Also read the project's coverage totals (lines and conditions to cover and uncovered) and send them as a
   * coverage report. For teams whose CI keeps no coverage report (Bitbucket). Off by default: a team whose CI
   * already sends coverage files would get two reports of the same code.
   */
  coverage: boolean;
  allowHttp: boolean;
}

/** TestRail: test cases (automated or not, estimate) and test results. `teams` maps a TestRail project id to a team. */
export interface TestRailSource extends SourceBase {
  type: 'testrail';
  baseUrl: string;
  user: string | null;
  userEnv: string;
  /** The case field that says how a case is automated (0 / empty = not automated); cases of a type named "Automated" count too. */
  automatedField: string;
  allowHttp: boolean;
}
/** Xray Cloud (client id + secret): tests with their type, test executions. `teams` maps a Jira project key to a team. */
export interface XraySource extends SourceBase {
  type: 'xray';
  apiUrl: string;
  clientId: string | null;
  clientIdEnv: string;
  /** Test types that are manual (every other type is automated). */
  manualTypes: string[];
}
/** Zephyr Scale Cloud (API access token): test cases and test executions. `teams` maps a Jira project key to a team. */
export interface ZephyrSource extends SourceBase {
  type: 'zephyr';
  apiUrl: string;
  /** The custom field that says a case is automated, and the values that mean yes; a case with one of `automatedLabels` counts too. */
  automatedField: string;
  automatedValues: string[];
  automatedLabels: string[];
}
/** Calendars (free/busy only). `teams` maps a person's e-mail address to a team; the address never leaves (a pseudonym is sent). */
export interface CalendarSourceBase extends SourceBase {
  /** Working hours and time zone used for every person (Microsoft 365: the person's own working hours when the tenant gives them). */
  workStart: string;
  workEnd: string;
  timeZone: string;
  /** Days read before today on the first run and again on every run (calendars change afterwards). */
  lookbackDays: number;
}
export interface GoogleCalendarSource extends CalendarSourceBase {
  type: 'google-calendar';
  apiUrl: string;
  tokenUrl: string;
  /** The service account's e-mail address (its private key is the secret) and the user it acts as (domain-wide delegation, scope calendar.freebusy). */
  serviceAccount: string;
  subject: string;
}
export interface Microsoft365Source extends CalendarSourceBase {
  type: 'microsoft-365';
  apiUrl: string;
  loginUrl: string;
  tenantId: string;
  clientId: string;
}

export type CiSourceConfig = GitHubSource | GitLabSource | BitbucketSource | BitbucketDcSource | JenkinsSource | AzureDevOpsSource | SonarQubeSource
  | TestRailSource | XraySource | ZephyrSource | GoogleCalendarSource | Microsoft365Source;
export type SourceConfig = JiraSource | LinearSource | PagerDutySource | OpsgenieSource | KpisSource | CiSourceConfig;
export const isCiSource = (s: SourceConfig): s is CiSourceConfig => CI_TYPES.includes(s.type);

export interface Config {
  path: string;
  qeNavigator: { url: string; apiKeyEnv: string; caFile: string | null; requestsPerMinute: number; timeoutSeconds: number; companyId: string | null };
  /** QE Navigator team id → its department id: every request names the company, the department and the team. */
  teams: Record<string, string>;
  privacy: Privacy;
  peopleSaltEnv: string;
  statePath: string;
  /** The credentials file of the setup page (0600 in a 0700 folder): secrets that are not in the environment. */
  credentialsPath: string;
  /** A short name of this machine, sent as X-Exporter-Host (shown to QE Navigator's operators); default the host name. */
  hostLabel: string | null;
  setup: { host: string; port: number };
  /** Settings of releases before 0.3.0 that no longer apply: accepted, ignored and named here. */
  ignored: string[];
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

export const DEFAULT_TOKEN_ENV: Record<SourceType, string> = {
  jira: 'JIRA_TOKEN', linear: 'LINEAR_API_KEY', pagerduty: 'PAGERDUTY_TOKEN', opsgenie: 'OPSGENIE_API_KEY',
  github: 'GITHUB_TOKEN', gitlab: 'GITLAB_TOKEN', bitbucket: 'BITBUCKET_APP_PASSWORD', 'bitbucket-dc': 'BITBUCKET_TOKEN', jenkins: 'JENKINS_TOKEN', 'azure-devops': 'AZURE_DEVOPS_TOKEN', sonarqube: 'SONAR_TOKEN',
  kpis: 'QE_KPIS_UNUSED',
  testrail: 'TESTRAIL_API_KEY', xray: 'XRAY_CLIENT_SECRET', zephyr: 'ZEPHYR_TOKEN', 'google-calendar': 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'microsoft-365': 'MS365_CLIENT_SECRET',
};
/** The key a source's team mapping is written under in the config (stored as `teams`). */
export const MAP_KEY: Partial<Record<SourceType, string>> = { github: 'repos', gitlab: 'projects', bitbucket: 'repos', 'bitbucket-dc': 'repos', jenkins: 'jobs', 'azure-devops': 'pipelines', sonarqube: 'projects',
  testrail: 'projects', xray: 'projects', zephyr: 'projects', 'google-calendar': 'people', 'microsoft-365': 'people' };
const DEFAULT_ARTIFACTS = {
  tests: ['*test*', '*junit*', '*result*', '*report*', '*.trx', '*cucumber*'],
  coverage: ['*coverage*', '*lcov*', '*cobertura*', '*jacoco*'],
  sarif: ['*sarif*', '*codeql*', '*semgrep*', '*sast*', '*analysis*'],
  performance: ['*perf*', '*load*', '*k6*', '*jmeter*', '*gatling*'],
};
const list = (v: unknown, where: string, def: string[] = []): string[] => {
  if (v === undefined || v === null) return def;
  if (!Array.isArray(v)) throw new ConfigError(`${where} must be a list`);
  return v.map((x, j) => reqStr(x, `${where}[${j}]`));
};
function artifacts(v: unknown, where: string): ArtifactSettings {
  const o = obj(v, where);
  only(o, ['tests', 'coverage', 'sarif', 'performance', 'maxMB'], where);
  return {
    tests: list(o.tests, `${where}.tests`, DEFAULT_ARTIFACTS.tests), coverage: list(o.coverage, `${where}.coverage`, DEFAULT_ARTIFACTS.coverage),
    sarif: list(o.sarif, `${where}.sarif`, DEFAULT_ARTIFACTS.sarif), performance: list(o.performance, `${where}.performance`, DEFAULT_ARTIFACTS.performance), maxMB: int(o.maxMB, `${where}.maxMB`, 50, 1, 500),
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
  // Pull requests (opened, first review, merged) of the mapped repositories, for the developer metrics (default: not read).
  const prs = () => (o.pullRequests === 'yes' ? true : o.pullRequests === 'no' ? false : bool(o.pullRequests, `${where}.pullRequests`, false));
  if (type === 'github') {
    only(o, [...ciCommon, 'apiUrl', 'auth', 'appId', 'installationId', 'privateKeyEnv', 'workflows', 'branches', 'environments', 'pullRequests'], where);
    const auth = str(o.auth, `${where}.auth`, 'token');
    if (auth !== 'token' && auth !== 'app' && auth !== 'oauth') throw new ConfigError(`${where}.auth must be token (a personal access token), app (a GitHub App installation) or oauth (your own OAuth app, connected on the setup page)`);
    const appId = str(o.appId, `${where}.appId`);
    const installationId = str(o.installationId, `${where}.installationId`);
    if (auth === 'app' && (!appId || !/^\d+$/.test(appId) || !installationId || !/^\d+$/.test(installationId))) throw new ConfigError(`${where}: auth: app needs appId and installationId (numbers, from the app's settings and its installation URL)`);
    for (const r of Object.keys(base.teams)) if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) throw new ConfigError(`${where}.repos.${r} must be owner/name`);
    return {
      ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://api.github.com'), auth, appId, installationId,
      privateKeyEnv: envName(o.privateKeyEnv, `${where}.privateKeyEnv`, 'GITHUB_APP_PRIVATE_KEY'), workflows: list(o.workflows, `${where}.workflows`),
      branches: list(o.branches, `${where}.branches`), environments: envs(), artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns(), pullRequests: prs(),
    };
  }
  if (type === 'gitlab') {
    only(o, [...ciCommon, 'apiUrl', 'environments', 'auth', 'pullRequests'], where);
    const auth = str(o.auth, `${where}.auth`, 'token');
    if (auth !== 'token' && auth !== 'oauth') throw new ConfigError(`${where}.auth must be token or oauth`);
    return { ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://gitlab.com/api/v4'), auth, environments: envs(), artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns(), pullRequests: prs() };
  }
  if (type === 'bitbucket') {
    only(o, [...ciCommon, 'apiUrl', 'auth', 'username', 'usernameEnv', 'environments', 'pullRequests'], where);
    const auth = str(o.auth, `${where}.auth`, 'app-password');
    if (auth !== 'app-password' && auth !== 'oauth') throw new ConfigError(`${where}.auth must be app-password (username + app password) or oauth (your own OAuth consumer, connected on the setup page)`);
    for (const r of Object.keys(base.teams)) if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) throw new ConfigError(`${where}.repos.${r} must be workspace/repo`);
    return {
      ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://api.bitbucket.org/2.0'), auth, username: str(o.username, `${where}.username`),
      usernameEnv: envName(o.usernameEnv, `${where}.usernameEnv`, 'BITBUCKET_USERNAME'), environments: envs(), artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns(), pullRequests: prs(),
    };
  }
  if (type === 'bitbucket-dc') {
    only(o, [...common, 'baseUrl', 'environments', 'maxRunsPerRepo', 'allowHttp'], where);
    for (const r of Object.keys(base.teams)) if (!/^[A-Za-z0-9_.~-]+\/[A-Za-z0-9_.-]+$/.test(r)) throw new ConfigError(`${where}.repos.${r} must be PROJECT/repo`);
    const allowHttp = bool(o.allowHttp, `${where}.allowHttp`, false);
    return { ...base, type, baseUrl: httpsUrl(o.baseUrl, `${where}.baseUrl`, undefined, allowHttp), environments: envs(), maxRunsPerRepo: maxRuns(), allowHttp };
  }
  if (type === 'kpis') {
    only(o, [...common, 'path'], where);
    if (!Object.keys(base.teams).length && !base.defaultTeam) throw new ConfigError(`${where}.teams must map at least one key of the file to a QE Navigator team id (or set defaultTeam)`);
    return { ...base, type, path: reqStr(o.path, `${where}.path`) };
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
    only(o, [...ciCommon, 'orgUrl', 'project', 'environments', 'releases', 'releasesUrl', 'pullRequests'], where);
    const orgUrl = httpsUrl(o.orgUrl, `${where}.orgUrl`);
    const org = new URL(orgUrl).pathname.split('/').filter(Boolean)[0] ?? new URL(orgUrl).hostname.split('.')[0];
    return {
      ...base, type, orgUrl, project: reqStr(o.project, `${where}.project`), environments: envs(), releases: bool(o.releases, `${where}.releases`, false), pullRequests: prs(),
      releasesUrl: httpsUrl(o.releasesUrl, `${where}.releasesUrl`, `https://vsrm.dev.azure.com/${org}`), artifacts: artifacts(o.artifacts, `${where}.artifacts`), maxRunsPerRepo: maxRuns(),
    };
  }
  if (type === 'sonarqube') {
    only(o, [...common, 'baseUrl', 'auth', 'branch', 'coverage', 'allowHttp'], where);
    const auth = str(o.auth, `${where}.auth`, 'bearer');
    if (auth !== 'bearer' && auth !== 'basic') throw new ConfigError(`${where}.auth must be bearer (SonarQube 10+, SonarCloud) or basic (older SonarQube: the token as user name)`);
    const allowHttp = bool(o.allowHttp, `${where}.allowHttp`, false);
    // The setup page writes yes / no; a config file may say true / false.
    const coverage = o.coverage === 'yes' ? true : o.coverage === 'no' ? false : bool(o.coverage, `${where}.coverage`, false);
    return { ...base, type, baseUrl: httpsUrl(o.baseUrl, `${where}.baseUrl`, 'https://sonarcloud.io', allowHttp), auth, branch: str(o.branch, `${where}.branch`), coverage, allowHttp };
  }
  if (type === 'testrail') {
    only(o, [...common, 'baseUrl', 'user', 'userEnv', 'automatedField', 'allowHttp'], where);
    const allowHttp = bool(o.allowHttp, `${where}.allowHttp`, false);
    for (const k of Object.keys(base.teams)) if (!/^\d+$/.test(k)) throw new ConfigError(`${where}.projects.${k} must be a TestRail project id (a number)`);
    return { ...base, type, baseUrl: httpsUrl(o.baseUrl, `${where}.baseUrl`, undefined, allowHttp), user: str(o.user, `${where}.user`), userEnv: envName(o.userEnv, `${where}.userEnv`, 'TESTRAIL_USER'),
      automatedField: str(o.automatedField, `${where}.automatedField`, 'custom_automation_type')!, allowHttp };
  }
  if (type === 'xray') {
    only(o, [...common, 'apiUrl', 'clientId', 'clientIdEnv', 'manualTypes'], where);
    return { ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://xray.cloud.getxray.app/api/v2'), clientId: str(o.clientId, `${where}.clientId`),
      clientIdEnv: envName(o.clientIdEnv, `${where}.clientIdEnv`, 'XRAY_CLIENT_ID'), manualTypes: list(o.manualTypes, `${where}.manualTypes`, ['Manual']).map((x) => x.toLowerCase()) };
  }
  if (type === 'zephyr') {
    only(o, [...common, 'apiUrl', 'automatedField', 'automatedValues', 'automatedLabels'], where);
    return { ...base, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://api.zephyrscale.smartbear.com/v2'), automatedField: str(o.automatedField, `${where}.automatedField`, 'Automated')!,
      automatedValues: list(o.automatedValues, `${where}.automatedValues`, ['true', 'yes', 'automated']).map((x) => x.toLowerCase()),
      automatedLabels: list(o.automatedLabels, `${where}.automatedLabels`, ['automated', 'automation']).map((x) => x.toLowerCase()) };
  }
  if (type === 'google-calendar' || type === 'microsoft-365') {
    const cal = ['workStart', 'workEnd', 'timeZone', 'lookbackDays'];
    const hhmm = (v: unknown, k: string, def: string) => { const s = str(v, `${where}.${k}`, def)!; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new ConfigError(`${where}.${k} must be a time of day as HH:MM`); return s; };
    const zone = str(o.timeZone, `${where}.timeZone`, 'UTC')!;
    try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { throw new ConfigError(`${where}.timeZone must be an IANA time zone such as Europe/Dublin`); }
    for (const k of Object.keys(base.teams)) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k)) throw new ConfigError(`${where}.people: "${k.slice(0, 40)}" must be an e-mail address (it stays here: a pseudonym is sent)`);
    if (!Object.keys(base.teams).length) throw new ConfigError(`${where}.people must map each person's e-mail address to a QE Navigator team id`);
    const shared = { workStart: hhmm(o.workStart, 'workStart', '09:00'), workEnd: hhmm(o.workEnd, 'workEnd', '17:00'), timeZone: zone, lookbackDays: int(o.lookbackDays, `${where}.lookbackDays`, 35, 1, 60) };
    if (shared.workEnd <= shared.workStart) throw new ConfigError(`${where}.workEnd must be after workStart`);
    if (type === 'google-calendar') {
      only(o, [...common, ...cal, 'apiUrl', 'tokenUrl', 'serviceAccount', 'subject'], where);
      return { ...base, ...shared, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://www.googleapis.com/calendar/v3'), tokenUrl: httpsUrl(o.tokenUrl, `${where}.tokenUrl`, 'https://oauth2.googleapis.com/token'),
        serviceAccount: reqStr(o.serviceAccount, `${where}.serviceAccount`), subject: reqStr(o.subject, `${where}.subject`) };
    }
    only(o, [...common, ...cal, 'apiUrl', 'loginUrl', 'tenantId', 'clientId'], where);
    return { ...base, ...shared, type, apiUrl: httpsUrl(o.apiUrl, `${where}.apiUrl`, 'https://graph.microsoft.com/v1.0'), loginUrl: httpsUrl(o.loginUrl, `${where}.loginUrl`, 'https://login.microsoftonline.com'),
      tenantId: reqStr(o.tenantId, `${where}.tenantId`), clientId: reqStr(o.clientId, `${where}.clientId`) };
  }
  if (type === 'jira') {
    only(o, [...common, 'baseUrl', 'deployment', 'auth', 'email', 'emailEnv', 'jql', 'fields', 'pageSize', 'allowHttp', 'automationLabels'], where);
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
    if (/\border\s+by\b/i.test(jql)) throw new ConfigError(`${where}.jql must not contain ORDER BY (the Exporter adds "updated >= … ORDER BY updated")`);
    return {
      ...base, type, baseUrl, deployment, email: str(o.email, `${where}.email`), emailEnv: envName(o.emailEnv, `${where}.emailEnv`, 'JIRA_EMAIL'), jql,
      fields: { storyPoints: fid('storyPoints'), sprint: fid('sprint'), environment: fid('environment'), flagged: fid('flagged') },
      pageSize: int(o.pageSize, `${where}.pageSize`, 100, 1, 100), automationLabels: list(o.automationLabels, `${where}.automationLabels`).map((x) => x.toLowerCase()),
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

/** ./qe-exporter-state.json, or the state file of an earlier release (qe-collector-state.json, qe-agent-state.json) when only that exists. */
export function defaultStatePath(exists: (p: string) => boolean = existsSync): string {
  for (const p of ['./qe-exporter-state.json', './qe-collector-state.json', './qe-agent-state.json']) if (exists(p)) return p;
  return './qe-exporter-state.json';
}

const LEGACY_TOP = ['recalcDays', 'mainBranches', 'serve'];

export function parseConfig(raw: unknown, path = '(inline)'): Config {
  const o = obj(raw, 'config');
  only(o, ['qeNavigator', 'teams', 'privacy', 'state', 'credentials', 'hostLabel', 'setup', 'heartbeat', 'backfillDays', 'overlapMinutes', 'http', 'sources', ...LEGACY_TOP], 'config');
  const ignored: string[] = LEGACY_TOP.filter((k) => o[k] !== undefined);
  const qe = obj(o.qeNavigator, 'qeNavigator');
  only(qe, ['url', 'apiKeyEnv', 'caFile', 'requestsPerMinute', 'timeoutSeconds', 'companyId'], 'qeNavigator');
  const pr = obj(o.privacy, 'privacy');
  only(pr, ['sendTitles', 'sendLinks', 'people', 'saltEnv', 'developerMetrics', 'mode', 'localEvidenceUrl'], 'privacy');
  for (const k of ['mode', 'localEvidenceUrl']) if (pr[k] !== undefined) ignored.push(`privacy.${k}`);
  const people = str(pr.people, 'privacy.people', 'none');
  if (people !== 'none' && people !== 'hash') throw new ConfigError('privacy.people must be none or hash');
  const st = obj(o.state, 'state');
  only(st, ['path', 'dataDir', 'retentionDays', 'detailDays'], 'state');
  for (const k of ['dataDir', 'retentionDays', 'detailDays']) if (st[k] !== undefined) ignored.push(`state.${k}`);
  const cr = obj(o.credentials, 'credentials');
  only(cr, ['path'], 'credentials');
  const su = obj(o.setup, 'setup');
  only(su, ['host', 'port'], 'setup');
  const h = obj(o.http, 'http');
  only(h, ['timeoutSeconds', 'maxRetries', 'maxRetryWaitSeconds', 'caFile'], 'http');
  if (!Array.isArray(o.sources) || o.sources.length === 0) throw new ConfigError(`sources must list at least one source (${SOURCE_TYPES.join(', ')})`);
  const names = new Set<string>();
  const statePath = str(st.path, 'state.path', defaultStatePath())!;
  const companyId = str(qe.companyId, 'qeNavigator.companyId');
  if (companyId && !TEAM_ID.test(companyId)) throw new ConfigError('qeNavigator.companyId must be your QE Navigator company id (Admin console → Connect your CI)');
  const teams: Record<string, string> = {};
  for (const [t, d] of Object.entries(obj(o.teams, 'teams'))) {
    if (!TEAM_ID.test(t)) throw new ConfigError(`teams.${t} must be keyed by a QE Navigator team id`);
    if (typeof d !== 'string' || !TEAM_ID.test(d)) throw new ConfigError(`teams.${t} must be the id of the team's department`);
    teams[t] = d;
  }
  const setupHost = str(su.host, 'setup.host', '127.0.0.1')!;
  const hostLabel = str(o.hostLabel, 'hostLabel');
  if (hostLabel && !/^[A-Za-z0-9._-]{1,100}$/.test(hostLabel)) throw new ConfigError('hostLabel must be letters, digits, ".", "-" or "_" (at most 100)');
  return {
    path,
    qeNavigator: {
      url: httpsUrl(qe.url, 'qeNavigator.url', 'https://app.irongate.ie'), apiKeyEnv: envName(qe.apiKeyEnv, 'qeNavigator.apiKeyEnv', 'QE_API_KEY'),
      caFile: str(qe.caFile, 'qeNavigator.caFile'), requestsPerMinute: int(qe.requestsPerMinute, 'qeNavigator.requestsPerMinute', 50, 1, 60),
      timeoutSeconds: int(qe.timeoutSeconds, 'qeNavigator.timeoutSeconds', 120, 5, 600), companyId,
    },
    teams,
    privacy: { sendTitles: bool(pr.sendTitles, 'privacy.sendTitles', false), sendLinks: bool(pr.sendLinks, 'privacy.sendLinks', false), people, developerMetrics: bool(pr.developerMetrics, 'privacy.developerMetrics', false) },
    peopleSaltEnv: envName(pr.saltEnv, 'privacy.saltEnv', 'QE_PEOPLE_SALT'),
    statePath,
    credentialsPath: str(cr.path, 'credentials.path', join(dirname(path === '(inline)' ? statePath : path), 'qe-exporter-credentials', 'credentials.json'))!,
    hostLabel,
    setup: { host: setupHost, port: int(su.port, 'setup.port', 8788, 1, 65535) },
    ignored,
    heartbeat: bool(o.heartbeat, 'heartbeat', true),
    backfillDays: int(o.backfillDays, 'backfillDays', 90, 1, 365),
    overlapMinutes: int(o.overlapMinutes, 'overlapMinutes', 10, 0, 1440),
    http: {
      timeoutSeconds: int(h.timeoutSeconds, 'http.timeoutSeconds', 30, 1, 600), maxRetries: int(h.maxRetries, 'http.maxRetries', 5, 0, 10),
      maxRetryWaitSeconds: int(h.maxRetryWaitSeconds, 'http.maxRetryWaitSeconds', 120, 1, 3600), caFile: str(h.caFile, 'http.caFile'),
    },
    sources: o.sources.map((x, i) => source(x, i, names)),
  };
}

/** The department of every mapped team, and the company: what is missing before anything can be sent (empty when complete). */
export function targetProblems(cfg: Config): string[] {
  const out: string[] = [];
  if (!cfg.qeNavigator.companyId) out.push('qeNavigator.companyId is not set (your QE Navigator company id: Admin console → Connect your CI, or the setup page)');
  for (const t of mappedTeams(cfg)) if (!cfg.teams[t]) out.push(`team ${t} has no department in "teams" (add "${t}: <department id>")`);
  return out;
}

/** Every QE Navigator team id the sources map to. */
export function mappedTeams(cfg: Pick<Config, 'sources'>): string[] {
  const teams = new Set<string>();
  for (const src of cfg.sources) {
    for (const t of Object.values(src.teams)) teams.add(t);
    if ('services' in src) for (const t of Object.values(src.services)) teams.add(t);
    if ('deployJobs' in src) for (const t of Object.values(src.deployJobs)) teams.add(t);
    if (src.defaultTeam) teams.add(src.defaultTeam);
  }
  return Array.from(teams);
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
  const cfg = parseConfig(raw, path);
  // QE_NAVIGATOR_URL overrides qeNavigator.url (e.g. a test installation); https only, as in the file.
  if (process.env.QE_NAVIGATOR_URL) cfg.qeNavigator.url = httpsUrl(process.env.QE_NAVIGATOR_URL, 'QE_NAVIGATOR_URL');
  loadCredentials(cfg.credentialsPath);
  return cfg;
}

/**
 * A secret: the environment variable VAR, else the contents of the file named by VAR_FILE, else the setup page's
 * credentials file (an OAuth credential gives its current access token). Registered for redaction.
 */
export function secret(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let v = env[name];
  if ((v === undefined || v === '') && env[`${name}_FILE`]) {
    try { v = readFileSync(env[`${name}_FILE`]!, 'utf8'); } catch (e) { throw new ConfigError(`${name}_FILE: cannot read ${env[`${name}_FILE`]}: ${(e as Error).message}`); }
  }
  if (v === undefined || v === '') v = credentialValue(name) ?? undefined;
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
