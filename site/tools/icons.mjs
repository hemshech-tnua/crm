#!/usr/bin/env node
// The site's icon set: one source for site/assets/icons/<name>.svg (run once after a change; the SVGs are committed).
//
//   node site/tools/icons.mjs                 write the 24 SVGs
//   node site/tools/icons.mjs --sheet <dir>   also write <dir>/sheet.html (contact sheet on navy + beige, 20–64px)
//
// Drawing rules (from the brand mark: a figure built from a pennant, a diamond and right isosceles triangles):
//   · 24×24 grid, live area 2–22, one stroke: 2px, square caps, miter joins, currentColor;
//   · lines at 0°, 90° and 45° only: no curves and no circles (round things become 45° octagons);
//   · people are the mark's figure: a solid diamond head over 45° shoulders;
//   · one solid brand piece (diamond or right triangle) where it carries meaning: the keyhole, the hole of a tag,
//     the three Fridays, the meeting point;
//   · stroke coordinates on whole pixels, so 24px renders crisp.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OUT = fileURLToPath(new URL('../assets/icons/', import.meta.url));

const n = (v) => +v.toFixed(2);
/** A solid diamond (the mark's centre piece). */
const dia = (x, y, r) => `<path fill="currentColor" stroke="none" d="M${n(x)} ${n(y - r)}L${n(x + r)} ${n(y)}L${n(x)} ${n(y + r)}L${n(x - r)} ${n(y)}Z"/>`;
/** A solid polygon (brand piece). */
const solid = (d) => `<path fill="currentColor" stroke="none" d="${d}"/>`;
const s = (d) => `<path d="${d}"/>`;
/** A person: diamond head at (x, y) and 45° shoulders down to the floor (y = 21). */
const person = (x, y, w = 5, floor = 21) => dia(x, y, 2.5) + s(`M${x - w} ${floor}V${y + 5 + w - 3}L${x - 3} ${y + 5}H${x + 3}L${x + w} ${y + 5 + w - 3}V${floor}`);

export const ICONS = {
  kettlebell: ['Kettlebell', s('M7 10V5L9 3H15L17 5V10') + s('M8 9H16L20 13V18L17 21H7L4 18V13Z')],
  coffee: ['Coffee', s('M4 10H16V17L13 20H7L4 17Z') + s('M16 12H19V15L17 17H16') + s('M8 3L10 5L8 7') + s('M12 3L14 5L12 7')],
  lecture: ['Lecture', dia(12, 4, 2.5) + s('M6 12V11L9 8H15L18 11V12') + s('M3 13H21M8 13V22H16V13')],
  shower: ['Shower', s('M4 22V5L6 3H12V5') + solid('M6 11H18L12 5Z') + s('M8 14V15M12 14V15M16 14V15M10 18V19M14 18V19')],
  'calendar-3': ['Three Fridays a month', s('M3 5H21V21H3Z') + s('M3 9H21M8 3V6M16 3V6') + dia(7.5, 15, 2) + dia(12, 15, 2) + dia(16.5, 15, 2)],
  greeter: ['Someone waiting at the entrance', s('M3 22V2H21V22') + person(12, 8, 4)],
  bonfire: ['Bonfire', s('M12 2L17 7V11L13 15H11L7 11V8L9 6L11 8Z') + solid('M9 13H15L12 10Z') + s('M5 18L9 22M19 18L15 22M4 21H20')],
  women: ['Women', s('M10 3H14L17 6V10L14 13H10L7 10V6Z') + s('M12 13V22M8 18H16')],
  whatsapp: ['WhatsApp', s('M8 3H16L21 8V13L16 18H7L3 22V8Z') + s('M9 8L8 9V10L12 14H13L14 13')],
  friend: ['With a friend', person(8, 5, 4) + dia(16, 7, 2.5) + s('M13 12H19L22 15V21') ],
  alone: ['On your own', person(12, 5, 6)],
  'all-levels': ['Every fitness level', s('M3 21V16H9V11H15V6H21V21Z')],
  'no-circle': ['No sitting in a circle', s('M9 3H15L21 9V15L15 21H9L3 15V9Z') + s('M4 20L20 4')],
  'no-commitment': ['No commitment', s('M5 11H19V21H5Z') + s('M8 11V6L10 4H14L16 6V7') + dia(12, 16, 2)],
  'map-pin': ['Place', s('M6 3H18V12L12 18L6 12Z') + dia(12, 9, 2.5) + s('M7 21H17')],
  clock: ['Time', s('M8 3H16L21 8V16L16 21H8L3 16V8Z') + s('M12 7V12H8')],
  price: ['Price', s('M11 3H21V13L12 22L2 12Z') + dia(16, 8, 2)],
  reminder: ['Reminder', s('M5 17H19L17 15V10L13 6H11L7 10V15Z') + s('M12 3V6M10 20H14')],
  'calendar-add': ['Add to calendar', s('M3 5H21V21H3Z') + s('M3 9H21M8 3V6M16 3V6') + s('M12 12V18M9 15H15')],
  'heart-hand': ['Giving', s('M12 13L7 8V6L9 4H10L12 6L14 4H15L17 6V8Z') + s('M2 15H5L9 19H15L20 14') + s('M9 16H13')],
  partner: ['Partnership', s('M8 6L14 12L8 18L2 12Z') + s('M16 6L22 12L16 18L10 12Z') + dia(12, 12, 1.5)],
  volunteer: ['Volunteer', person(10, 7, 5) + s('M13 12L17 8V3')],
  center: ['A centre', s('M3 21V12L12 3L21 12V21Z') + s('M10 21V16H14V21') + dia(12, 11, 2)],
  route: ['Route', s('M4 20H8L14 14H18V11') + dia(4, 20, 2.5) + solid('M15 2H21V6L18 9L15 6Z')],
};

export function svg(name) {
  const [title, body] = ICONS[name];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
<title>${title}</title>
${body.replace(/></g, '>\n<')}
</svg>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  for (const name of Object.keys(ICONS)) writeFileSync(join(OUT, `${name}.svg`), svg(name));
  console.log(`icons: wrote ${Object.keys(ICONS).length} SVGs to site/assets/icons/`);
  const i = process.argv.indexOf('--sheet');
  if (i > 0) {
    const dir = process.argv[i + 1];
    mkdirSync(dir, { recursive: true });
    const sizes = [20, 24, 32, 48, 64];
    const row = (name) => `<div class="row"><span class="nm">${name}</span>${sizes.map((z) => svg(name).replace(/width="24" height="24"/, `width="${z}" height="${z}"`)).join('')}</div>`;
    const names = Object.keys(ICONS);
    const grid = (cls) => `<section class="${cls}">${names.map(row).join('')}</section>`;
    writeFileSync(join(dir, 'sheet.html'), `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:13px/1.2 system-ui,sans-serif;display:grid;grid-template-columns:1fr 1fr}
section{padding:16px 20px}.navy{background:#142837;color:#ebdcb9}.beige{background:#ebdcb9;color:#142837}
.row{display:flex;align-items:center;gap:14px;height:72px}.nm{width:110px;opacity:.8}
</style>${grid('navy')}${grid('beige')}`);
    console.log(`icons: contact sheet → ${join(dir, 'sheet.html')}`);
  }
}
