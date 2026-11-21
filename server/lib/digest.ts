/**
 * Weekly digest for managers and leads (canReceiveDigest), covering the teams in their analytics
 * scope: QA score now vs 7 days earlier (stale inputs left out, as everywhere), alerts opened in
 * the week and still open, stale metrics, actions overdue / due in the next 7 days / completed
 * with their computed outcome.
 *
 * runWeeklyDigest() (Netlify Scheduled Function netlify/functions/weekly-digest.ts, and the local
 * cron in server/jobs/alertsCron.ts) first evaluates the alerts of every company, then queues one
 * email per recipient whose preferences have the weekly digest on (dedupe key digest:<user>:<ISO
 * week>, so a second run in the same week sends nothing) and, when the company turned it on, one
 * Slack summary. "Send test digest" (POST /api/notifications/digest/test) sends the caller's
 * digest to the caller right away.
 */
import { query } from '../../src/lib/db';
import { escapeHtml } from './mailer';
import { canReceiveDigest, canSeeAlert, loadCompanyActors, type CompanyActor } from './alertPolicy';
import { evaluateCompany, qaScoreOn, RULE_DEFS, SEVERITY_RANK, type Severity } from './alerts';
import { evaluateSnapshot, type EvalContext } from './kpiEvaluation';
import { loadIntervals } from './staleness';
import { loadTargetBook } from './targets';
import { canViewTeamAnalytics, type PolicyActor } from './userPolicy';
import { actionsForTeams, type ActionJson } from './actions';
import { appUrl, enqueueDelivery, getSettings, prefsFor, processDeliveries, sendNow } from './notifications';

export interface DigestTeam { id: string; name: string; qaNow: number | null; qaNowDay: string | null; qaBefore: number | null; qaBeforeDay: string | null; delta: number | null; inputsUsed: number; inputsTotal: number }
export interface DigestAlert { id: string; teamName: string | null; rule: string; ruleLabel: string; severity: Severity; message: string; createdAt: string; open: boolean; acknowledged: boolean }
export interface Digest {
  recipient: { id: string; name: string; email: string };
  periodStart: string;
  periodEnd: string;
  teams: DigestTeam[];
  alerts: { opened: DigestAlert[]; openCount: Record<Severity, number> };
  stale: Array<{ teamName: string; metrics: string[] }>;
  actions: { overdue: ActionJson[]; dueSoon: ActionJson[]; completed: ActionJson[] };
  empty: boolean;
}

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** ISO week key, e.g. 2026-W47. */
export function isoWeek(t = Date.now()): string {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Build the digest of one recipient (their analytics scope) for the 7 days up to `now`. */
export async function buildDigest(companyId: string, actor: CompanyActor, now = Date.now()): Promise<Digest> {
  const start = now - 7 * DAY;
  const allTeams = await query<any[]>(`SELECT id, name, department_id FROM teams WHERE company_id = ? AND is_active = TRUE ORDER BY name`, [companyId]);
  const teams = allTeams.filter((t: any) => canViewTeamAnalytics(actor, t));
  const ids = teams.map((t: any) => t.id);
  const nameOf = new Map(allTeams.map((t: any) => [t.id, t.name]));
  const ctx: EvalContext = { companyId, intervals: await loadIntervals(companyId), book: await loadTargetBook(companyId), now };

  const latest = ids.length
    ? await query<any[]>(`SELECT DISTINCT ON (team_id) * FROM kpi_snapshots WHERE team_id = ANY(?::text[]) ORDER BY team_id, snapshot_date DESC`, [ids])
    : [];
  const latestBy = new Map(latest.map((r: any) => [r.team_id, r]));
  const digestTeams: DigestTeam[] = [];
  for (const t of teams) {
    const row = latestBy.get(t.id);
    if (!row) { digestTeams.push({ id: t.id, name: t.name, qaNow: null, qaNowDay: null, qaBefore: null, qaBeforeDay: null, delta: null, inputsUsed: 0, inputsTotal: 4 }); continue; }
    const day = String(row.snapshot_date).slice(0, 10);
    const ev = evaluateSnapshot(row, t, ctx, now);
    const before = await qaScoreOn(t, ctx, isoDay(Date.parse(`${day}T00:00:00Z`) - 7 * DAY));
    const delta = ev.qa.value !== null && before?.value != null ? Math.round((ev.qa.value - before.value) * 10) / 10 : null;
    digestTeams.push({ id: t.id, name: t.name, qaNow: ev.qa.value, qaNowDay: day, qaBefore: before?.value ?? null, qaBeforeDay: before?.day ?? null, delta, inputsUsed: ev.qa.inputsUsed, inputsTotal: ev.qa.inputsTotal });
  }
  // Largest drops first, then teams without a change, then by name.
  digestTeams.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0) || a.name.localeCompare(b.name));

  const alertRows = await query<any[]>(
    `SELECT a.*, t.department_id FROM alerts a LEFT JOIN teams t ON t.id = a.team_id
      WHERE a.company_id = ? AND (a.resolved_at IS NULL OR a.created_at >= to_timestamp(?::double precision / 1000))
      ORDER BY a.created_at DESC LIMIT 2000`,
    [companyId, start]
  );
  const visible = alertRows.filter((a: any) => canSeeAlert(actor, a));
  const toDigestAlert = (a: any): DigestAlert => ({
    id: a.id, teamName: a.team_id ? nameOf.get(a.team_id) ?? null : null, rule: a.rule, ruleLabel: RULE_DEFS[a.rule as keyof typeof RULE_DEFS]?.label ?? a.rule,
    severity: a.severity, message: a.message, createdAt: new Date(a.created_at).toISOString(), open: !a.resolved_at, acknowledged: !!a.acknowledged_at,
  });
  const opened = visible.filter((a: any) => new Date(a.created_at).getTime() >= start && a.rule !== 'metric_stale')
    .sort((a: any, b: any) => SEVERITY_RANK[b.severity as Severity] - SEVERITY_RANK[a.severity as Severity]).map(toDigestAlert);
  const openCount: Record<Severity, number> = { info: 0, warning: 0, critical: 0 };
  for (const a of visible) if (!a.resolved_at) openCount[a.severity as Severity]++;
  const stale = visible.filter((a: any) => !a.resolved_at && a.rule === 'metric_stale' && a.team_id)
    .map((a: any) => ({ teamName: nameOf.get(a.team_id) ?? 'Team', metrics: ((a.details?.metrics ?? []) as any[]).map((m) => m.label) }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));

  const actions = await actionsForTeams(companyId, ids, 7);
  const today = isoDay(now);
  const in7 = isoDay(now + 7 * DAY);
  const overdue = actions.filter((a) => a.overdue);
  const dueSoon = actions.filter((a) => !a.overdue && (a.status === 'open' || a.status === 'in_progress') && !!a.dueDate && a.dueDate >= today && a.dueDate <= in7);
  const completed = actions.filter((a) => a.status === 'done' && !!a.completedAt && Date.parse(a.completedAt) >= start);

  return {
    recipient: { id: actor.id, name: actor.name, email: actor.email },
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(now).toISOString(),
    teams: digestTeams,
    alerts: { opened, openCount },
    stale,
    actions: { overdue, dueSoon, completed },
    empty: !teams.length,
  };
}

