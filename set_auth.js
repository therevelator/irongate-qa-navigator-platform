const user = {
  id: "065155cb-aeef-46d0-a029-547c87ad6a53",
  email: "superadmin@irongate.ie",
  firstName: "Ionuț",
  lastName: "Apostu",
  role: "super_admin",
  companyId: "novatech",
  departmentId: null,
  primaryTeamId: null,
  assignedTeams: [],
  createdAt: "2025-11-24T23:13:09.000Z",
  lastLogin: new Date().toISOString(),
  isActive: true,
  emailVerified: true
};

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIwNjUxNTVjYi1hZWVmLTQ2ZDAtYTAyOS01NDdjODdhZDZhNTMiLCJyb2xlIjoic3VwZXJfYWRtaW4iLCJjb21wYW55SWQiOiJub3ZhdGVjaCIsImlhdCI6MTc2NDcxMjUxMH0.1ZoQdcoBJzmJT7uCW_IFy5EPbvT9ZlucH9jFdpIDvXU";

localStorage.setItem('irongate_user', JSON.stringify(user));
localStorage.setItem('irongate_token', token);

console.log('Authentication set successfully!');
console.log('User:', user);
console.log('Token:', token);
