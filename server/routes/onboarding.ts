import express from 'express';
import { transaction } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { canViewOnboarding } from '../lib/userPolicy';
import { onboardingStatus } from '../lib/onboarding';
import { recordAudit } from '../lib/audit';
import { execOn } from '../lib/assignments';

/**
 * Onboarding checklist (server/lib/onboarding.ts). Company administrators only (canViewOnboarding).
 *
 * GET  /api/onboarding           steps with progress computed from the real state
 * POST /api/onboarding/dismiss   hide the checklist on the dashboard (for the company)
 * POST /api/onboarding/restore   show it again
 */

const router = express.Router();

function allowed(req: AuthRequest, res: express.Response): boolean {
  if (canViewOnboarding(policyActor(req))) return true;
  res.status(403).json({ error: 'Only an administrator can see the onboarding checklist' });
  return false;
}

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!allowed(req, res)) return;
    res.json(await onboardingStatus(req.companyId as string));
  } catch (error) {
    console.error('Onboarding status error:', error);
    res.status(500).json({ error: 'Failed to load the onboarding checklist' });
  }
});

async function setDismissed(req: AuthRequest, res: express.Response, dismissed: boolean) {
  try {
    if (!allowed(req, res)) return;
    const companyId = req.companyId as string;
    const before = await onboardingStatus(companyId);
    if (before.dismissed !== dismissed) {
      await transaction(async (client) => {
        const exec = execOn(client);
        await exec(
          `INSERT INTO onboarding_state (company_id, dismissed_at, dismissed_by, updated_at) VALUES (?, ?, ?, now())
           ON CONFLICT (company_id) DO UPDATE SET dismissed_at = EXCLUDED.dismissed_at, dismissed_by = EXCLUDED.dismissed_by, updated_at = now()`,
          [companyId, dismissed ? new Date().toISOString() : null, dismissed ? req.user!.id : null]
        );
        await recordAudit({
          companyId, actorId: req.user!.id, action: dismissed ? 'onboarding.dismiss' : 'onboarding.restore', entityType: 'company', entityId: companyId,
          summary: dismissed ? `Hid the onboarding checklist (${before.completed} of ${before.total} steps done)` : 'Showed the onboarding checklist again',
          before: { dismissed: before.dismissed }, after: { dismissed },
        }, exec);
      });
    }
    res.json(await onboardingStatus(companyId));
  } catch (error) {
    console.error('Onboarding update error:', error);
    res.status(500).json({ error: 'Failed to update the onboarding checklist' });
  }
}

router.post('/dismiss', authenticateToken, (req: AuthRequest, res) => setDismissed(req, res, true));
router.post('/restore', authenticateToken, (req: AuthRequest, res) => setDismissed(req, res, false));

export default router;
