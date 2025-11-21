# 🚀 Quick Start Guide

## Prerequisites

- ✅ Node.js 20+ installed
- ✅ MySQL 8.0+ installed and running
- ✅ npm packages installed (`npm install` already done)

---

## Step-by-Step Setup

### 1. Set Up Database (5 minutes)

```bash
# Start MySQL (if not running)
# macOS:
brew services start mysql

# Ubuntu:
sudo systemctl start mysql

# Import schema
mysql -u root -p < schema.sql
# Enter your MySQL password when prompted
```

**Verify database created:**
```bash
mysql -u root -p -e "USE irongate_qa; SHOW TABLES;"
```

You should see 18 tables listed.

---

### 2. Configure Environment (2 minutes)

The `.env` file is already created. Update if needed:

```bash
# Edit .env file
nano .env

# Or use your favorite editor
code .env
```

**Required settings:**
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD_HERE
DB_NAME=irongate_qa
JWT_SECRET=change-this-to-random-string
```

---

### 3. Seed Initial Data (3 minutes)

Run this SQL to create test company, department, and team:

```bash
mysql -u root -p irongate_qa
```

Then paste:

```sql
-- Create Mastercard company
INSERT INTO companies (id, name, domain, is_active) 
VALUES ('company-mastercard', 'Mastercard', 'mastercard.com', true);

-- Create Decision Management department
INSERT INTO departments (id, company_id, name, description, is_active)
VALUES ('dept-decision-mgmt', 'company-mastercard', 'Decision Management', 'AI-powered decision management and fraud detection', true);

-- Create Quasars team
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active)
VALUES ('team-quasars', 'company-mastercard', 'dept-decision-mgmt', 'Quasars', 'AI/ML decision engine development', 'Backend', true);

-- Create Pulsars team
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active)
VALUES ('team-pulsars', 'company-mastercard', 'dept-decision-mgmt', 'Pulsars', 'Real-time decision processing', 'API', true);

-- Verify
SELECT * FROM companies;
SELECT * FROM departments;
SELECT * FROM teams;

-- Exit
EXIT;
```

---

### 4. Start Backend Server (1 minute)

Open a terminal and run:

```bash
npm run server
```

You should see:
```
✅ Database connected successfully
🚀 Server running on http://localhost:3000
📊 API available at http://localhost:3000/api
🔌 WebSocket server running
📅 Metrics sync job initialized
✅ Cron job scheduled: Every 15 minutes
```

**Leave this terminal open!**

---

### 5. Test Backend API (2 minutes)

Open a **new terminal** and test:

```bash
# Health check
curl http://localhost:3000/health

# Should return: {"status":"ok","timestamp":"...","uptime":...}
```

**Register a test user:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@mastercard.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "User",
    "role": "qa_engineer",
    "companyId": "company-mastercard",
    "departmentId": "dept-decision-mgmt",
    "teamId": "team-quasars"
  }'
```

You should get back a user object and JWT token!

---

### 6. Start Frontend (1 minute)

Open **another new terminal** and run:

```bash
npm run dev
```

You should see:
```
VITE v7.2.2  ready in XXX ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

**Open browser:** http://localhost:5173

---

### 7. Login to App (1 minute)

Use the test user you just created:

- **Email**: `test@mastercard.com`
- **Password**: `password123`

Or use demo accounts (if they exist in your mock data):
- **Email**: `admin@irongate.com`
- **Password**: `demo123`

---

## ✅ You're Done!

You now have:
- ✅ Backend API running on `http://localhost:3000`
- ✅ Frontend app running on `http://localhost:5173`
- ✅ WebSocket server for real-time updates
- ✅ Cron job syncing metrics every 15 minutes
- ✅ MySQL database with organizational hierarchy

---

## What's Running?

### Terminal 1: Backend Server
```
npm run server
```
- Express API on port 3000
- WebSocket server at ws://localhost:3000/ws
- 15-minute cron job for metrics sync

### Terminal 2: Frontend Dev Server
```
npm run dev
```
- React app on port 5173
- Hot module replacement enabled
- Auto-reloads on file changes

---

## Quick Tests

### Test 1: Register User (Real-time)
1. Open browser console (F12)
2. Register a new user in the app
3. Check backend terminal - you should see:
   ```
   📨 Received message: ...
   📡 Broadcasted to X clients: USER_CREATED
   ```

### Test 2: View Teams
1. Login to the app
2. Navigate to Teams page
3. You should see "Quasars" and "Pulsars" teams

### Test 3: Metrics Sync
1. Wait 15 minutes (or trigger manually)
2. Check backend terminal for:
   ```
   🔄 Starting metrics sync...
   ✅ Synced metrics for team: Quasars
   ✅ Metrics sync completed
   ```

---

## Troubleshooting

### Backend won't start
**Error**: `Database connection failed`
- Check MySQL is running: `mysql -u root -p -e "SELECT 1"`
- Verify credentials in `.env`
- Ensure database exists: `SHOW DATABASES LIKE 'irongate_qa';`

**Error**: `Port 3000 already in use`
- Kill existing process: `lsof -ti:3000 | xargs kill -9`
- Or change port in `.env`: `PORT=3001`

### Frontend won't start
**Error**: `Port 5173 already in use`
- Kill existing process: `lsof -ti:5173 | xargs kill -9`

### Can't register user
**Error**: `Missing required fields`
- Make sure you seeded the database (Step 3)
- Verify company/department/team IDs match

### Metrics not syncing
- Check backend terminal for cron job logs
- Cron runs every 15 minutes (wait for next cycle)
- Or trigger manually: `curl -X POST http://localhost:3000/api/metrics/sync -H "Authorization: Bearer YOUR_TOKEN"`

---

## Next Steps

### 1. Connect Frontend to Backend
Update `src/contexts/AuthContext.tsx` to use real API instead of mock data.

### 2. Add More Teams
```sql
INSERT INTO teams (id, company_id, department_id, name, platform)
VALUES ('team-watchmen', 'company-mastercard', 'dept-decision-mgmt', 'Watchmen', 'DevOps');
```

### 3. Customize Metrics Sync
Edit `server/jobs/syncMetrics.ts` to fetch from real APIs (Jenkins, Jira, etc.)

### 4. Deploy to Production
See `BACKEND_COMPLETE.md` for deployment guide.

---

## Useful Commands

```bash
# Stop all servers
Ctrl+C in each terminal

# Restart backend
npm run server

# Restart frontend
npm run dev

# View database
mysql -u root -p irongate_qa

# Check running processes
lsof -ti:3000  # Backend
lsof -ti:5173  # Frontend

# View logs
tail -f server.log  # If you set up logging
```

---

## Documentation

- **Backend API**: `server/README.md`
- **Database Schema**: `docs/DATABASE_SCHEMA_MYSQL.md`
- **Setup Guide**: `docs/DATABASE_SETUP_MYSQL.md`
- **Org Hierarchy**: `docs/ORGANIZATION_HIERARCHY.md`
- **Complete Guide**: `BACKEND_COMPLETE.md`

---

## Support

**Having issues?**
1. Check the troubleshooting section above
2. Review error messages in terminal
3. Verify all prerequisites are met
4. Check documentation files

---

**🎉 Happy coding!**

*Last Updated: November 21, 2025*
