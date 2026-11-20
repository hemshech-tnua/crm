// The coordinator's work screens: a new meeting's past-due checklist asks one question instead of a wall of
// "באיחור", and the follow-ups a meeting left behind open filtered to it, with "לקחת את כולן".
import { expect, test } from '@playwright/test';
import { makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

test('a meeting created late: one question about the past-due tasks, ticked in one tap and undone', async ({ page }) => {
  const errors = watchConsole(page);
  // a Friday meeting in five days: its "two weeks before" tasks were due before it existed
  const ev = await makeEvent({ title: `מפגש שישי · הכנה מאוחרת ${Date.now().toString(36)}`, startsInMinutes: 5 * 24 * 60 });
  const coord = await staff('coord');
  const { data: late } = await coord.from('event_tasks').select('id').eq('event_id', ev.id).eq('kind', 'task')
    .is('done_at', null).lt('due_date', new Date().toISOString().slice(0, 10));
  const n = late!.length;
  expect(n).toBeGreaterThan(1);

  await loginAs(page, 'coord');
  await page.goto(`#/app/events/${ev.id}?tab=prep`);
  await expect(page.getByText(`${n} משימות היו אמורות להיעשות כבר. לסמן שבוצעו?`)).toBeVisible();
  // no red badge on every row
  await expect(page.getByText('באיחור', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: `סימון ${n} כבוצעו` }).click();
  await expect(page.getByText('היו אמורות להיעשות כבר')).toBeHidden();
  await expect.poll(async () => {
    const { count } = await coord.from('event_tasks').select('id', { count: 'exact', head: true }).in('id', late!.map((t) => t.id)).not('done_at', 'is', null);
    return count;
  }).toBe(n);

  // "החזרה" puts them back as they were
  await page.getByRole('button', { name: 'החזרה' }).click();
  await expect(page.getByText(`${n} משימות היו אמורות להיעשות כבר`)).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test("a closed meeting's follow-ups: filtered to it, taken in one tap", async ({ page }) => {
  const errors = watchConsole(page);
  const title = `מפגש שישי · מעקב ${Date.now().toString(36)}`;
  const ev = await makeEvent({ title, startsInMinutes: -2 * 24 * 60 });
  const admin = await staff('admin');
  const people = await Promise.all([0, 1, 2].map(async () => {
    const { data, error } = await admin.from('participants').insert({ full_name: name(), phone: phone() }).select('id').single();
    if (error) throw error;
    return data.id as string;
  }));
  const { data: tasks, error } = await admin.from('follow_ups').insert(people.map((participant_id) => ({
    participant_id, event_id: ev.id, type: 'no_show', title: 'הרשמה בלי הגעה: שיחה', due_date: new Date().toISOString().slice(0, 10),
  }))).select('id');
  if (error) throw error;

  await loginAs(page, 'coord');
  await page.goto(`#/app/followups?event=${ev.id}`);
  const scope = page.getByRole('region', { name: 'משימות של מפגש אחד' });
  await expect(scope).toContainText(title);
  await expect(scope).toContainText('3 פתוחות, 3 בלי אחראי');
  await expect(page.getByRole('tab', { name: /פתוחות/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('בלי אחראי', { exact: true })).toHaveCount(3);

  await scope.getByRole('button', { name: 'לקחת את כולן' }).click();
  await expect(page.getByText('3 משימות עברו אליך')).toBeVisible();
  const coord = await staff('coord');
  const { data: me } = await coord.rpc('staff_me');
  await expect.poll(async () => {
    const { data } = await coord.from('follow_ups').select('assignee_id').in('id', tasks!.map((t) => t.id));
    return data!.every((t) => t.assignee_id === (me as { user_id: string }).user_id);
  }).toBe(true);
  await expect(scope.getByRole('button', { name: 'לקחת את כולן' })).toBeHidden();

  // back to every task
  await scope.getByRole('button', { name: 'לכל המשימות' }).click();
  await expect(page).not.toHaveURL(/event=/);
  expect(errors, errors.join('\n')).toEqual([]);
});
