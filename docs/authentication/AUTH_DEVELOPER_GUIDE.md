# 🔐 Authentication System - Developer Guide

## Overview

IronGate QA Navigator implements a comprehensive Role-Based Access Control (RBAC) system with 5 distinct user roles, each with specific permissions and feature access.

---

## Architecture

### Component Structure

```
src/
├── types/
│   └── auth.ts                 # Type definitions & permissions
├── contexts/
│   └── AuthContext.tsx         # Auth state management
├── components/
│   ├── Login.tsx               # Login UI
│   ├── Register.tsx            # Registration UI
│   └── AuthWrapper.tsx         # Auth gate component
└── main.tsx                    # App entry with providers
```

### Data Flow

```
User Action (Login/Register)
        ↓
AuthContext (validate & store)
        ↓
localStorage (persist session)
        ↓
AuthWrapper (check auth status)
        ↓
App (render based on permissions)
```

---

## Implementation Details

### 1. Type System (`src/types/auth.ts`)

#### User Roles

```typescript
export type UserRole = 
  | 'super_admin'    // Level 5 - Full control
  | 'qa_manager'     // Level 4 - Org-wide oversight
  | 'team_lead'      // Level 3 - Team management
  | 'qa_engineer'    // Level 2 - Testing work
  | 'viewer';        // Level 1 - Read-only

```typescript
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  assignedTeams: string[];  // Team IDs
  avatar?: string;
  createdAt: string;
  lastLogin?: string;
  isActive: boolean;
  emailVerified: boolean;
}
```

#### Permission Matrix

```typescript
export const ROLE_PERMISSIONS: Record<UserRole, {
  name: string;
  description: string;
  level: number;
  permissions: {
    viewAllTeams: boolean;
    manageTeams: boolean;
    manageUsers: boolean;
    accessAdvancedFeatures: boolean;
    accessBusinessAnalytics: boolean;
    configureIntegrations: boolean;
    viewAuditLogs: boolean;
    exportData: boolean;
    manageBilling: boolean;
  };
  features: {
    dashboard: 'all' | 'assigned' | 'own';
    flakyTests: boolean;
    technicalDebt: boolean;
    pipeline: boolean;
    businessImpact: boolean;
    performance: boolean;
    developerProductivity: boolean;
    testCaseManagement: boolean;
    executionTimeline: boolean;
    gamification: boolean;
  };
}>;
```

#### Helper Functions

```typescript
// Check if user has specific permission
hasPermission(user: User | null, permission: string): boolean

// Check if user can access feature
canAccessFeature(user: User | null, feature: string): boolean

// Check if user can manage another user
canManageUser(currentUser: User | null, targetUser: User): boolean

// Get role badge styling
getRoleBadgeColor(role: UserRole): string

// Get role icon emoji
getRoleIcon(role: UserRole): string
```

---

### 2. Authentication Context (`src/contexts/AuthContext.tsx`)

#### Context API

```typescript
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}
```

#### Usage in Components

```typescript
import { useAuth } from '../contexts/AuthContext';

function MyComponent() {
  const { user, isAuthenticated, login, logout } = useAuth();
  
  // Check if user is authenticated
  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }
  
  // Access user data
  console.log(user?.role); // 'super_admin', 'qa_manager', etc.
  
  // Check permissions
  if (hasPermission(user, 'manageTeams')) {
    // Show team management UI
  }
  
  return <div>Welcome, {user?.firstName}!</div>;
}
```

#### Session Management

**Storage**:
```typescript
localStorage.setItem('irongate_user', JSON.stringify(user));
localStorage.setItem('irongate_token', token);
localStorage.setItem('irongate_remember', 'true'); // Optional
```

**Retrieval**:
```typescript
const storedUser = localStorage.getItem('irongate_user');
const storedToken = localStorage.getItem('irongate_token');
```

**Cleanup**:
```typescript
localStorage.removeItem('irongate_user');
localStorage.removeItem('irongate_token');
localStorage.removeItem('irongate_remember');
```

---

### 3. Demo Mode vs Production Mode

#### Current: Demo Mode

```typescript
// Mock user lookup
const mockUsers: Record<string, User> = {
  'admin@irongate.com': { /* ... */ },
  'manager@irongate.com': { /* ... */ },
  // etc.
};

