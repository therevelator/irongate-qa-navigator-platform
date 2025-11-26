# QA Dashboard Replication Prompt

## Project Overview
Build a comprehensive QA Dashboard web application called "IronGate QA Navigator" - an enterprise-grade quality assurance management platform for tracking test execution, defects, and team performance metrics.

## Tech Stack Requirements

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MySQL
- **Authentication**: JWT tokens with bcrypt password hashing
- **Real-time**: WebSocket support
- **Scheduled Jobs**: node-cron for periodic data sync
- **Development**: tsx for TypeScript execution with hot reload

### Frontend
- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **Styling**: TailwindCSS
- **Icons**: Lucide React
- **State Management**: React Context API
- **Routing**: Client-side view switching

### Development Tools
- **Package Manager**: npm
- **Concurrency**: concurrently for running frontend and backend together
- **Environment**: dotenv for configuration

## Database Schema

### Core Tables

**companies**
- id (VARCHAR, primary key)
- name (VARCHAR)
- domain (VARCHAR)
- is_active (BOOLEAN)
- created_at, updated_at (TIMESTAMP)

**departments**
- id (VARCHAR, primary key)
- company_id (foreign key to companies)
- name (VARCHAR)
- description (TEXT)
- is_active (BOOLEAN)
- created_at, updated_at (TIMESTAMP)

**teams**
- id (VARCHAR, primary key)
- company_id (foreign key to companies)
- department_id (foreign key to departments)
- name (VARCHAR, unique per department)
- description (TEXT)
- platform (ENUM: Backend, Frontend, Mobile, API, DevOps, Web, Security)
- lead_id (foreign key to users, nullable)
- is_active (BOOLEAN)
- created_at, updated_at (TIMESTAMP)

**users**
- id (CHAR(36), primary key, default uuid())
- email (VARCHAR, unique)
- password_hash (VARCHAR)
- first_name, last_name (VARCHAR)
- role (ENUM: super_admin, qa_manager, team_lead, qa_engineer, viewer)
- company_id (foreign key to companies)
- department_id (foreign key to departments)
- primary_team_id (foreign key to teams, nullable)
- avatar_url, phone, timezone (optional fields)
- is_active, email_verified (BOOLEAN)
- created_at, updated_at, last_login (TIMESTAMP)
- created_by (foreign key to users)

**team_members**
- id (auto-increment primary key)
- user_id (foreign key to users)
- team_id (foreign key to teams)
- role (ENUM: lead, member)
- joined_at (TIMESTAMP)
- Unique constraint on (user_id, team_id)

**test_executions**
- id (VARCHAR, primary key)
- team_id (foreign key to teams)
- executed_by (foreign key to users)
- test_suite (VARCHAR)
- total_tests (INT)
- passed, failed, skipped (INT)
- duration_minutes (INT)
- execution_date (DATE)
- environment (ENUM: dev, staging, production)
- status (ENUM: passed, failed, running)
- created_at (TIMESTAMP)

**defects**
- id (VARCHAR, primary key)
- team_id (foreign key to teams)
- reported_by (foreign key to users)
- assigned_to (foreign key to users, nullable)
- title (VARCHAR)
- description (TEXT)
- severity (ENUM: critical, high, medium, low)
- status (ENUM: open, in_progress, resolved, closed, reopened)
- environment (ENUM: dev, staging, production)
- reported_date (DATE)
- resolved_date (DATE, nullable)
- created_at, updated_at (TIMESTAMP)

**metrics_history**
- id (auto-increment primary key)
- team_id (foreign key to teams)
- metric_date (DATE)
- total_tests_executed (INT)
- tests_passed, tests_failed (INT)
- pass_rate (DECIMAL)
- defects_reported, defects_resolved (INT)
- avg_resolution_time_hours (DECIMAL)
- created_at (TIMESTAMP)
- Unique constraint on (team_id, metric_date)

## Authentication & Authorization

### JWT Token Structure
```json
{
  "userId": "user-id",
  "role": "super_admin|qa_manager|team_lead|qa_engineer|viewer",
  "companyId": "company-id",
  "departmentId": "dept-id",
  "primaryTeamId": "team-id"
}
```

### Role Hierarchy & Permissions
1. **super_admin**: Full system access, can manage all users, teams, departments
2. **qa_manager**: Can manage teams, create users (except super_admin), view all department data
3. **team_lead**: Can manage team members, view team metrics, create test executions
4. **qa_engineer**: Can create test executions, report defects, view team data
5. **viewer**: Read-only access to assigned team data

### Middleware
- `authenticateToken`: Verify JWT and populate req.user with user info
- `requireRole(...roles)`: Restrict endpoints to specific roles

## API Endpoints

