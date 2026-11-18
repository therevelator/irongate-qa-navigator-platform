import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getOwnedTeam, policyActor } from '../middleware/access';
import { canSendPulseSurvey, canSetPulseCadence, canTakePulseSurvey, canViewPulseComments, canViewPulseResults } from '../lib/userPolicy';
import {
  CADENCE_LABELS, PULSE_CADENCES, PULSE_COMMENT_MAX, PULSE_QUESTIONS, PULSE_SCALE, PulseError, WELLBEING_FORMULA,
  loadCadences, parseAnswers, periodFor, setPulseCadence, submitPulseResponse, teamPulse, todayUtc, type PulseCadence,
} from '../lib/pulse';
import {
  ensureAutoSendDefault, inspectLink, remindPulseSurvey, respondWithLink, responseRate, sendPulseSurvey, sendStatus, sentCounts, setAutoSend,
} from '../lib/pulseSend';
import { K_ANONYMITY_RULE, SUPPRESSED_TEXT } from '../lib/privacy';
import { recordAudit } from '../lib/audit';

/**
 * Wellbeing pulse survey (server/lib/pulse.ts). Every route is authenticated and scoped to the
 * caller's company; access through the shared rules in server/lib/userPolicy.ts:
 *   GET  /api/pulse/teams/:teamId            results (aggregates only) + the caller's status
 *                                            canViewPulseResults (analytics scope); comments only
 *                                            with canViewPulseComments (lead / manager / admin)
 *   POST /api/pulse/teams/:teamId/responses  answer for the running period
 *                                            canTakePulseSurvey (assigned to the team); once per period
 *   PUT  /api/pulse/teams/:teamId/cadence    weekly | biweekly | monthly | quarterly from the next period
 *                                            canSetPulseCadence (QA manager of the department, super_admin)
 *   PUT  /api/pulse/teams/:teamId/auto-send  { enabled } automatic e-mail at the start of each period
 *                                            canSetPulseCadence
 *   POST /api/pulse/teams/:teamId/send       e-mail personal links for the running period to every
 *                                            active member not sent one yet
 *                                            canSendPulseSurvey (lead, QA manager, super_admin in scope)
 *   POST /api/pulse/teams/:teamId/remind     e-mail the members who have not answered (counts only back)
 *                                            canSendPulseSurvey; at most once per 24 hours
 *   POST /api/pulse/link                     { token } what the answer page shows for a personal link
 *   POST /api/pulse/link/respond             { token, answers, comment } answer through the link
 *       The two link routes need no session: the token (sha256 stored, single use, bound to one
 *       user, team and period, expires at period end) authenticates that one submission only.
 * A team of another company or an unknown id gets the same 403 as an out-of-scope team.
 * No route returns a single answer, a respondent, who answered, or a personal link.
 */
const router = express.Router();

const denied = (res: express.Response, message = 'Access denied. This team is outside your scope.') => res.status(403).json({ error: message });

router.get('/teams/:teamId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await getOwnedTeam(req, req.params.teamId as string);
    const actor = policyActor(req);
    if (!team || !canViewPulseResults(actor, team)) return denied(res);
    const pulse = await teamPulse(team.id, req.user!.id, { withComments: canViewPulseComments(actor, team) });
    // Response rate per closed period: responses ÷ members the survey was e-mailed to (shown periods only).
    const sent = await sentCounts(team.id, [...new Set([...pulse.periods.map((p) => p.start), pulse.latest.start, pulse.currentPeriod.start])]);
    const withRate = <T extends { start: string; responses: number | null; suppressed: boolean }>(p: T) => ({
      ...p, sent: sent.get(p.start) ?? 0, responseRate: p.suppressed ? null : responseRate(p.responses, sent.get(p.start)),
    });
    const canSend = canSendPulseSurvey(actor, team);
    res.json({
      team: { id: team.id, name: team.name, isActive: team.is_active },
      ...pulse,
      periods: pulse.periods.map(withRate),
      latest: withRate(pulse.latest),
      currentPeriod: {
        ...pulse.currentPeriod,
        sent: sent.get(pulse.currentPeriod.start) ?? 0,
        responseRate: responseRate(pulse.currentPeriod.responsesSoFar, sent.get(pulse.currentPeriod.start)),
      },
      sending: canSend ? await sendStatus(team) : null,
      canSend,
      canRespond: team.is_active && canTakePulseSurvey(actor, team),
      canSetCadence: canSetPulseCadence(actor, team),
      cadences: PULSE_CADENCES.map((c) => ({ value: c, label: CADENCE_LABELS[c] })),
      canViewComments: canViewPulseComments(actor, team),
      questions: PULSE_QUESTIONS.map((q) => ({ key: q.key, text: q.text })),
      scale: PULSE_SCALE,
      commentMax: PULSE_COMMENT_MAX,
      formula: WELLBEING_FORMULA,
      privacy: K_ANONYMITY_RULE,
      suppressedText: SUPPRESSED_TEXT,
    });
  } catch (error) {
    console.error('Pulse results error:', error);
    res.status(500).json({ error: 'Failed to load the pulse survey' });
  }
});

router.post('/teams/:teamId/responses', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await getOwnedTeam(req, req.params.teamId as string);
    const actor = policyActor(req);
    if (!team || !canTakePulseSurvey(actor, team)) return denied(res, 'Only members of this team can answer its pulse survey.');
    if (!team.is_active) return res.status(409).json({ error: 'This team is inactive.' });
    const parsed = parseAnswers(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const period = await submitPulseResponse({
      companyId: req.companyId!, teamId: team.id, userId: req.user!.id, answers: parsed.answers, comment: parsed.comment,
    });
    // No audit entry: it would link the person to the time of their answer.
    res.status(201).json({ success: true, period: { start: period.start, end: period.end } });
  } catch (error) {
    if (error instanceof PulseError) return res.status(error.status).json({ error: error.message });
    console.error('Pulse response error:', error);
    res.status(500).json({ error: 'Failed to save your answer' });
  }
});

