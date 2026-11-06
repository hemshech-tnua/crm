// Accessibility scan (axe-core, WCAG 2.1 A/AA) of the main screens. Dev helper.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { existsSync } from 'node:fs';
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const base = process.env.APP_URL ?? 'http://127.0.0.1:3100/';
const browser = await chromium.launch({ executablePath });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' });
const page = await ctx.newPage();
const scan = async (label) => {
  await page.waitForTimeout(1200);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  console.log('\n## ' + label + ': ' + r.violations.length + ' violations');
  for (const v of r.violations) console.log('- [' + v.impact + '] ' + v.id + ': ' + v.help + ' (' + v.nodes.length + ') e.g. ' + v.nodes[0].target.join(' ') + ' :: ' + (v.nodes[0].failureSummary ?? '').split('\n')[1]);
};
for (const [label, route] of [['public home', '#/'], ['register', '#/r/4qujuzr7'], ['privacy', '#/privacy'], ['propose', '#/join'], ['login', '#/login']]) {
  await page.goto(base + route); await scan(label);
}
await page.goto(base + '#/login');
await page.getByLabel('אימייל').fill('admin@example.test');
await page.locator('input[autocomplete="current-password"]').fill('Local-Test-2026');
await page.getByRole('button', { name: 'כניסה' }).click();
await page.waitForURL(/#\/app/);
for (const [label, route] of [['dashboard', '#/app/dashboard'], ['events', '#/app/events'], ['event summary', '#/app/events/93d9fec6-04b7-42c6-8d16-886b691620c1?tab=summary'], ['event registrations', '#/app/events/93d9fec6-04b7-42c6-8d16-886b691620c1?tab=registrations'], ['door', '#/app/events/93d9fec6-04b7-42c6-8d16-886b691620c1/door'], ['participants', '#/app/participants'], ['participant card', '#/app/participants/2dad0fee-516f-43aa-9d0c-b735d9ce8833'], ['followups', '#/app/followups'], ['speakers', '#/app/speakers'], ['reports', '#/app/reports'], ['settings', '#/app/settings']]) {
  await page.goto(base + route); await scan(label);
}
await browser.close();