const user = mockUsers[credentials.email.toLowerCase()];
if (!user || credentials.password !== 'demo123') {
  throw new Error('Invalid email or password');
}
```

**Demo Credentials**:
- Email: `admin@irongate.com`, `manager@irongate.com`, etc.
- Password: `demo123`

#### Production Mode

Replace mock authentication with real API calls:

```typescript
// Login
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(credentials),
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(error.message || 'Login failed');
}

const { user, token } = await response.json();

// Store token
localStorage.setItem('irongate_user', JSON.stringify(user));
localStorage.setItem('irongate_token', token);
```

```typescript
// Register
const response = await fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

const { user, token } = await response.json();
```

```typescript
// Logout
await fetch('/api/auth/logout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`,
  },
});
```

---

## Protected Routes & Feature Gating

### Method 1: Component-Level Protection

```typescript
import { useAuth } from '../contexts/AuthContext';
import { canAccessFeature } from '../types/auth';

function BusinessImpactAnalysis() {
  const { user } = useAuth();
  
  if (!canAccessFeature(user, 'businessImpact')) {
    return (
      <div className="p-8 text-center">
        <h2>Access Denied</h2>
        <p>You don't have permission to view this feature.</p>
      </div>
    );
  }
  
  return <div>Business Impact Content</div>;
}
```

### Method 2: Conditional Rendering

```typescript
function FeaturesMenu() {
  const { user } = useAuth();
  
  return (
    <div>
      {canAccessFeature(user, 'flakyTests') && (
        <FeatureCard feature="Flaky Test Intelligence" />
      )}
      
      {canAccessFeature(user, 'businessImpact') && (
        <FeatureCard feature="Business Impact" />
      )}
    </div>
  );
}
```

### Method 3: Permission-Based UI

```typescript
function TeamManagement() {
  const { user } = useAuth();
  
  return (
    <div>
      <h1>Teams</h1>
      
      {hasPermission(user, 'manageTeams') && (
        <button>Add New Team</button>
      )}
      
      {hasPermission(user, 'viewAllTeams') ? (
        <AllTeamsList />
      ) : (
        <AssignedTeamsList teams={user?.assignedTeams} />
      )}
    </div>
  );
}
```

---

## Security Best Practices

### 1. Token Management

```typescript
// Always use HTTPS in production
const API_BASE_URL = process.env.VITE_API_URL || 'https://api.irongate.com';

