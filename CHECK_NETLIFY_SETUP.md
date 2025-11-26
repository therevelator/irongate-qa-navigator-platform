# 🔍 Netlify Setup Checklist

## Critical: Check These in Netlify Dashboard

Go to: **https://app.netlify.com/sites/irongate-qa/configuration/env**

### 1. Environment Variables (MUST BE SET!)

You need these two variables:

```bash
DATABASE_URL = mysql://avnadmin:YOUR_AIVEN_PASSWORD@your-mysql-host.aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED

JWT_SECRET = your-generated-jwt-secret-here
```

**If these are NOT set:**
1. Go to Site configuration → Environment variables
2. Click "Add a variable"
3. Add both variables above
4. Go to Deploys tab
5. Click "Trigger deploy" → "Deploy site"

---

## 2. Check Build Logs

Go to: **https://app.netlify.com/sites/irongate-qa/deploys**

Look for errors in the latest deploy:
- ❌ "Function failed to build" - TypeScript/import errors
- ❌ "Module not found" - Missing dependencies
- ✅ "Deploy succeeded" - Good!

---

## 3. Check Function Logs

Go to: **https://app.netlify.com/sites/irongate-qa/functions**

- Do you see a function named **"api"**?
- Click on it → View logs
- Look for errors when you try to login

---

## 4. Test the Function Directly

Open this URL in your browser:
```
https://irongate-qa.netlify.app/.netlify/functions/api/health
```

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-26T...",
  "environment": "netlify-functions"
}
```

**If you get 404:** Function didn't deploy
**If you get 500:** Function has errors (check logs)
**If you get JSON:** Function is working! ✅

---

## 5. Check Network Tab

1. Open your site: https://irongate-qa.netlify.app
2. Press F12 → Network tab
3. Try to login
4. Look for the request to `/api/auth/login`

**What to check:**
- Request URL: Should be `https://irongate-qa.netlify.app/api/auth/login`
- Status: What do you see? (404, 500, 200?)
- Response: What error message?

---

## Common Issues & Fixes

### Issue: Function returns 404
**Cause:** Function didn't build or deploy
**Fix:**
1. Check build logs for errors
2. Ensure `netlify/functions/api.ts` exists
3. Redeploy

### Issue: Function returns 500
**Cause:** Runtime error in function
**Fix:**
1. Check function logs
2. Verify environment variables are set
3. Check database connection

### Issue: CORS error still appears
**Cause:** Frontend still using localhost URL
**Fix:**
1. Clear browser cache (Ctrl+Shift+R)
2. Check Network tab - is request going to localhost or netlify?
3. Verify latest deploy completed

### Issue: "Cannot find module"
**Cause:** Missing dependencies in function
**Fix:**
1. Ensure `serverless-http` is in package.json dependencies (not devDependencies)
2. Redeploy

---

## Quick Debug Steps

Run these in order:

### 1. Test health endpoint
```bash
curl https://irongate-qa.netlify.app/.netlify/functions/api/health
```

### 2. Test auth endpoint
```bash
curl -X POST https://irongate-qa.netlify.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}'
```

### 3. Check if environment variables are accessible
Look in Netlify function logs for database connection attempts

---

## What to Send Me

If still not working, send me:

1. **Build log** - Last 50 lines from latest deploy
2. **Function logs** - From the "api" function
3. **Network tab screenshot** - Showing the failed request
4. **Error message** - Exact CORS error from console

This will help me identify the exact issue!
