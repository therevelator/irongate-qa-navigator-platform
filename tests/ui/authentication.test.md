# Authentication UI Tests

## Test Suite: AUTH-UI
**Priority**: P0 (Critical)  
**Coverage**: Login, Logout, Registration, Session Management

---

## AUTH-UI-001: User Login - Valid Credentials (Super Admin)
**Priority**: P0  
**Type**: Positive

### Preconditions
- User exists in database with email: `admin@irongate.com`, password: `admin123`
- User is not logged in

### Test Steps
1. Navigate to login page (`/`)
2. Enter email: `admin@irongate.com`
3. Enter password: `admin123`
4. Click "Sign In" button

### Expected Results
- User is redirected to Dashboard (home view)
- JWT token is stored in localStorage as `irongate_token`
- User info displayed in sidebar: "Admin User" with super_admin role
- Admin Panel menu item visible
- Can access all teams and users

### Database Validation
```sql
SELECT last_login, failed_login_attempts FROM users WHERE email = 'admin@irongate.com';
-- last_login should be recent timestamp
-- failed_login_attempts = 0
```

---

## AUTH-UI-001B: User Login - Valid Credentials (QA Manager)
**Priority**: P0  
**Type**: Positive

### Preconditions
- User exists: `manager@irongate.com`, password: `manager123`

### Test Steps
1. Navigate to login page
2. Enter email: `manager@irongate.com`
3. Enter password: `manager123`
4. Click "Sign In" button

### Expected Results
- User logged in successfully
- Sidebar shows: "QA Manager" with qa_manager role
- Admin Panel menu item visible
- Can view teams in own department only
- Can create team_lead users

### Database Validation
```sql
SELECT role, department_id FROM users WHERE email = 'manager@irongate.com';
-- role = 'qa_manager'
```

---

## AUTH-UI-001C: User Login - Valid Credentials (Team Lead)
**Priority**: P0  
**Type**: Positive

### Preconditions
- User exists: `lead@irongate.com`, password: `lead123`

### Test Steps
1. Navigate to login page
2. Enter email: `lead@irongate.com`
3. Enter password: `lead123`
4. Click "Sign In" button

### Expected Results
- User logged in successfully
- Sidebar shows: "Team Lead" with team_lead role
- Admin Panel menu item visible
- Can view own team only
- Can create qa_engineer users only

### Database Validation
```sql
SELECT role, primary_team_id FROM users WHERE email = 'lead@irongate.com';
-- role = 'team_lead'
```

---

## AUTH-UI-001D: User Login - Valid Credentials (QA Engineer)
**Priority**: P0  
**Type**: Positive

### Preconditions
- User exists: `engineer@irongate.com`, password: `engineer123`

### Test Steps
1. Navigate to login page
2. Enter email: `engineer@irongate.com`
3. Enter password: `engineer123`
4. Click "Sign In" button

### Expected Results
- User logged in successfully
- Sidebar shows: "QA Engineer" with qa_engineer role
- Admin Panel menu item NOT visible
- Read-only dashboard access
- Cannot create users or teams

---

## AUTH-UI-001E: User Login - Valid Credentials (Viewer)
**Priority**: P0  
**Type**: Positive

### Preconditions
- User exists: `viewer@irongate.com`, password: `viewer123`

### Test Steps
1. Navigate to login page
2. Enter email: `viewer@irongate.com`
3. Enter password: `viewer123`
4. Click "Sign In" button

### Expected Results
- User logged in successfully
- Sidebar shows: "View Only" with viewer role
- Admin Panel menu item NOT visible
- Read-only access to all features
- Cannot modify any data

---

## AUTH-UI-002: User Login - Invalid Email
**Priority**: P0  
**Type**: Negative

### Preconditions
- User is not logged in

### Test Steps
1. Navigate to login page
2. Enter email: `nonexistent@example.com`
3. Enter password: `AnyPassword123`
4. Click "Sign In" button

### Expected Results
- Error message displayed: "Invalid email or password"
- User remains on login page
- No token stored in localStorage
- Login form remains visible

### Database Validation
- No `last_login` update
- No session created

---

## AUTH-UI-003: User Login - Invalid Password
**Priority**: P0  
**Type**: Negative

### Preconditions
- User exists with email: `admin@irongate.com`

### Test Steps
1. Navigate to login page
2. Enter email: `admin@irongate.com`
3. Enter password: `WrongPassword123`
4. Click "Sign In" button

### Expected Results
- Error message: "Invalid email or password"
- User remains on login page
- `failed_login_attempts` incremented in database

### Database Validation
```sql
SELECT failed_login_attempts FROM users WHERE email = 'admin@irongate.com';
-- failed_login_attempts incremented by 1
-- No last_login update
```

---

## AUTH-UI-004: User Login - Account Locked
**Priority**: P0  
**Type**: Negative

### Preconditions
- User has `locked_until` timestamp in future

### Test Steps
1. Navigate to login page
2. Enter valid credentials
3. Click "Sign In" button

