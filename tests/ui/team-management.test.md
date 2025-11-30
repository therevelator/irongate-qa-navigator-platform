# Team Management UI Tests

## Test Suite: TEAM-MGMT-UI
**Priority**: P0 (Critical)  
**Coverage**: Team CRUD operations, member management, permissions

---

## TEAM-MGMT-UI-001: Create Team - Super Admin
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- On Admin Panel

### Test Steps
1. Click "Create Team" button
2. Enter name: `Phoenix Team`
3. Enter description: `Innovation and R&D team`
4. Select platform: `Backend`
5. Click "Create Team"

### Expected Results
- Success message: "Team created successfully!"
- Modal closes
- New team appears in teams table
- Team data correctly displayed

### Database Validation
```sql
SELECT * FROM teams WHERE name = 'Phoenix Team';
-- Verify:
-- - id exists
-- - company_id = current user's company
-- - department_id = current user's department
-- - name = 'Phoenix Team'
-- - description = 'Innovation and R&D team'
-- - platform = 'Backend'
-- - is_active = true
```

---

## TEAM-MGMT-UI-002: Create Team - QA Manager
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager

### Test Steps
1. Click "Create Team"
2. Fill valid team data
3. Submit

### Expected Results
- Team created successfully
- Team in manager's department
- Create Team button visible

---

## TEAM-MGMT-UI-003: Create Team - Team Lead (Unauthorized)
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as team_lead

### Test Steps
1. Look for "Create Team" button

### Expected Results
- "Create Team" button NOT visible
- Cannot create teams
- UI prevents unauthorized action

---

## TEAM-MGMT-UI-004: Create Team - Missing Required Fields
**Priority**: P1  
**Type**: Negative

### Test Steps
1. Click "Create Team"
2. Leave name empty
3. Select platform
4. Click submit

### Expected Results
- Error: "Missing required fields"
- Form validation prevents submission
- Team not created

---

## TEAM-MGMT-UI-005: View Teams List - Super Admin
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- Multiple teams exist

### Test Steps
1. Navigate to Admin Panel
2. Scroll to teams table

### Expected Results
- All teams in company visible
- Columns: Team Name, Platform, Description, Status, Created
- Accurate data display

### Database Validation
```sql
SELECT COUNT(*) FROM teams WHERE company_id = 'novatech' AND is_active = true;
-- Count matches UI
```

---

## TEAM-MGMT-UI-006: View Teams List - QA Manager
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager in "Decision Management" department

### Test Steps
1. View teams table

### Expected Results
- Only teams in same department visible
- Cannot see teams from other departments

### Database Validation
```sql
SELECT * FROM teams 
WHERE department_id = (SELECT department_id FROM users WHERE id = 'current-qa-manager-id');
```

---

## TEAM-MGMT-UI-007: View Teams List - Team Lead
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as team_lead of "Nebula" team

### Test Steps
1. View teams table

### Expected Results
- Only own team visible
- Cannot see other teams
- Single team in list

### Database Validation
```sql
SELECT * FROM teams WHERE id = 'team-nebula-id';
-- Only 1 result
```

---

## TEAM-MGMT-UI-008: View Team Details
**Priority**: P0  
**Type**: Positive

### Preconditions
- Team "Nebula" exists with 5 members

### Test Steps
1. Click on "Nebula" team row in teams table
2. View team detail page

### Expected Results
- Team detail page displayed
- Team header shows: Name, Description, Platform, Status
- Member count: 5
- Team members table visible
- Back button available

---

## TEAM-MGMT-UI-009: View Team Members
**Priority**: P0  
**Type**: Positive

### Preconditions
- Viewing "Nebula" team details
- Team has members

### Test Steps
1. On team detail page
2. View team members table

### Expected Results
- All team members displayed
- Columns: Name, Email, Role, Status, Actions
- Accurate member data

### Database Validation
```sql
SELECT u.* FROM users u
WHERE u.primary_team_id = 'team-nebula-id';

SELECT u.* FROM users u
JOIN team_members tm ON u.id = tm.user_id
WHERE tm.team_id = 'team-nebula-id';
-- Both queries return same members
```

---

## TEAM-MGMT-UI-010: Team Member Actions - Edit
**Priority**: P0  
**Type**: Positive

### Preconditions
- Viewing team detail page
- Team has member "John Doe"

### Test Steps
1. Click "Edit" for John Doe
2. Change role to `team_lead`
3. Click "Update User"

### Expected Results
- User updated
- Role changed in team context
- Changes reflected in team members table

---

## TEAM-MGMT-UI-011: Team Member Actions - Reset Password
**Priority**: P0  
**Type**: Positive

### Preconditions
- Viewing team detail page

### Test Steps
1. Click "Reset Password" for team member
2. Enter new password
3. Confirm password
4. Submit

### Expected Results
- Password reset successful
- Member can log in with new password

---

## TEAM-MGMT-UI-012: Team Member Actions - Delete
**Priority**: P0  
**Type**: Positive

### Preconditions
- Viewing team detail page
- Team has member "Test User"
- Not deleting self

