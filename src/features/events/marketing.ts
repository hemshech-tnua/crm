// Event invitations, drawn locally on a <canvas> by the brand book "Moving Forward / המשך תנועה" (October 2026):
// no AI at run time, no cost, no external service. Text is drawn right-to-left with the site's own bundled typeface.
//
// The book's grid: every format has an image zone (a photograph or the brand's shapes) and a content zone; the
// Hebrew logo sits in the top-right corner, everything Hebrew is right-aligned, margins are equal on all sides, and
// only photographs and shapes run to the edge of the format. Three grid types, as on its page "סוגי גריד":
//   photo    02, short content on a photograph: a run of stripes enters the photo from a free corner
//   shapes   01, no photograph: the chevron fills the image zone, the headline sits in its open corner
//   program  03, a lot of content: a thin stripe band at the edges, a schedule with triangle bullets ◀
// Shapes: 45° only, stripe width = gap, all stripes in one composition parallel, one colour, cut only by the edges
// of the format or of a zone, and never over a face, the logo or text.
// The zones are measured from the content (no empty holes); both columns end on the bottom margin. Stories keep the
// logo, the text and the call to action out of Instagram's own bars (SAFE_TOP, SAFE_BOTTOM); shapes may run under them.
import { LOGO_PATHS } from '@/ui/Logo';

export type PostFormat = 'portrait' | 'square' | 'story';
export type PostLayout = 'photo' | 'shapes' | 'program';
/** navy: navy ground, beige shapes and type · beige: the reverse. The book gives both equal status. */
export type PostTheme = 'navy' | 'beige';

export type PostContent = {
  org: string;
  /** the headline: up to five words, an action verb where possible */
  title: string;
  /** a short line above the headline (the event's name); optional */
  kicker: string;
  /** "יום שישי, 13 בנובמבר" */
  date: string;
  /** "9:00–11:30" (drawn left-to-right) */
  time: string;
  place: string;
  /** "יוגה · הרצאת אורח · ארוחת בוקר · זמן ביחד" */
  program: string;
  speakerName: string;
  topic: string;
  cta: string;
  /** Optional short link under the call to action (drawn left-to-right). */
  link: string;
};

/** [left, top, right, bottom] as fractions of a photograph's width and height. */
export type Box = [number, number, number, number];
export type Corner = 'top-left' | 'bottom-left' | 'bottom-right';
/** How a photograph is cropped and where shapes may go on it (see photos.ts). */
export type PhotoArt = {
  band: { top: number; bottom: number };
  faces?: Box[];
  keep?: Box[];
  corners?: Corner[];
  mirror?: boolean;
  /** the horizontal centre kept when a wide photograph is cropped at the sides */
  x?: number;
  /** nothing is known about the photograph: keep the stripes to a small run */
  modest?: boolean;
};

export type PostDesign = {
  layout: PostLayout;
  theme: PostTheme;
  /** the photograph for the photo layout (already loaded) */
  photo?: HTMLImageElement | null;
  art?: PhotoArt;
};

export const POST_SIZE: Record<PostFormat, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1350 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

export const NAVY = '#142837';
export const BEIGE = '#EBDCB9';
const FAMILY = '"Google Sans Variable", "Google Sans", system-ui, sans-serif';
const font = (weight: number, size: number) => `${weight} ${Math.round(size)}px ${FAMILY}`;
const R2 = Math.SQRT2;
/** Instagram's own bars on a story: the profile row at the top, the reply field at the bottom. */
const SAFE_TOP = 250;
const SAFE_BOTTOM = 340;
// type metrics of Google Sans (Hebrew): baseline below the top of a line, and the descent under it
const CAP = 0.76;
const DESC = 0.24;

/** Fonts must be loaded before drawing, or the canvas silently falls back to a system font. */
export async function loadPostFonts(timeoutMs = 4000): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const he = 'מפגש שישי יום הרשמה בקישור בביו אבגדהוזחטיכלמנסעפצקרשתךםןףץ';
  const latin = '0123456789:–·-/.,abcdefghijklmnopqrstuvwxyz';
  const loads = Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(font(w, 60), he + latin)))
    .then(() => true, () => false);
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs));
  return Promise.race([loads, timeout]);
}

/** Loads an image (a bundled photograph or one the coordinator picked from the device). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

// ───────────── text ─────────────

/** Greedy word wrap by measured width (works for Hebrew; words never split). */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = Infinity): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || ctx.measureText(t).width <= maxWidth) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.includes(' ') && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, last.lastIndexOf(' '));
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

/** Like wrapText, but evens out line lengths (no orphan word on the last line), as CSS text-wrap: balance. */
export function wrapBalanced(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = Infinity): string[] {
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  if (lines.length < 2 || lines.length > maxLines || lines[lines.length - 1].endsWith('…')) return lines;
  let lo = maxWidth * 0.4;
  let hi = maxWidth;
  let best = lines;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const tryLines = wrapText(ctx, text, mid);
    if (tryLines.length === lines.length && tryLines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      best = tryLines;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

/**
 * Wraps a list ("יוגה · הרצאת אורח · ארוחת בוקר") only between items, so a "·" never dangles at a line end; balanced
 * like wrapBalanced. Falls back to a word wrap when one item is wider than the line on its own.
 */
export function wrapItems(ctx: CanvasRenderingContext2D, items: string[], maxWidth: number, maxLines = Infinity, sep = ' · '): string[] {
  const xs = items.map((s) => s.trim()).filter(Boolean);
  if (!xs.length) return [];
  if (xs.some((x) => ctx.measureText(x).width > maxWidth)) return wrapBalanced(ctx, xs.join(sep), maxWidth, maxLines);
  const greedy = (width: number) => {
    const out: string[] = [];
    let cur = '';
    for (const x of xs) {
      const t = cur ? `${cur}${sep}${x}` : x;
      if (!cur || ctx.measureText(t).width <= width) cur = t;
      else {
        out.push(cur);
        cur = x;
      }
    }
    if (cur) out.push(cur);
    return out;
  };
  const lines = greedy(maxWidth);
  if (lines.length < 2) return lines;
  let lo = maxWidth * 0.4;
  let hi = maxWidth;
  let best = lines;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const t = greedy(mid);
    if (t.length === lines.length) {
      best = t;
      hi = mid;
    } else lo = mid;
  }
  return best.length > maxLines ? lines : best;
}

const splitItems = (program: string) => program.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);

