import { test, expect } from '@playwright/test';

const BASE_URL =
  process.env.BASE_URL ||
  'https://ais-pre-enc34wircd54camk26f6z6-662080088853.asia-northeast1.run.app';

if (process.env.STORAGE_STATE) {
  test.use({ storageState: process.env.STORAGE_STATE });
}

test.describe('Shared To-Do List E2E', () => {
  test('Health endpoint and unauthenticated API guard work', async ({ request }) => {
    const health = await request.get(`${BASE_URL}/api/health`);
    expect(health.status()).toBe(200);
    const body = await health.json();
    assertOkStatus(body.status);

    const unauth = await request.get(`${BASE_URL}/api/tasks`);
    expect(unauth.status()).toBe(401);
  });

  test('Login screen renders Firebase Auth Email/Password + Google Sign-In', async ({ page }) => {
    test.skip(Boolean(process.env.STORAGE_STATE), 'Skipped when running with saved Google STORAGE_STATE');

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Shared To-Do List' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
    await expect(page.getByLabel('User ID or Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

    await page.screenshot({ path: 'e2e-login.png', fullPage: true });

    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByLabel('Display Name')).toBeVisible();
    await page.screenshot({ path: 'e2e-signup.png', fullPage: true });
  });

  test('Authenticated Task CRUD + Filter + Share Modal flow (Google STORAGE_STATE or TEST_EMAIL/TEST_PASSWORD)', async ({
    page,
  }) => {
    const storageState = process.env.STORAGE_STATE;
    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;
    test.skip(
      !storageState && (!email || !password),
      'Provide STORAGE_STATE (saved Google login) or TEST_EMAIL & TEST_PASSWORD'
    );

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    if (!storageState && email && password) {
      await page.getByLabel('User ID or Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign In' }).click();
    }

    await expect(page.getByRole('heading', { name: 'Add a New Task' })).toBeVisible({
      timeout: 15000,
    });

    const taskTitle = `Playwright Task ${Date.now()}`;
    await page.getByPlaceholder('What needs to be done?').fill(taskTitle);
    await page.getByPlaceholder('Optional description or notes...').fill('E2E verified');
    await page.getByRole('button', { name: '+ Add Task' }).click();

    await expect(page.getByText(taskTitle)).toBeVisible();
    await page.screenshot({ path: 'e2e-taskboard.png', fullPage: true });

    // Dropdown filter checks: All / My / Shared
    await page.locator('#taskFilterDropdown').selectOption('my');
    await expect(page.getByText(taskTitle)).toBeVisible();

    await page.locator('#taskFilterDropdown').selectOption('shared');
    await expect(page.getByText(taskTitle)).not.toBeVisible();

    await page.locator('#taskFilterDropdown').selectOption('all');
    await expect(page.getByText(taskTitle)).toBeVisible();

    // Share modal screenshot
    const card = page.locator('.task-card', { hasText: taskTitle });
    await card.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: 'e2e-share-modal.png', fullPage: true });
    await page.getByRole('button', { name: 'Done' }).click();

    // Clean up test task
    await card.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(taskTitle)).not.toBeVisible();
  });
});

function assertOkStatus(status: unknown) {
  expect(status).toBe('ok');
}
