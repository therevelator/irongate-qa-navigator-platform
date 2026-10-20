import { Client } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'irongate_qa',
};

describe('Database Schema Validation', () => {
  let client: Client;

  // Same shape as mysql2's connection.query(): [rows]
  const connection = {
    query: async (sql: string) => [(await client.query(sql)).rows] as const,
  };

  // Postgres equivalent of MySQL's DESCRIBE <table>
  const describe_ = (table: string) =>
    connection.query(`SELECT column_name AS "Field" FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`);

  beforeAll(async () => {
    client = new Client(DB_CONFIG);
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  describe('Users Table', () => {
    it('DB-SCHEMA-001: should have correct structure', async () => {
      const [rows] = await describe_('users');
      const fields = rows as any[];

      const fieldNames = fields.map((f: any) => f.Field);

      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('password_hash');
      expect(fieldNames).toContain('first_name');
      expect(fieldNames).toContain('last_name');
      expect(fieldNames).toContain('role');
      expect(fieldNames).toContain('company_id');
      expect(fieldNames).toContain('department_id');
      expect(fieldNames).toContain('primary_team_id');
      expect(fieldNames).toContain('is_active');
      expect(fieldNames).toContain('created_at');
    });

    it('DB-SCHEMA-007: should enforce unique email constraint', async () => {
      const [rows] = await connection.query(`
        SELECT COUNT(*) as count 
        FROM users 
        GROUP BY email 
        HAVING COUNT(*) > 1
      `);

      expect((rows as any[]).length).toBe(0);
    });

    it('DB-SCHEMA-019: should have bcrypt password hashes', async () => {
      const [rows] = await connection.query(`
        SELECT password_hash 
        FROM users 
        LIMIT 5
      `);

      const hashes = rows as any[];
      hashes.forEach((row) => {
        expect(row.password_hash).toMatch(/^\$2[aby]\$/); // bcrypt format
        expect(row.password_hash.length).toBeGreaterThanOrEqual(60);
      });
    });
  });

  describe('Teams Table', () => {
    it('DB-SCHEMA-002: should have correct structure', async () => {
      const [rows] = await describe_('teams');
      const fields = rows as any[];

      const fieldNames = fields.map((f: any) => f.Field);

      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('company_id');
      expect(fieldNames).toContain('department_id');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('is_active');
    });
  });

  describe('Foreign Keys', () => {
    it('DB-SCHEMA-004: should have foreign key constraints on teams table', async () => {
      // The teams table has FK constraints to companies, departments, and users (lead_id)
      // The users table intentionally has no FK constraints for flexible user creation
      const [rows] = await connection.query(`
        SELECT 
          conname AS "CONSTRAINT_NAME",
          confrelid::regclass::text AS "REFERENCED_TABLE_NAME"
        FROM pg_constraint
        WHERE conrelid = 'public.teams'::regclass
          AND contype = 'f'
      `);

      const constraints = rows as any[];
      const refTables = constraints.map((c: any) => c.REFERENCED_TABLE_NAME);

      expect(refTables).toContain('companies');
      expect(refTables).toContain('departments');
    });
  });

  describe('Data Integrity', () => {
    it('DB-SCHEMA-020: should have no orphaned users', async () => {
      const [rows] = await connection.query(`
        SELECT u.id, u.email 
        FROM users u
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE c.id IS NULL
      `);

      expect((rows as any[]).length).toBe(0);
    });

    it('should have no orphaned team_members', async () => {
      const [rows] = await connection.query(`
        SELECT tm.* 
        FROM team_members tm
        LEFT JOIN users u ON tm.user_id = u.id
        WHERE u.id IS NULL
      `);

      expect((rows as any[]).length).toBe(0);
    });
  });

  describe('Indexes', () => {
    it('DB-SCHEMA-008: should have proper indexes on users table', async () => {
      const [rows] = await connection.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users'`);
      const indexes = rows as any[];

      const indexNames = indexes.map((i: any) => i.indexname);

      expect(indexNames).toContain('users_pkey');
      expect(indexNames).toContain('users_email'); // Unique index
    });
  });
});
