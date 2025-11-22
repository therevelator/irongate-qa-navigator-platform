# API Tests Debugging Guide

## 🐛 Current Issue

API tests pass **locally** but fail in **GitHub Actions** with 500 errors.

### Failing Tests:
1. `API-ADMIN-001`: Create user with valid data
2. `API-ADMIN-007`: Get department-scoped users for QA Manager

## 🔍 What We Know

### **Local Environment** ✅
- All 11 API tests pass
- Database has correct seed data
- Users exist with proper setup:
  - `admin@irongate.com` - super_admin
  - `manager@irongate.com` - qa_manager  
  - `lead@irongate.com` - team_lead

### **CI Environment** ❌
- Tests get 500 Internal Server Error
- Backend is running (port 3000 listening)
- Database is seeded

## 🛠️ Debugging Steps Added

### 1. Token Validation
Added checks to ensure login tokens are valid:
```typescript
if (!adminRes.body.token) {
  console.error('Super admin login failed:', adminRes.body);
  throw new Error('Failed to get super admin token');
}
```

### 2. Error Logging
Added error logging to failing tests:
```typescript
if (response.status !== 201) {
  console.error('Create user failed:', response.status, response.body);
}
```

## 📊 Expected vs Actual

### **Create User Test**
**Expected**: 201 Created  
**Actual**: 500 Internal Server Error

**Payload**:
```json
{
  "email": "test-1234567890@irongate.com",
  "password": "TestPass123!",
  "firstName": "Test",
  "lastName": "User",
  "role": "qa_engineer",
  "teamId": "team-quasars",
  "departmentId": "dept-decision-mgmt"
}
```

### **Get Users Test (QA Manager)**
**Expected**: 200 OK with array of users  
**Actual**: 500 Internal Server Error

## 🎯 Possible Causes

### 1. Database Connection Issues
- CI database might not be fully initialized
- Seed data might not have run completely

### 2. Missing Data
- Teams or departments might not exist in CI
- User relationships might be broken

### 3. Timing Issues
- Backend might not be fully ready
- Database connections might be slow

### 4. Environment Differences
- Different MySQL version
- Different Node.js behavior
- Case sensitivity in table/column names

## 🔧 Next Steps

### **Check GitHub Actions Logs**
Look for these error messages in the next run:
```
Super admin login failed: {...}
QA Manager login failed: {...}
Create user failed: 500 {...}
QA Manager get users failed: 500 {...}
```

### **If Login Fails**
- Check seed_demo_users.sql is loaded
- Verify password hashes match
- Check database connection

### **If Create User Fails**
- Check if team-quasars exists
- Check if dept-decision-mgmt exists
- Check backend logs for actual error

### **If Get Users Fails**
- Check QA Manager user has department_id
- Check SQL query syntax
- Check for NULL values breaking query

## 📝 Database Requirements

### **Required Teams**
```sql
SELECT id, name FROM teams WHERE id IN ('team-quasars', 'team-pulsars', 'team-watchmen');
```

### **Required Departments**
```sql
SELECT id, name FROM departments WHERE id = 'dept-decision-mgmt';
```

### **Required Users**
```sql
SELECT email, role, department_id, primary_team_id 
FROM users 
WHERE email IN ('admin@irongate.com', 'manager@irongate.com', 'lead@irongate.com');
```

## 🚀 Temporary Workaround

If tests continue to fail in CI, we can:

1. **Skip failing tests in CI** (not ideal):
   ```typescript
   it.skip('API-ADMIN-001: should create user', async () => {
   ```

2. **Make tests more resilient**:
   - Add retry logic
   - Add longer timeouts
   - Check if data exists before testing

3. **Simplify tests**:
   - Remove department scoping
   - Use simpler queries
   - Test only critical paths

## 📈 Success Criteria

Tests will pass when:
- ✅ All logins succeed (tokens received)
- ✅ Create user returns 201
- ✅ Get users returns 200 with array
- ✅ No 500 errors

---

**Last Updated**: 2024-11-23  
**Status**: Debugging in progress  
**Next Action**: Check GitHub Actions logs for error details
