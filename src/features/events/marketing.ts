// Event invitations, drawn locally on a <canvas> by the brand book "Moving Forward / המשך תנועה" (October 2026):
// no AI at run time, no cost, no external service. Text is drawn right-to-left with the site's own bundled typeface.
//
// The book's grid: every format has an image zone (a photograph or the brand's shapes) and a content zone; the
// Hebrew logo sits in the top-right corner, everything Hebrew is right-aligned, margins are equal on all sides, and
// only photographs and shapes run to the edge of the format. Three grid types, as on its page "סוגי גריד":
//   photo    02, short content on a photograph: stripes enter the photo from a corner, a navy content zone below
//   shapes   01, no photograph: the stripes and chevron fill the image zone and carry the message
//   program  03, a lot of content: a thin stripe band at the edges, a schedule with triangle bullets ◀
// Shapes: 45° only, stripe width = gap, all stripes in one composition parallel, one colour on the ground.
import { LOGO_PATHS } from '@/ui/Logo';

export type PostFormat = 'portrait' | 'square' | 'story';
export type PostLayout = 'photo' | 'shapes' | 'program';
/** navy: navy ground, beige shapes and type · beige: the reverse. The book gives both equal status. */
export type PostTheme = 'navy' | 'beige';

export type PostContent = {
  org: string;
  /** the headline: up to five words, an action verb where possible */
  title: string;
  /** a short line above the headline ("בואו איתנו"); optional */
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

export type PostDesign = {
  layout: PostLayout;
  theme: PostTheme;
  /** the photograph for the photo layout (already loaded) */
  photo?: HTMLImageElement | null;
  /** where the photograph's subject is, 0–1 from the left and from the top (what the crop keeps) */
  focus?: { x: number; y: number };
};

export const POST_SIZE: Record<PostFormat, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1350 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

export const NAVY = '#142837';
export const BEIGE = '#EBDCB9';
const FAMILY = '"Google Sans Variable", "Google Sans", system-ui, sans-serif';
const font = (weight: number, size: number, family = FAMILY) => `${weight} ${Math.round(size)}px ${family}`;
const SANS = FAMILY;
const R2 = Math.SQRT2;

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

/** Largest font size (down to `min`) at which a single line fits. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, min: number, maxWidth: number, family = SANS) {
  let s = size;
  ctx.font = font(weight, s, family);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(weight, s, family);
  }
  return s;
}

function rtl(ctx: CanvasRenderingContext2D) {
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
}
function ltr(ctx: CanvasRenderingContext2D, align: CanvasTextAlign = 'right') {
  ctx.direction = 'ltr';
  ctx.textAlign = align;
}

/** The official logo with its tagline, from the same vector paths as the app. `h` = drawn height; returns width. */
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
  return vw * k;
}

type Pt = [number, number];

/**
 * Rising "/" stripes (all parallel, 45°), `unit` wide across with a gap of `unit`, inside the polygon `clip`.
 * `edge` is a value of x + y where a stripe begins, so a composition can line its stripes up with a corner.
 */
function stripes(ctx: CanvasRenderingContext2D, clip: Pt[], unit: number, color: string, edge: number) {
  const w = unit * R2; // the stripe's width measured along a horizontal line
  const step = 2 * w;
  const xs = clip.map((p) => p[0]);
  const ys = clip.map((p) => p[1]);
  const lo = Math.min(...xs) + Math.min(...ys);
  const hi = Math.max(...xs) + Math.max(...ys);
  const y0 = Math.min(...ys) - 10;
  const y1 = Math.max(...ys) + 10;
  ctx.save();
  ctx.beginPath();
  clip.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = color;
  let k = edge - Math.ceil((edge - lo) / step + 1) * step;
  for (; k < hi; k += step) {
    ctx.beginPath();
    ctx.moveTo(k - y0, y0);
    ctx.lineTo(k + w - y0, y0);
    ctx.lineTo(k + w - y1, y1);
    ctx.lineTo(k - y1, y1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The triangle bullet ◀ : a right isosceles triangle, `h` tall, its point at `tipX`, pointing left (reading direction). */
function tri(ctx: CanvasRenderingContext2D, rightX: number, cy: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(rightX, cy - h / 2);
  ctx.lineTo(rightX, cy + h / 2);
  ctx.lineTo(rightX - h / 2, cy);
  ctx.closePath();
  ctx.fill();
}

/** Draws the photograph to cover the box, keeping the focus point in view. */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, focus = { x: 0.5, y: 0.4 }) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  const dx = Math.min(0, Math.max(w - dw, w / 2 - dw * focus.x));
  const dy = Math.min(0, Math.max(h - dh, h / 2 - dh * focus.y));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + dx, y + dy, dw, dh);
  ctx.restore();
}

