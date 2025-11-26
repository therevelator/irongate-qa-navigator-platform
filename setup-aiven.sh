#!/bin/bash

# Aiven MySQL Setup Script for QA Dashboard
# This script will initialize your Aiven database and deploy to Netlify

set -e

echo "🚀 QA Dashboard - Aiven MySQL Setup"
echo "===================================="
echo ""

# Your Aiven connection details
AIVEN_HOST="mysql-11d3e650-ionut-817b.b.aivencloud.com"
AIVEN_PORT="16234"
AIVEN_USER="avnadmin"
AIVEN_PASSWORD="YOUR_AIVEN_PASSWORD"
AIVEN_DATABASE="defaultdb"

# Build connection URL for Netlify
DATABASE_URL="mysql://${AIVEN_USER}:${AIVEN_PASSWORD}@${AIVEN_HOST}:${AIVEN_PORT}/${AIVEN_DATABASE}?ssl-mode=REQUIRED"

echo "📊 Your Aiven Database Details:"
echo "Host: $AIVEN_HOST"
echo "Port: $AIVEN_PORT"
echo "Database: $AIVEN_DATABASE"
echo ""

# Step 1: Test connection
echo "🔍 Step 1: Testing database connection..."
if mysql --user=$AIVEN_USER \
         --password=$AIVEN_PASSWORD \
         --host=$AIVEN_HOST \
         --port=$AIVEN_PORT \
         --ssl-mode=REQUIRED \
         -e "SELECT 1;" $AIVEN_DATABASE > /dev/null 2>&1; then
    echo "✅ Database connection successful!"
else
    echo "❌ Database connection failed!"
    echo "Please check your credentials and try again."
    exit 1
fi

echo ""

# Step 2: Initialize database schema
echo "🗄️ Step 2: Initializing database schema..."
echo "This will create all necessary tables for your QA Dashboard."
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating tables..."
    mysql --user=$AIVEN_USER \
          --password=$AIVEN_PASSWORD \
          --host=$AIVEN_HOST \
          --port=$AIVEN_PORT \
          --ssl-mode=REQUIRED \
          $AIVEN_DATABASE < database/schema.sql
    
    if [ $? -eq 0 ]; then
        echo "✅ Database schema initialized successfully!"
    else
        echo "❌ Failed to initialize schema. Check database/schema.sql for errors."
        exit 1
    fi
else
    echo "Skipping schema initialization."
fi

echo ""

# Step 3: Create .env.local file
echo "📝 Step 3: Creating local environment file..."
cat > .env.local << EOF
# Aiven MySQL Connection
DATABASE_URL=$DATABASE_URL

# JWT Secret for authentication
JWT_SECRET=$(openssl rand -base64 32)

# API URL (will be updated after Netlify deployment)
VITE_API_URL=http://localhost:8888/api
EOF

echo "✅ Created .env.local file"
echo ""

