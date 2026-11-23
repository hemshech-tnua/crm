#!/usr/bin/env node
// Static site generator for the המשך תנועה website. Zero dependencies, Node 22, ESM.
//
//   node site/build.mjs              production build → dist/site (empty owner content is omitted)
//   node site/build.mjs --preview    preview build: empty owner-content slots show as dashed "תוכן מהעמותה" boxes
//
// Environment: SITE_PREVIEW=1, SITE_BASE (/crm/site/), SITE_ORIGIN, SITE_OUT (dist/site), SITE_CRM_URL,
// SUPABASE_URL, SUPABASE_ANON_KEY (default: the production values of the CRM deploy), SITE_ROBOTS=allow|noindex.
// See site/README.md.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, resolve, extname, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { DEFAULTS, LANGS, DEFAULT_LANG, LANG_META, CTA_PAGE, PAGE_WHEN, LIVE_FIRST, crmLinks, CSS_ORDER, JS_ENTRY } from './config.mjs';
import { html, raw, esc, attrs, cx, inline, keepNames, safeUrl, isHtml } from './lib/html.mjs';
import * as brand from './lib/brand.mjs';
import { scanPhotos, photo } from './lib/images.mjs';
import { present, ownerBox, eventsBlock, nextMeeting, ui } from './lib/components.mjs';
import { layout } from './partials/layout.mjs';

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SITE, '..');
const args = new Set(process.argv.slice(2));
const env = process.env;

const opts = {
  preview: args.has('--preview') || env.SITE_PREVIEW === '1',
  quiet: args.has('--quiet'),
  base: normBase(env.SITE_BASE || DEFAULTS.base),
  origin: (env.SITE_ORIGIN || DEFAULTS.origin).replace(/\/+$/, ''),
  out: resolve(ROOT, env.SITE_OUT || 'dist/site'),
  crmUrl: env.SITE_CRM_URL || DEFAULTS.crmUrl,
  supabaseUrl: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULTS.supabaseUrl).replace(/\/+$/, ''),
  supabaseAnonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || DEFAULTS.supabaseAnonKey,
  robots: env.SITE_ROBOTS === 'noindex' ? 'noindex' : DEFAULTS.robots,
};

function normBase(b) {
  let s = b.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s += '/';
  return s;
}

const log = (...a) => opts.quiet || console.log(...a);
const fail = (msg) => {
  console.error(`\n✗ site build failed: ${msg}\n`);
  process.exit(1);
};

// ───────────── content ─────────────

const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    fail(`${relative(ROOT, f)}: ${e.message}`);
  }
};

function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out;
}

/** content/<lang>.json, plus content/<lang>/<name>.json merged in under the key <name> (lets teams split copy by page). */
function loadCopy(lang) {
  let dict = readJson(join(SITE, 'content', `${lang}.json`));
  const dir = join(SITE, 'content', lang);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      dict = deepMerge(dict, { [basename(f, '.json')]: readJson(join(dir, f)) });
    }
  }
  return dict;
}

const copy = Object.fromEntries(LANGS.map((l) => [l, loadCopy(l)]));
const org = readJson(join(SITE, 'content', 'org.json'));

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
const missing = new Set();

// ───────────── pages ─────────────

