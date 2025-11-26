# 🚀 AWS Free Tier Deployment Guide

Deploy your QA Dashboard using AWS Free Tier - **completely free for 12 months!**

---

## 📋 What You Get (Free for 12 Months)

- ✅ **RDS MySQL**: 750 hours/month (24/7 operation)
- ✅ **20GB Storage**: General Purpose SSD
- ✅ **20GB Backup**: Automated backups
- ✅ **Production-ready**: db.t3.micro instance
- ✅ **Reliable**: 99.95% uptime SLA

**Perfect for production use!**

---

## 🗄️ Step 1: Create RDS MySQL Database (10 minutes)

### 1.1 Access RDS Console

```bash
1. Go to https://console.aws.amazon.com
2. Sign in to your AWS account
3. Search for "RDS" in the services search bar
4. Click "RDS" to open the dashboard
```

### 1.2 Create Database

Click **"Create database"** button and configure:

#### **Engine Options**
```
✅ Standard create
Engine type: MySQL
Edition: MySQL Community
Version: MySQL 8.0.35 (or latest)
```

#### **Templates**
```
✅ Free tier (IMPORTANT: This ensures you stay within free limits)
```

#### **Settings**
```
DB instance identifier: qa-dashboard-db
Credentials Settings:
  Master username: admin
  ✅ Auto generate a password (or set your own)
  Master password: [Your secure password]
  Confirm password: [Same password]
```

#### **Instance Configuration**
```
DB instance class: db.t3.micro (Free tier eligible) ✅
Storage type: General Purpose SSD (gp2)
Allocated storage: 20 GB (maximum for free tier)
✅ Enable storage autoscaling: NO (to avoid charges)
```

#### **Connectivity**
```
Compute resource: Don't connect to an EC2 compute resource
Network type: IPv4
Virtual private cloud (VPC): Default VPC
DB subnet group: default
✅ Public access: Yes (IMPORTANT: Required for Netlify to connect)
VPC security group: Create new
  New VPC security group name: qa-dashboard-sg
Availability Zone: No preference
Database port: 3306
```

#### **Database Authentication**
```
✅ Password authentication
```

#### **Monitoring**
```
✅ Enable Enhanced monitoring: NO (to avoid charges)
```

#### **Additional Configuration**
```
Initial database name: qa_dashboard
✅ Enable automated backups: Yes
Backup retention period: 7 days
Backup window: No preference
✅ Enable encryption: Yes (free)
✅ Enable auto minor version upgrade: Yes
Maintenance window: No preference
✅ Enable deletion protection: Yes (recommended)
```

### 1.3 Create Database

- Click **"Create database"**
- Wait 5-10 minutes for database to be created
- Status will change from "Creating" to "Available"

---

## 🔐 Step 2: Configure Security (5 minutes)

### 2.1 Get Database Endpoint

```bash
1. In RDS Dashboard, click your database "qa-dashboard-db"
2. Under "Connectivity & security" tab
3. Copy the "Endpoint" (e.g., qa-dashboard-db.xxxxx.us-east-1.rds.amazonaws.com)
4. Note the "Port" (should be 3306)
```

### 2.2 Configure Security Group

**Allow external connections (required for Netlify):**

```bash
1. In RDS dashboard, click your database
2. Under "Connectivity & security" → Click the security group link
3. Click "Edit inbound rules"
4. Click "Add rule"
   - Type: MySQL/Aurora
   - Protocol: TCP
   - Port: 3306
   - Source: 0.0.0.0/0 (or Anywhere-IPv4)
   - Description: Allow MySQL connections
5. Click "Save rules"
```

**⚠️ Security Note:** For production, restrict to specific IPs. For Netlify, you need to allow all IPs since Netlify Functions use dynamic IPs.

### 2.3 Get Master Password

```bash
# If you auto-generated the password:
1. Go to AWS Secrets Manager
2. Find secret named "rds!db-xxxxx"
3. Click "Retrieve secret value"
4. Copy the password

# Or use the password you set manually
```

---

## 🗃️ Step 3: Initialize Database (5 minutes)

### 3.1 Connect to Database

