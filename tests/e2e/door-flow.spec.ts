// The door with one hand: type → tap, the search clears for the next person, money is taken in the flow,
// and the QR sign is honest about an open fee and forgiving about a nickname.
import { expect, test } from '@playwright/test';
import { e164, legacyUnpaid, makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

const PAY_URL = 'https://pay.example.org/p/door-e2e';

/** A meeting with a fee that started 5 minutes ago. `paid` people paid online; `owing` ones hold a place from before
 * pay-first and never paid (the only way a place without payment exists since 20261106002800_pay_guarantee.sql). */
async function pricedMeetingWith(paid: { n: string; p: string }[], owing: { n: string; p: string }[] = []) {
  const ev = await makeEvent({ title: `כניסה E2E ${Date.now().toString(36)}`, startsInMinutes: -5, price: 20, payment_url: PAY_URL });
  const coord = await staff('coord');
  for (const x of paid) {
    const { data: p } = await coord.from('participants').insert({ full_name: x.n, phone: x.p }).select('id').single();
    const { data: r } = await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });
    await coord.rpc('staff_confirm_payment', { p_registration_id: r.registration_id });
  }
  for (const x of owing) legacyUnpaid(ev.id, x.n, x.p);
  /** The registration of the card with this phone, at this meeting. */
  const regOf = async (ph: string) => {
    const { data: p } = await coord.from('participants').select('id').eq('phone', e164(ph)).single();
    if (!p) return null;
    return (await coord.from('registrations').select('status, attendance, payment_status, payment_method').eq('event_id', ev.id).eq('participant_id', p.id).single()).data;
  };
  return { ev, regOf };
}

test('type a full phone, tap: the search clears; nobody unpaid is let in without the cash, taken in the same tap', async ({ page }) => {
  const errors = watchConsole(page);
  const a = { n: name(), p: phone() };
  const owes = { n: name(), p: phone() };
  const { ev, regOf } = await pricedMeetingWith([a, { n: name(), p: phone() }], [owes]);

  await loginAs(page, 'door');
  await page.goto(`#/app/events/${ev.id}/door`);
  const search = page.getByLabel('חיפוש לפי שם או טלפון');
  // a full number in any format finds the person (the door sees only the last four digits)
  await search.fill(`${a.p.slice(0, 3)}-${a.p.slice(3)}`);
  await page.getByRole('button', { name: `סימון הגעה של ${a.n}` }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  const strip = page.locator('section', { has: page.getByRole('heading', { name: /סומנו עכשיו/ }) });
  await expect(strip.getByRole('button', { name: `${a.n}: הגעה מסומנת. לחיצה מבטלת` })).toBeVisible();
  await expect.poll(() => regOf(a.p)).toMatchObject({ attendance: 'attended', payment_status: 'paid', payment_method: 'card' });

  // a place that was never paid: the box asks for the cash; arrival and payment are recorded together
  await search.fill(owes.n);
  const row = page.getByRole('listitem').filter({ hasText: owes.n });
  await expect(row.getByText('לא שולם')).toBeVisible();
  await page.getByRole('button', { name: `סימון הגעה של ${owes.n}` }).click();
  const ask = page.getByRole('dialog', { name: 'הגעה ותשלום במקום' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: /התקבל מזומן/ }).click();
  await expect.poll(() => regOf(owes.p)).toMatchObject({ status: 'registered', attendance: 'attended', payment_status: 'paid', payment_method: 'cash' });

  // a walk-in at a meeting with a fee: the arrival is saved only with the cash
  const walk = { n: name(), p: phone() };
  await search.fill(walk.n);
  await expect(page.getByText('אין תוצאות לחיפוש הזה')).toBeVisible();
  await page.getByRole('button', { name: 'הגעה בלי הרשמה' }).last().click();
  const dialog = page.getByRole('dialog', { name: 'הגעה בלי הרשמה' });
  await expect(dialog.getByLabel('שם מלא')).toHaveValue(walk.n);
  await dialog.getByLabel('טלפון').fill(walk.p);
  await dialog.getByRole('button', { name: 'רישום וסימון הגעה' }).click();
  await expect(dialog.getByText('ההגעה נרשמת רק יחד עם התשלום במקום')).toBeVisible();
  expect(await regOf(walk.p)).toBeNull();
  await dialog.getByRole('switch', { name: /שולם במקום/ }).click();
  await dialog.getByRole('button', { name: 'רישום וסימון הגעה' }).click();
  await expect(page.getByRole('button', { name: `${walk.n}: הגעה מסומנת. לחיצה מבטלת` })).toBeVisible();
  await expect.poll(() => regOf(walk.p)).toMatchObject({ attendance: 'attended', payment_status: 'paid', payment_method: 'cash' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('QR @phone: a nickname in brackets still finds the card, and an unpaid registration is not checked in', async ({ page }) => {
  const errors = watchConsole(page);
  const me = { n: name(), p: phone() };
  // started a registration and has not paid: no place, so the check-in asks for the payment
  const ev = await makeEvent({ title: `כניסה E2E ${Date.now().toString(36)}`, startsInMinutes: -5, price: 20, payment_url: PAY_URL });
  const coord = await staff('coord');
  const { data: p } = await coord.from('participants').insert({ full_name: me.n, phone: me.p }).select('id').single();
  await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });
  const [first, ...rest] = me.n.split(' ');
  await page.goto(`#/c/${ev.checkin_code}`);
  await page.getByLabel('מספר הטלפון שלך').fill(me.p);
  await page.getByRole('button', { name: 'הגעתי' }).click();
  await page.getByLabel('שם מלא').fill(`${first} (ניקי) ${rest.join(' ')}`);
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`${first}, עוד צעד אחד: תשלום`) })).toBeVisible();
  await expect(page.getByText('הצ׳ק־אין נקלט אחרי', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: /לתשלום/ })).toHaveAttribute('href', PAY_URL);
  await expect(page.getByText('אפשר גם לשלם במזומן לצוות בכניסה', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: /טוב לראות אותך|כיף שבאת/ })).toHaveCount(0);
  expect((await coord.from('registrations').select('attendance').eq('event_id', ev.id).single()).data).toEqual({ attendance: 'unknown' });
  expect(errors, errors.join('\n')).toEqual([]);
});
