# User Lifecycle Integration Tests

## Test Suite: INT-USER-LIFECYCLE
**Priority**: P0 (Critical)  
**Coverage**: End-to-end user journey from creation to deletion

---

## INT-USER-001: Complete User Creation Flow
**Priority**: P0  
**Type**: Integration

### Test Steps
1. **UI**: Super admin logs in
2. **UI**: Navigate to Admin Panel
3. **UI**: Click "Create User"
4. **UI**: Fill form with valid data
5. **API**: POST /api/admin/users
6. **DB**: Verify user inserted
7. **DB**: Verify team_members record created
8. **UI**: Verify user appears in table
9. **UI**: Verify success message

### Validation Points
```sql
-- User created
SELECT * FROM users WHERE email = 'newuser@example.com';

-- Team membership created
SELECT * FROM team_members 
WHERE user_id = (SELECT id FROM users WHERE email = 'newuser@example.com');

-- Audit log (if implemented)
SELECT * FROM audit_logs 
WHERE action = 'user_created' 
  AND resource_id = (SELECT id FROM users WHERE email = 'newuser@example.com');
```

### Expected Results
- User created in database
- Password hashed with bcrypt
- Team membership established
- UI updated automatically
- All data consistent across layers

---

## INT-USER-002: User Login After Creation
**Priority**: P0  
**Type**: Integration

### Test Steps
1. Create user (from INT-USER-001)
2. **UI**: Logout as admin
3. **UI**: Login as new user
4. **API**: POST /api/auth/login
5. **DB**: Verify last_login updated
6. **UI**: Verify dashboard loads
7. **UI**: Verify user info displayed

### Validation
```sql
SELECT last_login FROM users WHERE email = 'newuser@example.com';
-- last_login should be recent timestamp

SELECT failed_login_attempts FROM users WHERE email = 'newuser@example.com';
-- Should be 0
```

---

## INT-USER-003: User Edit Flow
**Priority**: P0  
**Type**: Integration

### Test Steps
1. **UI**: Admin finds user in list
2. **UI**: Click "Edit"
3. **UI**: Change first name to "Updated"
4. **UI**: Change role to "team_lead"
5. **API**: PUT /api/users/{id}
6. **DB**: Verify changes persisted
7. **UI**: Verify changes reflected immediately
8. **UI**: Close and reopen - changes persist

### Validation
```sql
SELECT first_name, role, updated_at 
FROM users 
WHERE email = 'newuser@example.com';
-- first_name = 'Updated'
-- role = 'team_lead'
-- updated_at = recent timestamp
```

---

## INT-USER-004: Password Reset Flow
**Priority**: P0  
**Type**: Integration

### Test Steps
1. **UI**: Admin clicks "Reset Password" for user
2. **UI**: Enter new password: "NewPass123!"
3. **UI**: Confirm password
4. **API**: POST /api/admin/users/{id}/reset-password
5. **DB**: Verify password_hash changed
6. **UI**: Logout as admin
7. **UI**: Login as user with NEW password
8. **API**: POST /api/auth/login
9. **Verify**: Login successful

### Validation
```sql
-- Get old hash
SELECT password_hash FROM users WHERE email = 'user@example.com';
-- Note hash value

-- After reset
SELECT password_hash FROM users WHERE email = 'user@example.com';
-- Hash should be different

-- Verify bcrypt format
SELECT password_hash LIKE '$2b$%' as is_bcrypt 
FROM users WHERE email = 'user@example.com';
-- is_bcrypt = 1
```

---

## INT-USER-005: User Deletion Flow
**Priority**: P0  
**Type**: Integration

### Test Steps
1. **UI**: Admin finds user in list
2. **UI**: Click "Delete"
3. **UI**: Confirm deletion
4. **API**: DELETE /api/users/{id}
5. **DB**: Verify user deleted
6. **DB**: Verify team_members cascade deleted
7. **UI**: Verify user removed from table
8. **Attempt**: Login as deleted user
9. **Verify**: Login fails

### Validation
```sql
-- User deleted
SELECT * FROM users WHERE email = 'deleteduser@example.com';
-- 0 rows OR is_active = false

-- Team membership deleted
SELECT * FROM team_members 
WHERE user_id = (SELECT id FROM users WHERE email = 'deleteduser@example.com');
-- 0 rows

-- Audit trail (if implemented)
SELECT * FROM audit_logs 
WHERE action = 'user_deleted' 
  AND resource_id = '{deleted_user_id}';
```

---

## INT-USER-006: User Team Transfer
**Priority**: P1  
**Type**: Integration

### Test Steps
1. **Create**: User in Team A
2. **Edit**: Change primary_team_id to Team B
3. **Verify**: User appears in Team B members
4. **Verify**: User removed from Team A (if exclusive)
5. **Verify**: User can access Team B resources

### Validation
```sql
-- User's team updated
SELECT primary_team_id FROM users WHERE id = 'user-id';
-- primary_team_id = Team B id

-- Team membership updated
SELECT team_id FROM team_members WHERE user_id = 'user-id';
-- team_id = Team B id
```

---

## INT-USER-007: Multi-User Creation Batch
**Priority**: P1  
**Type**: Integration

