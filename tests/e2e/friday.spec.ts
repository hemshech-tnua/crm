// The Friday landing page (#/friday): the next Friday meeting with "שמרו לי מקום" (carrying the referral), or a calm
// empty state when nothing is open. Copy that depends on a fact the team has not confirmed (FRIDAY_FACTS) stays off the
// page while the fact is unset. Also: the home hero's button to this page, and what the success screen adds for a Friday.
import { expect, test, type Page } from '@playwright/test';
import { makeEvent, phone } from '../api/helpers';
import { FRIDAY_FACTS } from '../../src/features/public/friday/facts';
import { watchConsole } from './support';

test('shows the next Friday meeting and the CTA leads to /r/<code> with the referral', async ({ page }) => {
  await makeEvent({ title: 'מפגש שישי E2E' });
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/friday?ref=ig');

  await expect(page.getByRole('heading', { level: 1, name: 'בואו להמשיך תנועה' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'המפגש הקרוב' })).toBeVisible();
  const cta = page.getByTestId('friday-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toContainText(/שמרו לי מקום|רשימת ההמתנה/);
  await expect(cta).toHaveAttribute('href', /^#\/r\/[a-z0-9]+\?ref=ig$/);

  // phone first: the button is on the first screen
  const box = await cta.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);

  // the sections of the page, in the visitor's words
  for (const name of ['ככה נראה הבוקר', 'זה בשבילכם אם…', 'שאלות של פעם ראשונה', 'נתראה בשישי?']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByText('בלי דרגות, בלי מסדרים')).toBeVisible();
  // the closing band asks again, for the same meeting
  await expect(page.getByTestId('friday-closing-cta')).toHaveAttribute('href', (await cta.getAttribute('href'))!);

  // no flyer yet: the section is not rendered
  await expect(page.getByRole('heading', { name: 'הפלייר' })).toHaveCount(0);

  const href = await cta.getAttribute('href');
  await cta.click();
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[?]/g, '\\?')}$`));
  expect(errors).toEqual([]);
});

test('copy that depends on an unconfirmed fact stays off the page while the fact is unset', async ({ page }) => {
  await makeEvent({ title: 'שישי עובדות E2E', location: 'הולמס פלייס, מודיעין' });
  await page.goto('#/friday');
  await expect(page.getByTestId('friday-cta')).toBeVisible();
  // open every question, so hidden answers are checked too
  for (const s of await page.locator('details summary').all()) await s.click();

  const absent = async (text: string) => expect(page.getByText(text, { exact: false })).toHaveCount(0);
  if (!FRIDAY_FACTS.greeter) {
    await absent('מחכה לכם בכניסה');
    await absent('לקבל אתכם ולהכיר לכם');
    await expect(page.getByRole('heading', { name: 'מי מקבל אתכם' })).toHaveCount(0);
  }
  if (!FRIDAY_FACTS.allLevels) {
    await absent('גרסה קלה יותר');
    await absent('כל רמת כושר');
    await absent('אני לא בכושר');
  }
  if (!FRIDAY_FACTS.lateOk) await absent('מגיעים באיחור');
  if (!FRIDAY_FACTS.showers) await absent('יש איפה להחליף');
  if (!FRIDAY_FACTS.frequency) await absent('שישי בבוקר,');
  if (Object.values(FRIDAY_FACTS).every((v) => !v)) await expect(page.locator('[data-fact]')).toHaveCount(0);
  // the questions every first-timer gets, whatever the facts
  await expect(page.getByText('מגיעים לבד. זה מוזר?')).toBeVisible();
  await expect(page.getByText('צריך לספר משהו על עצמי?')).toBeVisible();
});

test('with no open Friday meeting, a calm empty state and a way to reach the team', async ({ page }) => {
  await page.route('**/rpc/public_list_events', (r) => r.fulfill({ json: [] }));
  await page.goto('#/friday');

  await expect(page.getByTestId('friday-empty')).toContainText('המפגש הבא יפורסם בקרוב');
  await expect(page.getByTestId('friday-cta')).toHaveCount(0);
  await expect(page.getByTestId('friday-closing-cta')).toHaveCount(0);
  // the program and the questions are still there
  await expect(page.getByRole('heading', { name: 'ככה נראה הבוקר' })).toBeVisible();
  await page.getByText('כמה זה עולה?').click();
  // no price is published: the page says so and how to ask, and promises nothing the registration page does not show
  await expect(page.getByText('המחיר עוד לא מופיע באתר.', { exact: false })).toBeVisible();
});

test('the home hero has a real button to the Friday page, carrying the referral', async ({ page }) => {
  await page.goto('#/?ref=ig');
  await expect(page.getByRole('heading', { level: 1, name: 'השירות נגמר. הצוות לא חייב להיגמר.' })).toBeVisible();
  const button = page.getByTestId('home-friday');
  await expect(button).toHaveText('לבוקר השישי הקרוב');
  await expect(button).toHaveAttribute('href', '#/friday?ref=ig');
  await button.click();
  await expect(page.getByRole('heading', { level: 1, name: 'בואו להמשיך תנועה' })).toBeVisible();
});

async function register(page: Page, code: string) {
  await page.goto(`#/r/${code}`);
  await page.getByLabel('שם מלא').fill('נועה בדיקת הגעה');
  await page.getByLabel('טלפון נייד').fill(phone());
  await page.getByLabel('עיר מגורים').fill('חיפה');
  await page.getByLabel('גיל').fill('29');
  await page.getByRole('radio', { name: /אינסטגרם/ }).check();
  await page.getByRole('button', { name: 'הרשמה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
}

test('after registering for a Friday meeting: how to get there and what to bring', async ({ page }) => {
  const place = 'מתנ"ס הדר, חיפה';
  const ev = await makeEvent({ title: 'שישי הגעה E2E', location: place });
  await register(page, ev.public_code);

  await expect(page.getByText(/שמרנו לך מקום\. ?נתראה ביום /)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'איך מגיעים?' })).toBeVisible();
  await expect(page.getByRole('link', { name: /ניווט ב-Waze/ })).toHaveAttribute('href', `https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes`);
  await expect(page.getByRole('link', { name: /תחבורה ציבורית/ })).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&destination=.+&travelmode=transit$/);
  await expect(page.getByText('צריכים טרמפ?')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'מה להביא' })).toBeVisible();
  await expect(page.getByText('את הקפה והנשנושים אנחנו', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'השתנו התוכניות?' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'באים ביחד?' })).toBeVisible();
  if (!FRIDAY_FACTS.reminder && !FRIDAY_FACTS.greeter) await expect(page.getByRole('heading', { name: 'מה הלאה' })).toHaveCount(0);
});

test('after registering for a meeting that is not a Friday morning: no Friday packing list', async ({ page }) => {
  const ev = await makeEvent({ title: 'מדורה הגעה E2E', type: 'bonfire', location: 'חוף הכרמל' });
  await register(page, ev.public_code);
  await expect(page.getByRole('heading', { level: 2, name: 'איך מגיעים?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'מה להביא' })).toHaveCount(0);
});
