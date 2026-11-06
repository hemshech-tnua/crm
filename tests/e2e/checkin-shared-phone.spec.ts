// Simulation finding U2/U6: one phone registered two people; check-in asks who arrived, and "that's not me" undoes a mistake.
import { expect, test } from '@playwright/test';
import { makeEvent, name, phone, staff } from '../api/helpers';
import { watchConsole } from './support';

test('a phone that registered two people asks who arrived; a mistaken check-in can be undone', async ({ page }) => {
  const errors = watchConsole(page);
  const ev = await makeEvent({ title: `טלפון משותף ${Date.now().toString(36)}`, startsInMinutes: 25 });
  const people = [{ n: `דן ${name().split(' ')[1]}`, p: phone() }, { n: `יעל ${name().split(' ')[1]}`, p: phone() }];
  await page.goto(`#/r/${ev.public_code}`);
  for (const [i, x] of people.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'רישום של מישהו נוסף מהטלפון הזה' }).click();
    await page.getByLabel('שם מלא').fill(x.n);
    await page.getByLabel('טלפון נייד').fill(x.p);
    await page.getByLabel('עיר מגורים').fill('מודיעין');
    await page.getByLabel('גיל').fill('30');
    await page.getByRole('radio', { name: /אינסטגרם/ }).check();
    await page.getByRole('button', { name: 'הרשמה', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'נרשמת!' })).toBeVisible();
  }
  await page.goto(`#/c/${ev.checkin_code}`);
  await expect(page.getByText('מהטלפון הזה נרשמו כמה אנשים. מי הגיע/ה?')).toBeVisible();
  await page.getByRole('button', { name: `${people[0].n.split(' ')[0]} הגיע/ה` }).click();
  await expect(page.getByRole('heading', { name: new RegExp(people[0].n.split(' ')[0]) })).toBeVisible();

  const coord = await staff('coord');
  const status = async () => {
    const { data } = await coord.rpc('staff_checkin_list', { p_event_id: ev.id });
    return Object.fromEntries((data as any[]).map((r) => [r.display_name, r.attendance]));
  };
  expect(await status()).toEqual({ [people[0].n]: 'attended', [people[1].n]: 'unknown' });

  // a mistaken check-in by phone number is undone with "that's not me"
  await page.getByRole('button', { name: 'צ׳ק־אין של מישהו נוסף מהטלפון הזה' }).click();
  await page.getByRole('button', { name: /מישהו אחר\? צ׳ק־אין עם מספר טלפון/ }).click();
  await page.getByLabel('מספר הטלפון שלך').fill(people[1].p);
  await page.getByRole('button', { name: 'צ׳ק־אין' }).click();
  await page.getByRole('button', { name: /זה לא אני/ }).click();
  await expect(page.getByText('הצ׳ק־אין בוטל. אפשר להקליד שוב את המספר הנכון.')).toBeVisible();
  expect(await status()).toEqual({ [people[0].n]: 'attended', [people[1].n]: 'unknown' });
  expect(errors, errors.join('\n')).toEqual([]);
});
