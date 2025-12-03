import { API_URL } from '../config/api';

export type SLAConfig = {
  responseTimeMs: number;
  errorRatePercent: number;
  uptimePercent: number;
};

const DEFAULT_SLA_CONFIG: SLAConfig = {
  responseTimeMs: 500,
  errorRatePercent: 1,
  uptimePercent: 99.9
};

// Cache for SLA config to avoid repeated API calls
let cachedConfig: SLAConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

export const loadSLAConfig = (): SLAConfig => {
  // Return cached value if valid
  if (cachedConfig && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedConfig;
  }
  return cachedConfig || DEFAULT_SLA_CONFIG;
};

export const fetchSLAConfig = async (teamId?: string): Promise<SLAConfig> => {
  if (typeof window === 'undefined') {
    return DEFAULT_SLA_CONFIG;
  }

  try {
    const params = new URLSearchParams();
    if (teamId) params.append('teamId', teamId);

    const response = await fetch(`${API_URL}/admin/configs?${params}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      return cachedConfig || DEFAULT_SLA_CONFIG;
    }

    const { configs } = await response.json();
    
    const result: SLAConfig = {
      responseTimeMs: Number(configs.sla_response_time_ms?.value) || DEFAULT_SLA_CONFIG.responseTimeMs,
      errorRatePercent: Number(configs.sla_error_rate_percent?.value) || DEFAULT_SLA_CONFIG.errorRatePercent,
      uptimePercent: Number(configs.sla_uptime_percent?.value) || DEFAULT_SLA_CONFIG.uptimePercent
    };

    cachedConfig = result;
    cacheTimestamp = Date.now();
    return result;
  } catch (error) {
    console.warn('Failed to fetch SLA config, using defaults', error);
    return cachedConfig || DEFAULT_SLA_CONFIG;
  }
};

export const invalidateSLACache = () => {
  cachedConfig = null;
  cacheTimestamp = 0;
};

export const getDefaultSLAConfig = (): SLAConfig => DEFAULT_SLA_CONFIG;
