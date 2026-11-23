// The build works and every page it writes meets the contract (SEO, a11y skeleton, CSP, links, budgets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build, walk, read } from './helpers.mjs';

const BASE = '/crm/site/';
const prod = build();
const preview = build({ preview: true });

test('production and preview builds succeed', () => {
  assert.equal(prod.status, 0, prod.stderr);
  assert.equal(preview.status, 0, preview.stderr);
});

const pagesOf = (out) => walk(out, '.html').map((f) => ({ f, rel: relative(out, f), html: read(f), is404: f.endsWith('404.html') }));

/** Where a site URL points to in the output folder (null when it is not ours). */
function target(out, url, base = BASE) {
  const u = new URL(url, 'https://x.test');
  if (!u.pathname.startsWith(base)) return null;
  let p = join(out, decodeURIComponent(u.pathname.slice(base.length)));
  if (u.pathname.endsWith('/')) p = join(p, 'index.html');
  return p;
}

for (const [name, b] of [['production', prod], ['preview', preview]]) {
  test(`${name}: every page has the document contract`, () => {
    const pages = pagesOf(b.out);
    assert.ok(pages.length >= 4, 'home ×2 + 404 ×2 at least');
    for (const { rel, html, is404 } of pages) {
      const en = rel.startsWith('en/');
      const at = (msg) => `${rel}: ${msg}`;
      assert.match(html, /^<!doctype html>/i, at('doctype'));
      assert.match(html, en ? /<html lang="en" dir="ltr"/ : /<html lang="he" dir="rtl"/, at('lang/dir'));
      assert.match(html, /<title>[^<]{3,}<\/title>/, at('title'));
      assert.match(html, /<meta name="description" content="[^"]{20,}">/, at('description'));
      assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, at('viewport'));
      const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
      assert.ok(csp, at('CSP meta'));
      assert.match(csp[1], /script-src 'self'(;|$)/, at('CSP script-src'));
      assert.match(csp[1], /connect-src 'self' https:\/\/[a-z0-9]+\.supabase\.co/, at('CSP connect-src'));
      assert.match(csp[1], /object-src 'none'/, at('CSP object-src'));
      if (is404) {
        assert.match(html, /<meta name="robots" content="noindex">/, at('404 is noindex'));
        assert.doesNotMatch(html, /rel="canonical"/, at('404 has no canonical'));
      } else {
        const canon = html.match(/<link rel="canonical" href="([^"]+)">/);
        assert.ok(canon, at('canonical'));
        assert.match(canon[1], /^https:\/\//, at('canonical is absolute'));
        for (const h of ['he', 'en', 'x-default']) assert.match(html, new RegExp(`<link rel="alternate" hreflang="${h}" href="https://[^"]+">`), at(`hreflang ${h}`));
        assert.match(html, /<meta property="og:title" content="[^"]+">/, at('og:title'));
        assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+">/, at('og:image'));
      }
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, at('exactly one h1'));
      assert.match(html, /<a class="skip-link" href="#main">/, at('skip link'));
      assert.match(html, /<header class="site-header"/, at('header landmark'));
      assert.match(html, /<main id="main"/, at('main landmark'));
      assert.match(html, /<footer class="site-footer"/, at('footer landmark'));
      assert.match(html, /<nav [^>]*aria-label="/, at('labelled nav'));
      // no inline script (JSON-LD data blocks are not scripts), no inline styles or handlers (CSP would block them)
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.ok(/\bsrc="/.test(tag) || /type="application\/ld\+json"/.test(tag), at(`inline script ${tag}`));
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>[^<]+<\/script>/, at('inline script body'));
      assert.doesNotMatch(html, /\sstyle="/, at('style attribute'));
      assert.doesNotMatch(html, /<style[\s>]/, at('<style> element'));
      assert.doesNotMatch(html, /\son[a-z]+="/, at('inline event handler'));
      assert.doesNotMatch(html, /⟦/, at('missing copy marker'));
      assert.doesNotMatch(html, /המשך תנועה/, at('"המשך תנועה" with a breaking space'));
      // every image has width/height (no layout shift) and alt
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
        assert.match(img, /\balt="/, at(`img alt ${img.slice(0, 80)}`));
        assert.match(img, /\bwidth="\d+" height="\d+"/, at(`img size ${img.slice(0, 80)}`));
      }
      // ids are unique
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, at(`duplicate id among ${ids.join(',')}`));
    }
  });

  test(`${name}: every internal link and asset resolves`, () => {
    for (const { rel, html } of pagesOf(b.out)) {
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      const urls = [
        ...[...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
        ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+/)[0])),
      ];
      for (const url of urls) {
        if (url.startsWith('#')) {
          assert.ok(ids.has(url.slice(1)), `${rel}: in-page link ${url} has no target`);
          continue;
        }
        if (/^(mailto|tel):/.test(url)) continue;
        const local = url.startsWith('https://hemshech-tnua.github.io/crm/site/') ? url.replace('https://hemshech-tnua.github.io', '') : url;
        if (/^https?:/.test(local)) continue; // external (the CRM, wa.me)
        assert.ok(local.startsWith(BASE), `${rel}: link outside the base path: ${url}`);
        const f = target(b.out, local);
        assert.ok(f && existsSync(f) && statSync(f).isFile(), `${rel}: broken link ${url}`);
      }
    }
  });
}

