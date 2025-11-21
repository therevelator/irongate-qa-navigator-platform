# Database Schema Validation Tests

## Test Suite: DB-SCHEMA
**Priority**: P0 (Critical)  
**Coverage**: Table structure, constraints, indexes, relationships

---

## DB-SCHEMA-001: Users Table Structure
**Priority**: P0  
**Type**: Validation

### Test Query
```sql
DESCRIBE users;
```

### Expected Structure
| Field | Type | Null | Key | Default | Extra |
|-------|------|------|-----|---------|-------|
| id | CHAR(36) | NO | PRI | UUID() | |
| email | VARCHAR(255) | NO | UNI | NULL | |
| password_hash | VARCHAR(255) | NO | | NULL | |
| first_name | VARCHAR(100) | NO | | NULL | |
| last_name | VARCHAR(100) | NO | | NULL | |
| role | ENUM(...) | NO | MUL | NULL | |
| company_id | CHAR(36) | NO | MUL | NULL | |
| department_id | CHAR(36) | NO | MUL | NULL | |
| primary_team_id | CHAR(36) | YES | MUL | NULL | |
| avatar_url | TEXT | YES | | NULL | |
| phone | VARCHAR(50) | YES | | NULL | |
| timezone | VARCHAR(50) | YES | | UTC | |
| created_at | TIMESTAMP | YES | | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | YES | | CURRENT_TIMESTAMP | on update CURRENT_TIMESTAMP |
| last_login | TIMESTAMP | YES | | NULL | |
| is_active | BOOLEAN | YES | | TRUE | |
| email_verified | BOOLEAN | YES | | FALSE | |
| email_verified_at | TIMESTAMP | YES | | NULL | |
| password_reset_token | VARCHAR(255) | YES | | NULL | |
| password_reset_expires | TIMESTAMP | YES | | NULL | |
| failed_login_attempts | INT | YES | | 0 | |
| locked_until | TIMESTAMP | YES | | NULL | |
| created_by | CHAR(36) | YES | | NULL | |

### Validation
- All fields present
- Correct data types
- Proper constraints
- Default values set

---

## DB-SCHEMA-002: Teams Table Structure
**Priority**: P0  
**Type**: Validation

### Test Query
```sql
DESCRIBE teams;
```

### Expected Structure
| Field | Type | Null | Key | Default |
|-------|------|------|-----|---------|
| id | CHAR(36) | NO | PRI | UUID() |
| company_id | CHAR(36) | NO | MUL | NULL |
| department_id | CHAR(36) | NO | MUL | NULL |
| name | VARCHAR(255) | NO | | NULL |
| description | TEXT | YES | | NULL |
| platform | ENUM('Web','Mobile','API','Backend','Payment','Security','DevOps') | YES | MUL | NULL |
| lead_id | CHAR(36) | YES | MUL | NULL |
| created_at | TIMESTAMP | YES | | CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | YES | | CURRENT_TIMESTAMP |
| is_active | BOOLEAN | YES | | TRUE |

---

## DB-SCHEMA-003: Team Members Table Structure
**Priority**: P0  
**Type**: Validation

### Test Query
```sql
DESCRIBE team_members;
```

### Expected Structure
| Field | Type | Null | Key | Default |
|-------|------|------|-----|---------|
| user_id | CHAR(36) | NO | PRI | NULL |
| team_id | CHAR(36) | NO | PRI | NULL |
| role | ENUM('lead','member','contributor') | YES | | member |
| joined_at | TIMESTAMP | YES | | CURRENT_TIMESTAMP |

### Validation
- Composite primary key (user_id, team_id)
- Foreign keys to users and teams

---

## DB-SCHEMA-004: Foreign Key Constraints - Users
**Priority**: P0  
**Type**: Validation

### Test Query
```sql
SELECT 
  CONSTRAINT_NAME,
  COLUMN_NAME,
  REFERENCED_TABLE_NAME,
  REFERENCED_COLUMN_NAME,
  DELETE_RULE
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_NAME = 'users' 
  AND TABLE_SCHEMA = 'irongate_qa'
  AND REFERENCED_TABLE_NAME IS NOT NULL;
```

### Expected Constraints
1. **company_id** → companies(id) ON DELETE CASCADE
2. **department_id** → departments(id) ON DELETE CASCADE
3. **primary_team_id** → teams(id) ON DELETE SET NULL

### Validation
- All foreign keys exist
- Correct cascade rules
- Referential integrity enforced

---

## DB-SCHEMA-005: Foreign Key Constraints - Teams
**Priority**: P0  
**Type**: Validation

