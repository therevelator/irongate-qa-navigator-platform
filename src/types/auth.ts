/**
 * Authentication & Authorization Types
 * IronGate QA Navigator - Full RBAC System
 */

export type UserRole = 'super_admin' | 'qa_manager' | 'team_lead' | 'qa_engineer' | 'viewer';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  
  // Organizational context
  companyId: string;
  departmentId: string;
  primaryTeamId: string; // User's main team
  assignedTeams: string[]; // All team IDs user has access to (for cross-team roles)
  
  avatar?: string;
  createdAt: string;
  lastLogin?: string;
  isActive: boolean;
  emailVerified: boolean;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole; // Only admins can set role during registration
  
  // Organizational assignment - all created dynamically during registration
  companyName: string; // Company name - will create/find company with unique ID
  departmentName: string; // Department name - will be created and tied to company
  teamName: string; // Team name - will be created and tied to department
}

export interface Permission {
  feature: string;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
}

// Role Permissions Configuration
export const ROLE_PERMISSIONS: Record<UserRole, {
  name: string;
  description: string;
  level: number;
  permissions: {
    viewAllTeams: boolean;
    manageTeams: boolean;
    manageUsers: boolean;
    accessAdvancedFeatures: boolean;
    accessBusinessAnalytics: boolean;
    configureIntegrations: boolean;
    viewAuditLogs: boolean;
    exportData: boolean;
    manageBilling: boolean;
  };
  features: {
    dashboard: 'all' | 'assigned' | 'own';
    flakyTests: boolean;
    technicalDebt: boolean;
    pipeline: boolean;
    businessImpact: boolean;
    performance: boolean;
    developerProductivity: boolean;
    executionTimeline: boolean;
    gamification: boolean;
  };
}> = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full system control',
    level: 5,
    permissions: {
      viewAllTeams: true,
      manageTeams: true,
      manageUsers: true,
      accessAdvancedFeatures: true,
      accessBusinessAnalytics: true,
      configureIntegrations: true,
      viewAuditLogs: true,
      exportData: true,
      manageBilling: true,
    },
    features: {
      dashboard: 'all',
      flakyTests: true,
      technicalDebt: true,
      pipeline: true,
      businessImpact: true,
      performance: true,
      developerProductivity: true,
      executionTimeline: true,
      gamification: true,
    },
  },
  qa_manager: {
    name: 'QA Manager',
    description: 'Organization-wide QA oversight',
    level: 4,
    permissions: {
      viewAllTeams: true,
      manageTeams: true,
      manageUsers: true, // Can manage QA roles only
      accessAdvancedFeatures: true,
      accessBusinessAnalytics: true,
      configureIntegrations: false,
      viewAuditLogs: true,
      exportData: true,
      manageBilling: false,
    },
    features: {
      dashboard: 'all',
      flakyTests: true,
      technicalDebt: true,
      pipeline: true,
      businessImpact: true,
      performance: true,
      developerProductivity: true,
      executionTimeline: true,
      gamification: true,
    },
  },
  team_lead: {
    name: 'Team Lead',
    description: 'Own team + limited cross-team visibility',
    level: 3,
    permissions: {
      viewAllTeams: true, // Can view all teams on dashboard
      manageTeams: false, // Can only edit own team
      manageUsers: true, // Can manage own team members only
      accessAdvancedFeatures: true,
      accessBusinessAnalytics: true, // Can access analytics panel
      configureIntegrations: false,
      viewAuditLogs: false,
      exportData: true, // Own team only
      manageBilling: false,
    },
    features: {
      dashboard: 'all',  // Can view all teams and departments
      flakyTests: true,
      technicalDebt: true,
      pipeline: true,
      businessImpact: true, // Can access analytics
      performance: true,
      developerProductivity: true, // Only for own team (handled in component)
      executionTimeline: true,
      gamification: true,
    },
  },
  qa_engineer: {
    name: 'QA Engineer',
    description: 'Own team only',
    level: 2,
    permissions: {
      viewAllTeams: true,  // Allow viewing all teams
      manageTeams: false,
      manageUsers: false,
      accessAdvancedFeatures: true, // Limited features
      accessBusinessAnalytics: false,
      configureIntegrations: false,
      viewAuditLogs: false,
      exportData: false,
      manageBilling: false,
    },
    features: {
      dashboard: 'all',  // Allow viewing all teams and departments
      flakyTests: true,
      technicalDebt: true,
      pipeline: true,
      businessImpact: false,
      performance: true,
      developerProductivity: false,
      executionTimeline: true,
      gamification: true, // View only
    },
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access',
    level: 1,
    permissions: {
      viewAllTeams: true,  // Allow viewing all teams
      manageTeams: false,
      manageUsers: false,
      accessAdvancedFeatures: false,
      accessBusinessAnalytics: false,
      configureIntegrations: false,
      viewAuditLogs: false,
      exportData: false,
      manageBilling: false,
    },
    features: {
      dashboard: 'all',  // Allow viewing all teams and departments
      flakyTests: false,
      technicalDebt: false,
      pipeline: false,
      businessImpact: false,
      performance: false,
      developerProductivity: false,
      executionTimeline: false,
      gamification: true, // View only
    },
  },
};

// Helper function to check if user has permission
export const hasPermission = (user: User | null, permission: keyof typeof ROLE_PERMISSIONS['super_admin']['permissions']): boolean => {
  if (!user) return false;
  return ROLE_PERMISSIONS[user.role].permissions[permission];
};

// Helper function to check if user can access feature
export const canAccessFeature = (user: User | null, feature: keyof typeof ROLE_PERMISSIONS['super_admin']['features']): boolean => {
  if (!user) return false;
  return ROLE_PERMISSIONS[user.role].features[feature] !== false;
};

// Helper function to check if user can manage another user
export const canManageUser = (currentUser: User | null, targetUser: User): boolean => {
  if (!currentUser) return false;
  
  const currentLevel = ROLE_PERMISSIONS[currentUser.role].level;
  const targetLevel = ROLE_PERMISSIONS[targetUser.role].level;
  
  // Super admin can manage everyone
  if (currentUser.role === 'super_admin') return true;
  
  // QA Manager can manage everyone except super admins
  if (currentUser.role === 'qa_manager' && targetUser.role !== 'super_admin') return true;
  
  // Team Lead can only manage users in their teams with lower level
  if (currentUser.role === 'team_lead') {
    const hasCommonTeam = currentUser.assignedTeams.some(team => 
      targetUser.assignedTeams.includes(team)
    );
    return hasCommonTeam && currentLevel > targetLevel;
  }
  
  return false;
};

// Helper function to get role badge color
export const getRoleBadgeColor = (role: UserRole): string => {
  const colors: Record<UserRole, string> = {
    super_admin: 'bg-purple-100 text-purple-800 border-purple-300',
    qa_manager: 'bg-blue-100 text-blue-800 border-blue-300',
    team_lead: 'bg-green-100 text-green-800 border-green-300',
    qa_engineer: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    viewer: 'bg-gray-100 text-gray-800 border-gray-300',
  };
  return colors[role];
};

// Helper function to get role icon
export const getRoleIcon = (role: UserRole): string => {
  const icons: Record<UserRole, string> = {
    super_admin: '👑',
    qa_manager: '📊',
    team_lead: '👥',
    qa_engineer: '🧪',
    viewer: '👁️',
  };
  return icons[role];
};
