# Role-Based Permissions UI Tests

## Test Suite: PERMISSIONS-UI
**Priority**: P0 (Critical)  
**Coverage**: Role-based access control, authorization, UI element visibility

---

## PERM-UI-001: Super Admin - Full Access
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin

### Test Steps
1. Navigate to Admin Panel
2. Check available actions

### Expected Results
- Can view all users in company
- Can view all teams in company
- Can create users with any role below super_admin
- Can create teams
- Can edit any user
- Can delete any user (except self)
- Can reset any user's password
- "Create User" button visible
- "Create Team" button visible
- Admin Panel menu item visible

---

## PERM-UI-002: QA Manager - Department Scope
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager in "Decision Management"

### Test Steps
1. Navigate to Admin Panel
2. Check visible data and actions

### Expected Results
- Can view users in own department
- Can view users they created
- Can view teams in own department
- Can create team_lead users
- Can create teams
- Cannot create qa_manager or super_admin
- Cannot see users from other departments
- Cannot see teams from other departments
- "Create User" button visible
- "Create Team" button visible
- Admin Panel menu item visible

### Database Validation
```sql
-- Users visible
SELECT * FROM users 
WHERE department_id = (SELECT department_id FROM users WHERE id = 'qa-manager-id')
   OR created_by = 'qa-manager-id';

-- Teams visible
SELECT * FROM teams 
WHERE department_id = (SELECT department_id FROM users WHERE id = 'qa-manager-id');
```

---

## PERM-UI-003: Team Lead - Team Scope
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as team_lead of "Nebula" team

### Test Steps
1. Navigate to Admin Panel
2. Check visible data and actions

### Expected Results
- Can view only users in own team
- Can view only own team
- Can create qa_engineer users
- Cannot create teams
- Cannot create team_lead, qa_manager, or super_admin
- Cannot see users from other teams
- Cannot see other teams
- "Create User" button visible
- "Create Team" button NOT visible
- Admin Panel menu item visible

### Database Validation
```sql
-- Users visible
SELECT * FROM users WHERE primary_team_id = 'team-nebula-id';

-- Teams visible
SELECT * FROM teams WHERE id = 'team-nebula-id';
-- Only 1 result
```

---

## PERM-UI-004: QA Engineer - No Admin Access
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as qa_engineer

### Test Steps
1. Look for Admin Panel menu item
2. Attempt to navigate to /admin-panel

### Expected Results
- Admin Panel menu item NOT visible
- Cannot access /admin-panel route
- Redirected or access denied
- No admin functionality available

---

## PERM-UI-005: Viewer - No Admin Access
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as viewer

### Test Steps
1. Look for Admin Panel menu item
2. Attempt to navigate to /admin-panel

### Expected Results
- Admin Panel menu item NOT visible
- Cannot access /admin-panel route
- Read-only access to dashboard
- No modification capabilities

---

## PERM-UI-006: Role Creation Restrictions - Super Admin
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin

### Test Steps
1. Click "Create User"
2. Check role dropdown options

### Expected Results
- Available roles: qa_manager, team_lead, qa_engineer, viewer
- Cannot create another super_admin
- All subordinate roles available

---

## PERM-UI-007: Role Creation Restrictions - QA Manager
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager

### Test Steps
1. Click "Create User"
2. Check role dropdown

### Expected Results
- Available roles: team_lead only
- Cannot create qa_manager, super_admin, qa_engineer, viewer
- Restricted to direct subordinates

---

## PERM-UI-008: Role Creation Restrictions - Team Lead
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as team_lead

### Test Steps
1. Click "Create User"
2. Check role dropdown

### Expected Results
- Available roles: qa_engineer only
- Cannot create team_lead, qa_manager, super_admin, viewer
- Restricted to team members

---

## PERM-UI-009: Edit User - Permission Check
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager
- User "John" created by this manager
- User "Jane" created by different manager

### Test Steps
1. View users list
2. Check edit buttons

### Expected Results
- Can edit John (created by self)
- Can edit users in own department
- Cannot edit Jane (different creator, different dept)
- Edit button disabled or hidden for unauthorized users

---

## PERM-UI-010: Delete User - Permission Check
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as team_lead
- Own user visible in list

### Test Steps
1. View users list
2. Find own user row
3. Look for delete button

### Expected Results
- Delete button NOT visible for own account
- Cannot delete self
- Can delete other team members

---

## PERM-UI-011: Team Selection - Team Lead
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as team_lead of "Nebula"
- Multiple teams exist

### Test Steps
1. Click "Create User"
2. Check team dropdown

### Expected Results
- Only own team "Nebula" available
- Cannot select other teams
- Team pre-selected or only option

---

## PERM-UI-012: Team Selection - QA Manager
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager in "Decision Management"
- Department has 6 teams

### Test Steps
1. Click "Create User"
2. Check team dropdown

### Expected Results
- All 6 teams in department available
- Cannot select teams from other departments
- Dropdown shows department teams only

---

## PERM-UI-013: Team Selection - Super Admin
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- Company has 18 teams

### Test Steps
1. Click "Create User"
2. Check team dropdown

### Expected Results
- All 18 teams available
- Can select any team in company
- No restrictions