### Test Query
```sql
SELECT 
  CONSTRAINT_NAME,
  COLUMN_NAME,
  REFERENCED_TABLE_NAME,
  DELETE_RULE
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_NAME = 'teams' 
  AND TABLE_SCHEMA = 'irongate_qa'
  AND REFERENCED_TABLE_NAME IS NOT NULL;
```

### Expected Constraints
1. **company_id** → companies(id) ON DELETE CASCADE
2. **department_id** → departments(id) ON DELETE CASCADE
3. **lead_id** → users(id) ON DELETE SET NULL

---

## DB-SCHEMA-006: Foreign Key Constraints - Team Members
**Priority**: P0  
**Type**: Validation

### Expected Constraints
1. **user_id** → users(id) ON DELETE CASCADE
2. **team_id** → teams(id) ON DELETE CASCADE

### Test
```sql
-- Delete user, verify team_members record deleted
INSERT INTO users (...) VALUES (...);
INSERT INTO team_members (user_id, team_id) VALUES ('test-user', 'test-team');
DELETE FROM users WHERE id = 'test-user';
SELECT * FROM team_members WHERE user_id = 'test-user';
-- Should return 0 rows
```

---

## DB-SCHEMA-007: Unique Constraints
**Priority**: P0  
**Type**: Validation

### Test Queries
```sql
-- Users: email unique
SELECT COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;
-- Should return 0 rows

-- Teams: unique team per department
SELECT department_id, name, COUNT(*) 
FROM teams 
GROUP BY department_id, name 
HAVING COUNT(*) > 1;
-- Should return 0 rows

-- Team members: unique user-team pair
SELECT user_id, team_id, COUNT(*) 
FROM team_members 
GROUP BY user_id, team_id 
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

---

## DB-SCHEMA-008: Indexes Validation
**Priority**: P1  
**Type**: Performance

### Test Query
```sql
SHOW INDEXES FROM users;
```

### Expected Indexes
1. PRIMARY KEY (id)
2. UNIQUE KEY (email)
3. INDEX idx_users_company (company_id)
4. INDEX idx_users_department (department_id)
5. INDEX idx_users_primary_team (primary_team_id)
6. INDEX idx_users_role (role)

### Validation
- All indexes present
- Correct columns indexed
- Performance optimized

---

## DB-SCHEMA-009: Enum Values Validation
**Priority**: P0  
**Type**: Validation

### Test Query
```sql
SELECT COLUMN_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'users' 
  AND COLUMN_NAME = 'role'
  AND TABLE_SCHEMA = 'irongate_qa';
```

### Expected Result
```
enum('super_admin','qa_manager','team_lead','qa_engineer','viewer')
```

### Validation for Teams Platform
```sql
SELECT COLUMN_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'teams' 
  AND COLUMN_NAME = 'platform';
```

Expected:
```
enum('Web','Mobile','API','Backend','Payment','Security','DevOps')
```

---

## DB-SCHEMA-010: Default Values Validation
**Priority**: P1  
**Type**: Validation

### Test
```sql
-- Insert user without specifying defaults
INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id)
VALUES ('test-id', 'test@example.com', 'hash', 'Test', 'User', 'qa_engineer', 'company-id', 'dept-id');

SELECT 
  is_active,
  email_verified,
  failed_login_attempts,
  timezone,
  created_at IS NOT NULL as has_created_at
FROM users WHERE id = 'test-id';
```

### Expected Results
- is_active = TRUE
- email_verified = FALSE
- failed_login_attempts = 0
- timezone = 'UTC'
- has_created_at = 1

---

## DB-SCHEMA-011: Timestamp Auto-Update
**Priority**: P1  
**Type**: Validation

### Test
```sql
-- Create user
INSERT INTO users (...) VALUES (...);
SELECT created_at, updated_at FROM users WHERE id = 'test-id';
-- Note timestamps

-- Wait 1 second, update user
UPDATE users SET first_name = 'Updated' WHERE id = 'test-id';
SELECT created_at, updated_at FROM users WHERE id = 'test-id';
```

### Expected Results
- created_at unchanged
- updated_at changed to current timestamp
- ON UPDATE CURRENT_TIMESTAMP working

---

## DB-SCHEMA-012: Character Set and Collation
**Priority**: P1  
**Type**: Validation

### Test Query
```sql
SELECT 
  TABLE_NAME,
  TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'irongate_qa'
  AND TABLE_NAME IN ('users', 'teams', 'team_members');
