/**
 * Where the server runs, and the secrets it needs there. One rule for every security decision that
 * depends on "production": the session cookie (Secure, SameSite), the signing secret, the key of
 * stored secrets, CORS and demo credentials.
 *
 * Production is NODE_ENV=production OR a hosted runtime: Netlify sets NETLIFY in the build and its
 * functions run on AWS Lambda (AWS_LAMBDA_FUNCTION_NAME), where NODE_ENV is not set to production.
 * Checking NODE_ENV alone left the live site with a non-Secure, SameSite=Lax cookie and without the
 * start-up secret check. `netlify dev` (NETLIFY_DEV=true) is local development.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return true;
  // `netlify dev` on a developer's computer emulates the functions (NETLIFY_DEV=true): not production.
  if (env.NETLIFY_DEV === 'true') return false;
  return !!env.NETLIFY || !!env.AWS_LAMBDA_FUNCTION_NAME;
}

/** The development-only signing secret (never accepted in production). */
export const DEV_ONLY_SECRET = 'dev-only-insecure-secret-change-me';

/** Placeholder and former default values of the repository and its scripts: never a real secret. */
const KNOWN_PLACEHOLDERS = new Set([
  DEV_ONLY_SECRET,
  'your-generated-jwt-secret-here',
  'your-random-secret-key-here',
  'your-secret-key-change-in-production',
  'changeme',
  'secret',
]);

/** The minimum length of a production secret (characters). */
export const MIN_SECRET_LENGTH = 32;

/** Why a value cannot be a production secret, or null when it can. */
export function weakSecretProblem(value: string | undefined | null): string | null {
  const v = (value ?? '').trim();
  if (!v) return 'is not set';
  if (KNOWN_PLACEHOLDERS.has(v.toLowerCase()) || /^your[-_]/i.test(v) || /change[-_]?me/i.test(v)) return 'is a placeholder value';
  if (v.length < MIN_SECRET_LENGTH) return `is shorter than ${MIN_SECRET_LENGTH} characters`;
  return null;
}

/** The configured signing secret (JWT_SECRET, or the legacy name secrettoken). */
export function configuredJwtSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.JWT_SECRET || env.secrettoken || undefined;
}

/**
 * The signing secret. In production it must be set and strong (refuses to start otherwise: fail
 * closed); in development and tests a missing one falls back to DEV_ONLY_SECRET.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = configuredJwtSecret(env);
  if (isProductionRuntime(env)) {
    const problem = weakSecretProblem(configured);
    if (problem) {
      throw new Error(`JWT_SECRET (or secrettoken) ${problem}. Refusing to start in production: set a long random value (at least ${MIN_SECRET_LENGTH} characters).`);
    }
    return configured as string;
  }
  return configured || DEV_ONLY_SECRET;
}

/**
 * Key material of stored secrets (the Slack webhook): SETTINGS_ENCRYPTION_KEY, else the signing
 * secret (the documented design). In production one of them must be a real secret; a constant is
 * never used there. Outside production a missing key falls back to DEV_ONLY_SECRET.
 */
export function settingsKeyMaterial(env: NodeJS.ProcessEnv = process.env): string {
  const own = env.SETTINGS_ENCRYPTION_KEY;
  if (own) {
    if (isProductionRuntime(env)) {
      const problem = weakSecretProblem(own);
      if (problem) throw new Error(`SETTINGS_ENCRYPTION_KEY ${problem}. Set a long random value (at least ${MIN_SECRET_LENGTH} characters) or remove it to use JWT_SECRET.`);
    }
    return own;
  }
  return resolveJwtSecret(env);
}

/** Key material of the auth-event e-mail hash: the signing secret (a constant is never used in production). */
export function authEventKeyMaterial(env: NodeJS.ProcessEnv = process.env): string {
  return resolveJwtSecret(env);
}

/** Session cookie flags: Secure and SameSite=Strict in production, Lax over plain http in development. */
export function sessionCookieFlags(env: NodeJS.ProcessEnv = process.env): { httpOnly: true; secure: boolean; sameSite: 'strict' | 'lax' } {
  const prod = isProductionRuntime(env);
  return { httpOnly: true, secure: prod, sameSite: prod ? 'strict' : 'lax' };
}
