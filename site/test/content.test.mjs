// Copy rules: Hebrew and English have the same keys; no slashed/dotted gender forms; nav and photos are labelled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { SITE, read } from './helpers.mjs';
import { NAV } from '../config.mjs';

const load = (lang) => {
  const d = JSON.parse(read(join(SITE, 'content', `${lang}.json`)));
  const dir = join(SITE, 'content', lang);
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) d[basename(f, '.json')] = JSON.parse(read(join(dir, f)));
  return d;
};
const he = load('he');
const en = load('en');
const keys = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const strings = (o) => (typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : []);

test('Hebrew and English copy have the same keys', () => {
  const a = new Set(keys(he));
  const b = new Set(keys(en));
  assert.deepEqual([...a].filter((k) => !b.has(k)), [], 'in he.json, missing in en.json');
  assert.deepEqual([...b].filter((k) => !a.has(k)), [], 'in en.json, missing in he.json');
});

test('no slashed or dotted gender forms in Hebrew copy (לוחמים/ות, ללוחמים.ות)', () => {
  const org = JSON.parse(read(join(SITE, 'content', 'org.json')));
  for (const s of [...strings(he), ...strings(org)]) {
    const t = s.replace(/ו\/או/g, '');
    assert.doesNotMatch(t, /[א-ת][/.][א-ת]/, `"${s}"`);
  }
});

test('every nav id and every photo has a label in both languages', () => {
  for (const id of [...NAV.primary, ...NAV.secondary, 'home']) {
    assert.equal(typeof he.nav[id], 'string', `he nav.${id}`);
    assert.equal(typeof en.nav[id], 'string', `en nav.${id}`);
  }
  const photos = new Set(readdirSync(join(SITE, 'assets/photos')).map((f) => f.replace(/-\d+\.\w+$/, '')));
  for (const p of photos) {
    assert.ok(he.photos?.[p], `he photos.${p} (alt text)`);
    assert.ok(en.photos?.[p], `en photos.${p} (alt text)`);
  }
});
