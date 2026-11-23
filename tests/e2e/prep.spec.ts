// Event preparation (Itai's checklist): a coordinator creates a Friday meeting about three weeks out, works its prep
// tab (a task, an equipment item, a payment), then finds the work in "השבוע שלי" and the standing template.
import { expect, test } from '@playwright/test';
import { staff } from '../api/helpers';
import { addDays, nextFriday, todayIl } from '../../src/lib/dates';
import { loginAs, watchConsole } from './support';

const weekStartOf = (day: string) => addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay());

test('a coordinator prepares a Friday meeting: checklist, equipment, payment, the week and the template', async ({ page }) => {
  const errors = watchConsole(page);
  await loginAs(page, 'coord');

  // a Friday meeting about three weeks out
  await page.goto('#/app/events/new');
  const title = `הכנות E2E ${Date.now().toString(36)}`;
  const date = nextFriday(addDays(todayIl(), 21));
  await page.getByLabel('כותרת').fill(title);
  await page.locator('input[type="date"]').first().fill(date);
  await page.getByLabel('נושא ההרצאה').fill('לנשום בחזרה לשגרה');
  await page.getByRole('button', { name: 'יצירת המפגש' }).click();
  await expect(page).toHaveURL(/#\/app\/events\/[0-9a-f-]{36}/);
  const eventId = page.url().match(/events\/([0-9a-f-]{36})/)![1];

  // the prep tab has the Friday checklist
  await page.getByRole('tab', { name: 'הכנות' }).click();
  await expect(page).toHaveURL(/tab=prep/);
  const speakerTask = page.getByRole('checkbox', { name: /^סגירת מרצה ונושא/ });
  await expect(speakerTask).toBeVisible();
  await expect(page.getByText('מתוך 17 משימות')).toBeVisible();
  const readiness = page.getByRole('progressbar', { name: 'מוכנות המפגש' });
  await expect(readiness).toHaveAttribute('aria-valuenow', '0');

  // one tap ticks a task, and readiness rises
  await speakerTask.click();
  await expect(speakerTask).toHaveAttribute('aria-checked', 'true');
  await expect(readiness).toHaveAttribute('aria-valuenow', '6'); // 1 of 17
  const coord = await staff('coord');
  await expect.poll(async () => {
    const { data } = await coord.from('event_tasks').select('done_at').eq('event_id', eventId).like('title', 'סגירת מרצה ונושא%').single();
    return !!data?.done_at;
  }).toBe(true);

  // the equipment checklist
  const cable = page.getByRole('checkbox', { name: 'ארוז: כבל מאריך ומפצל' });
  await cable.click();
  await expect(cable).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/^1 מתוך \d+ ארוזים$/)).toBeVisible();

  // a payment, then "paid today"
  await page.getByRole('button', { name: 'הוספת תשלום' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('למי משלמים').fill('קייטרינג E2E');
  await dialog.getByLabel('עבור מה').fill('ארוחת בוקר ל-30');
  await dialog.getByLabel('סכום (₪)').fill('1200');
  await dialog.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('נותר לשלם')).toBeVisible();
  await page.getByRole('button', { name: 'שולם היום: קייטרינג E2E' }).click();
  await expect(page.getByText('נותר לשלם')).toBeHidden();
  await expect.poll(async () => {
    const { data } = await coord.from('event_payments').select('amount, paid_on').eq('event_id', eventId).single();
    return data && [Number(data.amount), data.paid_on];
  }).toEqual([1200, todayIl()]);

  // "השבוע שלי": the week that has the next open task of this meeting (or the list of what was left open)
  const { data: next } = await coord.from('event_tasks').select('title, due_date').eq('event_id', eventId).eq('kind', 'task')
    .is('done_at', null).order('due_date').order('sort_order').limit(1).single();
  await page.goto('#/app/prep');
  await expect(page.getByRole('tab', { name: 'השבוע שלי' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('list', { name: 'ימי השבוע' })).toBeVisible();
  // "השבוע שלי" is mine by default (my tasks and the team's with no one in charge: the template's tasks are those)
  await expect(page.getByRole('group', { name: 'של מי המשימות' }).getByRole('button', { name: 'שלי' })).toHaveAttribute('aria-pressed', 'true');
  const today = todayIl();
  if (next!.due_date < today) {
    await expect(page.getByRole('button', { name: /^מהימים הקודמים/ })).toBeVisible();
  } else {
    const weeks = Math.round((new Date(weekStartOf(next!.due_date)).getTime() - new Date(weekStartOf(today)).getTime()) / (7 * 864e5));
    for (let i = 0; i < weeks; i++) await page.getByRole('button', { name: 'השבוע הבא' }).click();
    const [, m, d] = next!.due_date.split('-').map(Number);
    const day = page.locator(`li[aria-label$=" ${d}.${m}"]`);
    const row = day.locator('li').filter({ has: page.getByRole('link', { name: new RegExp(title) }) }).filter({ has: page.getByRole('checkbox', { name: next!.title }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('checkbox', { name: next!.title })).toHaveAttribute('aria-checked', 'false');
  }

  // the standing template
  await page.getByRole('tab', { name: 'תבנית' }).click();
  await expect(page.getByText('שינוי בתבנית חל על מפגשים חדשים', { exact: false })).toBeVisible();
  await expect(page.getByText(/^סגירת מרצה ונושא/)).toBeVisible();
  await expect(page.getByText('לכל סוגי המפגשים').first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
