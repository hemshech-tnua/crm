// People & admin: finding a person and acting on them (search any phone format, whole-row open, prefilled new card,
// merge from the card), and the admin screens (promotion to "ניהול" asks first, the audit log reads as sentences).
import { expect, test } from '@playwright/test';
import { e164, makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

const local = (p: string) => p.replace(/\D/g, '');

test('a full phone number in any format finds the card, and the whole row opens it', async ({ page }) => {
  const errors = watchConsole(page);
  const coord = await staff('coord');
  const who = { n: name(), p: phone() };
  await coord.from('participants').insert({ full_name: who.n, phone: who.p });
  await loginAs(page, 'coord');
  await page.goto('#/app/participants');
  const d = local(who.p); // 05XXXXXXXX
  await page.getByRole('searchbox').first().fill(`+972 ${d.slice(1, 3)}-${d.slice(3)}`);
  const row = page.getByRole('row').filter({ hasText: who.n });
  await expect(row).toBeVisible();
  await row.getByRole('cell').nth(2).click(); // not the name link: the row itself
  await expect(page.getByRole('heading', { level: 1, name: who.n })).toBeVisible();
  // the card: one place per action, merge and erase behind "עוד"
  await expect(page.getByRole('button', { name: 'תיעוד שיחה' })).toHaveCount(1);
  await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'מיזוג עם כרטיס אחר' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'מחיקת פרטים אישיים' })).toHaveCount(0); // coordinators: not offered
  expect(errors.filter((e) => !/status of 4\d\d|Failed to load resource/.test(e)), errors.join('\n')).toEqual([]);
});

test('"לא הגיעו מעל חודשיים" and the longest-gone sort are one tap away', async ({ page }) => {
  await loginAs(page, 'coord');
  await page.goto('#/app/participants');
  await page.getByRole('button', { name: /^לא הגיעו מעל חודשיים/ }).click();
  await expect(page).toHaveURL(/gone=1/);
  await page.getByRole('combobox', { name: 'מיון' }).selectOption('longest');
  await expect(page).toHaveURL(/sort=longest/);
});

test('a new card opened from a meeting is prefilled and returns to the meeting', async ({ page }) => {
  const ev = await makeEvent({ title: `הוספה ידנית ${Date.now().toString(36)}`, startsInMinutes: 60 * 24 });
  const who = { n: name(), p: phone() };
  await loginAs(page, 'coord');
  await page.goto(`#/app/participants/new?event=${ev.id}&name=${encodeURIComponent(who.n)}&phone=${who.p}`);
  await expect(page.getByLabel('שם מלא')).toHaveValue(who.n);
  await expect(page.getByLabel('טלפון')).toHaveValue(who.p);
  await expect(page.getByRole('combobox', { name: 'מפגש' })).toHaveValue(ev.id);
  await page.getByRole('button', { name: 'יצירת הכרטיס והרשמה למפגש' }).click();
  await expect(page).toHaveURL(new RegExp(`#/app/events/${ev.id}\\?tab=registrations`));
  const coord = await staff('coord');
  const { data: p } = await coord.from('participants').select('id').eq('phone', e164(who.p)).single();
  const { data: regs } = await coord.from('registrations').select('event_id').eq('participant_id', p!.id);
  expect(regs!.map((r) => r.event_id)).toContain(ev.id);
});

test('merging from the card names the phone that goes, and keeps the history on the chosen card', async ({ page }) => {
  const coord = await staff('coord');
  const base = name();
  const a = { n: base, p: phone() };
  const b = { n: base, p: phone() };
  const { data: ka } = await coord.from('participants').insert({ full_name: a.n, phone: a.p }).select('id').single();
  const { data: kb } = await coord.from('participants').insert({ full_name: b.n, phone: b.p }).select('id').single();
  await loginAs(page, 'coord');
  await page.goto(`#/app/participants/${ka!.id}`);
  await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await page.getByRole('menuitem', { name: 'מיזוג עם כרטיס אחר' }).click();
  const dialog = page.getByRole('dialog', { name: 'מיזוג עם כרטיס אחר' });
  await dialog.getByRole('searchbox').fill(local(b.p));
  await dialog.getByRole('button', { name: new RegExp(base) }).first().click();
  // this card stays by default; the other card's phone is named before anything happens
  const bPhone = `${local(b.p).slice(0, 3)}-${local(b.p).slice(3, 6)}-${local(b.p).slice(6)}`;
  await expect(dialog).toContainText(bPhone);
  await dialog.getByRole('button', { name: 'מיזוג הכרטיסים' }).click();
  await expect(dialog).toBeHidden();
  const admin = await staff('admin');
  expect((await admin.from('participants').select('id').eq('id', kb!.id).maybeSingle()).data).toBeNull();
  expect((await admin.from('participants').select('id').eq('id', ka!.id).maybeSingle()).data).not.toBeNull();
});

test('giving "ניהול" asks first; going back changes nothing', async ({ page }) => {
  const errors = watchConsole(page);
  await loginAs(page, 'admin');
  await page.goto('#/app/settings?tab=users');
  await page.getByRole('searchbox', { name: 'חיפוש אנשי צוות' }).fill('coord@example.test');
  const role = page.getByRole('combobox', { name: 'תפקיד של בדיקה רכז' });
  await expect(role).toHaveValue('coordinator');
  await role.selectOption('admin');
  const ask = page.getByRole('dialog', { name: /הרשאת ניהול\?$/ });
  await expect(ask).toContainText('מחיקת פרטים אישיים');
  await ask.getByRole('button', { name: 'חזרה' }).click();
  await expect(ask).toBeHidden();
  await expect(role).toHaveValue('coordinator');
  const coord = await staff('admin');
  const { data } = await coord.from('staff').select('role').eq('email', 'coord@example.test').single();
  expect(data!.role).toBe('coordinator');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the audit log reads as sentences, with the raw record one tap away', async ({ page }) => {
  const coord = await staff('coord');
  await coord.from('participants').insert({ full_name: name(), phone: phone() });
  await loginAs(page, 'admin');
  await page.goto('#/app/settings?tab=audit');
  await expect(page.getByRole('button', { name: 'יומן פעולות', pressed: true })).toBeVisible();
  const log = page.getByTestId('audit-log');
  await expect(log.getByText(/^כרטיס נוצר/).first()).toBeVisible();
  await expect(log.getByText('פרטים טכניים').first()).toBeVisible();
  await expect(log.getByText(/"created_via"/).first()).toBeHidden(); // the raw record stays inside the closed "פרטים טכניים"
});
