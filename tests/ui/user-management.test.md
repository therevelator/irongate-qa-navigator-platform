# User Management UI Tests

## Test Suite: USER-MGMT-UI
**Priority**: P0 (Critical)  
**Coverage**: User CRUD operations, permissions, role management

---

## USER-MGMT-UI-001: Create User - Super Admin
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- On Admin Panel page
- Team "Nebula" exists

### Test Steps
1. Click "Create User" button
2. Enter email: `newqa@example.com`
3. Enter password: `QATest123!`
4. Enter first name: `Jane`
5. Enter last name: `Smith`
6. Select role: `qa_engineer`
7. Select team: `Nebula`
8. Click "Create User" button

### Expected Results
- Success message: "User created successfully!"
- Modal closes
- New user appears in users table
- User data correctly displayed

### Database Validation
```sql
SELECT * FROM users WHERE email = 'newqa@example.com';
-- Verify:
-- - id exists
-- - password_hash is bcrypt (starts with $2b$)
-- - first_name = 'Jane'
-- - last_name = 'Smith'
-- - role = 'qa_engineer'
-- - primary_team_id = Nebula team ID
-- - is_active = true
-- - created_by = current user ID

SELECT * FROM team_members WHERE user_id = (SELECT id FROM users WHERE email = 'newqa@example.com');
-- Verify user added to team_members
```

---

## USER-MGMT-UI-002: Create User - QA Manager (Valid Role)
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager
- Available roles: team_lead only

### Test Steps
1. Click "Create User" button
2. Fill form with valid data
3. Select role: `team_lead`
4. Submit form

### Expected Results
- User created successfully
- Only `team_lead` role available in dropdown
- Cannot create `qa_manager` or `super_admin`

### Database Validation
- User created with role = `team_lead`
- `created_by` = current qa_manager ID

---

## USER-MGMT-UI-003: Create User - QA Manager (Invalid Role)
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as qa_manager

### Test Steps
1. Attempt to create user with role `super_admin` (via API manipulation)

### Expected Results
- Error: "qa_manager cannot create super_admin users"
- User not created
- 403 Forbidden response

---

## USER-MGMT-UI-004: Create User - Team Lead
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as team_lead
- Available roles: qa_engineer only

### Test Steps
1. Click "Create User"
2. Select role: `qa_engineer`
3. Select own team only
4. Submit

### Expected Results
- User created in team lead's team
- Only `qa_engineer` available
- Cannot select other teams

---

## USER-MGMT-UI-005: Create User - Missing Required Fields
**Priority**: P1  
**Type**: Negative

### Test Steps
1. Click "Create User"
2. Leave email empty
3. Fill other fields
4. Click submit

### Expected Results
- Error: "Missing required fields"
- Form validation prevents submission
- No user created

---

## USER-MGMT-UI-006: Create User - Duplicate Email
**Priority**: P0  
**Type**: Negative

### Preconditions
- User with email `existing@example.com` exists

### Test Steps
1. Create user with email: `existing@example.com`

### Expected Results
- Error: "Email already registered"
- User not created
- Modal remains open

---

## USER-MGMT-UI-007: View Users List - Super Admin
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- Multiple users exist in company

### Test Steps
1. Navigate to Admin Panel
2. View users table

### Expected Results
- All users in company displayed
- Columns: Name, Email, Role, Team, Department, Status, Actions
- Data accurate and complete

### Database Validation
```sql
SELECT COUNT(*) FROM users WHERE company_id = 'company-mastercard';
-- Count matches UI display
```

---

## USER-MGMT-UI-008: View Users List - QA Manager
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager in "Decision Management" department

### Test Steps
1. Navigate to Admin Panel
2. View users table

### Expected Results
- Only users in same department visible
- Users created by this manager visible
- Cannot see users from other departments

### Database Validation
```sql
SELECT * FROM users 
WHERE department_id = (SELECT department_id FROM users WHERE id = 'current-qa-manager-id')
   OR created_by = 'current-qa-manager-id';
```

---

## USER-MGMT-UI-009: View Users List - Team Lead
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as team_lead of "Nebula" team

### Test Steps
1. Navigate to Admin Panel
2. View users table

### Expected Results
- Only users in own team visible
- Cannot see users from other teams

### Database Validation
```sql
SELECT * FROM users WHERE primary_team_id = 'team-nebula-id';
```

---

## USER-MGMT-UI-010: Edit User - Own Profile
**Priority**: P1  
**Type**: Positive

### Preconditions
- Logged in as any user

### Test Steps
1. Find own user in list
2. Click "Edit" button
3. Change first name to "Updated"
4. Click "Update User"

### Expected Results
- Success message
- Name updated in UI
- Changes reflected immediately

### Database Validation
```sql
SELECT first_name FROM users WHERE id = 'current-user-id';
-- first_name = 'Updated'
```

---

## USER-MGMT-UI-011: Edit User - Other User (Authorized)
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- User "Jane Smith" exists

### Test Steps
1. Find Jane Smith in users table
2. Click "Edit"
3. Change role from `qa_engineer` to `team_lead`
4. Update email to `jane.updated@example.com`
5. Click "Update User"

### Expected Results
- User updated successfully
- Role changed in database
- Email updated

