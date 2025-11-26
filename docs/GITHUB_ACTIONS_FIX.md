# GitHub Actions MySQL Fix

## ❌ Problem

GitHub Actions was failing with:
```
ERROR 1071 (42000) at line 199: Specified key was too long; max key length is 3072 bytes
```

Also showing warning:
```
Warning: Using a password on the command line interface can be insecure.
```

## ✅ Solution

### 1. Fixed Index Key Length

**Issue**: The `flaky_tests` table had a UNIQUE KEY that was too long:
- `test_name VARCHAR(500)` = 2000 bytes (500 × 4 bytes for utf8mb4)
- `test_suite VARCHAR(255)` = 1020 bytes (255 × 4 bytes)
- `team_id CHAR(36)` = 144 bytes
- **Total**: 3164 bytes > 3072 bytes limit ❌

**Fix**: Reduced column sizes and used prefix index:
```sql
-- Before
test_name VARCHAR(500) NOT NULL,
test_suite VARCHAR(255),
UNIQUE KEY unique_team_test (team_id, test_name, test_suite),

-- After
test_name VARCHAR(255) NOT NULL,
test_suite VARCHAR(191),
UNIQUE KEY unique_team_test (team_id, test_name(191), test_suite),
```

**New total**: 
- `team_id`: 144 bytes
- `test_name(191)`: 764 bytes (191 × 4)
- `test_suite`: 764 bytes (191 × 4)
- **Total**: 1672 bytes < 3072 bytes ✅

### 2. Fixed Password Warning

**Before**:
```bash
mysql -h 127.0.0.1 -u root -ptestpassword irongate_qa < schema.sql
```

**After**:
```bash
# Use MYSQL_PWD environment variable instead
env:
  MYSQL_PWD: testpassword
run: |
  mysql -h 127.0.0.1 -u root irongate_qa < schema.sql
```

## 📝 Files Changed

1. **schema.sql** (line 199-217)
   - Reduced `test_name` from VARCHAR(500) to VARCHAR(255)
   - Reduced `test_suite` from VARCHAR(255) to VARCHAR(191)
   - Added prefix index to `test_name(191)` in UNIQUE KEY

2. **.github/workflows/test.yml** (line 43-49)
   - Changed to use `MYSQL_PWD` environment variable
   - Removed `-p` flag from mysql commands

## 🧪 Testing

### Test Locally
```bash
# Drop and recreate database
mysql -u root -p -e "DROP DATABASE IF EXISTS irongate_qa; CREATE DATABASE irongate_qa;"

# Run schema
mysql -u root -p irongate_qa < schema.sql

# Should complete without errors
```

### Test in CI
```bash
# Commit and push
git add schema.sql .github/workflows/test.yml
git commit -m "Fix MySQL index key length and password warning"
git push
```

Check GitHub Actions tab - should now pass! ✅

## 📊 MySQL Index Limits

### Key Length Limits (utf8mb4):
- **InnoDB**: 3072 bytes max
- **MyISAM**: 1000 bytes max

### Calculation:
- `CHAR(N)` or `VARCHAR(N)` in utf8mb4 = N × 4 bytes
- Safe VARCHAR size for single column index: **768** (768 × 4 = 3072)
- Safe VARCHAR size for multi-column index: **191** per column

### Best Practices:
1. Keep VARCHAR columns in indexes ≤ 191 characters
2. Use prefix indexes for longer text: `INDEX (column(191))`
3. Use TEXT for very long strings (not indexable)
4. Consider hash columns for exact matches on long strings

## 🔍 Why VARCHAR(191)?

191 is the magic number because:
- 191 × 4 bytes (utf8mb4) = **764 bytes**
- Allows room for multiple columns in composite index
- Standard practice in MySQL/MariaDB with utf8mb4

## ✅ Verification

After fix, the index calculation:
```
team_id (36 chars × 4) = 144 bytes
test_name (191 chars × 4) = 764 bytes  
test_suite (191 chars × 4) = 764 bytes
────────────────────────────────────
Total = 1672 bytes < 3072 bytes ✅
```

---

**Last Updated**: 2024-11-21  
**Status**: Fixed ✅
