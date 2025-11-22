import request from 'supertest';

const API_URL = 'http://localhost:3000';
const SUPER_ADMIN_EMAIL = 'admin@irongate.com';
const SUPER_ADMIN_PASSWORD = 'demo123';

describe('Admin API Endpoints', () => {
  let superAdminToken: string;
  let qaManagerToken: string;
  let teamLeadToken: string;

  beforeAll(async () => {
    // Login as super admin
    const adminRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD });
    
    if (!adminRes.body.token) {
      console.error('Super admin login failed:', adminRes.body);
      throw new Error('Failed to get super admin token');
    }
    superAdminToken = adminRes.body.token;

    // Login as QA manager
    const managerRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ email: 'manager@irongate.com', password: 'demo123' });
    
    if (!managerRes.body.token) {
      console.error('QA Manager login failed:', managerRes.body);
      throw new Error('Failed to get QA manager token');
    }
    qaManagerToken = managerRes.body.token;

    // Login as team lead
    const leadRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ email: 'lead@irongate.com', password: 'demo123' });
    
    if (!leadRes.body.token) {
      console.error('Team lead login failed:', leadRes.body);
      throw new Error('Failed to get team lead token');
    }
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
        teamId: 'team-quasars',
        departmentId: 'dept-decision-mgmt',
      };

      const response = await request(API_URL)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(newUser);

      if (response.status !== 201) {
        console.error('Create user failed:', response.status, response.body);
      }
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

      if (response.status !== 200) {
        console.error('QA Manager get users failed:', response.status, response.body);
      }
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

    it('API-ADMIN-016: should return team_lead, qa_engineer, viewer for QA Manager', async () => {
      const response = await request(API_URL)
        .get('/api/admin/available-roles')
        .set('Authorization', `Bearer ${qaManagerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.availableRoles).toContain('team_lead');
      expect(response.body.availableRoles).toContain('qa_engineer');
      expect(response.body.availableRoles).toContain('viewer');
      expect(response.body.availableRoles.length).toBe(3);
    });

    it('API-ADMIN-017: should return qa_engineer and viewer for Team Lead', async () => {
      const response = await request(API_URL)
        .get('/api/admin/available-roles')
        .set('Authorization', `Bearer ${teamLeadToken}`);

      expect(response.status).toBe(200);
      expect(response.body.availableRoles).toContain('qa_engineer');
      expect(response.body.availableRoles).toContain('viewer');
      expect(response.body.availableRoles.length).toBe(2);
    });
  });

  describe('POST /api/admin/teams', () => {
    it('API-ADMIN-018: Super Admin should create team', async () => {
      const timestamp = Date.now();
      const newTeam = {
        name: `Test Team ${timestamp}`,
        description: 'Test team description',
        platform: 'Web',
      };

      const response = await request(API_URL)
        .post('/api/admin/teams')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(newTeam);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(newTeam.name);
    });

    it('API-ADMIN-019: QA Manager should create team in their department', async () => {
      const timestamp = Date.now();
      const newTeam = {
        name: `QA Manager Team ${timestamp}`,
        description: 'Team created by QA Manager',
        platform: 'API',
      };

      const response = await request(API_URL)
        .post('/api/admin/teams')
        .set('Authorization', `Bearer ${qaManagerToken}`)
        .send(newTeam);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
    });

    it('API-ADMIN-020: Team Lead should NOT be able to create team', async () => {
      const response = await request(API_URL)
        .post('/api/admin/teams')
        .set('Authorization', `Bearer ${teamLeadToken}`)
        .send({
          name: 'Unauthorized Team',
          platform: 'Web',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/admin/teams/:id', () => {
    it('API-ADMIN-021: should fail to delete team with members', async () => {
      // team-quasars has members
      const response = await request(API_URL)
        .delete('/api/admin/teams/team-quasars')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Cannot delete team with members');
      expect(response.body.warning).toBeDefined();
    });
  });

  describe('DELETE /api/admin/users/:id', () => {
    let createdUserId: string;

    beforeAll(async () => {
      // Create a test user to delete
      const timestamp = Date.now();
      const response = await request(API_URL)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          email: `delete-test-${timestamp}@irongate.com`,
          password: 'TestPass123!',
          firstName: 'Delete',
          lastName: 'Test',
          role: 'qa_engineer',
          teamId: 'team-quasars',
          departmentId: 'dept-decision-mgmt',
        });
      
      createdUserId = response.body.id;
    });

    it('API-ADMIN-022: Super Admin should delete user', async () => {
      const response = await request(API_URL)
        .delete(`/api/admin/users/${createdUserId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted successfully');
    });

    it('API-ADMIN-023: Super Admin should NOT delete themselves', async () => {
      // Get super admin user ID
      const usersResponse = await request(API_URL)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${superAdminToken}`);
      
      const superAdmin = usersResponse.body.find((u: any) => u.email === 'admin@irongate.com');

      const response = await request(API_URL)
        .delete(`/api/admin/users/${superAdmin.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot delete your own account');
    });

    it('API-ADMIN-024: QA Engineer should NOT delete users', async () => {
      // Login as QA Engineer
      const engineerRes = await request(API_URL)
        .post('/api/auth/login')
        .send({ email: 'engineer@irongate.com', password: 'demo123' });

      const response = await request(API_URL)
        .delete('/api/admin/users/user-admin')
        .set('Authorization', `Bearer ${engineerRes.body.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Insufficient permissions');
    });
  });
});
