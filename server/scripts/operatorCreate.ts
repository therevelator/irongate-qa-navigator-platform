/**
 * npm run operator:create -- --email you@example.com --name "Your Name" [--password ...] [--allow-remote]
 *
 * Creates (or updates: new name and password, active again, lockout cleared) a platform operator:
 * IronGate platform support, signed in at /operator, not a user of any company. The password is
 * read from --password, else OPERATOR_PASSWORD, else asked for (not echoed). At least 12 characters.
 * The hash is bcrypt, cost 12 ($2b$12$…). Refuses an e-mail of a company user.
 *
 * Uses DATABASE_URL (or the DB_* settings). Only localhost / 127.0.0.1 unless --allow-remote.
 */
import 'dotenv/config';
import readline from 'readline';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WriteStream };
    let asked = false;
    out._writeToOutput = (s: string) => { if (!asked) { process.stdout.write(s); asked = true; } };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const email = arg('--email');
  const name = arg('--name');
  if (!email || !name) {
    console.error('Usage: npm run operator:create -- --email you@example.com --name "Your Name" [--password ...]');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  const host = url ? new URL(url).hostname : (process.env.DB_HOST || 'localhost');
  if (!['localhost', '127.0.0.1'].includes(host) && !process.argv.includes('--allow-remote')) {
    console.error(`Refusing database host ${host} (add --allow-remote to write to it).`);
    process.exit(2);
  }
  let password = arg('--password') ?? process.env.OPERATOR_PASSWORD;
  if (!password) {
    password = await askHidden('Password (12+ characters): ');
    const again = await askHidden('Repeat the password: ');
    if (password !== again) { console.error('The passwords do not match.'); process.exit(1); }
  }
  const { upsertOperator } = await import('../lib/operator');
  const { pool } = await import('../../src/lib/db');
  try {
    const r = await upsertOperator(email, name, password);
    console.log(`${r.created ? 'Created' : 'Updated'} platform operator ${email.trim().toLowerCase()} (${r.id}). Sign in at /operator.`);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
