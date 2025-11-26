# ⚡ Quick Deploy Guide - 15 Minutes to Production

Get your QA Dashboard live in 3 simple steps!

---

## 🎯 Step 1: Database (10 minutes)

### Option A: AWS RDS (Recommended for Production - Free 12 Months)

**Best choice if you have AWS account! 20GB storage, production-ready**

1. Go to **[AWS Console](https://console.aws.amazon.com)** → RDS
2. Click **"Create database"**
3. Choose **"Free tier"** template ✅
4. Configure:
   - Engine: MySQL
   - Instance: db.t3.micro
   - Storage: 20GB
   - Public access: **Yes**
   - Master username: admin
   - Set password
5. Wait 5-10 minutes for creation
6. Copy endpoint from RDS dashboard

**Your connection string:**
```
mysql://admin:password@endpoint.rds.amazonaws.com:3306/qa_dashboard
```

**📖 Detailed Guide**: See `AWS_DEPLOYMENT.md`

### Option B: Aiven (Forever Free - No Credit Card)

1. Go to **[aiven.io](https://aiven.io)** → Sign up
2. Click **"Create service"** → Select **"MySQL"**
3. Choose **"Free"** plan → Select region → Name it **"qa-dashboard-db"**
4. Wait 2-3 minutes for service to start
5. Copy **"Service URI"** from connection info

**Your connection string:**
```
mysql://avnadmin:password@mysql-xxx.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED
```

### Option C: Railway ($5/month credit)

1. Go to **[railway.app](https://railway.app)** → Sign up with GitHub
2. Click **"New Project"** → **"Provision MySQL"**
3. Click MySQL service → **"Variables"** tab → Copy **MYSQL_URL**

---

## 🗄️ Step 2: Initialize Database (2 minutes)

### Option A: Using Aiven Web Console

1. In Aiven dashboard → Click your MySQL service
2. Go to **"Query Editor"** tab
3. Copy contents from `database/schema.sql`
4. Paste and click **"Run"**

### Option B: Using MySQL Client

```bash
# Connect to your database
mysql -h your-host -u your-user -p your-database

# Run schema
source database/schema.sql
```

---

## 🚀 Step 3: Deploy to Netlify (8 minutes)

### Prerequisites

The app is configured for Netlify with:
- ✅ **Serverless Functions** - Backend runs as Netlify Functions (no separate server needed)
- ✅ **esbuild bundler** - Automatically bundles TypeScript
- ✅ **API redirects** - `/api/*` routes to functions
- ✅ **Environment variables** - Secure config management

### Automated Deployment (Easiest)

```bash
# Run the deployment script
./deploy.sh

# Follow the prompts:
# 1. Enter your DATABASE_URL
# 2. Login to Netlify
# 3. Configure your site
# 4. Deploy!
```

### Manual Deployment

```bash
# 1. Install dependencies (includes serverless-http)
npm install

# 2. Install Netlify CLI
npm install -g netlify-cli

# 3. Login
netlify login

# 4. Initialize site
netlify init

# 5. Set environment variables (CRITICAL!)
netlify env:set DATABASE_URL "your-mysql-connection-string"
netlify env:set secrettoken "your-secret-key-here"

# 6. Build and deploy
npm run build
netlify deploy --prod
```

### Deploy from Git (Recommended)

1. **Push to GitHub**
   ```bash
   git add -A
   git commit -m "Deploy to Netlify"
   git push origin main
   ```

2. **Connect to Netlify**
   - Go to [app.netlify.com](https://app.netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Choose GitHub → Select your repo
   - Build settings are auto-detected from `netlify.toml`

3. **Set Environment Variables**
   - Site configuration → Environment variables
   - Add `DATABASE_URL` and `secrettoken`
   - Trigger redeploy

4. **Done!** Auto-deploys on every push ✅

---

## ✅ Verify Deployment

1. **Test Function Health**
   ```
   https://your-app.netlify.app/.netlify/functions/api/health
   ```
   Should return: `{"status":"ok","timestamp":"...","environment":"netlify-functions"}`

2. **Visit your site**: `https://your-app.netlify.app`

3. **Test login**: Use demo credentials or create account

4. **Check database**: Verify data is saving

5. **Check Network Tab** (F12 → Network)
   - API calls should go to `/api/*` (same domain)
   - No CORS errors ✅

---

## 🏗️ Architecture (How It Works)

### Monorepo Structure
```
qa-dashboard/
├── src/                    # Frontend (React + Vite)
├── server/                 # Backend routes (Express)
├── netlify/functions/      # Serverless wrapper
│   └── api.ts             # Wraps Express with serverless-http
├── netlify.toml           # Netlify configuration
└── package.json           # Dependencies
```

### Request Flow
```
Browser Request
    ↓
https://your-app.netlify.app/api/auth/login
    ↓
Netlify redirects to /.netlify/functions/api/auth/login
    ↓
Serverless Function (Express backend)
    ↓
MySQL Database (Aiven/AWS/Railway)
    ↓
Response back to browser
```

**Key Benefits:**
- ✅ No CORS issues (same domain)
- ✅ No separate backend server needed
- ✅ Auto-scales with traffic
- ✅ Single deployment for frontend + backend

---

## 🔧 Common Issues

### CORS Errors
**Symptom**: "Access to fetch at '...' from origin '...' has been blocked by CORS policy"

**Cause**: Frontend using hardcoded localhost URLs or function not deployed

**Fix**:
1. Verify all components import from `src/config/api.ts`
2. Check function deployed: `https://your-app.netlify.app/.netlify/functions/api/health`
3. Clear browser cache (Ctrl+Shift+R)

### Function Build Fails
**Symptom**: "TypeError: argument handler must be a function"

**Cause**: TypeScript imports not bundled correctly

**Fix**: Already configured! Check `netlify.toml`:
```toml
[functions]
  node_bundler = "esbuild"
  external_node_modules = ["mysql2"]
```

### Build Fails
```bash
# Clear cache and rebuild
netlify build --clear-cache
npm run build
```

### Database Connection Error
**Symptom**: 500 errors on API calls

**Fix**:
- Check `DATABASE_URL` is set in Netlify env vars
- Ensure SSL mode: `?ssl-mode=REQUIRED`
- Verify database is running (Aiven/AWS console)
- Check function logs in Netlify dashboard

### Environment Variables Not Working
```bash
# List all env vars
netlify env:list

# Re-set if needed
netlify env:set DATABASE_URL "your-connection-string"

# Trigger redeploy after setting
netlify deploy --prod
```

### WebSocket Errors in Logs
**Note**: WebSocket is disabled in serverless (not needed for core functionality)
- This is expected and doesn't affect the app
- Real-time features work via polling in production

---

## 📊 Free Tier Comparison

| Service | Storage | Duration | Best For |
|---------|---------|----------|----------|
| **AWS RDS** | 20GB | 12 months | Production use |
| **Netlify** | Unlimited | Forever | Frontend hosting |
| **Aiven MySQL** | 1GB | Forever | Long-term free |
| **Railway MySQL** | Unlimited* | Forever | Quick testing |

*Within $5/month credit

**Perfect for:**
- **AWS**: Production teams, 12-month projects
- **Aiven**: Long-term free hosting, small teams
- **Railway**: Quick prototypes, testing
- **All**: Demo/POC projects, development environments

---

## 🎉 You're Live!

Your QA Dashboard is now accessible at:
```
https://your-app-name.netlify.app
```

### Next Steps:

1. **Custom Domain** (Optional)
   - Netlify Dashboard → Domain settings
   - Add your domain and update DNS

2. **Set Up Monitoring**
   - Enable Netlify Analytics
   - Set up error tracking (Sentry)

3. **Backup Strategy**
   - Aiven: Automatic backups included
   - Railway: Manual exports recommended

4. **Security**
   - Change default admin password
   - Enable 2FA on Netlify
   - Review CORS settings

---

## 💡 Pro Tips

- **Staging Environment**: Create a separate branch for testing
- **Database Migrations**: Use version control for schema changes
- **Performance**: Enable Netlify's asset optimization
- **Cost Monitoring**: Set up billing alerts on Railway

---

## 📞 Need Help?

- **Full Guide**: See `DEPLOYMENT_GUIDE.md`
- **Database Schema**: Check `database/schema.sql`
- **Netlify Config**: Review `netlify.toml`

---

**Deployment Time**: ~15 minutes ⏱️
**Cost**: $0/month 💰
**Difficulty**: Easy 🟢
