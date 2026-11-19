/**
 * "Demo Data" organisation (platform operator panel): realistic departments, Scrum teams and people
 * for an existing company, the teams' year-long stories, and the Scrum content layer (retro actions
 * of every sprint, alert history, an API key with its CI ingestion log, completed onboarding, a raised
 * coverage target). The same organisation shape as the Meridian showcase (scripts/reseed/gen_showcase.py
 * and showcase-content.sql), generated for any company and any size.
 *
 * Pure: plans rows and renders SQL; server/lib/demoGenerate.ts writes them.
 */
import { createHash, randomInt } from 'crypto';
import { defaultTeamHealth } from './demoData';

// ============================================================================
// Names
// ============================================================================

export interface DeptTemplate {
  name: string; head: string; description: string; tz: string;
  teams: Array<[name: string, platform: string, description: string]>;
}

/** Product-aligned departments with their teams (first unused ones are taken, in this order). */
export const DEPARTMENTS: DeptTemplate[] = [
  { name: 'Payments', head: 'Head of Payments Engineering', description: 'Checkout, ledger, payouts and card issuing', tz: 'Europe/London', teams: [
    ['Checkout Core', 'Backend API', 'Payment intents, 3-D Secure and order confirmation'], ['Ledger & Settlements', 'Backend API', 'Double-entry ledger, payouts and reconciliation'],
    ['Card Issuing', 'Backend API', 'Virtual and physical card lifecycle and authorisations'], ['Payment Methods', 'Backend API', 'Wallets, bank transfers and local payment methods'],
    ['Payouts', 'Backend API', 'Merchant payouts, schedules and FX'], ['Disputes & Chargebacks', 'Web', 'Dispute evidence, chargeback workflows and representment'],
    ['Billing', 'Backend API', 'Invoices, subscriptions and usage-based billing'], ['Fraud Rules', 'Data / ML', 'Real-time payment risk rules'],
  ] },
  { name: 'Mobile Apps', head: 'Head of Mobile Engineering', description: 'The customer apps on iOS and Android', tz: 'Europe/Berlin', teams: [
    ['iOS App', 'iOS & Android', 'The iOS customer app'], ['Android App', 'iOS & Android', 'The Android customer app'],
    ['Mobile Onboarding', 'iOS & Android', 'Sign-up, identity checks and first steps in the app'], ['Mobile Platform', 'iOS & Android', 'Shared mobile components, release trains and app health'],
    ['Notifications', 'Backend API', 'Push, in-app messages and preferences'], ['Design System', 'Web', 'Shared UI components and tokens across web and mobile'],
    ['App Performance', 'iOS & Android', 'Start-up time, crash rate and offline mode'], ['Wallet & Cards UI', 'iOS & Android', 'Cards, wallets and spending screens'],
  ] },
  { name: 'Platform & Infrastructure', head: 'Head of Platform Engineering', description: 'Cloud platform, developer experience and reliability', tz: 'Europe/Amsterdam', teams: [
    ['Cloud Platform', 'Infrastructure', 'Kubernetes, networking and cloud accounts'], ['Developer Experience', 'Infrastructure', 'CI/CD, build tooling and internal developer portal'],
    ['Site Reliability', 'Infrastructure', 'Observability, incident response and SLOs'], ['Data Platform', 'Data / ML', 'Event streaming, warehouse and data quality'],
    ['Identity & Access', 'Backend API', 'Authentication, single sign-on and permissions'], ['API Gateway', 'Backend API', 'Public API, rate limits and developer keys'],
    ['Security Engineering', 'Infrastructure', 'Application security, secrets and vulnerability management'], ['Core Services', 'Backend API', 'Shared domain services and messaging'],
  ] },
  { name: 'Risk & Compliance', head: 'Head of Risk Engineering', description: 'Fraud, KYC, AML and regulatory reporting', tz: 'Europe/Dublin', teams: [
    ['Fraud Detection', 'Data / ML', 'Real-time fraud models and case management'], ['KYC & Onboarding', 'Web', 'Identity verification and customer due diligence'],
    ['AML Monitoring', 'Data / ML', 'Transaction monitoring and suspicious activity reports'], ['Regulatory Reporting', 'Data / ML', 'Reports to regulators and auditors'],
    ['Sanctions Screening', 'Backend API', 'Name screening and payment filtering'], ['Credit Risk', 'Data / ML', 'Credit decisions and limits'],
    ['Case Management', 'Web', 'Tools for risk analysts'], ['Consent & Privacy', 'Backend API', 'Consent records, data subject requests and retention'],
  ] },
  { name: 'Merchant Services', head: 'Head of Merchant Engineering', description: 'Merchant onboarding, dashboard and integrations', tz: 'America/New_York', teams: [
    ['Merchant Dashboard', 'Web', 'Sales, payouts and disputes for merchants'], ['Merchant Onboarding', 'Web', 'Business verification and account setup'],
    ['Point of Sale', 'iOS & Android', 'In-store payments app and card readers'], ['E-commerce Plugins', 'Web', 'Shop platform plugins and SDKs'],
    ['Partner APIs', 'Backend API', 'Platform partners and marketplaces'], ['Merchant Reporting', 'Data / ML', 'Reports, exports and reconciliation files'],
    ['Pricing', 'Backend API', 'Fees, pricing plans and quotes'], ['Terminal Fleet', 'Infrastructure', 'Terminal provisioning and updates'],
  ] },
  { name: 'Core Banking', head: 'Head of Core Banking Engineering', description: 'Accounts, transfers and the core ledger', tz: 'Europe/Paris', teams: [
    ['Accounts', 'Backend API', 'Current and savings accounts'], ['Transfers', 'Backend API', 'Domestic and international transfers'],
    ['Savings & Interest', 'Backend API', 'Interest accrual and savings products'], ['Statements', 'Backend API', 'Statements and tax documents'],
    ['Direct Debits', 'Backend API', 'Mandates and scheduled payments'], ['Core Ledger', 'Backend API', 'Postings, balances and end-of-day'],
    ['Treasury', 'Data / ML', 'Liquidity, FX and treasury operations'], ['Open Banking', 'Backend API', 'Account information and payment initiation APIs'],
  ] },
  { name: 'Growth', head: 'Head of Growth Engineering', description: 'Acquisition, activation and referral', tz: 'Europe/Lisbon', teams: [
    ['Acquisition', 'Web', 'Landing pages, sign-up funnels and attribution'], ['Activation', 'Web', 'First-week experience and nudges'],
    ['Referrals & Rewards', 'Backend API', 'Referral programme and cashback'], ['Lifecycle Messaging', 'Backend API', 'Campaigns and lifecycle e-mails'],
    ['Pricing Experiments', 'Web', 'Plans, paywalls and pricing tests'], ['Localisation', 'Web', 'Languages, currencies and market launches'],
    ['Website', 'Web', 'Public website and content'], ['Partnerships', 'Backend API', 'Partner offers and integrations'],
  ] },
  { name: 'Customer Experience', head: 'Head of Customer Experience Engineering', description: 'Support, help centre and accessibility', tz: 'Europe/Warsaw', teams: [
    ['Help Centre', 'Web', 'Help articles, search and contact flows'], ['Support Automation', 'Data / ML', 'Chatbot, routing and macros'],
    ['Accessibility', 'Web', 'Accessibility audits and fixes across products'], ['Complaints', 'Web', 'Complaint handling and regulatory timelines'],
    ['Voice & IVR', 'Backend API', 'Telephony, IVR and call-back'], ['Feedback & NPS', 'Data / ML', 'Surveys, NPS and feedback loops'],
    ['Quality Engineering', 'Infrastructure', 'Shared test automation and environments'], ['Customer Communications', 'Backend API', 'Letters, SMS and secure messages'],
  ] },
  { name: 'Insurance', head: 'Head of Insurance Engineering', description: 'Policies, claims and partner insurers', tz: 'Europe/Zurich', teams: [
    ['Policy Administration', 'Backend API', 'Policies, renewals and endorsements'], ['Claims', 'Web', 'First notice of loss and claims handling'],
    ['Quote & Buy', 'Web', 'Quotes and purchase journey'], ['Insurer Integrations', 'Backend API', 'Partner insurer APIs'],
    ['Pricing Models', 'Data / ML', 'Rating engines and pricing models'], ['Device Protection', 'iOS & Android', 'Phone and gadget cover in the app'],
    ['Travel Insurance', 'Web', 'Travel cover and assistance'], ['Bordereaux', 'Data / ML', 'Partner reporting and reconciliation'],
  ] },
  { name: 'Wealth', head: 'Head of Wealth Engineering', description: 'Investing, pensions and trading', tz: 'Europe/Stockholm', teams: [
    ['Investing', 'iOS & Android', 'Stocks and funds in the app'], ['Pensions', 'Web', 'Pension accounts and transfers'],
    ['Trading Engine', 'Backend API', 'Order routing and execution'], ['Portfolio Analytics', 'Data / ML', 'Performance, risk and reporting'],
    ['Crypto', 'Backend API', 'Crypto buy, sell and custody'], ['Robo Advice', 'Data / ML', 'Goal-based portfolios and rebalancing'],
    ['Market Data', 'Infrastructure', 'Prices, reference data and feeds'], ['Tax Wrappers', 'Backend API', 'ISA, SIPP and tax reporting'],
  ] },
];

