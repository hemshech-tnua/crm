// The door with one hand: type → tap, the search clears for the next person, money is taken in the flow,
// and the QR sign is honest about an open fee and forgiving about a nickname.
import { expect, test } from '@playwright/test';
import { e164, makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

async function pricedMeetingWith(people: { n: string; p: string }[]) {
  const ev = await makeEvent({ title: `כניסה E2E ${Date.now().toString(36)}`, startsInMinutes: -5, price: 20 });
  const coord = await staff('coord');
  for (const x of people) {
    const { data: p } = await coord.from('participants').insert({ full_name: x.n, phone: x.p }).select('id').single();
    await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });
  }
  /** The registration of the card with this phone, at this meeting. */
  const regOf = async (ph: string) => {
    const { data: p } = await coord.from('participants').select('id').eq('phone', e164(ph)).single();
    if (!p) return null;
    return (await coord.from('registrations').select('attendance, payment_status, payment_method').eq('event_id', ev.id).eq('participant_id', p.id).single()).data;
  };
  return { ev, regOf };
}

test('type a full phone, tap: the search clears, the row waits on top with the cash button', async ({ page }) => {
  const errors = watchConsole(page);
  const a = { n: name(), p: phone() };
  const { ev, regOf } = await pricedMeetingWith([a, { n: name(), p: phone() }]);

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
  await expect(strip.getByText('לא שולם')).toBeVisible();
  await strip.getByRole('button', { name: new RegExp(`שולם במקום במזומן.*${a.n}`) }).click();
  await expect(page.getByText(`התשלום של ${a.n} סומן`)).toBeVisible();
  await expect.poll(() => regOf(a.p)).toMatchObject({ attendance: 'attended', payment_status: 'paid', payment_method: 'cash' });

  // a walk-in who pays at the entrance: the fee is recorded together with the arrival
  const walk = { n: name(), p: phone() };
  await search.fill(walk.n);
  await expect(page.getByText('אין תוצאות לחיפוש הזה')).toBeVisible();
  await page.getByRole('button', { name: 'הגעה בלי הרשמה' }).last().click();
  const dialog = page.getByRole('dialog', { name: 'הגעה בלי הרשמה' });
  await expect(dialog.getByLabel('שם מלא')).toHaveValue(walk.n);
  await dialog.getByLabel('טלפון').fill(walk.p);
  await dialog.getByRole('switch', { name: /שולם במקום/ }).click();
  await dialog.getByRole('button', { name: 'רישום וסימון הגעה' }).click();
  await expect(page.getByRole('button', { name: `${walk.n}: הגעה מסומנת. לחיצה מבטלת` })).toBeVisible();
  await expect.poll(async () => (await regOf(walk.p))?.payment_status).toBe('paid');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('QR @phone: a nickname in brackets still finds the card, and an open fee is said plainly', async ({ page }) => {
  const errors = watchConsole(page);
  const me = { n: name(), p: phone() };
  const { ev } = await pricedMeetingWith([me]);
  const [first, ...rest] = me.n.split(' ');
  await page.goto(`#/c/${ev.checkin_code}`);
  await page.getByLabel('מספר הטלפון שלך').fill(me.p);
  await page.getByRole('button', { name: 'הגעתי' }).click();
  await page.getByLabel('שם מלא').fill(`${first} (ניקי) ${rest.join(' ')}`);
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(first) })).toBeVisible();
  await expect(page.getByText('נשאר לשלם')).toBeVisible();
  await expect(page.getByText('אפשר לשלם במזומן בכניסה.')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
