// Accessibility regression: axe-core (WCAG 2.1 A/AA) on the main public and staff screens must report no violations.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { makeEvent, staff } from '../api/helpers';
import { loginAs } from './support';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('public pages have no WCAG A/AA violations', async ({ page }) => {
  const ev = await makeEvent({ title: 'נגישות E2E' });
  for (const route of ['#/', `#/r/${ev.public_code}`, '#/privacy', '#/join', '#/login']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400); // let colour transitions (e.g. the previously active nav item) settle
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => `${route} ${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  }
});

test('staff screens have no WCAG A/AA violations', async ({ page }) => {
  const ev = await makeEvent({ title: 'נגישות צוות E2E', startsInMinutes: 20 });
  const coord = await staff('coord');
  const { data: p } = await coord.from('participants').select('id').limit(1).single();
  await loginAs(page, 'admin');
  for (const route of ['#/app/dashboard', '#/app/events', `#/app/events/${ev.id}`, `#/app/events/${ev.id}?tab=registrations`, `#/app/events/${ev.id}/door`,
    '#/app/participants', p ? `#/app/participants/${p.id}` : '#/app/participants', '#/app/followups', '#/app/speakers', '#/app/reports', '#/app/settings']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400); // let colour transitions (e.g. the previously active nav item) settle
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => `${route} ${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  }
});
