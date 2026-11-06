// Scenario 3 (new participant registers) and scenario 4 (returning participant: recognized, no duplicate,
// history updated), driven through the real public form and checked in the staff screens and the database.
import { expect, test, type Page } from '@playwright/test';
import { e164, makeEvent, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

async function fillRegistration(page: Page, p: { name: string; phone: string; city: string; age: string; source: RegExp; referrer?: string }) {
  await page.getByLabel('שם מלא').fill(p.name);
  await page.getByLabel('טלפון נייד').fill(p.phone);
  await page.getByLabel('עיר מגורים').fill(p.city);
  await page.getByLabel('גיל').fill(p.age);
  await page.getByRole('radio', { name: p.source }).check();
  if (p.referrer) await page.getByLabel('מי הביא/ה אותך? שם או טלפון').fill(p.referrer);
  await page.getByRole('button', { name: 'הרשמה', exact: true }).click();
}

test('scenario 3 + 4: register a new participant, then the same person again for another meeting', async ({ page, context }) => {
  const errors = watchConsole(page);
  const first = await makeEvent({ title: 'שישי הרשמה E2E', lecture_topic: 'חוסן' });
  const second = await makeEvent({ title: 'שישי חוזר E2E', startsInMinutes: 10 * 24 * 60 });
  const local = phone();
  const name = 'אביגיל בדיקות קצה';

  // ── scenario 3: new participant ──
  await page.goto(`#/r/${first.public_code}?utm_source=instagram&utm_campaign=e2e`);
  await expect(page.getByText('שישי הרשמה E2E')).toBeVisible();
  await fillRegistration(page, { name, phone: local, city: 'מודיעין', age: '31', source: /אינסטגרם/ });
  await expect(page.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
  // no personal details in the address bar
  expect(page.url()).not.toContain(local);
  expect(decodeURI(page.url())).not.toContain('אביגיל');

  const coord = await staff('coord');
  const { data: p } = await coord.from('participants')
    .select('id, full_name, city, acquisition_sources!participants_first_source_id_fkey(key)')
    .eq('phone', e164(local)).single();
  expect(p!.full_name).toBe(name);
  expect((p as any).acquisition_sources.key).toBe('instagram');
  const { data: r1 } = await coord.from('registrations').select('status, utm_source, utm_campaign').eq('participant_id', p!.id).eq('event_id', first.id).single();
  expect(r1).toEqual({ status: 'registered', utm_source: 'instagram', utm_campaign: 'e2e' });

  // the participant appears in the roster with the source
  const staffPage = await context.newPage();
  await loginAs(staffPage, 'coord');
  await staffPage.goto('#/app/participants');
  await staffPage.getByRole('searchbox').first().fill(local.slice(-7));
  await expect(staffPage.getByText(name).first()).toBeVisible();

  // ── scenario 4: the same phone again (other formatting, other spelling) for another meeting ──
  await page.goto(`#/r/${second.public_code}`);
  await expect(page.getByText('שישי חוזר E2E')).toBeVisible();
  await fillRegistration(page, { name: 'אביגיל ב.', phone: `+972 ${local.slice(1, 3)}-${local.slice(3)}`, city: 'מודיעין', age: '31', source: /כבר הייתי/ });
  await expect(page.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
  // the same meeting twice: recognized, not duplicated
  await page.goto(`#/r/${first.public_code}`);
  await fillRegistration(page, { name, phone: local, city: 'מודיעין', age: '31', source: /אינסטגרם/ });
  await expect(page.getByRole('heading', { name: 'כבר נרשמת למפגש הזה' })).toBeVisible();

  const { data: people } = await coord.from('participants').select('id, full_name').eq('phone', e164(local));
  expect(people).toHaveLength(1);
  expect(people![0].full_name).toBe(name);
  const { data: regs } = await coord.from('registrations').select('event_id').eq('participant_id', p!.id);
  expect(regs!.map((r) => r.event_id).sort()).toEqual([first.id, second.id].sort());

  // the card shows both registrations in the history, and the first source stays Instagram
  await staffPage.goto(`#/app/participants/${p!.id}`);
  await expect(staffPage.getByText('שישי הרשמה E2E').first()).toBeVisible();
  await expect(staffPage.getByText('שישי חוזר E2E').first()).toBeVisible();
  await expect(staffPage.getByText('אינסטגרם').first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a friend registers through a personal invite link and is credited to the inviter', async ({ page }) => {
  const ev = await makeEvent({ title: 'שישי חברים E2E' });
  const coord = await staff('coord');
  const inviterPhone = phone();
  const { data: inviter } = await coord.from('participants').insert({ full_name: 'מזמין בדיקה', phone: inviterPhone }).select('id, referral_code').single();
  await page.goto(`#/r/${ev.public_code}?ref=${inviter!.referral_code}`);
  await expect(page.getByText(/מזמין הזמין\/ה אותך/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /חבר\/ה/ })).toBeChecked();
  const friendPhone = phone();
  await page.getByLabel('שם מלא').fill('חבר מוזמן');
  await page.getByLabel('טלפון נייד').fill(friendPhone);
  await page.getByLabel('עיר מגורים').fill('לוד');
  await page.getByLabel('גיל').fill('27');
  await page.getByRole('button', { name: 'הרשמה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
  const { data: friend } = await coord.from('participants').select('referred_by_participant_id').eq('phone', e164(friendPhone)).single();
  expect(friend!.referred_by_participant_id).toBe(inviter!.id);
});