const pageFiles = readdirSync(join(SITE, 'pages')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
const pages = [];
for (const f of pageFiles) {
  const mod = await import(pathToFileURL(join(SITE, 'pages', f)).href);
  const id = mod.id ?? basename(f, '.mjs');
  if (typeof mod.render !== 'function') fail(`pages/${f}: export a render(ctx) function`);
  if (!mod.notFound) {
    if (!mod.slug || LANGS.some((l) => typeof mod.slug[l] !== 'string')) fail(`pages/${f}: export slug = { he: '…', en: '…' } ('' for the home page)`);
    for (const l of LANGS) if (!/^([a-z0-9]+(-[a-z0-9]+)*)(\/[a-z0-9]+(-[a-z0-9]+)*)*$|^$/.test(mod.slug[l])) fail(`pages/${f}: slug.${l} "${mod.slug[l]}" must be lowercase latin words with dashes`);
  }
  pages.push({ id, file: f, mod });
}
{
  const seen = new Map();
  for (const p of pages) {
    if (seen.has('id:' + p.id)) fail(`two pages have the id "${p.id}"`);
    seen.set('id:' + p.id, p);
    if (p.mod.notFound) continue;
    for (const l of LANGS) {
      const k = `${l}:${p.mod.slug[l]}`;
      if (seen.has(k)) fail(`pages ${seen.get(k).file} and ${p.file} share the ${l} slug "${p.mod.slug[l]}"`);
      seen.set(k, p);
    }
  }
  if (!pages.some((p) => p.id === 'home')) fail('there must be a pages/home.mjs');
}
// Pages that wait for owner content (config.mjs PAGE_WHEN): left out of a production build until it exists.
const waiting = new Set(opts.preview ? [] : pages.filter((p) => PAGE_WHEN[p.id] && !PAGE_WHEN[p.id](org)).map((p) => p.id));
const byId = new Map(pages.filter((p) => !waiting.has(p.id)).map((p) => [p.id, p]));

const pagePath = (id, lang) => {
  const p = byId.get(id);
  if (!p && waiting.has(id)) throw new Error(`link("${id}"): that page waits for owner content (config.mjs PAGE_WHEN) and is not in this build; check ctx.pageExists("${id}") first`);
  if (!p) throw new Error(`link("${id}"): there is no page with that id (pages/${id}.mjs)`);
  if (p.mod.notFound) throw new Error(`link("${id}"): the 404 page cannot be linked`);
  const slug = p.mod.slug[lang];
  return opts.base + LANG_META[lang].prefix + (slug ? slug + '/' : '');
};

// ───────────── output folder ─────────────

const out = opts.out;
// The folder is emptied first, so it must be one the site owns: dist/site (the default), a folder that does not exist
// yet or is empty, or one an earlier site build wrote (it carries the MARKER file). Never the repository, dist/ itself
// (the CRM build) or a folder that holds either of them.
const MARKER = '.site-build';
{
  const isDir = existsSync(out) && statSync(out).isDirectory();
  // (a build from before the marker existed is recognised by its sitemap, robots.txt and fingerprinted stylesheet)
  const legacy = () => ['sitemap.xml', 'robots.txt'].every((f) => existsSync(join(out, f))) && existsSync(join(out, 'assets/css')) && readdirSync(join(out, 'assets/css')).some((f) => /^site\.[0-9a-f]{10}\.css$/.test(f));
  const owned = out === resolve(ROOT, 'dist/site') || !existsSync(out) || (isDir && (readdirSync(out).length === 0 || existsSync(join(out, MARKER)) || legacy()));
  const holds = (dir) => dir === out || dir.startsWith(out + sep);
  if (!owned || holds(ROOT) || holds(resolve(ROOT, 'dist')) || out.startsWith(join(ROOT, 'src') + sep) || out.startsWith(SITE + sep)) {
    fail(`refusing to empty ${out}: SITE_OUT must be dist/site, a new or empty folder, or the output of an earlier site build (it has ${MARKER})`);
  }
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, MARKER), 'Written by site/build.mjs. This folder is emptied on every build.\n');

const write = (rel, data) => {
  const f = join(out, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, data);
  return f;
};
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

// ───────────── static assets ─────────────

function copyDir(from, to, skip = () => false) {
  if (!existsSync(from)) return 0;
  let n = 0;
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (skip(src, name)) continue;
    if (statSync(src).isDirectory()) n += copyDir(src, join(to, name), skip);
    else {
      mkdirSync(to, { recursive: true });
      copyFileSync(src, join(to, name));
      n++;
    }
  }
  return n;
}

const ASSETS = join(SITE, 'assets');
copyDir(ASSETS, join(out, 'assets'), (src, name) => [join(ASSETS, 'css'), join(ASSETS, 'js')].includes(src) || name.startsWith('.') || name.endsWith('.md'));
copyDir(join(ROOT, 'src/assets/fonts'), join(out, 'assets/fonts'), (_, n) => !n.endsWith('.woff2') && !n.endsWith('.txt'));
for (const f of ['favicon.svg', 'og-image.png']) copyFileSync(join(ROOT, 'public', f), join(out, 'assets', f));
const photos = scanPhotos(join(ASSETS, 'photos'));