// Include token in requests
const response = await fetch(`${API_BASE_URL}/api/teams`, {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`,
    'Content-Type': 'application/json',
  },
});
```

### 2. Token Expiration

```typescript
// Check token expiration
const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

// Refresh token if needed
if (isTokenExpired(token)) {
  await refreshToken();
}
```

### 3. Password Requirements

```typescript
const validatePassword = (password: string): boolean => {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^a-zA-Z0-9]/.test(password)
  );
};
```

### 4. XSS Prevention

```typescript
// Never use dangerouslySetInnerHTML with user input
// Always sanitize user input
import DOMPurify from 'dompurify';

const sanitizedInput = DOMPurify.sanitize(userInput);
```

### 5. CSRF Protection

```typescript
// Include CSRF token in requests
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

fetch('/api/endpoint', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': csrfToken,
  },
});
```

---

## Testing

### Unit Tests

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../contexts/AuthContext';
import Login from '../components/Login';

describe('Login Component', () => {
  it('should render login form', () => {
    render(
      <AuthProvider>
        <Login onSwitchToRegister={() => {}} />
      </AuthProvider>
    );
    
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
  
  it('should handle login submission', async () => {
    const { getByLabelText, getByText } = render(
      <AuthProvider>
        <Login onSwitchToRegister={() => {}} />
      </AuthProvider>
    );
    
    fireEvent.change(getByLabelText('Email Address'), {
      target: { value: 'admin@irongate.com' },
    });
    
    fireEvent.change(getByLabelText('Password'), {
      target: { value: 'demo123' },
    });
    
    fireEvent.click(getByText('Sign In'));
    
    // Assert login success
  });
});
```

### Integration Tests

```typescript
describe('Authentication Flow', () => {
  it('should complete full auth flow', async () => {
    // 1. User visits app (not authenticated)
    // 2. Login form is shown
    // 3. User enters credentials
    // 4. User is authenticated
    // 5. Dashboard is shown
    // 6. User can logout
  });
});
```

---

## API Endpoints (Production)

### Authentication Endpoints

```
POST   /api/auth/register       - Create new user
POST   /api/auth/login          - Authenticate user
POST   /api/auth/logout         - End session
POST   /api/auth/refresh        - Refresh token
POST   /api/auth/forgot-password - Request password reset
POST   /api/auth/reset-password  - Reset password
GET    /api/auth/me             - Get current user
PUT    /api/auth/me             - Update current user
```

### User Management Endpoints

```
GET    /api/users               - List users (admin only)
POST   /api/users               - Create user (admin only)
GET    /api/users/:id           - Get user details
PUT    /api/users/:id           - Update user
DELETE /api/users/:id           - Delete user (admin only)
PUT    /api/users/:id/role      - Change user role (admin only)
PUT    /api/users/:id/teams     - Assign teams
```

---

## Troubleshooting

### Issue: User not persisting after refresh

**Solution**: Check localStorage is working
```typescript
console.log(localStorage.getItem('irongate_user'));
console.log(localStorage.getItem('irongate_token'));
```

### Issue: Permission checks failing

**Solution**: Verify user object structure
```typescript
console.log('User:', user);
console.log('Role:', user?.role);
console.log('Permissions:', ROLE_PERMISSIONS[user?.role]);
```

### Issue: Login not working

**Solution**: Check credentials and error messages
```typescript
try {
  await login(credentials);
} catch (error) {
  console.error('Login error:', error);
}
```

---

## Migration from Demo to Production

### Step 1: Set up backend API

```bash
# Example with Express.js
npm install express jsonwebtoken bcrypt
```

### Step 2: Replace mock functions

Find all instances of `// PRODUCTION MODE` comments and uncomment the real API calls.

### Step 3: Configure environment variables

```env
VITE_API_URL=https://api.irongate.com
VITE_AUTH_TIMEOUT=3600000  # 1 hour
```

### Step 4: Test thoroughly

- Test all 5 roles
- Test permission boundaries
- Test session expiration
- Test logout
- Test password reset

---

## Performance Considerations

### 1. Lazy Loading

```typescript
const BusinessImpact = lazy(() => import('./components/BusinessImpactAnalysis'));

{canAccessFeature(user, 'businessImpact') && (
  <Suspense fallback={<Loading />}>
    <BusinessImpact />
  </Suspense>
)}
```

### 2. Memoization

```typescript
const userPermissions = useMemo(() => {
  return user ? ROLE_PERMISSIONS[user.role] : null;
}, [user]);
```

### 3. Context Optimization

```typescript
// Split contexts if needed
<AuthProvider>
  <PermissionsProvider>
    <App />
  </PermissionsProvider>
</AuthProvider>
```

---

## Future Enhancements

- [ ] Two-Factor Authentication (2FA)
- [ ] Single Sign-On (SSO) with OAuth
- [ ] Biometric authentication
- [ ] Session management dashboard
- [ ] Audit logging
- [ ] IP whitelisting
- [ ] Device management
- [ ] Password policies configuration
- [ ] Role customization UI
- [ ] Permission inheritance

---

**For user documentation, see AUTH_USER_GUIDE.md**  
**For business documentation, see AUTH_BUSINESS_GUIDE.md**
