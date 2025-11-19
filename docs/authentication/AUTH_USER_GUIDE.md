# 👥 Authentication System - User Guide

## Welcome to IronGate QA Navigator

This guide will help you understand how to use the authentication system and what you can do based on your role.

---

## Getting Started

### First Time Login

1. **Open IronGate QA Navigator** in your web browser
2. You'll see the login screen with the IronGate logo
3. Enter your email and password
4. Click "Sign In"

### Demo Accounts (For Testing)

Try different roles with these demo accounts:

| Email | Password | Role | What You Can Do |
|-------|----------|------|-----------------|
| admin@irongate.com | demo123 | Super Admin | Everything - full control |
| manager@irongate.com | demo123 | QA Manager | Manage all teams and QA users |
| lead@irongate.com | demo123 | Team Lead | Manage your teams |
| engineer@irongate.com | demo123 | QA Engineer | Work on your team's tests |
| viewer@irongate.com | demo123 | Viewer | View dashboards only |

---

## Creating Your Account

### Registration Steps

1. Click **"Create Account"** on the login page
2. Fill in your information:
   - First Name
   - Last Name
   - Email Address
   - Password (must be strong)
   - Confirm Password
3. Select your role (if you're the first user, you'll be an admin)
4. Click **"Create Account"**

### Password Requirements

