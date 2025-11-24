# Database Seed Data Setup

This guide explains how to set up the IronGate QA Navigator database with comprehensive seed data including teams and realistic metrics.

## 📊 What's Included

### Teams (14 Total)
The seed data includes 14 teams across 4 departments:

#### Decision Management Department (6 teams)
- **Nebula** - AI/ML decision engine (Backend) - QA Score: 92 ⭐
- **Voyagers** - Real-time decision processing (API) - QA Score: 88 ⭐
- **Sentinels** - Monitoring and alerting (DevOps) - QA Score: 82
- **Pioneers** - Exploration and innovation (Web) - QA Score: 68 ⚠️
- **Horizon** - Data analytics (Backend) - QA Score: 85
- **Atlas** - Infrastructure services (DevOps) - QA Score: 90 ⭐

#### Payments Processing Department (3 teams)
- **Nexus** - Core payment processing (Backend) - QA Score: 94 ⭐
- **Ledger** - Transaction settlement (Backend) - QA Score: 86
- **Portal** - Payment gateway (API) - QA Score: 87

#### Security & Compliance Department (2 teams)
- **Guardians** - Fraud detection (Backend) - QA Score: 93 ⭐
- **Vanguard** - Regulatory compliance (Security) - QA Score: 83

#### Digital Products Department (3 teams)
- **Catalyst iOS** - iOS mobile app (Mobile) - QA Score: 73 ⚠️
- **Catalyst Android** - Android mobile app (Mobile) - QA Score: 71 ⚠️
- **Zenith** - Customer web portal (Web) - QA Score: 80

### Metrics for Each Team
Each team includes comprehensive KPI data:
- ✅ Test Coverage
- 🐛 Defect Density
- 🤖 Automation Coverage
- 🚀 Deployment Frequency
- ⏱️ Lead Time
- 🔧 MTTR (Mean Time To Repair)
- 📈 Sprint Velocity
- 🎯 Code Quality Score
- 📊 System Availability
- And 15+ more metrics!

## 🚀 Quick Setup

### Option 1: Automated Setup (Recommended)
```bash
# Run the setup script
./setup_database.sh
```

The script will:
1. Create the database schema
2. Insert all teams with metrics
3. Optionally insert demo users

### Option 2: Manual Setup
```bash
# 1. Create schema
mysql -u root -p < schema.sql

# 2. Insert seed data with metrics
mysql -u root -p < seed_teams_with_metrics.sql

# 3. (Optional) Insert demo users
mysql -u root -p < seed_demo_users.sql
```

## 📋 Verification

After running the seed script, verify the data:

```sql
USE irongate_qa;

-- Check teams count
SELECT COUNT(*) as team_count FROM teams;
-- Expected: 14

-- Check KPI snapshots
SELECT COUNT(*) as metrics_count FROM kpi_snapshots;
-- Expected: 14

-- View all teams with scores
SELECT 
    t.name as team_name,
    t.platform,
    d.name as department,
    k.qa_score,
    k.status,
    k.test_coverage,
    k.automation_coverage
FROM teams t
JOIN departments d ON t.department_id = d.id
LEFT JOIN kpi_snapshots k ON t.id = k.team_id
ORDER BY k.qa_score DESC;
```

## 🔄 Re-seeding Data

If you need to reset the data:

```bash
# The seed_teams_with_metrics.sql file automatically clears existing data
mysql -u root -p < seed_teams_with_metrics.sql
```

**Note:** This will delete all existing teams and metrics data!

## 🎯 Team Performance Distribution

- **High Performers (85+)**: 6 teams (Nebula, Voyagers, Atlas, Nexus, Guardians, Ledger)
- **Good (75-84)**: 5 teams (Sentinels, Horizon, Portal, Vanguard, Zenith)
- **Needs Attention (<75)**: 3 teams (Pioneers, Catalyst iOS, Catalyst Android)

## 🔐 Demo Users

If you ran `seed_demo_users.sql`, you can log in with:

| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| Super Admin | admin@mastercard.com | admin123 | All teams, all features |
| QA Manager | manager@mastercard.com | manager123 | Department teams |
| Team Lead | lead@mastercard.com | lead123 | Single team |

## 🌐 API Integration

The teams are automatically fetched from the database via the `/api/teams` endpoint, which includes:

- Team basic info (name, department, platform)
- Latest KPI metrics
- QA Score and status
- Technical debt score
- Task sizing accuracy
- All performance metrics

## 📊 Metrics Included

Each team snapshot includes:
- **Quality**: Test coverage, flakiness rate, defect density, code quality
- **Speed**: Build time, test execution time, deployment frequency, lead time
- **Reliability**: MTTR, MTBF, system availability, infrastructure failures
- **Agile**: Sprint velocity, commitment rate, carryover, first-time pass rate
- **Automation**: Coverage, ROI, parallel test efficiency

## 🎨 Dashboard Display

Teams are displayed in the dashboard with:
- Animated row layout
- Inline metrics (Test Coverage, Defect Density, Automation, Quality Score)
- Color-coded QA scores
- Hover animations and effects
- Real-time data from database

## 🔧 Troubleshooting

### MySQL Connection Issues
```bash
# Check if MySQL is running
sudo systemctl status mysql  # Linux
brew services list | grep mysql  # macOS

# Test connection
mysql -u root -p -e "SELECT 1;"
```

### Permission Issues
```bash
# Grant permissions
mysql -u root -p
GRANT ALL PRIVILEGES ON irongate_qa.* TO 'your_user'@'localhost';
FLUSH PRIVILEGES;
```

### Schema Already Exists
```bash
# Drop and recreate
mysql -u root -p -e "DROP DATABASE IF EXISTS irongate_qa;"
mysql -u root -p < schema.sql
```

## 📝 Next Steps

After seeding the database:

1. **Start the backend server:**
   ```bash
   cd server
   npm run dev
   ```

2. **Start the frontend:**
   ```bash
   npm run dev
   ```

3. **Log in** with a demo user or create your own

4. **View the dashboard** - Teams will load dynamically from the database!

## 🎯 Customization

To add more teams or modify metrics:

1. Edit `seed_teams_with_metrics.sql`
2. Add new team entries in the `INSERT INTO teams` section
3. Add corresponding KPI snapshots
4. Re-run the seed script

## 📚 Related Files

- `schema.sql` - Database schema definition
- `seed_teams_with_metrics.sql` - Teams and metrics seed data
- `seed_demo_users.sql` - Demo user accounts
- `setup_database.sh` - Automated setup script
- `server/routes/teams.ts` - API endpoint for fetching teams

---

**Happy Testing! 🚀**
