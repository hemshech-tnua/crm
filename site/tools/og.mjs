#!/usr/bin/env node
// Per-page share images (Open Graph / WhatsApp previews): site/assets/og/<page>-<lang>.jpg + og.json (texts and alts).
// Run once after a change; the images are committed (the site build only copies them; partials/head.mjs reads og.json).
//
//   node site/tools/og.mjs [--only friday,home] [--html <dir>]   (needs Playwright's Chromium and python3 + Pillow)
//
// Brief (r2 marketing §5): 1200×630, navy (never white), the page's line (≤ 6 words) inside the centre 1000×500 safe
// area and narrow enough to survive WhatsApp's square crop, the mark + wordmark bottom-right, one 45° stripe run in the
// opposite corner (stripe = gap), the page's icon from the site's set above the line. JPEG ≤ 250 KB.
// A Canva-generated version was tried first (see the r2 Team I report) and rejected: it mirrored the Hebrew "?" and
// retyped the wordmark with a typo; this renderer uses the official logo paths, the site's font and the icon set.
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as brand from '../lib/brand.mjs';
import { loadIcons } from '../lib/icons.mjs';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(SITE, '..');
const OUT = join(SITE, 'assets/og');
const FONTS = join(ROOT, 'src/assets/fonts');
const MAX_BYTES = 250 * 1024;

/** page id → icon + the line on the image (≤ 6 words), per language. Hebrew name stays whole (NBSP added below). */
export const OG = {
  home: { icon: null, he: 'בואו להמשיך תנועה', en: 'Come keep moving\nwith us' },
  friday: { icon: 'coffee', he: 'אימון, קפה והרצאה.\nנתראה בשישי?', en: 'Training, coffee, a talk.\nSee you Friday?' },
  calendar: { icon: 'calendar-3', he: 'המפגשים הקרובים', en: 'Upcoming meetings' },
  meetings: { icon: 'kettlebell', he: 'המפגשים של\nהמשך תנועה', en: 'Our meetings' },
  evenings: { icon: 'bonfire', he: 'ערבי נשים\nומפגשים נוספים', en: 'Women’s evenings\nand more' },
  about: { icon: 'route', he: 'הסיפור של\nהמשך תנועה', en: 'The story of\nHemshech Tnua' },
  association: { icon: 'center', he: 'העמותה', en: 'The association' },
  team: { icon: 'friend', he: 'המייסדים ומי\nשמוביל את התנועה', en: 'The founders\nand who leads us' },
  gallery: { icon: 'bonfire', he: 'תמונות ממפגשים\nואירועים', en: 'Photos from\nour meetings' },
  faq: { icon: 'alone', he: 'מה שואלים\nלפני שבאים', en: 'What people ask\nbefore coming' },
  involved: { icon: 'volunteer', he: 'להיות חלק', en: 'Get involved' },
  volunteer: { icon: 'greeter', he: 'צוות כניסה,\nהרצאה או אימון', en: 'Welcome team,\na talk or training' },
  membership: { icon: 'calendar-add', he: 'הצטרפות לעמותה', en: 'Join the association' },
  support: { icon: 'heart-hand', he: 'לתמוך\nבהמשך תנועה', en: 'Support\nHemshech Tnua' },
  donate: { icon: 'heart-hand', he: 'תרומה\nוהתנדבות', en: 'Give and\nvolunteer' },
  partners: { icon: 'partner', he: 'לחברות\nולארגונים', en: 'For companies\nand organisations' },
  contact: { icon: 'whatsapp', he: 'שאלה?\nכתבו לנו', en: 'A question?\nWrite to us' },
};

const ALT = {
  he: (line) => `״${line}״ בבז׳ על רקע כחול כהה, עם הסמל והשם המשך תנועה.`,
  en: (line) => `“${line}” in beige on navy, with the המשך תנועה mark and name.`,
};

