// Participant payments: a coordinator puts a price and a payment link on a new meeting, a visitor registers and gets
// the pay button (the payment itself is on the provider's page, opened as a normal link), and the coordinator sees the
// registration as unpaid, marks it paid, and the meeting's finance panel follows.
import { expect, test } from '@playwright/test';
import { phone, staff } from '../api/helpers';
import { addDays, nextFriday, todayIl } from '../../src/lib/dates';
import { loginAs, watchConsole } from './support';

const PAY_URL = 'https://pay.example.org/p/friday-e2e';

test('a priced meeting: price and link, pay after registering, staff mark it paid, the finance panel adds up', async ({ page, browser, baseURL }) => {
  const errors = watchConsole(page);
  await loginAs(page, 'coord');

  // ── the coordinator: a new meeting with a 20 ₪ fee and the provider's payment page ──
  await page.goto('#/app/events/new');
  const title = `שישי בתשלום E2E ${Date.now().toString(36)}`;
  await page.getByLabel('כותרת').fill(title);
  await page.locator('input[type="date"]').first().fill(nextFriday(addDays(todayIl(), 15)));
  await page.getByLabel('סטטוס').selectOption('open');
  // an http link is refused before it reaches the server
  await page.getByLabel('קישור לתשלום').fill('http://pay.example.org/x');
  await page.getByRole('button', { name: 'יצירת המפגש' }).click();
  await expect(page.getByText('הקישור צריך להתחיל ב-https://')).toBeVisible();
  await expect(page.getByText('יש קישור לתשלום: צריך גם סכום.')).toBeVisible();
  await page.getByLabel('מחיר (₪)').fill('20');
  await page.getByLabel('קישור לתשלום').fill(PAY_URL);
  await page.getByLabel('הערה על התשלום').fill('אפשר לשלם גם במקום');
  await page.getByRole('button', { name: 'יצירת המפגש' }).click();
  await expect(page).toHaveURL(/#\/app\/events\/[0-9a-f-]{36}/);
  const eventId = page.url().match(/events\/([0-9a-f-]{36})/)![1];
  await expect(page.getByText('קישור לתשלום', { exact: true })).toBeVisible();

  const coord = await staff('coord');
  const { data: ev } = await coord.from('events').select('public_code, price, payment_url, status').eq('id', eventId).single();
  expect(ev).toMatchObject({ price: 20, payment_url: PAY_URL, status: 'open' });

  // ── a visitor: sees the price before the form, registers, and gets the pay button ──
  const visitor = await browser.newContext({ baseURL, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const pub = await visitor.newPage();
  const pubErrors = watchConsole(pub);
  await pub.goto(`#/r/${ev!.public_code}`);
  await expect(pub.getByText(/השתתפות:/).first()).toBeVisible();
  await expect(pub.getByText('אפשר לשלם גם במקום').first()).toBeVisible();
  const name = 'נועה תשלומים';
  await pub.getByLabel('שם מלא').fill(name);
  await pub.getByLabel('טלפון נייד').fill(phone());
  await pub.getByLabel('עיר מגורים').fill('חיפה');
  await pub.getByLabel('גיל').fill('27');
  await pub.getByRole('radio', { name: /אינסטגרם/ }).check();
  await pub.getByRole('button', { name: 'הרשמה', exact: true }).click();
  await expect(pub.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
  const pay = pub.getByRole('link', { name: /לתשלום/ });
  await expect(pay).toBeVisible();
  await expect(pay).toHaveAttribute('href', PAY_URL);
  await expect(pay).toHaveAttribute('target', '_blank');
  await expect(pay).toHaveAttribute('rel', /noopener/);
  await expect(pub.getByText('התשלום נעשה בדף המאובטח של חברת התשלום', { exact: false })).toBeVisible();
  // the personal page offers the same button while it is unpaid
  await pub.getByRole('link', { name: 'לעמוד ההרשמה שלי' }).click();
  await expect(pub.getByText('ממתין לתשלום')).toBeVisible();
  await expect(pub.getByRole('link', { name: /לתשלום/ })).toHaveAttribute('href', PAY_URL);

  // ── the coordinator: the registration is unpaid; mark it paid; the finance panel follows ──
  await page.goto(`#/app/events/${eventId}?tab=registrations`);
  await page.getByRole('button', { name: /^לא שילמו/ }).click();
  const row = page.locator('tr', { hasText: name });
  await expect(row.getByText('לא שולם')).toBeVisible();
  await row.getByRole('button', { name: 'סימון תשלום' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('סכום (₪)')).toHaveValue('20');
  await dialog.getByLabel('אמצעי תשלום').selectOption('bit');
  await dialog.getByLabel('אסמכתה (לא חובה)').fill('BIT-778');
  await dialog.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByText(`${name}: סומן ששולם`)).toBeVisible();
  await page.getByRole('button', { name: /^הכול/ }).click();
  await expect(page.locator('tr', { hasText: name }).getByText('שולם', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'סקירה' }).click();
  const finance = page.locator('section', { has: page.getByRole('heading', { name: 'כספים' }) });
  await expect(finance).toBeVisible();
  await expect(finance.getByText('נגבה', { exact: true }).locator('..')).toContainText('20');
  await expect(finance.getByText('ממתין לתשלום', { exact: true }).locator('..')).toContainText('0 רשומים');

  // and the visitor's page says thank you
  await pub.reload();
  await expect(pub.getByText('שולם, תודה')).toBeVisible();
  await expect(pub.getByRole('link', { name: /לתשלום/ })).toHaveCount(0);

  const { data: reg } = await coord.from('registrations').select('payment_status, paid_amount, payment_method, payment_ref').eq('event_id', eventId).single();
  expect(reg).toEqual({ payment_status: 'paid', paid_amount: 20, payment_method: 'bit', payment_ref: 'BIT-778' });
  expect(errors).toEqual([]);
  expect(pubErrors).toEqual([]);
  await visitor.close();
});
