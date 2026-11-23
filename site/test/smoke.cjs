#!/usr/bin/env node
// Browser smoke test of the built site (run `npm run build:site` first, or pass --build).
//   node site/test/smoke.cjs [--build] [--preview] [--shots <dir>] [--port 4183] [--out <built site folder>]
// --out serves another build folder (default dist/site), e.g. a team's SITE_OUT=…/out-x/crm/site build.
// Loads every page of the sitemap + both 404s at 390 and 1440 px and checks: no console errors / CSP violations, no
// horizontal overflow, no white backgrounds, one h1, lang/dir, landmarks, skip link first in tab order, 44px targets,
// the mobile menu (aria-expanded, focus trap, Esc, focus return), live meetings (filled / empty / error states, links
// into the CRM), the WhatsApp slot, reveal + reduced motion, and an axe-core WCAG 2.2 AA scan (@axe-core/playwright,
// already a devDependency). The Supabase RPCs are mocked: the test never calls production.
'use strict';
const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const PORT = Number(arg('--port', process.env.SMOKE_PORT || 4183));
const SHOTS = arg('--shots', null);
const OUT = path.resolve(arg('--out', path.join(ROOT, 'dist/site')));
const BASE = process.env.SITE_BASE || '/crm/site/';
const ORIGIN = `http://127.0.0.1:${PORT}`;
// 390 and 1440 are the required pair; 320 (smallest phone) and 768 (tablet) catch overflow and in-between layouts.
const VIEWPORTS = (process.env.SMOKE_WIDTHS || '320,390,768,1440').split(',').map((w) => ({ name: w, width: Number(w), height: Number(w) >= 1024 ? 900 : Number(w) >= 768 ? 1024 : 844 }));
let AxeBuilder = null;
try {
  ({ AxeBuilder } = require('@axe-core/playwright'));
} catch {
  /* optional */
}

const failures = [];
const notes = [];
const fail = (where, msg) => { failures.push(`${where}: ${msg}`); console.error(`  ✗ ${where}: ${msg}`); };

// ───────────── fixtures (mocked RPC answers; shape = private.event_public) ─────────────
const day = (d, h, m = 0) => {
  const t = new Date(Date.now() + d * 86400e3);
  t.setUTCHours(h - 2, m, 0, 0);
  return t.toISOString();
};
const EVENTS = [
  { code: 'fri1', title: 'מפגש שישי', type: 'friday', starts_at: day(3, 8), ends_at: day(3, 11), location: 'מיקום לדוגמה (נתוני בדיקה)', site_name: 'מיקום לדוגמה', activity_name: 'אימון פונקציונלי', instructor_name: null, speaker_name: null, lecture_topic: 'נושא הרצאה לדוגמה', status: 'open', registration_open: true, is_full: false, spots_left: 6, waitlist_enabled: true, price: null },
  { code: 'bon1', title: 'ערב מדורה', type: 'bonfire', starts_at: day(6, 19), ends_at: day(6, 22), location: 'מיקום לדוגמה (נתוני בדיקה)', site_name: 'מיקום לדוגמה', activity_name: null, instructor_name: null, speaker_name: null, lecture_topic: null, status: 'open', registration_open: true, is_full: true, spots_left: 0, waitlist_enabled: true, price: 30 },
  { code: 'oth1', title: 'ערב נשים', type: 'other', starts_at: day(9, 19), ends_at: day(9, 21, 30), location: null, site_name: 'מיקום לדוגמה', activity_name: null, instructor_name: null, speaker_name: null, lecture_topic: null, status: 'open', registration_open: true, is_full: false, spots_left: null, waitlist_enabled: false, price: null },
  { code: 'fri2', title: 'מפגש שישי', type: 'friday', starts_at: day(10, 8), ends_at: day(10, 11), location: 'מיקום לדוגמה (נתוני בדיקה)', site_name: 'מיקום לדוגמה', activity_name: null, instructor_name: null, speaker_name: null, lecture_topic: null, status: 'open', registration_open: true, is_full: true, spots_left: 0, waitlist_enabled: false, price: null },
];
const ORG = { org_name: 'המשך תנועה', contact_phone: '+972501234567' };

async function mock(ctx, mode = 'ok') {
  await ctx.route('**/rest/v1/rpc/**', (route) => {
    const fn = route.request().url().split('/rpc/')[1];
    if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
    if (fn === 'public_list_events') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mode === 'empty' ? [] : EVENTS) });
    if (fn === 'public_org_info') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORG) });
    return route.fulfill({ status: 404, body: '{}' });
  });
}

