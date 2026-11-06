// Scenario 1 (new user: create, sign in, dashboard, permissions) and scenario 7 (security in the browser).
import { expect, test } from '@playwright/test';
import { login, loginAs, logout, watchConsole } from './support';

test.describe('scenario 1: a new staff user', () => {
  test('admin creates a coordinator, who must choose a password and then sees only what a coordinator may', async ({ page }) => {
    const errors = watchConsole(page);
    await loginAs(page, 'admin');
    await page.goto('#/app/settings?tab=users');
    await page.getByRole('button', { name: 'משתמש חדש' }).click();
    const stamp = Date.now();
    const email = `e2e-${stamp}@example.test`;
    const fullName = `רכזת בדיקה ${String(stamp).slice(-4).replace(/\d/g, (d) => 'אבגדהוזחטי'[Number(d)])}`;
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('שם מלא').fill(fullName);
    await dialog.getByLabel('אימייל (שם המשתמש לכניסה)').fill(email);
    await dialog.getByRole('radio', { name: /^רכז\/ת/ }).check();
    await dialog.getByRole('button', { name: 'יצירת המשתמש' }).click();

    const secret = page.getByRole('dialog', { name: 'סיסמה זמנית' });
    await expect(secret).toBeVisible();
    const temp = (await secret.locator('.font-display').innerText()).trim();
    expect(temp).toMatch(/^[A-Za-z0-9]{14}$/);
    await secret.getByRole('button', { name: 'סגירה' }).first().click();
    const row = page.getByRole('listitem').filter({ hasText: fullName });
    await expect(row).toBeVisible();
    await expect(row.getByText('ממתין לבחירת סיסמה')).toBeVisible();

    // the new user signs in with the temporary password and must replace it
    await logout(page);
    await login(page, email, temp);
    await expect(page).toHaveURL(/#\/password/);
    await expect(page.getByText('נכנסת עם סיסמה זמנית')).toBeVisible();
    // going around the password page is not possible
    await page.goto('#/app/dashboard');
    await expect(page).toHaveURL(/#\/password/);
    await page.getByLabel('סיסמה חדשה').fill('Boker-Tov-Modiin-7');
    await page.getByLabel('שוב, לאימות').fill('Boker-Tov-Modiin-7');
    await page.getByRole('button', { name: 'שמירת הסיסמה' }).click();
    await expect(page).toHaveURL(/#\/app\/dashboard/);
    await expect(page.getByRole('heading', { name: 'היעדים לשנה' })).toBeVisible();

    // coordinator: no users/privacy/audit tabs, settings shows only links + account
    await page.goto('#/app/settings?tab=users');
    await expect(page.getByRole('tab', { name: 'משתמשים' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'יומן פעולות' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'קישורי הרשמה' })).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('scenario 7: security in the browser', () => {
  test('without signing in, staff pages send you to the login', async ({ page }) => {
    for (const path of ['#/app', '#/app/dashboard', '#/app/participants', '#/app/settings?tab=audit', '#/app/reports']) {
      await page.goto(path);
      await expect(page).toHaveURL(/#\/login/);
    }
  });

  test('the door team cannot open manager screens, even by typing the address', async ({ page }) => {
    await loginAs(page, 'door');
    await expect(page).toHaveURL(/#\/app\/door/);
    for (const path of ['#/app/dashboard', '#/app/participants', '#/app/reports', '#/app/settings', '#/app/followups']) {
      await page.goto(path);
      await expect(page).toHaveURL(/#\/app\/door/);
    }
  });

  test('wrong password gives one message that does not reveal whether the account exists', async ({ page }) => {
    await page.goto('#/login');
    await page.getByLabel('אימייל').fill('admin@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('wrong-password-1');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page.getByRole('alert')).toHaveText('האימייל או הסיסמה לא נכונים.');
    await page.getByLabel('אימייל').fill('nobody@example.test');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page.getByRole('alert')).toHaveText('האימייל או הסיסמה לא נכונים.');
  });

  test('the production build ships a strict Content-Security-Policy and no inline scripts', async ({ page, request }) => {
    test.skip(!!process.env.E2E_BASE_URL, 'needs the production build (vite build + preview)');
    const html = await (await request.get('/')).text();
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    // and the app actually runs under it
    const errors = watchConsole(page);
    await page.goto('#/');
    await expect(page.getByRole('link', { name: 'כניסת צוות' })).toBeVisible();
    expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
  });

  test('a coordinator does not see admin-only actions', async ({ page }) => {
    await loginAs(page, 'coord');
    await page.goto('#/app/settings');
    await expect(page.getByRole('tab', { name: 'פרטיות' })).toHaveCount(0);
    await page.goto('#/app/participants');
    await expect(page.getByRole('button', { name: /ייצוא/ })).toHaveCount(0);
  });
});
