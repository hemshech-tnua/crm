// The site's places (config.mjs): the six-page menu (NAV) in the header and the phone menu, the sections (SECTIONS) as
// the footer columns and the breadcrumb "<section> ◀ <page>", and the old hub addresses that now forward (REDIRECTS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build, walk, read, SITE } from './helpers.mjs';
import { SECTIONS, OUTSIDE_SECTIONS, NAV, REDIRECTS } from '../config.mjs';

const prod = build();
const preview = build({ preview: true });
const SLUG = { involved: 'get-involved' };
const slugOf = (id) => SLUG[id] ?? id;
const url = (id, lang) => `/crm/site/${lang === 'en' ? 'en/' : ''}${id === 'home' ? '' : slugOf(id) + '/'}`;
const file = (out, id, lang) => join(out, lang === 'en' ? 'en' : '', id === 'home' ? '' : slugOf(id), 'index.html');
const exists = (out, id, lang = 'he') => existsSync(file(out, id, lang));
const hrefs = (s) => [...s.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);
const pages = (out) => walk(out, '.html').map((f) => ({ rel: relative(out, f), html: read(f), lang: relative(out, f).startsWith('en/') ? 'en' : 'he' }));
const LABELS = { he: { crumbs: 'מיקום באתר' }, en: { crumbs: 'Where you are' } };

/** What a section's footer column should list in this build: [hub, ...existing pages]. */
const expected = (out, s, lang) => [url(s.hub, lang), ...s.pages.filter((id) => exists(out, id, lang)).map((id) => url(id, lang))];

test('builds succeed', () => {
  assert.equal(prod.status, 0, prod.stderr);
  assert.equal(preview.status, 0, preview.stderr);
});

test('every page belongs to exactly one section (home, accessibility, the 404 and the forwarding addresses to none)', () => {
  const ids = readdirSync(join(SITE, 'pages')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).map((f) => f.replace(/\.mjs$/, ''));
  const hubs = SECTIONS.map((s) => s.hub);
  for (const id of ids) {
    const n = SECTIONS.filter((s) => s.hub === id || s.pages.includes(id)).length;
    if (OUTSIDE_SECTIONS.includes(id)) assert.equal(n, 0, `${id} is outside the sections`);
    else assert.equal(n, 1, `${id} belongs to ${n} sections`);
  }
  for (const s of SECTIONS) {
    assert.ok(ids.includes(s.hub), `section ${s.id}: main page pages/${s.hub}.mjs`);
    for (const id of s.pages) assert.ok(!hubs.includes(id), `${id} is a section's main page, not one of its pages`);
  }
  assert.deepEqual(SECTIONS.map((s) => s.id), ['meetings', 'association', 'involved'], 'section order');
  assert.deepEqual(NAV, ['meetings', 'about', 'team', 'faq', 'donate', 'contact'], 'the six menu pages, in order');
  for (const id of NAV) assert.ok(ids.includes(id), `menu page pages/${id}.mjs`);
});