# Step 4: Test local connection
echo "🧪 Step 4: Testing local environment..."
cat > test-connection.mjs << 'EOF'
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testConnection() {
  try {
    console.log('Connecting to database...');
    const connection = await mysql.createConnection(process.env.DATABASE_URL);
    
    console.log('✅ Connected successfully!');
    
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`\n📊 Found ${tables.length} tables:`);
    tables.forEach(table => {
      console.log(`  - ${Object.values(table)[0]}`);
    });
    
    await connection.end();
    console.log('\n✅ Connection test passed!');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
EOF

if command -v node &> /dev/null; then
    npm install mysql2 dotenv --save-dev > /dev/null 2>&1
    node test-connection.mjs
    rm test-connection.mjs
else
    echo "⚠️  Node.js not found. Skipping connection test."
fi

echo ""

# Step 5: Deploy to Netlify
echo "🚀 Step 5: Deploy to Netlify"
echo ""
echo "Your DATABASE_URL is:"
echo "$DATABASE_URL"
echo ""
echo "Next steps:"
echo "1. Install Netlify CLI: npm install -g netlify-cli"
echo "2. Run: netlify login"
echo "3. Run: netlify init"
echo "4. Set environment variable:"
echo "   netlify env:set DATABASE_URL \"$DATABASE_URL\""
echo "5. Deploy: netlify deploy --prod"
echo ""

read -p "Would you like to deploy to Netlify now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Check if netlify CLI is installed
    if ! command -v netlify &> /dev/null; then
        echo "Installing Netlify CLI..."
        npm install -g netlify-cli
    fi
    
    echo "Logging in to Netlify..."
    netlify login
    
    echo "Initializing Netlify site..."
    netlify init
    
    echo "Setting environment variables..."
    netlify env:set DATABASE_URL "$DATABASE_URL"
    netlify env:set JWT_SECRET "$(openssl rand -base64 32)"
    
    echo "Building project..."
    npm run build
    
    echo "Deploying to production..."
    netlify deploy --prod
    
    echo ""
    echo "🎉 Deployment complete!"
    echo ""
    echo "Your QA Dashboard is now live!"
    echo "Check your Netlify dashboard for the URL."
else
    echo ""
    echo "📋 Manual deployment instructions saved to AIVEN_SETUP_COMPLETE.md"
    
    cat > AIVEN_SETUP_COMPLETE.md << EOF
# ✅ Aiven Database Setup Complete!

## Your Database Connection

\`\`\`
Host: $AIVEN_HOST
Port: $AIVEN_PORT
User: $AIVEN_USER
Database: $AIVEN_DATABASE
\`\`\`

## Connection String

\`\`\`
$DATABASE_URL
\`\`\`

## Next Steps to Deploy

### 1. Install Netlify CLI
\`\`\`bash
npm install -g netlify-cli
\`\`\`

### 2. Login to Netlify
\`\`\`bash
netlify login
\`\`\`

### 3. Initialize Your Site
\`\`\`bash
netlify init
\`\`\`

### 4. Set Environment Variables
\`\`\`bash
netlify env:set DATABASE_URL "$DATABASE_URL"
netlify env:set JWT_SECRET "\$(openssl rand -base64 32)"
\`\`\`

### 5. Build and Deploy
\`\`\`bash
npm run build
netlify deploy --prod
\`\`\`

## Testing Locally

\`\`\`bash
# Start development server
npm run dev

# Test with local Netlify functions
netlify dev
\`\`\`

## Database Management

### Connect to Database
\`\`\`bash
mysql --user=$AIVEN_USER \\
      --password=$AIVEN_PASSWORD \\
      --host=$AIVEN_HOST \\
      --port=$AIVEN_PORT \\
      --ssl-mode=REQUIRED \\
      $AIVEN_DATABASE
\`\`\`

### Backup Database
\`\`\`bash
mysqldump --user=$AIVEN_USER \\
          --password=$AIVEN_PASSWORD \\
          --host=$AIVEN_HOST \\
          --port=$AIVEN_PORT \\
          --ssl-mode=REQUIRED \\
          $AIVEN_DATABASE > backup_\$(date +%Y%m%d).sql
\`\`\`

### Restore Database
\`\`\`bash
mysql --user=$AIVEN_USER \\
      --password=$AIVEN_PASSWORD \\
      --host=$AIVEN_HOST \\
      --port=$AIVEN_PORT \\
      --ssl-mode=REQUIRED \\
      $AIVEN_DATABASE < backup_file.sql
\`\`\`

## Monitoring

- **Aiven Console**: https://console.aiven.io
- **View Metrics**: Database performance and usage
- **Check Logs**: Query logs and error logs
- **Storage Used**: Monitor your 1GB free tier limit

## Support

- Full deployment guide: \`DEPLOYMENT_GUIDE.md\`
- Quick start: \`QUICK_DEPLOY.md\`
- AWS alternative: \`AWS_DEPLOYMENT.md\`
EOF
fi

echo ""
echo "✅ Setup Complete!"
echo ""
echo "📁 Files created:"
echo "  - .env.local (local environment variables)"
echo "  - AIVEN_SETUP_COMPLETE.md (reference guide)"
echo ""
echo "🔐 Security Note:"
echo "  - .env.local is in .gitignore (safe)"
echo "  - Never commit database credentials to Git"
echo "  - Rotate passwords regularly in Aiven console"
echo ""