function rtl(ctx: CanvasRenderingContext2D) {
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
}
function ltr(ctx: CanvasRenderingContext2D) {
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
}

/** Largest font size (down to `min`) at which a single line fits. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, min: number, maxWidth: number) {
  let s = size;
  ctx.font = font(weight, s);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = font(weight, s);
  }
  return s;
}

/** A block of content measured before it is drawn: its height, and how to draw it from a top edge. */
type Block = { h: number; draw: (top: number) => void };
const EMPTY: Block = { h: 0, draw: () => undefined };

/** Stacks blocks with gaps (a gap before an empty block is skipped). */
function stack(parts: [Block, number][]): Block {
  const real = parts.filter(([b]) => b.h > 0);
  const h = real.reduce((a, [b, gap], i) => a + b.h + (i ? gap : 0), 0);
  return {
    h,
    draw: (top) => {
      let y = top;
      real.forEach(([b, gap], i) => {
        if (i) y += gap;
        b.draw(y);
        y += b.h;
      });
    },
  };
}

type Line = { text: string; weight: number; size: number; ltrText?: boolean; bullet?: boolean };

/** Lines in groups (one fact per group), right-aligned at `right`; a group gap is half a line. */
function linesBlock(ctx: CanvasRenderingContext2D, groups: Line[][], right: number, color: string, lh = 1.3, gapK = 0.5): Block {
  const placed: { l: Line; base: number }[] = [];
  let base = 0;
  let prev: Line | null = null;
  groups.filter((g) => g.length).forEach((g) => g.forEach((l, li) => {
    base = prev ? base + prev.size * DESC + l.size * CAP + l.size * (lh - 1) + (li === 0 ? l.size * gapK : 0) : l.size * CAP;
    placed.push({ l, base });
    prev = l;
  }));
  if (!placed.length) return EMPTY;
  const last = placed[placed.length - 1];
  return {
    h: last.base + last.l.size * DESC,
    draw: (top) => {
      ctx.fillStyle = color;
      for (const { l, base: b } of placed) {
        ctx.font = font(l.weight, l.size);
        let x = right;
        if (l.bullet) {
          tri(ctx, right, top + b - l.size * 0.36, l.size * 0.62, color);
          x = right - l.size * 0.72;
        }
        if (l.ltrText) ltr(ctx);
        else rtl(ctx);
        ctx.fillText(l.text, x, top + b);
      }
    },
  };
}

/** Wrapped lines of one fact. */
function wrapped(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, width: number, maxLines: number, bullet = false): Line[] {
  ctx.font = font(weight, size);
  return wrapBalanced(ctx, text, width - (bullet ? size * 0.72 : 0), maxLines).map((t, i) => ({ text: t, weight, size, bullet: bullet && i === 0 }));
}

/** "יום שישי, 20 בנובמבר · 9:00–11:30" on one line when it fits (shrinking to `min`), else date and time on two. */
function whenLines(ctx: CanvasRenderingContext2D, c: PostContent, size: number, min: number, width: number, weight = 600, bullet = false): Line[] {
  const room = width - (bullet ? size * 0.72 : 0);
  if (c.date && c.time) {
    const both = `${c.date} · ⁦${c.time}⁩`;
    const s = fitSize(ctx, both, weight, size, min, room);
    ctx.font = font(weight, s);
    if (ctx.measureText(both).width <= room) return [{ text: both, weight, size: s, bullet }];
  }
  const out: Line[] = [];
  if (c.date) out.push(...wrapped(ctx, c.date, weight, size, width, 2, bullet));
  if (c.time) out.push({ text: c.time, weight, size, ltrText: true });
  return out;
}

/** The headline: the kicker (Semibold) over the title (Bold, tight), the largest size at which it fits `maxLines`. */
function fitTitle(ctx: CanvasRenderingContext2D, title: string, width: number, size: number, min: number, maxLines: number) {
  for (let s = size; s >= min; s -= 2) {
    ctx.font = font(700, s);
    const lines = wrapBalanced(ctx, title, width, maxLines);
    if (lines.every((l) => ctx.measureText(l).width <= width) && !lines[lines.length - 1]?.endsWith('…')) return { s, lines, ok: true };
  }
  ctx.font = font(700, min);
  return { s: min, lines: wrapText(ctx, title, width, maxLines), ok: false };
}

function headlineBlock(ctx: CanvasRenderingContext2D, c: PostContent, right: number, width: number, size: number, maxLines: number, color: string, minK = 0.6): Block & { s: number } {
  const ks = Math.round(Math.max(30, size * 0.36));
  const kick = c.kicker.trim();
  let kickSize = ks;
  if (kick) kickSize = fitSize(ctx, kick, 600, ks, Math.round(ks * 0.75), width);
  // two lines read as a headline, three as a column of words: take two at up to 80% of the size before three
  const title = c.title.trim();
  let fit = { s: size, lines: [] as string[] };
  if (title) {
    const two = maxLines > 2 ? fitTitle(ctx, title, width, size, Math.round(size * 0.8), 2) : null;
    fit = two?.ok ? two : fitTitle(ctx, title, width, size, Math.round(size * minK), maxLines);
  }
  const { s, lines } = fit;
  const kH = kick ? kickSize * (CAP + DESC) + Math.max(10, s * 0.14) : 0;
  const lead = s * 1.0;
  const tH = lines.length ? s * 0.74 + (lines.length - 1) * lead + s * 0.12 : 0;
  ctx.font = font(700, s);
  return {
    s,
    h: kH + tH,
    draw: (top) => {
      ctx.fillStyle = color;
      rtl(ctx);
      if (kick) {
        ctx.font = font(600, kickSize);
        ctx.fillText(kick, right, top + kickSize * CAP);
      }
      ctx.font = font(700, s);
      lines.forEach((l, i) => ctx.fillText(l, right, top + kH + s * 0.74 + i * lead));
    },
  };
}

