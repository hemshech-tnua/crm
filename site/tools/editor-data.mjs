// The texts of the site for the site editor (site/editor, /crm/site-editor/): window.TEXTS in data.js.
//
//   import { editorTexts } from './tools/editor-data.mjs'
//   editorTexts({ siteDir, frameDir, round })  →  { round, todo, site, sentGeneral, vals, hist, got, groups, items }
//
// Every Hebrew copy string (content/he.json, content/he/*.json, the Hebrew side of content/org.json) becomes one item;
// identical texts are one item with several `paths`. The editor finds each text on the page by its visible words, so
// an item's `he` is the text as a visitor reads it: **bold**, _em_ and [link](url) markup is dropped, a line break
// becomes a space. Placeholders ({n}, {year}…) stay in the text and are listed in `ph`; the editor matches them as
// wildcards. Groups are the pages of the frame build (frameDir), in menu order, plus "site" (header, footer, menus).
// `count` and `page` come from the built pages: on how many pages the words appear, and the first of them.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out;
}
/** content/<lang>.json + content/<lang>/<name>.json under <name> (as site/build.mjs loadCopy). */
export function loadCopy(siteDir, lang) {
  let dict = readJson(join(siteDir, 'content', `${lang}.json`));
  const dir = join(siteDir, 'content', lang);
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) dict = deepMerge(dict, { [basename(f, '.json')]: readJson(join(dir, f)) });
  return dict;
}

/** The text a visitor reads, the way the editor compares it (its norm()). */
export const norm = (s) => String(s).replace(/[⁦-⁩‎‏­]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
/** Copy markup (lib/html.mjs inline) → plain visible text. */
export const visible = (s) =>
  norm(
    String(s)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|[\s(])_(.+?)_(?=$|[\s.,;:!?)])/g, '$1$2')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
      .replace(/\n/g, ' '),
  );

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
/** The visible words of a built page (body only, no scripts, svg or styles). */
export function pageText(html) {
  const body = (html.match(/<body[\s\S]*<\/body>/i) || [html])[0];
  return norm(
    body
      .replace(/<(script|style|svg|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?(p|div|li|h[1-6]|section|header|footer|nav|main|ul|ol|dt|dd|tr|td|th|figcaption|summary|details|article|aside)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m)),
  );
}

/** What kind of text a key holds, in the words the editor shows ("כותרת", "פסקה"…). */
function labelOf(path) {
  const segs = path.split('.');
  const last = segs[segs.length - 1];
  const prev = segs[segs.length - 2] || '';
  if (segs[0] === 'photos' || /alt$/i.test(last)) return 'תיאור תמונה';
  if (prev === 'meta' && last === 'title') return 'כותרת בגוגל';
  if (prev === 'meta' && /desc/.test(last)) return 'תיאור בגוגל';
  if (/^\d+$/.test(last)) {
    // a line of a heading set as a list (each line its own string) is still a heading
    if (/^(h1|title|heading|h|h2|lines|headline)$/i.test(prev) || /title$|heading$/i.test(prev)) return 'כותרת';
    return 'שורה ברשימה';
  }
  if (/^(q|question)$/i.test(last)) return 'שאלה';
  if (/^(a|answer)$/i.test(last)) return 'תשובה';
  if (/^(h1|title|heading|h|h2|h3|head)$/i.test(last) || /title$|heading$/i.test(last)) return 'כותרת';
  if (/^(eyebrow|kicker|label|tag|badge|chip)$/i.test(last) || /label$/i.test(last)) return 'תווית';
  if (/^(lead|intro|sub|subtitle|dek)$/i.test(last)) return 'פסקת פתיחה';
  if (/cta|button|btn/i.test(last)) return 'כפתור';
  if (/link|more|all$/i.test(last)) return 'קישור';
  if (/aria|sr$|^sr/i.test(last)) return 'טקסט לקורא מסך';
  return 'פסקה';
}

/** Keys that hold no visible copy: notes (_x), ids and names of icons, pages or links, owner-content slot labels
 * (shown only in preview builds, never on the live pages). */
