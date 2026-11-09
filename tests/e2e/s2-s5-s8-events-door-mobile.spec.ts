// Scenario 2 (create a Friday meeting and open registration), scenario 5 (attendance at the door + closing,
// numbers in the summary and reports) and scenario 8 (the same work on a phone).
import { expect, test, type Page } from '@playwright/test';
import { e164, makeEvent, name, phone, registration, staff, visitor } from '../api/helpers';
import { addDays, nextFriday, todayIl } from '../../src/lib/dates';
import { loginAs, watchConsole } from './support';

async function confirmIfAsked(page: Page, button: string) {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: button }) });
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: button }).click();
}

test('scenario 2: a coordinator creates a Friday meeting, opens registration, and it is live for the public', async ({ page, context }) => {
  const errors = watchConsole(page);
  await loginAs(page, 'coord');
  await page.goto('#/app/events');
  await page.getByRole('link', { name: 'מפגש חדש' }).first().click();
  await expect(page).toHaveURL(/#\/app\/events\/new/);
  const title = `שישי E2E ${Date.now().toString(36)}`;
  const date = nextFriday(addDays(todayIl(), 8));
  await page.getByLabel('כותרת').fill(title);
  await page.locator('input[type="date"]').first().fill(date);
  await expect(page.getByLabel('שעת התחלה')).toHaveValue('09:00');
  await expect(page.getByLabel('שעת סיום')).toHaveValue('11:30');
  await page.getByLabel('מספר מקומות').fill('35');
  await page.getByLabel('נושא ההרצאה').fill('לנשום בחזרה לשגרה');
  await page.getByRole('button', { name: 'יצירת המפגש' }).click();
  await expect(page).toHaveURL(/#\/app\/events\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: 'פתיחת הרשמה' }).first().click();
  await confirmIfAsked(page, 'פתיחת הרשמה');
  await expect(page.getByText('הרשמה פתוחה').first()).toBeVisible();

  const coord = await staff('coord');
  const { data: ev } = await coord.from('events').select('id, status, capacity, starts_at, lecture_topic, public_code, type').eq('title', title).single();
  expect(ev).toMatchObject({ status: 'open', capacity: 35, lecture_topic: 'לנשום בחזרה לשגרה', type: 'friday' });
  expect(new Date(ev!.starts_at).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false })).toBe('09:00');

  // the public sees it
  const pub = await context.newPage();
  await pub.goto(`#/r/${ev!.public_code}`);
  await expect(pub.getByText(title)).toBeVisible();
  await expect(pub.getByRole('button', { name: 'הרשמה', exact: true })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('scenario 5: door attendance, cancel, walk-in, closing, and the numbers in the summary', async ({ page, browser }) => {
  const errors = watchConsole(page);
  const title = `נוכחות E2E ${Date.now().toString(36)}`;
  const ev = await makeEvent({ title, startsInMinutes: -5 });
  // registrations must exist before the start: register through the office
  const coord = await staff('coord');
  const people = [name(), name(), name()];
  const ids: string[] = [];
  for (const n of people) {
    const { data: p } = await coord.from('participants').insert({ full_name: n, phone: phone() }).select('id').single();
    await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });
    ids.push(p!.id);
  }

  await loginAs(page, 'door');
  await expect(page).toHaveURL(/#\/app\/door/);
  await page.getByText(title, { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/app/events/${ev.id}/door`));
  await page.getByRole('button', { name: `סימון ש${people[0]} הגיע/ה` }).click();
  await expect(page.getByRole('button', { name: `${people[0]} הגיע/ה. לחיצה מבטלת` })).toBeVisible();
  await page.getByRole('button', { name: `פעולות נוספות ל${people[1]}` }).click();
  await page.getByRole('menuitem', { name: 'סימון ביטל/ה' }).click();
  await confirmIfAsked(page, 'סימון ביטל/ה');
  await page.getByRole('button', { name: 'הגיע/ה בלי הרשמה' }).first().click();
  const walkName = name();
  const walkPhone = phone();
  const dialog = page.getByRole('dialog', { name: 'הגיע/ה בלי הרשמה' });
  await dialog.getByLabel('שם מלא').fill(walkName);
  await dialog.getByLabel('טלפון').fill(walkPhone);
  await dialog.getByRole('button', { name: 'רישום וסימון הגעה' }).click();
  await expect(page.getByRole('button', { name: `${walkName} הגיע/ה. לחיצה מבטלת` })).toBeVisible();
  // volunteers never see full phone numbers
  await expect(page.getByText(walkPhone)).toHaveCount(0);

  const { data: regs } = await coord.from('registrations').select('participant_id, status, attendance, is_walk_in, checkin_method').eq('event_id', ev.id);
  const by = (pid: string) => regs!.find((r) => r.participant_id === pid)!;
  expect(by(ids[0])).toMatchObject({ status: 'registered', attendance: 'attended', checkin_method: 'staff' });
  expect(by(ids[1])).toMatchObject({ status: 'cancelled' });
  expect(regs!.find((r) => r.is_walk_in)).toMatchObject({ attendance: 'attended' });

  // the coordinator closes the meeting: the third person becomes a no-show with a follow-up task
  const office = await (await browser.newContext({ baseURL: page.url().split('#')[0], locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })).newPage();
  await loginAs(office, 'coord');
  await office.goto(`#/app/events/${ev.id}`);
  await office.getByRole('button', { name: 'סגירת המפגש' }).first().click();
  await office.getByRole('dialog').getByRole('button', { name: 'סגירת המפגש' }).click();
  await expect.poll(async () => (await coord.from('events').select('status').eq('id', ev.id).single()).data!.status).toBe('completed');
  const { data: tasks } = await coord.from('follow_ups').select('type, participant_id').eq('event_id', ev.id);
  expect(tasks!.filter((t) => t.type === 'no_show').map((t) => t.participant_id)).toEqual([ids[2]]);

  const { data: st } = await coord.from('event_stats').select('*').eq('event_id', ev.id).single();
  expect(st).toMatchObject({ attended_count: 2, walk_in_count: 1, cancelled_count: 1, no_show_count: 1, registered_count: 2, attended_registered_count: 1 });
  await office.goto(`#/app/events/${ev.id}?tab=summary`);
  await expect(office.getByText('50%').first()).toBeVisible(); // 1 of the 2 who stayed registered came
  expect(errors, errors.join('\n')).toEqual([]);
});

test('scenario 8 @phone: register, check in, and the door list on a phone', async ({ page, browser }) => {
  const fresh = async () => (await browser.newContext({ ...test.info().project.use, baseURL: page.url().split('#')[0] || undefined })).newPage();
  const errors = watchConsole(page);
  const ev = await makeEvent({ title: `טלפון E2E ${Date.now().toString(36)}`, startsInMinutes: 25 });
  // a participant registers on their phone
  await page.goto(`#/r/${ev.public_code}`);
  const me = { name: name(), phone: phone() };
  await page.getByLabel('שם מלא').fill(me.name);
  await page.getByLabel('טלפון נייד').fill(me.phone);
  await page.getByLabel('עיר מגורים').fill('מודיעין');
  await page.getByLabel('גיל').fill('34');
  await page.getByRole('radio', { name: /קבוצת וואטסאפ/ }).check();
  await page.getByRole('button', { name: 'הרשמה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
  // no horizontal scrolling on the phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // at the entrance, the same phone scans the QR: one tap (the device remembers the registration)
  await page.goto(`#/c/${ev.checkin_code}`);
  await page.getByRole('button', { name: /הגעתי/ }).click();
  // wait for the welcome screen itself (the name is already on the page before the tap)
  await expect(page.getByRole('heading', { name: new RegExp(me.name.split(' ')[0]) })).toBeVisible();
  const coord = await staff('coord');
  const { data: mine } = await coord.from('participants').select('id').eq('phone', e164(me.phone)).single();
  const { data: r } = await coord.from('registrations').select('attendance, checkin_method').eq('event_id', ev.id).eq('participant_id', mine!.id).single();
  expect(r).toMatchObject({ attendance: 'attended', checkin_method: 'self_qr' });

  // a friend at the door who never registered: walk-in from their own phone
  const friend = await fresh(); // the friend's own phone: no saved registration
  await friend.goto(`#/c/${ev.checkin_code}`);
  const fp = phone();
  await friend.getByLabel('מספר הטלפון שלך').fill(fp);
  await friend.getByRole('button', { name: 'צ׳ק־אין' }).click();
  await friend.getByLabel('שם מלא').fill('חבר בכניסה');
  await friend.getByRole('button', { name: 'המשך' }).click();
  // unknown to us: on to the short form, with the name already filled in
  await expect(friend.getByLabel('שם מלא')).toHaveValue('חבר בכניסה');
  await friend.getByLabel('עיר מגורים').fill('לוד');
  await friend.getByLabel('גיל').fill('29');
  await friend.getByRole('radio', { name: /חבר\/ה/ }).check();
  await friend.getByRole('button', { name: 'נרשמים ונכנסים' }).click();
  await expect(friend.getByRole('heading', { name: /חבר!/ })).toBeVisible();
  const { data: w } = await coord.from('participants').select('id').eq('phone', e164(fp)).single();
  expect(w).not.toBeNull();

  // the volunteer's list on a phone shows both as arrived, with the bottom of the page reachable
  const door = await fresh();
  await loginAs(door, 'door');
  await door.goto(`#/app/events/${ev.id}/door`);
  await expect(door.getByRole('button', { name: `${me.name} הגיע/ה. לחיצה מבטלת` })).toBeVisible();
  await expect(door.getByRole('button', { name: 'חבר בכניסה הגיע/ה. לחיצה מבטלת' })).toBeVisible();
  expect(await door.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await door.mouse.wheel(0, 3000);

  // a coordinator on a phone: bottom navigation reaches every area
  const office = await fresh();
  await loginAs(office, 'coord');
  const nav = office.getByRole('navigation', { name: 'ניווט ראשי' }).last();
  for (const label of ['מפגשים', 'לוחמים', 'מעקב', 'סקירה']) {
    await nav.getByRole('link', { name: label }).click();
    await expect(office.locator('h1').first()).toBeVisible();
    expect(await office.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), label).toBe(true);
  }
  await nav.getByRole('button', { name: 'עוד' }).click();
  await office.getByRole('dialog').getByRole('link', { name: 'דוחות' }).click();
  await expect(office.getByRole('heading', { name: 'דוחות' })).toBeVisible();
  void visitor; void registration;
  expect(errors, errors.join('\n')).toEqual([]);
});