### Test Steps
1. Click "Delete" for Test User
2. Confirm deletion

### Expected Results
- User deleted from team
- User removed from team members table
- Member count decremented

### Database Validation
```sql
SELECT * FROM users WHERE email = 'testuser@example.com';
-- User deleted or is_active = false

SELECT * FROM team_members WHERE user_id = 'test-user-id';
-- No results
```

---

## TEAM-MGMT-UI-013: Navigate Back from Team Details
**Priority**: P1  
**Type**: Positive

### Preconditions
- Viewing team detail page

### Test Steps
1. Click "Back to Teams" button

### Expected Results
- Returned to Admin Panel main view
- Teams table visible
- No data lost

---

## TEAM-MGMT-UI-014: Team Status Display
**Priority**: P1  
**Type**: Positive

### Preconditions
- Active and inactive teams exist

### Test Steps
1. View teams table
2. Observe status badges

### Expected Results
- Active teams show green "Active" badge
- Inactive teams show red "Inactive" badge
- Status accurate

### Database Validation
```sql
SELECT name, is_active FROM teams WHERE company_id = 'novatech';
-- Verify UI matches database
```

---

## TEAM-MGMT-UI-015: Team Platform Display
**Priority**: P1  
**Type**: Positive

### Test Steps
1. View teams table
2. Observe platform badges

### Expected Results
- Platform displayed as badge
- Platforms: Backend, Frontend, Mobile, API, DevOps, Web, Security
- Correct platform for each team

---

## TEAM-MGMT-UI-016: Team Creation Date Display
**Priority**: P2  
**Type**: Positive

### Test Steps
1. View teams table
2. Check "Created" column

### Expected Results
- Creation date displayed in readable format
- Date accurate
- Sorted by date possible

---

## TEAM-MGMT-UI-017: Empty Team Display
**Priority**: P1  
**Type**: Positive

### Preconditions
- Team "New Team" has 0 members

### Test Steps
1. Click on "New Team"
2. View team members section

### Expected Results
- Message: "No team members found"
- Empty state displayed
- No errors

---

## TEAM-MGMT-UI-018: Team Member Count Accuracy
**Priority**: P0  
**Type**: Positive

### Preconditions
- Team "Nebula" has 5 members

### Test Steps
1. View teams table
2. Check member count for Nebula

### Expected Results
- Member count shows: 5
- Count accurate

### Database Validation
```sql
SELECT COUNT(*) FROM team_members WHERE team_id = 'team-nebula-id';
-- Result = 5
```

---

## TEAM-MGMT-UI-019: Add User to Team via User Creation
**Priority**: P0  
**Type**: Positive

### Preconditions
- Team "Nebula" has 5 members

### Test Steps
1. Create new user
2. Assign to "Nebula" team
3. Submit
4. View Nebula team details

### Expected Results
- New user appears in team members
- Member count: 6
- User properly linked to team

### Database Validation
```sql
SELECT COUNT(*) FROM team_members WHERE team_id = 'team-nebula-id';
-- Result = 6

SELECT * FROM users WHERE primary_team_id = 'team-nebula-id';
-- New user included
```

---

## TEAM-MGMT-UI-020: Team Clickability
**Priority**: P1  
**Type**: Positive

### Test Steps
1. Hover over team row in table
2. Click anywhere on row

### Expected Results
- Row highlights on hover
- Clicking opens team detail page
- Cursor indicates clickable

---

## TEAM-MGMT-UI-021: Multiple Teams Same Department
**Priority**: P1  
**Type**: Positive

### Preconditions
- "Decision Management" department has 6 teams

### Test Steps
1. Log in as qa_manager of Decision Management
2. View teams table

### Expected Results
- All 6 teams visible
- All in same department
- Accurate display

---

## TEAM-MGMT-UI-022: Team Description Truncation
**Priority**: P2  
**Type**: Positive

### Preconditions
- Team has very long description (>100 chars)

### Test Steps
1. View teams table
2. Check description column

### Expected Results
- Description truncated with ellipsis
- Readable format
- No layout breaking

---

## TEAM-MGMT-UI-023: Team Platform Options
**Priority**: P1  
**Type**: Positive

### Test Steps
1. Click "Create Team"
2. View platform dropdown

### Expected Results
- Options: Backend, Frontend, Mobile, API, DevOps, Web, Security
- All options selectable
- Default: Backend

---

## TEAM-MGMT-UI-024: Team in Multiple Contexts
**Priority**: P1  
**Type**: Positive

### Test Steps
1. View team in teams table
2. View same team in user's team assignment
3. View team in team detail page

### Expected Results
- Consistent data across all views
- Same team ID, name, platform
- No discrepancies

---

## Coverage Summary

| Category | Scenarios | Coverage |
|----------|-----------|----------|
| Team Creation | 4 | 100% |
| Team Viewing | 8 | 100% |
| Team Details | 6 | 100% |
| Team Members | 6 | 100% |
| Permissions | 3 | 100% |
| UI/UX | 4 | 100% |

**Total Scenarios**: 24  
**Critical (P0)**: 13  
**High (P1)**: 9  
**Medium (P2)**: 2