/** The triangle bullet ◀ : a right isosceles triangle, `h` tall, its vertical side at `rightX`, pointing left. */
function tri(ctx: CanvasRenderingContext2D, rightX: number, cy: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(rightX, cy - h / 2);
  ctx.lineTo(rightX, cy + h / 2);
  ctx.lineTo(rightX - h / 2, cy);
  ctx.closePath();
  ctx.fill();
}

/** The call to action as the book's button (p.41): a filled block in the type colour, the label and ◀ in the ground. */
function ctaBlock(ctx: CanvasRenderingContext2D, text: string, right: number, size: number, maxW: number, fg: string, ground: string): Block {
  if (!text.trim()) return EMPTY;
  const extra = (s: number) => s * 0.7 * 2 + s * 0.31 + s * 0.42;
  let s = size;
  ctx.font = font(700, s);
  while (s > size * 0.7 && ctx.measureText(text).width + extra(s) > maxW) {
    s -= 1;
    ctx.font = font(700, s);
  }
  const tw = Math.min(ctx.measureText(text).width, maxW - extra(s));
  const bw = tw + extra(s);
  const bh = Math.round(size * 1.9);
  return {
    h: bh,
    draw: (top) => {
      ctx.fillStyle = fg;
      ctx.fillRect(right - bw, top, bw, bh);
      ctx.font = font(700, s);
      ctx.fillStyle = ground;
      rtl(ctx);
      const base = top + bh / 2 + s * 0.36;
      ctx.fillText(text, right - s * 0.7, base, tw);
      tri(ctx, right - s * 0.7 - tw - s * 0.42, top + bh / 2, s * 0.62, ground);
    },
  };
}

/** The short registration link, left-to-right, right-aligned. */
function linkBlock(ctx: CanvasRenderingContext2D, link: string, right: number, size: number, width: number, color: string): Block {
  if (!link) return EMPTY;
  const s = fitSize(ctx, link, 500, size, 16, width);
  return {
    h: s * (CAP + DESC),
    draw: (top) => {
      ctx.font = font(500, s);
      ctx.fillStyle = color;
      ltr(ctx);
      ctx.fillText(link, right, top + s * CAP);
    },
  };
}

// ───────────── the logo ─────────────

const LOGO_RATIO = (() => {
  const [, , vw, vh] = LOGO_PATHS.VARIANTS.full.viewBox.split(' ').map(Number);
  return vw / vh;
})();

/** The official logo with its tagline, from the same vector paths as the app. `h` = drawn height. */
function drawLogo(ctx: CanvasRenderingContext2D, right: number, top: number, h: number, color: string) {
  const v = LOGO_PATHS.VARIANTS.full;
  const [vx, vy, vw, vh] = v.viewBox.split(' ').map(Number);
  const k = h / vh;
  ctx.save();
  ctx.translate(right - vw * k, top);
  ctx.scale(k, k);
  ctx.translate(-vx, -vy);
  ctx.fillStyle = color;
  for (const part of v.parts) for (const [rule, d] of part) ctx.fill(new Path2D(d), rule);
  ctx.restore();
}

// ───────────── shapes ─────────────

type Pt = [number, number];
type Rect = [number, number, number, number];

function fillPoly(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/**
 * Parallel 45° stripes inside the rectangle `r`: "fall" = "\" (x − y constant), "rise" = "/" (x + y constant).
 * `unit` is X, the stripe's width across (= the gap). `phase` is the x at the rectangle's top edge where a stripe's
 * right side lies, so a composition can put the cut exactly on the stripe grid.
 */
function stripeRect(ctx: CanvasRenderingContext2D, r: Rect, unit: number, color: string, dir: 'fall' | 'rise', phase: number) {
  const [x0, y0, x1, y1] = r;
  const w = unit * R2;
  const step = 2 * w;
  const h = y1 - y0;
  const s = dir === 'fall' ? 1 : -1; // x moves by s·dy along a stripe
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  ctx.fillStyle = color;
  const lo = x0 - h - step * 2;
  const hi = x1 + h + step * 2;
  let k = phase - w - Math.ceil((phase - w - lo) / step) * step;
  for (; k < hi; k += step) fillPoly(ctx, [[k, y0], [k + w, y0], [k + w + s * h, y1], [k + s * h, y1]]);
  ctx.restore();
}

/**
 * A run of stripes entering a photograph from a corner, as the book's posters (pp.40, 52): `n` whole stripes that run
 * across the corner from one edge to the other, in one or two tiers `t` deep; the second tier is shifted by one
 * stripe (the book's step), so every stripe ends on a line parallel to an edge. Polygons in canvas coordinates
 * (clip to the zone when drawing).
 */
function cornerRun(corner: Corner, W: number, Z: number, unit: number, n: number, tiers: number, t: number): Pt[][] {
  const w = unit * R2;
  const step = 2 * w;
  const a = w * 0.5;
  const map = ([x, y]: Pt): Pt => [corner === 'bottom-right' ? W - x : x, corner === 'top-left' ? y : Z - y];
  const out: Pt[][] = [];
  for (let k = 0; k < tiers; k++) {
    const y0 = k * t;
    const y1 = y0 + t;
    for (let i = 0; i < n; i++) {
      const c = a + k * w + i * step;
      if (c + w - y0 <= w * 0.3) continue; // nothing left of it inside the format but a sliver
      out.push(([[c - y0, y0], [c + w - y0, y0], [c + w - y1, y1], [c - y1, y1]] as Pt[]).map(map));
    }
  }
  return out;
}

/** Does a convex polygon cover any point of the rectangle (sampled on a grid)? */
function polyHitsRect(poly: Pt[], r: Rect) {
  const inside = (px: number, py: number) => {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (cr !== 0) {
        if (sign && Math.sign(cr) !== sign) return false;
        sign = Math.sign(cr);
      }
    }
    return true;
  };
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) if (inside(r[0] + ((r[2] - r[0]) * i) / 8, r[1] + ((r[3] - r[1]) * j) / 8)) return true;
  return false;
}

