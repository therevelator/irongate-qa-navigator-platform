# ✅ Backend API Complete!

## What Was Built

### 1. **Express API Server** ✅
- Full REST API with authentication
- JWT token-based security
- Role-based access control
- CORS enabled for frontend

### 2. **WebSocket Server** ✅
- Real-time updates for user actions
- Instant notifications when users are created
- Keep-alive ping/pong mechanism
- Broadcast to all connected clients

### 3. **15-Minute Cron Job** ✅
- Automated metric syncing every 15 minutes
- Fetches data from external APIs (Jenkins, Jira, SonarQube)
- Currently generates mock data (replace with real API calls)
- Updates KPI snapshots in database

### 4. **MySQL Database Integration** ✅
- Connection pooling for performance
- Helper functions for queries
- Transaction support
- Type-safe database operations

---

## File Structure

```
qa-dashboard/
├── .env                          ### Environment Variables
├── schema.sql                    # Database schema
├── tsconfig.server.json          # Server TypeScript config
├── server/
│   ├── index.ts                  # Main server (Express + WebSocket)
│   ├── websocket.ts              # WebSocket server
│   ├── README.md                 # Server documentation
│   ├── middleware/
│   │   └── auth.ts               # JWT authentication
│   ├── routes/
│   │   ├── auth.ts               # POST /api/auth/register, /login
│   │   ├── teams.ts              # GET/POST/PUT /api/teams
│   │   ├── metrics.ts            # GET /api/metrics/teams/:id
│   │   ├── users.ts              # GET/PUT/DELETE /api/users
│   │   └── departments.ts        # GET /api/departments
│   └── jobs/
│       └── syncMetrics.ts        # 15-minute cron job
└── src/
    └── lib/
        └── db.ts                 # MySQL connection & helpers
```

---

## API Endpoints

### Authentication
```
POST   /api/auth/register    - Register new user
POST   /api/auth/login       - Login user
GET    /api/auth/me          - Get current user
```

### Teams
```
GET    /api/teams            - List all teams
GET    /api/teams/:id        - Get team details
POST   /api/teams            - Create team (admin)
PUT    /api/teams/:id        - Update team (admin)
```

### Metrics
```
GET    /api/metrics/teams/:teamId           - Get latest KPIs
GET    /api/metrics/teams/:teamId/history   - Get historical data
GET    /api/metrics/teams/:teamId/velocity  - Get sprint velocity
POST   /api/metrics/sync                    - Trigger manual sync (admin)
```

### AI Insights (Teams & Developers)

#### Team-Level AI Insights
Implemented as an authenticated extension on the existing teams API:

```
GET    /api/teams/:id/ai-suggestions
PATCH  /api/teams/:id/ai-toggle              - Enable/disable AI for a team (admin / manager / team lead)
```

**Behavior:**
- Uses latest `kpi_snapshots` for the team to build an aggregated metrics payload
- Tries Groq Chat Completions API (`llama-3.3-70b-versatile`) when `GROQ_API_KEY` is configured
- If Groq responds with valid JSON → returns structured suggestions with `source: "groq"`
- On timeout (10s), API error, or parse error → falls back to deterministic rule-based suggestions with `source: "rule-based"`

**Response (simplified):**
```json
{
  "teamId": "team-...",
  "teamName": "Quasars",
  "qaScore": 82,
  "aiEnabled": true,
  "source": "groq" | "rule-based",
  "strongpoints": ["..."],
  "areasOfImprovement": ["..."],
  "actionPlan": [
    {
      "priority": "Urgent" | "Moderate" | "Low",
      "initiative": "...",
      "owner": "QA Lead | DevOps | Scrum Master",
      "timebox": "1 sprint",
      "kpi": "Test Coverage"
    }
  ]
}
```

**Feature flags:**
- `teams.ai_enabled` (BOOLEAN) controls whether AI suggestions are generated for a given team
- If `ai_enabled = false`, the endpoint returns a friendly message and `aiEnabled: false` without calling Groq

#### Developer-Level AI Insights