const FIRST = [
  'Aisha', 'Mateo', 'Sofia', 'Kenji', 'Amara', 'Lukas', 'Priya', 'Diego', 'Ingrid', 'Omar', 'Chloe', 'Tomasz', 'Mei', 'Kwame', 'Elena', 'Rafael',
  'Hannah', 'Arjun', 'Freya', 'Yusuf', 'Leila', 'Jonas', 'Camila', 'Henrik', 'Zara', 'Ravi', 'Nadia', 'Liam', 'Ana', 'Felix', 'Noor', 'Daniel',
  'Isabel', 'Sean', 'Yuki', 'Tobias', 'Fatima', 'Marco', 'Emma', 'Kofi', 'Lucia', 'Erik', 'Selin', 'Hugo', 'Maya', 'Pavel', 'Grace', 'Andrei',
  'Olivia', 'Samir', 'Clara', 'Jakub', 'Ines', 'Rohan', 'Saoirse', 'Matteo', 'Hana', 'Victor', 'Esme', 'Tariq', 'Laura', 'Niko', 'Adaeze', 'Bruno',
  'Julia', 'Ahmed', 'Sienna', 'Mikael', 'Rosa', 'Kai', 'Thandiwe', 'Paolo', 'Elif', 'James', 'Mariana', 'Dmitri', 'Nora', 'Ibrahim', 'Alice', 'Wei',
];
const LAST = [
  'Rahman', 'Silva', 'Lindqvist', 'Watanabe', 'Okafor', 'Becker', 'Natarajan', 'Moreno', 'Larsen', 'Haddad', 'Martin', 'Nowak', 'Chen', 'Mensah',
  'Petrova', 'Costa', 'Kessler', 'Malhotra', 'Walsh', 'Demir', 'Farah', 'Keller', 'Alves', 'Johansson', 'Ahmed', 'Iyer', 'Ivanova', "O'Brien",
  'Ferreira', 'Schmidt', 'Hussain', 'Osei', 'Laurent', 'Gallagher', 'Sato', 'Klein', 'Saleh', 'Bianchi', 'Fischer', 'Asante', 'Romero', 'Berg',
  'Yilmaz', 'Dubois', 'Shah', 'Kowalski', 'Adeyemi', 'Popescu', 'Grant', 'Nasser', 'Weber', 'Novak', 'Moreau', 'Kumar', 'Byrne', 'Rossi', 'Suzuki',
  'Mendes', 'Clarke', 'Karimi', 'Jensen', 'Virtanen', 'Eze', 'Santos', 'Murphy', 'Ali', 'Price', 'Andersen', 'Garcia', 'Volkov', 'Hansen', 'Musa',
  'Evans', 'Zhang', 'Kaur', 'Torres', 'Horvat', 'Nakamura', 'Ndlovu', 'Ricci',
];

