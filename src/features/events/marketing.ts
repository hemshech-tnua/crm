// Marketing post (1080×1080) and story (1080×1920) drawn locally on a <canvas> in the brand: no AI, no cost,
// no external service. Text is drawn right-to-left with the app's own fonts (bundled, so the CSP allows them).

export type PostFormat = 'square' | 'story';
export type PostTheme = 'ink' | 'mist';

export type PostContent = {
  org: string;
  title: string;
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

export const POST_SIZE: Record<PostFormat, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

const DISPLAY = '"Secular One", "IBM Plex Sans Hebrew", sans-serif';
const SANS = '"IBM Plex Sans Hebrew", system-ui, sans-serif';
const font = (weight: number, size: number, family = SANS) => `${weight} ${Math.round(size)}px ${family}`;

/** Fonts must be loaded before drawing, or the canvas silently falls back to a system font. */
export async function loadPostFonts(timeoutMs = 4000): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const he = 'מפגש שישי יום הרשמה בקישור בביו אבגדהוזחטיכלמנסעפצקרשתךםןףץ';
  const latin = '0123456789:–·-/.,abcdefghijklmnopqrstuvwxyz';
  const loads = Promise.all([
    document.fonts.load(font(400, 100, DISPLAY), he + latin),
    document.fonts.load(font(400, 40), he + latin),
    document.fonts.load(font(600, 40), he + latin),
    document.fonts.load(font(700, 40), he + latin),
  ]).then(() => true, () => false);
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs));
  return Promise.race([loads, timeout]);
}

type Palette = { bg: string; fg: string; soft: string; accent: string; accentText: string; logoBg: string; logoDot: string; pillText: string; faint: string };
const PALETTE: Record<PostTheme, Palette> = {
  ink: {
    bg: '#12343B', fg: '#EEF2F1', soft: 'rgba(238,242,241,0.80)', accent: '#F2A93B', accentText: '#F2A93B',
    logoBg: '#EEF2F1', logoDot: '#12343B', pillText: '#12343B', faint: 'rgba(238,242,241,0.07)',
  },
  mist: {
    bg: '#EEF2F1', fg: '#12343B', soft: '#3C5559', accent: '#F2A93B', accentText: '#A8650F',
    logoBg: '#12343B', logoDot: '#EEF2F1', pillText: '#12343B', faint: 'rgba(18,52,59,0.06)',
  },
};

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

/** The brand mark: a rounded square with the continuing line. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, p: Palette) {
  const k = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = p.logoBg;
  ctx.beginPath();
  ctx.roundRect(0, 0, 64, 64, 16);
  ctx.fill();
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(50, 40);
  ctx.bezierCurveTo(44, 40, 42, 28, 35, 28);
  ctx.bezierCurveTo(28, 28, 26, 40, 19, 40);
  ctx.stroke();
  ctx.fillStyle = p.logoDot;
  ctx.beginPath();
  ctx.arc(14, 40, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The line that keeps moving (the PublicLayout wave): enters from the right edge and ends in a dot on the left,
 * like Hebrew reading direction.
 */
