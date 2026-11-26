import express from 'express';
import { query } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { analyticsTeamsInScope, canWriteTeamData } from '../lib/userPolicy';
import { recordAudit } from '../lib/audit';
import {
  CADENCES, cleanIntervals, DATA_GROUPS, DEFAULT_INTERVAL_MINUTES, effectiveSchedule, intervalText, isCadence, loadSchedules,
  MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, RECOMMENDED, saveTeamSchedule, ScheduleError,
} from '../lib/collectionSchedule';

/**
 * Collection frequency (src/components/CollectionSchedule.tsx): how often the Exporter reads each kind of data,
 * per team. Authenticated, company-scoped.
 *
 * GET /api/collection-schedule            the teams of the caller's analytics scope with their release cadence, the
 *                                         interval per data group (stored or default), whether it was set, and whether
 *                                         the caller may change it; the data groups, the cadences, the recommendation
 *                                         per cadence and the limits
 * PUT /api/collection-schedule/teams/:id  { cadence?, intervals: { ci?: minutes, … } }: super admins, the department's
 *                                         managers and the team's leads (canWriteTeamData). Recorded in the audit log.
 */
const router = express.Router();

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const companyId = req.companyId as string;
    const actor = policyActor(req);
    const rows = await query<any[]>(
      `SELECT t.id, t.name, t.department_id, t.release_cadence, d.name AS department_name FROM teams t LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.company_id = ? AND t.is_active = TRUE ORDER BY d.name NULLS LAST, t.name`, [companyId]);
    const teams = analyticsTeamsInScope(actor, rows.map((r: any) => ({ ...r, id: String(r.id), department_id: r.department_id ? String(r.department_id) : null })));
    const stored = await loadSchedules(companyId);
    res.json({
      groups: DATA_GROUPS, cadences: CADENCES, recommended: RECOMMENDED,
      defaultMinutes: DEFAULT_INTERVAL_MINUTES, minMinutes: MIN_INTERVAL_MINUTES, maxMinutes: MAX_INTERVAL_MINUTES,
      teams: teams.map((t: any) => {
        const mine = stored.get(t.id);
        return {
          id: t.id, name: t.name, department: t.department_name ?? null, cadence: t.release_cadence ?? null,
          intervals: effectiveSchedule(mine), configured: !!mine && Object.keys(mine).length > 0,
          canEdit: canWriteTeamData(actor, { id: t.id, department_id: t.department_id }),
        };
      }),
      note: 'The Exporter reads this schedule at the start of every run and skips a source it read less than its interval ago. A source that serves several teams follows the shortest interval among them.',
    });
  } catch (e) {
    console.error('Failed to load the collection schedule:', e);
    res.status(500).json({ error: 'Failed to load the collection schedule' });
  }
});

router.put('/teams/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const companyId = req.companyId as string;
    const actor = policyActor(req);
    const team = (await query<any[]>('SELECT id, name, department_id, release_cadence FROM teams WHERE id = ? AND company_id = ? AND is_active = TRUE', [req.params.id, companyId]))[0];
    if (!team || !canWriteTeamData(actor, { id: String(team.id), department_id: team.department_id ? String(team.department_id) : null })) {
      return res.status(403).json({ error: 'Only the team’s leads, its department’s managers and administrators can change how often its data is collected' });
    }
    const body = req.body ?? {};
    if (body.cadence !== undefined && body.cadence !== null && !isCadence(body.cadence)) return res.status(400).json({ error: `cadence must be one of ${CADENCES.map((c) => c.key).join(', ')}` });
    const intervals = cleanIntervals(body.intervals ?? {});
    await saveTeamSchedule(companyId, String(team.id), actor.id ?? null, body.cadence === undefined ? undefined : body.cadence, intervals);
    await recordAudit({
      companyId, actorId: actor.id ?? null, action: 'collection.schedule', entityType: 'team', entityId: String(team.id),
      summary: `Collection frequency of ${team.name}: ${Object.entries(intervals).map(([g, m]) => `${g} ${intervalText(m as number)}`).join(', ') || 'release cadence only'}`,
      after: { cadence: body.cadence ?? team.release_cadence ?? null, intervals }, departmentIds: [team.department_id],
    }).catch((e: unknown) => console.error('[collection] audit failed:', (e as Error)?.message ?? e));
    const stored = (await loadSchedules(companyId)).get(String(team.id));
    res.json({ id: String(team.id), cadence: body.cadence === undefined ? team.release_cadence ?? null : body.cadence, intervals: effectiveSchedule(stored), configured: true });
  } catch (e) {
    if (e instanceof ScheduleError) return res.status(400).json({ error: e.message });
    console.error('Failed to save the collection schedule:', e);
    res.status(500).json({ error: 'Failed to save the collection schedule' });
  }
});

export default router;
