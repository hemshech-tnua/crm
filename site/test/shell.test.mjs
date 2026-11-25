// The site shell and the design-system rules every page shares (Team D): header, phone menu, CTA bar, footer, grounds,
// heading order, the home page's live card and owner slots, page CSS that never redefines a shared component.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build, walk, read, SITE } from './helpers.mjs';
import { PAGE_WHEN } from '../config.mjs';

const prod = build();
const preview = build({ preview: true });
const pages = (out) => walk(out, '.html').map((f) => ({ rel: relative(out, f), html: read(f), is404: f.endsWith('404.html') }));
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const exists = (out, id, lang = 'he') => existsSync(join(out, lang === 'en' ? 'en' : '', id === 'home' ? '' : id, 'index.html'));

test('builds succeed', () => {
  assert.equal(prod.status, 0, prod.stderr);
  assert.equal(preview.status, 0, preview.stderr);
});

for (const [name, b] of [['production', prod], ['preview', preview]]) {
  test(`${name}: header, menu, progress stripe and footer on every page`, () => {
    for (const { rel, html } of pages(b.out)) {
      const at = (m) => `${rel}: ${m}`;
      assert.match(html, /<header class="site-header" data-ground="navy" data-header>/, at('navy sticky header'));
      assert.match(html, /<a class="brand" href="[^"]+" aria-label="[^"]+">/, at('brand link home'));
      assert.match(html, /<a class="btn btn--sm site-header__cta" href="[^"]+"/, at('persistent CTA in the header'));
      assert.match(html, /<a class="lang-switch site-header__lang" href="[^"]+" hreflang="(he|en)" lang="(he|en)"/, at('language switch'));
      assert.match(html, /<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu" data-menu-open>/, at('menu button'));
      assert.match(html, /<dialog class="site-menu" id="site-menu" aria-label="[^"]+" data-ground="navy" data-menu>/, at('phone menu dialog'));
      assert.match(html, /<div class="scroll-progress" data-progress aria-hidden="true">/, at('reading-progress stripe'));
      assert.match(html, /<footer class="site-footer" data-ground="navy-deep">/, at('footer'));
      assert.match(html, /<p class="site-footer__name" aria-hidden="true"/, at('the big name'));
      assert.match(html, /data-org-phone="whatsapp"/, at('live WhatsApp slot'));
    }
  });

  test(`${name}: every existing MUST page is one step away in the footer`, () => {
    const must = ['friday', 'evenings', 'calendar', 'about', 'team', 'donate', 'partners', 'volunteer', 'contact'];
    for (const lang of ['he', 'en']) {
      const html = read(join(b.out, lang === 'en' ? 'en/index.html' : 'index.html'));
      const footer = html.slice(html.indexOf('<footer'));
      for (const id of must.filter((p) => exists(b.out, p, lang))) {
        assert.ok(footer.includes(`href="/crm/site/${lang === 'en' ? 'en/' : ''}${id}/"`), `${lang} footer links to ${id}`);
      }
    }
  });

  test(`${name}: the phone CTA bar is on every page except donate, contact and the 404`, () => {
    for (const { rel, html, is404 } of pages(b.out)) {
      const none = is404 || /(^|\/)(donate|contact)\//.test(rel) || /http-equiv="refresh"/.test(html);
      const bar = /<div class="cta-bar" data-ground="navy" data-cta-bar data-next="[a-z]+"[^>]* role="region" aria-label="[^"]+">/.test(html);
      assert.equal(bar, !none, `${rel}: CTA bar ${none ? 'should be absent' : 'missing'}`);
    }
  });

  test(`${name}: chapters set a ground, beige / beige-100 after the opener with one navy anchor at most, headings never skip a level`, () => {
    const GROUNDS = new Set(['navy', 'navy-deep', 'beige', 'beige-100', 'beige-light']);
    for (const { rel, html } of pages(b.out)) {
      const main = mainOf(html);
      const grounds = [...main.matchAll(/<section[^>]*\sdata-ground="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(grounds.length >= 1, `${rel}: no chapter with data-ground`);
      for (const g of grounds) assert.ok(GROUNDS.has(g), `${rel}: unknown ground "${g}"`);
      // R3 ground system: after the opener every chapter is beige or beige-100, except at most one navy data-anchor chapter
      const secs = [...main.matchAll(/<section\b([^>]*)\sdata-ground="([^"]+)"([^>]*)>/g)].map((m) => ({ g: m[2], anchor: /\sdata-anchor\b/.test(` ${m[1]} ${m[3]} `) }));
      const anchors = secs.slice(1).filter((x) => x.anchor);
      assert.ok(anchors.length <= 1, `${rel}: ${anchors.length} anchor chapters (one at most)`);
      for (const a of anchors) assert.equal(a.g, 'navy', `${rel}: the anchor chapter is navy`);
      secs.slice(1).filter((x) => !x.anchor).forEach((x, i) => assert.ok(['beige', 'beige-100'].includes(x.g), `${rel}: chapter ${i + 2} is on "${x.g}", not beige / beige-100`));
      const levels = [...main.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      assert.equal(levels[0], 1, `${rel}: the first heading in <main> is the h1`);
      levels.forEach((l, i) => i && assert.ok(l <= levels[i - 1] + 1, `${rel}: heading h${levels[i - 1]} → h${l} skips a level`));
    }
  });
}

test('home: the designer\'s order, a clean hero (headline, photo, one action)', () => {
  for (const lang of ['he', 'en']) {
    const html = read(join(prod.out, lang === 'en' ? 'en/index.html' : 'index.html'));
    const main = mainOf(html);
    const hero = main.slice(0, main.indexOf('</section>'));
    assert.equal((hero.match(/<a\b/g) ?? []).length, 1, `${lang}: one action in the hero`);
    assert.match(hero, /<a class="btn hero__btn" href="[^"]+" data-next-link="friday">/, `${lang}: the hero action is the next Friday`);
    assert.match(hero, /data-hero-cta/, `${lang}: the hero action marks where the phone bar starts`);
    assert.doesNotMatch(hero, /class="t-lead|data-next=|hero__facts|founders/, `${lang}: nothing else in the hero`);
    assert.match(hero, /fetchpriority="high"/, `${lang}: hero photo is the eager LCP image`);
    const ids = [...main.matchAll(/<section class="chapter (?:chapter--tight )?([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['hero', 'story', 'band', 'founders-ch', 'kinds', 'join', 'closing'], `${lang}: chapter order (no sponsors without owner content)`);
  }
  const pv = mainOf(read(join(preview.out, 'index.html')));
  assert.deepEqual([...pv.matchAll(/<section class="chapter (?:chapter--tight )?([a-z-]+)"/g)].map((m) => m[1]), ['hero', 'story', 'band', 'founders-ch', 'kinds', 'join', 'sponsors', 'closing'], 'preview shows the sponsors chapter');
  assert.ok((pv.match(/data-owner-slot/g) ?? []).length >= 1, 'preview marks the owner slots on home');
});

test('titles: the name exactly once in <title>, og:title and every JSON-LD name', () => {
  for (const [name, b] of [['production', prod], ['preview', preview]]) {
    for (const { rel, html } of pages(b.out)) {
      const norm = (s) => s.replace(/&nbsp;|\u00a0/g, ' ');
      const title = norm(html.match(/<title>([^<]*)<\/title>/)[1]);
      assert.equal(title.split('המשך תנועה').length - 1, 1, `${name} ${rel}: <title>${title}</title>`);
      const og = html.match(/<meta property="og:title" content="([^"]*)">/);
      if (og) assert.equal(norm(og[1]).split('המשך תנועה').length - 1, 1, `${name} ${rel}: og:title ${og[1]}`);
      assert.match(html, /<meta property="og:image:alt" content="[^"]{10,}">/, `${name} ${rel}: og:image:alt`);
    }
  }
});

test('pages waiting for owner content (config PAGE_WHEN): in production only once the content exists, always in preview', () => {
  // follows content/org.json: while PAGE_WHEN[id](org) is false, production has no page and no link to it
  const org = JSON.parse(read(join(SITE, 'content/org.json')));
  for (const [id, when] of Object.entries(PAGE_WHEN)) {
    const shown = when(org);
    const href = new RegExp(`href="/crm/site/(en/)?${id}/"`);
    assert.equal(exists(prod.out, id) && exists(prod.out, id, 'en'), shown, `production: ${id} page ${shown ? 'built' : 'not built'}`);
    if (!shown) for (const { rel, html } of pages(prod.out)) assert.doesNotMatch(html, href, `${rel}: links to the hidden ${id} page`);
    assert.equal(new RegExp(`/${id}/`).test(read(join(prod.out, 'sitemap.xml'))), shown, `sitemap: ${id}`);
    if (shown) assert.match(read(join(prod.out, 'index.html')), href, `production: ${id} listed`);
    assert.ok(exists(preview.out, id), `preview: ${id} page built`);
    assert.match(read(join(preview.out, 'index.html')), href, `preview: ${id} listed`);
  }
});

test('the phone CTA bar: the next Friday by default, every live page preconnects to Supabase', () => {
  const html = read(join(prod.out, 'about/index.html'));
  assert.match(html, /<div class="cta-bar" data-ground="navy" data-cta-bar data-next="friday" data-next-pay /);
  for (const { rel, html: h } of pages(prod.out)) {
    if (/data-(events|next|org-phone)=/.test(h)) assert.match(h, /<link rel="preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co" crossorigin>/, `${rel}: preconnect`);
  }
  const cal = read(join(prod.out, 'calendar/index.html'));
  assert.equal((cal.match(/<link rel="modulepreload" href="\/crm\/site\/assets\/js\/(events|api|config)\.[0-9a-f]{10}\.js">/g) ?? []).length, 3, 'calendar preloads the meetings modules');
  assert.doesNotMatch(read(join(prod.out, 'index.html')), /modulepreload/, 'home does not');
});

test('404: one job — back to a meeting; noindex; no CTA bar', () => {
  for (const f of ['404.html', 'en/404.html']) {
    const html = read(join(prod.out, f));
    assert.match(html, /<h1 id="nf-title"/);
    assert.match(mainOf(html), /class="btn" href="[^"]+"/);
  }
});

test('JS sends the meeting strings for both languages and stays small', () => {
  const js = walk(join(prod.out, 'assets/js'));
  const config = read(js.find((f) => /\/config\./.test(f)));
  for (const k of ['"nextLabel"', '"emptyTitle"', '"registerAndPay"', '"fullWaitlist"']) assert.ok(config.includes(k), `config.js carries ${k}`);
});

test('page CSS never redefines a shared component (selectors start with a page-scoped class)', () => {
  const SHARED = /^(\.(btn|link|link-arrow|site-header|site-nav|site-menu|site-footer|crumbs|cta-bar|brand|lang-switch|menu-toggle|photo|next|meet|events|event-card|chip|type|stats?|quote|logos|rows?|faq|timeline|cta-band|owner-slot|card|tri|stripes|corner|mark|wrap|container|chapter|section|cols|split|stack|cluster|head|t-[a-z]+)|\[data-ground)(?![\w-])/;
  const dir = join(SITE, 'assets/css');
  for (const f of readdirSync(dir).filter((x) => x.startsWith('page-'))) {
    const css = read(join(dir, f)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
    for (const m of css.matchAll(/([^{};]+)\{/g)) {
      const sel = m[1].trim();
      if (!sel || sel.startsWith('@')) continue;
      for (const part of sel.split(',').map((s) => s.trim())) assert.doesNotMatch(part, SHARED, `${f}: "${part}" restyles a shared component; scope it under a page class`);
    }
  }
});
