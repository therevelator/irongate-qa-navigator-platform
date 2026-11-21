import { createHash, randomBytes } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../../src/lib/db';
import { isSandboxCompany } from '../lib/sandboxConfig';

/**
 * Per-company API keys for machine ingestion. Format: igk_<43 base64url chars>.
 * Only the sha256 hash is stored (api_keys.key_hash); the plaintext is shown once.
 */
export const API_KEY_PREFIX = 'igk_';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export interface ApiKeyRequest extends Request {
  apiKey?: { id: string; companyId: string; name: string };
}

/** Authenticate `Authorization: Bearer igk_…`. 401 for a missing, unknown or revoked key. */
export async function authenticateApiKey(req: ApiKeyRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token.startsWith(API_KEY_PREFIX)) {
      return res.status(401).json({ error: 'API key required (Authorization: Bearer igk_…)' });
    }
    const row = await queryOne<any>(
      `SELECT k.id, k.company_id, k.name, c.status AS company_status
         FROM api_keys k JOIN companies c ON c.id = k.company_id WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
      [hashApiKey(token)]
    );
    if (!row) return res.status(401).json({ error: 'Invalid or revoked API key' });
    // A suspended organisation (companies.status): its keys are refused until it is reactivated.
    if (row.company_status === 'suspended') {
      return res.status(403).json({ error: "Your organisation's access is suspended. Contact your administrator.", code: 'company_suspended' });
    }
    // The demo sandbox (server/lib/sandboxConfig.ts) takes no data from outside: its keys are refused.
    if (isSandboxCompany(row.company_id)) return res.status(403).json({ error: 'The demo sandbox does not accept data.', code: 'sandbox_read_only' });
    req.apiKey = { id: row.id, companyId: row.company_id, name: row.name };
    // Best effort; never blocks the request.
    query('UPDATE api_keys SET last_used_at = now() WHERE id = ?', [row.id]).catch(() => undefined);
    next();
  } catch (error) {
    console.error('API key auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}
