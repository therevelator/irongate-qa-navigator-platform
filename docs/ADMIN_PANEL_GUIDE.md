# 🛡️ Admin Control Panel Guide

## Overview

The Admin Control Panel provides role-based user management with a hierarchical permission system. Each role can create and manage specific user types based on their authority level.

---

## Role Hierarchy & Permissions

### 1. **Super Admin** 👑
**Can create:**
- QA Manager
- Team Lead
- QA Engineer
- Viewer

**Visibility:**
- All users in their company
- All teams and departments
- Full system access

**Actions:**
- Create users with any role (except super_admin)
- Create teams
- Reset passwords for all users
- Manage all resources

---

### 2. **QA Manager** 📊
**Can create:**
- Team Lead
- Teams (new teams in their department)

**Visibility:**
- Users they created
- Users in their department
- Teams in their department

**Actions:**
- Create Team Leads
- Create new teams
- Reset passwords for users they created
- Manage department resources

---

### 3. **Team Lead** 👥
**Can create:**
- QA Engineer

**Visibility:**
- Users in their team only
- Their team's data only

**Actions:**
- Create QA Engineers for their team
- Reset passwords for users they created
- View team members

---

### 4. **QA Engineer** 🔧
**Can create:**
- Nothing

**Visibility:**
- Themselves only
- Their own team data

**Actions:**
- View their own profile
- Reset their own password
- View team metrics

---

### 5. **Viewer** 👁️
**Can create:**
- Nothing

**Visibility:**
- Themselves only
- Read-only access to assigned data

**Actions:**
- View their own profile
- Reset their own password
- Read-only access

---

## API Endpoints

### Admin User Management

```
GET    /api/admin/users                    - Get users based on role permissions
POST   /api/admin/users                    - Create new user (role-based)
POST   /api/admin/users/:id/reset-password - Reset user password
GET    /api/admin/available-roles          - Get roles current user can create
POST   /api/admin/teams                    - Create new team (QA Manager+)
PATCH  /api/admin/users/:id/developer-insights-toggle - Enable/disable Developer Insights for a user (Team Lead+)
```

---

## Features

### 1. **User Creation**

**Process:**
1. Click "Create User" button
2. Fill in user details:
   - Email
   - Password (min 6 characters)
   - First Name
   - Last Name
   - Role (from available roles)
   - Team assignment
3. Submit

**Validation:**
- Email must be unique
- Password minimum 6 characters
- Role must be in allowed list
- Team must exist

**Backend Logic:**
```typescript
// Check if creator can create this role
if (!canCreateRole(creatorRole, targetRole)) {
  return 403 Forbidden
}

// Hash password with bcrypt
const passwordHash = await bcrypt.hash(password, 10);

// Store created_by to track who created the user
INSERT INTO users (..., created_by) VALUES (..., creatorId)
```

---

### 2. **Password Reset**

**Rules:**
- Can reset password for users you created
- Can reset your own password
- Cannot reset passwords for users created by others

**Process:**
1. Click "Reset Password" on user row
2. Enter new password (min 6 characters)
3. Confirm password
4. Submit

**Backend Validation:**
```typescript
// Check if user can manage this user
const canManage = await canManageUser(managerId, targetUserId);
if (!canManage) {
  return 403 Forbidden
}
```

---

### 3. **Team Creation** (QA Manager & Super Admin only)

**Process:**
1. Click "Create Team" button
2. Fill in team details:
   - Team Name
   - Description (optional)
   - Platform (Backend, Frontend, Mobile, API, DevOps, Web, Security)
3. Submit

**Auto-assigned:**
- Company ID (from creator)
- Department ID (from creator)
- Active status (true)

---

## UI Components

### Users Table

Displays:
- Name
- Email
- Role (with color-coded badge)
- Team
- Department
- Status (Active/Inactive)
- Actions (Reset Password, Developer Insights toggle, Activate/Deactivate, Delete)

**Role Badge Colors:**
- Super Admin: Purple
- QA Manager: Blue
- Team Lead: Green
- QA Engineer: Yellow
- Viewer: Gray

---

### Create User Modal

**Fields:**
- Email (required, type: email)
- Password (required, min: 6)
- First Name (required)
- Last Name (required)
- Role (dropdown, filtered by permissions)
- Team (dropdown, from available teams)

---

### Create Team Modal

**Fields:**
- Team Name (required)
- Description (optional, textarea)
- Platform (dropdown: Backend, Frontend, Mobile, API, DevOps, Web, Security)

---

### Reset Password Modal

**Fields:**
- New Password (required, min: 6)
- Confirm Password (required, must match)

**Displays:**
- User being reset (name and email)

---

### Developer Insights Toggle (Per-User)

**Purpose:**
- Allow Team Leads and above to selectively enable **Developer Insights** for individual developers.
- Intended for cases where a manager suspects a developer may be struggling or wants extra support.

**UI Behavior:**
- Appears as an **Eye icon** in the user actions column inside the team expansion row.
- Visible only for roles: `super_admin`, `manager`, `team_lead`.
- States:
  - Gray Eye → Developer Insights **disabled** for that user.
  - Indigo Eye → Developer Insights **enabled**.

**Backend:**
- Tied to `users.developer_insights_enabled` (BOOLEAN).
- Toggled via:
  ```http
  PATCH /api/admin/users/:id/developer-insights-toggle
  Authorization: Bearer <token>
  Content-Type: application/json

  { "enabled": true }
  ```

**Permissions:**
- `super_admin`: Can toggle for any user in the company.
- `manager`: Can toggle for users in their department.
- `team_lead`: Can toggle for users in their department/team.

