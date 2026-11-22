/**
 * CSV exports people can get without API access, mapped to the QE Navigator JSON shapes of the
 * ingestion API (so the same parsers, stores and calculations apply):
 *
 *   jira-csv         Jira "Export → CSV (all fields)" or "CSV (current fields)"      → issues
 *   linear-csv       Linear "Export → CSV"                                             → issues (+ cycles)
 *   pagerduty-csv    PagerDuty Incidents "Download CSV" or Analytics incident export  → incidents
 *   opsgenie-csv     Opsgenie alerts or incidents CSV export                           → incidents
 *   deployments-csv  QE Navigator deployments template (docs/INTEGRATION_GUIDE.md)    → deployments
 *   sprints-csv      QE Navigator sprints template (sprint dates for a Jira CSV)       → sprints
 *
 * Column names differ by tool version, configuration and language: every target field has a list of
 * header names (English, German, French, Spanish, Italian, Dutch, Portuguese) compared without case,
 * accents, spaces or punctuation (normHeader), and a pattern for custom-field variants. The detected
 * mapping is shown in the upload preview and can be changed there (CsvMapping).
 *
 * What a CSV cannot carry: a Jira CSV has no status-change history (only the time of the last status
 * category change) and no sprint dates; see limitsOf() and docs/INTEGRATION_GUIDE.md.
 */
import { detectDateOrder, normHeader, parseDate, parseDurationHours, parseNumber, type Csv, type DateOrder } from './csv';
import { transitionCategory } from './issueEvents';

export const CSV_FORMATS = ['jira-csv', 'linear-csv', 'pagerduty-csv', 'opsgenie-csv', 'deployments-csv', 'sprints-csv'] as const;
export type CsvFormat = (typeof CSV_FORMATS)[number];
export type CsvKind = 'issues' | 'incidents' | 'deployments' | 'sprints';

export type FieldType = 'text' | 'date' | 'number' | 'duration' | 'list' | 'person' | 'bool';

export interface CsvTarget {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Every column with the chosen header is read (Jira repeats Sprint, Labels, Component/s). */
  multi?: boolean;
  /** Normalised header names (normHeader). */
  names: string[];
  /** Fallback pattern on the normalised header. */
  pattern?: RegExp;
}

export interface CsvSpec {
  format: CsvFormat;
  kind: CsvKind;
  label: string;
  targets: CsvTarget[];
}

const T = (key: string, label: string, type: FieldType, names: string[], extra: Partial<CsvTarget> = {}): CsvTarget => ({ key, label, type, names, ...extra });

