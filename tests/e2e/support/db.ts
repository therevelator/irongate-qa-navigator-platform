import { Client } from 'pg';
import { assertLocal } from './env';

/**
 * The LOCAL test database (DATABASE_URL). Refuses any host but localhost / 127.0.0.1, so a hosted
 * database is never touched, and refuses to run in remote mode.
 */
export function databaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set: run the suite through npm run test:ui:local (or set it to the local test database).');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Refusing non-local database host ${url.hostname}`);
  return raw;
}

export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  assertLocal('Database access');
  const url = new URL(databaseUrl());
  const client = new Client({
    host: url.hostname, port: parseInt(url.port || '5432', 10), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const sql = async <R = any>(text: string, params: unknown[] = []): Promise<R[]> =>
  withDb(async (c) => (await c.query(text, params)).rows as R[]);