// CSS: one file, layered, in a fixed order (config CSS_ORDER, then any other file alphabetically).
const cssDir = join(ASSETS, 'css');
const cssFiles = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
const cssOrdered = [...CSS_ORDER.filter((f) => cssFiles.includes(f)), ...cssFiles.filter((f) => !CSS_ORDER.includes(f)).sort()];
const css = cssOrdered
  .map((f) => readFileSync(join(cssDir, f), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s+/gm, '')
  .replace(/\n{2,}/g, '\n');
const cssName = `assets/css/site.${hash(css)}.css`;
write(cssName, css);

// JS: ES modules, fingerprinted; import specifiers between them are rewritten to the hashed names.
const jsDir = join(ASSETS, 'js');
const jsSrc = Object.fromEntries(readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(join(jsDir, f), 'utf8')]));
const jsI18n = Object.fromEntries(LANGS.map((l) => [l, { events: lookup(copy[l], 'events'), locale: LANG_META[l].intl }]));
jsSrc['config.js'] =
  '// Generated by site/build.mjs — do not edit.\n' +
  `export default ${JSON.stringify({
    supabaseUrl: opts.supabaseUrl,
    supabaseAnonKey: opts.supabaseAnonKey,
    crmUrl: opts.crmUrl,
    base: opts.base,
    preview: opts.preview,
    i18n: jsI18n,
  })};\n`;
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])\.\/([\w.-]+\.js)\2/g;
const stripJs = (s) =>
  s
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n');
const jsOut = {};
function emitJs(name, stack = []) {
  if (jsOut[name]) return jsOut[name].file;
  if (!(name in jsSrc)) fail(`assets/js: "${stack.at(-1)}" imports ./${name}, which does not exist`);
  if (stack.includes(name)) fail(`assets/js: circular import ${[...stack, name].join(' → ')}`);
  const code = stripJs(jsSrc[name]).replace(IMPORT_RE, (_, kw, q, dep) => `${kw}${q}./${emitJs(dep, [...stack, name]).split('/').pop()}${q}`);
  const file = `assets/js/${name.replace(/\.js$/, '')}.${hash(code)}.js`;
  write(file, code);
  return (jsOut[name] = { file, code }).file;
}
if (!jsSrc[JS_ENTRY]) fail(`assets/js/${JS_ENTRY} is missing`);
for (const name of Object.keys(jsSrc)) emitJs(name);

// ───────────── render ─────────────

const crm = crmLinks(opts.crmUrl);
const supabaseOrigin = (() => {
  try {
    return new URL(opts.supabaseUrl).origin;
  } catch {
    return '';
  }
})();
const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', year: 'numeric' }).format(new Date());

