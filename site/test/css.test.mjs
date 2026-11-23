// CSS rules every team keeps: never a white background; logical properties only (RTL + LTR from one stylesheet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SITE, walk, read } from './helpers.mjs';

const files = walk(join(SITE, 'assets/css'), '.css');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('no white backgrounds', () => {
  const WHITE = /background(-color)?\s*:[^;}]*(#fff\b|#ffffff\b|#fffffff?f?\b|\bwhite\b|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*1(\.0+)?\s*)?\)|hsl\(\s*0\s*,\s*0%\s*,\s*100%\s*\))/i;
  for (const f of files) {
    strip(read(f)).split('\n').forEach((line, i) => assert.doesNotMatch(line, WHITE, `${f}:${i + 1} ${line.trim()}`));
  }
});

test('logical properties only (no physical left/right)', () => {
  const PHYS = /(^|[\s;{])(margin|padding|border)-(left|right)(-[a-z]+)?\s*:|(^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)|float\s*:\s*(left|right)|clear\s*:\s*(left|right)/;
  for (const f of files) {
    strip(read(f)).split('\n').forEach((line, i) => assert.doesNotMatch(line, PHYS, `${f}:${i + 1} ${line.trim()} — use inline-start/inline-end`));
  }
});

test('every file is in a cascade layer (except @font-face)', () => {
  for (const f of files) {
    const s = strip(read(f)).replace(/@font-face\s*\{[^}]*\}/g, '').trim();
    if (!s) continue;
    assert.match(s, /^@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*[;{]/, `${f} must start with @layer`);
  }
});