/**
 * The book's cover composition (its section pages): a chevron at the top edge, a long rising stripe it meets, and a
 * lower stripe from the cut line to the side, all one width. Drawn in the zone, clear of the logo's top-right corner.
 */
function chevronField(ctx: CanvasRenderingContext2D, zx: number, zy: number, zw: number, zh: number, color: string) {
  // measured from the book (a 2000×1124 page): stripe 385 wide (horizontally), the cut line at 209
  const k = zh / 1124;
  const ox = zx + zw * 0.66 - 1657 * k; // the long stripe's top-right corner sits two thirds across the zone
  const P = (x: number, y: number): Pt => [ox + x * k, zy + y * k];
  ctx.save();
  ctx.beginPath();
  ctx.rect(zx, zy, zw, zh);
  ctx.clip();
  ctx.fillStyle = color;
  const poly = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  poly([P(478, 0), P(868, 0), P(1077, 209), P(687, 209)]); // the chevron's top half: falling from the top edge
  poly([P(1272, 0), P(1657, 0), P(1657 - 1124 - 600, 1124 + 600), P(1272 - 1124 - 600, 1124 + 600)]); // long rising stripe
  poly([P(307, 209), P(692, 209), P(692 - 1500, 209 + 1500), P(307 - 1500, 209 + 1500)]); // the lower stripe
  ctx.restore();
}

type Line = { text: string; weight: number; size: number; color: string; ltrText?: boolean; bullet?: boolean };

/** Lines of one column, right-aligned at `right`, starting at `top`. Returns the y after the last line. */
function drawLines(ctx: CanvasRenderingContext2D, lines: Line[][], right: number, top: number, lineHeight = 1.32, groupGap = 0.55) {
  let y = top;
  lines.forEach((group, gi) => {
    if (gi) y += group[0].size * groupGap;
    group.forEach((l) => {
      const base = y + l.size * 1.0;
      ctx.font = font(l.weight, l.size);
      ctx.fillStyle = l.color;
      let x = right;
      if (l.bullet) {
        tri(ctx, right, base - l.size * 0.36, l.size * 0.62, l.color);
        x = right - l.size * 0.75;
      }
      if (l.ltrText) ltr(ctx, 'right');
      else rtl(ctx);
      ctx.fillText(l.text, x, base);
      y += l.size * lineHeight;
    });
  });
  return y;
}

const linesHeight = (groups: Line[][], lineHeight = 1.32, groupGap = 0.55) =>
  groups.reduce((h, g, i) => h + (i ? g[0].size * groupGap : 0) + g.reduce((a, l) => a + l.size * lineHeight, 0), 0);

/** The details (when, where, what, who), as groups of lines that wrap within `width`; shrinks until they fit `maxH`. */
function details(ctx: CanvasRenderingContext2D, c: PostContent, width: number, maxH: number, base: number, fg: string, soft: string, bullets: boolean): Line[][] {
  for (const [scale, topicLines, withProgram] of [[1, 2, true], [0.92, 2, true], [0.86, 1, true], [0.86, 1, false], [0.78, 1, false]] as [number, number, boolean][]) {
    const sz = base * scale;
    const groups: Line[][] = [];
    const wrapped = (text: string, weight: number, size: number, color: string, max: number, bullet = false): Line[] => {
      ctx.font = font(weight, size);
      return wrapBalanced(ctx, text, width - (bullet ? size * 0.75 : 0), max).map((t, i) => ({ text: t, weight, size, color, bullet: bullet && i === 0 }));
    };
    // date and time: one line when the column is wide enough, otherwise each on its own line (never broken between)
    const when: Line[] = [];
    ctx.font = font(600, sz);
    const both = c.date && c.time ? `${c.date} · ⁦${c.time}⁩` : '';
    if (both && ctx.measureText(both).width <= width - (bullets ? sz * 0.75 : 0)) when.push({ text: both, weight: 600, size: sz, color: fg, bullet: bullets });
    else {
      if (c.date) when.push(...wrapped(c.date, 600, sz, fg, 2, bullets));
      if (c.time) when.push({ text: c.time, weight: 600, size: sz, color: fg, ltrText: true });
    }
    if (when.length) groups.push(when);
    if (c.place) groups.push(wrapped(c.place, 500, sz, fg, 2, bullets));
    if (c.program && withProgram) groups.push(wrapped(c.program.replace(/\s*·\s*/g, ' · '), 400, sz, soft, 2, bullets));
    if (c.speakerName || c.topic) {
      const g: Line[] = [];
      if (c.speakerName) g.push(...wrapped(`הרצאת אורח: ${c.speakerName}`, 600, sz, fg, 1, bullets));
      if (c.topic) g.push(...wrapped(c.topic, 400, sz, soft, topicLines, bullets && !c.speakerName));
      groups.push(g);
    }
    if (linesHeight(groups) <= maxH) return groups;
    if (scale === 0.78) {
      // still too much: leave out the least important lines (from the end) rather than overlap the call to action
      while (groups.length > 1 && linesHeight(groups) > maxH) {
        const last = groups[groups.length - 1];
        if (last.length > 1) last.pop();
        else groups.pop();
      }
      return groups;
    }
  }
  return [];
}

