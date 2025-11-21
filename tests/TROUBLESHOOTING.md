# Test Troubleshooting Guide

## Common Issues and Solutions

### ❌ Tests Failing Due to Loading Spinner

**Problem**: Tests fail because the IronGate loader blocks interactions

**Solution**: Use the `waitForLoadingToComplete()` helper

```typescript
import { waitForLoadingToComplete } from './fixtures/auth-helpers';

// After navigation or any action that triggers loading
await page.click('text=Admin Panel');
await waitForLoadingToComplete(page);  // ← Add this
await expect(page.locator('h1')).toBeVisible();
```

**What it does**:
- Waits for `.irongate-loader` to disappear
- Waits for `[data-loading="true"]` to disappear
- Waits for common loading indicators
- Adds small delay for UI to settle

---

### ❌ "Element is not visible" Errors

**Problem**: Test tries to interact with element before it's ready

**Solutions**:

1. **Use Playwright's auto-waiting** (preferred):
```typescript
// Playwright automatically waits for element to be visible
await page.click('button:has-text("Create User")');
```

2. **Explicit wait**:
```typescript
await page.waitForSelector('button:has-text("Create User")', { state: 'visible' });
await page.click('button:has-text("Create User")');
```

3. **Wait for loading**:
```typescript
await waitForLoadingToComplete(page);
```

---

### ❌ "Timeout exceeded" Errors

**Problem**: Operation takes longer than expected

**Solutions**:

1. **Increase timeout for specific action**:
```typescript
await page.click('button', { timeout: 10000 }); // 10 seconds
```

2. **Wait for network to be idle**:
```typescript
await page.waitForLoadState('networkidle');
```

3. **Check if app is running**:
```bash
# Make sure this is running in another terminal
npm start
```

---

### ❌ Login Tests Failing

**Problem**: Login doesn't complete or redirects incorrectly

**Checklist**:
- ✅ App is running (`npm start`)
- ✅ Database is seeded with test users
- ✅ `.env` file exists with correct credentials
- ✅ Backend is responding (check http://localhost:3000/api)

**Debug**:
```bash
# Run in headed mode to see what's happening
npm run test:e2e:headed

# Or debug mode
npm run test:e2e:debug
```

---

### ❌ "Cannot connect to database" Errors

**Problem**: Database tests can't connect to MySQL

**Solutions**:

1. **Check MySQL is running**:
```bash
mysql -u root -p
```

2. **Verify credentials in `.env`**:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=irongate_qa
```

3. **Check database exists**:
```bash
mysql -u root -p -e "SHOW DATABASES LIKE 'irongate_qa';"
```

---

### ❌ "User already exists" Errors

**Problem**: Test tries to create user that already exists

**Solutions**:

1. **Use unique emails with timestamps** (already implemented):
```typescript
const timestamp = Date.now();
const email = `test-${timestamp}@irongate.com`;
```

2. **Clean up after tests**:
```typescript
test.afterEach(async ({ page }) => {
  // Delete test users created during test
});
```

---

### ❌ Flaky Tests (Pass Sometimes, Fail Sometimes)

**Common Causes & Fixes**:

1. **Race conditions**:
```typescript
// ❌ Bad
await page.click('button');
await page.click('input'); // Might click before page updates

// ✅ Good
await page.click('button');
await waitForLoadingToComplete(page);
await page.click('input');
```

2. **Network delays**:
```typescript
// Wait for network to settle
await page.waitForLoadState('networkidle');
```

3. **Animation timing**:
```typescript
// Wait for animations to complete
await page.waitForTimeout(300);
```

---

### ❌ Tests Pass Locally but Fail in CI

**Common Issues**:

1. **Different timing in CI**:
   - CI is slower, increase timeouts
   - Add more explicit waits

2. **Database not seeded**:
   - Check CI workflow runs seed scripts
   - Verify `.github/workflows/test.yml`

3. **Environment variables**:
   - Ensure `.env` is created in CI
   - Check workflow creates proper config

---

## Best Practices to Avoid Issues

### ✅ Always Wait for Loading

```typescript
// After any navigation
await page.click('text=Admin Panel');
await waitForLoadingToComplete(page);

// After any data mutation
await page.click('button:has-text("Create User")');
await waitForLoadingToComplete(page);
```

### ✅ Use Specific Selectors

```typescript
// ❌ Too generic
await page.click('button');

// ✅ Specific
await page.click('button:has-text("Create User")');

// ✅ Even better with test IDs
await page.click('[data-testid="create-user-btn"]');
```

### ✅ Add Assertions Before Actions

```typescript
// Ensure element is ready
await expect(page.locator('button:has-text("Create User")')).toBeVisible();
await page.click('button:has-text("Create User")');
```

### ✅ Use Playwright's Auto-Waiting

Playwright automatically waits for:
- Element to be visible
- Element to be enabled
- Element to be stable (not animating)

So usually you don't need explicit waits!

---

## Debugging Tools

### 1. **Playwright UI Mode** (Best for debugging)
```bash
npm run test:e2e:ui
```
- See test execution step by step
- Inspect DOM at each step
- Time travel through test

### 2. **Headed Mode** (See the browser)
```bash
npm run test:e2e:headed
```

### 3. **Debug Mode** (Pause and inspect)
```bash
npm run test:e2e:debug
```

### 4. **Screenshots on Failure**
Automatically saved in `test-results/` folder

### 5. **Trace Viewer**
```bash
npx playwright show-trace test-results/trace.zip
```

---

## Quick Fixes Checklist

When tests fail, try these in order:

1. ✅ Is `npm start` running?
2. ✅ Wait 30 seconds for app to fully start
3. ✅ Can you access http://localhost:5173 in browser?
4. ✅ Can you login manually with test credentials?
5. ✅ Run in UI mode: `npm run test:e2e:ui`
6. ✅ Check for loading spinners blocking interactions
7. ✅ Add `await waitForLoadingToComplete(page)`
8. ✅ Increase timeouts if needed
9. ✅ Check test output and screenshots

---

## Getting Help

If tests still fail:

1. **Check the error message** - it usually tells you what's wrong
2. **Look at screenshots** in `test-results/`
3. **Run in UI mode** to see what's happening
4. **Check application logs** in the terminal running `npm start`
5. **Verify database state** with MySQL queries

---

**Last Updated**: 2024-11-21