export const CSV_SPECS: Record<CsvFormat, CsvSpec> = {
  'jira-csv': {
    format: 'jira-csv', kind: 'issues', label: 'Jira issues (CSV export)',
    targets: [
      T('key', 'Issue key', 'text', ['issuekey', 'key', 'vorgangsschlussel', 'schlussel', 'cledeticket', 'cledelademande', 'cledutickets', 'cle', 'clavedeincidencia', 'clave', 'chiavedelticket', 'chiave', 'sleutel', 'chavedoitem', 'chave', 'klucz'], { required: true }),
      T('title', 'Summary', 'text', ['summary', 'zusammenfassung', 'resume', 'resumen', 'riepilogo', 'sommario', 'samenvatting', 'resumo', 'podsumowanie']),
      T('type', 'Issue type', 'text', ['issuetype', 'vorgangstyp', 'typedeticket', 'typedelademande', 'typedeticket', 'tipodeincidencia', 'tipodeticket', 'tipodiproblema', 'tipoditicket', 'issuetype', 'issuettype', 'tipo', 'typ', 'type'], { required: true }),
      T('status', 'Status', 'text', ['status', 'etat', 'statut', 'estado', 'stato', 'situacao'], { required: true }),
      T('statusCategory', 'Status category', 'text', ['statuscategory', 'statuskategorie', 'categoriedetat', 'categoriedestatut', 'categoriadeestado', 'categoriadistato', 'statuscategorie']),
      T('statusCategoryChanged', 'Status category changed', 'date', ['statuscategorychanged', 'statuskategoriegeandert', 'categoriedetatmodifiee', 'categoriadeestadocambiada', 'categoriadistatomodificata']),
      T('resolution', 'Resolution', 'text', ['resolution', 'losung', 'resolucion', 'risoluzione', 'oplossing', 'resolucao']),
      T('project', 'Project key', 'text', ['projectkey', 'projektschlussel', 'cledeprojet', 'cleduprojet', 'clavedeproyecto', 'clavedelproyecto', 'chiavedelprogetto', 'chiaveprogetto', 'projectsleutel', 'chavedoprojeto']),
      T('created', 'Created', 'date', ['created', 'erstellt', 'creation', 'cree', 'creee', 'creado', 'creada', 'fechadecreacion', 'creato', 'aangemaakt', 'criado', 'utworzone'], { required: true }),
      T('updated', 'Updated', 'date', ['updated', 'aktualisiert', 'miseajour', 'misajour', 'actualizado', 'actualizada', 'aggiornato', 'bijgewerkt', 'atualizado']),
      T('resolved', 'Resolved', 'date', ['resolved', 'erledigt', 'resolu', 'resolue', 'resuelto', 'resuelta', 'risolto', 'opgelost', 'resolvido']),
      T('storyPoints', 'Story points', 'number', ['storypoints', 'storypointestimate', 'customfieldstorypoints', 'customfieldstorypointestimate', 'storypunkte'], { pattern: /story ?points?|storypunkte|pointsdhistoire|puntosdehistoria|puntidistoria/ }),
      T('sprint', 'Sprint', 'list', ['sprint', 'sprints', 'customfieldsprint'], { multi: true }),
      T('labels', 'Labels', 'list', ['labels', 'label', 'stichworter', 'etiquettes', 'etiquetas', 'etichette', 'rotulos'], { multi: true }),
      T('components', 'Components', 'list', ['components', 'component', 'componentes', 'komponenten', 'composants', 'componenti', 'componenten'], { multi: true }),
      T('environment', 'Environment / found in', 'text', ['environment', 'umgebung', 'environnement', 'entorno', 'ambiente', 'omgeving', 'foundin', 'customfieldfoundin', 'customfieldenvironmentfound', 'detectedin'], { pattern: /foundin|environmentfound|detectedin/ }),
      T('estimate', 'Original estimate', 'duration', ['originalestimate', 'ursprunglicheschatzung', 'estimationoriginale', 'estimacionoriginal', 'stimaoriginale', 'oorspronkelijkeschatting', 'estimativaoriginal']),
      T('timeSpent', 'Time spent', 'duration', ['timespent', 'benotigtezeit', 'zeitaufwand', 'tempspasse', 'tiempoempleado', 'tempoimpiegato', 'bestedetijd', 'tempogasto']),
      T('assignee', 'Assignee', 'person', ['assignee', 'bearbeiter', 'zugewiesenean', 'responsable', 'personneassignee', 'asignado', 'personaasignada', 'assegnatario', 'toegewezenaan', 'responsavel']),
      T('reporter', 'Reporter', 'person', ['reporter', 'autor', 'rapporteur', 'informador', 'informante', 'segnalatore', 'melder', 'relator']),
    ],
  },
  'linear-csv': {
    format: 'linear-csv', kind: 'issues', label: 'Linear issues (CSV export)',
    targets: [
      T('key', 'ID', 'text', ['id', 'identifier', 'issueid', 'key'], { required: true }),
      T('title', 'Title', 'text', ['title']),
      T('team', 'Team', 'text', ['team', 'teamkey']),
      T('status', 'Status', 'text', ['status', 'state', 'workflowstate'], { required: true }),
      T('estimate', 'Estimate (points)', 'number', ['estimate', 'points', 'storypoints']),
      T('labels', 'Labels', 'list', ['labels', 'label']),
      T('project', 'Project', 'text', ['project', 'projectname']),
      T('parent', 'Parent issue', 'text', ['parentissue', 'parent', 'parentid']),
      T('cycleNumber', 'Cycle number', 'text', ['cyclenumber', 'cycle']),
      T('cycleName', 'Cycle name', 'text', ['cyclename']),
      T('cycleStart', 'Cycle start', 'date', ['cyclestart', 'cyclestartsat', 'cyclestartdate']),
      T('cycleEnd', 'Cycle end', 'date', ['cycleend', 'cycleendsat', 'cycleenddate']),
      T('created', 'Created', 'date', ['created', 'createdat'], { required: true }),
      T('updated', 'Updated', 'date', ['updated', 'updatedat']),
      T('started', 'Started', 'date', ['started', 'startedat']),
      T('completed', 'Completed', 'date', ['completed', 'completedat']),
      T('canceled', 'Canceled', 'date', ['canceled', 'cancelled', 'canceledat', 'cancelledat']),
      T('assignee', 'Assignee', 'person', ['assignee']),
      T('reporter', 'Creator', 'person', ['creator', 'createdby', 'reporter']),
    ],
  },
  'pagerduty-csv': {
    format: 'pagerduty-csv', kind: 'incidents', label: 'PagerDuty incidents (CSV export)',
    targets: [
      T('id', 'Incident id', 'text', ['id', 'incidentid', 'incidentkey'], { required: true }),
      T('number', 'Incident number', 'text', ['incidentnumber', 'number', 'incidentno']),
      T('title', 'Title / description', 'text', ['title', 'description', 'summary', 'incidenttitle']),
      T('status', 'Status', 'text', ['status', 'state', 'currentstatus']),
      T('urgency', 'Urgency', 'text', ['urgency']),
      T('priority', 'Priority', 'text', ['priority', 'priorityname', 'prioritysummary']),
      T('service', 'Service', 'text', ['servicename', 'service', 'servicesummary']),
      T('created', 'Created', 'date', ['createdon', 'createdat', 'created', 'triggeredat', 'openedat', 'startedat'], { required: true }),
      T('acknowledged', 'Acknowledged', 'date', ['acknowledgedon', 'acknowledgedat', 'firstacknowledgedat', 'firstackat', 'ackedat']),
      T('resolved', 'Resolved', 'date', ['resolvedon', 'resolvedat', 'resolved', 'closedat']),
      T('secondsToAck', 'Seconds to first ack', 'number', ['secondstofirstack', 'timetofirstack', 'secondstoack', 'ttaseconds']),
      T('secondsToResolve', 'Seconds to resolve', 'number', ['secondstoresolve', 'timetoresolve', 'ttrseconds']),
      T('responder', 'Responder', 'person', ['resolvedbyusername', 'resolvedby', 'assignedto', 'assignee', 'acknowledgedbyusernames', 'acknowledgedby']),
    ],
  },
  'opsgenie-csv': {
    format: 'opsgenie-csv', kind: 'incidents', label: 'Opsgenie alerts or incidents (CSV export)',
    targets: [
      T('id', 'Alert / incident id', 'text', ['tinyid', 'alertid', 'incidentid', 'id', 'alias'], { required: true }),
      T('title', 'Message', 'text', ['message', 'title', 'summary']),
      T('status', 'Status', 'text', ['status', 'state']),
      T('acknowledgedFlag', 'Acknowledged (true / false)', 'bool', ['acknowledged', 'isacknowledged', 'acked']),
      T('priority', 'Priority', 'text', ['priority']),
      T('service', 'Service', 'text', ['impactedservices', 'service', 'services', 'entity']),
      T('tags', 'Tags', 'list', ['tags']),
      T('created', 'Created at', 'date', ['createdat', 'created', 'createdon', 'openedat'], { required: true }),
      T('updated', 'Updated at', 'date', ['updatedat', 'updated', 'lastoccurredat']),
      T('acknowledged', 'Acknowledged at', 'date', ['acknowledgedat', 'ackedat', 'firstacknowledgedat']),
      T('resolved', 'Closed / resolved at', 'date', ['closedat', 'resolvedat', 'closed', 'resolved']),
      T('ackTime', 'Time to acknowledge (ms)', 'number', ['acktime', 'timetoack', 'acktimems']),
      T('closeTime', 'Time to close (ms)', 'number', ['closetime', 'timetoclose', 'closetimems']),
      T('responder', 'Owner / responder', 'person', ['owner', 'responders', 'acknowledgedby', 'closedby']),
    ],
  },
  'deployments-csv': {
    format: 'deployments-csv', kind: 'deployments', label: 'Deployments (QE Navigator CSV template)',
    targets: [
      T('id', 'Deployment id', 'text', ['id', 'deploymentid', 'deployid', 'releaseid'], { required: true }),
      T('team', 'Team id', 'text', ['team', 'teamid']),
      T('service', 'Service', 'text', ['service', 'application', 'app', 'component']),
      T('environment', 'Environment', 'text', ['environment', 'env', 'stage', 'target'], { required: true }),
      T('commit', 'Commit sha', 'text', ['commit', 'commitsha', 'sha', 'revision']),
      T('commitAuthoredAt', 'First commit time', 'date', ['commitauthoredat', 'firstcommitat', 'committedat', 'commitdate', 'commitat']),
      T('started', 'Started at', 'date', ['startedat', 'started', 'start']),
      T('finished', 'Finished at', 'date', ['finishedat', 'finished', 'deployedat', 'end', 'endedat', 'completedat'], { required: true }),
      T('result', 'Result', 'text', ['result', 'status', 'outcome', 'conclusion'], { required: true }),
      T('rollbackOf', 'Rollback of (deployment id)', 'text', ['rollbackof', 'rollbackofdeploymentid', 'revertof']),
      T('hotfix', 'Hotfix (true / false)', 'bool', ['hotfix', 'ishotfix']),
      T('url', 'URL', 'text', ['url', 'link']),
    ],
  },
  'sprints-csv': {
    format: 'sprints-csv', kind: 'sprints', label: 'Sprints (QE Navigator CSV template)',
    targets: [
      T('sprint', 'Sprint name', 'text', ['sprint', 'sprintname', 'name', 'cycle', 'iteration'], { required: true }),
      T('started', 'Start date', 'date', ['startdate', 'start', 'startedat', 'started', 'begin'], { required: true }),
      T('ends', 'End date', 'date', ['enddate', 'end', 'endsat', 'plannedend']),
      T('completed', 'Completed / closed date', 'date', ['completeddate', 'completedat', 'completed', 'closedat', 'closed', 'completedate']),
      T('state', 'State', 'text', ['state', 'status']),
    ],
  },
};

