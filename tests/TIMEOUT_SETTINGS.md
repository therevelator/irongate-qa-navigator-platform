# Test Timeout Settings

## ⏱️ Current Configuration

### Playwright Config (`playwright.config.ts`)

| Setting | Timeout | Purpose |
|---------|---------|---------|
| **Test Timeout** | 60 seconds | Maximum time for entire test |
| **Expect Timeout** | 10 seconds | Maximum time for assertions |
| **Action Timeout** | 15 seconds | Maximum time for click, fill, etc. |
| **Navigation Timeout** | 30 seconds | Maximum time for page.goto() |
| **WebServer Timeout** | 180 seconds | Time to wait for app to start |

### Auth Helpers (`auth-helpers.ts`)

| Operation | Timeout | Purpose |
|-----------|---------|---------|
| **Page Load** | 30 seconds | Initial page.goto() |
| **Form Visibility** | 15 seconds | Wait for login form |
| **Navigation** | 30 seconds | Wait for redirect after login |
| **Loader Hidden** | 10 seconds | Wait for loading spinner |
| **Network Idle** | 15 seconds | Wait for all requests to complete |
| **Buffer Delay** | 1 second | Extra time for UI to settle |

## 🚀 Performance Tips

### If Tests Are Still Timing Out:

1. **Check if app is running**:
   ```bash
   # Make sure this is running first
   npm start
   
   # Wait for both to show:
   # ✅ Server running on http://localhost:3000
   # ✅ Local: http://localhost:5173/
   ```

2. **Increase specific timeouts**:
   ```typescript
   // In your test
   await page.click('button', { timeout: 30000 }); // 30 seconds
   ```

3. **Use headed mode to see what's slow**:
   ```bash
   npm run test:e2e:headed
   ```

4. **Check network tab** in headed mode to see what's loading slowly

## 🎯 Optimization Strategies

### Current Settings Are Optimized For:
- ✅ Slow initial page load (30s navigation timeout)
- ✅ Loading spinners (10s wait for hidden)
- ✅ Network requests (15s for networkidle)
- ✅ UI animations (1s buffer)
- ✅ Sequential execution (no parallel conflicts)

### Why Sequential Execution?
```typescript
fullyParallel: false,  // Run one test at a time
workers: 1,            // Single worker
```

**Benefits**:
- No database conflicts
- No port conflicts
- More reliable on slower machines
- Easier to debug

**Trade-off**: Tests take longer but are more stable

## 📊 Expected Test Duration

| Test Suite | Tests | Duration |
|------------|-------|----------|
| Authentication | 11 | ~3-4 min |
| User Management | 6 | ~2-3 min |
| Permissions | 10 | ~3-4 min |
| **Total E2E** | **27** | **~8-11 min** |

## 🔧 Adjusting Timeouts

### Make Tests Faster (if your machine is fast):

```typescript
// playwright.config.ts
timeout: 30 * 1000,           // 30s instead of 60s
actionTimeout: 10 * 1000,     // 10s instead of 15s
navigationTimeout: 20 * 1000, // 20s instead of 30s
```

### Make Tests More Patient (if tests still fail):

```typescript
// playwright.config.ts
timeout: 90 * 1000,           // 90s instead of 60s
actionTimeout: 20 * 1000,     // 20s instead of 15s
navigationTimeout: 45 * 1000, // 45s instead of 30s
```

## 🐛 Debugging Slow Tests

### Find What's Slow:

1. **Run in UI mode**:
   ```bash
   npm run test:e2e:ui
   ```
   - Watch the timeline
   - See which step takes longest

2. **Check trace**:
   ```bash
   npx playwright show-trace test-results/trace.zip
   ```
   - See network requests
   - See timing for each action

3. **Add console logs**:
   ```typescript
   console.time('Login');
   await loginAsSuperAdmin(page);
   console.timeEnd('Login');
   ```

## ⚡ Quick Fixes

### App Not Loading Fast Enough?

```bash
# Make sure app is fully started before running tests
npm start

# Wait for these messages:
# [BACKEND] ✅ Database connected successfully
# [BACKEND] 🚀 Server running on http://localhost:3000
# [FRONTEND] ➜  Local:   http://localhost:5173/

# Then in another terminal:
npm run test:e2e:ui
```

### Database Queries Slow?

```sql
-- Check if indexes exist
SHOW INDEXES FROM users;
SHOW INDEXES FROM teams;

-- Add indexes if missing
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

### Network Requests Slow?

- Check backend logs for slow queries
- Ensure MySQL is running locally (not remote)
- Check if metrics sync job is running (might slow things down)

## 📝 Best Practices

1. **Always wait for loading to complete**:
   ```typescript
   await page.click('text=Admin Panel');
   await waitForLoadingToComplete(page); // ← Important!
   ```

2. **Use specific selectors** (faster than generic):
   ```typescript
   // ✅ Fast
   await page.click('[data-testid="create-btn"]');
   
   // ❌ Slower
   await page.click('button');
   ```

3. **Don't wait unnecessarily**:
   ```typescript
   // ❌ Bad
   await page.waitForTimeout(5000); // Always waits 5s
   
   // ✅ Good
   await page.waitForSelector('button'); // Waits only as long as needed
   ```

4. **Reuse existing server**:
   ```typescript
   // playwright.config.ts
   reuseExistingServer: true, // Don't restart app for each test run
   ```

---

**Last Updated**: 2024-11-21  
**Recommended**: Keep current settings unless tests consistently fail