Your password must have:
- ✅ At least 8 characters
- ✅ One uppercase letter (A-Z)
- ✅ One lowercase letter (a-z)
- ✅ One number (0-9)
- ✅ One special character (!@#$%^&*)

**Example strong password**: `IronGate2024!`

---

## Understanding Your Role

### 👑 Super Admin

**You have full control of the system.**

**What you can do**:
- ✅ View all teams and their metrics
- ✅ Create, edit, and delete teams
- ✅ Manage all users (create, edit, delete, change roles)
- ✅ Access all advanced features
- ✅ View business impact analytics
- ✅ Configure API integrations
- ✅ View audit logs
- ✅ Export all data
- ✅ Manage billing and subscriptions

**Best for**: Platform administrators, IT leadership, CTO

**Your dashboard shows**: Everything - all teams, all metrics, all features

---

### 📊 QA Manager

**You oversee quality across the entire organization.**

**What you can do**:
- ✅ View all teams and their metrics
- ✅ Create and manage teams
- ✅ Invite and manage QA team members
- ✅ Access all advanced features
- ✅ View business impact analytics
- ✅ Generate organization-wide reports
- ✅ Export data for all teams
- ❌ Cannot manage Super Admins
- ❌ Cannot configure API integrations
- ❌ Cannot manage billing

**Best for**: QA Directors, Test Managers, Quality Engineering Leads

**Your dashboard shows**: All teams with full details and analytics

---

### 👥 Team Lead

**You manage your assigned team(s) and can see other teams' summaries.**

**What you can do**:
- ✅ Full access to your team's data
- ✅ View other teams' summary metrics (read-only)
- ✅ Access most advanced features
- ✅ Invite team members to your team
- ✅ Edit your team's configuration
- ✅ Generate reports for your team
- ✅ Manage test cases for your team
- ✅ Export your team's data
- ❌ Cannot create new teams
- ❌ Cannot delete teams
- ❌ Cannot access business impact analytics
- ❌ Cannot manage users outside your team

**Best for**: QA Team Leads, Senior QA Engineers with team responsibility

**Your dashboard shows**: Your teams in detail + other teams' summaries

---

### 🧪 QA Engineer

**You work on testing for your assigned team.**

**What you can do**:
- ✅ View your team's dashboard
- ✅ Access testing features:
  - Flaky Test Intelligence
  - Test Case Management
  - Test Execution Timeline
  - Technical Debt Tracker
  - Pipeline Visualization
  - Performance Metrics
- ✅ Update test execution status
- ✅ Comment on issues
- ✅ View team gamification
- ❌ Cannot view other teams
- ❌ Cannot edit team configuration
- ❌ Cannot access business analytics
- ❌ Cannot manage users
- ❌ Cannot export data

**Best for**: QA Engineers, Test Automation Engineers, Manual Testers

**Your dashboard shows**: Only your team's metrics and features

---

### 👁️ Viewer

**You can view dashboards but cannot make changes.**

**What you can do**:
- ✅ View assigned teams' dashboards
- ✅ View reports (read-only)
- ✅ View metrics and charts
- ✅ View team gamification leaderboard
- ❌ Cannot edit anything
- ❌ Cannot access advanced features
- ❌ Cannot export data
- ❌ Cannot manage teams or users

**Best for**: Stakeholders, Product Managers, Executives (dashboard viewing only)

**Your dashboard shows**: Assigned teams with basic metrics

---

## Common Tasks

### Viewing Your Profile

1. Look at the bottom-left of the sidebar
2. You'll see your name, email, and role badge
3. Your role is shown with an icon:
   - 👑 Super Admin
   - 📊 QA Manager
   - 👥 Team Lead
   - 🧪 QA Engineer
   - 👁️ Viewer

### Signing Out

1. Click the **"Sign Out"** button at the bottom of the sidebar
2. You'll be returned to the login screen
3. Your session is securely ended

### Switching Between Teams (Team Leads)

1. Use the sidebar to select different teams
2. Click on a team name to view its details
3. Use "All Teams" to see a summary of all teams

### Accessing Advanced Features

1. Click **"Advanced Features"** in the sidebar
2. You'll see features available to your role
3. Features you can't access won't be shown

### Managing Teams (Admins & Managers)

1. Click **"Manage Teams"** in the sidebar
2. Click **"Add New Team"** to create a team
3. Click **"Edit"** on any team to modify it
4. Click **"Remove"** to delete a team (with confirmation)

---

## Security & Privacy

### Keep Your Account Safe

**Do**:
- ✅ Use a strong, unique password
- ✅ Sign out when using shared computers
- ✅ Keep your password private
- ✅ Report suspicious activity

**Don't**:
- ❌ Share your password with anyone
- ❌ Use the same password as other sites
- ❌ Leave your session open on public computers
- ❌ Write down your password

### Session Timeout

- Your session will expire after 1 hour of inactivity
- You'll be automatically logged out for security
- Simply log in again to continue

### Remember Me

- Check "Remember me" to stay logged in longer
- Only use this on your personal device
- Never use on shared or public computers

---

## Troubleshooting

### I forgot my password

1. Click **"Forgot password?"** on the login page
2. Enter your email address
3. Check your email for reset instructions
4. Follow the link to create a new password

### I can't see a feature I need

**Check your role**:
- Some features are only available to certain roles
- Contact your admin if you need access to more features
- Your admin can change your role if needed

### I can't access a team

**Check your assignments**:
- You can only access teams you're assigned to
- Contact your Team Lead or QA Manager
- They can add you to the team

### The dashboard looks different

**This is normal**:
- Different roles see different views
- Super Admins see everything
- QA Engineers see only their team
- This is by design for security

---

## Tips & Best Practices

### For All Users

1. **Check your dashboard daily** - Stay updated on metrics
2. **Use filters** - Focus on what matters to you
3. **Explore features** - Try all available tools
4. **Report issues** - Help improve the platform

### For QA Engineers

1. **Update test status regularly** - Keep data current
2. **Document flaky tests** - Help identify patterns
3. **Review technical debt** - Prioritize fixes
4. **Track your metrics** - Monitor your progress

### For Team Leads

1. **Review team metrics weekly** - Spot trends early
2. **Manage team members** - Keep assignments current
3. **Generate reports** - Share with stakeholders
4. **Use gamification** - Motivate your team

### For QA Managers

1. **Compare teams** - Identify best practices
2. **Track organization trends** - See the big picture
3. **Review business impact** - Show QA value
4. **Manage resources** - Optimize team allocation

### For Admins

1. **Monitor system health** - Check audit logs
2. **Manage users proactively** - Remove inactive accounts
3. **Configure integrations** - Keep APIs connected
4. **Review permissions** - Ensure proper access

---

## Getting Help

### In-App Support

- Look for the **Help** icon (?) throughout the app
- Hover over features for tooltips
- Check the documentation links

### Contact Support

- **Email**: support@irongate.com
- **Phone**: +1 (555) 123-4567
- **Hours**: Monday-Friday, 9 AM - 5 PM EST

### Training Resources

- **Video Tutorials**: Available in the Help section
- **Webinars**: Monthly training sessions
- **Documentation**: Comprehensive guides for all features

---

## Frequently Asked Questions

### Can I have multiple roles?

No, each user has one role. However, admins can change your role if your responsibilities change.

### Can I access teams I'm not assigned to?

- **Super Admins & QA Managers**: Yes, all teams
- **Team Leads**: Summary view only
- **QA Engineers & Viewers**: No, only assigned teams

### How do I request a role change?

Contact your QA Manager or Super Admin. They can update your role based on your responsibilities.

### Can I change my password?

Yes! Click on your profile in the sidebar, then select "Change Password".

### What happens if I enter the wrong password?

After 5 failed attempts, your account will be locked for 15 minutes for security.

### Can I use IronGate on mobile?

Yes! The interface is responsive and works on tablets and phones.

### Is my data secure?

Yes! We use industry-standard encryption, secure sessions, and regular security audits.

### Can I export my data?

Depends on your role:
- **Super Admins & QA Managers**: Yes, all data
- **Team Leads**: Your team's data only
- **QA Engineers & Viewers**: No export access

---

## Quick Reference Card

### Login
1. Enter email
2. Enter password
3. Click "Sign In"

### Logout
1. Click "Sign Out" button (bottom-left)

### View Dashboard
1. Select team from sidebar
2. View metrics and charts

### Access Features
1. Click "Advanced Features"
2. Select feature to explore

### Get Help
1. Click Help icon (?)
2. Or email support@irongate.com

---

## Welcome Aboard! 🚀

You're now ready to use IronGate QA Navigator. Start by:

1. ✅ Logging in with your credentials
2. ✅ Exploring your dashboard
3. ✅ Trying out available features
4. ✅ Customizing your view

**Need help?** Contact your team lead or admin!

---

*IronGate QA Navigator - Transforming Quality Data into Business Value*

© 2025 IronGate Software LTD. All rights reserved.