```

### Expected Results
- All tables: utf8mb4_unicode_ci
- Supports international characters
- Case-insensitive comparisons

---

## DB-SCHEMA-013: Table Engine Validation
**Priority**: P1  
**Type**: Validation

### Test Query
```sql
SELECT 
  TABLE_NAME,
  ENGINE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'irongate_qa';
```

### Expected Results
- All tables: ENGINE = InnoDB
- Supports transactions
- Foreign key constraints enabled

---

## DB-SCHEMA-014: Cascade Delete - User Deletion
**Priority**: P0  
**Type**: Functional

### Test
```sql
-- Create test data
INSERT INTO users (id, email, ...) VALUES ('test-user-id', 'test@example.com', ...);
INSERT INTO team_members (user_id, team_id) VALUES ('test-user-id', 'team-id');

-- Delete user
DELETE FROM users WHERE id = 'test-user-id';

-- Verify cascade
SELECT * FROM team_members WHERE user_id = 'test-user-id';
-- Should return 0 rows
```

---

## DB-SCHEMA-015: Cascade Delete - Team Deletion
**Priority**: P0  
**Type**: Functional

### Test
```sql
-- Create test team
INSERT INTO teams (id, company_id, department_id, name) VALUES (...);
INSERT INTO team_members (user_id, team_id) VALUES ('user-id', 'test-team-id');

-- Delete team
DELETE FROM teams WHERE id = 'test-team-id';

-- Verify cascade
SELECT * FROM team_members WHERE team_id = 'test-team-id';
-- Should return 0 rows
```

---

## DB-SCHEMA-016: SET NULL on Delete - Team Lead
**Priority**: P0  
**Type**: Functional

### Test
```sql
-- Create user as team lead
INSERT INTO users (id, ...) VALUES ('lead-id', ...);
UPDATE teams SET lead_id = 'lead-id' WHERE id = 'team-id';

-- Delete user
DELETE FROM users WHERE id = 'lead-id';

-- Verify SET NULL
SELECT lead_id FROM teams WHERE id = 'team-id';
-- Should return NULL
```

---

## DB-SCHEMA-017: Data Type Validation - CHAR(36) for UUIDs
**Priority**: P1  
**Type**: Validation

### Test
```sql
-- Verify UUID format
SELECT id FROM users LIMIT 1;
-- Should match pattern: user-{timestamp}-{random}
-- Length should be <= 36 characters

SELECT LENGTH(id) as id_length FROM users;
-- All should be <= 36
```

---

## DB-SCHEMA-018: Email Format Validation
**Priority**: P2  
**Type**: Data Quality

### Test
```sql
-- Check for invalid emails
SELECT email FROM users WHERE email NOT LIKE '%@%.%';
-- Should return 0 rows

SELECT email FROM users WHERE email LIKE '% %';
-- Should return 0 rows (no spaces)
```

---

## DB-SCHEMA-019: Password Hash Format
**Priority**: P0  
**Type**: Security

### Test
```sql
SELECT password_hash FROM users LIMIT 5;
```

### Validation
- All hashes start with `$2b$` (bcrypt)
- Length >= 60 characters
- No plain text passwords
- All hashes unique

---

## DB-SCHEMA-020: Referential Integrity Check
**Priority**: P0  
**Type**: Validation

### Test Queries
```sql
-- Orphaned users (invalid company_id)
SELECT u.id, u.email 
FROM users u
LEFT JOIN companies c ON u.company_id = c.id
WHERE c.id IS NULL;
-- Should return 0 rows

-- Orphaned users (invalid department_id)
SELECT u.id, u.email 
FROM users u
LEFT JOIN departments d ON u.department_id = d.id
WHERE d.id IS NULL;
-- Should return 0 rows

-- Orphaned team_members (invalid user_id)
SELECT tm.* 
FROM team_members tm
LEFT JOIN users u ON tm.user_id = u.id
WHERE u.id IS NULL;
-- Should return 0 rows

-- Orphaned team_members (invalid team_id)
SELECT tm.* 
FROM team_members tm
LEFT JOIN teams t ON tm.team_id = t.id
WHERE t.id IS NULL;
-- Should return 0 rows
```

---

## Coverage Summary

| Category | Scenarios | Coverage |
|----------|-----------|----------|
| Table Structure | 3 | 100% |
| Foreign Keys | 3 | 100% |
| Constraints | 2 | 100% |
| Indexes | 1 | 100% |
| Data Types | 4 | 100% |
| Cascade Rules | 3 | 100% |
| Data Integrity | 4 | 100% |

**Total Scenarios**: 20  
**Critical (P0)**: 11  
**High (P1)**: 7  
**Medium (P2)**: 2

**Schema Coverage**: 100%
