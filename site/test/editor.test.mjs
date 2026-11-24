// The site editor (site/editor → /crm/site-editor/): its build, the texts it knows (tools/editor-data.mjs), and the
// frame's CSP (the public site keeps require-trusted-types; only the editor's private copy leaves it out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SITE, walk, read } from './helpers.mjs';
import { visible, pageText } from '../tools/editor-data.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'site-editor-test-')), 'site-editor');
const r = spawnSync(process.execPath, [join(SITE, 'editor', 'build.mjs'), '--quiet'], {
  env: { ...process.env, SITE_PREVIEW: '', SITE_EDITOR_OUT: out },
  encoding: 'utf8',
});
const texts = (() => {
  try {
    const s = read(join(out, 'data.js'));
    return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
})();

test('the editor builds: page, script, frame styles, texts and the frame copy of the site', () => {
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['index.html', 'editor.js', 'frame-editor.css', 'data.js', 'robots.txt', 'frame/index.html', 'frame/friday/index.html']) assert.ok(existsSync(join(out, f)), f);
  const page = read(join(out, 'index.html'));
  assert.doesNotMatch(page, /\{\{[A-Z]+\}\}/, 'every placeholder filled');
  assert.match(page, /<meta name="robots" content="noindex/);
  assert.match(page, /<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'self'[^"]*frame-src 'self'/);
  assert.match(page, /שלום אורי/);
});

test('the frame pages are noindex and leave out only require-trusted-types; the public CSP keeps it', async () => {
  for (const f of walk(join(out, 'frame'), '.html')) {
    const html = read(f);
    assert.match(html, /<meta name="robots" content="noindex">/, f);
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
    assert.doesNotMatch(csp, /require-trusted-types-for/, f);
    assert.match(csp, /script-src 'self';/, f);
    assert.match(html, /\/crm\/site-editor\/frame\//, `${f}: links stay inside the frame copy`);
  }
  const { csp } = await import('../partials/head.mjs');
  assert.match(csp('https://x.supabase.co'), /require-trusted-types-for 'script'/);
});

test('texts: one item per Hebrew text, stable ids, found on the pages they belong to', () => {
  assert.ok(texts, 'data.js parses');
  assert.equal(texts.round, '2026-11-24');
  assert.deepEqual(texts.todo, []);
  const ids = new Set(texts.items.map((i) => i.id));
  assert.equal(ids.size, texts.items.length, 'ids are unique');
  const groups = texts.groups.map((g) => g.id);
  for (const g of ['site', 'index', 'friday', 'about', 'donate']) assert.ok(groups.includes(g), g);
  for (const it of texts.items) {
    assert.ok(it.he && it.paths.length && /^[0-9a-f]{6}$/.test(it.v) && groups.includes(it.g), JSON.stringify(it).slice(0, 200));
    assert.doesNotMatch(it.he, /\*\*|\]\(/, `markup is dropped: ${it.paths[0]}`);
  }
  const someHome = texts.items.filter((i) => i.paths.some((p) => p.startsWith('home.')) && i.kind === 'v');
  assert.ok(someHome.length > 20);
  const found = someHome.filter((i) => i.count > 0).length;
  assert.ok(found / someHome.length > 0.7, `most home texts are found on the built pages (${found}/${someHome.length})`);
  // the editor's own copy does not carry an email address (it comes from the link: #to=)
  for (const f of readdirSync(join(SITE, 'editor'))) assert.doesNotMatch(read(join(SITE, 'editor', f)), /[\w.+-]+@[\w-]+\.(com|org|il|net)\b/, f);
});

test('visible() and pageText() read text the way a visitor does', () => {
  assert.equal(visible('**שלושה** בקרים [בחודש](/x)\nבשישי'), 'שלושה בקרים בחודש בשישי');
  assert.equal(pageText('<body><h1>המשך&nbsp;תנועה</h1><script>x</script><p>א<br>ב</p></body>'), 'המשך תנועה א ב');
});
