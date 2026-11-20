// The meeting screens: the dashboard's next meeting, the events list filters, the meeting page's stage-aware actions
// and status strip, closing from the summary, and the payment link on the edit form.
import { expect, test } from '@playwright/test';
import { makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

test('the dashboard shows the meeting running today, not "אין מפגש קרוב"', async ({ page }) => {
  const errors = watchConsole(page);
  // the bug: upcoming meetings came from "the last 120 days, oldest first", which the API caps at 1000 rows
  await makeEvent({ title: `היום E2E ${Date.now().toString(36)}`, startsInMinutes: -10 });
  await loginAs(page, 'coord');
  await page.goto('#/app/dashboard');
  await expect(page.getByRole('region', { name: 'המפגש הבא' })).toBeVisible();
  await expect(page.getByText('אין מפגש קרוב בלוח')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'היעדים לשנה' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'דורש תשומת לב' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('events list: search, type and status filters come from the URL; "לא נסגרו" opens under קודמים', async ({ page }) => {
  const errors = watchConsole(page);
  const tag = Date.now().toString(36);
  const over = await makeEvent({ title: `לא נסגר E2E ${tag}`, startsInMinutes: -300 });
  const draft = await makeEvent({ title: `טיוטה E2E ${tag}`, status: 'draft', startsInMinutes: 3 * 24 * 60 });
  await loginAs(page, 'coord');

  await page.goto(`#/app/events?show=past&status=unclosed&q=${encodeURIComponent(tag)}`);
  await expect(page.getByRole('tab', { name: /קודמים/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /לא נסגרו/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: `לא נסגר E2E ${tag}` }).first()).toBeVisible();

  await page.goto('#/app/events?status=draft');
  await page.getByRole('searchbox', { name: 'חיפוש מפגש' }).fill(`טיוטה E2E ${tag}`);
  await expect(page.getByRole('link', { name: `טיוטה E2E ${tag}` }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'חיפוש מפגש' }).fill(`אין כזה ${tag}`);
  await expect(page.getByText('אין תוצאות לחיפוש הזה')).toBeVisible();
  await page.getByRole('button', { name: 'ניקוי החיפוש והסינון' }).click();
  await expect(page.getByRole('button', { name: /^הכול/ })).toHaveAttribute('aria-pressed', 'true');
  expect([over.id, draft.id].length).toBe(2);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('meeting page: the primary action follows the stage, the rest is under "עוד", and the strip links to tabs', async ({ page }) => {
  const errors = watchConsole(page);
  const draft = await makeEvent({ title: `שלבים E2E ${Date.now().toString(36)}`, status: 'draft', startsInMinutes: 5 * 24 * 60 });
  await loginAs(page, 'coord');
  await page.goto(`#/app/events/${draft.id}`);
  // a draft: what is missing, and opening registration
  await expect(page.getByRole('heading', { name: 'מה חסר כדי לפתוח הרשמה' })).toBeVisible();
  await page.getByRole('button', { name: 'פתיחת הרשמה' }).first().click();
  const ask = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'פתיחת הרשמה' }) });
  if (await ask.isVisible().catch(() => false)) await ask.getByRole('button', { name: 'פתיחת הרשמה' }).click();
  // open and days away: sharing the link is the next step; cancelling sits in the menu
  await expect(page.getByRole('button', { name: 'העתקת קישור ההרשמה' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ביטול המפגש' })).toHaveCount(0);
  await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'ביטול המפגש' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'סגירת הרשמה' })).toBeVisible();
  await page.keyboard.press('Escape');
  // the strip: one count definition, and a click opens the tab
  const strip = page.getByRole('list', { name: 'מצב המפגש' });
  await expect(strip).toContainText('0 רשומים · 0 מתוך 40');
  await strip.getByRole('button', { name: /רשומים/ }).click();
  await expect(page).toHaveURL(/tab=registrations/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a meeting that ended unclosed: ?close=1 asks to close it, and the summary leads with closing', async ({ page }) => {
  const errors = watchConsole(page);
  const ev = await makeEvent({ title: `סגירה E2E ${Date.now().toString(36)}`, startsInMinutes: 60 });
  const coord = await staff('coord');
  // registered ahead (as the office would), then the meeting is over and nobody checked in
  const { data: p } = await coord.from('participants').insert({ full_name: name(), phone: phone() }).select('id').single();
  await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });
  await coord.from('events').update({ starts_at: new Date(Date.now() - 200 * 60_000).toISOString(), ends_at: new Date(Date.now() - 50 * 60_000).toISOString() }).eq('id', ev.id);

  await loginAs(page, 'coord');
  await page.goto(`#/app/events/${ev.id}?close=1`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'סגירת המפגש' })).toBeVisible();
  await expect(dialog).toContainText('עוד לא סומנה אף הגעה');
  await dialog.getByRole('button', { name: 'חזרה' }).click();

  await page.goto(`#/app/events/${ev.id}?tab=summary`);
  const card = page.getByRole('region', { name: 'סגירת המפגש' });
  await expect(card).toContainText('עוד לא סומנה אף הגעה');
  await card.getByRole('button', { name: 'סגירת המפגש' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'סגירת המפגש' }).click();
  await expect(page.getByRole('dialog', { name: 'המפגש נסגר' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'המפגש נסגר' }).getByRole('link', { name: 'למשימות המעקב של המפגש' })).toHaveAttribute('href', new RegExp(`followups\\?event=${ev.id}`));
  expect(errors, errors.join('\n')).toEqual([]);
});

test('edit form: a payment link typed without https:// gets it', async ({ page }) => {
  const errors = watchConsole(page);
  const ev = await makeEvent({ title: `קישור E2E ${Date.now().toString(36)}`, status: 'draft', startsInMinutes: 6 * 24 * 60 });
  await loginAs(page, 'coord');
  await page.goto(`#/app/events/${ev.id}/edit`);
  await page.getByLabel('מחיר (₪)').fill('20');
  await page.getByLabel('קישור לתשלום').fill('pay.example.org/e2e');
  await page.getByLabel('הערה על התשלום').click();
  await expect(page.getByLabel('קישור לתשלום')).toHaveValue('https://pay.example.org/e2e');
  await page.getByRole('button', { name: 'שמירת השינויים' }).click();
  await expect(page).toHaveURL(new RegExp(`#/app/events/${ev.id}$`));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const coord = await staff('coord');
  const { data } = await coord.from('events').select('payment_url').eq('id', ev.id).single();
  expect(data!.payment_url).toBe('https://pay.example.org/e2e');
  expect(errors, errors.join('\n')).toEqual([]);
});
