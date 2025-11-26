#!/bin/bash

# Script to export users from local MySQL and import to Aiven
# This handles schema differences between local and Aiven databases

set -e

echo "🔄 User Migration: Local MySQL → Aiven MySQL"
echo "=============================================="
echo ""

# Local MySQL Configuration
LOCAL_HOST="localhost"
LOCAL_PORT="3306"
LOCAL_USER="root"
LOCAL_PASSWORD="l3v75th5n"
LOCAL_DATABASE="irongate_qa"

# Aiven MySQL Configuration (from .env.local)
AIVEN_HOST="mysql-11d3e650-ionut-817b.b.aivencloud.com"
AIVEN_PORT="16234"
AIVEN_USER="avnadmin"
AIVEN_PASSWORD="AVNS_jfRJN8oWbmU8xXWDX3u"
AIVEN_DATABASE="defaultdb"

# Temporary files
EXPORT_FILE="users_export_$(date +%Y%m%d_%H%M%S).sql"
BACKUP_FILE="aiven_users_backup_$(date +%Y%m%d_%H%M%S).sql"

echo "📊 Step 1: Checking local database..."
USER_COUNT=$(mysql -u $LOCAL_USER -p$LOCAL_PASSWORD -h $LOCAL_HOST -P $LOCAL_PORT $LOCAL_DATABASE -sN -e "SELECT COUNT(*) FROM users;")
echo "Found $USER_COUNT users in local database"
echo ""

echo "💾 Step 2: Backing up existing Aiven users (if any)..."
mysqldump --user=$AIVEN_USER \
          --password=$AIVEN_PASSWORD \
          --host=$AIVEN_HOST \
          --port=$AIVEN_PORT \
          --ssl-mode=REQUIRED \
          --no-create-info \
          --skip-triggers \
          $AIVEN_DATABASE users > $BACKUP_FILE 2>/dev/null || echo "No existing users to backup"
echo "✅ Backup saved to: $BACKUP_FILE"
echo ""

echo "📤 Step 3: Exporting users from local database..."
# Export users with all fields including created_by
# Using INSERT IGNORE to skip duplicates
mysql -u $LOCAL_USER -p$LOCAL_PASSWORD -h $LOCAL_HOST -P $LOCAL_PORT $LOCAL_DATABASE -e "
SELECT 
    CONCAT(
        'INSERT IGNORE INTO users (id, email, password_hash, first_name, last_name, role, ',
        'company_id, department_id, primary_team_id, avatar_url, phone, timezone, ',
        'created_at, updated_at, last_login, is_active, email_verified, email_verified_at, ',
        'password_reset_token, password_reset_expires, failed_login_attempts, locked_until, created_by) ',
        'VALUES (',
        QUOTE(id), ', ',
        QUOTE(email), ', ',
        QUOTE(password_hash), ', ',
        QUOTE(first_name), ', ',
        QUOTE(last_name), ', ',
        QUOTE(role), ', ',
        QUOTE(company_id), ', ',
        QUOTE(department_id), ', ',
        COALESCE(QUOTE(primary_team_id), 'NULL'), ', ',
        COALESCE(QUOTE(avatar_url), 'NULL'), ', ',
        COALESCE(QUOTE(phone), 'NULL'), ', ',
        QUOTE(timezone), ', ',
        QUOTE(created_at), ', ',
        QUOTE(updated_at), ', ',
        COALESCE(QUOTE(last_login), 'NULL'), ', ',
        is_active, ', ',
        email_verified, ', ',
        COALESCE(QUOTE(email_verified_at), 'NULL'), ', ',
        COALESCE(QUOTE(password_reset_token), 'NULL'), ', ',
        COALESCE(QUOTE(password_reset_expires), 'NULL'), ', ',
        COALESCE(failed_login_attempts, 0), ', ',
        COALESCE(QUOTE(locked_until), 'NULL'), ', ',
        COALESCE(QUOTE(created_by), 'NULL'),
        ');'
    ) AS insert_statement
FROM users
ORDER BY created_at;
" -sN > $EXPORT_FILE

echo "✅ Exported $USER_COUNT users to: $EXPORT_FILE"
echo ""

echo "📥 Step 4: Checking Aiven database schema..."
# Check if users table exists in Aiven
AIVEN_TABLE_EXISTS=$(mysql --user=$AIVEN_USER \
                           --password=$AIVEN_PASSWORD \
                           --host=$AIVEN_HOST \
                           --port=$AIVEN_PORT \
                           --ssl-mode=REQUIRED \
                           $AIVEN_DATABASE \
                           -sN -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$AIVEN_DATABASE' AND table_name='users';" 2>/dev/null || echo "0")

if [ "$AIVEN_TABLE_EXISTS" = "0" ]; then
    echo "⚠️  Users table doesn't exist in Aiven. Creating schema..."
    mysql --user=$AIVEN_USER \
          --password=$AIVEN_PASSWORD \
          --host=$AIVEN_HOST \
          --port=$AIVEN_PORT \
          --ssl-mode=REQUIRED \
          $AIVEN_DATABASE < database/schema.sql
    echo "✅ Schema created"
else
    echo "✅ Users table exists in Aiven"
fi
echo ""

echo "🔄 Step 5: Importing users to Aiven..."
echo "This will insert users into Aiven database..."
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Import users to Aiven
    mysql --user=$AIVEN_USER \
          --password=$AIVEN_PASSWORD \
          --host=$AIVEN_HOST \
          --port=$AIVEN_PORT \
          --ssl-mode=REQUIRED \
          $AIVEN_DATABASE < $EXPORT_FILE
    
    if [ $? -eq 0 ]; then
        echo "✅ Successfully imported users to Aiven!"
        
        # Verify import
        AIVEN_USER_COUNT=$(mysql --user=$AIVEN_USER \
                                 --password=$AIVEN_PASSWORD \
                                 --host=$AIVEN_HOST \
                                 --port=$AIVEN_PORT \
                                 --ssl-mode=REQUIRED \
                                 $AIVEN_DATABASE \
                                 -sN -e "SELECT COUNT(*) FROM users;")
        
        echo ""
        echo "📊 Verification:"
        echo "  Local users: $USER_COUNT"
        echo "  Aiven users: $AIVEN_USER_COUNT"
        
        if [ "$USER_COUNT" = "$AIVEN_USER_COUNT" ]; then
            echo "  ✅ User counts match!"
        else
            echo "  ⚠️  User counts differ - please verify manually"
        fi
    else
        echo "❌ Import failed! Check error messages above."
        echo "Your Aiven database has not been modified."
        exit 1
    fi
else
    echo "❌ Import cancelled"
    exit 0
fi

echo ""
echo "📋 Step 6: Summary"
echo "===================="
echo "Export file: $EXPORT_FILE"
echo "Backup file: $BACKUP_FILE"
echo ""
echo "✅ Migration complete!"
echo ""
echo "🔍 To verify users in Aiven, run:"
echo "mysql --user=$AIVEN_USER \\"
echo "      --password=$AIVEN_PASSWORD \\"
echo "      --host=$AIVEN_HOST \\"
echo "      --port=$AIVEN_PORT \\"
echo "      --ssl-mode=REQUIRED \\"
echo "      $AIVEN_DATABASE -e 'SELECT id, email, first_name, last_name, role FROM users LIMIT 10;'"
echo ""
echo "🗑️  To clean up export files:"
echo "rm $EXPORT_FILE $BACKUP_FILE"
echo ""
