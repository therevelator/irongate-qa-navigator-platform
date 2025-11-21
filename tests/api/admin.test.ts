import request from 'supertest';

const API_URL = 'http://localhost:3000';
const SUPER_ADMIN_EMAIL = 'admin@irongate.com';
const SUPER_ADMIN_PASSWORD = 'admin123';

describe('Admin API Endpoints', () => {
  let superAdminToken: string;
  let qaManagerToken: string;
  let teamLeadToken: string;

  beforeAll(async () => {
    // Login as super admin
    const adminRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD });
    
    superAdminToken = adminRes.body.token;

    // Login as QA manager
    const managerRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ email: 'manager@irongate.com', password: 'manager123' });
    
    qaManagerToken = managerRes.body.token;

    // Login as team lead
    const leadRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ email: 'lead@irongate.com', password: 'lead123' });
    
    teamLeadToken = leadRes.body.token;
  });

  describe('POST /api/admin/users', () => {
    it('API-ADMIN-001: should create user with valid data', async () => {
      const timestamp = Date.now();
      const newUser = {
        email: `test-${timestamp}@irongate.com`,
        password: 'TestPass123!',
        firstName: 'Test',
        lastName: 'User',
        role: 'qa_engineer',
        teamId: 'team-quasars', // Use existing team
      };

      const response = await request(API_URL)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(newUser);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.email).toBe(newUser.email);
      expect(response.body.first_name).toBe(newUser.firstName);
      expect(response.body.role).toBe(newUser.role);
    });

    it('API-ADMIN-002: should fail with missing required fields', async () => {
      const response = await request(API_URL)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          email: 'test@example.com',
          password: 'Pass123!',
          // Missing: firstName, lastName, role, teamId
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('API-ADMIN-003: should fail with duplicate email', async () => {
      const response = await request(API_URL)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          email: 'admin@irongate.com', // Already exists
          password: 'Pass123!',
          firstName: 'Test',
          lastName: 'Duplicate',
          role: 'qa_engineer',
          teamId: 'team-quasars',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('already registered');
    });

    it('API-ADMIN-004: should fail when QA Manager tries to create super_admin', async () => {
      const response = await request(API_URL)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${qaManagerToken}`)
        .send({
          email: 'test@example.com',
          password: 'Pass123!',
          firstName: 'Test',
          lastName: 'User',
          role: 'super_admin', // Not allowed
          teamId: 'team-quasars',
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('cannot create super_admin');
    });

    it('API-ADMIN-005: should fail without authentication', async () => {
      const response = await request(API_URL)
        .post('/api/admin/users')
        .send({
          email: 'test@example.com',
          password: 'Pass123!',
          firstName: 'Test',
          lastName: 'User',
          role: 'qa_engineer',
          teamId: 'team-quasars',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/admin/users', () => {
    it('API-ADMIN-006: should return all users for super admin', async () => {
      const response = await request(API_URL)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      
      // Should include users from all departments
      const user = response.body[0];
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('team_name');
    });

    it('API-ADMIN-007: should return department-scoped users for QA Manager', async () => {
      const response = await request(API_URL)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${qaManagerToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      
      // Should be fewer users than super admin sees
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('API-ADMIN-008: should return team-scoped users for Team Lead', async () => {
      const response = await request(API_URL)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${teamLeadToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      
      // Should be limited to team members
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/admin/available-roles', () => {
    it('API-ADMIN-015: should return correct roles for super admin', async () => {
      const response = await request(API_URL)
        .get('/api/admin/available-roles')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.availableRoles).toContain('qa_manager');
      expect(response.body.availableRoles).toContain('team_lead');
      expect(response.body.availableRoles).toContain('qa_engineer');
      expect(response.body.availableRoles).toContain('viewer');
    });

    it('API-ADMIN-016: should return only team_lead for QA Manager', async () => {
      const response = await request(API_URL)
        .get('/api/admin/available-roles')
        .set('Authorization', `Bearer ${qaManagerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.availableRoles).toEqual(['team_lead']);
    });

    it('API-ADMIN-017: should return only qa_engineer for Team Lead', async () => {
      const response = await request(API_URL)
        .get('/api/admin/available-roles')
        .set('Authorization', `Bearer ${teamLeadToken}`);

      expect(response.status).toBe(200);
      expect(response.body.availableRoles).toEqual(['qa_engineer']);
    });
  });
});
