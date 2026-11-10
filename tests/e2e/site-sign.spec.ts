// The permanent entrance sign: one QR for every meeting at a site.
import { expect, test } from '@playwright/test';
import { makeEvent, staff } from '../api/helpers';
import { watchConsole } from './support';

test('@phone the permanent sign leads to the meeting open now, and says when the next one opens', async ({ page }) => {
  const errors = watchConsole(page);
  const admin = await staff('admin');
  const { data: site } = await admin.from('sites').insert({ name: `מתחם שלט ${Date.now().toString(36)}` }).select('id, checkin_code').single();

  const next = await makeEvent({ site_id: site!.id, title: 'המפגש הבא (בדיקה)', startsInMinutes: 6 * 60 });
  await page.goto(`#/s/${site!.checkin_code}`);
  await expect(page.getByRole('heading', { name: 'כרגע אין מפגש פתוח לצ׳ק־אין' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'להרשמה למפגש' })).toHaveAttribute('href', new RegExp(`#/r/${next.public_code}$`));

  const now = await makeEvent({ site_id: site!.id, title: 'מפגש עכשיו (בדיקה)', startsInMinutes: 20 });
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#/c/${now.checkin_code}$`));
  await expect(page.getByLabel('מספר הטלפון שלך')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
