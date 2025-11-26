#!/bin/bash

# Quick Netlify Deployment Script
# This automates the deployment process

set -e

echo "🚀 QA Dashboard - Netlify Deployment"
echo "====================================="
echo ""

# Check if netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo "📦 Netlify CLI not found. Installing..."
    echo "This requires sudo permissions..."
    sudo npm install -g netlify-cli
    echo "✅ Netlify CLI installed!"
else
    echo "✅ Netlify CLI already installed"
fi

echo ""

# Your database credentials
DATABASE_URL="mysql://avnadmin:YOUR_AIVEN_PASSWORD@your-mysql-host.aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED"
JWT_SECRET="your-generated-jwt-secret-here"

echo "🔐 Step 1: Login to Netlify"
echo "This will open your browser..."
netlify login

echo ""
echo "✅ Logged in successfully!"
echo ""

# Check if already initialized
if [ ! -f ".netlify/state.json" ]; then
    echo "🏗️ Step 2: Initialize Netlify site"
    echo ""
    netlify init
else
    echo "✅ Site already initialized"
fi

echo ""
echo "🔑 Step 3: Setting environment variables..."

# Set environment variables
netlify env:set DATABASE_URL "$DATABASE_URL" --force
netlify env:set JWT_SECRET "$JWT_SECRET" --force

echo "✅ Environment variables set!"
echo ""

# Verify environment variables
echo "📋 Verifying environment variables..."
netlify env:list

echo ""
echo "📦 Step 4: Building project..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed. Please check errors above."
    exit 1
fi

echo ""
echo "🌐 Step 5: Deploying to production..."
netlify deploy --prod

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Deployment Complete!"
    echo ""
    echo "Your QA Dashboard is now live!"
    echo ""
    
    # Get site info
    SITE_URL=$(netlify status --json | grep -o '"url":"[^"]*"' | cut -d'"' -f4 | head -1)
    
    echo "📊 Site Information:"
    netlify status
    
    echo ""
    echo "🔗 Quick Links:"
    echo "  - Your Site: $SITE_URL"
    echo "  - Admin Dashboard: https://app.netlify.com"
    echo "  - Database Console: https://console.aiven.io"
    echo ""
    
    echo "✅ Next Steps:"
    echo "1. Visit your site: $SITE_URL"
    echo "2. Register a new account"
    echo "3. Test login functionality"
    echo "4. Create a team and add test cases"
    echo "5. Verify data persists after refresh"
    echo ""
    
    read -p "Would you like to open your site now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        netlify open:site
    fi
    
else
    echo "❌ Deployment failed. Check errors above."
    exit 1
fi

echo ""
echo "📚 For detailed documentation, see:"
echo "  - NETLIFY_DEPLOYMENT_STEPS.md"
echo "  - AIVEN_QUICK_START.md"
echo "  - DEPLOYMENT_GUIDE.md"
echo ""
