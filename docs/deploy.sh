#!/bin/bash

# QA Dashboard - Quick Deployment Script
# This script helps you deploy your QA Dashboard to Netlify with a free MySQL database

set -e

echo "🚀 QA Dashboard Deployment Helper"
echo "=================================="
echo ""

# Check if netlify-cli is installed
if ! command -v netlify &> /dev/null; then
    echo "📦 Installing Netlify CLI..."
    npm install -g netlify-cli
else
    echo "✅ Netlify CLI already installed"
fi

echo ""
echo "📋 Pre-deployment Checklist:"
echo ""
echo "Have you completed these steps?"
echo "1. Created a free MySQL database (Aiven/Railway/Clever Cloud)"
echo "2. Initialized the database schema (database/schema.sql)"
echo "3. Obtained your database connection string"
echo ""
read -p "Press Enter to continue or Ctrl+C to exit..."

echo ""
echo "🔐 Setting up environment variables..."
echo ""

# Prompt for database URL
read -p "Enter your DATABASE_URL (MySQL connection string): " DATABASE_URL

# Generate a random JWT secret
JWT_SECRET=$(openssl rand -base64 32)
echo "Generated JWT_SECRET: $JWT_SECRET"

echo ""
echo "🔧 Configuring Netlify..."
echo ""

# Login to Netlify
netlify login

# Initialize site
echo ""
echo "Initializing Netlify site..."
netlify init

# Set environment variables
echo ""
echo "Setting environment variables..."
netlify env:set DATABASE_URL "$DATABASE_URL"
netlify env:set JWT_SECRET "$JWT_SECRET"

echo ""
echo "✅ Environment variables set!"
echo ""

# Build the project
echo "📦 Building project..."
npm run build

echo ""
echo "🚀 Deploying to Netlify..."
netlify deploy --prod

echo ""
echo "🎉 Deployment Complete!"
echo ""
echo "Your QA Dashboard is now live!"
echo ""
echo "Next steps:"
echo "1. Visit your Netlify dashboard to get your site URL"
echo "2. Test the database connection"
echo "3. Create your first admin user"
echo ""
echo "For detailed documentation, see DEPLOYMENT_GUIDE.md"
