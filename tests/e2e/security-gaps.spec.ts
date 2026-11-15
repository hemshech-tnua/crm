// Security spec follow-up: two-step sign-in from the account page, the sign-in code step, the admin security tab,
// and the clickjacking guard (the app refuses to run inside a frame).
import { expect, test } from '@playwright/test';
import { API_URL } from '../api/env';
import { phone, staff, totp } from '../api/helpers';
import { login, loginAs, logout, watchConsole } from './support';

async function post(body: unknown, token?: string, query = '') {
  const r = await fetch(`${API_URL}/functions/v1/staff-admin${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  return r.json();
}

/** Waits for the next 30-second TOTP window, so a code is never reused. */
const nextWindow = (page: import('@playwright/test').Page) => page.waitForTimeout(30_000 - (Date.now() % 30_000) + 1_000);

test('a coordinator turns on two-step sign-in, and the next sign-in asks for the code', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchConsole(page);
  const admin = (await (await staff('admin')).auth.getSession()).data.session!.access_token;
  const p = phone();
  const created = await post({ action: 'create', full_name: 'רכזת שני שלבים', phone: p, role: 'coordinator' }, admin);
  const temp = (await post({ action: 'reset_password', user_id: created.user_id }, admin)).temp_password;
  const s = await post({ phone: p, password: temp }, undefined, '?login=1');
  const own = `Two-Step-${Date.now()}`;
  await post({ action: 'change_password', new_password: own }, s.access_token);

  await login(page, p, own);
  await page.goto('#/app/settings?tab=account');
  await page.getByRole('button', { name: 'הפעלת אימות דו־שלבי' }).click();
  await expect(page.getByRole('img', { name: 'ברקוד להוספת המשתמש לאפליקציית האימות' })).toBeVisible();
  const secret = (await page.locator('span.select-all').innerText()).trim();
  await page.getByLabel('קוד מהאפליקציה').fill(totp(secret));
  await page.getByRole('button', { name: 'הפעלה', exact: true }).click();
  await expect(page.getByText('פעיל', { exact: true })).toBeVisible();

  // sign in again: password, then the code
  await logout(page);
  await login(page, p, own);
  await expect(page.getByRole('heading', { name: 'אימות דו־שלבי' })).toBeVisible();
  await page.getByLabel('קוד אימות').fill('123456');
  await page.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText('הקוד לא נכון או שפג תוקפו', { exact: false })).toBeVisible();
  await nextWindow(page);
  await page.getByLabel('קוד אימות').fill(totp(secret));
  await page.getByRole('button', { name: 'אישור' }).click();
  await expect(page.locator('main h1').first()).toContainText('רכזת');
  // the GoTrue refusal of the wrong code is logged by the browser as a failed request, not an app error
  expect(errors.filter((e) => !/status of 4\d\d/.test(e)), errors.join('\n')).toEqual([]);
});

test('admins see the security tab: accounts, lockouts, two-step status, recent permission changes', async ({ page }) => {
  const errors = watchConsole(page);
  await loginAs(page, 'admin');
  await page.goto('#/app/settings?tab=security');
  await expect(page.getByRole('heading', { name: 'חסימות ב־24 השעות האחרונות' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'אימות דו־שלבי לאנשי הצוות' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'שינויים בהרשאות, 30 הימים האחרונים' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('inside someone else\'s frame the app does not run, it only offers to open itself', async ({ page, baseURL }) => {
  await page.setContent(`<iframe src="${baseURL}#/login" style="width:900px;height:600px"></iframe>`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'האתר נפתח בתוך אתר אחר' })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'כניסת צוות' })).toHaveCount(0);
});
