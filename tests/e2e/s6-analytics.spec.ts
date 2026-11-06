// Scenario 6 (analytics): build known data on an isolated site through the API, then check that the dashboard,
// the drill-down and the reports show exactly the numbers the definitions predict.
import { expect, test } from '@playwright/test';
import { makeEvent, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

test('dashboard and reports match the source data', async ({ page }) => {
  const admin = await staff('admin');
  const coord = await staff('coord');
  const { data: site } = await admin.from('sites').insert({ name: `מתחם דוחות ${Date.now()}` }).select('id').single();
  const src = async (key: string) => (await coord.from('acquisition_sources').select('id').eq('key', key).single()).data!.id as string;
  const friend = await src('friend');
  const ig = await src('instagram');
  const mk = async (n: string, s: string) => (await coord.from('participants').insert({ full_name: n, phone: phone(), first_source_id: s }).select('id').single()).data!.id as string;
  const A = await mk('אלף מדדים', friend);
  const B = await mk('בית מדדים', ig);
  const C = await mk('גימל מדדים', ig);
  const D = await mk('דלת מדדים', friend);
  const E1 = (await makeEvent({ site_id: site!.id, startsInMinutes: -14 * 24 * 60 })).id;
  const E2 = (await makeEvent({ site_id: site!.id, startsInMinutes: -7 * 24 * 60 })).id;
  const reg = async (e: string, p: string, came: boolean) => {
    const { data } = await coord.rpc('staff_register', { p_event_id: e, p_participant_id: p });
    if (came) await coord.rpc('staff_set_attendance', { p_registration_id: data.registration_id, p_attendance: 'attended' });
  };
  await reg(E1, A, true); await reg(E1, B, true); await reg(E1, C, false);
  await reg(E2, A, true); await reg(E2, D, true); await reg(E2, B, false);
  await coord.rpc('staff_complete_event', { p_event_id: E1 });
  await coord.rpc('staff_complete_event', { p_event_id: E2 });

  const errors = watchConsole(page);
  await loginAs(page, 'coord');
  await page.goto(`#/app/dashboard?site=${site!.id}&period=all&type=friday`);
  const goal = (label: string) => page.getByRole('button').filter({ hasText: label }).or(page.locator('div').filter({ hasText: label }).filter({ has: page.locator('.font-display') })).first();
  // 4 attendances / 2 meetings; 4 of 6 registered came; 1 of 3 came twice; 2 of 3 new came through a friend
  await expect(goal('ממוצע משתתפים למפגש')).toContainText('2.0');
  await expect(goal('הגיעו מתוך מי שנרשם')).toContainText('67%');
  await expect(goal('הגיעו ליותר ממפגש אחד')).toContainText('33%');
  await expect(goal('חדשים שהגיעו דרך חבר')).toContainText('67%');
  await expect(goal('דירוג ממוצע למפגש')).toContainText('—');

  // the number opens the people behind it
  await page.getByRole('button').filter({ hasText: 'הגיעו ליותר ממפגש אחד' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('אלף מדדים')).toBeVisible();
  await expect(dialog.getByText('בית מדדים')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'סגירה' }).click();

  // the events report lists both meetings with new/returning split
  await page.goto(`#/app/reports?tab=events&site=${site!.id}&period=all&type=friday`);
  await expect(page.getByText('2 מפגשים שהתקיימו')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  // newest first: E2 had 2 attendees (1 new, 1 returning), show rate 67%
  await expect(rows.nth(0).locator('td').nth(3)).toHaveText('2');
  await expect(rows.nth(0).locator('td').nth(4)).toHaveText('1');
  await expect(rows.nth(0).locator('td').nth(5)).toHaveText('1');
  await expect(rows.nth(0).locator('td').nth(6)).toHaveText('67%');
  expect(errors, errors.join('\n')).toEqual([]);
});
