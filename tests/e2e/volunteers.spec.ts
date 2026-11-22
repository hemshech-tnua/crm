// Itai's wish: book volunteers as far ahead as possible, the way coaches are booked. A coordinator adds a volunteer,
// fills a gap ("חסר") in the planner, sends the personal link; the volunteer confirms from their phone and the
// planner shows it. Migration 20261106002200_event_prep.sql.
import { devices, expect, test } from '@playwright/test';
import { makeEvent, name, phone } from '../api/helpers';
import { loginAs, watchConsole } from './support';

test('a coordinator books a volunteer ahead, the volunteer confirms from the personal link', async ({ page, browser }) => {
  const errors = watchConsole(page);
  const title = `עוגן שישי ${Date.now().toString(36).replace(/\d/g, '')}`;
  await makeEvent({ title, startsInMinutes: 10 * 24 * 60 });
  const full = name();
  const first = full.split(' ')[0];

  // 1. the list of volunteers: a new volunteer who likes the entrance
  await loginAs(page, 'coord');
  await page.goto('#/app/volunteers?tab=pool');
  await expect(page.getByRole('tab', { name: 'רשימת מתנדבים' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'מתנדב חדש' }).first().click();
  const add = page.getByRole('dialog', { name: 'מתנדב חדש' });
  await add.getByLabel('שם מלא').fill(full);
  const tel = phone();
  await add.getByLabel('טלפון נייד').fill(tel);
  await add.getByRole('button', { name: 'קבלת פנים' }).click();
  await add.getByRole('button', { name: 'הוספה לרשימה' }).click();
  const table = page.getByRole('table', { name: 'רשימת המתנדבים' });
  await expect(table.getByRole('cell', { name: full, exact: true })).toBeVisible();
  // found by a full number in another format, and by its last 4 digits
  const search = page.getByRole('searchbox', { name: 'חיפוש מתנדבים' });
  await search.fill(`+972 ${tel.slice(1, 3)}-${tel.slice(3)}`);
  await expect(table.getByRole('cell', { name: full, exact: true })).toBeVisible();
  await search.fill(tel.slice(-4));
  await expect(table.getByRole('cell', { name: full, exact: true })).toBeVisible();
  await search.fill('');

  // 2. the planner: the meeting's entrance is an empty place ("+ שיבוץ"); two taps fill it, and the dialog moves on
  //    to the meeting's next empty role, so the whole meeting is booked without reopening it
  await page.getByRole('tab', { name: 'שיבוץ למפגשים' }).click();
  await page.getByRole('button', { name: new RegExp(`^שיבוץ לקבלת פנים ב${title},`) }).click();
  const pick = page.getByRole('dialog', { name: 'שיבוץ לקבלת פנים' });
  await pick.getByRole('searchbox', { name: 'חיפוש מתנדבים' }).fill(first);
  await pick.getByRole('button', { name: new RegExp(full) }).click();
  const more = page.getByRole('dialog', { name: 'שיבוץ להקמה' });
  await expect(more.getByRole('status')).toContainText(`${full}: קבלת פנים`);
  await expect(more.getByRole('group', { name: 'תפקיד במפגש' }).getByRole('button', { name: /^הקמה/ })).toHaveAttribute('aria-pressed', 'true');
  await more.getByRole('button', { name: 'סיום', exact: true }).click();
  await expect(more).toBeHidden();
  const slot = page.getByRole('button', { name: new RegExp(`${full} · קבלת פנים ב${title}`) });
  await expect(slot).toContainText('בהמתנה');

  // 3. the personal link, from the "waiting for an answer" list, ready for WhatsApp
  await page.getByRole('button', { name: new RegExp(`^${full} \\d+: שליחת קישור אישי$`) }).click();
  const text = page.getByLabel('הטקסט (אפשר לערוך לפני השליחה)');
  await expect(text).toHaveValue(/#\/v\/[A-Za-z0-9_-]{20,}/);
  await expect(text).toHaveValue(new RegExp(`קבלת פנים · ${title}`));
  await expect(page.getByRole('link', { name: 'פתיחה בוואטסאפ' })).toHaveAttribute('href', /^https:\/\/wa\.me\/972\d+\?text=/);
  const link = (await text.inputValue()).match(/https?:\S+#\/v\/[A-Za-z0-9_-]+/)![0];
  await page.getByRole('dialog').getByRole('button', { name: 'סגירת החלון' }).click();
  expect(errors, errors.join('\n')).toEqual([]);

  // 4. the volunteer's phone: sees the shift and confirms
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const mine = await phoneCtx.newPage();
  const mineErrors = watchConsole(mine);
  await mine.goto(link);
  await expect(mine.getByRole('heading', { name: `היי ${first}` })).toBeVisible();
  const card = mine.getByRole('article', { name: title });
  await expect(card).toContainText('התפקיד: קבלת פנים');
  await expect(card).toContainText('מחכים לתשובה שלך');
  await card.getByRole('button', { name: 'כן, אגיע' }).click();
  await expect(card).toContainText('אישרת הגעה');
  await expect(card.getByRole('button', { name: 'כן, אגיע' })).toHaveAttribute('aria-pressed', 'true');
  expect(mineErrors, mineErrors.join('\n')).toEqual([]);
  await phoneCtx.close();

  // 5. back in the planner: confirmed
  await page.reload();
  await expect(page.getByRole('button', { name: new RegExp(`${full} · קבלת פנים ב${title}`) })).toContainText('הגעה אושרה');
  expect(errors, errors.join('\n')).toEqual([]);
});
