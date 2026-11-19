import bcrypt from 'bcrypt';
import { expect, type Page } from '@playwright/test';
import { withDb } from './db';
import { APP_URL } from './env';

/**
 * The UI tests' platform operator (platform_operators: IronGate platform support, not a company
 * user). ensureOperator creates it on the local test database (or resets its password, lockout and
 * active flag), so every test can sign in at /operator.
 */
export const OPERATOR = { email: 'operator@platform-support.uitest.example', password: 'Ui-Operator-Passw0rd!', name: 'UI Test Operator' };

let hash: string | null = null;
export async function ensureOperator(): Promise<void> {
  hash ??= await bcrypt.hash(OPERATOR.password, 4);
  await withDb(async (c) => {
    const updated = await c.query(
      `UPDATE platform_operators SET password_hash = $2, name = $3, is_active = TRUE, failed_login_attempts = 0, locked_until = NULL WHERE LOWER(email) = LOWER($1)`,
      [OPERATOR.email, hash, OPERATOR.name]);
    if (!updated.rowCount) {
      await c.query(`INSERT INTO platform_operators (email, name, password_hash) VALUES ($1, $3, $2) ON CONFLICT DO NOTHING`, [OPERATOR.email, hash, OPERATOR.name]);
    }
  });
}

/** Open /operator and sign in as the test operator; the platform overview is shown. */
export async function operatorSignIn(page: Page): Promise<void> {
  await ensureOperator();
  await page.goto(`${APP_URL}/operator`);
  await page.getByTestId('operator-email').fill(OPERATOR.email);
  await page.getByTestId('operator-password').fill(OPERATOR.password);
  await page.getByTestId('operator-enter').click();
  await expect(page.getByTestId('operator-overview')).toBeVisible({ timeout: 30000 });
}