function pagesFromSitemap() {
  const xml = fs.readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  return [...locs, `${BASE}no-such-page/`, `${BASE}en/no-such-page/`];
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
/** A static server for the built folder at BASE, with the site's own 404 pages (like a host configured for them). */
function serve(dir) {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (!u.pathname.startsWith(BASE)) { res.writeHead(302, { Location: BASE }); return res.end(); }
    let f = path.join(dir, decodeURIComponent(u.pathname.slice(BASE.length)));
    if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
      if (!u.pathname.endsWith('/')) { res.writeHead(301, { Location: u.pathname + '/' }); return res.end(); }
      f = path.join(f, 'index.html');
    }
    let status = 200;
    if (!fs.existsSync(f)) { status = 404; f = path.join(dir, u.pathname.startsWith(BASE + 'en/') ? 'en/404.html' : '404.html'); }
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  server.listen(PORT, '127.0.0.1');
  return server;
}

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${ORIGIN}${BASE}`);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-events]')].every((b) => b.getAttribute('aria-busy') === 'false') && [...document.querySelectorAll('[data-next]')].every((b) => !b.hasAttribute('aria-busy')), null, { timeout: 5000 }).catch(() => {});
}

/** Scroll through the page so every reveal has fired (for checks and full-page screenshots). */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 80));
    }
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 900));
  });
}

async function checkPage(browser, url, vp) {
  const where = `${url} @${vp.name}`;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await mock(ctx);
  const page = await ctx.newPage();
  const errors = [];
  // the 404 page's own "404" status is expected; anything else in the console is a failure
  page.on('console', (m) => m.type() === 'error' && !(m.location().url === ORIGIN + url && /404/.test(m.text())) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const res = await page.goto(ORIGIN + url);
  const is404 = url.includes('no-such-page');
  if (is404 !== (res.status() === 404)) fail(where, `HTTP ${res.status()}`);
  await settle(page);

  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const white = [];
    for (const el of document.querySelectorAll('body, body *')) {
      const bg = getComputedStyle(el).backgroundColor;
      if (/^rgba?\(255, 255, 255(, 1)?\)$/.test(bg)) white.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
    }
    const small = [];
    const sel = '.btn, .chip, .menu-toggle, .menu-close, .site-nav__link, .lang-switch, .brand, .site-footer__list a, .site-footer__base a, .link, .link-arrow, .row, .meet, .faq summary, .chapters__nav a, .skip-link';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || cs.visibility === 'hidden' || el.closest('[hidden], dialog:not([open])') || el.classList.contains('skip-link')) continue;
      if (r.height < 43.5 || r.width < 43.5) small.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return {
      lang: de.lang,
      dir: de.dir,
      h1: document.querySelectorAll('h1').length,
      header: !!document.querySelector('body > header'),
      main: !!document.querySelector('main#main'),
      footer: !!document.querySelector('body > footer'),
      overflow: de.scrollWidth - de.clientWidth,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      white,
      small,
      font: getComputedStyle(document.body).fontFamily,
      fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
      events: document.querySelectorAll('[data-events] .event-card:not(.event-card--skeleton)').length,
      hasEvents: !!document.querySelector('[data-events]'),
      badEventLinks: [...document.querySelectorAll('[data-events] .events__list a')].map((a) => a.href).filter((h) => !/^https:\/\/hemshech-tnua\.github\.io\/crm\/#\/(r|e)\/[a-z0-9]+$/.test(h)),
      nextUnfilled: [...document.querySelectorAll('[data-next]:not([data-cta-bar])')].filter((n) => !n.hasAttribute('data-filled')).length,
      badNextLinks: [...document.querySelectorAll('[data-next] [data-next-cta]')].map((a) => a.href).filter((h) => !/^https:\/\/hemshech-tnua\.github\.io\/crm\/#\/r\/[a-z0-9]+$/.test(h)),
      phone: [...document.querySelectorAll('[data-org-phone="whatsapp"]')].map((a) => ({ href: a.href, hidden: a.hidden || !!a.closest('[hidden]') })),
    };
  });
  const expectLang = url.startsWith(BASE + 'en/') ? ['en', 'ltr'] : ['he', 'rtl'];
  if (info.lang !== expectLang[0] || info.dir !== expectLang[1]) fail(where, `lang/dir ${info.lang}/${info.dir}`);
  if (info.h1 !== 1) fail(where, `${info.h1} h1 elements`);
  if (!info.header || !info.main || !info.footer) fail(where, 'missing a landmark (header / main#main / footer)');
  if (info.overflow > 0) fail(where, `horizontal overflow of ${info.overflow}px`);
  if (/255, 255, 255/.test(info.bodyBg)) fail(where, 'white body background');
  if (info.white.length) fail(where, `white backgrounds: ${info.white.slice(0, 5).join(', ')}`);
  if (info.small.length) fail(where, `targets under 44px: ${info.small.slice(0, 6).join(' | ')}`);
  if (!info.fontsLoaded.includes('Google Sans')) fail(where, 'Google Sans did not load');
  if (info.hasEvents && info.events === 0) fail(where, 'meetings list stayed empty with mocked data');
  if (info.badEventLinks.length) fail(where, `meeting links not into the CRM: ${info.badEventLinks[0]}`);
  if (info.nextUnfilled) fail(where, 'the next-meeting card was not filled from the mocked data');
  if (info.badNextLinks.length) fail(where, `next-meeting CTA not into CRM registration: ${info.badNextLinks[0]}`);
  for (const p of info.phone) if (p.hidden || !p.href.startsWith('https://wa.me/972501234567')) fail(where, `WhatsApp slot ${JSON.stringify(p)}`);

  // keyboard: the first Tab lands on the visible skip link, which moves focus to <main>
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    return { cls: a.className, visible: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 };
  });
  if (skip.cls !== 'skip-link' || !skip.visible) fail(where, `first Tab → ${skip.cls} (visible ${skip.visible})`);
  await page.keyboard.press('Enter');
  if ((await page.evaluate(() => document.activeElement.id)) !== 'main') fail(where, 'skip link did not move focus to main');

  // the menu: open, trap, Esc, return focus
  const toggle = page.locator('[data-menu-open]');
  if (await toggle.isVisible()) {
    await toggle.click();
    const opened = await page.evaluate(() => ({ open: document.querySelector('[data-menu]').open, exp: document.querySelector('[data-menu-open]').getAttribute('aria-expanded'), inside: !!document.activeElement.closest('[data-menu]') }));
    if (!opened.open || opened.exp !== 'true' || !opened.inside) fail(where, `menu open state ${JSON.stringify(opened)}`);
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => !!document.activeElement.closest('[data-menu]')))) fail(where, 'focus escaped the open menu');
    if (SHOTS && vp.name === '390' && !is404) await shot(page, url, vp, 'menu', false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-menu-open]').getAttribute('aria-expanded') === 'false', null, { timeout: 2000 }).catch(() => {});
    const closed = await page.evaluate(() => ({ open: document.querySelector('[data-menu]').open, exp: document.querySelector('[data-menu-open]').getAttribute('aria-expanded'), back: document.activeElement.hasAttribute('data-menu-open') }));
    if (closed.open || closed.exp !== 'false' || !closed.back) fail(where, `menu close state ${JSON.stringify(closed)}`);
  } else if (vp.width < 1024) fail(where, 'menu button not visible on a phone');

  // phone CTA bar: hidden at the top, slides in once the page's CTA has scrolled away, never over the open menu
  if (vp.width < 1024 && (await page.locator('[data-cta-bar]').count())) {
    const top = await page.evaluate(() => getComputedStyle(document.querySelector('[data-cta-bar]')).visibility);
    if (top !== 'hidden') fail(where, 'CTA bar visible at the top of the page');
    await page.evaluate(() => window.scrollTo({ top: Math.max(innerHeight * 2, document.querySelector('[data-hero-cta]')?.getBoundingClientRect().bottom + scrollY + innerHeight || 0), behavior: 'instant' }));
    await page.waitForTimeout(450);
    const bar = await page.evaluate(() => { const b = document.querySelector('[data-cta-bar]'); const r = b.getBoundingClientRect(); return { shown: b.hasAttribute('data-shown'), vis: getComputedStyle(b).visibility, inView: r.bottom <= innerHeight + 1 && r.top < innerHeight, href: b.querySelector('a').href }; });
    if (!bar.shown || bar.vis !== 'visible' || !bar.inView) fail(where, `CTA bar did not appear after scrolling ${JSON.stringify(bar)}`);
    if (SHOTS && vp.name === '390') await shot(page, url, vp, 'ctabar', false);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }
  // reveals: after scrolling through, nothing stays hidden
  await scrollThrough(page);
  const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-reveal], [data-reveal=""] > *, [data-reveal="group"] > *')].filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length);
  if (hidden) fail(where, `${hidden} [data-reveal] elements still hidden after scrolling`);
  if (SHOTS) await shot(page, url, vp, 'page', true);

  if (errors.length) fail(where, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

async function shot(page, url, vp, kind, fullPage) {
  const name = (url.replace(BASE, '').replace(/\/$/, '').replace(/\//g, '_') || 'he_home').replace(/^en$/, 'en_home');
  const file = path.join(SHOTS, `${name}-${vp.name}${kind === 'page' ? '' : '-' + kind}.png`);
  await page.screenshot({ path: file, fullPage });
  notes.push(`screenshot ${file}`);
}

async function checkStates(browser) {
  for (const mode of ['empty', 'error']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mock(ctx, mode);
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}${BASE}`);
    await settle(page);
    await page.waitForSelector('.events__message', { timeout: 8000 }).catch(() => {});
    const st = await page.evaluate(() => ({ msg: document.querySelector('.events__message')?.textContent ?? '', retry: !!document.querySelector('.events__message button'), fallback: !!document.querySelector('.events__more a[href*="/crm/#/"]'), next: document.querySelector('.next [data-next-when]')?.textContent ?? '', nextHref: document.querySelector('.next [data-next-cta]')?.href ?? '' }));
    if (!st.next) fail(`next card ${mode}`, 'no message in the next-meeting card');
    if (mode === 'error' && !/\/crm\/#\/$/.test(st.nextHref)) fail('next card error', `CTA should fall back to the CRM meetings list, got ${st.nextHref}`);
    if (!st.msg) fail(`events ${mode}`, 'no message shown');
    if (mode === 'error' && !st.retry) fail('events error', 'no retry button');
    if (!st.fallback) fail(`events ${mode}`, 'no fallback link to the CRM');
    if (SHOTS) {
      await page.locator('[data-events]').scrollIntoViewIfNeeded();
      await page.locator('[data-events]').screenshot({ path: path.join(SHOTS, `events-${mode}-390.png`) });
    }
    await ctx.close();
  }
  // reduced motion: everything visible without scrolling
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await mock(ctx);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}${BASE}`);
  await settle(page);
  const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-reveal], [data-reveal] > *, [data-load], [data-wipe]')].filter((el) => Number(getComputedStyle(el).opacity) < 0.99 || getComputedStyle(el).clipPath !== 'none').length);
  if (hidden) fail('reduced motion', `${hidden} elements hidden or clipped`);
  if (await page.evaluate(() => document.documentElement.classList.contains('js-reveal'))) fail('reduced motion', 'reveal mode was switched on');
  await ctx.close();
}

async function axeScan(browser, urls) {
  if (!AxeBuilder) return notes.push('axe: @axe-core/playwright not installed, skipped');
  // axe needs to inject a script: this context bypasses the page CSP (the CSP itself is checked in the other runs)
  for (const vp of VIEWPORTS.filter((v) => ['390', '1440'].includes(v.name))) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, bypassCSP: true, reducedMotion: 'reduce' });
    await mock(ctx);
    for (const url of urls) {
      const page = await ctx.newPage();
      await page.goto(ORIGIN + url);
      await settle(page);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
      for (const v of r.violations) {
        const msg = `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help} — ${v.nodes[0]?.target.join(' ')}`;
        if (['serious', 'critical'].includes(v.impact)) fail(`axe ${url} @${vp.name}`, msg);
        else notes.push(`axe ${url} @${vp.name}: ${msg}`);
      }
      await page.close();
    }
    await ctx.close();
  }
}

(async () => {
  if (argv.includes('--build')) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'site/build.mjs'), ...(argv.includes('--preview') ? ['--preview'] : []), '--quiet'], { stdio: 'inherit', env: { ...process.env, ...(argv.includes('--out') ? { SITE_OUT: OUT } : {}) } });
    if (r.status !== 0) process.exit(1);
  }
  if (!fs.existsSync(path.join(OUT, 'sitemap.xml'))) {
    console.error(`${OUT} is not built: run \`npm run build:site\` (or pass --build)`);
    process.exit(1);
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const server = serve(OUT);
  const executablePath = process.env.PW_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({ executablePath });
    const urls = pagesFromSitemap();
    for (const vp of VIEWPORTS) for (const url of urls) { await checkPage(browser, url, vp); if (argv.includes('--verbose')) console.log(`  · ${url} @${vp.name}`); }
    await checkStates(browser);
    await axeScan(browser, urls);
    console.log(`checked ${urls.length} pages × ${VIEWPORTS.length} viewports`);
  } catch (e) {
    failures.push(`crashed: ${e.stack || e}`);
  } finally {
    await browser?.close();
    server.close();
  }
  for (const n of notes) console.log('  · ' + n);
  if (failures.length) {
    console.error(`\n✗ ${failures.length} problem(s):\n${failures.map((f) => '  - ' + f).join('\n')}`);
    process.exit(1);
  }
  console.log('✓ smoke passed');
})();
