# QA Pulse - Installation Guide

## Prerequisites

### System Requirements
- **Node.js**: v20.19+ or v22.12+
- **npm**: v10.0+
- **Operating System**: macOS, Linux, or Windows
- **RAM**: Minimum 4GB
- **Disk Space**: 500MB for application + database

### Required Tools
- Git
- Text editor (VS Code recommended)
- Terminal/Command Prompt

---

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/qa-dashboard.git
cd qa-dashboard
```

---

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages:
- React 19
- Vite 7
- TailwindCSS 4
- Recharts
- Lucide React icons

---

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
touch .env
```

Add the following configuration:

```env
# Application
VITE_APP_NAME=QA Pulse
VITE_APP_VERSION=1.0.0

# API Endpoints (for future backend integration)
VITE_API_URL=http://localhost:3001/api
VITE_API_TIMEOUT=30000

# Feature Flags
VITE_ENABLE_REAL_DATA=false
VITE_ENABLE_ALERTS=false
```

---

### 4. Start Development Server

```bash
npm run dev
```

The application will start at: **http://localhost:5173**

You should see:
```
VITE v7.2.2  ready in XXX ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

---

### 5. Verify Installation

Open your browser and navigate to `http://localhost:5173`

You should see:
- ✅ QA Pulse dashboard with sidebar
- ✅ 5 sample teams displayed
- ✅ Overall QA Score in header
- ✅ Ability to click on teams for detailed view

---

## Production Build

### Build for Production

```bash
npm run build
```

This creates an optimized build in the `dist/` folder.

### Preview Production Build

```bash
npm run preview
```

---

## Deployment Options

### Option 1: Netlify (Recommended for Quick Deploy)

1. **Install Netlify CLI**
```bash
npm install -g netlify-cli
```

2. **Login to Netlify**
```bash
netlify login
```

3. **Deploy**
```bash
netlify deploy --prod
```

### Option 2: Vercel

1. **Install Vercel CLI**
```bash
npm install -g vercel
```

2. **Deploy**
```bash
vercel --prod
```

### Option 3: AWS S3 + CloudFront

1. **Build the app**
```bash
npm run build
```

2. **Upload to S3**
```bash
aws s3 sync dist/ s3://your-bucket-name --delete
```

3. **Invalidate CloudFront cache**
```bash
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

### Option 4: Docker

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:
```bash
docker build -t qa-dashboard .
docker run -p 8080:80 qa-dashboard
```

---

## Backend Setup (For Real Data Integration)

### 1. Create Backend Directory

```bash
mkdir backend
cd backend
npm init -y
```

### 2. Install Backend Dependencies

```bash
npm install express cors dotenv node-cron
npm install axios pg
npm install -D typescript @types/node @types/express ts-node nodemon
```

### 3. Create Backend Structure

```
backend/
├── src/
│   ├── server.ts
│   ├── config/
│   │   └── database.ts
│   ├── services/
│   │   ├── jenkinsService.ts
│   │   ├── jiraService.ts
│   │   └── sonarService.ts
│   ├── routes/
│   │   └── api.ts
│   └── scheduler.ts
├── .env
├── package.json
└── tsconfig.json
```

### 4. Backend .env Configuration

```env
# Server
PORT=3001
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qa_dashboard
DB_USER=postgres
DB_PASSWORD=your_password

# Jenkins
JENKINS_URL=https://jenkins.company.com
JENKINS_USERNAME=admin
JENKINS_API_TOKEN=your_token

# Jira
JIRA_URL=https://company.atlassian.net
JIRA_EMAIL=user@company.com
JIRA_API_TOKEN=your_token

