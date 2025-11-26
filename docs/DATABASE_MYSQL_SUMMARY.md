# MySQL Database - Complete Summary
## IronGate QA Navigator

---

## What Changed

✅ **Switched from PostgreSQL/Supabase to MySQL**  
✅ **All schema converted to MySQL syntax**  
✅ **Documentation updated**  
✅ **Setup guide created**

---

## Key MySQL Differences

### Data Types
| PostgreSQL | MySQL |
|------------|-------|
| `UUID` | `CHAR(36)` with `DEFAULT (UUID())` |
| `TIMESTAMPTZ` | `TIMESTAMP` |
| `JSONB` | `JSON` |
| `TEXT[]` | `JSON` (array stored as JSON) |
| `BOOLEAN` | `BOOLEAN` (TINYINT(1)) |
| `CHECK` constraints | `CHECK` or `ENUM` |

### Syntax Changes
- **Foreign Keys**: Defined separately, not inline
- **Indexes**: Created inline with table definition
- **Auto-increment**: `AUTO_INCREMENT` instead of `SERIAL`
- **UUID**: `UUID()` function instead of `gen_random_uuid()`
- **Timestamps**: `CURRENT_TIMESTAMP` instead of `NOW()`
- **Auto-update**: `ON UPDATE CURRENT_TIMESTAMP` for updated_at

---

## Database Schema

### 18 Tables Created

**Core Organization (5)**:
- `companies` - Multi-tenant top level
- `departments` - Organizational divisions  
- `teams` - QA teams
- `users` - User accounts
- `team_members` - Many-to-many relationship

**Metrics & KPIs (3)**:
- `kpi_snapshots` - Daily snapshots of 22 KPIs
- `sprint_velocity` - Sprint tracking
- `business_metrics` - Business KPIs

**Advanced Features (9)**:
- `flaky_tests` + `flaky_test_executions`
- `technical_debt`
- `pipeline_executions`
- `performance_tests`
- `developer_productivity`
- `test_cases`
- `gamification_points` + `gamification_badges`

**Security & Audit (2)**:
- `audit_logs`
- `api_tokens`

---

## Hosting Options

### Option 1: PlanetScale (Recommended)
**Why**:
- ✅ MySQL-compatible
- ✅ Free tier: 5 GB storage, 1B row reads/month
- ✅ Automatic backups
- ✅ Database branching (like Git)
- ✅ No connection limits
- ✅ Built-in query insights

**Cost**: FREE for development, $29/month for production

---

### Option 2: AWS RDS MySQL
**Why**:
- ✅ Fully managed
- ✅ Automatic backups
- ✅ Multi-AZ deployment
- ✅ Read replicas

**Cost**: ~$15/month (t3.micro free tier eligible)

---

### Option 3: Local MySQL
**Why**:
- ✅ Full control
- ✅ No cost
- ✅ Fast development

**Cost**: FREE

---

## Data Refresh Strategy

### Real-Time (Immediate)
User actions appear instantly:
- User creation/updates
- Team assignments
- Technical debt items
- Any user-initiated action

**Implementation**: WebSocket connections

---

### Periodic (Every 15 minutes)
External metrics synced via cron job:
- KPI snapshots from Jenkins/Jira
- Pipeline executions
- Performance tests
- Business metrics

**Implementation**: Node-cron or separate sync service

---

## Tech Stack

### Backend
```json
{
  "database": "mysql2",
  "server": "express",
  "auth": "jsonwebtoken + bcrypt",
  "realtime": "ws (WebSocket)",
  "cron": "node-cron",
  "migrations": "knex"
}
```

### Frontend (No Changes)
```json
{
  "framework": "React 19",
  "language": "TypeScript",
  "styling": "TailwindCSS 4",
  "charts": "Recharts",
  "icons": "Lucide React"
}
```

---

## File Structure

