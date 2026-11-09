// QR check-in v2: the phone remembers who checked in (next meeting is one tap, even without registering), the
// "join the association" page recognises that phone, and 24 hours after a meeting the team sends the thank-you.
import { expect, test } from '@playwright/test';
import { e164, makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

test('@phone a walk-in is remembered: the next meeting is one tap, and joining the association is one tap', async ({ page }) => {
  const errors = watchConsole(page);
  const tag = Date.now().toString(36);
  const ev1 = await makeEvent({ title: `זיהוי טלפון ${tag}`, startsInMinutes: 20 });
  const ev2 = await makeEvent({ title: `ערב מדורה ${tag}`, type: 'bonfire', startsInMinutes: 45 });
  const who = { n: `שקד ${name().split(' ')[1]}`, p: phone() };

  // first meeting: not registered, so the short walk-in form
  await page.goto(`#/c/${ev1.checkin_code}`);
  await page.getByLabel('מספר הטלפון שלך').fill(who.p);
  await page.getByRole('button', { name: 'צ׳ק־אין' }).click();
  await page.getByLabel('שם מלא').fill(who.n);
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByLabel('עיר מגורים').fill('מודיעין');
  await page.getByLabel('גיל').fill('31');
  await page.getByRole('radio', { name: /אינסטגרם/ }).check();
  await page.getByLabel('אשמח לקבל עדכונים והזמנות למפגשים בוואטסאפ').check();
  await page.getByRole('button', { name: 'נרשמים ונכנסים' }).click();
  await expect(page.getByRole('heading', { name: /שקד/ })).toBeVisible();

  // next meeting, never registered: the phone remembers, one tap
  await page.goto(`#/c/${ev2.checkin_code}`);
  await expect(page.getByText('שקד, הטלפון זוכר אותך מהביקור הקודם, אז מספיקה לחיצה אחת.')).toBeVisible();
  await page.getByRole('button', { name: 'הגעתי' }).click();
  await expect(page.getByRole('heading', { name: /שקד/ })).toBeVisible();

  const coord = await staff('coord');
  const { data: list } = await coord.rpc('staff_checkin_list', { p_event_id: ev2.id });
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ display_name: who.n, attendance: 'attended', is_walk_in: true });

  // the link in the thank-you message: the same phone asks to join in one tap
  await page.goto('#/member');
  await expect(page.getByRole('heading', { name: 'הצטרפות לעמותה' })).toBeVisible();
  await page.getByRole('button', { name: 'אני רוצה להצטרף' }).click();
  await expect(page.getByRole('heading', { name: 'תודה, שקד! קיבלנו' })).toBeVisible();
  const { data: card } = await coord.from('participants').select('id, membership').eq('phone', e164(who.p)).single();
  expect(card!.membership).toBe('requested');
  const { data: tasks } = await coord.from('follow_ups').select('type, status').eq('participant_id', card!.id).eq('type', 'membership');
  expect(tasks).toEqual([{ type: 'membership', status: 'open' }]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('@phone someone already on file, not registered for this meeting: phone and name are enough', async ({ page }) => {
  const errors = watchConsole(page);
  const ev = await makeEvent({ title: `מוכר ${Date.now().toString(36)}`, startsInMinutes: 20 });
  const coord = await staff('coord');
  const who = { n: `ענבר ${name().split(' ')[1]}`, p: phone() };
  await coord.from('participants').insert({ full_name: who.n, phone: who.p, city: 'מודיעין' });

  await page.goto(`#/c/${ev.checkin_code}`);
  await page.getByLabel('מספר הטלפון שלך').fill(who.p);
  await page.getByRole('button', { name: 'צ׳ק־אין' }).click();
  await expect(page.getByText('לא מצאנו הרשמה למפגש הזה עם המספר הזה. אין בעיה: איך קוראים לך?')).toBeVisible();
  await page.getByLabel('שם מלא').fill(`  ${who.n} `);
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByRole('heading', { name: /ענבר/ })).toBeVisible();
  await expect(page.getByLabel('עיר מגורים')).toHaveCount(0);
  const { data: list } = await coord.rpc('staff_checkin_list', { p_event_id: ev.id });
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ display_name: who.n, attendance: 'attended', is_walk_in: true });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('24 hours after a meeting the dashboard asks for the thank-you; non-members who agreed get the join invitation', async ({ page }) => {
  const errors = watchConsole(page);
  const coord = await staff('coord');
  const mk = async (n: string, extra: Record<string, unknown>) =>
    (await coord.from('participants').insert({ full_name: n, phone: phone(), ...extra }).select('id').single()).data!.id as string;
  const tag = name().split(' ')[1];
  const memberName = `חברה ${tag}`;
  const inviteeName = `מוזמן ${tag}`;
  const ids = [await mk(memberName, { membership: 'member' }), await mk(inviteeName, { consent_updates: true })];
  const ev = await makeEvent({ title: `תודה אחרי ${tag}`, startsInMinutes: -30 * 60 });
  for (const id of ids) {
    const { data } = await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: id });
    await coord.rpc('staff_set_attendance', { p_registration_id: data.registration_id, p_attendance: 'attended' });
  }

  await loginAs(page, 'coord');
  await expect(page.getByText(/הודעות תודה/).first()).toBeVisible();

  await page.goto(`#/app/events/${ev.id}?tab=messages&group=aftercare`);
  await expect(page.getByRole('button', { name: 'תודה אחרי המפגש' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/עברו 24 שעות מסוף המפגש/)).toBeVisible();
  const memberRow = page.locator('li', { hasText: memberName });
  const inviteeRow = page.locator('li', { hasText: inviteeName });
  await expect(memberRow.getByText('חבר/ת עמותה')).toBeVisible();
  await expect(inviteeRow.getByText('+ הזמנה להצטרף')).toBeVisible();

  await inviteeRow.getByRole('button', { name: 'שליחה' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'תבנית' })).toHaveValue('join_invite');
  const text = await dialog.getByLabel('הטקסט (אפשר לערוך לפני השליחה)').inputValue();
  expect(text).toContain('להצטרף לעמותת המשך תנועה');
  expect(text).toContain('#/member');
  expect(text).toContain(`מוזמן, תודה שהיית איתנו`);
  await dialog.getByRole('button', { name: /סגירה|ביטול/ }).first().click().catch(() => page.keyboard.press('Escape'));

  await memberRow.getByRole('button', { name: 'שליחה' }).click();
  await expect(page.getByRole('dialog').getByRole('combobox', { name: 'תבנית' })).toHaveValue('thanks');
  expect(errors, errors.join('\n')).toEqual([]);
});