# SonarQube
SONAR_URL=https://sonar.company.com
SONAR_TOKEN=your_token
```

### 5. Start Backend

```bash
cd backend
npm run dev
```

---

## Database Setup (PostgreSQL)

### 1. Install PostgreSQL

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. Create Database

```bash
psql postgres
```

```sql
CREATE DATABASE qa_dashboard;
CREATE USER qa_admin WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE qa_dashboard TO qa_admin;
\q
```

### 3. Create Tables

```sql
-- Teams table
CREATE TABLE teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    department VARCHAR(100),
    qa_score INTEGER,
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Metrics table
CREATE TABLE metrics (
    id SERIAL PRIMARY KEY,
    team_id INTEGER REFERENCES teams(id),
    metric_name VARCHAR(100),
    metric_value DECIMAL(10,2),
    metric_unit VARCHAR(20),
    category VARCHAR(50),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_team_id ON metrics(team_id);
CREATE INDEX idx_recorded_at ON metrics(recorded_at);
```

---

## Troubleshooting

### Issue: Port 5173 already in use

**Solution:**
```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use a different port
npm run dev -- --port 3000
```

### Issue: Node version mismatch

**Solution:**
```bash
# Check your Node version
node -v

# Upgrade Node using nvm
nvm install 20.19
nvm use 20.19
```

### Issue: Module not found errors

**Solution:**
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Issue: Tailwind styles not loading

**Solution:**
```bash
# Ensure Tailwind is properly configured
npm install -D @tailwindcss/vite
# Restart dev server
npm run dev
```

---

## Environment-Specific Configuration

### Development
```bash
npm run dev
```
- Hot module replacement enabled
- Source maps included
- Debug mode active

### Staging
```bash
VITE_API_URL=https://api-staging.company.com npm run build
```

### Production
```bash
VITE_API_URL=https://api.company.com npm run build
```

---

## Security Checklist

- [ ] All API keys stored in `.env` (never committed)
- [ ] `.env` added to `.gitignore`
- [ ] HTTPS enabled in production
- [ ] CORS properly configured
- [ ] Rate limiting implemented
- [ ] Authentication/Authorization in place
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention
- [ ] XSS protection enabled

---

## Performance Optimization

### 1. Enable Compression
```typescript
// vite.config.ts
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    compression({ algorithm: 'gzip' })
  ]
});
```

### 2. Code Splitting
Already enabled by Vite - no additional configuration needed.

### 3. Image Optimization
```bash
npm install -D vite-plugin-imagemin
```

---

## Monitoring & Logging

### Frontend Error Tracking (Sentry)

```bash
npm install @sentry/react
```

```typescript
// src/main.tsx
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "your-sentry-dsn",
  environment: import.meta.env.MODE,
});
```

### Backend Logging (Winston)

```bash
npm install winston
```

---

## Backup & Recovery

### Database Backup
```bash
# Backup
pg_dump qa_dashboard > backup_$(date +%Y%m%d).sql

# Restore
psql qa_dashboard < backup_20251119.sql
```

### Application Backup
```bash
# Backup configuration and data
tar -czf qa-dashboard-backup.tar.gz .env backend/src frontend/src
```

---

## Support & Maintenance

### Update Dependencies
```bash
# Check for updates
npm outdated

# Update all dependencies
npm update

# Update specific package
npm install package-name@latest
```

### Health Check Endpoint
```typescript
// backend/src/routes/health.ts
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

---

## Next Steps

1. ✅ Complete installation
2. ✅ Verify dashboard loads
3. ⏭️ Configure backend integrations (see DATA_INTEGRATION.md)
4. ⏭️ Set up database
5. ⏭️ Configure API credentials
6. ⏭️ Deploy to production
7. ⏭️ Train users (see USER_GUIDE.md)

---

## Additional Resources

- **Documentation**: See `USER_GUIDE.md`
- **Data Integration**: See `DATA_INTEGRATION.md`
- **Business Case**: See `BUSINESS_PROPOSAL.md`
- **Support**: [your-support-email@company.com]

---

*Installation Guide Version: 1.0*  
*Last Updated: November 19, 2025*
