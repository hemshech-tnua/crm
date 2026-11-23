// Responsive photos without dependencies. Variants live in site/assets/photos/<name>-<width>.webp (made once with
// site/tools/resize-photos.py); the build reads their real pixel sizes from the files (WebP, PNG and JPEG headers).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { html, attrs } from './html.mjs';

/** Pixel size of a WebP / PNG / JPEG file, read from its header. */
export function imageSize(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const n = b.readUInt32LE(21);
      return { width: 1 + (n & 0x3fff), height: 1 + ((n >> 14) & 0x3fff) };
    }
  }
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) break;
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  throw new Error(`imageSize: unsupported or broken image ${file}`);
}

/** { name: [{ w, h, file }] sorted by width } for every <name>-<width>.<ext> in a folder. */
export function scanPhotos(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const m = f.match(/^([a-z0-9][a-z0-9-]*?)-(\d+)\.(webp|png|jpe?g|avif)$/);
    if (!m) continue;
    const { width, height } = imageSize(join(dir, f));
    if (width !== Number(m[2])) throw new Error(`photos: ${f} is ${width}px wide, not ${m[2]}`);
    (out[m[1]] ??= []).push({ w: width, h: height, file: f });
  }
  for (const v of Object.values(out)) v.sort((a, b) => a.w - b.w);
  return out;
}

/**
 * <img> with srcset/sizes, width/height (no layout shift) and lazy loading.
 *   photo(variants, urlBase, { alt, sizes, eager, className, ...extraAttrs })
 * alt is required: pass the description from content, or '' only for a purely decorative image.
 * eager: true for the hero / LCP image (loading=eager + fetchpriority=high); everything else is lazy.
 */
export function photo(name, variants, urlBase, opts = {}) {
  const { alt, sizes = '100vw', eager = false, className, ...rest } = opts;
  if (!variants?.length) throw new Error(`img: no photo "${name}" in site/assets/photos (expected ${name}-<width>.webp)`);
  if (typeof alt !== 'string') throw new Error(`img("${name}"): alt text is required ('' only for decorative images)`);
  const largest = variants[variants.length - 1];
  const fallback = variants.find((v) => v.w >= 1024) ?? largest;
  return html`<img${attrs({
    src: urlBase + fallback.file,
    srcset: variants.map((v) => `${urlBase}${v.file} ${v.w}w`).join(', '),
    sizes,
    width: largest.w,
    height: largest.h,
    alt,
    loading: eager ? 'eager' : 'lazy',
    fetchpriority: eager ? 'high' : null,
    decoding: eager ? null : 'async',
    class: className,
    ...rest,
  })}>`;
}
