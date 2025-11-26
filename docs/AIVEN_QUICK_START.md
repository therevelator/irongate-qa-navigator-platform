# ⚡ Aiven Quick Start - Your Database is Ready!

Your Aiven MySQL database is already set up. Let's get it running with your QA Dashboard in **10 minutes**!

---

## 📊 Your Database Info

```
Host: mysql-11d3e650-ionut-817b.b.aivencloud.com
Port: 16234
User: avnadmin
Database: defaultdb
```

---

## 🚀 Quick Setup (Choose One Method)

### Method 1: Automated Script (Recommended - 5 minutes)

```bash
# Run the automated setup script
./setup-aiven.sh

# It will:
# ✅ Test your database connection
# ✅ Initialize all tables
# ✅ Create .env.local file
# ✅ Deploy to Netlify (optional)
```

### Method 2: Manual Setup (10 minutes)

#### Step 1: Test Connection
```bash
mysql --user avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port 16234 \
      --ssl-mode=REQUIRED \
      -e "SELECT 1;" defaultdb
```

✅ If you see output, connection works!

#### Step 2: Initialize Database
```bash
mysql --user avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port 16234 \
      --ssl-mode=REQUIRED \
      defaultdb < database/schema.sql
```

✅ This creates all your tables (users, teams, test_cases, etc.)

#### Step 3: Create Environment File
```bash
cat > .env.local << 'EOF'
DATABASE_URL=mysql://avnadmin:YOUR_AIVEN_PASSWORD@your-mysql-host.aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED
JWT_SECRET=your-secret-key-here
VITE_API_URL=http://localhost:8888/api
EOF
```

#### Step 4: Test Locally
```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# In another terminal, test with Netlify functions
netlify dev
```

Visit: http://localhost:8888

#### Step 5: Deploy to Netlify
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Initialize site
netlify init

# Set environment variables
netlify env:set DATABASE_URL "mysql://avnadmin:YOUR_AIVEN_PASSWORD@your-mysql-host.aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED"

netlify env:set JWT_SECRET "$(openssl rand -base64 32)"

# Build and deploy
npm run build
netlify deploy --prod
```

---

## ✅ Verify Everything Works

### 1. Check Tables Were Created
```bash
mysql --user avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port 16234 \
      --ssl-mode=REQUIRED \
      -e "SHOW TABLES;" defaultdb
```

You should see:
- users
- teams
- departments
- test_cases
- metrics
- test_executions
- etc.

### 2. Check Your Netlify Site
```bash
# Get your site URL
netlify status

# Open in browser
netlify open
```

### 3. Test the Application
1. Visit your Netlify URL
2. Try to register/login
3. Create a team
4. Add some test cases
5. Refresh page - data should persist!

---

## 🔧 Common Issues

### Issue: "Access denied for user"
**Solution:** Check password is correct (no spaces)
```bash
# Password: YOUR_AIVEN_PASSWORD
```

### Issue: "Can't connect to MySQL server"
**Solution:** Ensure SSL mode is enabled
```bash
# Add: --ssl-mode=REQUIRED
# Or in connection string: ?ssl-mode=REQUIRED
```

### Issue: "Unknown database 'defaultdb'"
**Solution:** Database name is case-sensitive
```bash
# Use: defaultdb (lowercase)
```

### Issue: Tables not created
**Solution:** Check schema.sql file exists
```bash
ls -la database/schema.sql
# If missing, it's in the database/ folder
```

---

## 📊 Database Management

### View All Data
```bash
# Connect to database
mysql --user avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port 16234 \
      --ssl-mode=REQUIRED \
      defaultdb

# Then run SQL commands:
SHOW TABLES;
SELECT * FROM users;
SELECT * FROM teams;
```

### Backup Your Database
```bash
mysqldump --user avnadmin \
          --password=YOUR_AIVEN_PASSWORD \
          --host mysql-11d3e650-ionut-817b.b.aivencloud.com \
          --port 16234 \
          --ssl-mode=REQUIRED \
          defaultdb > backup_$(date +%Y%m%d).sql
```

### Restore from Backup
```bash
mysql --user avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port 16234 \
      --ssl-mode=REQUIRED \
      defaultdb < backup_20241126.sql
```

---

## 🎯 Your Aiven Free Tier

✅ **Storage**: 1GB (enough for ~10,000 test cases)
✅ **Duration**: Forever free!
✅ **Backups**: Manual (use mysqldump)
✅ **Performance**: Good for small-medium teams
✅ **SSL**: Included and required

### Monitor Usage
1. Go to [console.aiven.io](https://console.aiven.io)
2. Click your MySQL service
3. View "Metrics" tab
4. Check storage usage

---

## 🔐 Security Best Practices

### 1. Rotate Password (Optional)
```bash
# In Aiven console:
- Go to your MySQL service
- Click "Users" tab
- Reset password for avnadmin
- Update .env.local and Netlify env vars
```

### 2. Restrict Access (Optional)
```bash
# In Aiven console:
- Go to "Overview" tab
- Under "Allowed IP Addresses"
- Add specific IPs instead of 0.0.0.0/0
```

### 3. Enable Backups
```bash
# Set up automated backups:
# Create a cron job to run mysqldump daily
crontab -e

# Add line:
0 2 * * * /path/to/backup-script.sh
```

---

## 📈 Next Steps

### 1. Customize Your Dashboard
- Update branding in `src/components`
- Modify color scheme in `tailwind.config.js`
- Add your company logo

### 2. Set Up Monitoring
```bash
# Install Sentry for error tracking
npm install @sentry/react

# Add to your app
```

### 3. Configure Custom Domain
```bash
# In Netlify dashboard:
- Domain settings
- Add custom domain
- Update DNS records
```

### 4. Invite Team Members
- Create user accounts in database
- Share Netlify URL
- Set up roles and permissions

---

## 💡 Pro Tips

1. **Use MySQL Workbench**: Visual database management
   - Download: https://dev.mysql.com/downloads/workbench/
   - Connect using your Aiven credentials

2. **Enable Query Logging**: Debug slow queries
   - Aiven console → Logs tab

3. **Set Up Alerts**: Get notified of issues
   - Aiven console → Integrations

4. **Regular Backups**: Schedule weekly backups
   - Use the mysqldump command above

---

## 🆘 Need Help?

- **Full Guide**: `DEPLOYMENT_GUIDE.md`
- **AWS Alternative**: `AWS_DEPLOYMENT.md`
- **Quick Deploy**: `QUICK_DEPLOY.md`
- **Aiven Docs**: https://aiven.io/docs/products/mysql

---

## ✅ Quick Checklist

- [ ] Database connection tested
- [ ] Schema initialized (tables created)
- [ ] .env.local file created
- [ ] Local dev server working
- [ ] Netlify CLI installed
- [ ] Environment variables set in Netlify
- [ ] Application deployed to Netlify
- [ ] Can login/register users
- [ ] Data persists after refresh
- [ ] Backup strategy in place

---

**Setup Time**: ~10 minutes ⏱️
**Cost**: $0 forever 💰
**Storage**: 1GB 📊
**Perfect for**: Small-medium teams 👥
