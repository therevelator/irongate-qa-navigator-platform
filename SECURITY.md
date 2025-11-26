# 🔒 Security Guidelines

## ⚠️ NEVER Commit Secrets to Git

### What NOT to Commit:
- ❌ Database passwords
- ❌ JWT secrets
- ❌ API keys
- ❌ Connection strings with credentials
- ❌ `.env` files with real values

### What IS Safe to Commit:
- ✅ `.env.example` with placeholder values
- ✅ Documentation with `YOUR_PASSWORD_HERE` placeholders
- ✅ Configuration files without secrets

---

## 🔑 Managing Secrets

### For Local Development

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Fill in your actual secrets:**
   ```bash
   # .env (NEVER commit this!)
   DATABASE_URL=mysql://user:REAL_PASSWORD@host:port/db
   secrettoken=your-actual-secret-key
   ```

3. **Verify .gitignore:**
   ```bash
   # .gitignore should contain:
   .env
   .env.local
   .env.*.local
   ```

### For Production (Netlify)

1. **Set via Netlify Dashboard:**
   - Go to: Site configuration → Environment variables
   - Add each secret individually
   - Never paste them in documentation

2. **Or use Netlify CLI:**
   ```bash
   netlify env:set DATABASE_URL "your-secret-value"
   netlify env:set secrettoken "your-secret-value"
   ```

---

## 🛡️ Generating Secure Secrets

### JWT Secret
```bash
# Generate a random 32-byte base64 string
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Database Password
```bash
# Generate a random 20-character password
node -e "console.log(require('crypto').randomBytes(20).toString('hex'))"
```

---

## 📝 Documentation Best Practices

### ✅ Good Examples:
```markdown
DATABASE_URL=mysql://user:YOUR_PASSWORD@host:port/db
secrettoken=your-generated-jwt-secret-here
```

### ❌ Bad Examples:
```markdown
DATABASE_URL=mysql://admin:P@ssw0rd123@prod.db.com:3306/app
secret key for auth in the db=6hVmrBsWmrOmL6BtYex+hK7RlGda7JguXXhMD1VZzUs=
```

---

## 🚨 If You Accidentally Commit Secrets

### Immediate Actions:

1. **Rotate the compromised secrets:**
   - Change database password immediately
   - Generate new JWT secret
   - Update all services using the old secrets

2. **Remove from Git history:**
   ```bash
   # Use git-filter-repo (recommended)
   git filter-repo --path-glob '*.env' --invert-paths
   
   # Or use BFG Repo-Cleaner
   bfg --delete-files .env
   ```

3. **Force push (if safe):**
   ```bash
   git push --force-with-lease
   ```

4. **Notify team:**
   - Alert all team members
   - Update deployment secrets
   - Review access logs

---

## 🔍 Netlify Secrets Scanning

Netlify automatically scans for secrets in:
- Build output
- Repository files
- Environment variables in code

### Configuration

Our `netlify.toml` excludes documentation:
```toml
[build.processing.secrets]
  omit_paths = [
    "docs/**/*.md",
    "*.md",
    "**/*.sh"
  ]
```

### If Build Fails Due to Secrets:

1. **Check the error message** - it shows which files contain secrets
2. **Replace with placeholders** - use `YOUR_PASSWORD_HERE` format
3. **Update .env.example** - ensure it only has examples
4. **Commit and push** - secrets removed

---

## 🎯 Checklist Before Committing

- [ ] No real passwords in any files
- [ ] `.env` is in `.gitignore`
- [ ] `.env.example` only has placeholders
- [ ] Documentation uses `YOUR_*` placeholders
- [ ] Secrets are set in Netlify dashboard
- [ ] secrettoken is randomly generated
- [ ] Database credentials are secure

---

## 📚 Additional Resources

- [Netlify Secrets Scanning Docs](https://docs.netlify.com/security/secrets-scanning/)
- [Git Secrets Tool](https://github.com/awslabs/git-secrets)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

---

## 🆘 Need Help?

If you're unsure about a secret:
1. **Don't commit it** - when in doubt, leave it out
2. **Use environment variables** - always
3. **Ask the team** - better safe than sorry

**Remember**: Once a secret is in Git history, assume it's compromised!
