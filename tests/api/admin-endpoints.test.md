# Admin API Endpoints Tests

## Test Suite: API-ADMIN
**Priority**: P0 (Critical)  
**Coverage**: Admin API endpoints, request/response validation

---

## API-ADMIN-001: POST /api/admin/users - Create User (Valid)
**Priority**: P0  
**Type**: Positive

### Request
```http
POST /api/admin/users
Authorization: Bearer {super_admin_token}
Content-Type: application/json

{
  "email": "newuser@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "role": "qa_engineer",
  "teamId": "team-nebula-id",
  "departmentId": "dept-decision-mgmt"
}
```

### Expected Response
```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "id": "user-{timestamp}-{random}",
  "email": "newuser@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "role": "qa_engineer",
  "company_id": "novatech",
  "department_id": "dept-decision-mgmt",
  "primary_team_id": "team-nebula-id",
  "is_active": true,
  "created_at": "{timestamp}",
  "team_name": "Nebula",
  "department_name": "Decision Management"
}
```

### Database Validation
```sql
SELECT * FROM users WHERE email = 'newuser@example.com';
-- Verify all fields match

SELECT * FROM team_members WHERE user_id = (SELECT id FROM users WHERE email = 'newuser@example.com');
-- Verify team membership created
```

---

## API-ADMIN-002: POST /api/admin/users - Missing Required Fields
**Priority**: P0  
**Type**: Negative

### Request
```http
POST /api/admin/users
Authorization: Bearer {token}
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "Pass123!"
  // Missing: firstName, lastName, role, teamId
}
```

### Expected Response
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Missing required fields"
}
```

---

## API-ADMIN-003: POST /api/admin/users - Duplicate Email
**Priority**: P0  
**Type**: Negative

### Preconditions
- User with email `existing@example.com` exists

### Request
```http
POST /api/admin/users
Authorization: Bearer {token}
Content-Type: application/json

{
  "email": "existing@example.com",
  "password": "Pass123!",
  "firstName": "Test",
  "lastName": "User",
  "role": "qa_engineer",
  "teamId": "team-id"
}
```

### Expected Response
```http
HTTP/1.1 400 Bad Request

{
  "error": "Email already registered"
}
```

---

## API-ADMIN-004: POST /api/admin/users - Unauthorized Role Creation
**Priority**: P0  
**Type**: Negative

### Request
```http
POST /api/admin/users
Authorization: Bearer {qa_manager_token}
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "Pass123!",
  "firstName": "Test",
  "lastName": "User",
  "role": "super_admin",  // qa_manager cannot create super_admin
  "teamId": "team-id"
}
```

### Expected Response
```http
HTTP/1.1 403 Forbidden

{
  "error": "qa_manager cannot create super_admin users"
}
```

---

## API-ADMIN-005: POST /api/admin/users - No Authentication
**Priority**: P0  
**Type**: Negative

### Request
```http
POST /api/admin/users
Content-Type: application/json

{
  "email": "test@example.com",
  ...
}
```

### Expected Response
```http
HTTP/1.1 401 Unauthorized

{
  "error": "No token provided" 
}
```

---

## API-ADMIN-006: GET /api/admin/users - Super Admin
**Priority**: P0  
**Type**: Positive

### Request
```http
GET /api/admin/users
Authorization: Bearer {super_admin_token}
```

### Expected Response
```http
HTTP/1.1 200 OK
Content-Type: application/json

[
  {
    "id": "user-1",
    "email": "user1@example.com",
    "first_name": "User",
    "last_name": "One",
    "role": "qa_manager",
    "company_id": "novatech",
    "department_id": "dept-decision-mgmt",
    "primary_team_id": "team-nebula-id",
    "is_active": true,
    "created_at": "2024-01-01T00:00:00.000Z",
    "team_name": "Nebula",
    "department_name": "Decision Management"
  },
  // ... all users in company
]
```

### Validation
- Returns all users in company
- Includes team and department names
- Ordered by created_at DESC

---

## API-ADMIN-007: GET /api/admin/users - QA Manager (Department Scope)
**Priority**: P0  
**Type**: Positive

### Request
```http
GET /api/admin/users
Authorization: Bearer {qa_manager_token}
```

### Expected Response
- HTTP 200 OK
- Returns only users in same department OR created by this manager
- Does not include users from other departments

### Database Validation
```sql
SELECT * FROM users 
WHERE department_id = (SELECT department_id FROM users WHERE id = '{qa_manager_id}')
   OR created_by = '{qa_manager_id}';
```

---

## API-ADMIN-008: GET /api/admin/users - Team Lead (Team Scope)
**Priority**: P0  
**Type**: Positive

### Request
```http
GET /api/admin/users
Authorization: Bearer {team_lead_token}
```

### Expected Response
- HTTP 200 OK
- Returns only users in same team
- Does not include users from other teams

### Database Validation
```sql
SELECT * FROM users WHERE primary_team_id = '{team_lead_primary_team_id}';
```

---

## API-ADMIN-009: POST /api/admin/users/:id/reset-password - Valid
**Priority**: P0  
**Type**: Positive

### Request
```http
POST /api/admin/users/user-123/reset-password
Authorization: Bearer {token}
Content-Type: application/json

{
  "newPassword": "NewSecurePass123!"
}
```

### Expected Response
```http
HTTP/1.1 200 OK