/** Developer titles by platform, assigned in this order (cycled). */
const DEV_TITLES: Record<string, string[]> = {
  'Backend API': ['Senior Backend Engineer', 'Backend Engineer', 'QA Automation Engineer', 'Frontend Engineer', 'Software Engineer', 'DevOps Engineer', 'UX Designer', 'Staff Engineer', 'Test Automation Engineer', 'Backend Engineer'],
  Web: ['Senior Frontend Engineer', 'Frontend Engineer', 'QA Automation Engineer', 'Backend Engineer', 'UX Designer', 'Software Engineer', 'DevOps Engineer', 'Full Stack Engineer', 'Test Automation Engineer', 'Frontend Engineer'],
  'iOS & Android': ['Senior Mobile Engineer (iOS)', 'Mobile Engineer (Android)', 'QA Automation Engineer', 'Mobile Engineer', 'UX Designer', 'Backend Engineer', 'DevOps Engineer', 'Mobile Engineer (iOS)', 'Test Automation Engineer', 'Mobile Engineer (Android)'],
  'Data / ML': ['Senior Data Engineer', 'Machine Learning Engineer', 'QA Automation Engineer', 'Data Engineer', 'Backend Engineer', 'Analytics Engineer', 'DevOps Engineer', 'Data Scientist', 'Test Automation Engineer', 'Data Engineer'],
  Infrastructure: ['Senior Platform Engineer', 'Site Reliability Engineer', 'QA Automation Engineer', 'DevOps Engineer', 'Platform Engineer', 'Backend Engineer', 'Security Engineer', 'Cloud Engineer', 'Test Automation Engineer', 'Site Reliability Engineer'],
};

// ============================================================================
// Stories: how a team's health moved over the year (ends at its default health today)
// ============================================================================

export type StoryKind = 'strong' | 'improving' | 'recovering' | 'declining' | 'struggling';
/** The mix of stories over the new teams (cycled). */
export const STORY_ORDER: StoryKind[] = ['strong', 'struggling', 'improving', 'recovering', 'declining'];

/** The story of a team, from its health today (which the nightly refresh derives from the team id). */
export function storyKindOf(h: number): StoryKind {
  return h >= 0.84 ? 'strong' : h >= 0.7 ? 'improving' : h >= 0.56 ? 'recovering' : h >= 0.44 ? 'declining' : 'struggling';
}

