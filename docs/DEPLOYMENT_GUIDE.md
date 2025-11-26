# 🚀 QA Dashboard Deployment Guide

Complete step-by-step guide to deploy your QA Dashboard to production using **free** resources.

## 📋 Architecture Overview

- **Frontend**: React app hosted on Netlify (Free tier)
- **Backend API**: Netlify Functions (Serverless)
- **Database**: Free MySQL hosting options
- **Cost**: $0/month for small-scale usage

---

## 🗄️ Step 1: Set Up Free MySQL Database

### Option A: Aiven (Recommended - Free 1GB, No Credit Card)

1. **Create Account**
   - Go to [aiven.io](https://aiven.io)
   - Sign up with email (no credit card required)
   - Free tier: 1GB storage, 1 CPU, 1GB RAM

2. **Create MySQL Service**
   ```bash
   # After signing in:
   - Click "Create service"
   - Select "MySQL"
   - Choose "Free" plan
   - Select cloud provider: AWS/Google/Azure
   - Choose region closest to you
   - Name: "qa-dashboard-db"
   - Click "Create service"
   ```

3. **Wait for Service to Start** (2-3 minutes)
   - Status will change from "Rebuilding" to "Running"

4. **Get Connection String**
   ```bash
   # In service overview:
   - Click "Connection information"
   - Copy "Service URI" or individual credentials
   
   # Format:
   mysql://avnadmin:password@host:port/defaultdb?ssl-mode=REQUIRED
   ```

5. **Initialize Database**
   - Use Aiven web console SQL editor
   - Or connect via MySQL client

### Option B: Railway (Free $5 credit/month)

1. **Create Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub
   - Free: $5 credit/month (renews monthly)

2. **Create MySQL Database**
   ```bash
   - Click "New Project"
   - Select "Provision MySQL"
   - Database is created instantly
   ```

3. **Get Connection Details**
   ```bash
   - Click on MySQL service
   - Go to "Variables" tab
   - Copy MYSQL_URL or individual variables
   
   # Format:
   mysql://root:password@host:port/railway
   ```

### Option C: FreeSQLDatabase.com (Free 5MB)

1. **Create Account**
   - Go to [freesqldatabase.com](https://www.freesqldatabase.com)
   - Sign up for free
   - Free tier: 5MB storage (good for testing)

2. **Create Database**
   - Fill in database name
   - Get instant credentials
   - Use phpMyAdmin for management

3. **Connection Details**
   ```
   Host: sql.freedb.tech
   Port: 3306
   Database: your_db_name
   Username: your_username
   Password: your_password
   ```

### Option D: AWS RDS MySQL (Free Tier - 12 Months)

**Best for production use! 20GB storage, 750 hours/month**

1. **Sign in to AWS Console**
   - Go to [console.aws.amazon.com](https://console.aws.amazon.com)
   - Navigate to **RDS** service

2. **Create Database**
   ```bash
   # In RDS Dashboard:
   - Click "Create database"
   - Choose "Standard create"
   - Engine: MySQL (latest version)
   - Templates: "Free tier" ✅
   ```

3. **Configure Settings**
   ```bash
   DB instance identifier: qa-dashboard-db
   Master username: admin
   Master password: [create strong password]
   
   DB instance class: db.t3.micro (free tier eligible)
   Storage: 20 GB (General Purpose SSD)
   
   Connectivity:
   - Public access: Yes ✅
   - VPC security group: Create new
   - Database port: 3306
   ```

4. **Configure Security Group**
   ```bash
   # After database is created:
   - Go to EC2 → Security Groups
   - Find your RDS security group
   - Edit inbound rules
   - Add rule: MySQL/Aurora (3306) from 0.0.0.0/0
   ```

5. **Get Connection Details**
   ```bash
   # In RDS Dashboard:
   - Click your database
   - Copy "Endpoint" (hostname)
   
   # Connection string format:
   mysql://admin:your-password@your-endpoint.rds.amazonaws.com:3306/database_name
   ```

6. **Create Initial Database**
   ```bash
   # Connect using MySQL client
   mysql -h your-endpoint.rds.amazonaws.com -u admin -p
   
   # Create database
   CREATE DATABASE qa_dashboard;
   USE qa_dashboard;
   
   # Run schema
   source database/schema.sql;
   ```

**AWS Free Tier Includes:**
- ✅ 750 hours/month of db.t3.micro (enough for 24/7)
- ✅ 20GB storage
- ✅ 20GB backup storage
- ✅ Valid for 12 months
- ✅ Production-ready performance

### Option E: Clever Cloud (Free 256MB)

1. **Create Account**
   - Go to [clever-cloud.com](https://www.clever-cloud.com)
   - Sign up with GitHub
   - Free tier: 256MB MySQL

2. **Create MySQL Add-on**
   ```bash
   - Create new application
   - Add MySQL add-on
   - Choose "DEV" plan (free)
   - Get connection string from environment variables
   ```

---

## 🗃️ Step 2: Prepare Database Schema

Create a file `database/schema.sql` with your database structure:

```sql
-- Users table
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('admin', 'manager', 'user') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Teams table
CREATE TABLE teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Departments table
CREATE TABLE departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  team_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

-- Test cases table
CREATE TABLE test_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status ENUM('active', 'obsolete', 'redundant') DEFAULT 'active',
  pass_rate DECIMAL(5,2),
  execution_count INT DEFAULT 0,
  effectiveness_score DECIMAL(5,2),
  department_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- Metrics table
CREATE TABLE metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  metric_type VARCHAR(100) NOT NULL,
  metric_value DECIMAL(10,2),
  department_id INT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- Add indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_test_cases_status ON test_cases(status);
CREATE INDEX idx_metrics_type ON metrics(metric_type);
CREATE INDEX idx_metrics_recorded_at ON metrics(recorded_at);
```

Run this schema on your chosen database platform.

---

## 🔧 Step 3: Set Up Backend API (Netlify Functions)

### 3.1 Install Dependencies

```bash
cd /Users/ionutapostu/Desktop/QA\ Dashboard/qa-dashboard

# Install Netlify CLI
npm install -g netlify-cli

# Install MySQL client
npm install mysql2

# Install dotenv for environment variables
npm install dotenv
```

### 3.2 Create Netlify Functions Directory

```bash
mkdir -p netlify/functions
```

### 3.3 Create API Functions

Create `netlify/functions/api-auth.ts`:

```typescript
import { Handler } from '@netlify/functions';
import mysql from 'mysql2/promise';

const connection = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const path = event.path.replace('/.netlify/functions/api-auth', '');
    
    if (path === '/login' && event.httpMethod === 'POST') {
      const { email, password } = JSON.parse(event.body || '{}');
      
      const [rows] = await connection.query(
        'SELECT * FROM users WHERE email = ?',
        [email]
      );
      
      // Add password verification logic here
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, user: rows[0] })
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

Create similar functions for:
- `netlify/functions/api-teams.ts`
- `netlify/functions/api-departments.ts`
- `netlify/functions/api-metrics.ts`

---

## 📦 Step 4: Configure Netlify

### 4.1 Create `netlify.toml`

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[dev]
  command = "npm run dev"
  port = 5173
  targetPort = 5173
  autoLaunch = false
```

### 4.2 Update `package.json`

Add build scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "netlify:dev": "netlify dev"
  }
}
```

---

## 🌐 Step 5: Deploy to Netlify

### Method A: Using Netlify CLI (Recommended)

```bash
# Login to Netlify
netlify login

# Initialize site
netlify init

# Follow prompts:
# - Create & configure a new site
# - Team: Your team
# - Site name: qa-dashboard (or your choice)
# - Build command: npm run build
# - Publish directory: dist

# Set environment variables
netlify env:set DATABASE_URL "your-mysql-connection-string"
netlify env:set secrettoken "your-secret-key-here"

# Deploy
netlify deploy --prod
```

### Method B: Using Netlify Dashboard

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/qa-dashboard.git
   git push -u origin main
   ```

2. **Connect to Netlify**
   - Go to [app.netlify.com](https://app.netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Choose GitHub and select your repository
   
3. **Configure Build Settings**
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Click "Show advanced" → "New variable"
   
4. **Add Environment Variables**
   ```
   DATABASE_URL = your-mysql-connection-string
   secrettoken = your-secret-key
   ```

5. **Deploy**
   - Click "Deploy site"
   - Wait 2-3 minutes for build to complete

---

## 🔐 Step 6: Secure Your Application

### 6.1 Environment Variables

Never commit these to Git! Add to `.env.local`:

```bash
# .env.local (DO NOT COMMIT)
DATABASE_URL=mysql://user:pass@host/database
secrettoken=your-super-secret-key-change-this
VITE_API_URL=https://your-app.netlify.app/api
```

Add to `.gitignore`:
```
.env.local
.env.production
```

### 6.2 Set Up Authentication

Update your API functions to use JWT:

```bash
npm install jsonwebtoken bcryptjs
```

---

## 🧪 Step 7: Test Your Deployment

### 7.1 Test Database Connection

```bash
# Create a test function
netlify functions:create test-db

# Test locally
netlify dev
```

### 7.2 Test API Endpoints

```bash
# Test login
curl -X POST https://your-app.netlify.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Test data fetch
curl https://your-app.netlify.app/api/teams
```

---

## 📊 Step 8: Monitor Your Application

### Free Monitoring Tools

1. **Netlify Analytics** (Built-in)
   - Page views
   - Bandwidth usage
   - Function invocations

2. **PlanetScale Insights** (Built-in)
   - Query performance
   - Connection pool stats
   - Storage usage

3. **Sentry** (Free tier)
   ```bash
   npm install @sentry/react
   ```

---

## 🔄 Step 9: Set Up Continuous Deployment

### Automatic Deploys

With GitHub connected:
1. Push to `main` branch → Auto-deploy to production
2. Push to other branches → Deploy preview URLs

```bash
# Deploy preview
git checkout -b feature/new-dashboard
git push origin feature/new-dashboard
# Netlify creates preview URL automatically
```

---

## 📈 Step 10: Optimize for Production

### 10.1 Enable Caching

Update `netlify.toml`:

```toml
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

### 10.2 Enable Compression

Netlify automatically compresses assets, but ensure your build is optimized:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        }
      }
    }
  }
});
```

---

## 🎯 Quick Deployment Checklist

- [ ] Database created and schema initialized
- [ ] Environment variables set in Netlify
- [ ] `netlify.toml` configured
- [ ] API functions created
- [ ] GitHub repository connected
- [ ] First deployment successful
- [ ] Database connection tested
- [ ] Authentication working
- [ ] API endpoints responding
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active (automatic)
- [ ] Monitoring set up

---

## 🆘 Troubleshooting

### Build Fails

```bash
# Check build logs
netlify logs

# Test build locally
npm run build

# Clear cache and rebuild
netlify build --clear-cache
```

### Database Connection Issues

```bash
# Test connection string
mysql -h hostname -u username -p database_name

# Check environment variables
netlify env:list
```

### Function Errors

```bash
# View function logs
netlify functions:log api-auth

# Test function locally
netlify dev
```

---

## 💰 Cost Breakdown (Free Tier Limits)

| Service | Free Tier | Duration | Upgrade Cost |
|---------|-----------|----------|--------------|
| **Netlify** | 100GB bandwidth/month | Forever | $19/month for 400GB |
| **AWS RDS MySQL** | 20GB storage, 750hrs/month | 12 months | $15-30/month after |
| **Aiven MySQL** | 1GB storage, 1GB RAM | Forever | $10/month for 4GB |
| **Railway** | $5 credit/month | Forever | Pay as you go |
| **Clever Cloud** | 256MB MySQL | Forever | €2/month for 1GB |
| **Domain** | Use Netlify subdomain | Forever | $10-15/year |

**Total Monthly Cost**: $0 (within free limits)

### 🎯 Recommended Database by Use Case:

| Use Case | Best Option | Why |
|----------|-------------|-----|
| **Production (12 months)** | AWS RDS | 20GB, reliable, scalable |
| **Long-term free** | Aiven | 1GB forever, no credit card |
| **Quick testing** | Railway | Instant setup, $5/month credit |
| **Small projects** | Clever Cloud | 256MB, simple setup |
| **After AWS free tier** | Aiven or Railway | Continue free or low cost |

### 💡 Pro Tip:
Start with **AWS RDS** for 12 months of production-grade hosting, then migrate to **Aiven** or upgrade AWS when needed.

---

## 🚀 Going Live

Once everything is tested:

1. **Custom Domain** (Optional)
   ```bash
   # In Netlify dashboard:
   - Domain settings → Add custom domain
   - Follow DNS configuration steps
   ```

2. **SSL Certificate**
   - Automatically provisioned by Netlify
   - No configuration needed

3. **Share Your App**
   ```
   Production URL: https://your-app.netlify.app
   API Base URL: https://your-app.netlify.app/api
   ```

---

## 📚 Additional Resources

- [Netlify Documentation](https://docs.netlify.com)
- [Aiven MySQL Docs](https://aiven.io/docs/products/mysql)
- [Railway Documentation](https://docs.railway.app)
- [Netlify Functions Guide](https://docs.netlify.com/functions/overview/)
- [React Deployment Best Practices](https://create-react-app.dev/docs/deployment/)

## 🆓 Alternative Free Database Options

If you need more storage or features, consider these alternatives:

### Supabase (Free PostgreSQL - 500MB)
- Go to [supabase.com](https://supabase.com)
- Free tier: 500MB database, 1GB file storage
- Includes authentication, real-time subscriptions
- Note: PostgreSQL, not MySQL (requires code changes)

### Neon (Free PostgreSQL - 3GB)
- Go to [neon.tech](https://neon.tech)
- Free tier: 3GB storage, serverless PostgreSQL
- Auto-scaling and branching
- Note: PostgreSQL, not MySQL (requires code changes)

### CockroachDB (Free 5GB)
- Go to [cockroachlabs.com](https://www.cockroachlabs.com/get-started-cockroachdb/)
- Free tier: 5GB storage, 250M RUs/month
- PostgreSQL-compatible
- Note: Requires PostgreSQL adapter

### MongoDB Atlas (Free 512MB)
- Go to [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
- Free tier: 512MB storage
- NoSQL database
- Note: Requires complete data model change

---

## 🎉 Success!

Your QA Dashboard is now live and accessible worldwide! 🌍

**Next Steps:**
- Set up monitoring and alerts
- Configure backup strategy for database
- Implement CI/CD pipelines
- Add performance monitoring
- Set up error tracking with Sentry

Need help? Check the troubleshooting section or open an issue on GitHub.
