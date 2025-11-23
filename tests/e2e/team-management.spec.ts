import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:3000/api';
const APP_URL = 'http://localhost:5174';

// Test data
const testDepartment = {
  name: `Test Department ${Date.now()}`,
  description: 'Department for team testing'
};

const testTeam = {
  name: `QA Team ${Date.now()}`,
  description: 'Test team for E2E testing'
};

const updatedTeam = {
  name: `Updated QA Team ${Date.now()}`,
  description: 'Updated description for testing'
};

test.describe('Team Management CRUD Operations', () => {
  let authToken: string;
  let createdDepartmentId: string;
  let createdTeamId: string;

  test.beforeAll(async ({ request }) => {
    // Login as super admin
    const loginResponse = await request.post(`${API_URL}/auth/login`, {
      data: {
        email: 'admin@irongate.com',
        password: 'demo123'
      }
    });

    expect(loginResponse.ok()).toBeTruthy();
    const loginData = await loginResponse.json();
    authToken = loginData.token;
    expect(authToken).toBeTruthy();

    // Create a test department first
    const deptResponse = await request.post(`${API_URL}/admin/departments`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: testDepartment
    });

    expect(deptResponse.ok()).toBeTruthy();
    const deptData = await deptResponse.json();
    createdDepartmentId = deptData.id;
    expect(createdDepartmentId).toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    // Set auth token in localStorage
    await page.goto(APP_URL);
    await page.evaluate((token) => {
      localStorage.setItem('irongate_token', token);
    }, authToken);
  });

  test('should display Admin Panel and navigate to it', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    // Click Admin Panel link
    const adminPanelLink = page.getByRole('button', { name: /admin panel/i });
    await expect(adminPanelLink).toBeVisible();
    await adminPanelLink.click();

    // Verify we're on Admin Panel
    await expect(page.getByRole('heading', { name: /admin control panel/i })).toBeVisible();
  });

  test('should open Create Team modal', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    // Navigate to Admin Panel
    await page.getByRole('button', { name: /admin panel/i }).click();
    await page.waitForTimeout(500);

    // Click Create Team button
    const createTeamButton = page.getByRole('button', { name: /create team/i });
    await expect(createTeamButton).toBeVisible();
    await createTeamButton.click();

    // Verify modal is open
    await expect(page.getByRole('heading', { name: /create new team/i })).toBeVisible();
    
    // Verify form fields are present
    await expect(page.getByTestId('create-team-name')).toBeVisible();
    await expect(page.getByTestId('create-team-description')).toBeVisible();
    await expect(page.getByTestId('create-team-department')).toBeVisible();
  });

  test('should create a new team successfully', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    // Navigate to Admin Panel
    await page.getByRole('button', { name: /admin panel/i }).click();
    await page.waitForTimeout(500);

    // Open Create Team modal
    await page.getByRole('button', { name: /create team/i }).click();
    await expect(page.getByRole('heading', { name: /create new team/i })).toBeVisible();

    // Fill in team details
    await page.getByTestId('create-team-name').fill(testTeam.name);
    await page.getByTestId('create-team-description').fill(testTeam.description);
    await page.getByTestId('create-team-department').selectOption(createdDepartmentId);

    // Submit form
    await page.getByRole('button', { name: /^create team$/i }).click();

    // Wait for success toast
    await expect(page.getByText(/team created successfully/i)).toBeVisible({ timeout: 5000 });

    // Verify modal is closed
    await expect(page.getByRole('heading', { name: /create new team/i })).not.toBeVisible();

    // Verify team appears in the list
    await expect(page.getByText(testTeam.name)).toBeVisible();
  });

  test('should validate required fields when creating team', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    // Navigate to Admin Panel
    await page.getByRole('button', { name: /admin panel/i }).click();
    await page.waitForTimeout(500);

    // Open Create Team modal
    await page.getByRole('button', { name: /create team/i }).click();

    // Try to submit without filling fields
    await page.getByRole('button', { name: /^create team$/i }).click();

    // Modal should still be visible (validation failed)
    await expect(page.getByRole('heading', { name: /create new team/i })).toBeVisible();
  });

  test('should display created team in Teams & Users section', async ({ page, request }) => {
    // Create team via API
    const teamResponse = await request.post(`${API_URL}/admin/teams`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: {
        ...testTeam,
        name: `API Team ${Date.now()}`,
        departmentId: createdDepartmentId
      }
    });

    expect(teamResponse.ok()).toBeTruthy();
    const teamData = await teamResponse.json();
    createdTeamId = teamData.id;

    // Navigate to Admin Panel
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /admin panel/i }).click();
    await page.waitForTimeout(1000);

    // Verify team is visible in the list
    await expect(page.getByText(teamData.name)).toBeVisible();
  });

  test('should expand and collapse team to view users', async ({ page, request }) => {
    // Create team via API
    const teamResponse = await request.post(`${API_URL}/admin/teams`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: {
        ...testTeam,
        name: `Expandable Team ${Date.now()}`,
        departmentId: createdDepartmentId
      }
    });

    expect(teamResponse.ok()).toBeTruthy();
    const teamData = await teamResponse.json();

    // Navigate to Admin Panel
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /admin panel/i }).click();
    await page.waitForTimeout(1000);

    // Find the team row
    const teamRow = page.locator(`text=${teamData.name}`).locator('..');

    // Click to expand
    await teamRow.click();
    await page.waitForTimeout(500);

    // Verify expanded content is visible (should show "No users" message)
    await expect(page.getByText(/no users in this team yet/i)).toBeVisible();

    // Click again to collapse
    await teamRow.click();
    await page.waitForTimeout(500);

    // Verify content is hidden
    await expect(page.getByText(/no users in this team yet/i)).not.toBeVisible();
  });

  test('should fetch teams via API', async ({ request }) => {
    const teamsResponse = await request.get(`${API_URL}/teams`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    expect(teamsResponse.ok()).toBeTruthy();
    const teamsData = await teamsResponse.json();
    
    // Should return array or object with teams property
    const teams = Array.isArray(teamsData) ? teamsData : teamsData.teams;
    expect(Array.isArray(teams)).toBeTruthy();
    expect(teams.length).toBeGreaterThan(0);
  });

  test('should update team via API', async ({ request }) => {
    // Create team first
    const createResponse = await request.post(`${API_URL}/admin/teams`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: {
        ...testTeam,
        name: `Team to Update ${Date.now()}`,
        departmentId: createdDepartmentId
      }
    });

    expect(createResponse.ok()).toBeTruthy();
    const createdTeam = await createResponse.json();

    // Update the team
    const updateResponse = await request.put(`${API_URL}/admin/teams/${createdTeam.id}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: updatedTeam
    });

    expect(updateResponse.ok()).toBeTruthy();
    const updatedTeamData = await updateResponse.json();
    
    expect(updatedTeamData.name).toBe(updatedTeam.name);
    expect(updatedTeamData.description).toBe(updatedTeam.description);
  });

  test('should delete team via API', async ({ request }) => {
    // Create team first
    const createResponse = await request.post(`${API_URL}/admin/teams`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: {
        ...testTeam,
        name: `Team to Delete ${Date.now()}`,
        departmentId: createdDepartmentId
      }
    });

    expect(createResponse.ok()).toBeTruthy();
    const createdTeam = await createResponse.json();

    // Delete the team
    const deleteResponse = await request.delete(`${API_URL}/admin/teams/${createdTeam.id}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    expect(deleteResponse.ok()).toBeTruthy();

    // Verify team is deleted
    const getResponse = await request.get(`${API_URL}/teams`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const teamsData = await getResponse.json();
    const teams = Array.isArray(teamsData) ? teamsData : teamsData.teams;
    const deletedTeam = teams.find((t: any) => t.id === createdTeam.id);
    expect(deletedTeam).toBeUndefined();
  });

  test('should prevent non-admin from creating teams', async ({ request }) => {
    // Try to create team without proper authorization
    const response = await request.post(`${API_URL}/admin/teams`, {
      data: {
        ...testTeam,
        departmentId: createdDepartmentId
      }
    });

    expect(response.status()).toBe(401); // Unauthorized
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: Delete test department
    if (createdDepartmentId && authToken) {
      await request.delete(`${API_URL}/admin/departments/${createdDepartmentId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
    }
  });
});