/** Health per days ago over a year (interpolated by the sample model). */
export function storyFor(teamId: string): Array<[number, number]> {
  const h = defaultTeamHealth(teamId);
  const c = (v: number) => Math.round(Math.min(0.96, Math.max(0.1, v)) * 1000) / 1000;
  const pts: Record<StoryKind, Array<[number, number]>> = {
    strong: [[0, h], [90, h + 0.01], [180, h - 0.02], [270, h], [365, h - 0.03]],
    improving: [[0, h], [60, h - 0.08], [150, h - 0.2], [250, h - 0.3], [365, h - 0.32]],
    recovering: [[0, h], [50, h - 0.05], [110, h - 0.18], [170, h - 0.26], [220, h - 0.2], [290, h - 0.04], [365, h]],
    declining: [[0, h], [45, h + 0.04], [100, h + 0.17], [150, h + 0.28], [365, h + 0.32]],
    struggling: [[0, h], [120, h + 0.05], [240, h + 0.02], [365, h + 0.08]],
  };
  return pts[storyKindOf(h)].map(([d, v]) => [d, d === 0 ? h : c(v)] as [number, number]);
}

/** A new team id (the app's format) whose story is `kind`. */
export function teamIdFor(kind: StoryKind): string {
  for (let i = 0; i < 5000; i++) {
    const id = `team-${Date.now()}-${randomInt(0, 2 ** 40).toString(36).padStart(9, '0').slice(0, 9)}`;
    if (storyKindOf(defaultTeamHealth(id)) === kind) return id;
  }
  return `team-${Date.now()}-${randomInt(0, 2 ** 40).toString(36)}`;
}

// ============================================================================
// Organisation plan
// ============================================================================

export interface DemoSize { departments: number; teamsPerDepartment: number; membersPerTeam: number }
export const SIZE_LIMITS = { departments: [1, 10], teamsPerDepartment: [1, 8], membersPerTeam: [3, 12] } as const;

export type PersonKind = 'manager' | 'product_owner' | 'scrum_master' | 'engineer';
export interface PlannedPerson {
  id: string; first: string; last: string; email: string; title: string; kind: PersonKind;
  role: 'qa_manager' | 'viewer' | 'team_lead' | 'qa_engineer';
  departmentId: string; teamId: string | null; joinedDaysAgo: number; insights: boolean; tz: string;
}
export interface PlannedTeam { id: string; name: string; platform: string; description: string; departmentId: string; story: StoryKind }
export interface PlannedDept { id: string; name: string; description: string; head: string; tz: string }
export interface OrgPlan { departments: PlannedDept[]; teams: PlannedTeam[]; people: PlannedPerson[] }

/** The e-mail domain of the people: the company's own, or <company-slug>.example for a public e-mail domain. */
export function demoEmailDomain(company: { name: string; domain: string | null }, isPublic: (d: string) => boolean): string {
  const d = (company.domain ?? '').trim().toLowerCase();
  if (d && !isPublic(d)) return d;
  const slug = company.name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';
  return `${slug}.example`;
}

const ascii = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

/**
 * Plan departments, teams and people. `takenDepts` / `takenTeams` are the company's existing names
 * (lower case), `takenEmails` every e-mail in use (lower case); all three are updated. `newId` makes ids.
 */
