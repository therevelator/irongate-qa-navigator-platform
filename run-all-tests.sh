#!/bin/bash

# Run all SPA-aware E2E tests in headed mode
# This will open Chrome and show you the tests running

echo "🚀 Running all SPA-aware E2E tests..."
echo ""
echo "📊 Test Suites:"
echo "  - auth-spa.spec.ts (11 tests)"
echo "  - user-management-spa.spec.ts (13 tests)"
echo "  - permissions-spa.spec.ts (20 tests)"
echo "  - simple-test.spec.ts (2 tests)"
echo ""
echo "Total: 46 tests"
echo "Expected duration: ~15-20 minutes"
echo ""

npx playwright test \
  auth-spa.spec.ts \
  user-management-spa.spec.ts \
  permissions-spa.spec.ts \
  simple-test.spec.ts \
  --project=chrome \
  --headed \
  --workers=1

echo ""
echo "✅ All tests completed!"