/** The call to action: on the ground, in the type colour, ending with the triangle ◀ (as the book's buttons). */
function ctaRow(ctx: CanvasRenderingContext2D, c: PostContent, right: number, baseline: number, size: number, color: string, maxW: number) {
  if (!c.cta) return;
  ctx.font = font(700, size);
  rtl(ctx);
  const tw = Math.min(ctx.measureText(c.cta).width, maxW - size);
  ctx.fillStyle = color;
  ctx.fillText(c.cta, right, baseline, tw);
  tri(ctx, right - tw - size * 0.3, baseline - size * 0.36, size * 0.62, color);
}

/** The headline block: kicker (Semibold), title (Bold, tight). Returns the y under it. */
function headline(ctx: CanvasRenderingContext2D, c: PostContent, right: number, top: number, width: number, size: number, maxLines: number, color: string) {
  let y = top;
  if (c.kicker) {
    const ks = Math.round(size * 0.42);
    ctx.font = font(600, ks);
    ctx.fillStyle = color;
    rtl(ctx);
    ctx.fillText(c.kicker, right, y + ks);
    y += ks * 1.35;
  }
  let s = size;
  let lines: string[] = [];
  for (; s >= size * 0.55; s -= 4) {
    ctx.font = font(700, s);
    lines = wrapBalanced(ctx, c.title, width, maxLines);
    if (lines.every((l) => ctx.measureText(l).width <= width) && !lines[lines.length - 1].endsWith('…')) break;
  }
  ctx.font = font(700, s);
  ctx.fillStyle = color;
  rtl(ctx);
  lines.forEach((l, i) => ctx.fillText(l, right, y + s * 0.92 + i * s * 1.02));
  return y + s * (0.92 + (lines.length - 1) * 1.02) + s * 0.18;
}