const rectsMeet = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const grow = (r: Rect, d: number): Rect => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];

/** Mean relative luminance (WCAG) of a part of the canvas; 0.3 when the pixels cannot be read. */
function meanLum(ctx: CanvasRenderingContext2D, r: Rect): number {
  try {
    const x = Math.max(0, Math.round(r[0]));
    const y = Math.max(0, Math.round(r[1]));
    const w = Math.max(1, Math.round(r[2]) - x);
    const h = Math.max(1, Math.round(r[3]) - y);
    const d = ctx.getImageData(x, y, w, h).data;
    const lin = (v: number) => (v <= 10 ? v / 3295 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      n++;
    }
    return n ? sum / n : 0.3;
  } catch {
    return 0.3;
  }
}
const LUM_BEIGE = 0.72;
const LUM_NAVY = 0.019;
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** The book: beige shapes and logo on a dark photograph, navy on a light one (p.40). */
function onPhoto(lum: number) {
  const cb = contrast(lum, LUM_BEIGE);
  const cn = contrast(lum, LUM_NAVY);
  return { color: cb >= cn ? BEIGE : NAVY, contrast: Math.max(cb, cn) };
}

const cropMemo = new WeakMap<HTMLImageElement, Map<string, { dy: number; run: Pt[][] | null }>>();

/**
 * The photograph in the image zone: cropped so the band stays in view and every face is whole and clear of the logo,
 * then a run of stripes in the largest size that fits a free corner. Returns the logo colour.
 */
function photoZone(ctx: CanvasRenderingContext2D, img: HTMLImageElement, art: PhotoArt, W: number, Z: number, logo: Rect, safeTop: number): string {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(W / iw, Z / ih);
  const dw = iw * s;
  const dh = ih * s;
  const dx = Math.min(0, Math.max(W - dw, W / 2 - dw * (art.x ?? 0.5)));
  const X = (u: number) => (art.mirror ? dx + (1 - u) * dw : dx + u * dw);
  const toRect = (b: Box, dy: number): Rect => {
    const xa = X(b[0]);
    const xb = X(b[2]);
    return [Math.min(xa, xb), dy + b[1] * dh, Math.max(xa, xb), dy + b[3] * dh];
  };
  const faces = art.faces ?? [];
  const keep = art.keep ?? [];
  const logoZone = grow(logo, 18);

  // the crop: every vertical offset gets a penalty (faces cut or under the logo, the band out of view)
  const cands: { dy: number; p: number }[] = [];
  const bt = art.band.top * dh;
  const bb = art.band.bottom * dh;
  for (let dy = 0; dy >= Z - dh - 0.5; dy -= 4) {
    let p = 0;
    for (const f of faces) {
      const r = toRect(f, dy);
      if (r[2] <= 0 || r[0] >= W) continue;
      if (r[3] <= 0 || r[1] >= Z) p += 300;
      else if (r[1] < 0 || r[3] > Z) p += 1000 + 4 * Math.min(Math.abs(r[1]), Math.abs(r[3] - Z));
      else {
        if (rectsMeet(r, logoZone)) p += 800;
        if (r[1] < safeTop) p += 150;
      }
    }
    for (const k of keep) {
      const r = toRect(k, dy);
      if (r[1] < 0 || r[3] > Z) p += 500;
    }
    const vis = (Math.min(bb + dy, Z) - Math.max(bt + dy, 0)) / Math.max(1, bb - bt);
    p += (1 - Math.max(0, vis)) * 400;
    p += Math.abs((bt + bb) / 2 + dy - (safeTop + (Z - safeTop) / 2)) * 0.05;
    cands.push({ dy, p });
  }
  cands.sort((x, y) => x.p - y.p);

  // stripes: the largest run that fits one of the photograph's free corners (never over a face, the fire or the
  // logo). Among the crops that are as good for the people, the one that leaves the most room for the stripes wins.
  const unit = Math.round(W * 0.075);
  const w = unit * R2;
  const sizes: [number, number, number][] = art.modest
    ? [[2, 1, 1.6], [2, 1, 1.3]]
    : [[2, 2, 1.75], [3, 1, 2.3], [2, 2, 1.4], [2, 1, 2], [2, 1, 1.6], [2, 1, 1.3]];
  const corners = art.corners ?? ['bottom-right', 'bottom-left'];
  const fitRun = (dy: number) => {
    const obstacles: Rect[] = [
      ...faces.map((f) => grow(toRect(f, dy), 16)),
      ...keep.map((k) => grow(toRect(k, dy), 12)),
      grow(logo, 28),
    ].filter((r) => r[2] > 0 && r[0] < W && r[3] > 0 && r[1] < Z);
    for (let si = 0; si < sizes.length; si++) {
      const [n, tiers, tk] = sizes[si];
      for (let ci = 0; ci < corners.length; ci++) {
        const polys = cornerRun(corners[ci], W, Z, unit, n, tiers, Math.round(w * tk));
        // in a story, a run at the top would sit under Instagram's bar: try it last
        const rank = si * 10 + ci + (safeTop && corners[ci] === 'top-left' ? 25 : 0);
        if (!polys.some((p) => obstacles.some((o) => polyHitsRect(p, o)))) return { polys, rank };
      }
    }
    return null;
  };
  // the choice depends only on the photograph and the zone, not on the text: remembered, so typing stays quick
  const memoKey = `${W}|${Z}|${safeTop}|${logo.join(',')}|${art.mirror ? 1 : 0}`;
  const memo = cropMemo.get(img) ?? new Map<string, { dy: number; run: Pt[][] | null }>();
  cropMemo.set(img, memo);
  let chosen = memo.get(memoKey);
  if (!chosen) {
    chosen = { dy: cands[0]?.dy ?? 0, run: null };
    let rank = Infinity;
    const pool = cands.filter((x) => x.p <= (cands[0]?.p ?? 0) + 25);
    for (let i = 0; i < pool.length && rank > 0; i += Math.max(1, Math.floor(pool.length / 40))) {
      const r = fitRun(pool[i].dy);
      if (r && r.rank < rank) {
        rank = r.rank;
        chosen = { dy: pool[i].dy, run: r.polys };
      }
    }
    memo.set(memoKey, chosen);
  }
  const { dy, run } = chosen;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, Z);
  ctx.clip();
  if (art.mirror) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, dw, dh);
  } else ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
  const logoLum = meanLum(ctx, logo);
  if (run) {
    const xs = run.flat().map((p) => p[0]);
    const ys = run.flat().map((p) => p[1]);
    const box: Rect = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(W, Math.max(...xs)), Math.min(Z, Math.max(...ys))];
    const { color } = onPhoto(meanLum(ctx, box));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, Z);
    ctx.clip();
    ctx.fillStyle = color;
    run.forEach((p) => fillPoly(ctx, p));
    ctx.restore();
  }
  // the logo: beige on a dark photograph, navy on a light one; a soft navy shade only behind it when beige needs help
  const pick = onPhoto(logoLum);
  if (pick.color === BEIGE && pick.contrast < 4.5) {
    const cx = (logo[0] + logo[2]) / 2;
    const cy = (logo[1] + logo[3]) / 2;
    const rad = (logo[2] - logo[0]) * 1.1;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(20,40,55,0.55)');
    g.addColorStop(1, 'rgba(20,40,55,0)');
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, Z);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    ctx.restore();
  }
  return pick.color;
}