### Test Steps
1. Create User 1
2. Create User 2
3. Create User 3
4. Verify all appear in list
5. Verify all in database
6. Verify no conflicts

### Validation
```sql
SELECT COUNT(*) FROM users 
WHERE email IN ('user1@example.com', 'user2@example.com', 'user3@example.com');
-- Count = 3

SELECT COUNT(DISTINCT id) FROM users 
WHERE email IN ('user1@example.com', 'user2@example.com', 'user3@example.com');
-- Count = 3 (all unique IDs)
```

---

## INT-USER-008: User Session Management
**Priority**: P0  
**Type**: Integration

### Test Steps
1. User logs in
2. JWT token stored in localStorage
3. User makes API calls with token
4. Token validated on each request
5. User logs out
6. Token removed
7. Subsequent API calls fail

### Validation
- Token present in localStorage after login
- Token removed after logout
- API calls with valid token: 200 OK
- API calls with no token: 401 Unauthorized
- API calls with expired token: 401 Unauthorized

---

## INT-USER-009: User Role Change Impact
**Priority**: P0  
**Type**: Integration

### Test Steps
1. User is qa_engineer
2. Login and verify limited access
3. Admin changes role to team_lead
4. User refreshes/re-logs in
5. Verify expanded access
6. Verify can access Admin Panel
7. Verify can create users

### Validation
```sql
SELECT role FROM users WHERE id = 'user-id';
-- role = 'team_lead'
```

### UI Validation
- Admin Panel menu item now visible
- Can create qa_engineer users
- Cannot create team_lead or higher

---

## INT-USER-010: User Deactivation Flow
**Priority**: P1  
**Type**: Integration

### Test Steps
1. User is active (is_active = true)
2. Admin deactivates user
3. User attempts to login
4. Login fails with appropriate message
5. Admin reactivates user
6. User can login again

### Validation
```sql
-- Deactivated
SELECT is_active FROM users WHERE id = 'user-id';
-- is_active = false

-- Reactivated
SELECT is_active FROM users WHERE id = 'user-id';
-- is_active = true
```

---

## INT-USER-011: User Creation with Department Auto-Assignment
**Priority**: P0  
**Type**: Integration

### Test Steps
1. QA Manager in "Decision Management" creates user
2. Selects team "Nebula" (in Decision Management)
3. User created
4. Verify department auto-assigned

### Validation
```sql
SELECT u.department_id, t.department_id
FROM users u
JOIN teams t ON u.primary_team_id = t.id
WHERE u.email = 'newuser@example.com';
-- Both department_ids match
-- Both = 'dept-decision-mgmt'
```

---

## INT-USER-012: Failed Login Attempts Tracking
**Priority**: P1  
**Type**: Integration

### Test Steps
1. Attempt login with wrong password
2. Verify failed_login_attempts incremented
3. Repeat 5 times
4. Verify account locked
5. Attempt login with correct password
6. Verify login blocked
7. Wait for lock expiration
8. Login successful
9. Verify counter reset

### Validation
```sql
-- After failed attempts
SELECT failed_login_attempts, locked_until 
FROM users WHERE email = 'user@example.com';
-- failed_login_attempts = 5
-- locked_until = future timestamp

-- After successful login
SELECT failed_login_attempts FROM users WHERE email = 'user@example.com';
-- failed_login_attempts = 0
```

---

## INT-USER-013: User Data Consistency Across Views
**Priority**: P1  
**Type**: Integration

### Test Steps
1. Create user
2. View in Admin Panel users table
3. View in team detail page
4. View in user's own profile
5. Verify all data matches

### Validation
- Email consistent
- Name consistent
- Role consistent
- Team consistent
- No discrepancies

---

## INT-USER-014: Concurrent User Operations
**Priority**: P2  
**Type**: Integration

### Test Steps
1. Admin A starts editing User X
2. Admin B starts editing User X simultaneously
3. Admin A saves changes
4. Admin B saves changes
5. Verify final state

### Expected Results
- Last write wins OR
- Optimistic locking prevents conflict OR
- Error message about concurrent edit

---

## INT-USER-015: User Email Change Flow
**Priority**: P1  
**Type**: Integration

### Test Steps
1. User has email user@example.com
2. Admin changes to newuser@example.com
3. Verify email updated in database
4. User logs out
5. User logs in with NEW email
6. Login successful

### Validation
```sql
SELECT email FROM users WHERE id = 'user-id';
-- email = 'newuser@example.com'

-- Old email no longer works
SELECT * FROM users WHERE email = 'user@example.com';
-- 0 rows
```

---

## Coverage Summary

| Flow | Scenarios | Coverage |
|------|-----------|----------|
| Creation | 2 | 100% |
| Authentication | 2 | 100% |
| Modification | 5 | 100% |
| Deletion | 1 | 100% |
| Session | 1 | 100% |
| Security | 2 | 100% |
| Data Consistency | 2 | 100% |

**Total Scenarios**: 15  
**Critical (P0)**: 9  
**High (P1)**: 5  
**Medium (P2)**: 1

**End-to-End Coverage**: 100%
