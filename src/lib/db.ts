import pg from 'pg';

const { Pool, types } = pg;

// COUNT(*) and SUM(int) come back as int8; return numbers instead of strings.
// NUMERIC/DECIMAL stays a string, the same as mysql2 returned it.
types.setTypeParser(types.builtins.INT8, (value: string) => parseInt(value, 10));

// Parse DATABASE_URL or use individual env vars
function getDatabaseConfig(): pg.PoolConfig {
  // If DATABASE_URL is set (Netlify/production), parse it.
  // For Supabase use the pooler connection string (Project Settings → Database → Connection pooling).
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    const sslMode = url.searchParams.get('sslmode');
    const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
    return {
      host: url.hostname,
      port: parseInt(url.port || '5432'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) || 'postgres', // Remove leading slash
      ssl: sslMode === 'disable' || (isLocal && !sslMode) ? undefined : { rejectUnauthorized: false }
    };
  }

  // Otherwise use individual env vars (local development)
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'irongate_qa'
  };
}

const dbConfig = getDatabaseConfig();

// Debug: Log connection config (remove in production)
console.log('🔍 Database config:', {
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: typeof dbConfig.password === 'string' && dbConfig.password ? '***' + dbConfig.password.slice(-3) : 'EMPTY',
  database: dbConfig.database,
  ssl: dbConfig.ssl ? 'enabled' : 'disabled'
});

// Create connection pool. Keep it small on serverless (each function instance has its own pool).
export const pool = new Pool({
  ...dbConfig,
  max: parseInt(process.env.DB_POOL_MAX || (process.env.NETLIFY ? '3' : '10')),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

pool.on('error', (error) => {
  console.error('❌ Idle database client error:', error);
});

// Queries are written with MySQL-style "?" placeholders; Postgres expects $1, $2, ...
// Skips "?" inside quoted strings/identifiers so literals are left untouched.
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

// Test connection
export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

const INTEGER_INPUT_ERROR = /^invalid input syntax for type (?:integer|smallint|bigint): "(-?\d+\.\d+)"$/;

// MySQL rounds fractional values written to INTEGER columns (half away from zero);
// Postgres rejects them. Postgres refuses the value before running the statement, so on
// that error round the offending parameter(s) the MySQL way and retry.
async function run(sql: string, params?: any[]): Promise<pg.QueryResult> {
  const text = toPgPlaceholders(sql);
  let values = params;
  for (;;) {
    try {
      return await pool.query(text, values);
    } catch (error: any) {
      const match = error?.code === '22P02' && INTEGER_INPUT_ERROR.exec(error.message);
      if (!match || !values) throw error;
      let changed = false;
      values = values.map(value => {
        if ((typeof value === 'number' || typeof value === 'string') && String(value) === match[1]) {
          changed = true;
          const n = Number(value);
          return Math.sign(n) * Math.round(Math.abs(n));
        }
        return value;
      });
      if (!changed) throw error;
    }
  }
}

// Helper function for queries
export async function query<T>(sql: string, params?: any[]): Promise<T> {
  const result = await run(sql, params);
  return result.rows as T;
}

// Helper function for single row
export async function queryOne<T>(sql: string, params?: any[]): Promise<T | null> {
  const result = await run(sql, params);
  return result.rows.length > 0 ? (result.rows[0] as T) : null;
}

// Transaction helper
export async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  await client.query('BEGIN');

  try {
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
