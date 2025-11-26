# Backend API Server

## Overview

Express.js API server with MySQL database, WebSocket support, and automated metric syncing.

## Features

- ✅ **REST API** - Full CRUD operations for users, teams, departments, metrics
- ✅ **WebSocket** - Real-time updates for user actions
- ✅ **JWT Authentication** - Secure token-based auth
- ✅ **15-minute Cron** - Automated metric syncing
- ✅ **MySQL Database** - Persistent data storage
- ✅ **TypeScript** - Type-safe development

## Quick Start

### 1. Set up database
```bash
mysql -u root -p < schema.sql
```

### 2. Configure environment
```bash
# Edit .env file with your database credentials
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
```

### 3. Start server
```bash
npm run server
```

Server will start on `http://localhost:3000`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Teams
- `GET /api/teams` - List all teams
- `GET /api/teams/:id` - Get team details
- `POST /api/teams` - Create team (admin)
- `PUT /api/teams/:id` - Update team (admin)

### Metrics
- `GET /api/metrics/teams/:teamId` - Get latest KPIs
- `GET /api/metrics/teams/:teamId/history` - Get historical data
- `GET /api/metrics/teams/:teamId/velocity` - Get sprint velocity
- `POST /api/metrics/sync` - Trigger manual sync (admin)

### Users
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (admin)

### Departments
- `GET /api/departments` - List all departments
- `GET /api/departments/:id` - Get department with teams

## WebSocket

Connect to `ws://localhost:3000/ws`

### Events
- `CONNECTED` - Connection established
- `USER_CREATED` - New user registered
- `METRICS_SYNCED` - Metrics updated
- `PING/PONG` - Keep-alive

## Cron Jobs

### Metrics Sync (Every 15 minutes)
- Fetches data from external APIs (Jenkins, Jira, SonarQube)
- Calculates KPIs
- Updates database
- Currently generates mock data (replace with real API calls)

## File Structure

```
server/
├── index.ts                 # Main server file
├── websocket.ts             # WebSocket server
├── middleware/
│   └── auth.ts              # JWT authentication
├── routes/
│   ├── auth.ts              # Auth endpoints
│   ├── teams.ts             # Team endpoints
│   ├── metrics.ts           # Metrics endpoints
│   ├── users.ts             # User endpoints
│   └── departments.ts       # Department endpoints
└── jobs/
    └── syncMetrics.ts       # 15-min cron job
```

## Development

```bash
# Start with auto-reload
npm run server

# Production mode
npm run server:prod
```

## Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=irongate_qa

# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# JWT
secrettoken=your-secret-key

# External APIs (optional)
JENKINS_URL=
JENKINS_TOKEN=
JIRA_URL=
JIRA_TOKEN=
SONARQUBE_URL=
SONARQUBE_TOKEN=
```

## Testing

```bash
# Health check
curl http://localhost:3000/health

# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "User",
    "companyId": "company-id",
    "departmentId": "dept-id",
    "teamId": "team-id"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'

# Get teams (with auth token)
curl http://localhost:3000/api/teams \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Production Deployment

1. Build frontend: `npm run build`
2. Set `NODE_ENV=production`
3. Use process manager (PM2, systemd)
4. Set up reverse proxy (nginx)
5. Enable HTTPS
6. Configure firewall
7. Set up monitoring

## Troubleshooting

### Database connection failed
- Check MySQL is running
- Verify credentials in `.env`
- Ensure database exists

### Port already in use
- Change `PORT` in `.env`
- Kill existing process: `lsof -ti:3000 | xargs kill`

### WebSocket not connecting
- Check CORS settings
- Verify WebSocket path `/ws`
- Check firewall rules

---

*Last Updated: November 21, 2025*
