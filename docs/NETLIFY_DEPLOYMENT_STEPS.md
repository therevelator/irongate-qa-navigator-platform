# 🚀 Netlify Deployment - Complete Checklist

Follow these steps to get your QA Dashboard fully functional on Netlify.

---

## ✅ Prerequisites (Already Done!)

- [x] Aiven MySQL database created
- [x] Database schema initialized (13 tables)
- [x] `.env.local` file created
- [x] Connection tested successfully

---

## 📦 Step 1: Install Netlify CLI (2 minutes)

```bash
# Install Netlify CLI globally
npm install -g netlify-cli

# Verify installation
netlify --version
```

---

## 🔐 Step 2: Login to Netlify (1 minute)

```bash
# This will open your browser to login
netlify login

# Follow the browser prompts to authorize
```

---

## 🏗️ Step 3: Initialize Your Site (3 minutes)

```bash
# Initialize Netlify in your project
netlify init

# You'll be asked:
# 1. "What would you like to do?"
#    → Choose: "Create & configure a new site"
#
# 2. "Team:"
#    → Choose your team (or Personal)
#
# 3. "Site name (leave blank for random name):"
#    → Enter: qa-dashboard (or your preferred name)
#
# 4. "Your build command:"
#    → Enter: npm run build
#
# 5. "Directory to deploy:"
#    → Enter: dist
```

---

## 🔑 Step 4: Set Environment Variables (2 minutes)

**CRITICAL: Your app won't work without these!**

```bash
# Set your Aiven database URL
netlify env:set DATABASE_URL "mysql://avnadmin:YOUR_AIVEN_PASSWORD@your-mysql-host.aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED"

# Set JWT secret for authentication
netlify env:set JWT_SECRET "your-generated-jwt-secret-here"

# Verify they were set
netlify env:list
```

---

## 🏗️ Step 5: Build Your Project (2 minutes)

```bash
# Build the production version
npm run build

# This creates the 'dist' folder with your compiled app
```

**Expected output:**
```
✓ built in XXXms
dist/index.html                   X.XX kB
dist/assets/index-XXXXX.js        XXX.XX kB
```

---

## 🌐 Step 6: Deploy to Production (2 minutes)

```bash
# Deploy to production
netlify deploy --prod

# Netlify will:
# 1. Upload your 'dist' folder
# 2. Deploy your site
# 3. Give you a live URL
```

**You'll see:**
```
✔ Deployed to production!

Website URL:       https://qa-dashboard-XXXXX.netlify.app
```

---

## ✅ Step 7: Verify Deployment (5 minutes)

### 7.1 Check Your Site is Live

```bash
# Open your site in browser
netlify open:site

# Or manually visit the URL from the deploy output
```

### 7.2 Test Basic Functionality

1. **Homepage loads** ✅
   - You should see the QA Dashboard login page
   - Dark mode toggle should work

2. **Try to Register** ✅
   ```
   - Click "Register" or "Sign Up"
   - Fill in: Name, Email, Password
   - Click "Create Account"
   ```
   
   **Expected:** Account created successfully

3. **Try to Login** ✅
   ```
   - Enter your email and password
   - Click "Login"
   ```
   
   **Expected:** You're logged in and see the dashboard

4. **Test Data Persistence** ✅
   ```
   - Create a team
   - Refresh the page
   - Team should still be there
   ```
   
   **Expected:** Data persists (proves database is connected)

---

## 🔧 Step 8: Configure API Endpoints (IMPORTANT!)

Your frontend needs to know where to send API requests.

### Option A: Update Environment Variable

```bash
# Get your site URL
netlify status

# Set the API URL (replace with your actual URL)
netlify env:set VITE_API_URL "https://your-site-name.netlify.app/api"

# Redeploy for changes to take effect
npm run build
netlify deploy --prod
```

### Option B: Use Relative URLs (Recommended)

Your app should already be configured to use relative URLs (`/api/*`), which Netlify automatically routes to your functions.

**Check `netlify.toml` has this redirect:**
```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

---

## 🎯 Step 9: Create Your First Admin User

### Option 1: Via Database (Recommended)

```bash
# Connect to your database
mysql --user=avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host=mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port=16234 \
      --ssl-mode=REQUIRED \
      defaultdb

# Create admin user (replace with your details)
INSERT INTO users (email, password_hash, name, role) 
VALUES (
  'admin@yourdomain.com',
  '$2a$10$YourBcryptHashHere',  -- Use bcrypt to hash your password
  'Admin User',
  'admin'
);
```

### Option 2: Via Registration

1. Register a new account on your site
2. Connect to database
3. Update the user's role:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

---

## 🔍 Step 10: Troubleshooting

### Issue: "Site loads but shows blank page"

**Check browser console (F12):**
```bash
# Look for errors like:
# - "Failed to fetch"
# - "Network error"
# - "CORS error"
```

**Solution:**
```bash
# Verify environment variables are set
netlify env:list

