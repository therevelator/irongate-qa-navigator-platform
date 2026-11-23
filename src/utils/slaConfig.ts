import { API_URL } from '../config/api';

export type SLAConfig = {
  responseTimeMs: number;
  errorRatePercent: number;
};

const DEFAULT_SLA_CONFIG: SLAConfig = {
  responseTimeMs: 500,
  errorRatePercent: 1,
};

// Cache per scope ('' = company) to avoid repeated API calls.
const CACHE_TTL = 60000; // 1 minute
const cache = new Map<string, { config: SLAConfig; at: number }>();

/**
 * SLA thresholds for a team, resolved by the server with the one inheritance rule
 * (team, then department, then company). Without a team: company settings.
 */
export const fetchSLAConfig = async (teamId?: string): Promise<SLAConfig> => {
  if (typeof window === 'undefined') return DEFAULT_SLA_CONFIG;
  const key = teamId ?? '';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.config;

  try {
    const params = new URLSearchParams();
    if (teamId) params.append('teamId', teamId);
    const response = await fetch(`${API_URL}/admin/configs?${params}`, { credentials: 'include' });
    if (!response.ok) return hit?.config ?? DEFAULT_SLA_CONFIG;

    const { configs } = await response.json();
    // A configured 0 is a valid value; only fall back when the setting is absent or not numeric.
    const configNumber = (v: unknown, fallback: number) => (v == null || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));
    const result: SLAConfig = {
      responseTimeMs: configNumber(configs.sla_response_time_ms?.value, DEFAULT_SLA_CONFIG.responseTimeMs),
      errorRatePercent: configNumber(configs.sla_error_rate_percent?.value, DEFAULT_SLA_CONFIG.errorRatePercent),
    };
    cache.set(key, { config: result, at: Date.now() });
    return result;
  } catch (error) {
    console.warn('Failed to fetch SLA config, using defaults', error);
    return hit?.config ?? DEFAULT_SLA_CONFIG;
  }
};

export const invalidateSLACache = () => cache.clear();
