import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Local-Test-2026';

/** Fails the test on any console error or uncaught exception on the page. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('#/login');
  await page.getByLabel('אימייל').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: 'כניסה' }).click();
  await page.waitForURL(/#\/(app|password)/);
}

export async function loginAs(page: Page, role: 'admin' | 'coord' | 'door') {
  await login(page, `${role}@example.test`);
  // the door team has no navigation on a phone (one area only), so wait for the page heading instead
  await expect(page.locator('main h1').first()).toBeVisible();
}

export async function logout(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.goto('#/login');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'כניסת צוות' })).toBeVisible();
}