test('owner content: dashed boxes only in preview builds', () => {
  const p = read(join(prod.out, 'index.html'));
  const v = read(join(preview.out, 'index.html'));
  assert.doesNotMatch(p, /data-owner-slot/);
  assert.match(v, /data-owner-slot><strong>תוכן מהעמותה:<\/strong>/);
  assert.match(read(join(preview.out, 'en/index.html')), /<span lang="he">תוכן מהעמותה<\/span>/);
});

test('sitemap and robots', () => {
  const sm = read(join(prod.out, 'sitemap.xml'));
  assert.match(sm, /<loc>https:\/\/hemshech-tnua\.github\.io\/crm\/site\/<\/loc>/);
  assert.match(sm, /<loc>https:\/\/hemshech-tnua\.github\.io\/crm\/site\/en\/<\/loc>/);
  assert.doesNotMatch(sm, /404/);
  const pages = pagesOf(prod.out).filter((p) => !p.is404).length;
  assert.equal((sm.match(/<url>/g) ?? []).length, pages, 'one <url> per page');
  assert.match(read(join(prod.out, 'robots.txt')), /Sitemap: https:\/\/hemshech-tnua\.github\.io\/crm\/site\/sitemap\.xml/);
});

test('assets: fingerprinted, fonts copied, JS under 30 KB, config carries the Supabase values', () => {
  const css = walk(join(prod.out, 'assets/css'));
  assert.equal(css.length, 1);
  assert.match(css[0], /site\.[0-9a-f]{10}\.css$/);
  const js = walk(join(prod.out, 'assets/js'));
  for (const f of js) assert.match(f, /\.[0-9a-f]{10}\.js$/);
  const total = js.reduce((n, f) => n + statSync(f).size, 0);
  assert.ok(total < 30 * 1024, `JS total ${total} bytes`);
  for (const f of js) for (const m of read(f).matchAll(/(?:from|import\s*\()\s*['"]\.\/([^'"]+)['"]/g)) assert.ok(existsSync(join(prod.out, 'assets/js', m[1])), `${f} imports missing ${m[1]}`);
  assert.ok(existsSync(join(prod.out, 'assets/fonts/google-sans-hebrew-wght-normal.woff2')));
  const config = read(js.find((f) => /\/config\./.test(f)));
  assert.match(config, /"supabaseUrl":"https:\/\/bvoubfasrgumpehyxbcg\.supabase\.co"/);
  assert.match(config, /"supabaseAnonKey":"eyJ/);
});

test('environment: base path, origin, Supabase and robots are configurable', () => {
  const b = build({ env: { SITE_BASE: '/', SITE_ORIGIN: 'https://example.org', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'k', SITE_ROBOTS: 'noindex' } });
  assert.equal(b.status, 0, b.stderr);
  const html = read(join(b.out, 'en/index.html'));
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.org\/en\/">/);
  assert.match(html, /href="\/assets\/css\/site\./);
  assert.match(html, /connect-src 'self' https:\/\/abc\.supabase\.co/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(read(join(b.out, 'robots.txt')), /Disallow: \//);
});

test('output guard: refuses folders the site does not own; rebuilds its own', () => {
  for (const o of ['site', '.', 'dist', 'src']) {
    const r = build({ env: { SITE_OUT: o } });
    assert.notEqual(r.status, 0, `SITE_OUT=${o} must be refused`);
    assert.match(r.stderr, /refusing to empty/);
  }
  const again = build({ env: { SITE_OUT: prod.out } }); // carries .site-build from the first build
  assert.equal(again.status, 0, again.stderr);
  assert.ok(existsSync(join(prod.out, '.site-build')));
});