Per-developer productivity insights are available for teams that have both:
- Team AI enabled (`teams.ai_enabled = TRUE`), and
- Developer-level insights enabled per user (`users.developer_insights_enabled = TRUE`).

```
GET    /api/teams/:id/developer-ai-suggestions
```

**Behavior:**
- Reads metrics from `developer_metrics` for the requested team
- Filters to only those developers where `users.developer_insights_enabled = 1`
- Calls Groq (15s timeout) with a batch of developer metrics and benchmarks; on failure falls back to rule-based heuristics

**Response (simplified):**
```json
{
  "teamId": "team-...",
  "aiEnabled": true,
  "source": "groq" | "rule-based",
  "teamInsight": "Most developers are in a healthy productivity state...",
  "metrics": [
    {
      "name": "Emma Wilson",
      "prMergeTimeHours": 8.2,
      "codeReviewTimeHours": 2.1,
      "focusTimeHours": 5.5,
      "meetingTimeHours": 2.0,
      "contextSwitchesPerDay": 2,
      "happinessScore": 8.5
    }
  ],
  "developers": [
    {
      "name": "Emma Wilson",
      "status": "healthy" | "at-risk" | "needs-attention",
      "summary": "One sentence summary",
      "strengths": ["Fast PR turnaround"],
      "concerns": ["Too many meetings"],
      "suggestion": "Concrete next step"
    }
  ]
}
```

The rule-based fallback mirrors the same structure using deterministic thresholds on PR time, review time, focus time, meetings, context switches, and happiness score.

### Users
```
GET    /api/users            - List all users
GET    /api/users/:id        - Get user details
PUT    /api/users/:id        - Update user
DELETE /api/users/:id        - Delete user (admin)
```

### Departments
```
GET    /api/departments      - List all departments
GET    /api/departments/:id  - Get department with teams
```

---

## How to Run

### Step 1: Import Database Schema
```bash
mysql -u root -p < schema.sql
```

### Step 2: Configure Environment
Edit `.env` file:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=irongate_qa
secrettoken=your-secret-key

# Groq AI (optional, enables AI Insights)
GROQ_API_KEY=your-groq-api-key
```

### Step 3: Start Backend Server
```bash
npm run server
```

Server starts on `http://localhost:3000`

### Step 4: Start Frontend (in another terminal)
```bash
npm run dev
```

Frontend starts on `http://localhost:5173`

---

## Testing the API

### 1. Health Check
```bash
curl http://localhost:3000/health
```

### 2. Register User
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@mastercard.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe",
    "role": "qa_engineer",
    "companyId": "company-mastercard",
    "departmentId": "dept-decision-mgmt",
    "teamId": "team-quasars"
  }'
