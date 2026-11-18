import type { Config } from '@netlify/functions';
import { pool } from '../../src/lib/db';

/**
 * Database keep-alive (Netlify Scheduled Function, 06:00 and 18:00 UTC): one `SELECT 1`, so a
 * free-tier database that pauses when idle stays awake. Logs only ok / failed and the duration;
 * never the connection string or any other secret.
 */
export default async () => {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    console.log(`[db-keepalive] ok in ${Date.now() - started} ms`);
    return new Response('ok');
  } catch (e: any) {
    console.error(`[db-keepalive] failed after ${Date.now() - started} ms (${e?.code ?? 'error'})`);
    return new Response('failed', { status: 500 });
  }
};

export const config: Config = { schedule: '0 6,18 * * *' };