**Option A: Using MySQL Workbench (Recommended)**

```bash
1. Download MySQL Workbench: https://dev.mysql.com/downloads/workbench/
2. Open MySQL Workbench
3. Click "+" to create new connection
4. Configure:
   Connection Name: QA Dashboard AWS
   Hostname: [Your RDS endpoint]
   Port: 3306
   Username: admin
   Password: [Your master password]
5. Click "Test Connection"
6. Click "OK" to save
```

**Option B: Using MySQL CLI**

```bash
# Install MySQL client if needed
brew install mysql  # macOS
sudo apt-get install mysql-client  # Ubuntu

# Connect to database
mysql -h qa-dashboard-db.xxxxx.us-east-1.rds.amazonaws.com \
      -P 3306 \
      -u admin \
      -p

# Enter password when prompted
```

### 3.2 Run Database Schema

```sql
-- Create database (if not created during setup)
CREATE DATABASE IF NOT EXISTS qa_dashboard;
USE qa_dashboard;

-- Copy and paste contents from database/schema.sql
-- Or run from file:
source /path/to/database/schema.sql;

-- Verify tables were created
SHOW TABLES;

-- Should see: users, teams, departments, test_cases, etc.
```

### 3.3 Create Admin User

```sql
-- Create initial admin user
INSERT INTO users (email, password_hash, name, role) 
VALUES (
  'admin@yourdomain.com',
  '$2a$10$YourHashedPasswordHere',  -- Use bcrypt to hash your password
  'Admin User',
  'admin'
);

-- Verify
SELECT * FROM users;
```

---

## 🌐 Step 4: Deploy to Netlify (5 minutes)

### 4.1 Prepare Connection String

```bash
# Format your DATABASE_URL:
mysql://admin:YOUR_PASSWORD@YOUR_ENDPOINT.rds.amazonaws.com:3306/qa_dashboard

# Example:
mysql://admin:MySecurePass123@qa-dashboard-db.abc123.us-east-1.rds.amazonaws.com:3306/qa_dashboard
```

### 4.2 Deploy Using Script

```bash
cd /Users/ionutapostu/Desktop/QA\ Dashboard/qa-dashboard

# Run deployment script
./deploy.sh

# When prompted, enter your AWS RDS connection string
```

### 4.3 Manual Deployment

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Initialize
netlify init

# Set environment variables
netlify env:set DATABASE_URL "mysql://admin:password@endpoint.rds.amazonaws.com:3306/qa_dashboard"
netlify env:set secrettoken "$(openssl rand -base64 32)"

# Build and deploy
npm run build
netlify deploy --prod
```

---

## ✅ Step 5: Verify Everything Works

### 5.1 Test Database Connection

```bash
# Create a test function
cat > test-db.js << 'EOF'
const mysql = require('mysql2/promise');

async function test() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await connection.query('SELECT 1 + 1 AS result');
  console.log('Database connected!', rows);
  await connection.end();
}

test();
EOF

# Run test
node test-db.js
```

### 5.2 Test Your Application

1. Visit your Netlify URL: `https://your-app.netlify.app`
2. Try to log in or register
3. Check if data persists after refresh
4. Verify API endpoints are working

---

## 📊 Monitor Your Usage

### Check Free Tier Usage

```bash
1. Go to AWS Billing Dashboard
2. Click "Free Tier" in left menu
3. Monitor your RDS usage:
   - Hours used: Should stay under 750/month
   - Storage: Should stay under 20GB
   - Backups: Should stay under 20GB
```

### Set Up Billing Alerts

```bash
1. Go to AWS Billing Dashboard
2. Click "Billing preferences"
3. Enable "Receive Free Tier Usage Alerts"
4. Enter your email
5. Set alert threshold (e.g., 80% of free tier)
```

---

## 🔧 Common Issues & Solutions

### Issue: Can't Connect to Database

**Solution 1: Check Security Group**
```bash
- Ensure port 3306 is open to 0.0.0.0/0
- Verify security group is attached to RDS instance
```

