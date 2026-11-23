/**
 * The field allow-list (fieldAllowList.ts) on the server's write paths for issues and incidents:
 * POST /api/ingest/issues, POST /api/ingest/incidents and file uploads (they call the same handlers).
 *
 *   applyIssueAllowList / applyIncidentAllowList  the parsed events keep only allowed values before
 *     they are stored: titles dropped when the company setting "Store issue and incident titles" is off,
 *     labels reduced to the ones the calculations read;
 *   minimisedIssuePayload / minimisedIncidentPayload  the copy kept in raw_uploads.payload is the
 *     minimised JSON of the parsed events (never the body as received, which may hold descriptions,
 *     comments and e-mail addresses);
 *   storeTitlesOf  the company setting (companies.store_issue_titles, migration 20261203000000;
 *     true when the column does not exist yet).
 */
import { query } from '../../../src/lib/db';
import { minimiseRecord, minimiseSprint, usefulLabel } from './allowListPolicy';
import type { IssueEvent, SprintRef } from './issueEvents';
import type { IncidentEvent } from './deliveryEvents';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function storeTitlesOf(companyId: string): Promise<boolean> {
  try {
    const r = await query<any[]>('SELECT store_issue_titles FROM companies WHERE id = ?', [companyId]);
    return r[0]?.store_issue_titles !== false;
  } catch {
    return true;
  }
}

/** The parsed issues keep only allowed values before they are stored (fieldAllowList.ts): only the labels the calculations read, titles per the setting. */
export function applyIssueAllowList(events: IssueEvent[], storeTitles: boolean): void {
  for (const e of events) {
    if (!storeTitles) e.title = null;
    e.labels = e.labels.filter(usefulLabel);
  }
}

export function applyIncidentAllowList(events: IncidentEvent[], storeTitles: boolean): void {
  for (const e of events) {
    if (!storeTitles) e.title = null;
  }
}

const sprintRecord = (s: SprintRef) => ({ id: s.id, name: s.name, state: s.state, startedAt: iso(s.startedAt), endsAt: iso(s.endsAt), completedAt: iso(s.completedAt) });

/** An issue event as a QE Navigator JSON record (the body shape of /api/ingest/issues, format json). */
export function issueRecord(e: IssueEvent): Record<string, unknown> {
  const people = (e.people ?? {}) as Record<string, string | null>;
  return {
    key: e.key, team: e.team, project: e.project, title: e.title, type: e.typeLabel ?? e.type, status: e.status, statusCategory: e.statusCategory,
    resolution: e.resolution, environment: e.environment, storyPoints: e.storyPoints, estimateHours: e.estimateHours, timeLoggedHours: e.timeLoggedHours,
    sprints: e.sprints.map(sprintRecord), labels: e.labels, components: e.components, priority: e.priority, createdAt: iso(e.createdAt), resolvedAt: iso(e.resolvedAt),
    updatedAt: iso(e.updatedAt), url: e.url,
    transitions: e.transitions.map((t) => ({ field: t.field, from: t.from, to: t.to, toCategory: t.toCategory, at: iso(t.at) })),
    ...people,
  };
}

/** An incident event as a QE Navigator JSON record (the body shape of /api/ingest/incidents, format json). */
export function incidentRecord(e: IncidentEvent): Record<string, unknown> {
  const people = (e.people ?? {}) as Record<string, string | null>;
  return {
    id: e.id, team: e.team, title: e.title, severity: e.severityLabel ?? e.severity, service: e.service, status: e.status,
    openedAt: iso(e.openedAt), acknowledgedAt: iso(e.acknowledgedAt), resolvedAt: iso(e.resolvedAt), at: iso(e.at), deploymentId: e.deployment,
    outage: e.outage, category: e.category, url: e.url, ...people,
  };
}

/** What raw_uploads keeps of an issues request: the minimised records, never the body as received. */
export function minimisedIssuePayload(companyId: string, issues: IssueEvent[], sprints: SprintRef[], storeTitles: boolean): Buffer {
  const out = issues.map((e) => minimiseRecord('issue', issueRecord(e), { storeTitles, salt: companyId }).record);
  return Buffer.from(JSON.stringify({ minimised: true, issues: out, sprints: sprints.map((s) => minimiseSprint(sprintRecord(s))).filter(Boolean) }));
}

export function minimisedIncidentPayload(companyId: string, incidents: IncidentEvent[], storeTitles: boolean): Buffer {
  return Buffer.from(JSON.stringify({ minimised: true, incidents: incidents.map((e) => minimiseRecord('incident', incidentRecord(e), { storeTitles, salt: companyId }).record) }));
}
