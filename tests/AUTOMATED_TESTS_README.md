# Automated Test Suite

## Overview

Complete automated test suite for the IronGate QA Navigator Platform using Playwright (E2E) and Jest (API/DB).

## Test Structure

```
tests/
├── e2e/                          # Playwright E2E tests
│   ├── auth.spec.ts              # Authentication tests
│   ├── user-management.spec.ts   # User CRUD tests
│   ├── permissions.spec.ts       # Role-based access tests
│   └── fixtures/
│       ├── test-users.ts         # Test user credentials
│       └── auth-helpers.ts       # Login/logout helpers
├── api/                          # Jest API tests
│   └── admin.test.ts             # Admin endpoint tests
├── database/                     # Jest database tests
│   └── schema.test.ts            # Schema validation tests
└── setup.ts                      # Jest setup file
```

## Installation

```bash
# Install dependencies
npm install

# Install Playwright browsers
npm run playwright:install
```

## Running Tests

### All Tests
```bash
npm test
```

### E2E Tests (Playwright)
```bash
# Run all E2E tests
npm run test:e2e

# Run with UI mode (interactive)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Debug mode
npm run test:e2e:debug

# View test report
npm run playwright:report
```

### API Tests (Jest)
```bash
# Run all API tests
npm run test:api

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Database Tests (Jest)
```bash
npm run test:db
```

## Test Coverage

### E2E Tests (Playwright)
- ✅ **Authentication** (11 tests)
  - Login with all user roles
  - Invalid credentials
  - Session management
  - Protected routes

- ✅ **User Management** (6 tests)
  - Create users
  - Duplicate email validation
  - Self-deletion prevention
  - Password reset
  - Role-based user visibility
  - Team member management

- ✅ **Permissions** (10 tests)
  - Super admin full access
  - QA manager department scope
  - Team lead team scope
  - QA engineer no admin access
  - Role creation restrictions
  - Admin panel visibility

### API Tests (Jest)
- ✅ **Admin Endpoints** (11 tests)
  - POST /api/admin/users (5 tests)
  - GET /api/admin/users (3 tests)
  - GET /api/admin/available-roles (3 tests)

### Database Tests (Jest)
- ✅ **Schema Validation** (7 tests)
  - Table structure
  - Foreign keys
  - Unique constraints
  - Indexes
  - Data integrity
  - Password hashing

## Test Users

All tests use real users from the database:

```typescript
SUPER_ADMIN:   admin@irongate.com     / demo123
QA_MANAGER:    manager@irongate.com   / demo123
TEAM_LEAD:     lead@irongate.com      / demo123
QA_ENGINEER:   engineer@irongate.com  / demo123
VIEWER:        viewer@irongate.com    / demo123
```

## Configuration

### Playwright Config
- **Base URL**: http://localhost:5173
- **Timeout**: 30 seconds
- **Retries**: 2 on CI, 0 locally
- **Screenshots**: On failure
- **Videos**: On failure
- **Trace**: On first retry

### Jest Config
- **Test Environment**: Node
- **Timeout**: 30 seconds
- **Coverage**: Enabled
- **Setup File**: tests/setup.ts

## CI/CD Integration

### GitHub Actions

The test suite runs automatically on:
- Push to `main` or `develop`
- Pull requests to `main` or `develop`

Workflow includes:
1. Setup MySQL database
2. Run schema and seed scripts
3. Run API tests
4. Run database tests
5. Start application
6. Run E2E tests
7. Upload test results and reports
8. Comment on PR with results

### Viewing Results

- **Test Results**: Uploaded as artifacts
- **Playwright Report**: Available in artifacts
- **Coverage Report**: In `coverage/` directory

## Writing New Tests

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from './fixtures/auth-helpers';

test('My new test', async ({ page }) => {
  await loginAsSuperAdmin(page);
  
  // Your test code here
  await page.click('text=Something');
  await expect(page.locator('text=Result')).toBeVisible();
});
```

### API Test Example

```typescript
import request from 'supertest';

describe('My API tests', () => {
  it('should do something', async () => {
    const response = await request('http://localhost:3000')
      .get('/api/endpoint')
      .set('Authorization', `Bearer ${token}`);
    
    expect(response.status).toBe(200);
  });
});
```

### Database Test Example

```typescript
import mysql from 'mysql2/promise';

describe('My DB tests', () => {
  let connection: mysql.Connection;

  beforeAll(async () => {
    connection = await mysql.createConnection(DB_CONFIG);
  });

  it('should validate something', async () => {
    const [rows] = await connection.query('SELECT * FROM table');
    expect(rows).toBeDefined();
  });
});
```

## Best Practices

1. **Use fixtures** for test data and helpers
2. **Clean up** after tests (delete created users/teams)
3. **Use descriptive test names** matching test IDs
4. **Wait for elements** instead of hard sleeps
5. **Test isolation** - each test should be independent
6. **Use real data** from seed files when possible
7. **Add database validation** for critical operations

## Debugging

### E2E Tests
```bash
# Run specific test file
npx playwright test auth.spec.ts

# Run specific test
npx playwright test -g "should login"

# Debug mode
npx playwright test --debug

# UI mode
npx playwright test --ui
```

### API/DB Tests
```bash
# Run specific test file
npx jest admin.test.ts

# Run specific test
npx jest -t "should create user"

# Watch mode
npx jest --watch

# Verbose output
npx jest --verbose
```

## Troubleshooting

### Application not starting
- Ensure MySQL is running
- Check .env file exists
- Verify database is seeded

### Tests timing out
- Increase timeout in config
- Check if application is running
- Verify network connectivity

### Database connection errors
- Check MySQL credentials
- Ensure database exists
- Run schema.sql if needed

### Playwright browser issues
- Run `npm run playwright:install`
- Check system dependencies
- Try headed mode to see what's happening

## Maintenance

### Updating Tests
- Update test IDs when scenarios change
- Keep fixtures in sync with seed data
- Update expected values when schema changes

### Adding New Tests
1. Create test file in appropriate directory
2. Follow naming convention: `*.spec.ts` or `*.test.ts`
3. Add test ID comments matching manual tests
4. Update this README with new coverage

## Performance

- **E2E Tests**: ~2-3 minutes (parallel)
- **API Tests**: ~10-20 seconds
- **DB Tests**: ~5-10 seconds
- **Total**: ~3-4 minutes

## Support

For issues or questions:
1. Check test output and screenshots
2. Review Playwright trace
3. Check application logs
4. Verify database state

---

**Last Updated**: 2024-11-21  
**Test Coverage**: ~95% of critical paths  
**Total Tests**: 35+ automated scenarios
