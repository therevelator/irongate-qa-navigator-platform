# Users & Departments CRUD Implementation - TODO

## Current Status
- ✅ TeamsView: Fully functional with modals and API integration
- ⏳ UsersView: Partially updated (state added, fetch updated, needs modals and button handlers)
- ❌ DepartmentsView: Not started

## What's Been Done for UsersView

### Added:
1. ✅ Imports: `toast`, `Save` icon, `Modal` component
2. ✅ State variables:
   - `teams`, `departments`, `roles` arrays
   - `showCreateModal`, `showEditModal`, `showPasswordModal` booleans
   - `selectedUser` object
   - `userForm` object with fields: firstName, lastName, email, role, departmentId, primaryTeamId, password
3. ✅ Updated `fetchUsers()` to fetch teams, departments, and roles

### Still Needed for UsersView:

1. **Update Edit Button Handler** (line ~228):
```typescript
<button
  onClick={() => {
    setSelectedUser(u);
    setUserForm({
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      role: u.role,
      departmentId: u.department_id || '',
      primaryTeamId: u.primary_team_id || '',
      password: ''
    });
    setShowEditModal(true);
  }}
  className="p-2 text-gray-400 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
  title="Edit user"
>
  <Edit2 size={18} />
</button>
```

2. **Update Reset Password Button Handler** (line ~235):
```typescript
<button
  onClick={() => {
    setSelectedUser(u);
    setUserForm({ ...userForm, password: '' });
    setShowPasswordModal(true);
  }}
  className="p-2 text-gray-400 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
  title="Reset password"
>
  <Key size={18} />
</button>
```

3. **Update Delete Button Handler** (line ~242):
```typescript
<button
  onClick={async () => {
    if (confirm(`Are you sure you want to delete ${u.first_name} ${u.last_name}?`)) {
      try {
        const response = await fetch(`${API_URL}/admin/users/${u.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
          }
        });
        
        if (response.ok) {
          toast.success('User deleted successfully!');
          fetchUsers();
        } else {
          toast.error('Failed to delete user');
        }
      } catch (error) {
        console.error('Error deleting user:', error);
        toast.error('Error deleting user');
      }
    }
  }}
  className="p-2 text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
  title="Delete user"
>
  <Trash2 size={18} />
</button>
```

4. **Add Create User Modal** (before closing `</div>` at line ~263):
```typescript
{/* Create User Modal */}
<Modal
  isOpen={showCreateModal}
  onClose={() => setShowCreateModal(false)}
  title="Create New User"
  size="md"
>
  <form onSubmit={async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
        },
        body: JSON.stringify({
          firstName: userForm.firstName,
          lastName: userForm.lastName,
          email: userForm.email,
          password: userForm.password,
          role: userForm.role,
          departmentId: userForm.departmentId,
          primaryTeamId: userForm.primaryTeamId || null
        })
      });
      
      if (response.ok) {
        setShowCreateModal(false);
        setUserForm({
          firstName: '',
          lastName: '',
          email: '',
          role: '',
          departmentId: '',
          primaryTeamId: '',
          password: ''
        });
        toast.success('User created successfully!');
        fetchUsers();
      } else {
        const errorData = await response.json();
        toast.error(`Failed to create user: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error('Error creating user');
    }
  }}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            First Name
          </label>
          <input
            type="text"
            value={userForm.firstName}
            onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Last Name
          </label>
          <input
            type="text"
            value={userForm.lastName}
            onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            required
          />
        </div>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Email
        </label>
        <input
          type="email"
          value={userForm.email}
          onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          required
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Password
        </label>
        <input
          type="password"
          value={userForm.password}
          onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          required
          minLength={6}
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Role
        </label>
        <select
          value={userForm.role}
          onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          required
        >
          <option value="">Select a role</option>
          {roles.map(role => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Department
        </label>
        <select
          value={userForm.departmentId}
          onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          required
        >
          <option value="">Select a department</option>
          {departments.map(dept => (
            <option key={dept.id} value={dept.id}>{dept.name}</option>
          ))}
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Primary Team (Optional)
        </label>
        <select
          value={userForm.primaryTeamId}
          onChange={(e) => setUserForm({ ...userForm, primaryTeamId: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
        >
          <option value="">No team</option>
          {teams.filter(t => t.department_id === userForm.departmentId).map(team => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      </div>
    </div>
    
    <div className="flex justify-end gap-3 mt-6">
      <button
        type="button"
        onClick={() => setShowCreateModal(false)}
        className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"
      >
        <UserPlus size={18} />
        Create User
      </button>
    </div>
  </form>
</Modal>
```

5. **Add Edit User Modal** (similar structure to Create, but with PUT request to `/admin/users/${selectedUser?.id}`)

6. **Add Reset Password Modal** (simple form with just password field, PUT to `/admin/users/${selectedUser?.id}/password`)

## DepartmentsView Implementation

Similar pattern to TeamsView:
1. Add state for modals and forms
2. Update fetch to get all departments
3. Add Create Department modal
4. Add Edit Department modal  
5. Update Delete button with API call
6. Replace all alerts with toast notifications

## API Endpoints Reference

### Users
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create user
- `PUT /api/admin/users/:id` - Update user
- `DELETE /api/admin/users/:id` - Delete user
- `PUT /api/admin/users/:id/password` - Reset password

### Departments
- `GET /api/admin/departments` - List all departments
- `POST /api/admin/departments` - Create department
- `PUT /api/admin/departments/:id` - Update department
- `DELETE /api/admin/departments/:id` - Delete department

### Supporting Data
- `GET /api/admin/teams` - For dropdowns
- `GET /api/admin/roles` - For role dropdown

## Notes
- All modals follow the same pattern as TeamsView
- All use toast notifications instead of alerts
- All forms validate required fields
- All API calls include proper error handling
- Department dropdown in user forms filters teams by selected department
