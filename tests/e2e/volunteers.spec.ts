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

  // 1. the pool: add a volunteer who likes the entrance
  await loginAs(page, 'coord');
  await page.goto('#/app/volunteers?tab=pool');
  await page.getByRole('button', { name: 'הוספה למאגר' }).first().click();
  const add = page.getByRole('dialog');
  await add.getByLabel('שם מלא').fill(full);
  await add.getByLabel('טלפון נייד').fill(phone());
  await add.getByRole('button', { name: 'קבלת פנים' }).click();
  await add.getByRole('button', { name: 'הוספה למאגר' }).click();
  await expect(page.getByRole('table', { name: 'מאגר המתנדבים' }).getByRole('cell', { name: full, exact: true })).toBeVisible();

  // 2. the planner: the meeting's entrance is missing; two taps fill it
  await page.getByRole('tab', { name: 'שיבוץ' }).click();
  await page.getByRole('button', { name: new RegExp(`^חסר קבלת פנים ב${title},`) }).click();
  const pick = page.getByRole('dialog', { name: 'שיבוץ לקבלת פנים' });
  await pick.getByRole('searchbox', { name: 'חיפוש במאגר' }).fill(first);
  await pick.getByRole('button', { name: new RegExp(full) }).click();
  await expect(pick).toBeHidden();
  const slot = page.getByRole('button', { name: new RegExp(`${full} · קבלת פנים ב${title}`) });
  await expect(slot).toContainText('בהמתנה');

  // 3. the personal link, from the "waiting for an answer" list, ready for WhatsApp
  await page.getByRole('button', { name: `שליחת קישור ל${full}` }).click();
  const text = page.getByLabel('הטקסט (אפשר לערוך לפני השליחה)');
  await expect(text).toHaveValue(/#\/v\/[A-Za-z0-9_-]{20,}/);
  await expect(text).toHaveValue(new RegExp(`קבלת פנים · ${title}`));
  await expect(page.getByRole('link', { name: 'פתיחה בוואטסאפ' })).toHaveAttribute('href', /^https:\/\/wa\.me\/972\d+\?text=/);
  const link = (await text.inputValue()).match(/https?:\S+#\/v\/[A-Za-z0-9_-]+/)![0];
  await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click();
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
