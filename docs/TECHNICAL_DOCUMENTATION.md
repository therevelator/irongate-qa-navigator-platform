# 📚 IronGate QA Navigator - Technical Documentation

**Version**: 1.0 | **Status**: Production Ready | **Last Updated**: November 19, 2025

---

## Quick Links

- [Installation Guide](./technical/INSTALLATION_GUIDE.md)
- [Database Schema](./technical/DATABASE_SCHEMA.md)
- [Database Setup](./technical/DATABASE_SETUP_GUIDE.md)
- [API Documentation](./technical/METRICS_API_INDEX.md)
- [Authentication Guide](./authentication/AUTH_DEVELOPER_GUIDE.md)
- [Data Integration](./technical/DATA_INTEGRATION.md)

---

## System Overview

IronGate QA Navigator is an enterprise-grade Quality Intelligence Platform providing:
- 22 KPIs across quality, speed, agility, and reliability
- 9 advanced features for deep quality intelligence
- 5-role RBAC system for enterprise security
- 21-table database for comprehensive data management
- Real-time dashboards with interactive visualizations

---

## Technology Stack

### Frontend
- React 19.2 + TypeScript 5.9
- Vite 7.2 (build tool)
- TailwindCSS 4 (styling)
- Recharts 3.4 (visualization)
- Lucide React (icons)

### Backend
- Node.js 20+ / NestJS
- PostgreSQL 14+ / Prisma ORM
- JWT + bcrypt (authentication)
- Redis (caching, optional)

### DevOps
- Docker + Docker Compose
- Kubernetes (optional)
- Nginx (reverse proxy)
- GitHub Actions (CI/CD)

---

## Quick Start

### Frontend
```bash
npm install
npm run dev          # Development
npm run build        # Production build
npm run preview      # Preview build
```

### Backend
```bash
npm install
npm run db:setup     # Setup database
npm run db:migrate   # Run migrations
npm run start:dev    # Development
npm run build        # Production build
npm run start:prod   # Production
```

### Docker
```bash
docker-compose up -d              # Start all services
docker-compose logs -f            # View logs
docker-compose down               # Stop services
```

---

## Configuration

### Environment Variables

**Frontend (.env)**:
```bash
VITE_API_URL=http://localhost:3000/api
VITE_JWT_SECRET=your-secret-key
```

**Backend (.env)**:
```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/irongate_qa
JWT_SECRET=your-jwt-secret
JWT_EXPIRATION=24h

# Integrations
JENKINS_URL=https://jenkins.company.com
JENKINS_TOKEN=your-token
JIRA_URL=https://company.atlassian.net
JIRA_TOKEN=your-token
SONARQUBE_URL=https://sonar.company.com
SONARQUBE_TOKEN=your-token
```

---

## Architecture

```
┌─────────────┐
│   Browser   │ (React + TypeScript)
└──────┬──────┘
       │
┌──────▼──────┐
│    Nginx    │ (Load Balancer + SSL)
└──────┬──────┘
       │
┌──────▼──────┐
│  NestJS API │ (Node.js Backend)
└──────┬──────┘
       │
┌──────▼──────┬──────────┬──────────┐
│ PostgreSQL  │  Redis   │   S3     │
└─────────────┴──────────┴──────────┘
       │
┌──────▼──────────────────────────────┐
│  Integrations (Jenkins, Jira, etc)  │
└─────────────────────────────────────┘
```

---

## API Reference

### Authentication

**POST /api/auth/register**
```json
{
  "email": "user@company.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "role": "QA_ENGINEER"
}
```

**POST /api/auth/login**
```json
{
  "email": "user@company.com",
  "password": "SecurePass123!"
}
```

**Response**:
```json
{
  "user": { "id": "uuid", "email": "...", "role": "..." },
  "token": "jwt-token",
  "refreshToken": "refresh-token"
}
```

### Teams

**GET /api/teams** - Get all teams  
**GET /api/teams/:id** - Get team by ID  
**POST /api/teams** - Create team  
**PUT /api/teams/:id** - Update team  
**DELETE /api/teams/:id** - Delete team  

### Metrics

**GET /api/metrics/dashboard** - Dashboard metrics  
**GET /api/metrics/trends** - Historical trends  
**GET /api/metrics/team/:id** - Team-specific metrics  

### Tests

**GET /api/tests** - Get all test cases  
**POST /api/tests** - Create test case  
**GET /api/tests/:id/executions** - Execution history  
**POST /api/tests/:id/execute** - Execute test  

### Features