### Expected Results
- Error message: "Account is locked. Please try again later."
- User cannot log in
- Locked status persists

### Database Validation
- `locked_until` timestamp unchanged
- No new session created

---

## AUTH-UI-005: User Registration - Valid Data
**Priority**: P0  
**Type**: Positive

### Preconditions
- User is on registration page
- Email `newuser@irongate.com` does not exist

### Test Steps
1. Navigate to registration page
2. Enter first name: `New`
3. Enter last name: `User`
4. Enter email: `newuser@irongate.com`
5. Enter password: `SecurePass123!`
6. Select team: "Nebula" from dropdown
7. Click "Register" button

### Expected Results
- Success message: "Registration successful"
- User redirected to login page or auto-logged in
- New user created in database

### Database Validation
```sql
SELECT * FROM users WHERE email = 'newuser@irongate.com';
-- Verify:
-- - password_hash starts with $2b$ (bcrypt)
-- - is_active = true
-- - email_verified = false (or true based on config)
-- - primary_team_id is set

SELECT * FROM team_members WHERE user_id = (SELECT id FROM users WHERE email = 'newuser@irongate.com');
-- Record exists linking user to team
```

---

## AUTH-UI-006: User Registration - Duplicate Email
**Priority**: P0  
**Type**: Negative

### Preconditions
- User with email `admin@irongate.com` already exists

### Test Steps
1. Navigate to registration page
2. Enter email: `admin@irongate.com`
3. Enter first name: `Test`
4. Enter last name: `Duplicate`
5. Enter password: `Test123!`
6. Select team from dropdown
7. Click "Register" button

### Expected Results
- Error message: "Email already registered"
- Registration form remains visible
- No new user created

### Database Validation
```sql
SELECT COUNT(*) FROM users WHERE email = 'admin@irongate.com';
-- Should still be 1 (no duplicate created)

SELECT first_name, last_name FROM users WHERE email = 'admin@irongate.com';
-- Should still be 'Admin', 'User' (unchanged)
```

---

## AUTH-UI-007: User Registration - Weak Password
**Priority**: P1  
**Type**: Negative

### Test Steps
1. Navigate to registration page
2. Enter password: `123` (too short)
3. Fill other fields
4. Click "Register" button

### Expected Results
- Error message: "Password must be at least 6 characters"
- Form validation prevents submission
- No user created

---

## AUTH-UI-008: User Logout
**Priority**: P0  
**Type**: Positive

### Preconditions
- User is logged in

### Test Steps
1. Click user profile/avatar in sidebar
2. Click "Logout" button

### Expected Results
- User redirected to login page
- JWT token removed from localStorage
- Session cleared
- Cannot access protected routes

### Database Validation
- Session invalidated (if session tracking implemented)

---

## AUTH-UI-009: Session Persistence
**Priority**: P1  
**Type**: Positive

### Preconditions
- User logged in

### Test Steps
1. Log in successfully
2. Refresh the page (F5)
3. Close and reopen browser tab

### Expected Results
- User remains logged in after refresh
- User data persists
- Token still valid in localStorage

---

## AUTH-UI-010: Session Expiration
**Priority**: P1  
**Type**: Positive

### Preconditions
- User logged in
- JWT token expired

### Test Steps
1. Wait for token expiration (or manually expire)
2. Try to access protected route
3. Make API call

### Expected Results
- User redirected to login page
- Error message: "Session expired. Please log in again."
- Token removed from localStorage

---

## AUTH-UI-011: Protected Route Access - Unauthenticated
**Priority**: P0  
**Type**: Negative

### Preconditions
- User not logged in
- No token in localStorage

### Test Steps
1. Navigate directly to `/admin-panel`
2. Navigate to `/dashboard`

### Expected Results
- Redirected to login page
- Cannot access protected content
- URL may show attempted route

---

## AUTH-UI-012: Email Verification Flow
**Priority**: P2  
**Type**: Positive

### Preconditions
- User registered but email not verified

### Test Steps
1. Register new user
2. Check for verification email
3. Click verification link
4. Attempt to log in

### Expected Results
- Verification email sent
- Email link updates `email_verified` to true
- User can log in after verification

### Database Validation
- `email_verified` = true
- `email_verified_at` timestamp set

---

## Coverage Summary

| Scenario | Priority | Type | Status |
|----------|----------|------|--------|
| Valid Login | P0 | Positive | ✓ |
| Invalid Email | P0 | Negative | ✓ |
| Invalid Password | P0 | Negative | ✓ |
| Account Locked | P0 | Negative | ✓ |
| Valid Registration | P0 | Positive | ✓ |
| Duplicate Email | P0 | Negative | ✓ |
| Weak Password | P1 | Negative | ✓ |
| Logout | P0 | Positive | ✓ |
| Session Persistence | P1 | Positive | ✓ |
| Session Expiration | P1 | Positive | ✓ |
| Unauthorized Access | P0 | Negative | ✓ |
| Email Verification | P2 | Positive | ✓ |

**Total Scenarios**: 12  
**Coverage**: Authentication flows, session management, security