**Solution 2: Check Public Access**
```bash
- RDS instance must have "Public access: Yes"
- Verify VPC has internet gateway
```

**Solution 3: Check Connection String**
```bash
# Correct format:
mysql://username:password@endpoint:3306/database

# Common mistakes:
- Missing database name at the end
- Wrong port number
- Incorrect endpoint (should end with .rds.amazonaws.com)
```

### Issue: "Too many connections"

**Solution:**
```sql
-- Check current connections
SHOW PROCESSLIST;

-- Increase max connections (if needed)
-- Modify DB parameter group in RDS console
```

### Issue: Slow Performance

**Solution:**
```bash
1. Enable Performance Insights in RDS console
2. Check slow query log
3. Add indexes to frequently queried columns
4. Consider upgrading after free tier expires
```

---

## 💰 Cost Management

### Staying Within Free Tier

✅ **Do:**
- Use db.t3.micro instance
- Keep storage under 20GB
- Run 24/7 (750 hours = 31 days)
- Enable automated backups (included)

❌ **Don't:**
- Enable Enhanced Monitoring (costs extra)
- Enable Multi-AZ deployment
- Use larger instance types
- Exceed 20GB storage
- Enable Performance Insights (costs extra)

### After 12 Months

**Option 1: Continue with AWS**
- Cost: ~$15-30/month for db.t3.micro
- Keep same setup, just start paying

**Option 2: Migrate to Free Alternative**
```bash
# Export your data
mysqldump -h endpoint -u admin -p qa_dashboard > backup.sql

# Import to Aiven/Railway
mysql -h new-host -u user -p new_database < backup.sql

# Update DATABASE_URL in Netlify
netlify env:set DATABASE_URL "new-connection-string"
```

---

## 🎯 Performance Optimization

### Enable Connection Pooling

```typescript
// In your Netlify functions
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});
```

### Add Indexes

```sql
-- Add indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_test_cases_status ON test_cases(status);
CREATE INDEX idx_metrics_recorded_at ON metrics(recorded_at);
```

### Enable Query Cache

```sql
-- Check if query cache is enabled
SHOW VARIABLES LIKE 'query_cache%';

-- Enable in parameter group if needed
```

---

## 🔄 Backup & Recovery

### Automated Backups (Included Free)

```bash
# Backups are automatic with 7-day retention
# To restore:
1. Go to RDS Dashboard
2. Select your database
3. Click "Actions" → "Restore to point in time"
4. Choose date/time
5. Create new instance
```

### Manual Backup

```bash
# Export database
mysqldump -h endpoint.rds.amazonaws.com \
          -u admin \
          -p \
          qa_dashboard > backup_$(date +%Y%m%d).sql

# Compress
gzip backup_*.sql

# Store in S3 (also free tier eligible)
aws s3 cp backup_*.sql.gz s3://your-backup-bucket/
```

---

## 🎉 Success Checklist

- [ ] RDS MySQL instance created (db.t3.micro)
- [ ] Security group configured (port 3306 open)
- [ ] Database schema initialized
- [ ] Admin user created
- [ ] Connection string obtained
- [ ] Netlify deployed with DATABASE_URL
- [ ] Application tested and working
- [ ] Billing alerts configured
- [ ] Backup strategy in place

---

## 📚 Additional Resources

- [AWS RDS Free Tier](https://aws.amazon.com/rds/free/)
- [RDS MySQL Documentation](https://docs.aws.amazon.com/rds/index.html)
- [AWS Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/)
- [RDS Best Practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html)

---

## 💡 Pro Tips

1. **Set Calendar Reminder**: 11 months from now to decide on next steps
2. **Monitor Usage Weekly**: Check AWS Free Tier dashboard
3. **Enable CloudWatch Alarms**: Get notified of issues
4. **Use Parameter Groups**: Easy to modify database settings
5. **Tag Your Resources**: Add tags like "Project: QA-Dashboard"

---

**Deployment Time**: ~25 minutes ⏱️
**Cost**: $0 for 12 months, then ~$15-30/month 💰
**Storage**: 20GB (enough for ~100,000 test cases) 📊
**Performance**: Production-ready 🚀
