// The site's sections (config.mjs SECTIONS): every page in exactly one section, every hub lists exactly its existing
// pages, the header dropdowns, the phone menu and the footer show the same grouping, the dropdowns are accessible
// disclosures, and every page of a section carries the "<section> ◀ <page>" breadcrumb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build, walk, read, SITE } from './helpers.mjs';
import { SECTIONS, OUTSIDE_SECTIONS } from '../config.mjs';

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

/** What a section should list in this build: [hub, ...existing pages]. */
const expected = (out, s, lang) => [url(s.hub, lang), ...s.pages.filter((id) => exists(out, id, lang)).map((id) => url(id, lang))];

test('builds succeed', () => {
  assert.equal(prod.status, 0, prod.stderr);
  assert.equal(preview.status, 0, preview.stderr);
});

test('every page belongs to exactly one section (home, accessibility and the 404 to none)', () => {
  const ids = readdirSync(join(SITE, 'pages')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).map((f) => f.replace(/\.mjs$/, ''));
  const hubs = SECTIONS.map((s) => s.hub);
  for (const id of ids) {
    const n = SECTIONS.filter((s) => s.hub === id || s.pages.includes(id)).length;
    if (OUTSIDE_SECTIONS.includes(id)) assert.equal(n, 0, `${id} is outside the sections`);
    else assert.equal(n, 1, `${id} belongs to ${n} sections`);
  }
  for (const s of SECTIONS) {
    assert.ok(ids.includes(s.hub), `section ${s.id}: hub page pages/${s.hub}.mjs`);
    for (const id of s.pages) assert.ok(!hubs.includes(id), `${id} is a hub, not a section page`);
  }
  assert.deepEqual(SECTIONS.map((s) => s.id), ['meetings', 'association', 'involved', 'support'], 'section order');
});

for (const [name, b] of [['production', prod], ['preview', preview]]) {
  test(`${name}: every hub lists exactly its existing pages, in order`, () => {
    for (const lang of ['he', 'en']) {
      for (const s of SECTIONS) {
        const html = read(file(b.out, s.hub, lang));
        const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
        assert.equal((main.match(/<h1[\s>]/g) ?? []).length, 1, `${lang} ${s.hub}: one h1`);
        const rows = [...main.matchAll(/<a class="row[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
        assert.deepEqual(rows, expected(b.out, s, lang).slice(1), `${lang} ${s.hub}: rows`);
        if (s.id === 'meetings') assert.match(main, /<div class="next" data-next="friday" data-next-pay/, `${lang}: the live next Friday`);
        if (s.id === 'support') assert.match(main, lang === 'he' ? /לא חייבים לתרום כדי להיות חלק/ : /You don(&#39;|')t have to give to be part of this/, `${lang}: "you don't have to give"`);
      }
    }
    // the team page waits for owner content (config PAGE_WHEN): in the association hub once org.json has people, always in preview
    assert.equal(read(file(b.out, 'association', 'he')).includes('href="/crm/site/team/"'), name === 'preview' || exists(b.out, 'team', 'he'));
  });

  test(`${name}: header dropdowns, phone menu and footer show the same grouping on every page`, () => {
    for (const { rel, html, lang } of pages(b.out)) {
      const at = (m) => `${rel}: ${m}`;
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      const menu = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
      const foot = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
      const block = (src, open, id) => {
        const i = src.indexOf(open);
        assert.ok(i >= 0, at(`${open} missing`));
        return src.slice(i, src.indexOf('</ul>', i));
      };
      const ids = [...header.matchAll(/aria-controls="nav-([a-z]+)"/g)].map((m) => m[1]);
      assert.deepEqual(ids, SECTIONS.map((s) => s.id), at('four sections in the header, in order'));
      for (const s of SECTIONS) {
        const want = expected(b.out, s, lang);
        assert.deepEqual(hrefs(block(header, `id="nav-${s.id}"`)), want, at(`header ${s.id}`));
        assert.deepEqual(hrefs(block(menu, `data-menu-section="${s.id}"`)), want, at(`menu ${s.id}`));
        assert.deepEqual(hrefs(block(foot, `data-footer-section="${s.id}"`)), want, at(`footer ${s.id}`));
      }
      assert.match(menu, /<div class="site-menu__cta"><div class="wrap"><a class="btn btn--block" href="[^"]+"/, at('CTA at the foot of the menu'));
      assert.match(header, /<a class="btn btn--sm site-header__cta" href="[^"]+"/, at('persistent CTA'));
    }
  });

  test(`${name}: the dropdowns are accessible disclosures; the current page and section are marked`, () => {
    for (const { rel, html, lang } of pages(b.out)) {
      const at = (m) => `${rel}: ${m}`;
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      const toggles = [...header.matchAll(/<button class="site-nav__toggle"[^>]*>/g)].map((m) => m[0]);
      assert.equal(toggles.length, SECTIONS.length, at('one button per section'));
      for (const t of toggles) {
        const id = t.match(/aria-controls="([^"]+)"/)?.[1];
        assert.match(t, /type="button" aria-expanded="false" aria-controls="nav-[a-z]+"/, at(`button attributes ${t}`));
        assert.match(header, new RegExp(`${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?</button>\\s*<div class="site-nav__panel" id="${id}" data-nav-panel>`), at(`panel ${id} right after its button`));
      }
      const pageUrl = rel.endsWith('404.html') ? null : `/${'crm/site/' + rel.replace(/index\.html$/, '')}`;
      const sec = SECTIONS.find((s) => pageUrl && [s.hub, ...s.pages].some((id) => url(id, lang) === pageUrl));
      const marked = toggles.filter((t) => /aria-current="true"/.test(t)).map((t) => t.match(/aria-controls="nav-([a-z]+)"/)[1]);
      assert.deepEqual(marked, sec ? [sec.id] : [], at('aria-current on the current section only'));
      const current = [...header.matchAll(/<a class="site-nav__link[^"]*" href="([^"]+)" aria-current="page"/g)].map((m) => m[1]);
      assert.deepEqual(current, sec ? [pageUrl] : [], at('aria-current="page" on the current page in its dropdown'));
      // every panel item has a one-line description, the hub item first
      for (const s of SECTIONS) {
        const panel = header.slice(header.indexOf(`id="nav-${s.id}"`), header.indexOf('</ul>', header.indexOf(`id="nav-${s.id}"`)));
        assert.match(panel, /<ul class="site-nav__menu" role="list">\s*<li><a class="site-nav__link site-nav__link--hub"/, at(`${s.id}: hub first`));
        assert.equal((panel.match(/class="site-nav__desc">[^<]{8,}</g) ?? []).length, expected(b.out, s, lang).length - 1, at(`${s.id}: a description per page`));
      }
    }
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