```
qa-dashboard/
├── docs/
│   ├── DATABASE_SCHEMA_MYSQL.md      # Complete schema
│   ├── DATABASE_SETUP_MYSQL.md       # Setup guide
│   ├── DATABASE_MYSQL_SUMMARY.md     # This file
│   └── ORGANIZATION_HIERARCHY.md     # Org structure
├── server/
│   ├── index.ts                      # Express server
│   ├── routes/
│   │   ├── auth.ts                   # Auth endpoints
│   │   ├── teams.ts                  # Team endpoints
│   │   └── metrics.ts                # Metrics endpoints
│   ├── jobs/
│   │   └── syncMetrics.ts            # 15-min cron job
│   ├── integrations/
│   │   ├── jenkins.ts                # Jenkins API
│   │   ├── jira.ts                   # Jira API
│   │   └── sonarqube.ts              # SonarQube API
│   └── websocket.ts                  # WebSocket server
├── src/
│   ├── lib/
│   │   └── db.ts                     # MySQL connection
│   ├── hooks/
│   │   ├── useTeams.ts               # Team data hook
│   │   └── useMetrics.ts             # Metrics data hook
│   └── ... (existing React app)
├── migrations/                        # Knex migrations
├── .env                              # Environment variables
└── package.json
```

---

## Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=irongate_user
DB_PASSWORD=your_secure_password
DB_NAME=irongate_qa

# Or PlanetScale connection string
DATABASE_URL=mysql://user:pass@host.planetscale.com/database?ssl={"rejectUnauthorized":true}

# Server
PORT=3000
NODE_ENV=development

# JWT
secrettoken=your_secrettoken_key_here
JWT_EXPIRES_IN=7d

# External APIs (for 15-min sync)
JENKINS_URL=https://jenkins.company.com
JENKINS_TOKEN=your_jenkins_token
JIRA_URL=https://company.atlassian.net
JIRA_TOKEN=your_jira_token
SONARQUBE_URL=https://sonarqube.company.com
SONARQUBE_TOKEN=your_sonar_token
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install mysql2 express cors bcrypt jsonwebtoken ws node-cron knex dotenv
npm install --save-dev @types/express @types/cors @types/bcrypt @types/jsonwebtoken @types/ws
```

### 2. Set Up Database
```bash
# Option A: Local MySQL
mysql -u root -p < docs/schema.sql

# Option B: PlanetScale
# Create database in dashboard, get connection string
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 4. Run Migrations
```bash
npx knex migrate:latest
```

### 5. Start Server
```bash
npm run server
```

### 6. Start Frontend
```bash
npm run dev
```

---

## API Endpoints

### Authentication
```
POST   /api/auth/register    - Register new user
POST   /api/auth/login       - Login user
POST   /api/auth/logout      - Logout user
GET    /api/auth/me          - Get current user
```

### Teams
```
GET    /api/teams            - List all teams
GET    /api/teams/:id        - Get team details
POST   /api/teams            - Create team
PUT    /api/teams/:id        - Update team
DELETE /api/teams/:id        - Delete team
```

### Metrics
```
GET    /api/metrics/teams/:id           - Get team KPIs
GET    /api/metrics/teams/:id/history   - Get historical data
POST   /api/metrics/sync                - Trigger manual sync
```

### Users
```
GET    /api/users                       - List users
GET    /api/users/:id                   - Get user details
PUT    /api/users/:id                   - Update user
DELETE /api/users/:id                   - Delete user
```

---

## Database Connection Example

```typescript
// src/lib/db.ts
import mysql from 'mysql2/promise'

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
})

// Helper function
export async function query<T>(sql: string, params?: any[]): Promise<T> {
  const [rows] = await pool.execute(sql, params)
  return rows as T
}
```

---

## WebSocket Example

```typescript
// server/websocket.ts
import { WebSocketServer } from 'ws'

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server })
  
  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      // Handle messages
    })
  })
  
  return wss
}

// Broadcast updates
export function broadcast(wss, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data))
    }
  })
}
```

