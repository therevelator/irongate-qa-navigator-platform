import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'l3v75th5n',
  database: 'irongate_qa',
};

describe('Database Schema Validation', () => {
  let connection: mysql.Connection;

  beforeAll(async () => {
    connection = await mysql.createConnection(DB_CONFIG);
  });

  afterAll(async () => {
    await connection.end();
  });

  describe('Users Table', () => {
    it('DB-SCHEMA-001: should have correct structure', async () => {
      const [rows] = await connection.query('DESCRIBE users');
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
      const [rows] = await connection.query('DESCRIBE teams');
      const fields = rows as any[];

      const fieldNames = fields.map((f: any) => f.Field);

      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('company_id');
      expect(fieldNames).toContain('department_id');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('platform');
      expect(fieldNames).toContain('is_active');
    });
  });

  describe('Foreign Keys', () => {
    it('DB-SCHEMA-004: should have foreign key constraints on users table', async () => {
      const [rows] = await connection.query(`
        SELECT 
          CONSTRAINT_NAME,
          COLUMN_NAME,
          REFERENCED_TABLE_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_NAME = 'users' 
          AND TABLE_SCHEMA = 'irongate_qa'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      const constraints = rows as any[];
      const refTables = constraints.map((c: any) => c.REFERENCED_TABLE_NAME);

      expect(refTables).toContain('companies');
      expect(refTables).toContain('departments');
      expect(refTables).toContain('teams');
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
      const [rows] = await connection.query('SHOW INDEXES FROM users');
      const indexes = rows as any[];

      const indexNames = indexes.map((i: any) => i.Key_name);

      expect(indexNames).toContain('PRIMARY');
      expect(indexNames).toContain('email'); // Unique index
    });
  });
});