const fmt = (v: number | null) => (v === null ? '—' : String(Math.round(v * 10) / 10));
const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
const OUTCOME_TEXT: Record<string, string> = { improved: 'improved', unchanged: 'unchanged', worse: 'worse', no_data: 'no new data', pending: 'pending' };
const completionText = (a: ActionJson) => {
  const c = a.outcomes.find((o) => o.checkpoint === 'completion');
  if (!a.metric) return 'no linked metric';
  return `${a.metric.label}: ${c ? OUTCOME_TEXT[c.outcome] : 'pending'} (baseline ${fmt(a.baseline?.value ?? null)}${c?.value != null ? `, at completion ${fmt(c.value)}` : ''})`;
};

/** Subject, text and HTML of a digest email. */
export function renderDigest(d: Digest): { subject: string; text: string; html: string } {
  const period = `${day(d.periodStart)} – ${day(d.periodEnd)}`;
  const subject = `QE Navigator weekly digest · ${period}`;
  const link = appUrl();
  const lines: string[] = [`Weekly digest for ${d.recipient.name} (${period})`, ''];
  lines.push('QA score (stale inputs left out), now vs 7 days earlier:');
  if (!d.teams.length) lines.push('  No teams in your scope.');
  for (const t of d.teams.slice(0, 25)) lines.push(`  ${t.name}: ${fmt(t.qaNow)} (${signed(t.delta)}; based on ${t.inputsUsed} of ${t.inputsTotal} inputs)`);
  lines.push('', `Alerts: ${d.alerts.openCount.critical} critical and ${d.alerts.openCount.warning} warning open; ${d.alerts.opened.length} opened this week.`);
  for (const a of d.alerts.opened.slice(0, 10)) lines.push(`  [${a.severity}] ${a.teamName ?? 'Company'}: ${a.message}${a.open ? '' : ' (resolved)'}`);
  lines.push('', `Stale metrics: ${d.stale.length ? '' : 'none'}`);
  for (const s of d.stale.slice(0, 15)) lines.push(`  ${s.teamName}: ${s.metrics.join(', ')}`);
  lines.push('', `Actions: ${d.actions.overdue.length} overdue, ${d.actions.dueSoon.length} due in the next 7 days, ${d.actions.completed.length} completed this week.`);
  for (const a of d.actions.overdue.slice(0, 10)) lines.push(`  Overdue (due ${a.dueDate}): ${a.title} · ${a.teamName}${a.owner ? ` · ${a.owner.name}` : ''}`);
  for (const a of d.actions.dueSoon.slice(0, 10)) lines.push(`  Due ${a.dueDate}: ${a.title} · ${a.teamName}${a.owner ? ` · ${a.owner.name}` : ''}`);
  for (const a of d.actions.completed.slice(0, 10)) lines.push(`  Done: ${a.title} · ${a.teamName} · ${completionText(a)}`);
  if (link) lines.push('', `Open QE Navigator: ${link}`);
  lines.push('', 'You receive this weekly digest because it is on in your notification preferences.');

  const td = 'padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;';
  const h = (s: string) => `<h3 style="margin:20px 0 6px;font-size:14px;color:#0f172a">${escapeHtml(s)}</h3>`;
  const sevColor: Record<string, string> = { critical: '#b91c1c', warning: '#b45309', info: '#475569' };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:640px">
<h2 style="font-size:18px;margin:0 0 4px">Weekly digest</h2><p style="margin:0;color:#64748b;font-size:13px">${escapeHtml(d.recipient.name)} · ${escapeHtml(period)}</p>
${h('QA score, now vs 7 days earlier')}
${d.teams.length ? `<table style="border-collapse:collapse;width:100%"><tr><th align="left" style="${td}">Team</th><th align="right" style="${td}">QA score</th><th align="right" style="${td}">Change</th><th align="right" style="${td}">Based on</th></tr>
${d.teams.slice(0, 25).map((t) => `<tr><td style="${td}">${escapeHtml(t.name)}</td><td align="right" style="${td}">${fmt(t.qaNow)}</td><td align="right" style="${td};color:${t.delta !== null && t.delta < 0 ? '#b91c1c' : t.delta !== null && t.delta > 0 ? '#15803d' : '#475569'}">${signed(t.delta)}</td><td align="right" style="${td}">${t.inputsUsed} of ${t.inputsTotal} inputs</td></tr>`).join('')}
</table>` : '<p style="font-size:13px">No teams in your scope.</p>'}
${h(`Alerts (${d.alerts.openCount.critical} critical, ${d.alerts.openCount.warning} warning open; ${d.alerts.opened.length} opened this week)`)}
${d.alerts.opened.length ? `<ul style="padding-left:18px;font-size:13px">${d.alerts.opened.slice(0, 10).map((a) => `<li><span style="color:${sevColor[a.severity]};font-weight:bold">${escapeHtml(a.severity)}</span> ${escapeHtml(a.teamName ?? 'Company')}: ${escapeHtml(a.message)}${a.open ? '' : ' (resolved)'}</li>`).join('')}</ul>` : '<p style="font-size:13px">No new alerts this week.</p>'}
${h('Stale metrics')}
${d.stale.length ? `<ul style="padding-left:18px;font-size:13px">${d.stale.slice(0, 15).map((s) => `<li>${escapeHtml(s.teamName)}: ${escapeHtml(s.metrics.join(', '))}</li>`).join('')}</ul>` : '<p style="font-size:13px">None.</p>'}
${h(`Actions (${d.actions.overdue.length} overdue, ${d.actions.dueSoon.length} due soon, ${d.actions.completed.length} completed)`)}
<ul style="padding-left:18px;font-size:13px">
${d.actions.overdue.slice(0, 10).map((a) => `<li style="color:#b91c1c">Overdue (due ${escapeHtml(a.dueDate ?? '')}): ${escapeHtml(a.title)} · ${escapeHtml(a.teamName)}</li>`).join('')}
${d.actions.dueSoon.slice(0, 10).map((a) => `<li>Due ${escapeHtml(a.dueDate ?? '')}: ${escapeHtml(a.title)} · ${escapeHtml(a.teamName)}</li>`).join('')}
${d.actions.completed.slice(0, 10).map((a) => `<li>Done: ${escapeHtml(a.title)} · ${escapeHtml(a.teamName)} · ${escapeHtml(completionText(a))}</li>`).join('')}
${d.actions.overdue.length + d.actions.dueSoon.length + d.actions.completed.length === 0 ? '<li>Nothing due and nothing completed this week.</li>' : ''}
</ul>
${link ? `<p><a href="${escapeHtml(link)}" style="color:#1d4ed8">Open QE Navigator</a></p>` : ''}
<p style="color:#64748b;font-size:12px">You receive this weekly digest because it is on in your notification preferences.</p></div>`;
  return { subject, text: lines.join('\n'), html };
}

/** Slack summary of a company's week (counts only; no individual data). */
async function slackSummary(companyId: string, now: number): Promise<string> {
  const [counts] = await query<any[]>(
    `SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL AND severity = 'critical')::int AS critical,
            COUNT(*) FILTER (WHERE resolved_at IS NULL AND severity = 'warning')::int AS warning,
            COUNT(*) FILTER (WHERE created_at >= to_timestamp(?::double precision / 1000) - INTERVAL '7 days' AND rule <> 'metric_stale')::int AS opened
       FROM alerts WHERE company_id = ?`,
    [now, companyId]
  );
  const [acts] = await query<any[]>(
    `SELECT COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_date < CURRENT_DATE)::int AS overdue,
            COUNT(*) FILTER (WHERE status = 'done' AND completed_at >= NOW() - INTERVAL '7 days')::int AS done
       FROM team_actions WHERE company_id = ?`,
    [companyId]
  );
  const link = appUrl();
  return `*QE Navigator weekly summary*\nAlerts: ${counts.critical} critical and ${counts.warning} warning open, ${counts.opened} opened this week.\nActions: ${acts.overdue} overdue, ${acts.done} completed this week.${link ? `\n<${link}|Open QE Navigator>` : ''}`;
}

/** Weekly run for every company: evaluate, then queue and send the digests. */
export async function runWeeklyDigest(now = Date.now(), opts: { companyIds?: string[] } = {}): Promise<{ companies: number; queued: number }> {
  const companies = await query<any[]>(
    "SELECT id FROM companies WHERE is_active IS NOT FALSE AND status <> 'suspended' AND id <> 'sandbox-demo' AND (?::text[] IS NULL OR id = ANY(?::text[])) ORDER BY id",
    [opts.companyIds ?? null, opts.companyIds ?? null]
  );
  const week = isoWeek(now);
  let queued = 0;
  for (const c of companies) {
    try {
      await evaluateCompany(c.id, { notify: true });
      const actors = (await loadCompanyActors(c.id)).filter((a) => canReceiveDigest(a) && !!a.email);
      const prefs = await prefsFor(actors);
      for (const a of actors) {
        if (!prefs.get(a.id)?.weeklyDigest) continue;
        const d = await buildDigest(c.id, a, now);
        if (d.empty) continue;
        const r = renderDigest(d);
        if (await enqueueDelivery({ companyId: c.id, channel: 'email', kind: 'digest', userId: a.id, recipient: a.email, subject: r.subject, payload: { text: r.text, html: r.html }, dedupeKey: `digest:${a.id}:${week}` })) queued++;
      }
      const settings = await getSettings(c.id);
      if (settings.slackEnabled && settings.slackDigest && settings.webhook) {
        if (await enqueueDelivery({ companyId: c.id, channel: 'slack', kind: 'digest', recipient: 'slack', subject: 'Weekly summary', payload: { text: await slackSummary(c.id, now) }, dedupeKey: `digest:slack:${week}` })) queued++;
      }
    } catch (e) {
      console.error('[digest] weekly digest failed for a company:', (e as Error)?.message ?? e);
    }
  }
  for (const c of companies) await processDeliveries({ companyId: c.id, budgetMs: 20_000 });
  return { companies: companies.length, queued };
}

/** "Send test digest": the caller's digest, to the caller, now. */
export async function sendTestDigest(companyId: string, actor: CompanyActor): Promise<{ status: string; error: string | null; digest: Digest; subject: string }> {
  const d = await buildDigest(companyId, actor);
  const r = renderDigest(d);
  const sent = await sendNow({ companyId, channel: 'email', kind: 'test', userId: actor.id, recipient: actor.email, subject: `[Test] ${r.subject}`, payload: { text: r.text, html: r.html }, dedupeKey: null });
  return { ...sent, digest: d, subject: r.subject };
}

export type { PolicyActor };
