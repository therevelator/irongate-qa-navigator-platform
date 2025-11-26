import mysql from 'mysql2/promise';

// Parse DATABASE_URL or use individual env vars
function getDatabaseConfig() {
  // If DATABASE_URL is set (Netlify/production), parse it
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port || '3306'),
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1), // Remove leading slash
      ssl: url.searchParams.get('ssl-mode') === 'REQUIRED' ? { rejectUnauthorized: false } : undefined
    };
  }
  
  // Otherwise use individual env vars (local development)
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
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
  password: dbConfig.password ? '***' + dbConfig.password.slice(-3) : 'EMPTY',
  database: dbConfig.database,
  ssl: dbConfig.ssl ? 'enabled' : 'disabled'
});

// Create connection pool
export const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4'
});

// Test connection
export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// Helper function for queries
export async function query<T>(sql: string, params?: any[]): Promise<T> {
  const [rows] = await pool.execute(sql, params);
  return rows as T;
}

// Helper function for single row
export async function queryOne<T>(sql: string, params?: any[]): Promise<T | null> {
  const [rows] = await pool.execute(sql, params);
  const result = rows as T[];
  return result.length > 0 ? result[0] : null;
}

// Transaction helper
export async function transaction<T>(
  callback: (connection: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  
  try {
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
