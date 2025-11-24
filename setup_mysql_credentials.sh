#!/bin/bash

# Setup MySQL credentials for automatic snapshots
# This creates a secure .my.cnf file in your home directory

echo "🔐 MySQL Credentials Setup for Automatic Snapshots"
echo "=================================================="
echo ""
echo "This will create a ~/.my.cnf file to store your MySQL credentials securely."
echo "The file will be readable only by you (chmod 600)."
echo ""

# Check if .my.cnf already exists
if [ -f ~/.my.cnf ]; then
    echo "⚠️  ~/.my.cnf already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

# Get MySQL credentials
read -p "MySQL username (default: root): " MYSQL_USER
MYSQL_USER=${MYSQL_USER:-root}

read -sp "MySQL password: " MYSQL_PASSWORD
echo ""

# Create .my.cnf file
cat > ~/.my.cnf << EOF
[client]
user=$MYSQL_USER
password=$MYSQL_PASSWORD

[mysqldump]
user=$MYSQL_USER
password=$MYSQL_PASSWORD
EOF

# Set secure permissions (readable only by owner)
chmod 600 ~/.my.cnf

echo ""
echo "✅ MySQL credentials saved to ~/.my.cnf"
echo "✅ File permissions set to 600 (owner read/write only)"
echo ""
echo "🎉 You can now commit without entering a password!"
echo ""
echo "Test it:"
echo "  mysqldump irongate_qa > test.sql"
echo ""
echo "⚠️  Security Notes:"
echo "  - Never commit ~/.my.cnf to Git"
echo "  - Keep this file secure"
echo "  - Only you can read this file"
echo ""
