# ⚡ Quick Reference Card

## 🚀 Start Everything

```bash
# Terminal 1: Backend
npm run server

# Terminal 2: Frontend
npm run dev
```

**URLs:**
- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- WebSocket: ws://localhost:3000/ws

---

## 📁 Important Files

| File | Purpose |
|------|---------|
| `.env` | Database credentials & config |
| `schema.sql` | Database schema (18 tables) |
| `seed_data.sql` | Initial data (company, teams) |
| `server/index.ts` | Main backend server |
| `server/jobs/syncMetrics.ts` | 15-min cron job |

---

## 🗄️ Database Commands

```bash
# Import schema
mysql -u root -p < schema.sql

# Import seed data
mysql -u root -p < seed_data.sql

# Connect to database
mysql -u root -p irongate_qa

# View tables
mysql -u root -p -e "USE irongate_qa; SHOW TABLES;"

# View teams
mysql -u root -p -e "USE irongate_qa; SELECT * FROM teams;"
```

---

## 🔌 API Endpoints

### Auth
```bash
POST /api/auth/register  # Register user
POST /api/auth/login     # Login
GET  /api/auth/me        # Get current user
```

### Teams
```bash
GET  /api/teams          # List teams
GET  /api/teams/:id      # Get team
POST /api/teams          # Create team
PUT  /api/teams/:id      # Update team
```

### Metrics
```bash
GET  /api/metrics/teams/:id           # Latest KPIs
GET  /api/metrics/teams/:id/history   # Historical
GET  /api/metrics/teams/:id/velocity  # Sprint velocity
POST /api/metrics/sync                # Manual sync
```

### Users
```bash
GET    /api/users        # List users
GET    /api/users/:id    # Get user
PUT    /api/users/:id    # Update user
DELETE /api/users/:id    # Delete user
```

---

## 🧪 Quick Tests

### Health Check
```bash
curl http://localhost:3000/health
```

### Register User
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

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@mastercard.com","password":"password123"}'
```

### Get Teams (with token)
```bash
curl http://localhost:3000/api/teams \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check MySQL
mysql -u root -p -e "SELECT 1"

# Check port
lsof -ti:3000

# Kill process
lsof -ti:3000 | xargs kill -9
```

### Database issues
```bash
# Verify database exists
mysql -u root -p -e "SHOW DATABASES LIKE 'irongate_qa'"

# Re-import schema
mysql -u root -p < schema.sql
mysql -u root -p < seed_data.sql
```

### Frontend won't start
```bash
# Check port
lsof -ti:5173

# Kill process
lsof -ti:5173 | xargs kill -9
```

---

## 📊 Seeded Data

### Company
- **Mastercard** (`company-mastercard`)

### Departments (4)
- Decision Management
- Payments Processing
- Security & Compliance
- Digital Products

### Teams (14)
**Decision Management:**
- Quasars, Pulsars, Watchmen, Astronauts, Black Comb, Grid Team

**Payments:**
- Payment Core, Settlement, Gateway

**Security:**
- Fraud Detection, Compliance

**Digital:**
- Mobile iOS, Mobile Android, Web Portal

---

## 🔐 User Roles

| Role | Access Level |
|------|--------------|
| `super_admin` | Full access to everything |
| `qa_manager` | Manage teams and users |
| `team_lead` | Manage own team |
| `qa_engineer` | View own team data |
| `viewer` | Read-only access |

---

## ⚙️ Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=irongate_qa

# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Security
secrettoken=your-secret-key
```

---

## 📦 NPM Scripts

```bash
npm run dev          # Start frontend (Vite)
npm run server       # Start backend (with auto-reload)
npm run server:prod  # Start backend (production)
npm run build        # Build frontend for production
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

---

## 🔄 Cron Job

**Schedule**: Every 15 minutes (`*/15 * * * *`)

**What it does:**
1. Fetches all active teams
2. For each team:
   - Fetches metrics from Jenkins/Jira/SonarQube
   - Calculates 22 KPIs
   - Updates `kpi_snapshots` table
3. Logs success/failure

**Currently**: Generates mock data (replace with real APIs)

---

## 📝 Useful SQL Queries

```sql
-- View all teams
SELECT * FROM teams;

-- View all users
SELECT id, email, first_name, last_name, role FROM users;

-- View latest KPIs
SELECT * FROM kpi_snapshots ORDER BY snapshot_date DESC LIMIT 10;

-- View teams by department
SELECT d.name as dept, t.name as team, t.platform
FROM teams t
JOIN departments d ON t.department_id = d.id
ORDER BY d.name, t.name;

-- Count users by role
SELECT role, COUNT(*) as count
FROM users
GROUP BY role;
```

---

## 🌐 WebSocket Events

```javascript
// Connect
const ws = new WebSocket('ws://localhost:3000/ws');

// Listen for events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'CONNECTED':
      console.log('Connected to WebSocket');
      break;
    case 'USER_CREATED':
      console.log('New user:', data.data);
      break;
    case 'METRICS_SYNCED':
      console.log('Metrics updated');
      break;
  }
};

// Keep-alive
setInterval(() => {
  ws.send(JSON.stringify({ type: 'PING' }));
}, 30000);
```

---

## 📚 Documentation

| File | What's Inside |
|------|---------------|
| `START_HERE.md` | Quick start (read first!) |
| `COMPLETE_SETUP.md` | Full setup guide |
| `BACKEND_COMPLETE.md` | Backend docs |
| `BUILD_SUMMARY.md` | What was built |
| `QUICK_REFERENCE.md` | This file |
| `server/README.md` | Server details |

---

## 🎯 Common Tasks

### Add a new team
```sql
INSERT INTO teams (id, company_id, department_id, name, platform)
VALUES ('team-new', 'company-mastercard', 'dept-decision-mgmt', 'New Team', 'Web');
```

### Create a new user
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"pass123",...}'
```

### Trigger manual sync
```bash
curl -X POST http://localhost:3000/api/metrics/sync \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### View server logs
```bash
# Backend terminal shows real-time logs
# Look for:
# ✅ Success messages
# ❌ Error messages
# 🔄 Sync messages
# 📡 WebSocket broadcasts
```

---

## 💡 Tips

- Keep both terminals open (backend + frontend)
- Check backend logs for errors
- Use browser console (F12) for frontend debugging
- JWT tokens expire after 7 days
- Cron job runs every 15 minutes automatically
- WebSocket reconnects automatically on disconnect

---

**🚀 Ready to build!**

*Quick Reference v1.0*
