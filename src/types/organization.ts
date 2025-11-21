/**
 * Organizational Hierarchy Types
 * IronGate QA Navigator - Multi-tenant Organization Management
 */

export interface Company {
  id: string;
  name: string;
  domain: string; // e.g., "mastercard.com"
  logo?: string;
  createdAt: string;
  isActive: boolean;
  settings: {
    allowSelfRegistration: boolean;
    requireEmailVerification: boolean;
    allowedDomains: string[]; // Email domains allowed to register
  };
}

export interface Department {
  id: string;
  companyId: string;
  name: string; // e.g., "Decision Management"
  description?: string;
  managerId?: string; // User ID of department manager
  createdAt: string;
  isActive: boolean;
}

export interface Team {
  id: string;
  departmentId: string;
  companyId: string;
  name: string; // e.g., "Quasars", "Pulsars", "Watchmen"
  description?: string;
  platform: 'Web' | 'Mobile' | 'API' | 'Backend' | 'Payment' | 'Security' | 'DevOps';
  leadId?: string; // User ID of team lead
  members: string[]; // User IDs
  createdAt: string;
  isActive: boolean;
}

export interface OrganizationHierarchy {
  company: Company;
  departments: Department[];
  teams: Team[];
}

// Helper type for registration
export interface RegistrationContext {
  companyId: string;
  departmentId: string;
  teamId: string;
}

// For displaying in UI
export interface DepartmentWithTeams extends Department {
  teams: Team[];
}

export interface CompanyWithStructure extends Company {
  departments: DepartmentWithTeams[];
}
