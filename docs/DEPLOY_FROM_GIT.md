# 🚀 Deploy QA Dashboard from Git to Netlify

Deploy directly from your Git repository for automatic deployments on every push!

---

## 📋 Prerequisites

- [x] Aiven MySQL database set up
- [x] Database schema initialized
- [ ] GitHub/GitLab/Bitbucket account
- [ ] Code pushed to Git repository

---

## 🎯 Step 1: Push Your Code to Git (5 minutes)

### If you don't have a Git repository yet:

```bash
# Initialize git repository
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: QA Dashboard"

# Create repository on GitHub
# Go to https://github.com/new
# Repository name: qa-dashboard
# Keep it private or public (your choice)
# Don't initialize with README (we already have code)

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/qa-dashboard.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### If you already have a Git repository:

```bash
# Make sure everything is committed
git add .
git commit -m "Prepare for Netlify deployment"
git push
```

---

## 🌐 Step 2: Connect Netlify to Your Git Repository (3 minutes)

### Option A: Via Netlify Dashboard (Recommended)

1. **Go to Netlify**
   - Visit: https://app.netlify.com
   - Login with your account

2. **Add New Site**
   - Click "Add new site" → "Import an existing project"

3. **Connect to Git Provider**
   - Choose: GitHub / GitLab / Bitbucket
   - Authorize Netlify to access your repositories

4. **Select Repository**
   - Find and select: `qa-dashboard` (or your repo name)
   - Click on it

5. **Configure Build Settings**
   ```
   Branch to deploy: main
   Build command: npm run build
   Publish directory: dist
   ```

6. **Click "Deploy site"**
   - Netlify will start building your site
   - Wait 2-3 minutes for first deploy

---

## 🔑 Step 3: Set Environment Variables (CRITICAL!)

Your app won't work without these!

### In Netlify Dashboard:

1. **Go to Site Settings**
   - Click your site name
   - Go to "Site configuration" → "Environment variables"

2. **Add DATABASE_URL**
   - Click "Add a variable" → "Add a single variable"
   - Key: `DATABASE_URL`
   - Value: `mysql://avnadmin:YOUR_AIVEN_PASSWORD@your-mysql-host.aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED`
   - Click "Create variable"

3. **Add JWT_SECRET**
   - Click "Add a variable" → "Add a single variable"
   - Key: `JWT_SECRET`
   - Value: `your-generated-jwt-secret-here`
   - Click "Create variable"

4. **Trigger Redeploy**
   - Go to "Deploys" tab
   - Click "Trigger deploy" → "Deploy site"
   - Wait for rebuild (2-3 minutes)

---

## ✅ Step 4: Verify Deployment

### Check Deploy Status

1. **In Netlify Dashboard**
   - Go to "Deploys" tab
   - Wait for status to change to "Published"
   - Should see green checkmark ✅

2. **Get Your Site URL**
   - Look for: `https://your-site-name.netlify.app`
   - Or click "Open production deploy"

### Test Your Site

1. **Visit your URL**
   - Site should load
   - See login/register page

2. **Test Registration**
   - Register a new account
   - Should work without errors

3. **Test Login**
   - Login with your credentials
   - Should see dashboard

4. **Test Data Persistence**
   - Create a team
   - Refresh page (F5)
   - Team should still be there ✅

---

## 🔄 Step 5: Enable Automatic Deployments

**Already enabled!** Every time you push to your main branch:

```bash
# Make changes to your code
git add .
git commit -m "Update dashboard"
git push

# Netlify automatically:
# 1. Detects the push
# 2. Builds your site
# 3. Deploys new version
# 4. Updates live site
```

---

## 🎨 Optional: Custom Domain

### Add Your Own Domain

1. **In Netlify Dashboard**
   - Go to "Domain management"
   - Click "Add domain"
   - Enter your domain: `yourdomain.com`

2. **Update DNS Records**
   - Add these records at your domain registrar:
   ```
   Type: A
   Name: @
   Value: 75.2.60.5

   Type: CNAME
   Name: www
   Value: your-site-name.netlify.app
   ```

3. **Enable HTTPS**
   - Netlify automatically provisions SSL certificate
   - Wait 24 hours for DNS propagation

---

## 🔧 Troubleshooting

### Build Fails

**Check build logs:**
1. Netlify Dashboard → Deploys → [Failed deploy]
2. Click "Deploy log"
3. Look for errors

**Common issues:**
- Missing dependencies: Run `npm install` locally first
- Build command wrong: Should be `npm run build`
- Publish directory wrong: Should be `dist`

### Environment Variables Not Working

