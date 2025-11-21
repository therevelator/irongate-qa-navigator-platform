# Backend Start Fix for GitHub Actions

## 🐛 Problem

Backend wasn't starting in GitHub Actions, causing all tests to fail with timeout errors.

## 🔍 Root Cause

**Issue**: Using `npm start` with `concurrently` doesn't work well when backgrounded in CI.

```yaml
# ❌ DOESN'T WORK IN CI
npm start > app.log 2>&1 &
```

`concurrently` runs both backend and frontend, but when backgrounded with `&`, it doesn't properly detach and the processes may not start correctly.

## ✅ Solution

Start backend and frontend **separately** in CI for better control and debugging.

### **Before (Broken)**

```yaml
- name: Start application
  run: |
    npm start > app.log 2>&1 &  # ❌ concurrently doesn't background well
    sleep 60
```

### **After (Fixed)**

```yaml
- name: Start backend
  run: |
    npm run server:prod > backend.log 2>&1 &
    echo "Backend PID: $!"
    sleep 10
    
- name: Start frontend
  run: |
    npm run dev > frontend.log 2>&1 &
    echo "Frontend PID: $!"
    sleep 10
    
- name: Check processes
  run: |
    ps aux | grep -E "(tsx|vite|node)" | grep -v grep
    netstat -tuln | grep -E "(3000|5173)"
```

## 📊 What Changed

| Aspect | Before | After |
|--------|--------|-------|
| **Start Method** | `npm start` (concurrently) | Separate `server:prod` + `dev` |
| **Logging** | Single `app.log` | `backend.log` + `frontend.log` |
| **Process Control** | No PID tracking | Show PIDs for debugging |
| **Debugging** | No process/port checks | Check processes and ports |
| **Error Visibility** | Silent failures | Show logs on failure |

## 🔧 New Workflow Steps

```
1. ✅ Run database tests
2. ✅ Start backend (npm run server:prod)
   - Log to backend.log
   - Wait 10s
3. ✅ Start frontend (npm run dev)
   - Log to frontend.log
   - Wait 10s
4. ✅ Check processes and ports
   - Verify tsx/vite/node running
   - Verify ports 3000 and 5173 listening
5. ✅ Wait for backend API (30 attempts)
   - curl http://localhost:3000/api/teams
   - Show logs if fails
6. ⚠️ Check frontend (optional)
7. ✅ Run API tests
8. ✅ Run E2E tests
9. ✅ Upload logs (backend.log + frontend.log)
```

## 📝 Commands Used

### **Backend**
```bash
npm run server:prod > backend.log 2>&1 &
```
- Uses `tsx server/index.ts` (production mode, no watch)
- Logs to `backend.log`
- Runs in background

### **Frontend**
```bash
npm run dev > frontend.log 2>&1 &
```
- Uses `vite` dev server
- Logs to `frontend.log`
- Runs in background

### **Health Check**
```bash
for i in {1..30}; do
  if curl -f http://localhost:3000/api/teams > /dev/null 2>&1; then
    echo "✅ Backend is ready!"
    exit 0
  fi
  sleep 2
done
```
- 30 attempts with 2s delay = 60s total
- Tests actual API endpoint
- Shows progress

## 🎯 Benefits

### **1. Better Debugging**
```yaml
- name: Wait for backend to be ready
  run: |
    # ... health check ...
    echo "❌ Backend failed to start"
    echo "=== Backend Logs ==="
    cat backend.log
    echo "=== Processes ==="
    ps aux | grep -E "(tsx|node)"
```

If backend fails, you'll see:
- ✅ Complete backend logs
- ✅ Running processes
- ✅ What went wrong

### **2. Separate Logs**
- `backend.log` - Server startup, database connection, errors
- `frontend.log` - Vite dev server, build errors

### **3. Process Tracking**
```bash
echo "Backend PID: $!"  # Shows process ID
ps aux | grep tsx       # Verify it's running
netstat -tuln | grep 3000  # Verify port is listening
```

### **4. Faster Failure Detection**
- Backend starts first
- If it fails, we know immediately
- Don't waste time starting frontend

## 🚀 Expected Output

### **Success**
```
✅ Backend starting...
✅ Backend PID: 1234
✅ Frontend starting...
✅ Frontend PID: 5678
✅ Checking processes... tsx, vite found
✅ Checking ports... 3000, 5173 listening
✅ Backend is ready!
✅ Frontend is ready!
```

### **Failure (with debugging)**
```
❌ Backend failed to start
=== Backend Logs ===
Error: connect ECONNREFUSED 127.0.0.1:3306
    at TCPConnectWrap.afterConnect
=== Processes ===
No backend process found
```

## 📦 Artifacts Uploaded

If tests fail, these files are uploaded:
- ✅ `backend.log` - Backend server logs
- ✅ `frontend.log` - Frontend dev server logs
- ✅ `test-results/` - Playwright test results
- ✅ `playwright-report/` - HTML test report

Download from GitHub Actions → Artifacts

## 🎉 Result

Backend now starts reliably in GitHub Actions with:
- ✅ Separate process control
- ✅ Better logging
- ✅ Clear error messages
- ✅ Faster debugging

---

**Last Updated**: 2024-11-22  
**Status**: Backend start issues resolved ✅
