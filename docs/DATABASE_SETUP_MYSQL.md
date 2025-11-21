# MySQL Database Setup Guide
## IronGate QA Navigator

---

## Prerequisites

- MySQL 8.0+ installed
- Node.js 20+ installed
- npm or yarn package manager

---

## Option 1: Local MySQL Setup

### Install MySQL

**macOS (Homebrew)**:
```bash
brew install mysql
brew services start mysql
```

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
```

**Windows**:
Download from [MySQL Downloads](https://dev.mysql.com/downloads/mysql/)

---

### Create Database

```bash
# Login to MySQL
mysql -u root -p

# Create database
CREATE DATABASE irongate_qa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# Create user
CREATE USER 'irongate_user'@'localhost' IDENTIFIED BY 'your_secure_password';

# Grant privileges
GRANT ALL PRIVILEGES ON irongate_qa.* TO 'irongate_user'@'localhost';
FLUSH PRIVILEGES;

# Exit
EXIT;
```

---

### Run Schema

```bash
# Import schema
mysql -u irongate_user -p irongate_qa < docs/schema.sql
```

---

## Option 2: Cloud MySQL (Recommended for Production)

### PlanetScale (Recommended)

**Why PlanetScale**:
- ✅ MySQL-compatible
- ✅ Generous free tier (5 GB storage, 1 billion row reads/month)
- ✅ Automatic backups
- ✅ Branching (like Git for databases)
- ✅ No connection limits on free tier
- ✅ Built-in query insights

**Setup**:
1. Go to [planetscale.com](https://planetscale.com)
2. Create account
3. Create database: `irongate-qa`
4. Get connection string
5. Use in `.env` file

---

### AWS RDS MySQL

**Setup**:
1. Go to AWS RDS Console
2. Create MySQL 8.0 database
3. Choose instance type (t3.micro for free tier)
4. Set master username/password
5. Configure security group (allow port 3306)
6. Get endpoint URL

---

### Google Cloud SQL

**Setup**:
1. Go to Google Cloud Console
2. Create Cloud SQL instance (MySQL 8.0)
3. Set root password
4. Create database `irongate_qa`
5. Configure authorized networks
6. Get connection details

---

## Frontend Setup

### Install Dependencies

```bash
npm install mysql2 dotenv
```

---

### Environment Variables

Create `.env` file:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=irongate_user
DB_PASSWORD=your_secure_password
DB_NAME=irongate_qa

# Or use connection string (PlanetScale)
DATABASE_URL=mysql://user:password@host:3306/database

# App
VITE_API_URL=http://localhost:3000
```

---

### Database Connection

Create `src/lib/db.ts`:

```typescript
import mysql from 'mysql2/promise'

// Create connection pool
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
})

// Test connection
export async function testConnection() {
  try {
    const connection = await pool.getConnection()
    console.log('✅ Database connected successfully')
    connection.release()
    return true
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    return false
  }
}

// Helper function for queries
export async function query<T>(sql: string, params?: any[]): Promise<T> {
  const [rows] = await pool.execute(sql, params)
  return rows as T
}
```

---

## Backend API Setup

### Create Express Server

```bash
npm install express cors bcrypt jsonwebtoken
npm install --save-dev @types/express @types/cors @types/bcrypt @types/jsonwebtoken
```

Create `server/index.ts`:

```typescript
import express from 'express'
import cors from 'cors'
import { pool, testConnection } from '../src/lib/db'
import authRoutes from './routes/auth'
import teamsRoutes from './routes/teams'
import metricsRoutes from './routes/metrics'

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// Test database connection
testConnection()

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/teams', teamsRoutes)
app.use('/api/metrics', metricsRoutes)

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})
```

---

## Data Sync Strategy (15-minute refresh)

### Option 1: Node-Cron

```bash
npm install node-cron
```

Create `server/jobs/syncMetrics.ts`:

```typescript
import cron from 'node-cron'
import { query } from '../../src/lib/db'
import { fetchJenkinsMetrics } from '../integrations/jenkins'
import { fetchJiraMetrics } from '../integrations/jira'

// Run every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('🔄 Starting metrics sync...')
  
  try {
    // Get all active teams
    const teams = await query<any[]>(
      'SELECT id, name FROM teams WHERE is_active = true'
    )
    
    for (const team of teams) {
      // Fetch metrics from external systems
      const jenkinsData = await fetchJenkinsMetrics(team.id)
      const jiraData = await fetchJiraMetrics(team.id)
      
      // Calculate KPIs
      const kpiData = {
        team_id: team.id,
        snapshot_date: new Date().toISOString().split('T')[0],
        test_coverage: jenkinsData.coverage,
        test_flakiness_rate: jenkinsData.flakiness,
        // ... other metrics
      }
      
      // Upsert to database
      await query(
        `INSERT INTO kpi_snapshots 
         (team_id, snapshot_date, test_coverage, test_flakiness_rate, ...)
         VALUES (?, ?, ?, ?, ...)
         ON DUPLICATE KEY UPDATE
         test_coverage = VALUES(test_coverage),
         test_flakiness_rate = VALUES(test_flakiness_rate),
         ...`,
        [kpiData.team_id, kpiData.snapshot_date, kpiData.test_coverage, ...]
      )
    }
    
    console.log('✅ Metrics sync completed')
  } catch (error) {
    console.error('❌ Metrics sync failed:', error)
  }
})
```

---

### Option 2: Separate Sync Service

Create `server/sync-service.ts`:

```typescript
import { query } from '../src/lib/db'

async function syncMetrics() {
  // Sync logic here
}

// Run immediately, then every 15 minutes
syncMetrics()
setInterval(syncMetrics, 15 * 60 * 1000)
```

Run as separate process:
```bash
node server/sync-service.js
```

---

## Real-Time Updates (User Actions)

### WebSocket Setup

```bash
npm install ws
npm install --save-dev @types/ws
```

Create `server/websocket.ts`:

```typescript
import { WebSocketServer } from 'ws'
import { Server } from 'http'

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server })
  
  wss.on('connection', (ws) => {
    console.log('Client connected')
    
    ws.on('message', (message) => {
      // Handle messages
    })
    
    ws.on('close', () => {
      console.log('Client disconnected')
    })
  })
  
  return wss
}

// Broadcast to all clients
export function broadcast(wss: WebSocketServer, data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(data))
    }
  })
}
```

Usage in routes:

```typescript
// After creating a user
await query('INSERT INTO users ...', [...])

// Broadcast to all connected clients
broadcast(wss, {
  type: 'USER_CREATED',
  data: newUser
})
```

---

## Migration System

### Install Knex.js

```bash
npm install knex
```

Create `knexfile.js`:

```javascript
module.exports = {
  development: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    },
    migrations: {
      directory: './migrations'
    }
  }
}
```

Create migrations:

```bash
npx knex migrate:make create_companies
npx knex migrate:make create_departments
npx knex migrate:make create_users
# ... etc
```

Run migrations:

```bash
npx knex migrate:latest
```

---

## Backup Strategy

### Automated Backups

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
DB_NAME="irongate_qa"

mysqldump -u $DB_USER -p$DB_PASSWORD $DB_NAME | gzip > $BACKUP_DIR/backup_$DATE.sql.gz

# Keep only last 30 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +30 -delete
```

Add to crontab:
```bash
# Run daily at 2 AM
0 2 * * * /path/to/backup.sh
```

---

## Performance Optimization

### Indexes
All critical indexes are already defined in the schema.

### Query Optimization
```sql
-- Use EXPLAIN to analyze queries
EXPLAIN SELECT * FROM teams WHERE company_id = 'xxx';

-- Add indexes as needed
CREATE INDEX idx_custom ON table_name(column_name);
```

### Connection Pooling
Already configured in `db.ts` with connection limits.

---

## Monitoring

### Query Logging

```typescript
// Add to db.ts
pool.on('connection', (connection) => {
  connection.on('error', (err) => {
    console.error('MySQL connection error:', err)
  })
})
```

### Slow Query Log

```sql
-- Enable slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2; -- Log queries > 2 seconds
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow-query.log';
```

---

## Security Checklist

- [ ] Use strong passwords
- [ ] Enable SSL/TLS for connections
- [ ] Restrict database user privileges
- [ ] Use prepared statements (prevents SQL injection)
- [ ] Hash passwords with bcrypt
- [ ] Implement rate limiting
- [ ] Enable audit logging
- [ ] Regular security updates
- [ ] Backup encryption

---

## Next Steps

1. ✅ Choose MySQL hosting (local, PlanetScale, AWS RDS)
2. ✅ Create database and run schema
3. ✅ Set up environment variables
4. ✅ Create database connection
5. ✅ Build Express API
6. ✅ Implement authentication
7. ✅ Set up 15-minute sync job
8. ✅ Add WebSocket for real-time updates
9. ✅ Connect frontend to API
10. ✅ Test end-to-end

---

*Setup Guide Version: 1.0*  
*Last Updated: November 20, 2025*