const NAVY = '#142837';
const BEIGE = '#ebdcb9';
const icons = loadIcons();
const keep = (s) => s.replace(/(המשך) (תנועה)/g, '$1 $2').replace(/Hemshech Tnua/g, 'Hemshech Tnua');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page(id, lang) {
  const o = OG[id];
  const lines = keep(o[lang]).split('\n');
  const ic = o.icon && icons[o.icon];
  const mark = id === 'home'
    ? String(brand.logo({ variant: 'symbol', className: 'hero-mark' }))
    : ic ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">${ic.body}</svg>` : '';
  const font = (f) => pathToFileURL(join(FONTS, f)).href;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><style>
@font-face{font-family:GS;src:url(${font('google-sans-hebrew-wght-normal.woff2')}) format('woff2');font-weight:100 900;unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:GS;src:url(${font('google-sans-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}
*{margin:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden;background:${NAVY};color:${BEIGE};font-family:GS,sans-serif}
.stripes{position:absolute;inset-block-start:0;left:0;width:300px;height:300px;color:${BEIGE}}
.lockup{position:absolute;bottom:52px;right:56px;height:92px;width:auto;color:${BEIGE}}
.c{position:absolute;inset:60px 100px 120px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:30px}
.icon{width:128px;height:128px}
.hero-mark{height:120px;width:auto}
h1{font-weight:700;font-size:96px;line-height:1.06;letter-spacing:-0.015em}
h1 span{display:block;white-space:nowrap}
</style><body>
${String(brand.stripes({ width: 300, height: 300, unit: 30, count: 3, dir: 'cut', anchor: 'tl', className: 'stripes' }))}
<div class="c">${mark}<h1>${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</h1></div>
${String(brand.logo({ variant: 'lockup', className: 'lockup' }))}
</body></html>`;
}

/** Shrink the line until its widest row fits 860px (centred, so a square crop keeps its middle) and the block fits the safe area. */
async function fit(tab) {
  await tab.evaluate(() => {
    const h = document.querySelector('h1');
    const c = document.querySelector('.c');
    let size = 96;
    const wide = () => Math.max(...[...h.children].map((s) => s.getBoundingClientRect().width));
    while (size > 56 && (wide() > 860 || c.scrollHeight > c.clientHeight)) h.style.fontSize = `${(size -= 2)}px`;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
  const htmlDir = args.includes('--html') ? args[args.indexOf('--html') + 1] : null;
  const require = createRequire(join(ROOT, 'package.json'));
  const { chromium } = require('playwright');
  const tmp = join(tmpdir(), 'site-og');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const manifest = {};
  for (const id of Object.keys(OG)) {
    manifest[id] = {};
    for (const lang of ['he', 'en']) {
      const line = OG[id][lang].replace(/\n/g, ' ');
      manifest[id][lang] = { image: `og/${id}-${lang}.jpg`, alt: ALT[lang](line) };
      if (only && !only.includes(id)) continue;
      const doc = page(id, lang);
      const f = join(htmlDir ?? tmp, `${id}-${lang}.html`);
      if (htmlDir) mkdirSync(htmlDir, { recursive: true });
      writeFileSync(f, doc);
      await tab.goto(pathToFileURL(f).href);
      await tab.evaluate(() => document.fonts.ready);
      await fit(tab);
      const png = join(tmp, `${id}-${lang}.png`);
      await tab.screenshot({ path: png });
      const jpg = join(OUT, `${id}-${lang}.jpg`);
      const py = spawnSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
im.save(sys.argv[2], 'JPEG', quality=88, optimize=True, progressive=True, subsampling=0)
`, png, jpg], { encoding: 'utf8' });
      if (py.status) throw new Error(py.stderr);
      const size = statSync(jpg).size;
      if (size > MAX_BYTES) throw new Error(`${jpg}: ${size} bytes > 250 KB`);
      console.log(`og: ${id}-${lang}.jpg ${(size / 1024).toFixed(0)} KB`);
    }
  }
  await browser.close();
  writeFileSync(join(OUT, 'og.json'), JSON.stringify(manifest, null, 2) + '\n');
  rmSync(tmp, { recursive: true, force: true });
}