function drawWave(ctx: CanvasRenderingContext2D, W: number, endX: number, y: number, amp: number, width: number, color: string, dot: string | null) {
  const X = (px: number) => endX + (px / 400) * (W - endX);
  const Y = (py: number) => y + ((py - 12) / 12) * amp;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(W + width, Y(18));
  ctx.bezierCurveTo(X(330), Y(18), X(300), Y(6), X(230), Y(6));
  ctx.bezierCurveTo(X(160), Y(6), X(120), Y(20), X(60), Y(14));
  ctx.bezierCurveTo(X(0), Y(8), X(10), Y(8), X(0), Y(10));
  ctx.stroke();
  if (dot) {
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(X(0) - width * 1.6, Y(10), width * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

type Block = { lines: string[]; weight: number; size: number; color: string; gap: number; lineHeight: number; family?: string; marker?: boolean };

function blockHeight(b: Block) {
  return b.gap + b.lines.length * b.size * b.lineHeight;
}

/** Draws the post or story into the canvas (sets its size). */
export function drawPost(canvas: HTMLCanvasElement, c: PostContent, format: PostFormat, theme: PostTheme) {
  const { w: W, h: H } = POST_SIZE[format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const p = PALETTE[theme];
  const story = format === 'story';
  const M = story ? 96 : 84;
  const right = W - M;
  const maxW = W - 2 * M;

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  // a faint echo of the line along the bottom edge, away from the text
  drawWave(ctx, W, -80, story ? H - 150 : H - 36, story ? 70 : 50, story ? 64 : 48, p.faint, null);

  ctx.textBaseline = 'alphabetic';

  // header: logo + organization name (top right)
  const top = story ? 210 : M;
  const logo = story ? 92 : 76;
  drawLogo(ctx, right - logo, top, logo, p);
  rtl(ctx);
  ctx.fillStyle = p.fg;
  ctx.font = font(400, story ? 50 : 42, DISPLAY);
  ctx.fillText(c.org, right - logo - (story ? 26 : 22), top + logo * 0.68);

  // title, date, time
  let y = story ? 590 : 272;
  const titleSize = fitSize(ctx, c.title, 400, story ? 156 : 116, 64, maxW, DISPLAY);
  ctx.font = font(400, titleSize, DISPLAY);
  ctx.fillStyle = p.fg;
  rtl(ctx);
  ctx.fillText(c.title, right, y);

  y += story ? 118 : 88;
  const dateSize = fitSize(ctx, c.date, 400, story ? 84 : 64, 40, maxW, DISPLAY);
  ctx.font = font(400, dateSize, DISPLAY);
  ctx.fillStyle = p.accentText;
  rtl(ctx);
  ctx.fillText(c.date, right, y);

  if (c.time) {
    y += story ? 86 : 62;
    ctx.font = font(600, story ? 60 : 44);
    ctx.fillStyle = p.fg;
    ltr(ctx, 'right');
    ctx.fillText(c.time, right, y);
  }

  // the line
  y += story ? 100 : 60;
  drawWave(ctx, W, M + 22, y, story ? 30 : 22, story ? 11 : 9, p.accent, p.fg);
  const detailsTop = y + (story ? 100 : 66);

  // call to action area (bottom)
  const ctaSize = story ? 50 : 40;
  const pillH = ctaSize * 1.9;
  const linkSize = story ? 34 : 28;
  const bottom = story ? H - 300 : H - M;
  const pillTop = bottom - pillH - (c.link && story ? linkSize * 1.9 : 0);

  // details: program, speaker, topic, place. Keep them readable: shrink a little, then trim the topic,
  // then drop the generic program line (the full text is in the caption anyway).
  const limit = pillTop - (story ? 70 : 40);
  const build = (scale: number, topicLines: number, withProgram: boolean): Block[] => {
    const out: Block[] = [];
    const sz = (n: number) => n * scale * (story ? 1.3 : 1);
    if (c.program && withProgram) {
      ctx.font = font(600, sz(38));
      out.push({ lines: wrapBalanced(ctx, c.program, maxW, 2).map((l) => l.replace(/^\s*·\s*|\s*·\s*$/g, '')), weight: 600, size: sz(38), color: p.fg, gap: 0, lineHeight: 1.3 });
    }
    if (c.speakerName) {
      ctx.font = font(600, sz(30));
      out.push({ lines: ['הרצאת אורח'], weight: 600, size: sz(30), color: p.accentText, gap: out.length ? sz(26) : 0, lineHeight: 1.25 });
      ctx.font = font(700, sz(48));
      out.push({ lines: wrapText(ctx, c.speakerName, maxW, 1), weight: 700, size: sz(48), color: p.fg, gap: sz(4), lineHeight: 1.2 });
    }
    if (c.topic) {
      ctx.font = font(400, sz(38));
      out.push({ lines: wrapBalanced(ctx, c.topic, maxW, topicLines), weight: 400, size: sz(38), color: p.soft, gap: c.speakerName ? sz(8) : out.length ? sz(26) : 0, lineHeight: 1.3 });
    }
    if (c.place) {
      ctx.font = font(600, sz(34));
      out.push({ lines: wrapText(ctx, c.place, maxW - sz(34), 2), weight: 600, size: sz(34), color: p.soft, gap: out.length ? sz(30) : 0, lineHeight: 1.3, marker: true });
    }
    return out;
  };
  const fits = (bs: Block[]) => detailsTop + bs.reduce((sum, b) => sum + blockHeight(b), 0) <= limit;
  let blocks: Block[] = [];
  search: for (const [topicLines, withProgram] of [[story ? 4 : 3, true], [story ? 4 : 3, false], [2, false], [1, false]] as [number, boolean][]) {
    for (const scale of [1, 0.94, 0.88, 0.82]) {
      blocks = build(scale, topicLines, withProgram);
      if (fits(blocks)) break search;
    }
  }
  y = detailsTop;
  rtl(ctx);
  blocks.forEach((b) => {
    y += b.gap;
    ctx.font = font(b.weight, b.size, b.family);
    ctx.fillStyle = b.color;
    const indent = b.marker ? b.size * 0.85 : 0;
    b.lines.forEach((line, li) => {
      const base = y + b.size * (li + 1) * b.lineHeight - b.size * (b.lineHeight - 1) * 0.5;
      if (b.marker && li === 0) {
        // a small saffron marker before the place
        ctx.save();
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.arc(right - b.size * 0.25, base - b.size * 0.34, b.size * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillText(line, right - indent, base);
    });
    y += b.lines.length * b.size * b.lineHeight;
  });

  // pill with the call to action
  if (c.cta) {
    ctx.font = font(700, ctaSize);
    const tw = Math.min(ctx.measureText(c.cta).width, maxW - ctaSize * 1.6);
    const pw = tw + ctaSize * 1.6;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.roundRect(right - pw, pillTop, pw, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = p.pillText;
    rtl(ctx);
    ctx.fillText(c.cta, right - ctaSize * 0.8, pillTop + pillH / 2 + ctaSize * 0.36, tw);
  }
  if (c.link) {
    ctx.fillStyle = p.soft;
    if (story) {
      ctx.font = font(400, fitSize(ctx, c.link, 400, linkSize, 20, maxW));
      ltr(ctx, 'right');
      ctx.fillText(c.link, right, bottom - 8);
    } else {
      ctx.font = font(400, linkSize);
      ltr(ctx, 'left');
      // next to the pill, on the left; shrink if it would collide
      ctx.font = font(400, fitSize(ctx, c.link, 400, linkSize, 18, maxW * 0.48));
      ctx.fillText(c.link, M, pillTop + pillH / 2 + linkSize * 0.36);
    }
  }
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

// ───────────── captions ─────────────

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
    [c.time, c.place].filter(Boolean).join(' · '),
    '',
    program ? `${program}.` : '',
    speakerLine(c),
    c.description && c.type !== 'friday' ? c.description : '',
    '',
    `מפגש של ${c.org} למשרתות ולמשרתי מילואים: חוזרים לשגרה, ממשיכים לנוע. ביחד.`,
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
    [c.time, c.place].filter(Boolean).join(' · '),
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