function makeCtx(page, lang) {
  const dict = copy[lang];
  const otherLang = LANGS.find((l) => l !== lang);
  const abs = (path) => opts.origin + path;
  const notFound = !!page.mod.notFound;
  const t = (key, vars) => {
    let v = lookup(dict, key);
    if (typeof v !== 'string') {
      missing.add(`${lang}: ${key}${v !== undefined ? ' (not a string; use ctx.list/ctx.get)' : ''}`);
      return opts.preview ? `⟦${key}⟧` : '';
    }
    if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return v;
  };
  const ctx = {
    lang,
    dir: LANG_META[lang].dir,
    otherLang,
    meta: LANG_META[lang],
    preview: opts.preview,
    year,
    org,
    crm,
    site: { base: opts.base, origin: opts.origin, robots: opts.robots, supabaseOrigin },
    page: {
      id: page.id,
      url: notFound ? null : pagePath(page.id, lang),
      otherUrl: notFound ? pagePath('home', otherLang) : pagePath(page.id, otherLang),
      alternates: notFound ? null : Object.fromEntries(LANGS.map((l) => [l, abs(pagePath(page.id, l))])),
    },
    // helpers
    html, raw, esc, attrs, cx, safeUrl,
    t,
    /** Copy as HTML with **bold**, _em_, [link](url) and line breaks. */
    rich: (key, vars) => inline(t(key, vars)),
    /** Any copy value (array / object) — for lists in content JSON. */
    get: (key) => {
      const v = lookup(dict, key);
      if (v === undefined) {
        missing.add(`${lang}: ${key}`);
        return opts.preview ? [] : undefined;
      }
      return v;
    },
    list: (key) => {
      const v = lookup(dict, key);
      if (!Array.isArray(v)) {
        missing.add(`${lang}: ${key} (expected a list)`);
        return [];
      }
      return v;
    },
    /** Pick the current language from a bilingual value { he, en } (owner content); plain values pass through. */
    l: (v) => (v && typeof v === 'object' && !Array.isArray(v) && (lang in v || 'he' in v) ? v[lang] ?? v.he : v),
    has: present,
    /** Owner content: render(value) when it exists; else a dashed box in preview builds, nothing in production. */
    slot: (value, label, render, o = {}) => (present(value) ? render(value) : opts.preview ? ownerBox(ctx, label, o) : ''),
    /** Whether page `id` is in this build (it may wait for owner content: config.mjs PAGE_WHEN). Check before ctx.link. */
    pageExists: (id) => byId.has(id) && !byId.get(id).mod.notFound,
    link: (id, l = lang) => pagePath(id, l),
    abs,
    /** URL of a file in site/assets (checked at build time). */
    asset: (p) => {
      const rel = p.replace(/^\/+/, '');
      if (!existsSync(join(out, 'assets', rel))) throw new Error(`asset("${p}"): no such file in site/assets`);
      return opts.base + 'assets/' + rel;
    },
    assetUrl: (kind) => opts.base + (kind === 'css' ? cssName : jsOut[JS_ENTRY].file),
    /** URL of a fingerprinted JS module (e.g. 'events.js'). */
    jsUrl: (name) => {
      if (!jsOut[name]) throw new Error(`jsUrl("${name}"): no such module in assets/js`);
      return opts.base + jsOut[name].file;
    },
    /** The browser modules a page with live meetings needs at once (config.mjs LIVE_FIRST pages only). */
    livePreload: LIVE_FIRST.includes(page.id) ? ['events.js', 'api.js', 'config.js'] : [],
    /** Responsive photo from site/assets/photos (alt defaults to content photos.<name>). */
    img: (name, o = {}) => photo(name, photos[name], opts.base + 'assets/photos/', { ...o, alt: o.alt ?? t(`photos.${name}`) }),
    photoNames: Object.keys(photos),
    events: (o) => eventsBlock(ctx, o),
    /** The live "next meeting" card (see lib/components.mjs nextMeeting). */
    nextMeeting: (o) => nextMeeting(ctx, o),
    /** Light inline markup for a string you already hold (ctx.rich does the same for a copy key). */
    inline: (s) => inline(String(s ?? '')),
    /** data-reveal attributes: ctx.reveal('up', 2) → data-reveal="up" data-reveal-delay="2". */
    reveal: (kind = 'up', delay) => attrs({ 'data-reveal': kind, 'data-reveal-delay': delay ?? null }),
    /** A WhatsApp link to the association's phone (filled in live from public_org_info; hidden until then). */
    whatsapp: (label, o = {}) =>
      html`<a${attrs({ class: o.className, href: crm.home, 'data-org-phone': 'whatsapp', 'data-org-text': o.text ?? null, hidden: true, rel: 'noopener' })}>${label}</a>`,
    ctaHref: byId.has(CTA_PAGE) ? pagePath(CTA_PAGE, lang) : crm.home,
    brand: {
      logo: brand.logo,
      /** Stripes in this page's reading direction; a `corner--ts|te|bs|be` class pins them to that corner (anchor). */
      stripes: (o = {}) => brand.stripes({ rtl: LANG_META[lang].dir === 'rtl', anchor: String(o.className ?? '').match(/\bcorner--([tb][se])\b/)?.[1], ...o }),
      chevron: (o = {}) => brand.chevron({ dir: LANG_META[lang].dir, ...o }),
      tri: (o = {}) => brand.tri({ dir: LANG_META[lang].dir, ...o }),
    },
  };
  ctx.ui = ui(ctx);
  return ctx;
}

