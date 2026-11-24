// Participant payments, pay first (migrations 20261106002300_payments.sql and 20261106002700_pay_before_register.sql):
// a coordinator puts a price and a payment link on a new meeting; a visitor's submit button is the pay button: it saves a
// registration that waits for the payment and goes straight on to the provider's page (stood in for here); the provider's
// webhook ("יש חשבונית", simulated against the local edge runtime) confirms it, and back on the site it is "נרשמת!".
// (20261106002800_pay_guarantee.sql: no confirmed place without payment, by any path.) The coordinator sees who has not paid, confirms one payment by hand,
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

test('pay first: the submit button opens the payment, the webhook confirms, staff confirm and attach payments', async ({ page, browser, baseURL }) => {
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
  await expect(page.getByText('הקישור צריך להתחיל ב־https://')).toBeVisible();
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
  // the provider's payment page, stood in for: the visitor leaves the site for it in the same tab. One phone per person
  // (a browser context each), as the registration is remembered on the phone.
  const provider = '<!doctype html><title>pay</title><h1>דף התשלום של הספק</h1>';
  const phoneOf = async () => {
    const ctx = await browser.newContext({ baseURL, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
    await ctx.route('https://pay.example.org/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: provider }));
    return ctx.newPage();
  };
  await visitor.route('https://pay.example.org/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: provider }));
  const pub = await visitor.newPage();
  const pubErrors = watchConsole(pub);
  const register = async (p: typeof pub, name: string, tel: string) => {
    await p.goto(`#/r/${ev!.public_code}`);
    await p.getByLabel('שם מלא').fill(name);
    await p.getByLabel('טלפון נייד').fill(tel);
    await p.getByLabel('עיר מגורים').fill('חיפה');
    await p.getByLabel('גיל').fill('27');
    await p.getByRole('radio', { name: /אינסטגרם/ }).check();
    // the submit button is the pay button: it names the amount, and nothing stands between it and the payment page
    const submit = p.getByRole('button', { name: /^לתשלום/ });
    await expect(submit).toContainText('20');
    await submit.click();
    await p.waitForURL((u) => u.href.startsWith(PAY_URL));
    await expect(p.getByRole('heading', { name: 'דף התשלום של הספק' })).toBeVisible();
  };
  await pub.goto(`#/r/${ev!.public_code}`);
  await expect(pub.getByText(/המקום נשמר רק אחרי התשלום\. הכפתור בסוף הטופס פותח את דף התשלום/)).toBeVisible();
  await expect(pub.getByRole('button', { name: 'להרשמה', exact: true })).toHaveCount(0);
  const noaPhone = phone();
  await register(pub, 'נועה תשלומים', noaPhone);
  // nothing is confirmed before the payment
  const { data: pending } = await coord.from('registrations').select('status').eq('event_id', eventId);
  expect(pending).toEqual([{ status: 'pending_payment' }]);

  // back on the site without paying: the form says the place waits for the payment, and leads to the pay step
  const second = await phoneOf();
  const secondErrors = watchConsole(second);
  await register(second, 'אורי ממתין', phone());
  await second.goBack();
  const savedHere = second.getByTestId('saved-here');
  await expect(savedHere).toContainText('המקום נשמר רק אחרי');
  await savedHere.getByRole('link', { name: 'להשלמת התשלום' }).click();
  await expect(second).toHaveURL(/#\/m\//);
  await expect(second.getByRole('heading', { name: 'עוד צעד אחד: תשלום' })).toBeVisible();
  await expect(second.getByRole('link', { name: /לתשלום/ })).toHaveAttribute('target', '_blank');

  // ── the provider's webhook for the first person: back on the site it is "נרשמת!" ──
  expect(await webhook(noaPhone, 20)).toEqual({ ok: true, result: 'matched' });
  await pub.goBack();
  await expect(pub.getByTestId('saved-here')).toContainText('נרשמת מהטלפון הזה');
  await pub.getByTestId('saved-here').getByRole('link', { name: 'לעמוד ההרשמה שלי' }).click();
  await expect(pub.getByRole('button', { name: 'הוספה ליומן' })).toBeVisible();
  await expect(pub.getByRole('link', { name: /לתשלום/ })).toHaveCount(0);

  // a third person, and a payment from a phone that matches nobody
  const third = await phoneOf();
  await register(third, 'שירה בלי טלפון תואם', phone());
  expect((await webhook('0539' + String(Date.now()).slice(-6), 20)).result).toBe('unmatched');

  // ── the coordinator: who has not paid; confirm one by hand ──
  await page.goto(`#/app/events/${eventId}?tab=registrations`);
  await page.getByRole('button', { name: /^לא שילמו/ }).click();
  const row = page.locator('tr', { hasText: 'אורי ממתין' });
  await expect(row.getByText('מחכה לתשלום')).toBeVisible();
  await row.getByRole('button', { name: 'אישור תשלום' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('סכום ששולם (₪)')).toHaveValue('20');
  await dialog.getByLabel('אסמכתה (לא חובה)').fill('50147');
  await dialog.getByRole('button', { name: 'אישור תשלום' }).click();
  await expect(page.getByText('התשלום של אורי ממתין אושר, ההרשמה הושלמה')).toBeVisible();
  // the second visitor's open personal page follows by itself
  await expect(second.getByText('התשלום התקבל. נרשמת!')).toBeVisible({ timeout: 15_000 });

  // ── the payment that matched nobody: one line on the tab, opened to match it to the third person ──
  await page.getByTestId('unmatched-banner').getByRole('button', { name: 'להתאמה' }).click();
  const unmatched = page.locator('section', { has: page.getByRole('heading', { name: /מחכ(ה|ים) להתאמה/ }) });
  await expect(unmatched).toBeVisible();
  const item = unmatched.getByTestId('unmatched-payment').filter({ has: page.getByRole('radio', { name: /שירה בלי טלפון תואם/ }) }).first();
  await item.getByRole('radio', { name: /שירה בלי טלפון תואם/ }).check();
  await item.getByRole('button', { name: 'התאמה' }).click();
  await expect(page.getByText('התשלום של שירה בלי טלפון תואם הותאם, ההרשמה הושלמה')).toBeVisible();
  await third.goBack();
  await expect(third.getByTestId('saved-here')).toContainText('נרשמת מהטלפון הזה');

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

test('a meeting with a fee cannot open for registration without a payment link', async ({ page }) => {
  const coord = await staff('coord');
  const starts = new Date(Date.now() + 6 * 864e5);
  const row = {
    site_id: '00000000-0000-4000-8000-000000000001', type: 'friday', title: 'שישי בתשלום בלי קישור E2E', status: 'open', capacity: 40, price: 20,
    starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3 * 3600e3).toISOString(),
  };
  expect((await coord.from('events').insert(row)).error?.message).toBe('payment_link_required');
  // the form says so before the server does
  const errors = watchConsole(page);
  await loginAs(page, 'coord');
  await page.goto('#/app/events/new');
  await page.getByLabel('כותרת').fill(`שישי בלי קישור ${Date.now().toString(36)}`);
  await page.locator('input[type="date"]').first().fill(nextFriday(addDays(todayIl(), 15)));
  await page.getByLabel('סטטוס').selectOption('open');
  await page.getByLabel('מחיר (₪)').fill('20');
  await page.getByRole('button', { name: 'יצירת המפגש' }).click();
  await expect(page.getByText('מפגש בתשלום נפתח להרשמה רק עם קישור לתשלום', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