for (const [name, b] of [['production', prod], ['preview', preview]]) {
  test(`${name}: the header and the phone menu list the six pages; the footer lists every section`, () => {
    for (const { rel, html, lang } of pages(b.out)) {
      if (/http-equiv="refresh"/.test(html)) continue;
      const at = (m) => `${rel}: ${m}`;
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      const menu = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
      const foot = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
      const want = NAV.filter((id) => exists(b.out, id, lang)).map((id) => url(id, lang));
      const nav = header.slice(header.indexOf('<nav class="site-nav"'), header.indexOf('</nav>'));
      assert.deepEqual(hrefs(nav), want, at('header menu'));
      assert.doesNotMatch(header, /site-nav__toggle|data-nav-panel/, at('no dropdowns'));
      const list = menu.slice(menu.indexOf('<nav class="wrap site-menu__nav"'), menu.indexOf('</nav>', menu.indexOf('<nav class="wrap site-menu__nav"')));
      assert.deepEqual(hrefs(list), want, at('phone menu'));
      for (const s of SECTIONS) {
        const i = foot.indexOf(`data-footer-section="${s.id}"`);
        assert.ok(i >= 0, at(`footer column ${s.id}`));
        assert.deepEqual(hrefs(foot.slice(i, foot.indexOf('</ul>', i))), expected(b.out, s, lang), at(`footer ${s.id}`));
      }
      assert.match(menu, /<div class="site-menu__cta"><div class="wrap"><a class="btn btn--block" href="[^"]+"/, at('CTA at the foot of the menu'));
      assert.match(header, /<a class="btn btn--sm site-header__cta" href="[^"]+"/, at('persistent CTA'));
    }
  });

  test(`${name}: the menu marks the current page, or the menu page whose section it belongs to`, () => {
    for (const { rel, html, lang } of pages(b.out)) {
      if (/http-equiv="refresh"/.test(html) || rel.endsWith('404.html')) continue;
      const at = (m) => `${rel}: ${m}`;
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      const pageUrl = `/${'crm/site/' + rel.replace(/index\.html$/, '')}`;
      const here = [...NAV, ...SECTIONS.flatMap((s) => s.pages), 'home', 'accessibility'].find((id) => url(id, lang) === pageUrl);
      const page = [...header.matchAll(/<a class="site-nav__top" href="([^"]+)" aria-current="page"/g)].map((m) => m[1]);
      const within = [...header.matchAll(/<a class="site-nav__top" href="([^"]+)" aria-current="true"/g)].map((m) => m[1]);
      if (NAV.includes(here)) {
        assert.deepEqual(page, [pageUrl], at('aria-current="page" on itself'));
        assert.deepEqual(within, [], at('nothing else marked'));
      } else {
        assert.deepEqual(page, [], at('not a menu page'));
        const sec = SECTIONS.find((s) => s.pages.includes(here));
        assert.deepEqual(within, sec && NAV.includes(sec.hub) ? [url(sec.hub, lang)] : [], at('its section marked'));
      }
    }
  });

  test(`${name}: the old hub addresses forward to the page that holds their content`, () => {
    for (const lang of ['he', 'en']) {
      for (const [id, to] of Object.entries(REDIRECTS)) {
        const html = read(file(b.out, id, lang));
        const target = url(to.page, lang) + (to.hash ? `#${to.hash}` : '');
        assert.match(html, new RegExp(`<meta http-equiv="refresh" content="0; url=${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`), `${lang} ${id}: refresh`);
        assert.match(html, /<meta name="robots" content="noindex">/, `${lang} ${id}: noindex`);
        assert.ok(hrefs(html.slice(html.indexOf('<main'))).includes(target), `${lang} ${id}: a plain link too`);
      }
    }
    const sm = read(join(b.out, 'sitemap.xml'));
    for (const id of Object.keys(REDIRECTS)) assert.doesNotMatch(sm, new RegExp(`/${slugOf(id)}/<`), `sitemap: ${id}`);
  });

  test(`${name}: the breadcrumb "<section> ◀ <page>" on every page of a section, linking to its hub`, () => {
    for (const lang of ['he', 'en']) {
      for (const s of SECTIONS) {
        for (const id of s.pages.filter((p) => exists(b.out, p, lang))) {
          const html = read(file(b.out, id, lang));
          const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
          const nav = main.match(/<nav class="crumbs" data-ground="([a-z-]+)" aria-label="([^"]+)">([\s\S]*?)<\/nav>/);
          assert.ok(nav, `${lang} ${id}: breadcrumb`);
          assert.equal(nav[2], LABELS[lang].crumbs, `${lang} ${id}: landmark name`);
          assert.match(main, /^<main id="main" tabindex="-1">\s*<nav class="crumbs"/, `${lang} ${id}: first in <main>`);
          const first = main.match(/<section\b[^>]*\sdata-ground="([a-z-]+)"/)[1];
          assert.equal(nav[1], first, `${lang} ${id}: on the first chapter's ground`);
          assert.deepEqual(hrefs(nav[3]), [url(s.hub, lang)], `${lang} ${id}: the section links to its hub`);
          assert.match(nav[3], /<span class="crumbs__here" aria-current="page">[^<]+<\/span>/, `${lang} ${id}: the page, current`);
        }
        assert.doesNotMatch(read(file(b.out, s.hub, lang)), /class="crumbs"/, `${lang} ${s.hub}: no breadcrumb on a hub`);
      }
      for (const id of ['home', 'accessibility']) assert.doesNotMatch(read(file(b.out, id, lang)), /class="crumbs"/, `${lang} ${id}: no breadcrumb`);
    }
  });
}
