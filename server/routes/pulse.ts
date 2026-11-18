import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getOwnedTeam, policyActor } from '../middleware/access';
import { canSetPulseCadence, canTakePulseSurvey, canViewPulseComments, canViewPulseResults } from '../lib/userPolicy';
import {
  PULSE_CADENCES, PULSE_COMMENT_MAX, PULSE_QUESTIONS, PULSE_SCALE, PulseError, WELLBEING_FORMULA,
  parseAnswers, setPulseCadence, submitPulseResponse, teamPulse, type PulseCadence,
} from '../lib/pulse';
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
 *   PUT  /api/pulse/teams/:teamId/cadence    weekly | biweekly from the next period
 *                                            canSetPulseCadence (lead, QA manager, super_admin)
 * A team of another company or an unknown id gets the same 403 as an out-of-scope team.
 * No route returns a single answer, a respondent or who answered.
 */
const router = express.Router();

const denied = (res: express.Response, message = 'Access denied. This team is outside your scope.') => res.status(403).json({ error: message });

router.get('/teams/:teamId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await getOwnedTeam(req, req.params.teamId as string);
    const actor = policyActor(req);
    if (!team || !canViewPulseResults(actor, team)) return denied(res);
    const pulse = await teamPulse(team.id, req.user!.id, { withComments: canViewPulseComments(actor, team) });
    res.json({
      team: { id: team.id, name: team.name, isActive: team.is_active },
      ...pulse,
      canRespond: team.is_active && canTakePulseSurvey(actor, team),
      canSetCadence: canSetPulseCadence(actor, team),
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
    if (!canSetPulseCadence(actor, team)) return denied(res, 'Only the team lead, a QA manager of its department or an administrator can change how often the team is asked.');
    const cadence = req.body?.cadence as PulseCadence;
    if (!PULSE_CADENCES.includes(cadence)) return res.status(400).json({ error: `cadence must be one of: ${PULSE_CADENCES.join(', ')}` });
    const r = await setPulseCadence({ companyId: req.companyId!, teamId: team.id, cadence, actorId: req.user!.id });
    await recordAudit({
      companyId: req.companyId!, actorId: req.user!.id, action: 'team.pulse_cadence', entityType: 'team', entityId: team.id,
      summary: r.pending
        ? `Pulse survey of ${team.name}: ${r.pending.cadence} from ${r.pending.from}`
        : `Pulse survey of ${team.name}: stays ${r.current}`,
      before: { cadence: r.current, pending: r.previousPending },
      after: { cadence: r.current, pending: r.pending },
      departmentIds: [team.department_id], subjectIds: [team.id],
    });
    res.json({ success: true, cadence: r.current, pendingCadence: r.pending });
  } catch (error) {
    console.error('Pulse cadence error:', error);
    res.status(500).json({ error: 'Failed to change the survey cadence' });
  }
});

export default router;
