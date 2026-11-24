// Per-page share images (assets/og, tools/og.mjs → partials/head.mjs): every listed image exists, is a 1200×630 JPEG of
// at most 250 KB (WhatsApp), and has an alt in both languages; built pages point at their own image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, build, read } from './helpers.mjs';
import { OG_IMAGES } from '../partials/head.mjs';

/** Width/height from a JPEG's SOFn marker. */
function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'JPEG signature');
  for (let i = 2; i < buf.length; ) {
    const marker = buf.readUInt16BE(i);
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

test('og: every image is a 1200×630 JPEG ≤ 250 KB with an alt in he and en', () => {
  assert.ok(Object.keys(OG_IMAGES).length >= 10, 'og.json lists the pages');
  for (const [id, langs] of Object.entries(OG_IMAGES)) {
    for (const lang of ['he', 'en']) {
      const o = langs[lang];
      assert.ok(o?.image && o.alt?.length >= 10, `${id}/${lang}: image + alt`);
      const f = join(SITE, 'assets', o.image);
      assert.ok(existsSync(f), `${o.image} exists`);
      assert.ok(statSync(f).size <= 250 * 1024, `${o.image} ≤ 250 KB`);
      assert.deepEqual(jpegSize(readFileSync(f)), { w: 1200, h: 630 }, `${o.image} is 1200×630`);
    }
  }
});

test('og: built pages use their own share image', () => {
  const prod = build();
  assert.equal(prod.status, 0, prod.stderr);
  for (const [file, img] of [['friday/index.html', 'og/friday-he.jpg'], ['en/friday/index.html', 'og/friday-en.jpg'], ['index.html', 'og/home-he.jpg']]) {
    const html = read(join(prod.out, file));
    assert.match(html, new RegExp(`<meta property="og:image" content="https://[^"]+/assets/${img}">`), file);
    assert.match(html, /<meta property="og:image:type" content="image\/jpeg">/, file);
    assert.ok(existsSync(join(prod.out, 'assets', img)), `${img} is copied`);
  }
});
