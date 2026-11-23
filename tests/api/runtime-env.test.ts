/**
 * Production detection and the secrets it requires (server/lib/runtimeEnv.ts; docs/SECURITY_REVIEW.md
 * finding 1 and 16). Pure unit tests: no backend or database.
 *
 *   ENV-001 production = NODE_ENV=production, NETLIFY or AWS_LAMBDA_FUNCTION_NAME (not `netlify dev`)
 *   ENV-002 production session cookies are Secure and SameSite=Strict; development: Lax, not Secure
 *   ENV-003 production refuses a missing, placeholder or short (< 32 characters) signing secret
 *   ENV-004 the key of stored secrets is required in production (SETTINGS_ENCRYPTION_KEY, else
 *           JWT_SECRET); never the development constant; existing webhooks keep decrypting
 *   ENV-005 demo credentials in production only with an explicit DEMO_MODE=true
 */
import {
  DEV_ONLY_SECRET, authEventKeyMaterial, isProductionRuntime, resolveJwtSecret, sessionCookieFlags, settingsKeyMaterial, weakSecretProblem,
} from '../../server/lib/runtimeEnv';

const STRONG = 'k3y-0f-at-least-thirty-two-characters-long-xyz';

describe('runtime environment', () => {
  test('ENV-001 production detection', () => {
    expect(isProductionRuntime({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionRuntime({ NETLIFY: 'true' })).toBe(true);
    expect(isProductionRuntime({ AWS_LAMBDA_FUNCTION_NAME: 'api' })).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: 'development' })).toBe(false);
    expect(isProductionRuntime({})).toBe(false);
    expect(isProductionRuntime({ NETLIFY: 'true', NETLIFY_DEV: 'true' })).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: 'production', NETLIFY_DEV: 'true' })).toBe(true);
  });

  test('ENV-002 Secure, SameSite=Strict cookies in production', () => {
    for (const env of [{ NODE_ENV: 'production' }, { NETLIFY: 'true' }, { AWS_LAMBDA_FUNCTION_NAME: 'api' }]) {
      expect(sessionCookieFlags(env)).toEqual({ httpOnly: true, secure: true, sameSite: 'strict' });
    }
    expect(sessionCookieFlags({})).toEqual({ httpOnly: true, secure: false, sameSite: 'lax' });
  });

  test('ENV-003 the signing secret: required and strong in production', () => {
    const prod = { NETLIFY: 'true' };
    expect(() => resolveJwtSecret(prod)).toThrow(/not set/);
    for (const weak of ['your-generated-jwt-secret-here', DEV_ONLY_SECRET, 'your-random-secret-key-here', 'your-secret-key-change-in-production', 'short-secret']) {
      expect(() => resolveJwtSecret({ ...prod, JWT_SECRET: weak })).toThrow(/Refusing to start/);
    }
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(31) })).toThrow(/shorter than 32/);
    expect(resolveJwtSecret({ ...prod, JWT_SECRET: STRONG })).toBe(STRONG);
    expect(resolveJwtSecret({ ...prod, secrettoken: STRONG })).toBe(STRONG); // the legacy name
    expect(weakSecretProblem(STRONG)).toBeNull();
    // Development and tests: a missing secret falls back to the development constant.
    expect(resolveJwtSecret({})).toBe(DEV_ONLY_SECRET);
    expect(resolveJwtSecret({ JWT_SECRET: 'short' })).toBe('short');
  });

  test('ENV-004 the key of stored secrets and of auth-event hashes is required in production', () => {
    const prod = { AWS_LAMBDA_FUNCTION_NAME: 'api' };
    expect(() => settingsKeyMaterial(prod)).toThrow(/Refusing to start/);
    expect(() => authEventKeyMaterial(prod)).toThrow(/Refusing to start/);
    expect(() => settingsKeyMaterial({ ...prod, SETTINGS_ENCRYPTION_KEY: 'too-short' })).toThrow(/SETTINGS_ENCRYPTION_KEY/);
    // Documented design: SETTINGS_ENCRYPTION_KEY, else derived from JWT_SECRET (the same material as before).
    expect(settingsKeyMaterial({ ...prod, JWT_SECRET: STRONG })).toBe(STRONG);
    expect(settingsKeyMaterial({ ...prod, JWT_SECRET: STRONG, SETTINGS_ENCRYPTION_KEY: `${STRONG}-own` })).toBe(`${STRONG}-own`);
    expect(authEventKeyMaterial({ ...prod, JWT_SECRET: STRONG })).toBe(STRONG);
    expect(settingsKeyMaterial({})).toBe(DEV_ONLY_SECRET);
  });

  test('ENV-004b encryption refuses to run in production without a key; old webhooks still decrypt', async () => {
    const saved = { ...process.env };
    try {
      const { encryptSecret, decryptSecret, settingsKeyFrom } = await import('../../server/lib/notifications');
      process.env.NETLIFY = 'true';
      delete process.env.SETTINGS_ENCRYPTION_KEY; delete process.env.JWT_SECRET; delete process.env.secrettoken;
      expect(() => encryptSecret('https://hooks.slack.com/services/T/B/x')).toThrow(/Refusing to start/);
      // A webhook stored with the key derived from JWT_SECRET (as before this change) decrypts the same way.
      process.env.JWT_SECRET = STRONG;
      const before = encryptSecret('https://hooks.slack.com/services/T/B/keep', settingsKeyFrom(STRONG));
      expect(decryptSecret(before)).toBe('https://hooks.slack.com/services/T/B/keep');
      // One stored with the development constant is not readable with a real key (re-encrypt it once).
      expect(decryptSecret(encryptSecret('https://hooks.slack.com/services/T/B/old', settingsKeyFrom(DEV_ONLY_SECRET)))).toBeNull();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  test('ENV-005 demo credentials in production only with DEMO_MODE=true', async () => {
    const { demoModeEnabled } = await import('../../server/routes/authSso');
    const { separateSampleCompanyEnabled } = await import('../../server/lib/syntheticData');
    for (const fn of [demoModeEnabled, separateSampleCompanyEnabled]) {
      expect(fn({ NETLIFY: 'true' })).toBe(false);
      expect(fn({ NETLIFY: 'true', DEMO_MODE: '1' })).toBe(false);
      expect(fn({ AWS_LAMBDA_FUNCTION_NAME: 'api', DEMO_MODE: 'yes' })).toBe(false);
      expect(fn({ NODE_ENV: 'production', DEMO_MODE: 'true' })).toBe(true);
      expect(fn({})).toBe(true);
      expect(fn({ DEMO_MODE: '1' })).toBe(true);
      expect(fn({ DEMO_MODE: 'false' })).toBe(false);
    }
  });
});

afterAll(async () => {
  // Importing the route modules creates the (unused) database pool.
  const { pool } = await import('../../src/lib/db');
  await pool.end();
});
