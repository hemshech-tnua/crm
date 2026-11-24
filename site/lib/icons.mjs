// The site's icon set: site/assets/icons/<name>.svg (24×24 grid, currentColor, 2px squared strokes, brand geometry).
//
//   ctx.icon('coffee')                              decorative (aria-hidden): the visible text next to it is the label
//   ctx.icon('coffee', { label: 'קפה' })            meaningful on its own: role="img" + <title>
//   ctx.icon('coffee', { size: 32, className })     size: px number (default 24) or a CSS length string ('1.25em')
//   ctx.iconText('coffee', 'קפה')                   <span class="icon-text"> icon + visible label (tag: 'li' etc.)
//
// Rule (NN/g): an icon is never the only carrier of meaning on this site — always put a text label beside it.
// An unknown or not-yet-drawn name renders nothing (no crash), so pages can use the names before the files exist.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { html, raw, attrs, esc } from './html.mjs';

export const ICONS_DIR = fileURLToPath(new URL('../assets/icons/', import.meta.url));

/** The names of the shared contract (site/README.md › Icons). */
export const ICON_NAMES = [
  'kettlebell', 'coffee', 'lecture', 'shower', 'calendar-3', 'greeter', 'bonfire', 'women', 'whatsapp', 'friend',
  'alone', 'all-levels', 'no-circle', 'no-commitment', 'map-pin', 'clock', 'price', 'reminder', 'calendar-add',
  'heart-hand', 'partner', 'volunteer', 'center', 'route',
];

/** Read every <name>.svg once: { name: { body, title } } (body = the drawing inside <svg>, without <title>). */
export function loadIcons(dir = ICONS_DIR) {
  const set = {};
  if (!existsSync(dir)) return set;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.svg')) continue;
    const src = readFileSync(join(dir, f), 'utf8');
    const inner = src.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1];
    if (!inner) throw new Error(`icons: ${f} has no <svg>…</svg>`);
    const title = inner.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
    const body = inner.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s*\n\s*/g, '');
    set[f.slice(0, -4)] = { body, title };
  }
  return set;
}

/** icon(set)(name, opts) → inline <svg> (html``), or nothing when the name is not in the set. */
export function iconHelper(set) {
  return (name, { label, size = 24, className } = {}) => {
    const ic = set[name];
    if (!ic) return html``;
    return html`<svg${attrs({
      class: ['icon', `icon--${name}`, className].filter(Boolean).join(' '),
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'square',
      'stroke-linejoin': 'miter',
      role: label ? 'img' : null,
      'aria-label': label ?? null,
      'aria-hidden': label ? null : 'true',
      focusable: 'false',
    })}>${label ? raw(`<title>${esc(label)}</title>`) : ''}${raw(ic.body)}</svg>`;
  };
}

/** iconText(icon)(name, label, opts) → <span class="icon-text">icon + label</span> (the label is the accessible text). */
export const iconTextHelper = (icon) => (name, label, { size = 24, className, tag = 'span' } = {}) => {
  if (!/^(span|li|p|div|dt|dd|strong)$/.test(tag)) throw new Error(`iconText: tag "${tag}" is not allowed`);
  return html`${raw(`<${tag}`)}${attrs({ class: ['icon-text', className].filter(Boolean).join(' ') })}>${icon(name, { size })}<span>${label}</span>${raw(`</${tag}>`)}`;
};
