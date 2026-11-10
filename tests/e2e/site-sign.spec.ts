// The permanent entrance sign: one QR for every meeting at a site.
import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mailedCode, makeEvent, staff } from '../api/helpers';
import { API_URL, DB_URL } from '../api/env';
import { watchConsole } from './support';

test('@phone the permanent sign leads to the meeting open now, and says when the next one opens', async ({ page }) => {
  const errors = watchConsole(page);
  const admin = await staff('admin');
  const { data: site } = await admin.from('sites').insert({ name: `מתחם שלט ${Date.now().toString(36)}` }).select('id, checkin_code').single();

  const next = await makeEvent({ site_id: site!.id, title: 'המפגש הבא (בדיקה)', startsInMinutes: 6 * 60 });
  await page.goto(`#/s/${site!.checkin_code}`);
  await expect(page.getByRole('heading', { name: 'כרגע אין מפגש פתוח לצ׳ק־אין' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'להרשמה למפגש' })).toHaveAttribute('href', new RegExp(`#/r/${next.public_code}$`));

  const now = await makeEvent({ site_id: site!.id, title: 'מפגש עכשיו (בדיקה)', startsInMinutes: 20 });
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#/c/${now.checkin_code}$`));
  await expect(page.getByLabel('מספר הטלפון שלך')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('staff sign in with a code sent by SMS, without a password', async ({ page }) => {
  const errors = watchConsole(page);
  const admin = await staff('admin');
  const token = (await admin.auth.getSession()).data.session!.access_token;
  execSync(`psql "${DB_URL}" -qc "delete from auth.users where phone = '972500000903'"`);
  const res = await fetch(`${API_URL}/functions/v1/staff-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'create', full_name: 'צוות כניסה בקוד', phone: '0500000903', role: 'volunteer' }),
  });
  expect(res.status).toBe(200);

  await page.goto('#/login');
  await page.getByRole('button', { name: 'כניסה עם קוד בטלפון (SMS)' }).click();
  await page.getByLabel('מספר הטלפון הנייד שלך').fill('050-000-0903');
  await page.getByRole('button', { name: 'שליחת קוד ב-SMS' }).click();
  await expect(page.getByText(/רשום בצוות, נשלח אליו עכשיו קוד/)).toBeVisible();
  await page.getByLabel('הקוד מה-SMS').fill('000000');
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('הקוד לא נכון');
  await page.getByLabel('הקוד מה-SMS').fill('246810');
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page).toHaveURL(/#\/app\/door/);
  // the wrong code is answered with 403, which the browser logs; nothing else may fail
  const real = errors.filter((e) => !/status of 403/.test(e));
  expect(real, real.join('\n')).toEqual([]);
});

test('staff sign in with a code sent by email (the default on the login page)', async ({ page }) => {
  const errors = watchConsole(page);
  const admin = await staff('admin');
  const token = (await admin.auth.getSession()).data.session!.access_token;
  const email = `e2e-code-${Date.now()}@example.test`;
  const res = await fetch(`${API_URL}/functions/v1/staff-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'create', full_name: 'רכזת בקוד מייל', email, role: 'coordinator' }),
  });
  expect(res.status).toBe(200);

  await page.goto('#/login');
  await page.getByLabel('כתובת האימייל שלך').fill(email);
  await page.getByRole('button', { name: 'שליחת קוד למייל' }).click();
  await expect(page.getByText(/רשומה בצוות, נשלח אליה עכשיו קוד/)).toBeVisible();
  const code = await mailedCode(email);
  await page.getByLabel('הקוד מהמייל').fill(code!);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page).toHaveURL(/#\/app\/dashboard/);
  expect(errors, errors.join('\n')).toEqual([]);
});
