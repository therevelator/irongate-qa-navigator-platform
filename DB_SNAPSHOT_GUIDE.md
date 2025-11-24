# 📸 Automatic Database Snapshots

This project automatically creates database snapshots before each Git commit.

## 🔧 How It Works

A Git pre-commit hook (`.git/hooks/pre-commit`) runs before every commit and:
1. Creates a timestamped database dump
2. Updates the `latest_snapshot.sql` file
3. Adds the latest snapshot to your commit
4. Keeps only the last 5 timestamped snapshots locally

## 📁 Snapshot Location

```
db_snapshots/
├── snapshot_20251125_013600.sql  (timestamped - not in git)
├── snapshot_20251125_013700.sql  (timestamped - not in git)
├── snapshot_20251125_013800.sql  (timestamped - not in git)
└── latest_snapshot.sql            (tracked in git)
```

## 🚀 Usage

### Automatic (Recommended)
Just commit as usual:
```bash
git add .
git commit -m "your message"
```

The hook will:
- Prompt for MySQL password (once per session)
- Create the snapshot automatically
- Include it in your commit

### Manual Snapshot
To create a snapshot without committing:
```bash
mysqldump -u root -p irongate_qa > db_snapshots/manual_snapshot.sql
```

## 🔐 Password Management

The hook will ask for your MySQL password once per terminal session. The password is stored in the `MYSQL_PASSWORD` environment variable for that session only.

### Skip Password Prompt
Set the password in your shell session:
```bash
export MYSQL_PASSWORD="your_password"
git commit -m "your message"
```

**⚠️ Security Note:** Never commit your password to Git!

## 📊 What Gets Committed

- ✅ `db_snapshots/latest_snapshot.sql` - Always committed
- ❌ `db_snapshots/snapshot_*.sql` - Never committed (local only)

This means:
- Your team always has access to the latest database state
- You keep a local history of the last 5 snapshots
- Git repo size stays manageable

## 🔄 Restoring from Snapshot

### Restore Latest Snapshot
```bash
mysql -u root -p irongate_qa < db_snapshots/latest_snapshot.sql
```

### Restore Specific Snapshot
```bash
mysql -u root -p irongate_qa < db_snapshots/snapshot_20251125_013600.sql
```

## 🛠️ Configuration

Edit `.git/hooks/pre-commit` to change:

```bash
DB_NAME="irongate_qa"      # Database name
DB_USER="root"             # MySQL user
SNAPSHOT_DIR="db_snapshots" # Snapshot directory
```

## ⚙️ Disable Snapshots

To temporarily disable snapshots:
```bash
# Rename the hook
mv .git/hooks/pre-commit .git/hooks/pre-commit.disabled

# Or use --no-verify flag
git commit --no-verify -m "your message"
```

To re-enable:
```bash
mv .git/hooks/pre-commit.disabled .git/hooks/pre-commit
```

## 📝 What's Included in Snapshots

The snapshot includes:
- ✅ All tables and data
- ✅ Table structures
- ✅ Indexes and constraints
- ✅ Triggers and stored procedures
- ❌ Users and permissions (for security)

## 🎯 Best Practices

1. **Commit Often**: Each commit captures the database state
2. **Meaningful Messages**: Include DB changes in commit messages
3. **Review Before Push**: Check `latest_snapshot.sql` in your diff
4. **Team Sync**: Pull latest before making DB changes

## 🔍 Viewing Snapshot Changes

See what changed in the database:
```bash
git diff db_snapshots/latest_snapshot.sql
```

## 📦 Snapshot Size

- Average snapshot: ~50-500 KB (depends on data)
- Git stores compressed diffs (very efficient)
- Only `latest_snapshot.sql` is tracked

## 🚨 Troubleshooting

### Hook Not Running
```bash
# Make sure it's executable
chmod +x .git/hooks/pre-commit
```

### Password Issues
```bash
# Test MySQL connection
mysql -u root -p -e "SELECT 1;"
```

### Snapshot Failed
The commit will still proceed if the snapshot fails. Check:
- MySQL is running
- Database exists
- User has permissions

## 🎉 Benefits

- 📸 **Automatic Backups**: Never forget to backup
- 🔄 **Version Control**: Track DB changes alongside code
- 👥 **Team Sync**: Everyone has the latest DB state
- ⏮️ **Easy Rollback**: Restore any previous state
- 🔍 **Change Tracking**: See exactly what changed

---

**Happy Coding! 🚀**
