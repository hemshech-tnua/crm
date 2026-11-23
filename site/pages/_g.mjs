// Helpers shared by Team G's pages (about, team, faq, membership, accessibility). The leading "_" keeps the build from
// treating this file as a page. Nothing here is a shared component: it composes the design system's shared classes.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { html, raw, esc, attrs } from '../lib/html.mjs';
import { imageSize } from '../lib/images.mjs';

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));

/** The association's name, set in Hebrew (and marked lang="he" inside English text). */
export const orgName = (ctx) => (ctx.lang === 'he' ? html`המשך תנועה` : html`<span lang="he">המשך תנועה</span>`);

/** A copy string whose {org} placeholder becomes the name (lang-marked on English pages). Other {vars} are filled. */
export function tx(ctx, key, vars) {
  const s = ctx.t(key, vars);
  return raw(esc(s).replace(/\{org\}/g, orgName(ctx).toString()));
}

/** Same as tx() for a plain string value (an item of a list from copy). */
export function txs(ctx, s) {
  return raw(esc(s ?? '').replace(/\{org\}/g, orgName(ctx).toString()));
}

/** Plain text (no markup) with {org} filled: for attributes, meta and JSON-LD. */
export const plain = (s) => String(s ?? '').replace(/\{org\}/g, 'המשך תנועה');

/** URL of a page when it exists in this build, else of the first fallback that does (teams build pages in parallel). */
export function pageHref(ctx, id, ...fallbacks) {
  for (const p of [id, ...fallbacks]) if (p && ctx.pageExists(p)) return ctx.link(p);
  return null;
}

/** An action that ends with ◀ (▶ in English). Without href (a page that does not exist yet) nothing is rendered. */
export function action(ctx, { href, label, className = 'btn', hint, external = false, aria } = {}) {
  if (!href) return '';
  return html`<a${attrs({ class: className, href: ctx.safeUrl(href), rel: external ? 'noopener' : null, 'aria-label': aria ?? null })}><span>${label}</span>${hint ? html`<span class="visually-hidden"> ${hint}</span>` : ''}${ctx.brand.tri()}</a>`;
}

/**
 * A WhatsApp action that works without JavaScript: a real link to the contact page from the start, which
 * assets/js/org.js turns into wa.me/<phone> once the phone arrives from public_org_info. When there is no contact
 * page in this build it falls back to the CRM home (where the phone is shown).
 */
export function waAction(ctx, { label, text, className = 'btn' } = {}) {
  const href = pageHref(ctx, 'contact') ?? ctx.crm.home;
  return html`<a${attrs({ class: className, href, 'data-org-phone': 'whatsapp', 'data-org-text': text ?? null })}><span>${label}</span>${ctx.brand.tri()}</a>`;
}

/** Corner stripes: the chapter divider (DESIGN §3.1), in the shared .stripes/.corner classes. pos: ts | te | bs | be.
 *  tone: a .stripes--* colour (default: tone-on-tone for the ground). Decorative. */
export function corner(ctx, { pos = 'te', dir = 'fall', tone } = {}) {
  return html`<div class="${['stripes', 'corner', `corner--${pos}`, tone && `stripes--${tone}`].filter(Boolean).join(' ')}" aria-hidden="true">${ctx.brand.stripes({ width: 260, height: 140, unit: 20, dir, count: 3 })}</div>`;
}

/**
 * A picture named in org.json: either the name of a responsive photo set in assets/photos (<name>-<w>.webp) or a path
 * under assets/ ('photos/team/dana.webp'). Width and height are read from the file (no layout shift).
 */
export function ownerImg(ctx, p, { alt = '', sizes = '100vw', className } = {}) {
  if (!ctx.has(p)) return '';
  if (ctx.photoNames.includes(p)) return ctx.img(p, { alt, sizes, className });
  const rel = String(p).replace(/^\/+/, '');
  const file = join(ASSETS, rel);
  if (!existsSync(file)) throw new Error(`org.json: picture "${p}" is not in site/assets`);
  const { width, height } = imageSize(file);
  return html`<img${attrs({ src: ctx.asset(rel), width, height, alt, loading: 'lazy', decoding: 'async', class: className })}>`;
}

/** A person's portrait (team, board): alt = "name, role". */
export function personPhoto(ctx, person, o = {}) {
  const alt = ctx.t('team.a11y.photoAlt', { name: ctx.l(person.name) ?? '', role: ctx.l(person.role) ?? '' }).replace(/,\s*$/, '');
  return ownerImg(ctx, person?.photo, { sizes: '(min-width: 64rem) 22vw, (min-width: 30rem) 45vw, 100vw', ...o, alt });
}

/** Grounds in the chapter rhythm (navy → beige → navy → beige-light …), so neighbours never share a ground even when an
 *  owner-content chapter is left out of a production build. */
export const rhythm = (start = 0) => {
  const cycle = ['navy', 'beige', 'navy', 'beige-light'];
  let i = start;
  return () => cycle[i++ % cycle.length];
};
