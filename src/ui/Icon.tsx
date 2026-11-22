// Inline icon set on a 24px grid. No icon font, no external requests.
//
// Brand book pp.44–45: the icons are built from filled geometric shapes only, every diagonal at 45°, in one colour
// (navy on beige or beige on navy). Inner details are cut out of the shape (negative), never drawn with a line.
// So the navigation icons and the glyphs that carry meaning on a screen (calendar, people, task, mic, chart, settings,
// overview, door, clock, pin, alert, message, search, copy, download, edit, phone, camera, image…) are FILLED shapes,
// cut with even-odd. The smallest utility glyphs (check, close, chevrons, plus, link…) stay as thin strokes, with
// square caps and mitred joins to match the geometry.

type Glyph = { d: string; fill?: true };

const f = (d: string): Glyph => ({ d, fill: true });
const s = (d: string): Glyph => ({ d });

const GLYPHS: Record<string, Glyph> = {
  // ── filled, after the book's set ──
  /** four tiles of a board, one cut at 45° */
  overview: f('M3 3h8v10H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 15h8v6H3z'),
  /** the book's "אירועים": a block with two tabs, a 3×2 grid cut out, the last cell a triangle */
  calendar: f('M6.5 2.5h2.5v3H6.5zM15 2.5h2.5v3H15zM3 6h18v15H3zM5.5 10.5v3h3v-3zM10.5 10.5v3h3v-3zM15.5 10.5v3h3v-3zM5.5 15.5v3h3v-3zM10.5 15.5v3h3v-3zM18.5 15.5v3h-3z'),
  /** two people: diamond heads, shoulders cut at 45° */
  people: f('M9 3.5l3.5 3.5L9 10.5 5.5 7zM2 21v-4l3-3h8l3 3v4zM16.5 3l3 3-3 3-3-3zM13 12h6l3 3v6h-4.5v-4.5z'),
  /** a clipboard with a 45° check cut out */
  task: f('M8.5 2.5h7V5h-7zM4 5h16v16H4zM6.08 13.42l4.42 4.42 7.42-7.42-1.84-1.84-5.58 5.58-2.58-2.58z'),
  /** a microphone with chamfered ends in a cradle, on a stand */
  mic: f('M12 2l3 3v6.5l-3 3-3-3V5zM5 10h2v3.2l3.3 3.3h3.4l3.3-3.3V10h2v4l-4.5 4.5h-5L5 14zM11 18.5h2v2h-2zM8 20.5h8V22H8z'),
  /** three columns */
  chart: f('M3 12h4.5v9H3zM9.75 4h4.5v17h-4.5zM16.5 8.5H21V21h-4.5z'),
  /** an eight-point star (a square and a diamond), a diamond cut out: the gear, in the logo's geometry */
  settings: f('M12 2.1l2.9 2.9H19v4.1l2.9 2.9-2.9 2.9V19h-4.1L12 21.9 9.1 19H5v-4.1L2.1 12 5 9.1V5h4.1zM12 9l3 3-3 3-3-3z'),
  /** a door on its threshold, a diamond handle cut out */
  door: f('M6 3h12v17H6zM14.5 10.75l1.25 1.25-1.25 1.25L13.25 12zM3 20h18v2H3z'),
  /** an hourglass of two right triangles, as in the logo */
  clock: f('M4.5 2h15v2.5h-15zM5 5h14l-7 7zM12 12l7 7H5zM4.5 19.5h15V22h-15z'),
  /** the book's "מיקום": a pointed shield with a triangle cut out, on a bar */
  pin: f('M5 2.5h14v10L12 19.5 5 12.5zM9 6.5l3 3 3-3zM8 21h8v1.5H8z'),
  /** a warning diamond with the mark cut out */
  alert: f('M12 1.5L22.5 12 12 22.5 1.5 12zM10.75 6.5v7.5h2.5V6.5zM10.75 15.75V18.25h2.5V15.75z'),
  /** the book's "שיח": a speech block with a 45° tail, three triangles cut out */
  message: f('M2 4h20v13h-3v4l-4-4H2zM6 12.5h3L7.5 11zM10.5 12.5h3L12 11zM15 12.5h3L16.5 11z'),
  /** the book's "חוסן": a pointed shield with a triangle cut out */
  shield: f('M5 2.5h14v11L12 20.5 5 13.5zM9 13h6l-3-3z'),
  /** a filled square with a 45° check cut out */
  checkCircle: f('M3 3h18v18H3zM6.08 12.42l4.42 4.42 7.42-7.42-1.84-1.84-5.58 5.58-2.58-2.58z'),
  /** a person and a plus */
  userPlus: f('M9 3.5l3.5 3.5L9 10.5 5.5 7zM2 21v-4l3-3h8l3 3v4zM18 6h2v3h3v2h-3v3h-2v-3h-3V9h3z'),
  /** a diamond with four triangle rays (the empty state's default) */
  sun: f('M12 6l6 6-6 6-6-6zM10 4h4l-2-2zM20 10v4l2-2zM10 20h4l-2 2zM4 10v4l-2-2z'),
  /** three diamonds */
  more: f('M5 10.2L6.8 12 5 13.8 3.2 12zM12 10.2l1.8 1.8-1.8 1.8-1.8-1.8zM19 10.2l1.8 1.8-1.8 1.8-1.8-1.8z'),
  /** the book's "מטרה": a diamond inside a diamond */
  star: f('M12 1.5L22.5 12 12 22.5 1.5 12zM12 5.5L5.5 12l6.5 6.5 6.5-6.5zM12 8.5l3.5 3.5-3.5 3.5L8.5 12z'),
  // the public ticket's set (were round outline glyphs in features/public/marks.tsx), redrawn in the book's geometry
  /** a heart of 45° sides: two lobes meeting in a notch, a point below */
  heart: f('M12 21L3 12V7l4-4h1.5L12 6.5 15.5 3H17l4 4v5z'),
  /** a payment card: the magnetic band and a number line cut out */
  card: f('M2 5h20v14H2zM2 8.5h20V11H2zM5 14.5h6v2H5z'),
  /** share: an arrow rising out of an open tray */
  share: f('M12 2l5 5h-3.5v7h-3V7H7zM4 11h3v8h10v-8h3v11H4z'),
  /** coffee: a cup with chamfered foot and a handle, two diamonds of steam, on a saucer */
  coffee: f('M4 9h12v6l-3 3H7l-3-3zM16 10h4v5h-4v-1.8h2.2v-1.4H16zM8.5 3l1.5 1.5L8.5 6 7 4.5zM12.5 3l1.5 1.5L12.5 6 11 4.5zM3 20h16v2H3z'),

  // ── strokes: small utility glyphs ──
  plus: s('M12 5v14M5 12h14'),
  search: f('M10 2l8 8-8 8-8-8zM10 5.5 5.5 10l4.5 4.5 4.5-4.5zM16.4 15l6 6-1.4 1.4-6-6z'),
  phone: f('M3 3h5l3 3-3 3 7 7 3-3 3 3v5h-3L3 6z'),
  copy: f('M8 8h13v13H8zM10 10v9h9v-9zM3 3h13v3h-2V5H5v9h1v2H3z'),
  download: f('M11 2h2v11.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM3 19h18v2.5H3z'),
  qr: s('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2'),
  close: s('M18 6 6 18M6 6l12 12'),
  chevron: s('M15 18l-6-6 6-6'),
  back: s('M9 18l6-6-6-6'),
  logout: s('M15 3h5v18h-5M8 17l-5-5 5-5M3 12h12'),
  edit: f('M14.5 4.5l5 5L8.5 20.5h-5v-5zM16 3l1.5-1.5 5 5L21 8z'),
  check: s('M20 6 9 17l-5-5'),
  merge: s('M6 3v6a6 6 0 0 0 6 6h6M18 15l-3-3M18 15l-3 3M6 21v-6'),
  link: s('M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'),
  external: s('M18 13v7H4V6h7M15 3h6v6M10 14 21 3'),
  camera: f('M2 7h5l3-3h4l3 3h5v13H2zM12 9l4.5 4.5L12 18l-4.5-4.5z'),
  noCamera: s('M1 1l22 22M21 20H1V6h5m3-3h6l2 3h6v12M15 15.5a4 4 0 0 1-5.5-5.5'),
  image: f('M3 3h18v18H3zM5 5v14h14V5zM5 19l7-7 7 7zM16 6l2 2-2 2-2-2z'),
  undo: s('M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13'),
  sparkle: f('M12 3l9 9-9 9-9-9zM12 8.5 8.5 12l3.5 3.5 3.5-3.5z'),
  flame: s('M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z'),
  filter: s('M3 5h18M6 12h12M10 19h4'),
};

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size = 20, className = '', strokeWidth = 1.8, label }: {
  name: IconName; size?: number; className?: string; strokeWidth?: number; label?: string;
}) {
  const g = GLYPHS[name];
  const a11y = { 'aria-hidden': label ? undefined : true, role: label ? 'img' : undefined, 'aria-label': label, focusable: 'false' } as const;
  if (!g) return null;
  return g.fill ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`} {...a11y}>
      <path d={g.d} fillRule="evenodd" />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={`shrink-0 ${className}`}
      {...a11y}
    >
      <path d={g.d} />
    </svg>
  );
}
