// Participant payments, pay first (migrations 20261106002300_payments.sql and 20261106002700_pay_before_register.sql):
// a coordinator puts a price and a payment link on a new meeting; a visitor submits the form and gets the pay step (never
// "נרשמת!" before paying); the provider's webhook ("יש חשבונית", simulated here against the local edge runtime) arrives
// and the open tab turns into "נרשמת!" by itself. The coordinator sees who has not paid, confirms one payment by hand,
// attaches a payment the webhook could not match, and the finance panel follows.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { phone, staff } from '../api/helpers';
import { API_URL } from '../api/env';
import { addDays, nextFriday, todayIl } from '../../src/lib/dates';
import { loginAs, watchConsole } from './support';

const PAY_URL = 'https://pay.example.org/p/friday-e2e';
const KEY = /^YESH_WEBHOOK_KEY=(.+)$/m.exec(readFileSync(new URL('../../supabase/functions/.env', import.meta.url), 'utf8'))?.[1]?.trim() ?? '';

/** The provider's "document created" call, as its sample body. */
async function webhook(customerPhone: string, price: number) {
  const r = await fetch(`${API_URL}/functions/v1/yesh-webhook?key=${encodeURIComponent(KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Success: true, ErrorMessage: 'OK', ReturnValue: {
      docNumber: `E2E${Date.now().toString(36)}`, docType: 8, price, customerName: 'Ploni', customerPhone, date: '2026-11-19 17:35',
    } }),
  });
  return (await r.json()) as { ok: boolean; result: string };
}

test('pay first: the pay step, the webhook turns the open tab into "נרשמת!", staff confirm and attach payments', async ({ page, browser, baseURL }) => {
  expect(KEY, 'supabase/functions/.env needs YESH_WEBHOOK_KEY').not.toBe('');
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
  await page.getByRole('button', { name: 'יצירת המפגש' }).click();
  await expect(page).toHaveURL(/#\/app\/events\/[0-9a-f-]{36}/);
  const eventId = page.url().match(/events\/([0-9a-f-]{36})/)![1];

  const coord = await staff('coord');
  const { data: ev } = await coord.from('events').select('public_code, price, payment_url, status').eq('id', eventId).single();
  expect(ev).toMatchObject({ price: 20, payment_url: PAY_URL, status: 'open' });

  // ── a visitor: sees how paying works before the form, submits, and gets the pay step, not "נרשמת!" ──
  const visitor = await browser.newContext({ baseURL, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const pub = await visitor.newPage();
  const pubErrors = watchConsole(pub);
  const register = async (p: typeof pub, name: string, tel: string) => {
    await p.goto(`#/r/${ev!.public_code}`);
    await p.getByLabel('שם מלא').fill(name);
    await p.getByLabel('טלפון נייד').fill(tel);
    await p.getByLabel('עיר מגורים').fill('חיפה');
    await p.getByLabel('גיל').fill('27');
    await p.getByRole('radio', { name: /אינסטגרם/ }).check();
    await p.getByRole('button', { name: 'הרשמה', exact: true }).click();
    await expect(p.getByRole('heading', { name: 'עוד צעד אחד: תשלום' })).toBeVisible();
  };
  await pub.goto(`#/r/${ev!.public_code}`);
  await expect(pub.getByText('משלמים בהרשמה, בכרטיס אשראי, וההרשמה מאושרת מיד אחרי התשלום.')).toBeVisible();
  const noaPhone = phone();
  await register(pub, 'נועה תשלומים', noaPhone);
  await expect(pub.getByText('המקום נשמר רק אחרי התשלום. ההרשמה תושלם מיד כשהתשלום')).toBeVisible();
  await expect(pub.getByRole('heading', { name: 'נרשמת!' })).toHaveCount(0);
  await expect(pub.getByText('בכניסה למפגש')).toHaveCount(0);
  const pay = pub.getByRole('link', { name: /לתשלום/ });
  await expect(pay).toHaveAttribute('href', PAY_URL);
  await expect(pay).toHaveAttribute('target', '_blank');
  await expect(pay).toHaveAttribute('rel', /noopener/);
  await expect(pub.getByRole('button', { name: 'כבר שילמתי' })).toBeVisible();

  // the personal page of a second person shows the same pay step
  const second = await visitor.newPage();
  const secondErrors = watchConsole(second);
  await register(second, 'אורי ממתין', phone());
  await second.getByRole('link', { name: 'לעמוד ההרשמה שלי' }).click();
  await expect(second).toHaveURL(/#\/m\//);
  await expect(second.getByRole('heading', { name: 'עוד צעד אחד: תשלום' })).toBeVisible();

  // ── the provider's webhook for the first person: the open tab turns into "נרשמת!" by itself ──
  expect(await webhook(noaPhone, 20)).toEqual({ ok: true, result: 'matched' });
  await expect(pub.getByRole('heading', { name: 'נרשמת!' })).toBeVisible({ timeout: 15_000 });
  await expect(pub.getByText('התשלום התקבל. תודה!')).toBeVisible();
  await expect(pub.getByRole('button', { name: 'הוספה ליומן' })).toBeVisible();
  await expect(pub.getByRole('link', { name: /לתשלום/ })).toHaveCount(0);

  // a third person, and a payment from a phone that matches nobody
  const third = await visitor.newPage();
  await register(third, 'שירה בלי טלפון תואם', phone());
  expect((await webhook('0539' + String(Date.now()).slice(-6), 20)).result).toBe('unmatched');

  // ── the coordinator: who has not paid; confirm one by hand ──
  await page.goto(`#/app/events/${eventId}?tab=registrations`);
  await page.getByRole('button', { name: /^ממתינים לתשלום/ }).click();
  const row = page.locator('tr', { hasText: 'אורי ממתין' });
  await expect(row.getByText('ממתין לתשלום')).toBeVisible();
  await row.getByRole('button', { name: 'אישור תשלום' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('סכום ששולם (₪)')).toHaveValue('20');
  await dialog.getByLabel('אסמכתה (לא חובה)').fill('50147');
  await dialog.getByRole('button', { name: 'אישור תשלום' }).click();
  await expect(page.getByText('אורי ממתין: התשלום אושר וההרשמה הושלמה')).toBeVisible();
  // the second visitor's open personal page follows by itself
  await expect(second.getByText('התשלום התקבל. נרשמת!')).toBeVisible({ timeout: 15_000 });

  // ── the payment that matched nobody: attach it to the third person ──
  const unmatched = page.locator('section', { has: page.getByRole('heading', { name: 'תשלומים שלא זוהו' }) });
  await expect(unmatched).toBeVisible();
  const item = unmatched.getByTestId('unmatched-payment').first();
  await item.getByLabel('לשייך להרשמה').selectOption({ label: await item.locator('option', { hasText: 'שירה בלי טלפון תואם' }).innerText() });
  await item.getByRole('button', { name: 'שיוך' }).click();
  await expect(page.getByText('התשלום שויך לשירה בלי טלפון תואם וההרשמה הושלמה')).toBeVisible();
  await expect(third.getByRole('heading', { name: 'נרשמת!' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /^רשומים\s*\d/ }).click();
  for (const n of ['נועה תשלומים', 'אורי ממתין', 'שירה בלי טלפון תואם']) {
    await expect(page.locator('tr', { hasText: n }).getByText('שולם', { exact: true })).toBeVisible();
  }

  await page.getByRole('tab', { name: 'סקירה' }).click();
  const finance = page.locator('section', { has: page.getByRole('heading', { name: 'כספים' }) });
  await expect(finance.getByText('נגבה', { exact: true }).locator('..')).toContainText('60');

  const { data: regs } = await coord.from('registrations').select('status, payment_status, payment_method').eq('event_id', eventId);
  expect(regs).toHaveLength(3);
  expect(regs!.every((r) => r.status === 'registered' && r.payment_status === 'paid' && r.payment_method === 'card')).toBe(true);
  expect(errors).toEqual([]);
  expect(pubErrors).toEqual([]);
  expect(secondErrors).toEqual([]);
  await visitor.close();
});

test('a priced meeting without a link keeps today\'s flow: registered, pay at the entrance', async ({ browser, baseURL }) => {
  const coord = await staff('coord');
  const starts = new Date(Date.now() + 6 * 864e5);
  const { data: ev } = await coord.from('events').insert({
    site_id: '00000000-0000-4000-8000-000000000001', type: 'friday', title: 'שישי בתשלום במקום E2E', status: 'open', capacity: 40, price: 20,
    starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3 * 3600e3).toISOString(),
  }).select('public_code').single();
  const ctx = await browser.newContext({ baseURL, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  const errs = watchConsole(p);
  await p.goto(`#/r/${ev!.public_code}`);
  await p.getByLabel('שם מלא').fill('דנה במקום');
  await p.getByLabel('טלפון נייד').fill(phone());
  await p.getByLabel('עיר מגורים').fill('חיפה');
  await p.getByLabel('גיל').fill('31');
  await p.getByRole('radio', { name: /אינסטגרם/ }).check();
  await p.getByRole('button', { name: 'הרשמה', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
  await expect(p.getByText('משלמים בכניסה למפגש.')).toBeVisible();
  expect(errs).toEqual([]);
  await ctx.close();
});