### Authentication (`/api/auth`)
- `POST /login` - Login with email/password, returns JWT token and user info
- `POST /register` - Register new user (requires admin role)
- `POST /logout` - Logout user
- `GET /me` - Get current user info

### Users (`/api/users`)
- `GET /` - List all users (filtered by role/company)
- `GET /:id` - Get user details
- `PUT /:id` - Update user (admins or self)
- `DELETE /:id` - Delete user (admin only)

### Teams (`/api/teams`)
- `GET /` - List teams with member counts and department info
- `GET /:id` - Get team details
- `POST /` - Create team (qa_manager+)
- `PUT /:id` - Update team (qa_manager+)
- `DELETE /:id` - Delete team (qa_manager+)

### Admin (`/api/admin`)
- `GET /users` - Get users based on role hierarchy
- `POST /users` - Create new user with role validation
- `POST /users/:id/reset-password` - Reset user password
- `POST /teams` - Create team
- `GET /available-roles` - Get roles current user can assign

### Test Executions (`/api/test-executions`)
- `GET /` - List test executions (filtered by team/user)
- `GET /:id` - Get execution details
- `POST /` - Create test execution
- `PUT /:id` - Update execution
- `DELETE /:id` - Delete execution

### Defects (`/api/defects`)
- `GET /` - List defects (filtered by team/status)
- `GET /:id` - Get defect details
- `POST /` - Create defect
- `PUT /:id` - Update defect
- `DELETE /:id` - Delete defect

### Metrics (`/api/metrics`)
- `GET /team/:teamId` - Get team metrics and trends
- `GET /dashboard` - Get dashboard summary for current user

## Frontend Features

### Main Views

**1. Dashboard (Home)**
- Team performance overview cards
- Recent test executions table
- Active defects summary
- Pass rate trend chart
- Quick stats: total tests, pass rate, active defects

**2. Test Executions**
- Filterable table of all test executions
- Create new execution modal
- Status badges (passed/failed/running)
- Environment tags
- Execution details view

**3. Defects**
- Filterable defects table
- Create/edit defect modal
- Severity badges (critical/high/medium/low)
- Status workflow (open → in_progress → resolved → closed)
- Assignment to team members

**4. Teams Management**
- List of all teams
- Click team to view members
- Team detail view with member management
- Platform and status badges

**5. Admin Panel** (super_admin, qa_manager only)
- User management table
- Team management table
- Create user modal with role selection
- Create team modal
- Edit user details
- Reset user password
- Delete user with confirmation
- Click team to manage members (edit/delete/reset password)

### UI Components

**Sidebar Navigation**
- Dashboard
- Test Executions
- Defects
- Teams
- Admin Panel (role-based visibility)
- User profile dropdown with logout

**Modals**
- Create/Edit User
- Create/Edit Team
- Create/Edit Test Execution
- Create/Edit Defect
- Reset Password
- Delete Confirmation

**Data Display**
- Tables with sorting and filtering
- Status badges with color coding
- Metric cards with icons
- Trend charts (optional: use Chart.js or Recharts)

### Authentication Flow
1. Login page with email/password
2. Store JWT token in localStorage as `irongate_token`
3. Store user info in localStorage as `irongate_user`
4. AuthContext provides user state and auth methods
5. Protected routes check authentication
6. Auto-logout on token expiration

## Seed Data

### Demo Company
- **Company**: Mastercard
- **Departments**: Decision Management, Payments Processing, Security & Compliance, Digital Products

### Demo Teams (14 teams)
**Decision Management:**
- Nebula (Backend) - AI/ML decision engine
- Voyagers (API) - Real-time decision processing
- Sentinels (DevOps) - Monitoring and alerting
- Pioneers (Web) - Exploration and innovation
- Horizon (Backend) - Data analytics
- Atlas (DevOps) - Infrastructure

**Payments:**
- Nexus (Backend) - Core payment processing
- Ledger (Backend) - Settlement and reconciliation
- Portal (API) - Payment gateway

**Security:**
- Guardians (Backend) - Fraud detection
- Vanguard (Security) - Compliance and audit

**Digital:**
- Catalyst iOS (Mobile)
- Catalyst Android (Mobile)
- Zenith (Web) - Customer portal

### Demo Users
- **Super Admin**: admin@irongate.com / demo123
- Additional users across different teams and roles

## Key Features to Implement

### 1. Role-Based Access Control
- Hierarchical role system
- Permission checks on all endpoints
- UI elements hidden based on role
- Data filtering by company/department/team

### 2. Team Management
- Multi-level organization (company → department → team)
- Team member assignment
- Team lead designation
- Platform categorization