---

## Cron Job Example

```typescript
// server/jobs/syncMetrics.ts
import cron from 'node-cron'
import { query } from '../../src/lib/db'

// Run every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('🔄 Syncing metrics...')
  
  // Fetch from external APIs
  const jenkinsData = await fetchJenkinsMetrics()
  const jiraData = await fetchJiraMetrics()
  
  // Update database
  await query(
    `INSERT INTO kpi_snapshots (...) VALUES (...)
     ON DUPLICATE KEY UPDATE ...`,
    [...]
  )
  
  console.log('✅ Sync complete')
})
```

---

## Security Best Practices

✅ **Prepared Statements**: Prevent SQL injection
```typescript
// Good
await query('SELECT * FROM users WHERE email = ?', [email])

// Bad
await query(`SELECT * FROM users WHERE email = '${email}'`)
```

✅ **Password Hashing**: Use bcrypt
```typescript
import bcrypt from 'bcrypt'

const hashedPassword = await bcrypt.hash(password, 10)
const isValid = await bcrypt.compare(password, hashedPassword)
```

✅ **JWT Tokens**: Secure authentication
```typescript
import jwt from 'jsonwebtoken'

const token = jwt.sign({ userId: user.id }, process.env.secrettoken, {
  expiresIn: '7d'
})
```

✅ **Environment Variables**: Never commit secrets
```typescript
// Use dotenv
import 'dotenv/config'

const secret = process.env.secrettoken
```

---

## Performance Tips

### 1. Use Connection Pooling
Already configured in `db.ts` with 10 connections.

### 2. Add Indexes
All critical indexes already defined in schema.

### 3. Use Partitioning
For large time-series tables:
```sql
ALTER TABLE kpi_snapshots
PARTITION BY RANGE (YEAR(snapshot_date) * 100 + MONTH(snapshot_date)) (...)
```

### 4. Cache Frequently Accessed Data
```typescript
// Use in-memory cache for static data
const cache = new Map()

async function getTeams() {
  if (cache.has('teams')) {
    return cache.get('teams')
  }
  
  const teams = await query('SELECT * FROM teams')
  cache.set('teams', teams)
  return teams
}
```

---

## Monitoring

### Query Performance
```sql
-- Enable slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2;
```

### Connection Monitoring
```typescript
pool.on('connection', (connection) => {
  console.log('New connection established')
})

pool.on('error', (err) => {
  console.error('Pool error:', err)
})
```

---

## Backup Strategy

```bash
#!/bin/bash
# Daily backup at 2 AM

DATE=$(date +%Y%m%d_%H%M%S)
mysqldump -u $DB_USER -p$DB_PASSWORD $DB_NAME | gzip > backup_$DATE.sql.gz

# Keep last 30 days
find . -name "backup_*.sql.gz" -mtime +30 -delete
```

---

## Next Steps

1. **Review schema**: `docs/DATABASE_SCHEMA_MYSQL.md`
2. **Choose hosting**: PlanetScale, AWS RDS, or local
3. **Set up database**: Follow `docs/DATABASE_SETUP_MYSQL.md`
4. **Build API**: Create Express server with routes
5. **Implement auth**: JWT + bcrypt
6. **Add WebSocket**: Real-time user updates
7. **Set up cron**: 15-minute metric sync
8. **Connect frontend**: Update API calls
9. **Test end-to-end**: Register user, view metrics
10. **Deploy**: Production deployment

---

## Support

**Documentation**:
- `DATABASE_SCHEMA_MYSQL.md` - Complete schema
- `DATABASE_SETUP_MYSQL.md` - Setup guide
- `ORGANIZATION_HIERARCHY.md` - Org structure

**Questions?** Review the documentation or check MySQL 8.0 docs.

---

*Summary Version: 1.0*  
*Last Updated: November 20, 2025*