{
  "message": "Password reset successfully"
}
```

### Database Validation
```sql
SELECT password_hash FROM users WHERE id = 'user-123';
-- Verify password_hash changed
-- Verify bcrypt hash (starts with $2b$)
```

---

## API-ADMIN-010: POST /api/admin/users/:id/reset-password - Short Password
**Priority**: P1  
**Type**: Negative

### Request
```http
POST /api/admin/users/user-123/reset-password
Authorization: Bearer {token}
Content-Type: application/json

{
  "newPassword": "123"  // Too short
}
```

### Expected Response
```http
HTTP/1.1 400 Bad Request

{
  "error": "Password must be at least 6 characters"
}
```

---

## API-ADMIN-011: POST /api/admin/users/:id/reset-password - Unauthorized
**Priority**: P0  
**Type**: Negative

### Preconditions
- User A created by Manager X
- Logged in as Manager Y

### Request
```http
POST /api/admin/users/user-a-id/reset-password
Authorization: Bearer {manager_y_token}
Content-Type: application/json

{
  "newPassword": "NewPass123!"
}
```

### Expected Response
```http
HTTP/1.1 403 Forbidden

{
  "error": "You can only reset passwords for users you created or yourself"
}
```

---

## API-ADMIN-012: POST /api/admin/teams - Create Team (Valid)
**Priority**: P0  
**Type**: Positive

### Request
```http
POST /api/admin/teams
Authorization: Bearer {qa_manager_token}
Content-Type: application/json

{
  "name": "Phoenix Team",
  "description": "Innovation team",
  "platform": "Backend"
}
```

### Expected Response
```http
HTTP/1.1 201 Created

{
  "id": "team-{timestamp}-{random}",
  "company_id": "novatech",
  "department_id": "dept-decision-mgmt",
  "name": "Phoenix Team",
  "description": "Innovation team",
  "platform": "Backend",
  "is_active": true,
  "created_at": "{timestamp}"
}
```

### Database Validation
```sql
SELECT * FROM teams WHERE name = 'Phoenix Team';
```

---

## API-ADMIN-013: POST /api/admin/teams - Team Lead Unauthorized
**Priority**: P0  
**Type**: Negative

### Request
```http
POST /api/admin/teams
Authorization: Bearer {team_lead_token}
Content-Type: application/json

{
  "name": "New Team",
  "platform": "Backend"
}
```

### Expected Response
```http
HTTP/1.1 403 Forbidden

{
  "error": "Only QA Managers can create teams"
}
```

---

## API-ADMIN-014: POST /api/admin/teams - Missing Required Fields
**Priority**: P1  
**Type**: Negative

### Request
```http
POST /api/admin/teams
Authorization: Bearer {qa_manager_token}
Content-Type: application/json

{
  "description": "Test team"
  // Missing: name, platform
}
```

### Expected Response
```http
HTTP/1.1 400 Bad Request

{
  "error": "Missing required fields"
}
```

---

## API-ADMIN-015: GET /api/admin/available-roles - Super Admin
**Priority**: P0  
**Type**: Positive

### Request
```http
GET /api/admin/available-roles
Authorization: Bearer {super_admin_token}
```

### Expected Response
```http
HTTP/1.1 200 OK

{
  "availableRoles": ["qa_manager", "team_lead", "qa_engineer", "viewer"]
}
```

---

## API-ADMIN-016: GET /api/admin/available-roles - QA Manager
**Priority**: P0  
**Type**: Positive

### Request
```http
GET /api/admin/available-roles
Authorization: Bearer {qa_manager_token}
```

### Expected Response
```http
HTTP/1.1 200 OK

{
  "availableRoles": ["team_lead"]
}
```

---

## API-ADMIN-017: GET /api/admin/available-roles - Team Lead
**Priority**: P0  
**Type**: Positive

### Request
```http
GET /api/admin/available-roles
Authorization: Bearer {team_lead_token}
```

### Expected Response
```http
HTTP/1.1 200 OK

{
  "availableRoles": ["qa_engineer"]
}
```

---

## API-ADMIN-018: Password Hashing Validation
**Priority**: P0  
**Type**: Security

### Test Steps
1. Create user with password "TestPass123!"
2. Query database for password_hash
3. Verify hash format

### Expected Results
- Password NOT stored in plain text
- Hash starts with `$2b$` (bcrypt)
- Hash length ~60 characters
- Cannot reverse hash to get password

### Database Validation
```sql
SELECT password_hash FROM users WHERE email = 'test@example.com';
-- password_hash LIKE '$2b$%'
-- LENGTH(password_hash) >= 60
```

---

## API-ADMIN-019: JWT Token Validation
**Priority**: P0  
**Type**: Security

### Test Steps
1. Make request with invalid token
2. Make request with expired token
3. Make request with no token

### Expected Results
- Invalid token: 401 Unauthorized
- Expired token: 401 Unauthorized
- No token: 401 Unauthorized
- Clear error messages

---

## API-ADMIN-020: Rate Limiting (if implemented)
**Priority**: P2  
**Type**: Security

### Test Steps
1. Make 100 rapid requests to /api/admin/users

### Expected Results
- Rate limit enforced
- 429 Too Many Requests after threshold
- Retry-After header present

---

## Coverage Summary

| Endpoint | Method | Scenarios | Coverage |
|----------|--------|-----------|----------|
| /api/admin/users | POST | 5 | 100% |
| /api/admin/users | GET | 3 | 100% |
| /api/admin/users/:id/reset-password | POST | 3 | 100% |
| /api/admin/teams | POST | 3 | 100% |
| /api/admin/available-roles | GET | 3 | 100% |
| Security | - | 3 | 100% |

**Total Scenarios**: 20  
**Critical (P0)**: 16  
**High (P1)**: 2  
**Medium (P2)**: 2
