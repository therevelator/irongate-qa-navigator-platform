/**
 * Mock Organization Data
 * IronGate QA Navigator - Sample organizational hierarchy
 */

import type { Company, Department, Team } from '../types/organization';

// Mock Company
export const mockCompany: Company = {
  id: 'novatech',
  name: 'NovaTech',
  domain: 'novatech.io',
  logo: '/novatech-logo.png',
  createdAt: '2024-01-01T00:00:00Z',
  isActive: true,
  settings: {
    allowSelfRegistration: true,
    requireEmailVerification: true,
    allowedDomains: ['novatech.io', 'novatech.com'],
  },
};

// Mock Departments
export const mockDepartments: Department[] = [
  {
    id: 'dept-decision-mgmt',
    companyId: 'novatech',
    name: 'Decision Management',
    description: 'AI-powered decision management and fraud detection',
    managerId: 'user-dept-manager-1',
    createdAt: '2024-01-15T00:00:00Z',
    isActive: true,
  },
  {
    id: 'dept-payments',
    companyId: 'novatech',
    name: 'Payments Processing',
    description: 'Core payment processing and transaction management',
    managerId: 'user-dept-manager-2',
    createdAt: '2024-01-15T00:00:00Z',
    isActive: true,
  },
  {
    id: 'dept-security',
    companyId: 'novatech',
    name: 'Security & Compliance',
    description: 'Security, fraud prevention, and regulatory compliance',
    managerId: 'user-dept-manager-3',
    createdAt: '2024-01-15T00:00:00Z',
    isActive: true,
  },
  {
    id: 'dept-digital',
    companyId: 'novatech',
    name: 'Digital Products',
    description: 'Mobile apps, web portals, and digital experiences',
    managerId: 'user-dept-manager-4',
    createdAt: '2024-01-15T00:00:00Z',
    isActive: true,
  },
];

// Mock Teams - Decision Management Department
export const mockTeamsDecisionMgmt: Team[] = [
  {
    id: 'team-quasars',
    departmentId: 'dept-decision-mgmt',
    companyId: 'novatech',
    name: 'Quasars',
    description: 'AI/ML decision engine development',
    platform: 'Backend',
    leadId: 'user-lead-quasars',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-pulsars',
    departmentId: 'dept-decision-mgmt',
    companyId: 'novatech',
    name: 'Pulsars',
    description: 'Real-time decision processing',
    platform: 'API',
    leadId: 'user-lead-pulsars',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-watchmen',
    departmentId: 'dept-decision-mgmt',
    companyId: 'novatech',
    name: 'Watchmen',
    description: 'Monitoring and alerting systems',
    platform: 'DevOps',
    leadId: 'user-lead-watchmen',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-astronauts',
    departmentId: 'dept-decision-mgmt',
    companyId: 'novatech',
    name: 'Astronauts',
    description: 'Exploration and innovation team',
    platform: 'Web',
    leadId: 'user-lead-astronauts',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-black-comb',
    departmentId: 'dept-decision-mgmt',
    companyId: 'novatech',
    name: 'Black Comb',
    description: 'Data analytics and insights',
    platform: 'Backend',
    leadId: 'user-lead-black-comb',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-grid',
    departmentId: 'dept-decision-mgmt',
    companyId: 'novatech',
    name: 'Grid Team',
    description: 'Infrastructure and platform services',
    platform: 'DevOps',
    leadId: 'user-lead-grid',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
];

// Mock Teams - Payments Department
export const mockTeamsPayments: Team[] = [
  {
    id: 'team-payment-core',
    departmentId: 'dept-payments',
    companyId: 'novatech',
    name: 'Payment Core',
    description: 'Core payment processing engine',
    platform: 'Backend',
    leadId: 'user-lead-payment-core',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-settlement',
    departmentId: 'dept-payments',
    companyId: 'novatech',
    name: 'Settlement',
    description: 'Transaction settlement and reconciliation',
    platform: 'Backend',
    leadId: 'user-lead-settlement',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-gateway',
    departmentId: 'dept-payments',
    companyId: 'novatech',
    name: 'Gateway',
    description: 'Payment gateway and API services',
    platform: 'API',
    leadId: 'user-lead-gateway',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
];

// Mock Teams - Security Department
export const mockTeamsSecurity: Team[] = [
  {
    id: 'team-fraud-detection',
    departmentId: 'dept-security',
    companyId: 'novatech',
    name: 'Fraud Detection',
    description: 'Real-time fraud detection and prevention',
    platform: 'Backend',
    leadId: 'user-lead-fraud',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-compliance',
    departmentId: 'dept-security',
    companyId: 'novatech',
    name: 'Compliance',
    description: 'Regulatory compliance and auditing',
    platform: 'Security',
    leadId: 'user-lead-compliance',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
];

// Mock Teams - Digital Products Department
export const mockTeamsDigital: Team[] = [
  {
    id: 'team-mobile-ios',
    departmentId: 'dept-digital',
    companyId: 'novatech',
    name: 'Mobile iOS',
    description: 'iOS mobile application development',
    platform: 'Mobile',
    leadId: 'user-lead-ios',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-mobile-android',
    departmentId: 'dept-digital',
    companyId: 'novatech',
    name: 'Mobile Android',
    description: 'Android mobile application development',
    platform: 'Mobile',
    leadId: 'user-lead-android',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'team-web-portal',
    departmentId: 'dept-digital',
    companyId: 'novatech',
    name: 'Web Portal',
    description: 'Customer-facing web portal',
    platform: 'Web',
    leadId: 'user-lead-web',
    members: [],
    createdAt: '2024-02-01T00:00:00Z',
    isActive: true,
  },
];

// Combine all teams
export const mockTeams: Team[] = [
  ...mockTeamsDecisionMgmt,
  ...mockTeamsPayments,
  ...mockTeamsSecurity,
  ...mockTeamsDigital,
];

// Helper function to get teams by department
export const getTeamsByDepartment = (departmentId: string): Team[] => {
  return mockTeams.filter(team => team.departmentId === departmentId);
};

// Helper function to get department by ID
export const getDepartmentById = (departmentId: string): Department | undefined => {
  return mockDepartments.find(dept => dept.id === departmentId);
};

// Helper function to get team by ID
export const getTeamById = (teamId: string): Team | undefined => {
  return mockTeams.find(team => team.id === teamId);
};