**Verify they're set:**
1. Site configuration → Environment variables
2. Should see: `DATABASE_URL` and `JWT_SECRET`
3. If missing, add them and redeploy

### Database Connection Fails

**Check connection string:**
```bash
# Test locally first
mysql --user=avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host=mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port=16234 \
      --ssl-mode=REQUIRED \
      defaultdb
```

**Verify in Netlify:**
- Check function logs: Deploys → Functions → View logs
- Look for connection errors

---

## 📊 Monitor Your Deployments

### Netlify Dashboard Features

1. **Deploy Previews**
   - Every branch gets a preview URL
   - Test before merging to main

2. **Deploy Notifications**
   - Site settings → Notifications
   - Get email/Slack alerts for deploys

3. **Analytics**
   - Site settings → Analytics
   - View traffic and performance

4. **Function Logs**
   - Deploys → Functions
   - Debug API issues

---

## 🔐 Security Best Practices

### 1. Keep Secrets in Environment Variables

✅ **Do:**
- Store DATABASE_URL in Netlify env vars
- Store JWT_SECRET in Netlify env vars
- Keep `.env.local` in `.gitignore`

❌ **Don't:**
- Commit `.env` files to Git
- Hardcode credentials in code
- Share secrets in public repos

### 2. Use .gitignore

Verify these are in `.gitignore`:
```
.env
.env.local
.env.production
.netlify
node_modules/
dist/
```

### 3. Rotate Secrets Regularly

```bash
# Generate new JWT secret
openssl rand -base64 32

# Update in Netlify dashboard
# Redeploy site
```

---

## 🚀 Deployment Workflow

### Development Flow

```bash
# 1. Make changes locally
npm run dev

# 2. Test changes
# Visit http://localhost:5173

# 3. Commit and push
git add .
git commit -m "Add new feature"
git push

# 4. Netlify auto-deploys
# Check deploy status in dashboard

# 5. Verify on production
# Visit your Netlify URL
```

### Branch Strategy

```bash
# Create feature branch
git checkout -b feature/new-dashboard

# Make changes and push
git push origin feature/new-dashboard

# Netlify creates preview URL
# Test at: https://deploy-preview-X--your-site.netlify.app

# Merge to main when ready
git checkout main
git merge feature/new-dashboard
git push

# Production auto-deploys
```

---

## 📈 Next Steps

### 1. Set Up Monitoring

- **Sentry**: Error tracking
  ```bash
  npm install @sentry/react
  ```

- **Netlify Analytics**: Built-in traffic stats
  - Enable in Site settings

### 2. Optimize Performance

- **Enable Asset Optimization**
  - Site settings → Build & deploy → Post processing
  - Enable: Bundle CSS, Minify JS, Compress images

- **Configure Caching**
  - Already set in `netlify.toml`

### 3. Add Team Members

- **Invite collaborators**
  - Site settings → Team and guests
  - Add team members

### 4. Set Up CI/CD

- **GitHub Actions** (optional)
  - Run tests before deploy
  - Lint code automatically

---

## ✅ Deployment Checklist

- [ ] Code pushed to Git repository
- [ ] Netlify connected to Git repo
- [ ] Build settings configured (npm run build, dist)
- [ ] DATABASE_URL environment variable set
- [ ] JWT_SECRET environment variable set
- [ ] First deploy successful
- [ ] Site URL accessible
- [ ] Can register/login
- [ ] Data persists (database connected)
- [ ] All features working
- [ ] Automatic deployments enabled

---

## 🎉 Success!

Your QA Dashboard is now:
- ✅ Deployed to Netlify
- ✅ Connected to Git
- ✅ Auto-deploys on push
- ✅ Connected to Aiven MySQL
- ✅ Fully functional

**Your Site**: `https://your-site-name.netlify.app`

Every time you push to Git, Netlify will automatically rebuild and deploy your site!

---

## 📚 Resources

- **Netlify Docs**: https://docs.netlify.com
- **Git Docs**: https://git-scm.com/doc
- **Your Aiven Console**: https://console.aiven.io
- **Your Netlify Dashboard**: https://app.netlify.com

---

## 💡 Pro Tips

1. **Use Deploy Previews**: Test changes before merging to main
2. **Enable Branch Deploys**: Deploy multiple branches simultaneously
3. **Set Up Status Badges**: Show deploy status in README
4. **Use Netlify CLI**: Deploy from terminal when needed
5. **Monitor Build Times**: Optimize if builds take too long

---

**Deployment Method**: Git-based (automatic) 🔄
**Build Time**: ~2-3 minutes ⏱️
**Cost**: $0/month 💰
**Maintenance**: Zero - fully automated 🤖
