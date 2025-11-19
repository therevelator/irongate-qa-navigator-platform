# 🚀 Database Setup Guide

## Quick Start

### Step 1: Install PostgreSQL

```bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu/Debian
sudo apt-get install postgresql-14
sudo systemctl start postgresql

# Windows
# Download from: https://www.postgresql.org/download/windows/
```

### Step 2: Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE irongate_qa;

# Create user
CREATE USER irongate_admin WITH PASSWORD 'your_secure_password';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE irongate_qa TO irongate_admin;

# Exit
\q
```

### Step 3: Run Schema

```bash
# Run the schema file
psql -U irongate_admin -d irongate_qa -f docs/technical/DATABASE_SCHEMA.sql

# Or copy-paste from DATABASE_SCHEMA.md
```

### Step 4: Verify Installation

```sql
-- Connect to database
psql -U irongate_admin -d irongate_qa

-- List tables
\dt

-- Check a table
SELECT * FROM users LIMIT 1;
```

---

## Connection Strings

### PostgreSQL

```env
# .env file
DATABASE_URL="postgresql://irongate_admin:your_password@localhost:5432/irongate_qa"
```

### MySQL

```env
DATABASE_URL="mysql://irongate_admin:your_password@localhost:3306/irongate_qa"
```

---

## Using Prisma (Recommended)

### Step 1: Install Prisma

```bash
npm install prisma @prisma/client
npx prisma init
```

### Step 2: Configure Prisma Schema

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                      String    @id @default(uuid())
  email                   String    @unique
  passwordHash            String    @map("password_hash")
  firstName               String    @map("first_name")
  lastName                String    @map("last_name")
  role                    String
  avatarUrl               String?   @map("avatar_url")
  isActive                Boolean   @default(true) @map("is_active")
  emailVerified           Boolean   @default(false) @map("email_verified")
  emailVerificationToken  String?   @map("email_verification_token")
  passwordResetToken      String?   @map("password_reset_token")
  passwordResetExpires    DateTime? @map("password_reset_expires")
  lastLogin               DateTime? @map("last_login")
  createdAt               DateTime  @default(now()) @map("created_at")
  updatedAt               DateTime  @updatedAt @map("updated_at")
  deletedAt               DateTime? @map("deleted_at")

  sessions      Session[]
  userTeams     UserTeam[]
  auditLogs     AuditLog[]
  notifications Notification[]

  @@map("users")
}

// ... add other models
```

### Step 3: Generate Client

```bash
npx prisma generate
npx prisma db push
```

### Step 4: Use in Code

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Create user
const user = await prisma.user.create({
  data: {
    email: 'admin@irongate.com',
    passwordHash: hashedPassword,
    firstName: 'Admin',
    lastName: 'User',
    role: 'super_admin',
  },
});

// Query users
const users = await prisma.user.findMany({
  where: { isActive: true },
  include: { userTeams: true },
});
```

---

## Seed Data

### Create Admin User

```sql
-- Insert admin user (password: demo123 - hashed with bcrypt)
INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, email_verified)
VALUES (
  'admin@irongate.com',
  '$2b$10$rKvVJH3xKqZ9yN5xQxGxXeYGxQxGxXeYGxQxGxXeYGxQxGxXeYGxQx', -- demo123
  'Admin',
  'User',
  'super_admin',
  true,
  true
);
```

### Create Sample Teams

```sql
-- Insert sample teams
INSERT INTO teams (name, department, description, status)
VALUES 
  ('Checkout Service', 'E-Commerce', 'Handles checkout and payment processing', 'active'),
  ('User Auth', 'Platform', 'Authentication and authorization services', 'active'),
  ('Inventory Core', 'Logistics', 'Inventory management system', 'active'),
  ('Payment Gateway', 'FinTech', 'Payment processing and integrations', 'active'),
  ('Mobile App', 'Frontend', 'iOS and Android applications', 'active');
```

### Assign Users to Teams

```sql
-- Assign admin to all teams
INSERT INTO user_teams (user_id, team_id, role)
SELECT 
  (SELECT id FROM users WHERE email = 'admin@irongate.com'),
  id,
  'owner'
FROM teams;
```

---

## Backup & Restore

### Backup

```bash
# Full backup
pg_dump -U irongate_admin irongate_qa > backup_$(date +%Y%m%d).sql

# Schema only
pg_dump -U irongate_admin --schema-only irongate_qa > schema_backup.sql

# Data only
pg_dump -U irongate_admin --data-only irongate_qa > data_backup.sql
```

### Restore

```bash
# Restore from backup
psql -U irongate_admin -d irongate_qa < backup_20251119.sql
```

---

## Performance Tuning

### Analyze Tables

```sql
-- Analyze all tables
ANALYZE;

-- Analyze specific table
ANALYZE users;
```

### Vacuum

```sql
-- Vacuum all tables
VACUUM;

-- Vacuum specific table
VACUUM ANALYZE users;
```

### Check Index Usage

```sql
-- Find unused indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY schemaname, tablename;
```

---

## Monitoring

### Active Connections

```sql
SELECT 
    datname,
    count(*) as connections
FROM pg_stat_activity
GROUP BY datname;
```

### Slow Queries

```sql
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    max_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### Table Sizes

```sql
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Troubleshooting

### Can't connect to database

```bash
# Check if PostgreSQL is running
pg_isready

# Check connection
psql -U irongate_admin -d irongate_qa -h localhost
```

### Permission denied

```sql
-- Grant all privileges
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO irongate_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO irongate_admin;
```

### Reset password

```sql
ALTER USER irongate_admin WITH PASSWORD 'new_password';
```

---

## Migration Strategy

### Using Prisma Migrate

```bash
# Create migration
npx prisma migrate dev --name init

# Apply migration
npx prisma migrate deploy

# Reset database
npx prisma migrate reset
```

### Manual Migrations

```sql
-- Create migrations table
CREATE TABLE schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Track migration
INSERT INTO schema_migrations (version) VALUES ('001_initial_schema');
```

---

## Security Best Practices

### 1. Use Strong Passwords

```sql
-- Generate secure password
SELECT encode(gen_random_bytes(32), 'base64');
```

### 2. Limit Permissions

```sql
-- Create read-only user
CREATE USER irongate_readonly WITH PASSWORD 'readonly_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO irongate_readonly;
```

### 3. Enable SSL

```bash
# In postgresql.conf
ssl = on
ssl_cert_file = '/path/to/server.crt'
ssl_key_file = '/path/to/server.key'
```

### 4. Regular Backups

```bash
# Automated daily backups
0 2 * * * pg_dump -U irongate_admin irongate_qa > /backups/daily_$(date +\%Y\%m\%d).sql
```

---

## Production Checklist

- [ ] Database created
- [ ] Schema applied
- [ ] Indexes created
- [ ] Admin user created
- [ ] Sample data loaded
- [ ] Backups configured
- [ ] Monitoring set up
- [ ] SSL enabled
- [ ] Firewall configured
- [ ] Connection pooling enabled

---

**Database is now ready for IronGate QA Navigator!** 🎉