/** Draws the invitation into the canvas (sets its size). */
export function drawPost(canvas: HTMLCanvasElement, c: PostContent, format: PostFormat, design: PostDesign) {
  const { w: W, h: H } = POST_SIZE[format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.textBaseline = 'alphabetic';
  const ground = design.theme === 'navy' ? NAVY : BEIGE;
  const fg = design.theme === 'navy' ? BEIGE : NAVY;
  const soft = design.theme === 'navy' ? 'rgba(235,220,185,0.86)' : 'rgba(20,40,55,0.84)';
  const story = format === 'story';
  const M = story ? 84 : 72; // one margin on all four sides (the book's "M")
  const right = W - M;
  const inner = W - 2 * M;
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);
  if (design.layout === 'program') return drawProgram(ctx, c, format, { W, H, M, ground, fg, soft });

  // ── image zone ──
  const zoneH = Math.round(H * (story ? 0.45 : format === 'square' ? 0.54 : 0.58));
  const photo = design.layout === 'photo' && design.photo;
  if (photo) {
    cover(ctx, photo, 0, 0, W, zoneH, design.focus);
    // a soft navy shade under the top edge, so the beige logo reads on any sky (the book: a light logo on dark photos)
    const g = ctx.createLinearGradient(0, 0, 0, zoneH * 0.42);
    g.addColorStop(0, 'rgba(20,40,55,0.62)');
    g.addColorStop(1, 'rgba(20,40,55,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, zoneH * 0.42);
    // stripes enter the photograph from its lower-left corner, cut by the content zone's edge. Kept small and low
    // (the book: at most a third of the area, never over faces; the photographs keep faces in the upper half)
    const s = Math.round(zoneH * (story ? 0.3 : 0.36));
    const unit = Math.round(s / 5.2);
    stripes(ctx, [[0, zoneH], [s, zoneH], [0, zoneH - s]], unit, design.theme === 'navy' ? BEIGE : NAVY, zoneH - s);
  } else {
    chevronField(ctx, 0, 0, W, zoneH, fg);
  }
  drawLogo(ctx, right, story ? 150 : M, story ? 150 : format === 'square' ? 112 : 124, photo ? BEIGE : fg);

  // ── content zone ──
  const top = zoneH + (story ? 70 : 56);
  const bottom = H - (story ? 210 : M); // a story keeps clear of the app's own bars
  if (story) {
    let y = headline(ctx, c, right, top, inner, 150, 3, fg);
    const ctaSize = 46;
    const linkH = c.link ? 44 : 0;
    const ctaTop = bottom - ctaSize * 2 - linkH;
    const groups = details(ctx, c, inner, ctaTop - (y + 44) - 40, 46, fg, soft, true);
    y = drawLines(ctx, groups, right, y + 44);
    // the call to action as the book's button: a beige block, navy type, the triangle ◀
    if (c.cta) {
      ctx.font = font(700, ctaSize);
      const tw = Math.min(ctx.measureText(c.cta).width, inner - ctaSize * 2);
      const bw = tw + ctaSize * 2.1;
      const bh = ctaSize * 2;
      ctx.fillStyle = fg;
      ctx.fillRect(right - bw, ctaTop, bw, bh);
      ctaRow(ctx, c, right - ctaSize * 0.7, ctaTop + bh / 2 + ctaSize * 0.36, ctaSize, ground, inner);
    }
    if (c.link) {
      ctx.font = font(500, fitSize(ctx, c.link, 500, 34, 20, inner));
      ctx.fillStyle = soft;
      ltr(ctx, 'right');
      ctx.fillText(c.link, right, bottom);
    }
    void y;
    return;
  }
  // post and square: the headline on the right, the details in a column on the left (as "לרוץ אל הלב")
  const gap = 44;
  const headW = Math.round(inner * 0.5);
  const colW = inner - headW - gap;
  const colRight = M + colW;
  headline(ctx, c, right, top, headW, format === 'square' ? 96 : 112, 3, fg);
  const ctaSize = 32;
  const linkH = c.link ? 34 : 0;
  const ctaBase = bottom - linkH - 4;
  const groups = details(ctx, c, colW, ctaBase - ctaSize * 1.6 - top, format === 'square' ? 27 : 30, fg, soft, false);
  drawLines(ctx, groups, colRight, top + 6);
  ctaRow(ctx, c, colRight, ctaBase, ctaSize, fg, colW);
  if (c.link) {
    ctx.font = font(500, fitSize(ctx, c.link, 500, 26, 16, colW));
    ctx.fillStyle = soft;
    ltr(ctx, 'right');
    ctx.fillText(c.link, colRight, bottom);
  }
}

/** Grid type 03: a lot of content on the ground, a stripe band at the top and bottom edges, a schedule with ◀. */
function drawProgram(ctx: CanvasRenderingContext2D, c: PostContent, format: PostFormat, p: { W: number; H: number; M: number; ground: string; fg: string; soft: string }) {
  const { W, H, M, fg, soft } = p;
  const story = format === 'story';
  const right = W - M;
  const inner = W - 2 * M;
  // top band: the reverse colour, with stripes entering from the left edge; the logo on it, top right
  const bandH = Math.round(H * (story ? 0.13 : 0.15));
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, W, bandH);
  const unit = Math.round(bandH / 3.2);
  stripes(ctx, [[0, 0], [W * 0.42, 0], [W * 0.42 - bandH, bandH], [0, bandH]], unit, p.ground, 0);
  const logoH = Math.round(bandH * 0.62);
  drawLogo(ctx, right, Math.round((bandH - logoH) / 2) + (story ? 30 : 0), logoH, p.ground);
  // bottom: short stripes entering from the lower-left corner (the text stays right-aligned, clear of them)
  const s = Math.round(H * (story ? 0.2 : 0.22));
  stripes(ctx, [[0, H], [s, H], [0, H - s]], Math.round(s / 5.2), fg, H - s);

  let y = bandH + (story ? 120 : 64);
  const kick = c.kicker || 'בואו איתנו';
  y = headline(ctx, { ...c, kicker: kick }, right, y, inner, story ? 140 : format === 'square' ? 92 : 108, 2, fg);
  y += story ? 60 : 36;

  // the schedule: a bold label column on the right, the triangle, then the value (as the book's poster)
  const size = story ? 50 : format === 'square' ? 34 : 38;
  const labelW = size * 3;
  const valRight = right - labelW - size * 0.9;
  const valW = valRight - M;
  const rows: [string, string, boolean][] = [];
  if (c.date || c.time) rows.push(['מתי', [c.date, c.time && `⁦${c.time}⁩`].filter(Boolean).join('\n'), false]);
  if (c.place) rows.push(['איפה', c.place, false]);
  if (c.program) rows.push(['מה', c.program.replace(/\s*·\s*/g, ' · '), false]);
  if (c.speakerName) rows.push(['מרצה', c.speakerName + (c.topic ? `: ${c.topic}` : ''), false]);
  else if (c.topic) rows.push(['הרצאה', c.topic, false]);
  const bottomLimit = H - (story ? 260 : M) - size * 3;
  for (const scale of [1, 0.92, 0.84, 0.76]) {
    const sz = size * scale;
    const layout = rows.map(([label, value]) => {
      ctx.font = font(400, sz);
      // a value can hold its own line breaks (date, then time), each part wraps on its own
      const lines = value.split('\n').flatMap((part) => wrapBalanced(ctx, part, valW, 3));
      ctx.font = font(700, sz);
      const labelLines = wrapBalanced(ctx, label, labelW, 2);
      return { labelLines, lines, h: Math.max(lines.length, labelLines.length) * sz * 1.3 };
    });
    const total = layout.reduce((a, r) => a + r.h + sz * 0.9, 0);
    if (y + total <= bottomLimit || scale === 0.76) {
      y += Math.max(0, (bottomLimit - y - total) * 0.3); // settle the schedule a little lower when there is room
      layout.forEach((r) => {
        rtl(ctx);
        ctx.fillStyle = fg;
        ctx.font = font(700, sz);
        r.labelLines.forEach((l, i) => ctx.fillText(l, right, y + sz + i * sz * 1.3));
        tri(ctx, right - labelW, y + sz * 0.64, sz * 0.62, fg);
        ctx.font = font(400, sz);
        ctx.fillStyle = fg;
        r.lines.forEach((l, i) => ctx.fillText(l, valRight, y + sz + i * sz * 1.3));
        y += r.h + sz * 0.9;
      });
      break;
    }
  }
  // the call to action and the link, bottom right, clear of the stripes
  const ctaSize = story ? 46 : 32;
  const bottom = H - (story ? 240 : M);
  ctaRow(ctx, c, right, bottom - (c.link ? ctaSize * 1.3 : 0), ctaSize, fg, inner * 0.62);
  if (c.link) {
    ctx.font = font(500, fitSize(ctx, c.link, 500, story ? 32 : 24, 16, inner * 0.6));
    ctx.fillStyle = soft;
    ltr(ctx, 'right');
    ctx.fillText(c.link, right, bottom);
  }
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

// ───────────── captions ─────────────

/** Keeps "9:00–11:30" in order inside Hebrew text when pasted into Instagram/WhatsApp (Unicode isolate). */
const isolateLtr = (t: string) => (t ? `\u2066${t}\u2069` : t);

export type CaptionInput = {
  type: 'friday' | 'bonfire' | 'other';
  org: string;
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
  const tags = ['#המשך_תנועה', '#מילואים'];
  if (/מודיעין/.test(`${c.place} ${c.org}`) || c.type === 'friday') tags.push('#מודיעין');
  tags.push('#חוזרים_לשגרה');
  if (c.type === 'friday') tags.push('#מפגש_שישי');
  if (c.type === 'bonfire') tags.push('#ערב_מדורה');
  const act = c.activity.trim();
  if (act && !/\s/.test(act)) tags.push(`#${act}`);
  return [...new Set(tags)].join(' ');
}

function speakerLine(c: CaptionInput) {
  if (!c.speakerName && !c.topic) return '';
  if (c.speakerName && c.topic) return `הרצאת אורח: ${c.speakerName}, על "${c.topic}"`;
  if (c.speakerName) return `הרצאת אורח: ${c.speakerName}`;
  return `הרצאה: "${c.topic}"`;
}

export function instagramCaption(c: CaptionInput, cta = 'ההרשמה בקישור בביו.'): string {
  const program = joinHe(programItems(c.type, c.activity, !!c.speakerName));
  return [
    `${c.title} | ${c.date}`,
    [isolateLtr(c.time), c.place].filter(Boolean).join(' · '),
    '',
    program ? `${program}.` : '',
    speakerLine(c),
    c.description && c.type !== 'friday' ? c.description : '',
    '',
    `מפגש של ${c.org} ללוחמים וללוחמות אחרי השירות. בואו איתנו.`,
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
    `*${c.title}* | ${c.date}`,
    [isolateLtr(c.time), c.place].filter(Boolean).join(' · '),
    '',
    program ? `${program}.` : '',
    speakerLine(c),
    c.description && c.type !== 'friday' ? c.description : '',
    '',
    'להרשמה (פחות מדקה):',
    link,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