router.put('/teams/:teamId/cadence', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await getOwnedTeam(req, req.params.teamId as string);
    const actor = policyActor(req);
    if (!team || !canViewPulseResults(actor, team)) return denied(res);
    if (!canSetPulseCadence(actor, team)) return denied(res, 'Managers decide how often the team is asked: a QA manager of its department or an administrator.');
    const cadence = req.body?.cadence as PulseCadence;
    if (!PULSE_CADENCES.includes(cadence)) return res.status(400).json({ error: `cadence must be one of: ${PULSE_CADENCES.join(', ')}` });
    const r = await setPulseCadence({ companyId: req.companyId!, teamId: team.id, cadence, actorId: req.user!.id });
    // The first time a manager sets the cadence, automatic sending is switched on from the next period.
    const cads = (await loadCadences([team.id])).get(team.id) ?? [];
    const autoOn = await ensureAutoSendDefault({
      companyId: req.companyId!, teamId: team.id, actorId: req.user!.id, from: r.pending?.from ?? periodFor(cads, todayUtc()).end,
    });
    await recordAudit({
      companyId: req.companyId!, actorId: req.user!.id, action: 'team.pulse_cadence', entityType: 'team', entityId: team.id,
      summary: r.pending
        ? `Pulse survey of ${team.name}: ${r.pending.cadence} from ${r.pending.from}`
        : `Pulse survey of ${team.name}: stays ${r.current}`,
      before: { cadence: r.current, pending: r.previousPending },
      after: { cadence: r.current, pending: r.pending, ...(autoOn ? { autoSend: true } : {}) },
      departmentIds: [team.department_id], subjectIds: [team.id],
    });
    res.json({ success: true, cadence: r.current, pendingCadence: r.pending, autoSendEnabled: autoOn });
  } catch (error) {
    console.error('Pulse cadence error:', error);
    res.status(500).json({ error: 'Failed to change the survey cadence' });
  }
});

router.put('/teams/:teamId/auto-send', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await getOwnedTeam(req, req.params.teamId as string);
    const actor = policyActor(req);
    if (!team || !canViewPulseResults(actor, team)) return denied(res);
    if (!canSetPulseCadence(actor, team)) return denied(res, 'Managers decide whether the survey goes out automatically: a QA manager of its department or an administrator.');
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    const r = await setAutoSend({ companyId: req.companyId!, teamId: team.id, enabled: req.body.enabled, actorId: req.user!.id });
    await recordAudit({
      companyId: req.companyId!, actorId: req.user!.id, action: 'team.pulse_auto_send', entityType: 'team', entityId: team.id,
      summary: r.after.autoSend
        ? `Pulse survey of ${team.name}: e-mailed automatically from the period starting ${r.after.autoSendFrom}`
        : `Pulse survey of ${team.name}: automatic sending turned off`,
      before: { autoSend: r.before.autoSend, from: r.before.autoSendFrom },
      after: { autoSend: r.after.autoSend, from: r.after.autoSendFrom },
      departmentIds: [team.department_id], subjectIds: [team.id],
    });
    res.json({ success: true, autoSend: { enabled: r.after.autoSend, from: r.after.autoSendFrom } });
  } catch (error) {
    console.error('Pulse auto-send error:', error);
    res.status(500).json({ error: 'Failed to change automatic sending' });
  }
});

const sendRoute = (kind: 'send' | 'remind') => async (req: AuthRequest, res: express.Response) => {
  try {
    const team = await getOwnedTeam(req, req.params.teamId as string);
    const actor = policyActor(req);
    if (!team || !canViewPulseResults(actor, team)) return denied(res);
    if (!canSendPulseSurvey(actor, team)) return denied(res, 'Only the team lead, a QA manager of its department or an administrator can send the survey.');
    if (!team.is_active) return res.status(409).json({ error: 'This team is inactive.' });
    const r = kind === 'send'
      ? await sendPulseSurvey({ companyId: req.companyId!, team, actorId: req.user!.id, trigger: 'manual' })
      : await remindPulseSurvey({ companyId: req.companyId!, team, actorId: req.user!.id });
    res.json({ success: true, ...r, sending: await sendStatus(team) });
  } catch (error) {
    if (error instanceof PulseError) return res.status(error.status).json({ error: error.message });
    console.error(`Pulse ${kind} error:`, error);
    res.status(500).json({ error: kind === 'send' ? 'Failed to send the survey' : 'Failed to send the reminder' });
  }
};
router.post('/teams/:teamId/send', authenticateToken, sendRoute('send'));
router.post('/teams/:teamId/remind', authenticateToken, sendRoute('remind'));

// Personal survey links: no session; the token authenticates this one submission only.
router.post('/link', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await inspectLink(req.body?.token));
  } catch (error) {
    console.error('Pulse link error:', error);
    res.status(500).json({ error: 'Failed to open the survey link' });
  }
});

router.post('/link/respond', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const parsed = parseAnswers(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const r = await respondWithLink({ token: req.body?.token, answers: parsed.answers, comment: parsed.comment });
    // No audit entry: it would link the person to the time of their answer.
    res.status(201).json({ success: true, period: r.period, team: { name: r.teamName } });
  } catch (error) {
    if (error instanceof PulseError) return res.status(error.status).json({ error: error.message });
    console.error('Pulse link answer error:', error);
    res.status(500).json({ error: 'Failed to save your answer' });
  }
});

export default router;