/**
 * The book's cover composition (its section pages, p.3): a chevron half at the top edge, a long rising stripe it meets,
 * and a lower stripe from the cut line to the side, all one width. Whole in every format: scaled so the long stripe
 * passes left of the logo, anchored at the zone's left edge. Returns the right edge of the long stripe at a given y.
 */
function chevronField(ctx: CanvasRenderingContext2D, zw: number, zh: number, color: string, logo: Rect) {
  // measured from the book (a 2000×1124 page): stripe 385 wide (horizontally), the cut line at 209
  const k = Math.min(zh / 1124, (logo[0] - 56 + logo[1]) / 1657, zw / 1800);
  const P = (x: number, y: number): Pt => [x * k, y * k];
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, zw, zh);
  ctx.clip();
  ctx.fillStyle = color;
  const far = 4000;
  fillPoly(ctx, [P(478, 0), P(868, 0), P(1077, 209), P(687, 209)]); // the chevron's top half: falling from the top edge
  fillPoly(ctx, [P(1272, 0), P(1657, 0), P(1657 - far, far), P(1272 - far, far)]); // the long rising stripe
  fillPoly(ctx, [P(307, 209), P(692, 209), P(692 - far, 209 + far), P(307 - far, 209 + far)]); // the lower stripe
  ctx.restore();
  return (y: number) => 1657 * k - y;
}

// ───────────── the invitation ─────────────

type Frame = {
  W: number; H: number; M: number; right: number; inner: number; story: boolean; square: boolean;
  ground: string; fg: string; logoH: number; logoTop: number; logo: Rect; bottom: number;
};

function frameOf(format: PostFormat, theme: PostTheme): Frame {
  const { w: W, h: H } = POST_SIZE[format];
  const story = format === 'story';
  const square = format === 'square';
  const M = story ? 84 : 72; // one margin on all sides; a story's top and bottom are set by Instagram's bars
  const logoH = story ? 128 : square ? 92 : 100;
  const logoTop = story ? SAFE_TOP : M;
  const logoW = logoH * LOGO_RATIO;
  return {
    W, H, M, story, square,
    right: W - M,
    inner: W - 2 * M,
    ground: theme === 'navy' ? NAVY : BEIGE,
    fg: theme === 'navy' ? BEIGE : NAVY,
    logoH, logoTop,
    logo: [W - M - logoW, logoTop, W - M, logoTop + logoH],
    bottom: story ? H - SAFE_BOTTOM : H - M,
  };
}

/** Draws the invitation into the canvas (sets its size). */
export function drawPost(canvas: HTMLCanvasElement, c: PostContent, format: PostFormat, design: PostDesign) {
  const f = frameOf(format, design.theme);
  canvas.width = f.W;
  canvas.height = f.H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = f.ground;
  ctx.fillRect(0, 0, f.W, f.H);
  if (design.layout === 'program') return drawProgram(ctx, c, f);
  const photo = design.layout === 'photo' ? design.photo : null;
  if (f.story) return drawStory(ctx, c, f, photo ?? null, design.art);
  if (photo) return drawPhotoPost(ctx, c, f, photo, design.art);
  return drawShapesPost(ctx, c, f);
}

/** The details column of a post: place, program (not on the square), the guest speaker and the topic. */
function detailGroups(ctx: CanvasRenderingContext2D, c: PostContent, width: number, size: number, opts: { program: boolean; topicLines: number; bullets?: boolean }): Line[][] {
  const groups: Line[][] = [];
  const b = !!opts.bullets;
  if (c.place) groups.push(wrapped(ctx, c.place, 500, size, width, 3, b));
  if (c.program && opts.program) {
    ctx.font = font(400, size);
    const lines = wrapItems(ctx, splitItems(c.program), width - (b ? size * 0.72 : 0), 2);
    groups.push(lines.slice(0, 2).map((t, i) => ({ text: t, weight: 400, size, bullet: b && i === 0 })));
  }
  if (c.speakerName || c.topic) {
    const g: Line[] = [];
    if (c.speakerName) g.push(...wrapped(ctx, `הרצאת אורח: ${c.speakerName}`, 600, size, width, 2, b));
    // a topic is shown whole or not at all (it is in the caption): an invitation never ends a line with "…"
    if (c.topic && opts.topicLines) {
      const t = wrapped(ctx, c.topic, 400, size, width, opts.topicLines, b && !c.speakerName);
      if (!t[t.length - 1]?.text.endsWith('…')) g.push(...t);
    }
    if (g.length) groups.push(g);
  }
  return groups;
}