/** Target key → the chosen header (exact text of the CSV header), or null for "not in this file". */
export type CsvMapping = Record<string, string | null>;

/** The detected mapping: for each target the first header matching its names, else its pattern. */
export function autoMapping(spec: CsvSpec, headers: string[]): CsvMapping {
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const out: CsvMapping = {};
  for (const t of spec.targets) {
    let idx = -1;
    for (const n of t.names) { idx = norm.findIndex((h, i) => h === n && (!used.has(i) || t.multi)); if (idx >= 0) break; }
    if (idx < 0 && t.pattern) idx = norm.findIndex((h, i) => !used.has(i) && t.pattern!.test(h));
    if (idx >= 0) { out[t.key] = headers[idx]; if (!t.multi) used.add(idx); } else out[t.key] = null;
  }
  return out;
}

/** How well the headers fit a format (0 = not this format): required targets found, then the others. */
export function csvScore(format: CsvFormat, headers: string[]): number {
  const spec = CSV_SPECS[format];
  const m = autoMapping(spec, headers);
  const norm = new Set(headers.map(normHeader));
  const req = spec.targets.filter((t) => t.required);
  if (req.some((t) => !m[t.key])) return 0;
  let score = spec.targets.filter((t) => m[t.key]).length;
  // Signature columns that only this tool writes.
  const sig: Record<CsvFormat, string[]> = {
    'jira-csv': ['issuekey', 'issueid', 'issuetype', 'projectkey', 'statuscategory', 'summary', 'vorgangsschlussel', 'vorgangstyp', 'schlussel', 'zusammenfassung', 'cledeticket', 'typedeticket', 'resume', 'clavedeincidencia', 'tipodeincidencia', 'resumen', 'chiave', 'riepilogo'],
    'linear-csv': ['cyclenumber', 'cyclename', 'triage', 'parentissue', 'projectmilestone', 'slastatus'],
    'pagerduty-csv': ['incidentnumber', 'urgency', 'escalationpolicy', 'escalationpolicyname', 'secondstoresolve', 'servicename'],
    'opsgenie-csv': ['tinyid', 'alias', 'isseen', 'snoozed', 'acktime', 'closetime', 'impactedservices'],
    'deployments-csv': ['deploymentid', 'finishedat', 'rollbackof', 'commitauthoredat'],
    'sprints-csv': ['sprint', 'sprintname', 'startdate', 'enddate', 'completeddate'],
  };
  const hits = sig[format].filter((s) => norm.has(s)).length;
  if (format === 'linear-csv' && hits === 0 && !norm.has('team')) return 0;
  if (format === 'pagerduty-csv' && hits === 0) return 0;
  if (format === 'opsgenie-csv' && hits === 0) return 0;
  if (format === 'jira-csv' && hits === 0) return 0;
  return score + hits * 3;
}

