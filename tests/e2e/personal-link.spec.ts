// Someone the team registered (an imported list) gets a personal link in WhatsApp; opened once, the permanent
// sign at the door recognises them and check-in is one tap ("הגעתי"). Migration 20261106002000_personal_link.sql.
import { expect, test } from '@playwright/test';
import { makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

test('a team-registered person opens the personal link once, then checks in at the door with one tap', async ({ page, browser }) => {
  const errors = watchConsole(page);
  const coord = await staff('coord');
  const ev = await makeEvent({ title: `ערב מדורה ${Date.now().toString(36)}`, startsInMinutes: 20 });
  const full = name();
  const { data: p } = await coord.from('participants').insert({ full_name: full, phone: phone(), created_via: 'import' }).select('id').single();
  await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });

  // the team: Messages tab, the ready template, the text carries a personal link
  await loginAs(page, 'coord');
  await page.goto(`#/app/events/${ev.id}?tab=messages`);
  await page.getByLabel('תבנית').selectOption({ label: 'קישור אישי לצ׳ק־אין מהיר' });
  await page.getByRole('button', { name: `שליחה ל${full.split(' ')[0]}` }).click();
  const text = page.getByLabel('הטקסט (אפשר לערוך לפני השליחה)');
  await expect(text).toHaveValue(/#\/m\/[A-Za-z0-9_-]{20,}/);
  await expect(page.getByRole('link', { name: 'פתיחה בוואטסאפ' })).toBeVisible();
  const link = (await text.inputValue()).match(/https?:\S+#\/m\/[A-Za-z0-9_-]+/)![0];
  expect(errors, errors.join('\n')).toEqual([]);

  // the participant's own phone: opens the link once
  const phoneCtx = await browser.newContext();
  const mine = await phoneCtx.newPage();
  const mineErrors = watchConsole(mine);
  await mine.goto(link);
  await expect(mine.getByRole('heading', { name: `היי ${full.split(' ')[0]}` })).toBeVisible();
  await expect(mine.getByText('בכניסה סורקים את הברקוד ולוחצים "הגעתי"', { exact: false })).toBeVisible();

  // at the door: scans the sign, one tap
  await mine.goto(`#/c/${ev.checkin_code}`);
  await mine.getByRole('button', { name: 'הגעתי' }).click();
  await expect(mine.getByRole('heading', { name: new RegExp(full.split(' ')[0]) })).toBeVisible();
  const { data: row } = await coord.from('registrations').select('attendance').eq('event_id', ev.id).single();
  expect(row!.attendance).toBe('attended');
  expect(mineErrors, mineErrors.join('\n')).toEqual([]);
  await phoneCtx.close();
});
