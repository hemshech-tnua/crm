// The Friday landing page (#/friday): the next Friday meeting with "שמרו לי מקום" (carrying the referral), or a calm
// empty state when nothing is open.
import { expect, test } from '@playwright/test';
import { makeEvent } from '../api/helpers';
import { watchConsole } from './support';

test('shows the next Friday meeting and the CTA leads to /r/<code> with the referral', async ({ page }) => {
  await makeEvent({ title: 'מפגש שישי E2E' });
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/friday?ref=ig');

  await expect(page.getByRole('heading', { level: 1, name: 'בואו להמשיך תנועה' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'המפגש הקרוב' })).toBeVisible();
  const cta = page.getByTestId('friday-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toContainText(/שמרו לי מקום|רשימת ההמתנה/);
  await expect(cta).toHaveAttribute('href', /^#\/r\/[a-z0-9]+\?ref=ig$/);

  // phone first: the button is on the first screen
  const box = await cta.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);

  // no flyer yet: the section is not rendered
  await expect(page.getByRole('heading', { name: 'הפלייר' })).toHaveCount(0);

  const href = await cta.getAttribute('href');
  await cta.click();
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[?]/g, '\\?')}$`));
  expect(errors).toEqual([]);
});

test('with no open Friday meeting, a calm empty state and a way to reach the team', async ({ page }) => {
  await page.route('**/rpc/public_list_events', (r) => r.fulfill({ json: [] }));
  await page.goto('#/friday');

  await expect(page.getByTestId('friday-empty')).toContainText('המפגש הבא יפורסם בקרוב');
  await expect(page.getByTestId('friday-cta')).toHaveCount(0);
  // the program and the questions are still there
  await expect(page.getByRole('heading', { name: 'מה קורה בשישי' })).toBeVisible();
  await page.getByText('כמה זה עולה?').click();
  await expect(page.getByText('ההשתתפות בתשלום סמלי, הפרטים בהרשמה.')).toBeVisible();
});