/** The format of a CSV by its header row; null when none fits. */
export function detectCsvFormat(headers: string[]): { format: CsvFormat; score: number; alternatives: CsvFormat[] } | null {
  const scored = CSV_FORMATS.map((f) => ({ f, s: csvScore(f, headers) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  return { format: scored[0].f, score: scored[0].s, alternatives: scored.slice(1).map((x) => x.f) };
}

export interface CsvOptions {
  mapping?: CsvMapping | null;
  dateOrder?: DateOrder | 'auto' | null;
  /** Minutes east of UTC for times without a zone (default 0 = UTC). */
  utcOffsetMinutes?: number | null;
  /** Override the "now" used to complete Linear cycles (tests). */
  now?: number;
}

export interface CsvRowError { row: number; reason: string }

export interface CsvConversion {
  format: CsvFormat;
  kind: CsvKind;
  mapping: CsvMapping;
  dateOrder: DateOrder;
  dateOrderAmbiguous: boolean;
  /** Records in the QE Navigator JSON shape (before minimisation; people still raw). */
  records: Array<Record<string, unknown>>;
  /** The row number (1 = header) of each record. */
  rows: number[];
  errors: CsvRowError[];
  /** Headers not mapped to any target: never read, never stored. */
  unusedColumns: string[];
  /** Mapped headers that do not exist in the file (a mapping sent by the preview). */
  missingColumns: string[];
}

const SAFE_ID = (s: string) => s.trim().replace(/[^A-Za-z0-9_.:#/-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/-+$/, '').slice(0, 200);
/** The id of a sprint known only by its name (Jira CSV): "name:<name>", the same for the sprints template. */
export const sprintIdOf = (name: string) => SAFE_ID(`name:${name}`);

const JIRA_CATEGORY: Array<[RegExp, string]> = [
  [/^(done|erledigt|fertig|termine|terminee|termine|hecho|listo|finalizado|completato|fatto|gereed|klaar|concluido|feito)$/i, 'done'],
  [/^(in progress|in arbeit|en cours|en curso|en progreso|in corso|in uitvoering|em andamento|em progresso)$/i, 'in_progress'],
  [/^(to do|todo|zu erledigen|offen|a faire|à faire|por hacer|pendiente|da fare|te doen|a fazer|new|open|backlog)$/i, 'todo'],
];
const categoryHint = (v: string | null) => {
  if (!v) return null;
  const s = v.trim();
  for (const [re, c] of JIRA_CATEGORY) if (re.test(s)) return c;
  return null;
};

const truthy = (v: string | null) => (v === null ? null : /^(true|yes|y|1|ja|oui|si|sí|x)$/i.test(v.trim()) ? true : /^(false|no|n|0|nein|non)$/i.test(v.trim()) ? false : null);

/** Convert the rows of a CSV of a known format into JSON records (one per row; invalid rows reported). */
export function convertCsv(csv: Csv, format: CsvFormat, opts: CsvOptions = {}): CsvConversion {
  const spec = CSV_SPECS[format];
  const auto = autoMapping(spec, csv.headers);
  const mapping: CsvMapping = { ...auto };
  const missingColumns: string[] = [];
  if (opts.mapping) {
    for (const t of spec.targets) {
      if (!(t.key in opts.mapping)) continue;
      const h = opts.mapping[t.key];
      if (h === null || h === '') mapping[t.key] = null;
      else if (typeof h === 'string' && csv.headers.includes(h)) mapping[t.key] = h;
      else if (typeof h === 'string') missingColumns.push(h);
    }
  }
  const cols = (key: string) => { const h = mapping[key]; return h ? csv.headers.map((x, i) => (x === h ? i : -1)).filter((i) => i >= 0) : []; };
  const colOf = new Map(spec.targets.map((t) => [t.key, cols(t.key)]));
  const mappedIdx = new Set(Array.from(colOf.values()).flat());
  const unusedColumns = Array.from(new Set(csv.headers.filter((_, i) => !mappedIdx.has(i)).filter(Boolean)));

  const dateTargets = spec.targets.filter((t) => t.type === 'date').flatMap((t) => colOf.get(t.key) ?? []);
  const sampleDates = csv.rows.slice(0, 2000).flatMap((r) => dateTargets.map((i) => r[i]));
  const detected = detectDateOrder(sampleDates);
  const dateOrder: DateOrder = opts.dateOrder && opts.dateOrder !== 'auto' ? opts.dateOrder : detected.order;
  const offset = Number.isFinite(opts.utcOffsetMinutes as number) ? Number(opts.utcOffsetMinutes) : 0;
  const now = opts.now ?? Date.now();

  const records: Array<Record<string, unknown>> = [];
  const rows: number[] = [];
  const errors: CsvRowError[] = [];
  const missingRequired = spec.targets.filter((t) => t.required && !mapping[t.key]);
  if (missingRequired.length) {
    return { format, kind: spec.kind, mapping, dateOrder, dateOrderAmbiguous: detected.ambiguous, records, rows, errors: [{ row: 1, reason: `Required column${missingRequired.length > 1 ? 's' : ''} not mapped: ${missingRequired.map((t) => t.label).join(', ')}` }], unusedColumns, missingColumns };
  }

  csv.rows.forEach((r, i) => {
    const rowNo = i + 2;
    const one = (key: string): string | null => {
      for (const c of colOf.get(key) ?? []) { const v = (r[c] ?? '').trim(); if (v) return v; }
      return null;
    };
    const many = (key: string, split = false): string[] => {
      const out: string[] = [];
      for (const c of colOf.get(key) ?? []) {
        const v = (r[c] ?? '').trim();
        if (!v) continue;
        if (split) out.push(...v.split(/\s*[,;|]\s*/).filter(Boolean)); else out.push(v);
      }
      return Array.from(new Set(out));
    };
    const date = (key: string): string | null => {
      const v = one(key);
      const d = parseDate(v, dateOrder, offset);
      if (d === undefined) throw new Error(`${spec.targets.find((t) => t.key === key)!.label} "${(v ?? '').slice(0, 40)}" is not a date`);
      return d ? d.toISOString() : null;
    };
    const number = (key: string): number | null => {
      const v = one(key);
      const n = parseNumber(v);
      if (n !== null && (Number.isNaN(n) || n < 0)) throw new Error(`${spec.targets.find((t) => t.key === key)!.label} "${(v ?? '').slice(0, 40)}" is not a number`);
      return n;
    };
    const hours = (key: string): number | null => {
      const v = one(key);
      const h = parseDurationHours(v, 'seconds');
      if (h === undefined) throw new Error(`${spec.targets.find((t) => t.key === key)!.label} "${(v ?? '').slice(0, 40)}" is not a duration`);
      return h;
    };
    try {
      if (r.every((c) => !c.trim())) return;
      let rec: Record<string, unknown>;
      if (format === 'jira-csv') rec = jiraRow(one, many, date, number, hours);
      else if (format === 'linear-csv') rec = linearRow(one, many, date, number, now);
      else if (format === 'pagerduty-csv') rec = pagerdutyRow(one, date, number);
      else if (format === 'opsgenie-csv') rec = opsgenieRow(one, many, date, number);
      else if (format === 'deployments-csv') rec = deploymentRow(one, date);
      else rec = sprintRow(one, date, now);
      records.push(rec);
      rows.push(rowNo);
    } catch (e) {
      errors.push({ row: rowNo, reason: (e as Error).message });
    }
  });
  return { format, kind: spec.kind, mapping, dateOrder, dateOrderAmbiguous: detected.ambiguous && !(opts.dateOrder && opts.dateOrder !== 'auto'), records, rows, errors, unusedColumns, missingColumns };
}

type One = (k: string) => string | null;
type Many = (k: string, split?: boolean) => string[];
type DateF = (k: string) => string | null;
type NumF = (k: string) => number | null;

const need = (v: string | null, what: string) => { if (!v) throw new Error(`${what} is empty`); return v; };

function jiraRow(one: One, many: Many, date: DateF, number: NumF, hours: (k: string) => number | null): Record<string, unknown> {
  const key = need(one('key'), 'Issue key');
  const status = need(one('status'), 'Status');
  const created = need(date('created'), 'Created');
  const resolvedAt = date('resolved');
  // The category: Jira's Status Category column; else a status name it knows (any language); else done when resolved.
  const hint = categoryHint(one('statusCategory')) ?? categoryHint(status) ?? (resolvedAt && one('resolution') ? 'done' : null);
  const changed = date('statusCategoryChanged');
  const sprints = many('sprint').map((name) => ({ id: sprintIdOf(name), name: name.slice(0, 255) }));
  const rec: Record<string, unknown> = {
    key, title: one('title'), type: need(one('type'), 'Issue type'), status, statusCategory: hint, resolution: one('resolution'),
    project: one('project') ?? (key.includes('-') ? key.split('-')[0] : null), createdAt: created, updatedAt: date('updated'), resolvedAt,
    storyPoints: number('storyPoints'), sprints, labels: many('labels', true), components: many('components'), environment: one('environment'),
    estimateHours: hours('estimate'), timeLoggedHours: hours('timeSpent'), assignee: one('assignee'), reporter: one('reporter'),
    // The only history a Jira CSV carries: the time of the last status category change.
    transitions: changed && changed >= created ? [{ field: 'status', to: status, toCategory: transitionCategory(status, hint), at: changed }] : [],
  };
  return rec;
}

function linearRow(one: One, many: Many, date: DateF, number: NumF, now: number): Record<string, unknown> {
  const key = need(one('key'), 'ID');
  const status = need(one('status'), 'Status');
  const created = need(date('created'), 'Created');
  const started = date('started');
  const completed = date('completed');
  const canceled = date('canceled');
  const labels = many('labels', true);
  const lower = labels.map((l) => l.toLowerCase());
  const type = lower.some((l) => /^(bug|defect|regression)$/.test(l) || /\bbug\b/.test(l)) ? 'Bug'
    : lower.some((l) => /^(feature|story|user story|improvement)$/.test(l)) ? 'Story' : one('parent') ? 'Sub-task' : 'Task';
  const cycleNo = one('cycleNumber');
  const cycleName = one('cycleName');
  const cs = date('cycleStart');
  const ce = date('cycleEnd');
  const sprints = cycleNo || cycleName
    ? [{ id: SAFE_ID(cycleNo ? `cycle-${cycleNo}` : `name:${cycleName}`), name: cycleName ?? `Cycle ${cycleNo}`, startedAt: cs, endsAt: ce, completedAt: ce && Date.parse(ce) <= now ? ce : null, state: ce && Date.parse(ce) <= now ? 'closed' : cs && Date.parse(cs) <= now ? 'active' : null }]
    : [];
  const transitions: Array<Record<string, unknown>> = [];
  if (started && started >= created) transitions.push({ field: 'status', to: 'Started', toCategory: 'in_progress', at: started });
  if (completed) transitions.push({ field: 'status', to: status, toCategory: 'done', at: completed });
  else if (canceled) transitions.push({ field: 'status', to: status, toCategory: 'done', at: canceled });
  const category = completed || canceled ? 'done' : started ? 'in_progress' : null;
  return {
    key, title: one('title'), type, status, statusCategory: category, resolution: canceled ? 'Canceled' : completed ? 'Done' : null,
    project: key.includes('-') ? key.split('-')[0] : one('team'), createdAt: created, updatedAt: date('updated'), resolvedAt: completed ?? canceled,
    storyPoints: number('estimate'), sprints, labels, components: one('project') ? [one('project')] : [],
    assignee: one('assignee'), reporter: one('reporter'), transitions,
  };
}

function severityOfPd(priority: string | null, urgency: string | null): string | null {
  if (priority) return priority;
  if (!urgency) return null;
  return /^high$/i.test(urgency) ? 'high' : /^low$/i.test(urgency) ? 'low' : urgency;
}

function pagerdutyRow(one: One, date: DateF, number: NumF): Record<string, unknown> {
  const id = need(one('id') ?? one('number'), 'Incident id');
  const created = need(date('created'), 'Created');
  const plus = (s: number | null) => (s === null ? null : new Date(Date.parse(created) + s * 1000).toISOString());
  const resolved = date('resolved') ?? plus(number('secondsToResolve'));
  const ack = date('acknowledged') ?? plus(number('secondsToAck'));
  const status = one('status') ?? (resolved ? 'resolved' : ack ? 'acknowledged' : 'triggered');
  return {
    id, title: one('title'), severity: severityOfPd(one('priority'), one('urgency')), service: one('service'), status,
    openedAt: created, acknowledgedAt: ack, resolvedAt: resolved, responder: one('responder'),
  };
}

function opsgenieRow(one: One, many: Many, date: DateF, number: NumF): Record<string, unknown> {
  const id = need(one('id'), 'Alert / incident id');
  const created = need(date('created'), 'Created at');
  const plus = (ms: number | null) => (ms === null || ms <= 0 ? null : new Date(Date.parse(created) + ms).toISOString());
  const statusRaw = (one('status') ?? '').toLowerCase();
  const closed = /^(closed|resolved)$/.test(statusRaw);
  const ackFlag = truthy(one('acknowledgedFlag'));
  const resolved = date('resolved') ?? plus(number('closeTime')) ?? (closed ? date('updated') : null);
  const ack = date('acknowledged') ?? plus(number('ackTime'));
  const tag = many('tags', true).find((t) => /^service[:=]/i.test(t));
  const service = (one('service') ?? (tag ? tag.split(/[:=]/)[1] : null))?.split(/\s*[,;]\s*/)[0] ?? null;
  return {
    id, title: one('title'), severity: one('priority'), service,
    status: closed ? 'resolved' : ackFlag || ack ? 'acknowledged' : 'open', openedAt: created, acknowledgedAt: ack, resolvedAt: closed || resolved ? resolved : null,
    responder: one('responder'),
  };
}

function deploymentRow(one: One, date: DateF): Record<string, unknown> {
  const id = need(one('id'), 'Deployment id');
  const commit = one('commit');
  const authored = date('commitAuthoredAt');
  const hotfix = truthy(one('hotfix'));
  return {
    id, team: one('team'), service: one('service'), environment: need(one('environment'), 'Environment'), commit,
    commits: commit && authored ? [{ sha: commit, authoredAt: authored }] : [], startedAt: date('started'), finishedAt: need(date('finished'), 'Finished at'),
    result: need(one('result'), 'Result'), rollbackOf: one('rollbackOf'), hotfix: hotfix ?? false, url: one('url'),
  };
}

function sprintRow(one: One, date: DateF, now: number): Record<string, unknown> {
  const name = need(one('sprint'), 'Sprint name');
  const started = need(date('started'), 'Start date');
  // A date without a time closes the sprint at the end of that day (issues resolved that day count).
  const endOfDay = (k: string) => { const v = date(k); return v && /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\s*$/.test(one(k) ?? '') ? new Date(Date.parse(v) + 86_399_000).toISOString() : v; };
  const ends = endOfDay('ends');
  const completed = endOfDay('completed');
  const st = (one('state') ?? '').toLowerCase();
  const state = completed || /^(closed|complete|completed|done)$/.test(st) ? 'closed' : /^(active|started|current)$/.test(st) ? 'active' : Date.parse(started) <= now ? 'active' : 'future';
  return { id: sprintIdOf(name), name: name.slice(0, 255), state, startedAt: started, endsAt: ends, completedAt: completed ?? (state === 'closed' ? ends : null) };
}

/** What a format cannot carry, said in the preview and the documentation. */
export function limitsOf(format: string): string[] {
  if (format === 'jira-csv') {
    return [
      'A Jira CSV export has no status-change history: blocked time cannot be calculated, and only the last status-category change is known.',
      'A Jira CSV names sprints but not their dates: velocity, commitment and carryover are calculated only when the sprint dates are known (add a sprints CSV, the QE Navigator template, or send the sprints through the API once).',
      'Commitment counts an issue as committed when it was created before the sprint started (Jira’s sprint changes are not in the CSV).',
      'Escape rate and density need an environment or found-in field (or labels such as production / staging) on the bugs.',
    ];
  }
  if (format === 'linear-csv') {
    return [
      'A Linear CSV export has no full history: only the started, completed and canceled times are known; blocked time cannot be calculated.',
      'Cycles take their start and end from the Cycle start / Cycle end columns; a cycle whose end has passed counts as closed.',
    ];
  }
  if (format === 'pagerduty-csv' || format === 'opsgenie-csv') {
    return ['A CSV export carries no link to the deployment that caused an incident: the change failure rate counts these incidents only when the deployments say so (rollbacks, hotfixes).'];
  }
  if (format === 'deployments-csv') return ['Lead time for changes needs the commit time (First commit time column); without it only deployment frequency and change failure rate are calculated.'];
  if (format === 'sprints-csv') return ['Sprints are matched to the issues of a Jira CSV by name.'];
  return [];
}