/** Grid 02 on a post or square: the photograph above; the headline and date on the right, the details and CTA on the left. */
function drawPhotoPost(ctx: CanvasRenderingContext2D, c: PostContent, f: Frame, photo: HTMLImageElement, art?: PhotoArt) {
  const { W, H, M, right, inner, square, fg, ground } = f;
  const gap = 48;
  const headW = Math.round(inner * 0.54);
  const colW = inner - headW - gap;
  const colRight = M + colW;
  const a = art ?? { band: { top: 0.2, bottom: 0.6 } };
  // the zone holds at least the photograph's band (the square is short: the fire and the faces must both fit)
  const iw = photo.naturalWidth || photo.width;
  const ih = photo.naturalHeight || photo.height;
  const bandPx = (a.band.bottom - a.band.top) * ih * (W / iw) + 40;
  const lo = Math.round(Math.max(H * (square ? 0.5 : 0.52), Math.min(bandPx, H * 0.6)));
  const hi = Math.round(H * 0.66);
  let head: Block = EMPTY;
  let left: Block = EMPTY;
  let zoneH = lo;
  for (const k of [1, 0.94, 0.88, 0.82, 0.76, 0.7]) {
    const titleSize = (square ? 112 : 132) * k;
    const hb = headlineBlock(ctx, c, right, headW, titleSize, 3, fg);
    ctx.font = font(600, 38);
    const when = linesBlock(ctx, [whenLines(ctx, c, (square ? 34 : 38) * Math.max(k, 0.85), 26, headW)], right, fg);
    head = stack([[hb, 0], [when, Math.round(hb.s * 0.3)]]);
    const ds = (square ? 31 : 34) * Math.max(k, 0.82);
    const det = linesBlock(ctx, detailGroups(ctx, c, colW, ds, { program: !square, topicLines: 2 }), colRight, fg);
    const cta = ctaBlock(ctx, c.cta, colRight, 36 * Math.max(k, 0.85), colW, fg, ground);
    const link = linkBlock(ctx, c.link, colRight, 28, colW, fg);
    left = stack([[det, 0], [cta, 44], [link, 16]]);
    zoneH = H - M - Math.max(head.h, left.h) - 60;
    if (zoneH >= lo) break;
  }
  zoneH = Math.round(Math.min(hi, Math.max(lo, zoneH)));
  const logoColor = photoZone(ctx, photo, a, W, zoneH, f.logo, 0);
  drawLogo(ctx, right, f.logoTop, f.logoH, logoColor);
  head.draw(f.bottom - head.h);
  left.draw(f.bottom - left.h);
}

/** Greedy wrap where line i may be at most widths[i] wide; null when the words do not fit those lines. */
function wrapInto(ctx: CanvasRenderingContext2D, text: string, widths: number[]): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    const max = widths[lines.length];
    if (max === undefined) return null;
    if (ctx.measureText(t).width <= max) cur = t;
    else {
      if (!cur) return null;
      lines.push(cur);
      if (widths[lines.length] === undefined || ctx.measureText(w).width > widths[lines.length]) return null;
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length === widths.length ? lines : null;
}

/**
 * The headline set into the open corner of the chevron field, its last line `gapBelow` above the zone's edge: the
 * largest size (and fewest lines, up to three) at which every line clears the long stripe by a stripe gap. Each line
 * may be as wide as the stripe allows at its height, so the block follows the stripe like a staircase.
 */
function cornerHeadline(ctx: CanvasRenderingContext2D, c: PostContent, f: Frame, zoneH: number, gapBelow: number, stripeRight: (y: number) => number, max: number, min: number): Block {
  const { right, inner, fg } = f;
  const kick = c.kicker.trim();
  const title = c.title.trim();
  const avail = (y: number) => Math.min(inner, right - stripeRight(y) - 48);
  const minTop = f.logo[3] + 44;
  for (let s = max; s >= min; s -= 4) {
    const ks = Math.round(Math.max(30, s * 0.36));
    const kH = kick ? ks * (CAP + DESC) + Math.max(10, s * 0.14) : 0;
    for (let n = 1; n <= 3; n++) {
      const tH = title ? s * 0.74 + (n - 1) * s + s * 0.12 : 0;
      const top = zoneH - gapBelow - kH - tH;
      if (top < minTop) break;
      if (kick) {
        ctx.font = font(600, ks);
        if (ctx.measureText(kick).width > avail(top)) continue;
      }
      ctx.font = font(700, s);
      const lines = title ? wrapInto(ctx, title, Array.from({ length: n }, (_, i) => avail(top + kH + i * s))) : [];
      if (!lines) continue;
      return {
        h: kH + tH,
        draw: () => {
          ctx.fillStyle = fg;
          rtl(ctx);
          if (kick) {
            ctx.font = font(600, ks);
            ctx.fillText(kick, right, top + ks * CAP);
          }
          ctx.font = font(700, s);
          lines.forEach((l, i) => ctx.fillText(l, right, top + kH + s * 0.74 + i * s));
        },
      };
    }
    if (!title) break;
  }
  // nothing fits beside the stripe (a very long headline): the plain block, as small as allowed
  const hb = headlineBlock(ctx, c, right, inner, min, 3, fg, 1);
  return { h: hb.h, draw: () => hb.draw(zoneH - gapBelow - hb.h) };
}

/**
 * Grid 01 on a post or square: the chevron fills the image zone and the headline sits in its open lower-right corner
 * (as the book's section covers); below, the date and details on the right and the call to action on the left.
 */
function drawShapesPost(ctx: CanvasRenderingContext2D, c: PostContent, f: Frame) {
  const { W, H, M, right, inner, square, fg, ground } = f;
  const gap = 48;
  const detW = Math.round(inner * 0.58);
  const colW = inner - detW - gap;
  const colRight = M + colW;
  let body: Block = EMPTY;
  let side: Block = EMPTY;
  let zoneH = 0;
  for (const k of [1, 0.92, 0.85, 0.78]) {
    const ds = (square ? 31 : 34) * k;
    const when = linesBlock(ctx, [whenLines(ctx, c, (square ? 38 : 42) * k, 28, detW)], right, fg);
    const det = linesBlock(ctx, detailGroups(ctx, c, detW, ds, { program: !square, topicLines: square ? 0 : 2 }), right, fg);
    body = stack([[when, 0], [det, Math.round(ds * 0.7)]]);
    side = stack([[ctaBlock(ctx, c.cta, colRight, 36 * Math.max(k, 0.85), colW, fg, ground), 0], [linkBlock(ctx, c.link, colRight, 28, colW, fg), 16]]);
    zoneH = H - M - Math.max(body.h, side.h) - 56;
    if (zoneH >= H * (square ? 0.56 : 0.6)) break;
  }
  zoneH = Math.round(Math.min(H * 0.7, zoneH));
  const stripeRight = chevronField(ctx, W, zoneH, fg, f.logo);
  cornerHeadline(ctx, c, f, zoneH, 28, stripeRight, square ? 128 : 150, square ? 76 : 88).draw(0);
  drawLogo(ctx, right, f.logoTop, f.logoH, fg);
  body.draw(f.bottom - body.h);
  side.draw(f.bottom - side.h);
}