function orgJsonLd(ctx) {
  const sameAs = (org.socials ?? []).map((s) => s.url).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'NGO',
    name: 'המשך תנועה',
    ...(org.nameEn ? { alternateName: org.nameEn } : {}),
    url: ctx.abs(pagePath('home', DEFAULT_LANG)),
    logo: ctx.abs(opts.base + 'assets/img/logo-square.png'),
    image: ctx.abs(opts.base + 'assets/og-image.png'),
    description: ctx.t('site.description'),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

const rendered = [];
for (const page of pages.filter((p) => byId.has(p.id))) {
  for (const lang of LANGS) {
    const ctx = makeCtx(page, lang);
    let doc;
    try {
      const body = page.mod.render(ctx);
      if (!isHtml(body)) throw new Error('render(ctx) must return html`…` (not a plain string)');
      const m = page.mod.meta ? page.mod.meta(ctx) : {};
      const title = m.title ?? ctx.t(page.mod.notFound ? 'notFound.metaTitle' : `${page.id}.meta.title`);
      const description = m.description ?? ctx.t(page.mod.notFound ? 'notFound.metaDescription' : `${page.id}.meta.description`);
      const jsonld = [...(page.id === 'home' ? [orgJsonLd(ctx)] : []), ...(page.mod.jsonld ? [page.mod.jsonld(ctx)].flat() : [])];
      doc = layout(ctx, { title, description, body, noindex: !!page.mod.notFound, jsonld, bodyClass: page.mod.bodyClass, ctaBar: page.mod.notFound ? false : page.mod.ctaBar });
    } catch (e) {
      fail(`pages/${page.file} (${lang}): ${e.message}`);
    }
    const file = page.mod.notFound
      ? LANG_META[lang].prefix + '404.html'
      : LANG_META[lang].prefix + (page.mod.slug[lang] ? page.mod.slug[lang] + '/' : '') + 'index.html';
    write(file, keepNames(doc.toString()));
    rendered.push({ id: page.id, lang, file, notFound: !!page.mod.notFound, url: ctx.page.url, alternates: ctx.page.alternates });
  }
}

if (missing.size) {
  const list = [...missing].sort().map((k) => `  - ${k}`).join('\n');
  if (opts.preview) console.warn(`⚠ missing copy (shown as ⟦key⟧ in this preview build):\n${list}`);
  else fail(`missing copy in site/content:\n${list}`);
}

// ───────────── sitemap + robots ─────────────

const indexable = rendered.filter((r) => !r.notFound && r.lang === DEFAULT_LANG);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${rendered
  .filter((r) => !r.notFound)
  .map(
    (r) => `  <url>
    <loc>${esc(r.alternates[r.lang])}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(r.alternates[l])}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(r.alternates[DEFAULT_LANG])}"/>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
write('sitemap.xml', sitemap);
write(
  'robots.txt',
  opts.robots === 'noindex'
    ? `User-agent: *\nDisallow: ${opts.base}\n`
    : `User-agent: *\nAllow: ${opts.base}\n\nSitemap: ${opts.origin}${opts.base}sitemap.xml\n`,
);

// ───────────── report ─────────────

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const jsTotal = Object.values(jsOut).reduce((n, j) => n + Buffer.byteLength(j.code), 0);
const jsGz = Object.values(jsOut).reduce((n, j) => n + gzipSync(j.code).length, 0);
log(
  `✓ site built${opts.preview ? ' (PREVIEW: owner-content boxes shown)' : ''} → ${relative(ROOT, out) || out}\n` +
    `  ${indexable.length} pages × ${LANGS.length} languages + 404 · base ${opts.base}\n` +
    `  CSS ${kb(Buffer.byteLength(css))} (${kb(gzipSync(css).length)} gz) · JS ${Object.keys(jsOut).length} modules ${kb(jsTotal)} (${kb(jsGz)} gz)\n` +
    `  photos: ${Object.keys(photos).join(', ') || 'none'} · Supabase ${supabaseOrigin || '(none)'}`,
);
