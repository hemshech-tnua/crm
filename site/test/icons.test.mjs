// The icon set (site/assets/icons, lib/icons.mjs): every contract name exists and follows the drawing rules; the
// helper is decorative by default, labelled on request, and renders nothing for an unknown name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './helpers.mjs';
import { ICON_NAMES, loadIcons, iconHelper, iconTextHelper } from '../lib/icons.mjs';

const dir = join(SITE, 'assets/icons');
const set = loadIcons(dir);

test('icons: every contract name has a file with a <title> on the 24×24 grid', () => {
  for (const name of ICON_NAMES) {
    assert.ok(set[name], `assets/icons/${name}.svg is missing`);
    const src = readFileSync(join(dir, `${name}.svg`), 'utf8');
    assert.match(src, /viewBox="0 0 24 24"/, `${name}: viewBox`);
    assert.match(src, /<title>[^<]{3,}<\/title>/, `${name}: <title>`);
    assert.doesNotMatch(src, /<(style|script|circle|ellipse|image)\b|\bstyle=|\son\w+=/, `${name}: no style/script/circles`);
    assert.doesNotMatch(src, /#[0-9a-f]{3,6}\b|rgb\(/i, `${name}: currentColor only`);
    // brand geometry: path commands are straight lines only (no curves or arcs)
    for (const d of src.matchAll(/ d="([^"]+)"/g)) assert.doesNotMatch(d[1], /[CcSsQqTtAa]/, `${name}: straight lines only`);
  }
});

test('icons: helper output', () => {
  const icon = iconHelper(set);
  const deco = String(icon('coffee'));
  assert.match(deco, /^<svg class="icon icon--coffee" viewBox="0 0 24 24" width="24" height="24"/);
  assert.match(deco, /aria-hidden="true"/);
  assert.doesNotMatch(deco, /<title>|role=/);
  const named = String(icon('clock', { label: 'שעה <9>', size: 32 }));
  assert.match(named, /role="img" aria-label="שעה &lt;9&gt;"/);
  assert.match(named, /<title>שעה &lt;9&gt;<\/title>/);
  assert.match(named, /width="32" height="32"/);
  assert.equal(String(icon('no-such-icon')), '');
  const pair = String(iconTextHelper(icon)('map-pin', 'מודיעין', { tag: 'li' }));
  assert.match(pair, /^<li class="icon-text"><svg[^>]+aria-hidden="true"[\s\S]*<\/svg><span>מודיעין<\/span><\/li>$/);
  assert.throws(() => iconTextHelper(icon)('map-pin', 'x', { tag: 'script' }));
});