### 3. Metrics & Analytics
- Automated metrics calculation
- Historical trend tracking
- Pass rate computation
- Defect resolution time tracking
- Scheduled sync job (every 15 minutes)

### 4. Admin Panel
- User CRUD operations
- Team CRUD operations
- Password reset functionality
- Role assignment with validation
- Team-based user management view

### 5. Real-time Updates
- WebSocket connection for live updates
- Automatic data refresh
- Status change notifications

## Project Structure

```
qa-dashboard/
├── server/
│   ├── index.ts                 # Express server setup
│   ├── middleware/
│   │   └── auth.ts             # JWT authentication
│   ├── routes/
│   │   ├── auth.ts             # Auth endpoints
│   │   ├── users.ts            # User management
│   │   ├── teams.ts            # Team management
│   │   ├── admin.ts            # Admin operations
│   │   ├── test-executions.ts  # Test execution CRUD
│   │   ├── defects.ts          # Defect tracking
│   │   └── metrics.ts          # Metrics and analytics
│   └── jobs/
│       └── metricsSync.ts      # Scheduled metrics calculation
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx
│   │   ├── TestExecutions.tsx
│   │   ├── Defects.tsx
│   │   ├── Teams.tsx
│   │   └── AdminPanel.tsx
│   ├── contexts/
│   │   └── AuthContext.tsx     # Authentication state
│   ├── types/
│   │   └── auth.ts             # TypeScript interfaces
│   ├── App.tsx                 # Main app with routing
│   └── main.tsx                # React entry point
├── src/lib/
│   └── db.ts                   # Database connection
├── schema.sql                  # Database schema
├── seed_data.sql              # Demo data
├── .env                        # Environment variables
└── package.json
```

## Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=irongate_qa

# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# JWT
secrettoken=your-super-secret-jwt-key-change-in-production

# Optional: External APIs for sync
JENKINS_URL=
JENKINS_TOKEN=
JIRA_URL=
JIRA_TOKEN=
```

## Implementation Steps

### Phase 1: Setup & Database
1. Initialize Node.js project with TypeScript
2. Set up Express server with CORS
3. Create MySQL database and run schema.sql
4. Implement database connection with connection pooling
5. Run seed_data.sql for demo data

### Phase 2: Backend API
1. Implement JWT authentication middleware
2. Create auth routes (login, register)
3. Build user management endpoints
4. Build team management endpoints
5. Create admin endpoints with role validation
6. Implement test execution CRUD
7. Implement defect tracking CRUD
8. Build metrics calculation and endpoints
9. Set up WebSocket server
10. Create scheduled metrics sync job

### Phase 3: Frontend Foundation
1. Set up React with Vite and TypeScript
2. Configure TailwindCSS
3. Create AuthContext for authentication state
4. Build login page
5. Create main App layout with sidebar
6. Implement protected routing

### Phase 4: Core Features
1. Build Dashboard view with metrics cards
2. Create Test Executions view with table and modals
3. Build Defects view with filtering
4. Implement Teams view
5. Create Admin Panel with user/team management
6. Add team detail view with member management

### Phase 5: Polish & Testing
1. Add loading states and error handling
2. Implement form validation
3. Add success/error notifications
4. Test all CRUD operations
5. Verify role-based access control
6. Test on different screen sizes
7. Add data refresh mechanisms

## Success Criteria

✅ Users can login and see role-appropriate views
✅ Super admins can create/edit/delete users and teams
✅ Team members can create test executions and defects
✅ Metrics are calculated and displayed correctly
✅ Admin panel allows team-based user management
✅ All modals (edit, delete, reset password) work instantly
✅ Data is filtered based on user role and team
✅ UI is responsive and modern
✅ Authentication is secure with JWT
✅ Database relationships are properly enforced

## Additional Notes

- Use UUIDs for primary keys (format: `entity-timestamp-random`)
- All timestamps should be in UTC
- Passwords must be hashed with bcrypt (10 rounds)
- JWT tokens expire after 7 days
- Use COALESCE or dynamic query building for partial updates
- Always validate role permissions on backend
- Filter data by company/department/team based on user role
- Use proper HTTP status codes (200, 201, 400, 401, 403, 500)
- Log errors to console for debugging
- Use prepared statements to prevent SQL injection

## Design Guidelines

- Modern, clean UI with TailwindCSS
- Blue primary color scheme (#2563eb)
- Status badges with appropriate colors (green=success, red=error, yellow=warning)
- Card-based layouts for metrics
- Tables with hover effects
- Modal overlays with backdrop
- Responsive design (mobile-friendly)
- Icons from Lucide React
- Consistent spacing and typography
- Loading states for async operations

---

**This prompt should provide everything needed to replicate the QA Dashboard application from scratch.**