### Database Validation
```sql
SELECT role, email FROM users WHERE first_name = 'Jane' AND last_name = 'Smith';
-- role = 'team_lead'
-- email = 'jane.updated@example.com'
```

---

## USER-MGMT-UI-012: Edit User - Unauthorized
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as team_lead
- User from different team exists

### Test Steps
1. Attempt to edit user from different team (via API)

### Expected Results
- 403 Forbidden
- Error message
- No changes made

---

## USER-MGMT-UI-013: Delete User - Authorized
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- User "Test User" exists

### Test Steps
1. Find Test User in table
2. Click "Delete" button
3. Confirm deletion in modal
4. Click "Delete" in confirmation

### Expected Results
- Success message: "User deleted successfully!"
- User removed from table
- User removed from database

### Database Validation
```sql
SELECT * FROM users WHERE email = 'testuser@example.com';
-- No results OR is_active = false (soft delete)

SELECT * FROM team_members WHERE user_id = 'deleted-user-id';
-- No results (cascade delete)
```

---

## USER-MGMT-UI-014: Delete User - Self Deletion Prevented
**Priority**: P0  
**Type**: Negative

### Preconditions
- Logged in as any user

### Test Steps
1. Find own user in table
2. Look for "Delete" button

### Expected Results
- Delete button NOT visible for own account
- Cannot delete self
- UI prevents self-deletion

---

## USER-MGMT-UI-015: Delete User - Cancel Confirmation
**Priority**: P1  
**Type**: Positive

### Test Steps
1. Click "Delete" on a user
2. Confirmation modal appears
3. Click "Cancel"

### Expected Results
- Modal closes
- User NOT deleted
- User still in table

---

## USER-MGMT-UI-016: Reset Password - Authorized
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as super_admin
- User "Jane Smith" exists

### Test Steps
1. Click "Reset Password" for Jane Smith
2. Enter new password: `NewPass123!`
3. Confirm password: `NewPass123!`
4. Click "Reset Password"

### Expected Results
- Success message
- Password updated in database
- User can log in with new password

### Database Validation
```sql
SELECT password_hash FROM users WHERE first_name = 'Jane';
-- password_hash changed (bcrypt hash)
-- Verify new hash matches new password
```

---

## USER-MGMT-UI-017: Reset Password - Mismatched Passwords
**Priority**: P1  
**Type**: Negative

### Test Steps
1. Click "Reset Password"
2. Enter new password: `NewPass123!`
3. Confirm password: `DifferentPass123!`
4. Click submit

### Expected Results
- Error: "Passwords do not match"
- Password not updated
- Modal remains open

---

## USER-MGMT-UI-018: Reset Password - Weak Password
**Priority**: P1  
**Type**: Negative

### Test Steps
1. Click "Reset Password"
2. Enter password: `123` (too short)
3. Confirm password: `123`
4. Click submit

### Expected Results
- Error: "Password must be at least 6 characters"
- Password not updated

---

## USER-MGMT-UI-019: View User Details in Team Context
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in with admin access
- Team "Nebula" has 5 members

### Test Steps
1. Navigate to Admin Panel
2. Click on "Nebula" team in teams table
3. View team members list

### Expected Results
- Team detail page displayed
- All 5 members shown
- Member details: Name, Email, Role, Status
- Actions available: Edit, Reset Password, Delete

### Database Validation
```sql
SELECT u.* FROM users u
WHERE u.primary_team_id = 'team-nebula-id';
-- Count = 5
```

---

## USER-MGMT-UI-020: Filter Users by Status
**Priority**: P2  
**Type**: Positive

### Preconditions
- Active and inactive users exist

### Test Steps
1. View users table
2. Filter by "Active" status
3. Filter by "Inactive" status

### Expected Results
- Only active users shown when filtered
- Only inactive users shown when filtered
- Accurate filtering

---

## USER-MGMT-UI-021: User Creation with Department Auto-Assignment
**Priority**: P0  
**Type**: Positive

### Preconditions
- Logged in as qa_manager in "Decision Management"
- Creating user for team in same department

### Test Steps
1. Create user
2. Select team from same department
3. Submit

### Expected Results
- User created
- Department auto-assigned from team
- `department_id` matches team's department

### Database Validation
```sql
SELECT u.department_id, t.department_id 
FROM users u
JOIN teams t ON u.primary_team_id = t.id
WHERE u.email = 'newuser@example.com';
-- Both department_ids match
```

---

## USER-MGMT-UI-022: Refresh User List After Creation
**Priority**: P1  
**Type**: Positive

### Test Steps
1. Note current user count
2. Create new user
3. Observe users table

### Expected Results
- Users table automatically refreshes
- New user appears without manual refresh
- User count incremented

---

## Coverage Summary

| Category | Scenarios | Coverage |
|----------|-----------|----------|
| User Creation | 6 | 100% |
| User Viewing | 4 | 100% |
| User Editing | 3 | 100% |
| User Deletion | 3 | 100% |
| Password Reset | 3 | 100% |
| Permissions | 6 | 100% |
| Data Validation | 5 | 100% |

**Total Scenarios**: 22  
**Critical (P0)**: 15  
**High (P1)**: 5  
**Medium (P2)**: 2
