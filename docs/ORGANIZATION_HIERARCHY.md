# Organizational Hierarchy System

## Overview

The IronGate QA Navigator now supports a **multi-tenant organizational hierarchy** that allows companies to manage multiple departments and teams within a single platform.

---

## Hierarchy Structure

```
Company (e.g., Mastercard)
└── Department/Program (e.g., Decision Management)
    └── Team (e.g., Quasars, Pulsars, Watchmen)
        └── User (QA Engineers, Team Leads, Managers)
```

---

## Example: Mastercard Structure

### Company
- **Mastercard** (company-mastercard)

### Departments
1. **Decision Management** - AI-powered decision management and fraud detection
2. **Payments Processing** - Core payment processing and transaction management
3. **Security & Compliance** - Security, fraud prevention, and regulatory compliance
4. **Digital Products** - Mobile apps, web portals, and digital experiences

### Teams in Decision Management Department
- **Quasars** - AI/ML decision engine development (Backend)
- **Pulsars** - Real-time decision processing (API)
- **Watchmen** - Monitoring and alerting systems (DevOps)
- **Astronauts** - Exploration and innovation team (Web)
- **Black Comb** - Data analytics and insights (Backend)
- **Grid Team** - Infrastructure and platform services (DevOps)

### Teams in Other Departments
- **Payments**: Payment Core, Settlement, Gateway
- **Security**: Fraud Detection, Compliance
- **Digital**: Mobile iOS, Mobile Android, Web Portal

---

## User Registration Flow

### Step 1: Basic Information
- First Name
- Last Name
- Email Address

### Step 2: Organizational Assignment
1. **Company** - Auto-assigned (e.g., Mastercard)
2. **Department** - User selects from dropdown (e.g., Decision Management)
3. **Team** - User selects from teams in their department (e.g., Quasars)

### Step 3: Role & Password
- Role (QA Engineer, Team Lead, etc.)
- Password with strength validation

---

## User Types & Access Levels

### Super Admin
- **Access**: All departments, all teams
- **Permissions**: Full system control
- **Use Case**: Platform administrators

### QA Manager
- **Access**: All teams in their department (or all departments)
- **Permissions**: Manage teams, view all metrics
- **Use Case**: Department heads, QA directors

### Team Lead
- **Access**: Own team + view other teams
- **Permissions**: Manage own team members, view cross-team metrics
- **Use Case**: Team leads, senior QA engineers

### QA Engineer
- **Access**: Own team only
- **Permissions**: View own team metrics, contribute to testing
- **Use Case**: Individual contributors

### Viewer
- **Access**: Assigned teams (read-only)
- **Permissions**: View metrics only
- **Use Case**: Stakeholders, executives

---

## Data Model

### Company
```typescript
{
  id: string;
  name: string;
  domain: string;
  logo?: string;
  settings: {
    allowSelfRegistration: boolean;
    requireEmailVerification: boolean;
    allowedDomains: string[];
  }
}
```

### Department
```typescript
{
  id: string;
  companyId: string;
  name: string;
  description?: string;
  managerId?: string;
}
```

### Team
```typescript
{
  id: string;
  departmentId: string;
  companyId: string;
  name: string;
  description?: string;
  platform: 'Web' | 'Mobile' | 'API' | 'Backend' | 'Payment' | 'Security' | 'DevOps';
  leadId?: string;
  members: string[];
}
```

### User
```typescript
{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  
  // Organizational context
  companyId: string;
  departmentId: string;
  primaryTeamId: string;
  assignedTeams: string[]; // For cross-team access
}
```

---

## Features

### ✅ Implemented
- [x] Multi-level organizational hierarchy (Company → Department → Team → User)
- [x] Department and team selection during registration
- [x] Organizational context stored with each user
- [x] Mock data for Mastercard with 4 departments and 17 teams
- [x] Cascading dropdowns (select department first, then team)
- [x] Role-based access control integrated with org structure

### 🚧 Next Steps
1. **Organization Management UI**
   - Admin panel to create/edit departments
   - Admin panel to create/edit teams
   - User assignment interface

2. **Team Dashboard Filtering**
   - Filter dashboard by department
   - Filter dashboard by team
   - Show only user's accessible teams based on role

3. **Cross-Department Analytics**
   - Compare departments
   - Department-level KPIs
   - Company-wide rollup metrics

4. **User Management**
   - Assign users to multiple teams
   - Transfer users between teams
   - Bulk user import

---

## Demo Accounts

All demo accounts are in **Mastercard → Decision Management** department:

| Email | Password | Role | Team |
|-------|----------|------|------|
| admin@irongate.com | demo123 | Super Admin | Quasars |
| manager@irongate.com | demo123 | QA Manager | Pulsars |
| lead@irongate.com | demo123 | Team Lead | Watchmen |
| engineer@irongate.com | demo123 | QA Engineer | Quasars |
| viewer@irongate.com | demo123 | Viewer | Grid Team |

---

## Usage Example

### Registering a New User

1. User visits registration page
2. Enters personal information
3. Sees **Company**: "Mastercard" (pre-filled)
4. Selects **Department**: "Decision Management"
5. Selects **Team**: "Quasars (Backend)"
6. Selects **Role**: "QA Engineer"
7. Creates password
8. User is now part of: Mastercard → Decision Management → Quasars

### Access Control

- **QA Engineer** in Quasars can only see Quasars team metrics
- **Team Lead** in Watchmen can see Watchmen + Astronauts metrics
- **QA Manager** can see all Decision Management teams
- **Super Admin** can see all departments and teams

---

## Files Modified/Created

### New Files
- `/src/types/organization.ts` - Organizational hierarchy types
- `/src/data/organizationData.ts` - Mock company/department/team data
- `/docs/ORGANIZATION_HIERARCHY.md` - This documentation

### Modified Files
- `/src/types/auth.ts` - Added org fields to User and RegisterData
- `/src/contexts/AuthContext.tsx` - Updated mock users with org data
- `/src/components/Register.tsx` - Added department/team selection

---

## Future Enhancements

1. **Multi-Company Support** - Allow multiple companies in one instance
2. **Department Managers** - Dedicated role for department oversight
3. **Team Metrics Aggregation** - Roll up team metrics to department level
4. **Org Chart Visualization** - Visual representation of hierarchy
5. **Team Collaboration** - Cross-team projects and shared metrics
6. **Custom Org Structures** - Flexible hierarchy beyond 3 levels

---

*Last Updated: November 20, 2025*