const NOT_COPY = /(^|\.)_|(^|\.)(icon|page|id|key|kind|type|href|url|slot)(\.|$)|^slots\./;
const isText = (s) => typeof s === 'string' && /[֐-׿A-Za-z0-9]/.test(s) && !/^(https?:|mailto:|tel:|#|\/)/.test(s.trim()) && !/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s.trim()) && norm(visible(s)).length >= 2;

/** Every string leaf of a value: [path, string]. Arrays are walked with their index. */
function leaves(v, path, out) {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}.${i}`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, path ? `${path}.${k}` : k, out);
  return out;
}
const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);

/**
 * @param {{ siteDir: string, frameDir: string, round?: string }} o
 *   siteDir  the site source (site/)
 *   frameDir the editor's frame build (dist/site-editor/frame): which pages exist, their names and words
 */
export async function editorTexts({ siteDir, frameDir, round }) {
  const he = loadCopy(siteDir, 'he');
  const en = loadCopy(siteDir, 'en');
  const org = readJson(join(siteDir, 'content', 'org.json'));
  const { SECTIONS, OUTSIDE_SECTIONS, NAV } = await import(pathToFileURL(join(siteDir, 'config.mjs')).href);

  // ── the pages (groups): the order of the menus, only pages this build wrote ──
  const mods = {};
  for (const f of readdirSync(join(siteDir, 'pages')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))) {
    const m = await import(pathToFileURL(join(siteDir, 'pages', f)).href);
    if (!m.notFound && !m.redirect && m.slug) mods[m.id ?? basename(f, '.mjs')] = m.slug.he; // forwarding addresses have no texts
  }
  // the menu's six pages first, in its order, then each section's other pages
  const order = ['home', ...(NAV ?? []), ...SECTIONS.flatMap((s) => [s.hub, ...s.pages]), ...OUTSIDE_SECTIONS.filter((p) => p !== 'home' && p !== '404')];
  const pages = [];
  for (const id of order) {
    if (!(id in mods) || pages.some((p) => p.page === id)) continue;
    const path = mods[id] ? mods[id] + '/' : '';
    const file = join(frameDir, path, 'index.html');
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const h1 = pageText((html.match(/<h1\b[\s\S]*?<\/h1>/i) || [''])[0]);
    const name = id === 'home' ? 'עמוד הבית' : h1 || id;
    pages.push({ page: id, id: id === 'home' ? 'index' : id, name, path, text: pageText(html) });
  }
  const groupOfPage = Object.fromEntries(pages.map((p) => [p.page, p.id]));
  // content keys → the page they belong to (top-level key = page id; a section hub's own copy lives in sections.<id>)
  const hubOf = Object.fromEntries(SECTIONS.map((s) => [s.id, s.hub]));
  function groupOfKey(path) {
    const [a, b] = path.split('.');
    if (a === 'sections' && hubOf[b] && groupOfPage[hubOf[b]]) return groupOfPage[hubOf[b]];
    if (groupOfPage[a]) return groupOfPage[a];
    return 'site';
  }

  // ── the texts ──
  const raw = [
    ...leaves(he, '', []),
    ...leaves(org, 'org', []).filter(([p]) => /\.he$/.test(p) || !/\.(en|url|href|photo|image|phone|email|whatsapp)$/i.test(p)).filter(([p]) => !/\.en$/.test(p)),
  ]
    .filter(([p]) => !NOT_COPY.test(p))
    .filter(([, s]) => isText(s) && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.trim()));
  const byText = new Map();
  for (const [path, s] of raw) {
    const t = visible(s);
    if (!byText.has(t)) byText.set(t, []);
    byText.get(t).push(path);
  }
  const items = [];
  const ids = new Set();
  for (const [t, paths] of byText) {
    paths.sort();
    const first = paths[0];
    const groups = [...new Set(paths.map(groupOfKey))];
    const ph = [...new Set(t.match(/\{[A-Za-z_]+\}/g) || [])];
    const words = ph.length ? t.split(/\{[A-Za-z_]+\}/).map(norm).filter((w) => w.length > 2) : [t];
    const onPages = words.length ? pages.filter((p) => words.every((w) => p.text.includes(w))) : [];
    const kind = /\.meta\./.test('.' + first + '.') || /^site\.(description|title)/.test(first)
      ? 'g'
      : first.startsWith('photos.') || first.startsWith('a11y.') || /(aria|Aria|label|Label|^nav\.menu)/.test(first.split('.').pop()) && onPages.length === 0
        ? 'h'
        : 'v';
    let id = parseInt(createHash('sha1').update(first).digest('hex').slice(0, 7), 16);
    while (ids.has(id)) id++;
    ids.add(id);
    const enPath = first.startsWith('org.') ? first.replace(/^org\./, '').replace(/\.he$/, '.en') : first;
    const enV = first.startsWith('org.') ? lookup(org, enPath) : lookup(en, first);
    items.push({
      id,
      g: groups.length > 1 || onPages.length > 2 ? 'site' : groups[0],
      page: onPages[0]?.id ?? (groups[0] === 'site' ? 'index' : groups[0]),
      label: labelOf(first),
      kind,
      he: t,
      en: typeof enV === 'string' ? visible(enV) : '',
      ph,
      paths,
      count: onPages.length,
      pos: 0,
      v: createHash('sha1').update(t).digest('hex').slice(0, 6),
    });
  }
  // the order on screen: by group (menu order), then by where the text first appears on that page
  const gOrder = Object.fromEntries([['site', -1], ...pages.map((p, i) => [p.id, i])]);
  const textOf = Object.fromEntries(pages.map((p) => [p.id, p.text]));
  for (const it of items) {
    const at = (textOf[it.g === 'site' ? it.page : it.g] || '').indexOf(it.he.split(/\{[A-Za-z_]+\}/)[0]);
    it.pos = at < 0 ? 1e7 : at;
  }
  items.sort((a, b) => gOrder[a.g] - gOrder[b.g] || a.pos - b.pos || a.id - b.id);
  const posInGroup = {};
  for (const it of items) it.pos = posInGroup[it.g] = (posInGroup[it.g] ?? -1) + 1;

  return {
    round: round || new Date().toISOString().slice(0, 10),
    todo: [],
    site: '',
    sentGeneral: '',
    vals: {},
    hist: {},
    got: {},
    groups: [
      { id: 'site', name: 'בכל האתר: תפריט, תחתית וכפתורים', optional: false, path: '' },
      ...pages.map((p) => ({ id: p.id, name: p.name, optional: false, path: p.path })),
    ],
    items,
  };
}