/** A story (1080×1920): one column, the CTA right after the details, all clear of Instagram's bars. */
function drawStory(ctx: CanvasRenderingContext2D, c: PostContent, f: Frame, photo: HTMLImageElement | null, art?: PhotoArt) {
  const { W, H, right, inner, fg, ground } = f;
  // stories leave out the program and the topic (they are in the caption), as the book's story (p.56)
  const lo = Math.round(H * 0.42);
  const hi = Math.round(H * 0.56);
  let head: Block = EMPTY;
  let rest: Block = EMPTY;
  let zoneH = lo;
  let titleSize = 150;
  for (const k of [1, 0.92, 0.85, 0.78, 0.72]) {
    titleSize = (photo ? 150 : 170) * k;
    head = photo ? headlineBlock(ctx, c, right, inner, titleSize, 3, fg) : EMPTY;
    const ds = 46 * Math.max(k, 0.85);
    const groups: Line[][] = [whenLines(ctx, c, 52 * Math.max(k, 0.85), 46, inner, 600, true)];
    if (c.place) groups.push(wrapped(ctx, c.place, 500, ds, inner, 2, true));
    if (c.speakerName) groups.push(wrapped(ctx, `הרצאת אורח: ${c.speakerName}`, 500, ds, inner, 2, true));
    const det = linesBlock(ctx, groups, right, fg, 1.28, 0.42);
    rest = stack([[det, 0], [ctaBlock(ctx, c.cta, right, 50, inner, fg, ground), 64], [linkBlock(ctx, c.link, right, 32, inner, fg), 20]]);
    const content = stack([[head, 0], [rest, Math.round(titleSize * 0.36)]]);
    zoneH = f.bottom - content.h - 80;
    if (zoneH >= lo) break;
  }
  zoneH = Math.round(Math.min(hi, Math.max(lo, zoneH)));
  if (photo) {
    const logoColor = photoZone(ctx, photo, art ?? { band: { top: 0.2, bottom: 0.6 } }, W, zoneH, f.logo, SAFE_TOP);
    drawLogo(ctx, right, f.logoTop, f.logoH, logoColor);
    const content = stack([[head, 0], [rest, Math.round(titleSize * 0.36)]]);
    content.draw(f.bottom - content.h);
    return;
  }
  // shapes: the headline in the chevron's open corner, the details below
  const stripeRight = chevronField(ctx, W, zoneH, fg, f.logo);
  cornerHeadline(ctx, c, f, zoneH, 36, stripeRight, 170, 96).draw(0);
  drawLogo(ctx, right, f.logoTop, f.logoH, fg);
  rest.draw(f.bottom - rest.h);
}