```

Response:
```json
{
  "user": {
    "id": "...",
    "email": "john@mastercard.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "qa_engineer"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 3. Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@mastercard.com",
    "password": "password123"
  }'
```

### 4. Get Teams (with auth)
```bash
curl http://localhost:3000/api/teams \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## WebSocket Connection

### JavaScript Example
```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
  
  if (data.type === 'USER_CREATED') {
    // New user registered - update UI
    console.log('New user:', data.data);
  }
};

// Keep-alive
setInterval(() => {
  ws.send(JSON.stringify({ type: 'PING' }));
}, 30000);
```

---

## Cron Job Details

### Schedule
Runs **every 15 minutes**: `*/15 * * * *`

### What It Does
1. Fetches all active teams from database
2. For each team:
   - Fetches metrics from Jenkins API
   - Fetches metrics from Jira API
   - Fetches metrics from SonarQube API
   - Calculates 22 KPIs
   - Upserts to `kpi_snapshots` table
3. Logs success/failure for each team

### Current Implementation
- Generates **mock data** for testing
- Replace with real API calls in production

### To Add Real API Integration
Edit `server/jobs/syncMetrics.ts`:

```typescript
// Replace generateMockKPIs() with:
async function fetchRealKPIs(teamId: string) {
  const jenkinsData = await fetch(`${process.env.JENKINS_URL}/api/...`);
  const jiraData = await fetch(`${process.env.JIRA_URL}/api/...`);
  const sonarData = await fetch(`${process.env.SONARQUBE_URL}/api/...`);
  
  return {
    test_coverage: jenkinsData.coverage,
    test_flakiness_rate: jenkinsData.flakiness,
    // ... calculate other KPIs
  };
}
```

---

## Security Features

### JWT Authentication
- Tokens expire after 7 days
- Stored in `Authorization: Bearer <token>` header
- Includes userId, role, companyId in payload

### Password Hashing
- Uses bcrypt with 10 salt rounds
- Passwords never stored in plain text

### Role-Based Access Control
- `super_admin` - Full access
- `qa_manager` - Manage teams and users
- `team_lead` - Manage own team
- `qa_engineer` - View own team data
- `viewer` - Read-only access

### Company Isolation
- Users can only access data from their company
- Enforced at database query level
- Prevents cross-company data leaks

---

## Next Steps

### 1. Seed Initial Data
Create a company, departments, and teams:

```sql
-- Insert company
INSERT INTO companies (id, name, domain) 
VALUES ('company-mastercard', 'Mastercard', 'mastercard.com');

-- Insert department
INSERT INTO departments (id, company_id, name, description)
VALUES ('dept-decision-mgmt', 'company-mastercard', 'Decision Management', 'AI-powered decision management');

-- Insert team
INSERT INTO teams (id, company_id, department_id, name, platform)
VALUES ('team-quasars', 'company-mastercard', 'dept-decision-mgmt', 'Quasars', 'Backend');
```

### 2. Connect Frontend to API
Update `src/contexts/AuthContext.tsx` to use real API:

```typescript
const API_URL = 'http://localhost:3000/api';

const login = async (credentials: LoginCredentials) => {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
  
  const { user, token } = await response.json();
  localStorage.setItem('token', token);
  setAuthState({ user, isAuthenticated: true });
};
```

### 3. Add WebSocket to Frontend
Create `src/lib/websocket.ts`:

```typescript
export function connectWebSocket() {
  const ws = new WebSocket('ws://localhost:3000/ws');
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // Handle real-time updates
  };
  
  return ws;
}
```

### 4. Replace Mock Data
- Update cron job with real API calls
- Connect to Jenkins, Jira, SonarQube
- Add error handling and retry logic

---

## Production Deployment

### 1. Environment Variables
```env
NODE_ENV=production
DB_HOST=your-production-db.com
secrettoken=super-secure-random-string-here
```

### 2. Process Manager (PM2)
```bash
npm install -g pm2
pm2 start server/index.ts --name irongate-api
pm2 startup
pm2 save
```

### 3. Reverse Proxy (nginx)
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /ws {
        proxy_pass http://localhost:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

### 4. SSL Certificate
```bash
certbot --nginx -d api.yourdomain.com
```

---

## Troubleshooting

### Server won't start
```bash
# Check if port 3000 is in use
lsof -ti:3000

# Kill process if needed
lsof -ti:3000 | xargs kill -9
```

### Database connection failed
```bash
# Test MySQL connection
mysql -u root -p -e "SELECT 1"

# Check if database exists
mysql -u root -p -e "SHOW DATABASES LIKE 'irongate_qa'"
```

### WebSocket not connecting
- Check CORS settings in `server/index.ts`
- Verify WebSocket path is `/ws`
- Check browser console for errors

### Cron job not running
- Check server logs for errors
- Verify cron syntax: `*/15 * * * *`
- Test manually: `POST /api/metrics/sync`

---

## Summary

✅ **Express API** - Running on port 3000  
✅ **WebSocket** - Real-time updates at `/ws`  
✅ **Cron Job** - Syncs metrics every 15 minutes  
✅ **MySQL** - Database connected and ready  
✅ **Authentication** - JWT tokens with role-based access  
✅ **Documentation** - Complete API docs in `server/README.md`  

**Ready to connect the frontend!** 🚀

---

*Backend Version: 1.0*  
*Last Updated: November 21, 2025*
