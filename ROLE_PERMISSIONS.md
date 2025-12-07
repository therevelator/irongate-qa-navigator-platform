# Role-Based Permissions - QA Navigator Dashboard

## Role Hierarchy

```
Super Admin (Highest)
    ↓
Manager (QA Manager)
    ↓
Team Lead
    ↓
QA Engineer
    ↓
Viewer (Lowest)
```

## Navigation & View Access

### Access to admin features
- **Access**: All roles
- **View**:
  - **Super Admin**: All teams across all departments
  - **Manager**: All teams in their department
  - **Team Lead**: All teams in their department
  - **QA Engineer**: Only their own team
  - **Viewer**: Only their own team

### Access to dashboard:
anyone can view any team from any department:

- the team details: the viewer can only view team's details, metrics, without the developers and the ai insights
- team details: the engineer can only see himself in the team details, no other developers and no ai insights
- the team lead can view his team's developers, not other teams developers and only his team's ai insights
- the manager can view all teams developers and ai insights
- the super admin can view all teams developers and ai insights

### Users View
- **Access**: Super Admin, Manager, Team Lead
- **Restricted**: QA Engineer, Viewer (no access)
- **Permissions**:
  - **Super Admin**: View/Create/Edit/Delete all users
  - **Manager**: View/Create/Edit/Delete users in their department
  - **Team Lead**: View users, limited edit capabilities

### Teams View
- **Access**: Super Admin, Manager, Team Lead
- **Restricted**: QA Engineer, Viewer (no access)
- **Permissions**:
  - **Super Admin**: View/Create/Edit/Delete all teams
  - **Manager**: View/Create/Edit/Delete teams in their department
  - **Team Lead**: View teams in their department

### Departments View
- **Access**: Super Admin only
- **Restricted**: All other roles
- **Permissions**:
  - **Super Admin**: View/Create/Edit/Delete all departments

### Analytics
- **Access**: All roles
- **View**: Based on team access (same as Dashboard)

### Admin Panel
- **Access**: Super Admin, Manager
- **Restricted**: Team Lead, QA Engineer, Viewer
- **Permissions**:
  - **Super Admin**: Full access to all admin features
  - **Manager**: Limited admin features for their department

## CRUD Permissions by Role

### User Management

| Action | Super Admin | Manager | Team Lead | QA Engineer | Viewer |
|--------|-------------|---------|-----------|-------------|--------|
| View Users | ✅ All | ✅ Department | ✅ Department | ❌ | ❌ |
| Create User | ✅ | ✅ In dept | ❌ | ❌ | ❌ |
| Edit User | ✅ | ✅ In dept | ⚠️ Limited | ❌ | ❌ |
| Delete User | ✅ | ✅ In dept | ❌ | ❌ | ❌ |
| Reset Password | ✅ | ✅ In dept | ⚠️ Limited | ❌ | ❌ |

### Team Management

| Action | Super Admin | Manager | Team Lead | QA Engineer | Viewer |
|--------|-------------|---------|-----------|-------------|--------|
| View Teams | ✅ All | ✅ Department | ✅ Department | ❌ | ❌ |
| Create Team | ✅ | ✅ In dept | ❌ | ❌ | ❌ |
| Edit Team | ✅ | ✅ In dept | ❌ | ❌ | ❌ |
| Delete Team | ✅ | ✅ In dept | ❌ | ❌ | ❌ |

### Department Management

| Action | Super Admin | Manager | Team Lead | QA Engineer | Viewer |
|--------|-------------|---------|-----------|-------------|--------|
| View Departments | ✅ All | ❌ | ❌ | ❌ | ❌ |
| Create Department | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit Department | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete Department | ✅ | ❌ | ❌ | ❌ | ❌ |

## Dashboard Personalization

### Super Admin
- **Title**: "Quality Assurance Dashboard"
- **Section**: "Team Performance"
- **Teams Shown**: All teams across all departments
- **Metrics**: Calculated from all teams

### Manager
- **Title**: "Quality Assurance Dashboard"
- **Section**: "Team Performance"
- **Teams Shown**: All teams in their department
- **Metrics**: Calculated from department teams

### Team Lead
- **Title**: "Quality Assurance Dashboard"
- **Section**: "Team Performance"
- **Teams Shown**: All teams in their department
- **Metrics**: Calculated from department teams

### QA Engineer
- **Title**: "[Team Name] Dashboard"
- **Section**: "My Team Performance"
- **Teams Shown**: Only their primary team
- **Metrics**: Calculated from their team only

### Viewer
- **Title**: "[Team Name] Dashboard"
- **Section**: "My Team Performance"
- **Teams Shown**: Only their primary team
- **Metrics**: Calculated from their team only (read-only)

## Navigation Visibility by Role

### Super Admin
- ✅ Dashboard
- ✅ Users
- ✅ Teams
- ✅ Departments
- ✅ Analytics
- ✅ Admin Panel

### Manager
- ✅ Dashboard
- ✅ Users
- ✅ Teams
- ❌ Departments
- ✅ Analytics
- ✅ Admin Panel

### Team Lead
- ✅ Dashboard
- ✅ Users
- ✅ Teams
- ❌ Departments
- ✅ Analytics
- ❌ Admin Panel

### QA Engineer
- ✅ Dashboard (own team only)
- ❌ Users
- ❌ Teams
- ❌ Departments
- ✅ Analytics (own team only)
- ❌ Admin Panel

### Viewer
- ✅ Dashboard (own team only)
- ❌ Users
- ❌ Teams
- ❌ Departments
- ✅ Analytics (own team only)
- ❌ Admin Panel

## Data Filtering Rules

### Team Data
- **Super Admin**: Sees all teams in the company
- **Manager**: Sees teams in their department only
- **Team Lead**: Sees teams in their department only
- **QA Engineer**: Sees only their `primaryTeamId`
- **Viewer**: Sees only their `primaryTeamId`

### User Data
- **Super Admin**: Sees all users in the company
- **Manager**: Sees users in their department only
- **Team Lead**: Sees users in their department only
- **QA Engineer**: No access
- **Viewer**: No access

### Department Data
- **Super Admin**: Sees all departments
- **All Others**: No access to department management

## Special Restrictions

### Self-Management
- Users **cannot delete themselves**
- Users can view their own profile
- Users can change their own password

### Creation Hierarchy
- **Super Admin**: Can create any role
- **Manager**: Can create Manager, Team Lead, QA Engineer, Viewer (in their department)
- **Team Lead**: Can create QA Engineer, Viewer (in their team)
- **QA Engineer**: Cannot create users
- **Viewer**: Cannot create users

### Department Restrictions
- Managers can only manage users/teams in **their assigned department**
- Team Leads can only manage users in **their assigned department**
- Cross-department operations require Super Admin privileges

## Implementation Files

- **Layout.tsx**: Navigation visibility and role checks
- **NewDashboard.tsx**: Team filtering and personalization
- **UsersView.tsx**: User CRUD with role permissions
- **TeamsView.tsx**: Team CRUD with role permissions
- **DepartmentsView.tsx**: Department CRUD (Super Admin only)
- **AdminPanel.tsx**: Legacy admin interface (Super Admin, Manager)

## Security Notes

1. All API endpoints enforce role-based permissions on the backend
2. Frontend permissions are for UX only - backend validates all operations
3. JWT tokens contain user role and department information
4. Unauthorized access attempts are logged and rejected
5. Role hierarchy is enforced at the database level

---

**Last Updated**: November 24, 2025
**Status**: ✅ Fully Implemented