/** Grid type 03: a lot of content on the ground, a stripe band at the top and bottom edges, a schedule with ◀. */
function drawProgram(ctx: CanvasRenderingContext2D, c: PostContent, f: Frame) {
  const { W, H, M, right, inner, story, square, fg, ground } = f;
  // one stripe unit X for the whole composition; every cut lies on its grid (no slivers)
  const X = Math.round(W / 17);
  const w = X * R2;
  const step = 2 * w;
  const bandH = Math.round(2 * w - 6); // the deepest band in which the stripe at the cut ends in a whole triangle
  const cut = Math.round(3 * step - w); // the band's vertical cut, about 0.4 of the width
  // top band: a stripe band in the reverse colour, stripes in the ground colour entering from the left (p.63)
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, W, bandH);
  stripeRect(ctx, [0, 0, cut, bandH], X, ground, 'fall', cut);
  ctx.fillStyle = fg;
  ctx.fillRect(cut, 0, W - cut, bandH);
  let logoBottom: number;
  if (story) {
    // a story's band sits under Instagram's bar; the logo comes below it, on the ground
    drawLogo(ctx, right, f.logoTop, f.logoH, fg);
    logoBottom = f.logoTop + f.logoH;
  } else {
    const lh = Math.round(bandH * 0.56);
    drawLogo(ctx, right, Math.round((bandH - lh) / 2), lh, ground);
    logoBottom = bandH;
  }
  // bottom: a short run of stripes from the lower-left corner, its top cut flat (the text stays clear of it)
  const runH = Math.round(w * 1.4);
  const runW = Math.round(3 * step - w);
  stripeRect(ctx, [0, H - runH, runW, H], X, fg, 'fall', runW);

  // the CTA, bottom right; the link under it
  const cta = ctaBlock(ctx, c.cta, right, story ? 46 : square ? 34 : 36, inner - runW, fg, ground);
  const link = linkBlock(ctx, c.link, right, story ? 32 : 26, inner - runW, fg);
  const foot = stack([[cta, 0], [link, 14]]);
  const footTop = f.bottom - foot.h;

  // the headline: one line as large as fits, two lines only below the minimum
  const top = logoBottom + (story ? 110 : square ? 52 : 70);
  const max = story ? 172 : square ? 124 : 150;
  const oneLine = c.title.trim() ? fitSize(ctx, c.title.trim(), 700, max, 96, inner) : max;
  ctx.font = font(700, oneLine);
  const fits = ctx.measureText(c.title.trim()).width <= inner;
  const hb = headlineBlock(ctx, c, right, inner, fits ? oneLine : 96, fits ? 1 : 2, fg, fits ? 1 : 0.8);
  hb.draw(top);
  const afterHead = top + hb.h;

  // the schedule: a bold label column on the right, the triangles on one vertical, then the values
  const rows: [string, string][] = [];
  if (c.date || c.time) rows.push(['מתי', [c.date, c.time && `⁦${c.time}⁩`].filter(Boolean).join('\n')]);
  if (c.place) rows.push(['איפה', c.place]);
  if (c.program) rows.push(['מה', c.program]);
  if (c.speakerName) rows.push(['מרצה', c.speakerName + (c.topic ? `\n${c.topic}` : '')]);
  else if (c.topic) rows.push(['הרצאה', c.topic]);
  const space = footTop - afterHead - (story ? 80 : 48) * 2;
  const base = story ? 50 : square ? 33 : 38;
  for (const k of [1.2, 1.1, 1, 0.93, 0.86, 0.8, 0.74, 0.68]) {
    const sz = base * k;
    ctx.font = font(700, sz);
    const labelW = Math.max(...rows.map(([l]) => ctx.measureText(l).width));
    const triRight = right - labelW - sz * 0.45;
    const valRight = triRight - sz * 0.31 - sz * 0.55;
    const valW = valRight - M;
    const lead = sz * 1.3;
    const layout = rows.map(([label, value]) => {
      ctx.font = font(400, sz);
      const ls: { t: string; bold: boolean }[] = label === 'מה'
        ? wrapItems(ctx, splitItems(value), valW, 3).slice(0, 3).map((t) => ({ t, bold: false }))
        : value.split('\n').flatMap((part, i) => {
          ctx.font = font(label === 'מרצה' && i === 0 ? 600 : 400, sz);
          return wrapBalanced(ctx, part, valW, label === 'מרצה' && i ? 2 : 3).map((t) => ({ t, bold: label === 'מרצה' && i === 0 }));
        });
      return { label, lines: ls, h: sz * CAP + (ls.length - 1) * lead + sz * DESC };
    });
    const rowGap = sz * 0.95;
    const total = layout.reduce((a, r) => a + r.h, 0) + rowGap * Math.max(0, layout.length - 1);
    if (total <= space || k === 0.68) {
      let y = afterHead + Math.max(story ? 80 : 48, (footTop - afterHead - total) / 2);
      for (const r of layout) {
        rtl(ctx);
        ctx.fillStyle = fg;
        ctx.font = font(700, sz);
        ctx.fillText(r.label, right, y + sz * CAP);
        tri(ctx, triRight, y + sz * CAP - sz * 0.36, sz * 0.62, fg);
        r.lines.forEach((l, i) => {
          ctx.font = font(l.bold ? 600 : 400, sz);
          ctx.fillText(l.t, valRight, y + sz * CAP + i * lead);
        });
        y += r.h + rowGap;
      }
      break;
    }
  }
  foot.draw(footTop);
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

// ───────────── captions ─────────────

/** Keeps "9:00–11:30" in order inside Hebrew text when pasted into Instagram/WhatsApp (Unicode isolate). */
const isolateLtr = (t: string) => (t ? `⁦${t}⁩` : t);

export type CaptionInput = {
  type: 'friday' | 'bonfire' | 'other';
  org: string;
  /** the event's name (not the invitation's headline) */
  title: string;
  date: string;
  time: string;
  place: string;
  activity: string;
  speakerName: string;
  topic: string;
  description: string;
};

/** "יוגה, הרצאת אורח, ארוחת בוקר וזמן ביחד" */
export function joinHe(items: string[]): string {
  const xs = items.map((s) => s.trim()).filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} ו${xs[xs.length - 1]}`;
}

export function programItems(type: CaptionInput['type'], activity: string, hasSpeaker: boolean): string[] {
  if (type === 'friday') return [activity, hasSpeaker ? 'הרצאת אורח' : '', 'ארוחת בוקר', 'זמן ביחד'].filter(Boolean);
  return [activity].filter(Boolean);
}

function hashtags(c: CaptionInput): string {
  const tags = ['#המשך_תנועה', '#לוחמים_ולוחמות'];
  if (/מודיעין/.test(`${c.place} ${c.org}`) || c.type === 'friday') tags.push('#מודיעין');
  tags.push('#אחרי_השירות');
  if (c.type === 'friday') tags.push('#מפגש_שישי');
  if (c.type === 'bonfire') tags.push('#ערב_מדורה');
  const act = c.activity.trim();
  if (act && !/\s/.test(act)) tags.push(`#${act}`);
  return [...new Set(tags)].join(' ');
}

function speakerLine(c: CaptionInput) {
  if (!c.speakerName && !c.topic) return '';
  if (c.speakerName && c.topic) return `הרצאת אורח: ${c.speakerName}, על ״${c.topic}״`;
  if (c.speakerName) return `הרצאת אורח: ${c.speakerName}`;
  return `הרצאה: ״${c.topic}״`;
}

export function instagramCaption(c: CaptionInput, cta = 'ההרשמה בקישור בביו.'): string {
  const program = joinHe(programItems(c.type, c.activity, !!c.speakerName));
  return [
    `${c.title} · ${c.date}`,
    [isolateLtr(c.time), c.place].filter(Boolean).join(' · '),
    '',
    program ? `${program}.` : '',
    speakerLine(c),
    c.description && c.type !== 'friday' ? c.description : '',
    '',
    `${c.org}: הבית ללוחמים וללוחמות באזרחות. בואו איתנו להמשיך תנועה.`,
    cta,
    '',
    hashtags(c),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function whatsappGroupMessage(c: CaptionInput, link: string): string {
  const program = joinHe(programItems(c.type, c.activity, !!c.speakerName));
  return [
    `*${c.title}* · ${c.date}`,
    [isolateLtr(c.time), c.place].filter(Boolean).join(' · '),
    '',
    program ? `${program}.` : '',
    speakerLine(c),
    c.description && c.type !== 'friday' ? c.description : '',
    '',
    `מפגש של ${c.org} ללוחמים וללוחמות. בואו איתנו!`,
    'ההרשמה לוקחת פחות מדקה:',
    link,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