export function planOrg(size: DemoSize, opts: {
  domain: string; takenDepts: Set<string>; takenTeams: Set<string>; takenEmails: Set<string>; newId: () => string;
}): OrgPlan {
  const plan: OrgPlan = { departments: [], teams: [], people: [] };
  const usedNames = new Set<string>();
  const person = (p: Omit<PlannedPerson, 'id' | 'first' | 'last' | 'email'>): PlannedPerson => {
    let first = '', last = '', email = '';
    for (let i = 0; ; i++) {
      first = FIRST[randomInt(0, FIRST.length)];
      last = LAST[randomInt(0, LAST.length)];
      const n = i < 200 ? '' : String(Math.floor(i / 200) + 1);
      email = `${ascii(first)}.${ascii(last)}${n}@${opts.domain}`;
      if (!opts.takenEmails.has(email) && (i >= 200 || !usedNames.has(`${first} ${last}`))) break;
    }
    opts.takenEmails.add(email);
    usedNames.add(`${first} ${last}`);
    return { id: opts.newId(), first, last, email, ...p };
  };
  const unique = (name: string, taken: Set<string>) => {
    let n = name;
    for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${name} ${i}`;
    taken.add(n.toLowerCase());
    return n;
  };
  let storyIx = 0;
  // Departments: the first templates not used yet, then numbered copies.
  const templates = [...DEPARTMENTS.filter(d => !opts.takenDepts.has(d.name.toLowerCase())), ...DEPARTMENTS];
  for (let di = 0; di < size.departments; di++) {
    const t = templates[di % templates.length];
    const dept: PlannedDept = { id: opts.newId(), name: unique(t.name, opts.takenDepts), description: t.description, head: t.head, tz: t.tz };
    plan.departments.push(dept);
    plan.people.push(person({ title: dept.head, kind: 'manager', role: 'qa_manager', departmentId: dept.id, teamId: null, joinedDaysAgo: 385 + randomInt(0, 16), insights: false, tz: t.tz }));
    // Teams: the department's own team names not used in the company yet, then any other unused one.
    const pool = [...t.teams, ...DEPARTMENTS.flatMap(d => d.teams)].filter(([n]) => !opts.takenTeams.has(n.toLowerCase()));
    for (let ti = 0; ti < size.teamsPerDepartment; ti++) {
      const [name, platform, description] = pool[ti] ?? t.teams[ti % t.teams.length];
      const story = STORY_ORDER[storyIx++ % STORY_ORDER.length];
      const team: PlannedTeam = { id: teamIdFor(story), name: unique(name, opts.takenTeams), platform, description, departmentId: dept.id, story };
      plan.teams.push(team);
      const base = { departmentId: dept.id, teamId: team.id, tz: t.tz };
      plan.people.push(person({ ...base, title: 'Product Owner', kind: 'product_owner', role: 'viewer', joinedDaysAgo: 360 + randomInt(0, 16), insights: false }));
      plan.people.push(person({ ...base, title: 'Scrum Master', kind: 'scrum_master', role: 'team_lead', joinedDaysAgo: 355 + randomInt(0, 16), insights: true }));
      const titles = DEV_TITLES[platform] ?? DEV_TITLES['Backend API'];
      const devs = size.membersPerTeam - 2;
      for (let i = 0; i < devs; i++) {
        const title = titles[i % titles.length];
        // Developers joined over the year (the first ones when the team started). A UX designer does not
        // share developer insights when at least three others of the team do (k-anonymity needs 3).
        const joined = i < 2 ? 340 + randomInt(0, 15) : 25 + randomInt(0, 320);
        const insights = !(title === 'UX Designer' && devs >= 3);
        plan.people.push(person({ ...base, title, kind: 'engineer', role: 'qa_engineer', joinedDaysAgo: joined, insights }));
      }
    }
  }
  return plan;
}

/** One sign-in per role level (shown once with the password). */
export function sampleLogins(plan: OrgPlan): Array<{ role: string; label: string; name: string; email: string; title: string }> {
  const pick = (kind: PersonKind) => plan.people.find(p => p.kind === kind);
  const out: Array<{ role: string; label: string; name: string; email: string; title: string }> = [];
  for (const [kind, label] of [['manager', 'Manager'], ['scrum_master', 'Team lead'], ['engineer', 'Software engineer'], ['product_owner', 'Viewer']] as Array<[PersonKind, string]>) {
    const p = pick(kind);
    if (p) out.push({ role: p.role, label, name: `${p.first} ${p.last}`, email: p.email, title: p.title });
  }
  return out;
}

/**
 * A strong generated password (shown once; only its bcrypt hash is stored): two words for
 * readability plus 12 random characters from an unambiguous alphabet (about 80 bits of entropy).
 */
export function generateDemoPassword(): string {
  const words = ['Harbor', 'Falcon', 'Copper', 'Meadow', 'Summit', 'Lantern', 'Orchid', 'Granite', 'Willow', 'Comet', 'Cedar', 'Beacon', 'Glacier', 'Juniper', 'Marble', 'Nimbus'];
  const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const sym = '!#$%&*+?';
  const w = () => words[randomInt(0, words.length)];
  const r = (n: number) => Array.from({ length: n }, () => alpha[randomInt(0, alpha.length)]).join('');
  return `${w()}-${w()}-${r(6)}${randomInt(2, 10)}${sym[randomInt(0, sym.length)]}${r(6)}`;
}

// ============================================================================
// Scrum content layer (after the sample history): SQL statements, all rows sample (ids 'demo-')
// ============================================================================

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: string[]) => `ARRAY[${xs.map(q).join(', ')}]::text[]`;
const short = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 20);

/** The four KPIs with a company target, as rows of a VALUES list (metric, label, lower is better, good, watch). */
const TARGETS_SQL = `(VALUES ('test_coverage', 'Test coverage', FALSE, 80, 70), ('defect_escape_rate', 'Defect escape rate', TRUE, 5, 10),
                           ('test_flakiness_rate', 'Test flakiness', TRUE, 2, 5), ('change_failure_rate', 'Change failure rate', TRUE, 5, 15))
                    AS m(metric, label, lower, good, warn)`;
const KPI_VALUE_SQL = `CASE m.metric WHEN 'test_coverage' THEN k.test_coverage WHEN 'defect_escape_rate' THEN k.defect_escape_rate
                            WHEN 'test_flakiness_rate' THEN k.test_flakiness_rate ELSE k.change_failure_rate END`;

/**
 * Retro actions of every sprint of the year, alert history, an API key with its CI ingestion log,
 * the completed onboarding checklist, a raised coverage target (only where the company target is
 * still the default) and sprint wording on the recent sample actions. Only the given teams.
 */
export function showcaseContentSql(companyId: string, teamIds: string[]): string[] {
  if (!teamIds.length) return [];
  const C = q(companyId);
  const T = arr(teamIds);
  const key = `demo-key-${short(companyId)}`;
  return [
    // The recent sample actions read like retrospective actions of the sprint they were agreed in.
    `UPDATE team_actions a SET title = left('Sprint ' || substr(sv.sprint_name, 8) || ' retro: ' || a.title, 200)
       FROM sprint_velocity sv
      WHERE a.company_id = ${C} AND a.team_id = ANY(${T}) AND a.id LIKE 'demo-%' AND a.title NOT LIKE 'Sprint % retro:%'
        AND sv.team_id = a.team_id AND sv.sprint_name LIKE 'Sprint %' AND a.created_at::date BETWEEN sv.start_date AND sv.end_date + 13
        AND sv.end_date = (SELECT max(end_date) FROM sprint_velocity s2 WHERE s2.team_id = a.team_id AND s2.end_date <= a.created_at::date);`,

    // Retro actions of every earlier sprint: one per team, agreed at the retro (sprint end), due at the end
    // of the next sprint and done, about the team's weakest KPI on that day.
    `WITH s AS (
       SELECT sv.team_id, sv.sprint_name, sv.end_date AS retro_day,
              row_number() OVER (PARTITION BY sv.team_id ORDER BY sv.end_date DESC) AS back
         FROM sprint_velocity sv WHERE sv.team_id = ANY(${T}) AND sv.sprint_name LIKE 'Sprint %'
     ), pick AS (
       SELECT s.*, k.test_coverage, k.defect_escape_rate, k.test_flakiness_rate, k.change_failure_rate,
              (SELECT u.id FROM users u WHERE u.primary_team_id = s.team_id AND u.is_active AND u.role IN ('qa_engineer', 'team_lead')
                 AND u.created_at::date <= s.retro_day ORDER BY md5(u.id || s.sprint_name) LIMIT 1) AS owner_id,
              substr(s.sprint_name, 8)::int AS n
         FROM s JOIN kpi_snapshots k ON k.team_id = s.team_id AND k.snapshot_date = s.retro_day
        WHERE s.back > 3 AND s.retro_day >= current_date - 365
     ), w AS (
       SELECT *, CASE WHEN test_flakiness_rate > 4 THEN 'test_flakiness_rate' WHEN defect_escape_rate > 9 THEN 'defect_escape_rate'
                      WHEN test_coverage < 78 THEN 'test_coverage' WHEN change_failure_rate > 10 THEN 'change_failure_rate'
                      ELSE (ARRAY['test_coverage', 'test_flakiness_rate', 'change_failure_rate'])[1 + (n % 3)] END AS metric
         FROM pick
     )
     INSERT INTO team_actions (id, company_id, team_id, title, description, origin, alert_id, owner_id, due_date, status, metric_key,
                               baseline_value, baseline_at, created_by, created_at, updated_at, completed_at)
     SELECT 'demo-retro-' || substr(md5(team_id || sprint_name), 1, 25), ${C}, team_id,
            sprint_name || ' retro: ' || CASE metric
              WHEN 'test_flakiness_rate' THEN (ARRAY['Quarantine the flakiest tests and fix the top three', 'Replace sleeps in UI tests with explicit waits', 'Stabilise the shared test environment data'])[1 + n % 3]
              WHEN 'defect_escape_rate' THEN (ARRAY['Post-mortem the escaped defects and add regression tests', 'Add contract tests for the partner APIs', 'Pair on acceptance criteria before development'])[1 + n % 3]
              WHEN 'test_coverage' THEN (ARRAY['Cover the least-tested critical module', 'Add tests with every bug fix (definition of done)', 'Raise coverage on new code to 85 %'])[1 + n % 3]
              ELSE (ARRAY['Smaller releases behind feature flags', 'Add a canary step before full rollout', 'Run the release checklist at the sprint review'])[1 + n % 3] END,
            'Agreed at the ' || sprint_name || ' retrospective.', 'manual', NULL, owner_id, retro_day + 14, 'done', metric,
            CASE metric WHEN 'test_flakiness_rate' THEN test_flakiness_rate WHEN 'defect_escape_rate' THEN defect_escape_rate
                        WHEN 'test_coverage' THEN test_coverage ELSE change_failure_rate END,
            retro_day::timestamptz, NULL, retro_day + interval '15 hours', retro_day + interval '12 days 16 hours', retro_day + interval '12 days 16 hours'
       FROM w
     ON CONFLICT DO NOTHING;`,

    // Alert history: every stretch of three days or more off target (coverage < 70 %, defect escape > 10 %,
    // flakiness > 5 %, change failure rate > 15 %) gave one alert, resolved the day the value was back.
    `WITH v AS (
       SELECT k.team_id, k.snapshot_date, m.metric, m.label, m.lower, m.good, m.warn, ${KPI_VALUE_SQL} AS value
         FROM kpi_snapshots k CROSS JOIN ${TARGETS_SQL}
        WHERE k.team_id = ANY(${T})
     ), g AS (
       SELECT *, snapshot_date - (row_number() OVER (PARTITION BY team_id, metric ORDER BY snapshot_date))::int AS grp
         FROM v WHERE value IS NOT NULL AND CASE WHEN lower THEN value > warn ELSE value < warn END
     ), islands AS (
       SELECT team_id, metric, label, lower, good, warn, min(snapshot_date) AS first_day, max(snapshot_date) AS last_day,
              count(*) AS days, (array_agg(value ORDER BY snapshot_date))[1] AS first_value
         FROM g GROUP BY team_id, metric, label, lower, good, warn, grp
     )
     INSERT INTO alerts (id, company_id, team_id, rule, metric_key, severity, message, details, dedupe_key, created_at, last_seen_at, acknowledged_at, acknowledged_by, resolved_at)
     SELECT 'demo-alh-' || substr(md5(team_id || metric || first_day), 1, 26), ${C}, team_id, 'threshold_breach', metric, 'critical',
            label || ' is off target: ' || round(first_value, 2) || '% (target ' || CASE WHEN lower THEN '≤ ' ELSE '≥ ' END || good || '%, watch '
              || CASE WHEN lower THEN '≤ ' ELSE '≥ ' END || warn || '%)',
            jsonb_build_object('good', good, 'value', round(first_value, 2), 'warning', warn, 'recordedAt', to_char(first_day, 'YYYY-MM-DD"T"00:00:00.000"Z"'), 'targetScope', 'company', 'lowerIsBetter', lower),
            'threshold_breach|' || team_id || '|' || metric,
            first_day + interval '9 hours 10 minutes', last_day + interval '6 hours 15 minutes', first_day + interval '1 day 10 hours',
            (SELECT u.id FROM users u WHERE u.primary_team_id = islands.team_id AND u.role = 'team_lead' AND u.is_active LIMIT 1),
            last_day + interval '1 day 6 hours 15 minutes'
       FROM islands WHERE days >= 3 AND last_day < current_date - 2
     ON CONFLICT DO NOTHING;`,

    // A steady team that never stayed off target still has an alert history: one warning on the day a
    // KPI was furthest past its target (but within the watch line), acknowledged and resolved the next day.
    `WITH v AS (
       SELECT k.team_id, k.snapshot_date, m.metric, m.label, m.lower, m.good, m.warn, ${KPI_VALUE_SQL} AS value
         FROM kpi_snapshots k CROSS JOIN ${TARGETS_SQL}
        WHERE k.team_id = ANY(${T}) AND k.snapshot_date < current_date - 7
          AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.team_id = k.team_id)
     ), w AS (
       SELECT DISTINCT ON (team_id) * FROM v
        WHERE value IS NOT NULL AND CASE WHEN lower THEN value > good ELSE value < good END
        ORDER BY team_id, abs(value - good) / NULLIF(abs(warn - good), 0) DESC, snapshot_date DESC
     )
     INSERT INTO alerts (id, company_id, team_id, rule, metric_key, severity, message, details, dedupe_key, created_at, last_seen_at, acknowledged_at, acknowledged_by, resolved_at)
     SELECT 'demo-alw-' || substr(md5(team_id || metric || snapshot_date), 1, 26), ${C}, team_id, 'threshold_breach', metric, 'warning',
            label || ' is off target: ' || round(value, 2) || '% (target ' || CASE WHEN lower THEN '≤ ' ELSE '≥ ' END || good || '%, watch '
              || CASE WHEN lower THEN '≤ ' ELSE '≥ ' END || warn || '%)',
            jsonb_build_object('good', good, 'value', round(value, 2), 'warning', warn, 'recordedAt', to_char(snapshot_date, 'YYYY-MM-DD"T"00:00:00.000"Z"'), 'targetScope', 'company', 'lowerIsBetter', lower),
            'threshold_breach|' || team_id || '|' || metric,
            snapshot_date + interval '9 hours 10 minutes', snapshot_date + interval '18 hours', snapshot_date + interval '10 hours 30 minutes',
            (SELECT u.id FROM users u WHERE u.primary_team_id = w.team_id AND u.role = 'team_lead' AND u.is_active LIMIT 1),
            snapshot_date + interval '1 day 6 hours 15 minutes'
       FROM w
     ON CONFLICT DO NOTHING;`,

    // Data arrives from CI: an API key (nobody holds its secret: it only shows what the panel looks like)
    // and its ingestion log, every working day per team since the team started (a few partial pushes).
    `INSERT INTO api_keys (id, company_id, name, key_prefix, key_hash, created_by, created_at, last_used_at, revoked_at)
     VALUES (${q(key)}, ${C}, 'GitHub Actions (CI)', 'igk_' || substr(md5(${q(key)}), 1, 8), encode(sha256(convert_to(${q(key)} || gen_random_uuid()::text, 'UTF8')), 'hex'),
             NULL, now() - interval '370 days', now() - interval '3 hours', NULL)
     ON CONFLICT DO NOTHING;`,
    `INSERT INTO ingestion_log (id, company_id, api_key_id, actor_id, channel, source, received_at, status, items, errors, http_status, response, team_ids, department_ids, item_count, value_count)
     SELECT 'demo-ci-' || substr(md5(t.id || d::date), 1, 28), ${C}, ${q(key)}, NULL, 'api', 'github-actions',
            d + interval '3 hours' + (row_number() OVER (PARTITION BY d ORDER BY t.id)) * interval '7 minutes',
            CASE WHEN extract(day FROM d)::int % 17 = 0 THEN 'partial' ELSE 'accepted' END,
            jsonb_build_array(jsonb_build_object('index', 0, 'source', 'github-actions', 'status', 'written', 'teamId', t.id,
              'metrics', jsonb_build_array('test_coverage', 'test_flakiness_rate', 'avg_build_time_minutes', 'test_execution_time_minutes'),
              'recordedAt', to_char(d + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'), 'snapshotDate', to_char(d, 'YYYY-MM-DD')))
              || CASE WHEN extract(day FROM d)::int % 17 = 0 THEN jsonb_build_array(jsonb_build_object('index', 1, 'source', 'github-actions', 'status', 'error', 'teamId', t.id, 'errors', jsonb_build_array('Unknown metric "mutation_score"'))) ELSE '[]'::jsonb END,
            CASE WHEN extract(day FROM d)::int % 17 = 0 THEN '[{"index": 1, "error": "Unknown metric \\"mutation_score\\""}]'::jsonb ELSE '[]'::jsonb END,
            CASE WHEN extract(day FROM d)::int % 17 = 0 THEN 207 ELSE 200 END, NULL,
            ARRAY[t.id]::varchar[], ARRAY[t.department_id]::varchar[], CASE WHEN extract(day FROM d)::int % 17 = 0 THEN 2 ELSE 1 END, 4
       FROM teams t
       CROSS JOIN LATERAL generate_series(GREATEST(current_date - 360, (SELECT min(snapshot_date) FROM kpi_snapshots k WHERE k.team_id = t.id)), current_date, interval '1 day') AS d
      WHERE t.id = ANY(${T}) AND t.company_id = ${C} AND extract(isodow FROM d) < 6
     ON CONFLICT DO NOTHING;`,

    // The onboarding checklist is complete.
    `INSERT INTO onboarding_state (company_id, completed_at, updated_at) VALUES (${C}, now() - interval '355 days', now())
     ON CONFLICT (company_id) DO UPDATE SET completed_at = COALESCE(onboarding_state.completed_at, EXCLUDED.completed_at);`,

    // Target history: the company coverage target was raised from 75 % to 80 % six months ago, where
    // the company's coverage target is still the default one (nobody set it).
    `UPDATE target_history SET good = 75, warning = 65, valid_to = date_trunc('day', now() - interval '183 days') + interval '9 hours'
      WHERE company_id = ${C} AND scope_type = 'company' AND scope_id = ${C} AND metric_key = 'test_coverage' AND valid_to IS NULL AND changed_by IS NULL
        AND valid_from < now() - interval '183 days' AND NOT EXISTS (SELECT 1 FROM target_history WHERE id = ${q(`demo-tgt-${short(companyId)}`)});`,
    `INSERT INTO target_history (id, company_id, scope_type, scope_id, metric_key, good, warning, valid_from, valid_to, changed_by, created_at)
     SELECT ${q(`demo-tgt-${short(companyId)}`)}, ${C}, 'company', ${C}, 'test_coverage', 80, 70, valid_to, NULL, NULL, valid_to
       FROM target_history WHERE company_id = ${C} AND scope_type = 'company' AND scope_id = ${C} AND metric_key = 'test_coverage'
        AND valid_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM target_history h2 WHERE h2.company_id = ${C} AND h2.scope_type = 'company' AND h2.metric_key = 'test_coverage' AND h2.valid_to IS NULL)
      ORDER BY valid_to DESC LIMIT 1
     ON CONFLICT DO NOTHING;`,
  ];
}
