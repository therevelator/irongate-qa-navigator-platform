# 🚀 Quick Start: Database Seed Data

## One-Command Setup

```bash
./setup_database.sh
```

That's it! This will:
1. ✅ Create the database schema
2. ✅ Insert 14 teams with metrics
3. ✅ Add demo users (optional)

## What You Get

### 📊 14 Teams Across 4 Departments
- **Decision Management**: 6 teams
- **Payments Processing**: 3 teams  
- **Security & Compliance**: 2 teams
- **Digital Products**: 3 teams

### 📈 Real Metrics for Each Team
- Test Coverage (78% - 97%)
- Defect Density (0.15 - 0.45)
- Automation Coverage (76% - 96%)
- QA Scores (71 - 94)
- 20+ more metrics per team!

## Verify Setup

```bash
mysql -u root -p < verify_seed.sql
```

## Start the Application

### Terminal 1: Backend
```bash
cd server
npm run dev
```

### Terminal 2: Frontend
```bash
npm run dev
```

## View the Dashboard

Open `http://localhost:5173` and see:
- ✨ Animated team rows
- 📊 Real metrics from database
- 🎯 Color-coded QA scores
- 🚀 Inline performance indicators

## Demo Login

If you seeded demo users:
```
Email: admin@mastercard.com
Password: admin123
```

## Need Help?

See `DATABASE_SEED_README.md` for detailed documentation.

---

**That's it! Your dashboard is now powered by real database data! 🎉**
