import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user/b8a3f46b-ef2c-5f6a-977b-3727f03fcb95/scratchpad/r';
const specs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://127.0.0.1:3100/' });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto('/#/login');
await page.getByLabel('טלפון נייד או אימייל').fill('admin@example.test');
await page.locator('input[autocomplete="current-password"]').fill('Local-Test-2026');
await page.getByRole('button', { name: 'כניסה', exact: true }).click();
await page.waitForURL(/#\/(app|password)/);
await page.goto('/#/app/events/71b78afb-d8e0-4251-8444-0468dd1f114b?tab=marketing');
await page.waitForTimeout(1500);
const results = await page.evaluate(async (specs) => {
  const m = await import('/src/features/events/marketing.ts');
  const ph = await import('/src/features/events/photos.ts');
  await m.loadPostFonts();
  const out = [];
  const imgs = {};
  for (const s of specs) {
    let photo = null, art = undefined;
    if (s.photo) {
      const p = ph.PHOTOS.find((x) => x.key === s.photo);
      imgs[s.photo] ??= await m.loadImage(p.url);
      photo = imgs[s.photo]; art = p;
    }
    const c = document.createElement('canvas');
    m.drawPost(c, s.content, s.format, { layout: s.layout, theme: s.theme, photo, art });
    out.push({ name: s.name, url: c.toDataURL('image/png') });
  }
  return out;
}, specs);
for (const r of results) fs.writeFileSync(`${OUT}/${r.name}.png`, Buffer.from(r.url.split(',')[1], 'base64'));
console.log('rendered', results.length);
await browser.close();