**Effect in UI:**
- When enabled, the developer becomes eligible to appear in **Developer Insights** on the Team Detail page, provided the team-wide AI toggle is also enabled.

---

## Database Schema

### Users Table (Updated)

```sql
ALTER TABLE users ADD COLUMN created_by VARCHAR(36) NULL;
```

**Purpose:** Track who created each user for permission checks

**Usage:**
```sql
-- Check if user can manage another user
SELECT created_by FROM users WHERE id = ?
-- If created_by = current_user_id OR id = current_user_id, allow
```

---

## Security Features

### 1. **Role-Based Access Control**

```typescript
const ROLE_HIERARCHY = {
  super_admin: ['qa_manager', 'team_lead', 'qa_engineer', 'viewer'],
  qa_manager: ['team_lead'],
  team_lead: ['qa_engineer'],
  qa_engineer: [],
  viewer: []
};
```

### 2. **Password Hashing**

- Uses bcrypt with 10 salt rounds
- Passwords never stored in plain text
- Same hashing for registration and password reset

### 3. **JWT Authentication**

- All admin endpoints require valid JWT token
- Token includes user ID, role, company ID
- Validated by `authenticateToken` middleware

### 4. **Data Isolation**

- Users can only see data within their scope
- Company-level isolation
- Department-level isolation (for QA Managers)
- Team-level isolation (for Team Leads)

---

## Usage Examples

### Example 1: Super Admin Creates QA Manager

```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Authorization: Bearer SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "manager@example.com",
    "password": "secure123",
    "firstName": "Jane",
    "lastName": "Manager",
    "role": "qa_manager",
    "teamId": "team-pulsars"
  }'
```

### Example 2: QA Manager Creates Team Lead

```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Authorization: Bearer QA_MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "lead@example.com",
    "password": "secure123",
    "firstName": "John",
    "lastName": "Lead",
    "role": "team_lead",
    "teamId": "team-watchmen"
  }'
```

### Example 3: Team Lead Creates QA Engineer

```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Authorization: Bearer TEAM_LEAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "engineer@example.com",
    "password": "secure123",
    "firstName": "Bob",
    "lastName": "Engineer",
    "role": "qa_engineer",
    "teamId": "team-watchmen"
  }'
```

### Example 4: Reset Password

```bash
curl -X POST http://localhost:3000/api/admin/users/user-123/reset-password \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newPassword": "newSecure456"
  }'
```

### Example 5: QA Manager Creates Team

```bash
curl -X POST http://localhost:3000/api/admin/teams \
  -H "Authorization: Bearer QA_MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Team",
    "description": "Description of the new team",
    "platform": "Backend"
  }'
```

---

## Access the Admin Panel

### From UI:

1. Login with a user that has admin privileges:
   - Super Admin: `admin@irongate.com` / `demo123`
   - QA Manager: `manager@irongate.com` / `demo123`
   - Team Lead: `lead@irongate.com` / `demo123`

2. Click "Admin Panel" in the sidebar (shield icon)

3. You'll see:
   - List of users you can manage
   - "Create User" button (if you can create users)
   - "Create Team" button (if QA Manager or Super Admin)
   - "Reset Password" button for each user

---

## Permission Matrix

| Action | Super Admin | QA Manager | Team Lead | QA Engineer | Viewer |
|--------|-------------|------------|-----------|-------------|--------|
| Create QA Manager | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create Team Lead | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create QA Engineer | ✅ | ❌ | ✅ | ❌ | ❌ |
| Create Viewer | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create Team | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reset Own Password | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reset Created User Password | ✅ | ✅ | ✅ | ❌ | ❌ |
| View All Company Users | ✅ | ❌ | ❌ | ❌ | ❌ |
| View Department Users | ✅ | ✅ | ❌ | ❌ | ❌ |
| View Team Users | ✅ | ✅ | ✅ | ❌ | ❌ |
| View Self Only | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Error Handling

### Common Errors:

**403 Forbidden**
- Trying to create a role you don't have permission for
- Trying to reset password for user you didn't create

**400 Bad Request**
- Missing required fields
- Email already exists
- Password too short (< 6 characters)

**401 Unauthorized**
- Invalid or missing JWT token
- Token expired

**500 Internal Server Error**
- Database connection issues
- Unexpected server errors

---

## Best Practices

1. **Password Security**
   - Minimum 6 characters (enforce longer in production)
   - Use strong passwords with mix of characters
   - Change default passwords immediately

2. **User Management**
   - Create users with least privilege needed
   - Regularly review user access
   - Deactivate unused accounts

3. **Team Organization**
   - Create teams before assigning users
   - Use descriptive team names
   - Assign appropriate platforms

4. **Audit Trail**
   - `created_by` field tracks user creation
   - Monitor admin actions
   - Review password reset requests

---

## Troubleshooting

### Issue: Can't see "Create User" button
**Solution:** Check your role. Only Super Admin, QA Manager, and Team Lead can create users.

### Issue: "Cannot create this role" error
**Solution:** You can only create roles below your level in the hierarchy.

### Issue: Can't reset user's password
**Solution:** You can only reset passwords for users you created or yourself.

### Issue: Team dropdown is empty
**Solution:** Ask a QA Manager or Super Admin to create teams first.

---

## Summary

✅ **Hierarchical user management**  
✅ **Role-based permissions**  
✅ **Secure password handling**  
✅ **Team creation for QA Managers**  
✅ **Password reset functionality**  
✅ **Data isolation by role**  
✅ **Audit trail with created_by**  

**Ready to use!** 🚀

---

*Last Updated: November 21, 2025*