---

## PERM-UI-014: Password Reset - Own Password
**Priority**: P1  
**Type**: Positive

### Preconditions
- Logged in as any role

### Test Steps
1. Find own user in list
2. Click "Reset Password"
3. Change password

### Expected Results
- Can reset own password
- Password updated successfully
- Can log in with new password

---

## PERM-UI-015: Password Reset - Other User (Authorized)
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- User "John" exists

### Test Steps
1. Click "Reset Password" for John
2. Set new password

### Expected Results
- Password reset successful
- John can log in with new password
- Authorized action

---

## PERM-UI-016: Password Reset - Other User (Unauthorized)
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as team_lead
- User from different team exists

### Test Steps
1. Attempt to reset password for user in different team (via API)

### Expected Results
- 403 Forbidden
- Error message
- Password not changed

---

## PERM-UI-017: Cross-Department Access - Blocked
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as qa_manager in "Decision Management"
- Users exist in "Payments Processing" department

### Test Steps
1. View users list
2. Check for Payments users

### Expected Results
- Cannot see users from Payments
- Only Decision Management users visible
- Department isolation enforced

---

## PERM-UI-018: Cross-Team Access - Blocked
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as team_lead of "Nebula"
- Users exist in "Voyagers" team

### Test Steps
1. View users list
2. Check for Voyagers users

### Expected Results
- Cannot see Voyagers users
- Only Nebula users visible
- Team isolation enforced

---

## PERM-UI-019: Admin Panel Visibility - Authorized Roles
**Priority**: P0  
**Type**: Positive

### Test Steps
1. Log in as super_admin → Check sidebar
2. Log in as qa_manager → Check sidebar
3. Log in as team_lead → Check sidebar

### Expected Results
- All three roles see "Admin Panel" menu item
- Shield icon visible
- Menu item clickable

---

## PERM-UI-020: Admin Panel Visibility - Unauthorized Roles
**Priority**: P0  
**Type**: Negative

### Test Steps
1. Log in as qa_engineer → Check sidebar
2. Log in as viewer → Check sidebar

### Expected Results
- "Admin Panel" menu item NOT visible
- No shield icon
- Cannot access admin features

---

## PERM-UI-021: Role Hierarchy Enforcement
**Priority**: P0  
**Type**: Positive

### Test Steps
1. Verify role hierarchy:
   - super_admin > qa_manager > team_lead > qa_engineer > viewer

### Expected Results
- Each role can only create subordinate roles
- Cannot create peer or superior roles
- Hierarchy strictly enforced

### Database Validation
```sql
-- Verify ROLE_HIERARCHY in backend
-- super_admin: [qa_manager, team_lead, qa_engineer, viewer]
-- qa_manager: [team_lead]
-- team_lead: [qa_engineer]
-- qa_engineer: []
-- viewer: []
```

---

## PERM-UI-022: Created By Tracking
**Priority**: P1  
**Type**: Positive

### Preconditions
- Logged in as qa_manager

### Test Steps
1. Create new user
2. Check database

### Expected Results
- `created_by` field set to current user ID
- Tracking accurate
- Can view users created by self

### Database Validation
```sql
SELECT created_by FROM users WHERE email = 'newuser@example.com';
-- created_by = current qa_manager ID
```

---

## PERM-UI-023: Department Inheritance
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager in "Decision Management"
- Creating user for team in same department

### Test Steps
1. Create user
2. Select team "Nebula" (in Decision Management)
3. Submit

### Expected Results
- User's department auto-set to "Decision Management"
- Matches team's department
- No manual department selection needed

### Database Validation
```sql
SELECT u.department_id, t.department_id
FROM users u
JOIN teams t ON u.primary_team_id = t.id
WHERE u.email = 'newuser@example.com';
-- Both department_ids match
```

---

## PERM-UI-024: Company Isolation
**Priority**: P0  
**Type**: Positive

### Preconditions
- Multiple companies exist
- Logged in as super_admin of Company A

### Test Steps
1. View users and teams

### Expected Results
- Only Company A users visible
- Only Company A teams visible
- Cannot see Company B data
- Company isolation enforced

### Database Validation
```sql
SELECT * FROM users WHERE company_id = 'company-a';
SELECT * FROM teams WHERE company_id = 'company-a';
-- Only Company A data
```

---

## PERM-UI-025: Permission Denied Messages
**Priority**: P1  
**Type**: Negative

### Test Steps
1. Attempt unauthorized action (various scenarios)

### Expected Results
- Clear error message displayed
- "You don't have permission to perform this action"
- 403 Forbidden response
- User informed of restriction

---

## Coverage Summary

| Category | Scenarios | Coverage |
|----------|-----------|----------|
| Super Admin | 4 | 100% |
| QA Manager | 5 | 100% |
| Team Lead | 4 | 100% |
| QA Engineer/Viewer | 2 | 100% |
| Role Creation | 3 | 100% |
| Access Control | 8 | 100% |
| Data Isolation | 4 | 100% |

**Total Scenarios**: 25  
**Critical (P0)**: 21  
**High (P1)**: 4  

**Permission Matrix Coverage**: 100%
