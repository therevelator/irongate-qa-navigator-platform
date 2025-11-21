/**
 * Test user credentials
 * These users exist in the database (from seed_demo_users.sql)
 */

export const TEST_USERS = {
  SUPER_ADMIN: {
    email: 'admin@irongate.com',
    password: 'demo123',
    firstName: 'Admin',
    lastName: 'User',
    role: 'super_admin',
  },
  QA_MANAGER: {
    email: 'manager@irongate.com',
    password: 'demo123',
    firstName: 'QA',
    lastName: 'Manager',
    role: 'qa_manager',
  },
  TEAM_LEAD: {
    email: 'lead@irongate.com',
    password: 'demo123',
    firstName: 'Team',
    lastName: 'Lead',
    role: 'team_lead',
  },
  QA_ENGINEER: {
    email: 'engineer@irongate.com',
    password: 'demo123',
    firstName: 'QA',
    lastName: 'Engineer',
    role: 'qa_engineer',
  },
  VIEWER: {
    email: 'viewer@irongate.com',
    password: 'demo123',
    firstName: 'View',
    lastName: 'Only',
    role: 'viewer',
  },
} as const;

export const API_BASE_URL = 'http://localhost:3000/api';
export const APP_BASE_URL = 'http://localhost:5173';
