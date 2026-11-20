import { query } from '../../src/lib/db';

/**
 * Company sign-in lockout (users.failed_login_attempts, users.locked_until; both in the initial schema).
 *
 *   - Each wrong password adds one to failed_login_attempts. The fifth in a row (LOCKOUT_THRESHOLD)
 *     locks the account for LOCKOUT_MINUTES.
 *   - While locked, every attempt, even with the right password, gets the same "Invalid credentials"
 *     answer as a wrong password (no account enumeration) and still adds one to the count. It does not
 *     extend the lock; but the count stays at 5 or more, so the first wrong password after the lock
 *     ends locks it again.
 *   - A successful sign-in, a reset link, a password set by an admin and the platform operator's
 *     Clear lockout set failed_login_attempts to 0 and locked_until to NULL.
 *
 * The comparisons use the database clock (now()), as the sign-in query does.
 */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;

/** A wrong password: count it; lock the account when the count reaches the threshold. */
export async function recordFailedPassword(userId: string): Promise<void> {
  await query(
    `UPDATE users
        SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
            locked_until = CASE WHEN COALESCE(failed_login_attempts, 0) + 1 >= ?
                                THEN now() + make_interval(mins => ?) ELSE locked_until END
      WHERE id = ?`,
    [LOCKOUT_THRESHOLD, LOCKOUT_MINUTES, userId],
  );
}

/** An attempt on a locked account (whatever the password): counted, the lock is not extended. */
export async function recordLockedAttempt(userId: string): Promise<void> {
  await query('UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1 WHERE id = ?', [userId]);
}
