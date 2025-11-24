#!/bin/bash

# IronGate QA Navigator - Database Setup Script
# This script sets up the MySQL database with schema and seed data

echo "🚀 IronGate QA Navigator - Database Setup"
echo "=========================================="
echo ""

# Database configuration
DB_NAME="irongate_qa"
DB_USER="root"
DB_HOST="localhost"

# Check if MySQL is running
if ! command -v mysql &> /dev/null; then
    echo "❌ MySQL is not installed or not in PATH"
    exit 1
fi

echo "📊 Setting up database: $DB_NAME"
echo ""

# Prompt for MySQL password
read -sp "Enter MySQL root password: " DB_PASSWORD
echo ""
echo ""

# Create database and schema
echo "1️⃣  Creating database schema..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" < schema.sql

if [ $? -eq 0 ]; then
    echo "✅ Schema created successfully"
else
    echo "❌ Failed to create schema"
    exit 1
fi

echo ""

# Seed data
echo "2️⃣  Inserting seed data with metrics..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" < seed_teams_with_metrics.sql

if [ $? -eq 0 ]; then
    echo "✅ Seed data inserted successfully"
else
    echo "❌ Failed to insert seed data"
    exit 1
fi

echo ""

# Seed demo users (optional)
echo "3️⃣  Inserting demo users..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" < seed_demo_users.sql

if [ $? -eq 0 ]; then
    echo "✅ Demo users inserted successfully"
else
    echo "⚠️  Warning: Failed to insert demo users (optional)"
fi

echo ""
echo "=========================================="
echo "✨ Database setup complete!"
echo ""
echo "📋 Summary:"
echo "   - Database: $DB_NAME"
echo "   - Teams: 14 teams across 4 departments"
echo "   - Metrics: Latest KPI snapshots for all teams"
echo ""
echo "🔐 Demo Users (if seed_demo_users.sql was successful):"
echo "   - Admin: admin@mastercard.com / admin123"
echo "   - QA Manager: manager@mastercard.com / manager123"
echo "   - Team Lead: lead@mastercard.com / lead123"
echo ""
echo "🚀 You can now start the backend server:"
echo "   cd server && npm run dev"
echo ""
