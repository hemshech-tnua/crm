// Dev helper: screenshot a route (optionally signed in) at phone and desktop sizes.
// usage: node scripts/shot.mjs <hash-route> <out-prefix> [role] [width]
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const executablePath = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const [route = '/', out = 'shot', role, width] = process.argv.slice(2);
const base = process.env.APP_URL ?? 'http://127.0.0.1:3100/';
const browser = await chromium.launch({ executablePath });
const sizes = width ? [{ w: Number(width), h: 900, tag: width }] : [{ w: 390, h: 844, tag: 'phone' }, { w: 1366, h: 900, tag: 'desktop' }];
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  if (role) {
    await page.goto(base + '#/login');
    await page.getByLabel('אימייל').fill(`${role}@example.test`);
    await page.getByLabel('סיסמה').fill('Local-Test-2026');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await page.waitForURL(/#\/app/);
  }
  await page.goto(base + '#' + route);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-${s.tag}.png`, fullPage: true });
  if (errors.length) console.log(`[${s.tag}] console errors:\n` + errors.join('\n'));
  await page.close();
}
await browser.close();