# Should show:
# DATABASE_URL
# JWT_SECRET
```

### Issue: "Can't login or register"

**Check Netlify function logs:**
```bash
netlify functions:log

# Or in Netlify dashboard:
# Site → Functions → View logs
```

**Common causes:**
- DATABASE_URL not set correctly
- Database connection timeout
- Missing JWT_SECRET

### Issue: "Data doesn't persist"

**Verify database connection:**
```bash
# Test from your local machine
mysql --user=avnadmin \
      --password=YOUR_AIVEN_PASSWORD \
      --host=mysql-11d3e650-ionut-817b.b.aivencloud.com \
      --port=16234 \
      --ssl-mode=REQUIRED \
      -e "SELECT COUNT(*) FROM users;" defaultdb
```

### Issue: "Functions not working"

**Check netlify.toml exists:**
```bash
cat netlify.toml

# Should contain:
# [build]
#   command = "npm run build"
#   publish = "dist"
#   functions = "netlify/functions"
```

---

## 📊 Step 11: Monitor Your Deployment

### View Deployment Status
```bash
# Check site status
netlify status

# View recent deploys
netlify deploy:list

# View function logs
netlify functions:log
```

### Netlify Dashboard
```
1. Go to https://app.netlify.com
2. Find your site
3. Check:
   - Site overview
   - Functions (should show your API functions)
   - Environment variables
   - Deploy logs
```

---

## 🎨 Step 12: Customize Your Site (Optional)

### Add Custom Domain
```bash
# In Netlify dashboard:
# Site settings → Domain management → Add custom domain
```

### Enable Analytics
```bash
# In Netlify dashboard:
# Site settings → Analytics → Enable
```

### Set Up Continuous Deployment
```bash
# Connect to GitHub:
# Site settings → Build & deploy → Link repository

# Now every push to main branch auto-deploys!
```

---

## ✅ Final Checklist

- [ ] Netlify CLI installed
- [ ] Logged in to Netlify
- [ ] Site initialized
- [ ] Environment variables set (DATABASE_URL, JWT_SECRET)
- [ ] Project built successfully
- [ ] Deployed to production
- [ ] Site URL accessible
- [ ] Can register new users
- [ ] Can login
- [ ] Data persists after refresh
- [ ] Dark mode works
- [ ] All dashboard components load
- [ ] Admin user created

---

## 🎉 Success Indicators

Your app is fully functional when:

1. ✅ **Homepage loads** - No errors in console
2. ✅ **Registration works** - Can create new accounts
3. ✅ **Login works** - Can authenticate users
4. ✅ **Dashboard loads** - See all components
5. ✅ **Data persists** - Refresh doesn't lose data
6. ✅ **Teams work** - Can create and view teams
7. ✅ **Test cases work** - Can add test cases
8. ✅ **Metrics display** - Charts and graphs show data
9. ✅ **Dark mode toggles** - Theme switching works
10. ✅ **Navigation works** - Can move between pages

---

## 📚 Quick Commands Reference

```bash
# Deploy
netlify deploy --prod

# Check status
netlify status

# View logs
netlify functions:log

# Open site
netlify open:site

# Open dashboard
netlify open:admin

# List env vars
netlify env:list

# Set env var
netlify env:set KEY "value"

# View recent deploys
netlify deploy:list
```

---

## 🆘 Get Help

### Check Logs
```bash
# Function logs
netlify functions:log

# Build logs
netlify logs

# Or in dashboard: Site → Deploys → [Latest] → Deploy log
```

### Common URLs
- **Your Site**: https://your-site.netlify.app
- **Netlify Dashboard**: https://app.netlify.com
- **Aiven Console**: https://console.aiven.io
- **Functions**: https://your-site.netlify.app/.netlify/functions

### Documentation
- `DEPLOYMENT_GUIDE.md` - Full deployment guide
- `AIVEN_QUICK_START.md` - Database setup
- `AWS_DEPLOYMENT.md` - AWS alternative
- `netlify.toml` - Netlify configuration

---

## 💡 Pro Tips

1. **Use Netlify Dev for local testing:**
   ```bash
   netlify dev
   # This runs your site locally with functions
   ```

2. **Enable deploy previews:**
   - Every branch gets a preview URL
   - Test before merging to production

3. **Set up notifications:**
   - Netlify dashboard → Site settings → Notifications
   - Get alerts for failed deploys

4. **Monitor function usage:**
   - Free tier: 125K function invocations/month
   - Check usage in dashboard

5. **Optimize builds:**
   - Use build plugins
   - Enable asset optimization
   - Configure caching headers

---

**Deployment Time**: ~15 minutes ⏱️
**Cost**: $0/month 💰
**Next Deploy**: Just run `netlify deploy --prod` 🚀