**GET /api/flaky-tests** - Flaky test analysis  
**GET /api/technical-debt** - Technical debt items  
**GET /api/pipelines/:id/visualize** - Pipeline visualization  
**GET /api/gamification/leaderboard** - Leaderboard  

---

## Database Schema

### Core Tables (21 total)

1. **users** - User accounts
2. **sessions** - Active sessions
3. **teams** - Team information
4. **user_teams** - User-team relationships
5. **metrics** - Quality metrics
6. **test_cases** - Test cases
7. **test_executions** - Test history
8. **builds** - CI/CD builds
9. **pipelines** - Pipeline configs
10. **technical_debt** - Debt tracking
11. **performance_metrics** - Performance data
12. **business_metrics** - Business KPIs
13. **gamification_points** - Points system
14. **gamification_badges** - Badges
15. **gamification_leaderboards** - Rankings
16. **notifications** - User notifications
17. **notification_preferences** - Preferences
18. **audit_logs** - Audit trail
19. **integrations** - External services
20. **webhooks** - Webhook configs
21. **settings** - System settings

*See `docs/technical/DATABASE_SCHEMA.md` for complete SQL*

---

## Security

### Authentication
- JWT tokens (24h expiry)
- Refresh tokens (7d expiry)
- bcrypt password hashing (10 rounds)
- Session management

### Authorization (5 Roles)
1. **Super Admin** - Full access
2. **QA Manager** - Organization oversight
3. **Team Lead** - Team management
4. **QA Engineer** - Testing & execution
5. **Viewer** - Read-only

### Security Features
- Rate limiting (100 req/min)
- Input validation & sanitization
- SQL injection prevention
- XSS protection
- CSRF tokens
- HTTPS/TLS encryption
- Audit logging

---

## Integrations

### Jenkins
```typescript
const jenkins = new JenkinsClient({
  url: process.env.JENKINS_URL,
  token: process.env.JENKINS_TOKEN
});
const build = await jenkins.getBuild('job-name', 123);
```

### Jira
```typescript
const jira = new JiraClient({
  url: process.env.JIRA_URL,
  email: process.env.JIRA_EMAIL,
  token: process.env.JIRA_TOKEN
});
const sprint = await jira.getSprint('sprint-id');
```

### SonarQube
```typescript
const sonar = new SonarQubeClient({
  url: process.env.SONARQUBE_URL,
  token: process.env.SONARQUBE_TOKEN
});
const metrics = await sonar.getMetrics('project-key');
```

---

## Deployment

### Docker Production
```bash
docker build -t irongate:latest .
docker run -p 3000:3000 irongate:latest
```

### Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: irongate
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: irongate
        image: irongate:latest
        ports:
        - containerPort: 3000
```

### Cloud Options
- **AWS**: ECS/EKS + RDS + ElastiCache + S3
- **Azure**: AKS + Azure DB + Redis Cache + Blob
- **GCP**: GKE + Cloud SQL + Memorystore + Storage

---

## Monitoring

### Health Check
```bash
GET /api/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 86400,
  "database": "connected",
  "redis": "connected"
}
```

### Metrics
- Response time, error rate, throughput
- Active users, feature usage
- CPU, memory, disk, network

### Logging
```typescript
logger.info('Event', { userId, action, timestamp });
```

---

## Performance Optimization

1. **Database**: Indexes, connection pooling, read replicas
2. **Caching**: Redis for data, CDN for assets
3. **Frontend**: Code splitting, lazy loading, bundle optimization
4. **Backend**: Query optimization, async processing

---

## Troubleshooting

### Common Issues

**Database connection fails**
- Check DATABASE_URL
- Ensure PostgreSQL is running
- Verify credentials

**JWT token invalid**
- Check JWT_SECRET matches
- Verify token not expired
- Check token format

**Integration fails**
- Verify API tokens
- Check network connectivity
- Review integration logs

### Debug Mode
```bash
LOG_LEVEL=debug npm run start:dev
```

---

## Additional Resources

- **Installation**: `docs/technical/INSTALLATION_GUIDE.md`
- **Database**: `docs/technical/DATABASE_SCHEMA.md`
- **Authentication**: `docs/authentication/AUTH_DEVELOPER_GUIDE.md`
- **Features**: `docs/features/ADVANCED_FEATURES_UPDATE.md`
- **Business**: `docs/business/BUSINESS_PROPOSAL.md`

---

## Support

**Documentation**: All guides in `docs/` folder  
**Email**: support@irongate.com  
**Website**: irongate.com/docs  

---

© 2025 IronGate Software LTD. All rights reserved.
