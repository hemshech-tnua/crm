// Helpers shared by Team F's support pages (donate, partners, volunteer, contact). The leading "_" keeps the build from
// treating this file as a page. Nothing here is a shared component: it only composes the shared ones.
import { html, attrs } from '../lib/html.mjs';

/** Shared class names (from the design system) in one place, so a rename in D's CSS is a one-line change here. */
export const C = {
  wrap: 'wrap',
  chapter: 'chapter',
  display: 't-display',
  chapterTitle: 't-chapter',
  title: 't-title',
  lead: 't-lead',
  body: 't-body',
  small: 't-small',
  quiet: 'quiet',
  btn: 'btn',
  ghost: 'btn btn--ghost',
  btnSm: 'btn btn--sm',
  ghostSm: 'btn btn--ghost btn--sm',
  link: 'link',
  actions: 'cluster',
  photo: 'photo',
  sr: 'visually-hidden',
  ltr: 'ltr',
};

/** URL of a page when it exists in this build, else of the fallback page (pages are built in parallel by other teams). */
export function pageHref(ctx, id, ...fallbacks) {
  for (const p of [id, ...fallbacks]) if (p && ctx.pageExists(p)) return ctx.link(p);
  return ctx.link('home');
}

/** The ◀ / ▶ mark that ends every action. */
export const tri = (ctx) => ctx.brand.tri();

/**
 * A WhatsApp action that works today and without JavaScript: it is a real link from the start (to `fallback`, the
 * contact page by default), and assets/js/org.js turns it into https://wa.me/<phone>?text=<message> as soon as the
 * association's phone arrives from public_org_info (the data-org-phone contract in site/README.md).
 */
export function waAction(ctx, { label, text, className = C.btn, fallback, hint } = {}) {
  const href = fallback ?? pageHref(ctx, 'contact');
  return html`<a${attrs({ class: className, href, 'data-org-phone': 'whatsapp', 'data-org-text': text ?? null })}><span>${label}</span>${hint ? html`<span class="${C.sr}"> ${hint}</span>` : ''}${tri(ctx)}</a>`;
}

/** A plain action link (button styled), ending in ◀. */
export function action(ctx, { href, label, className = C.btn, hint, external = false } = {}) {
  return html`<a${attrs({ class: className, href: ctx.safeUrl(href), rel: external ? 'noopener' : null })}><span>${label}</span>${hint ? html`<span class="${C.sr}"> ${hint}</span>` : ''}${tri(ctx)}</a>`;
}

/**
 * A giving route's action: the owner's payment link when org.json has one, otherwise a WhatsApp message to arrange it.
 * Switches automatically: fill the org.json key and rebuild.
 */
export function giveAction(ctx, { url, cta, wa, message, className, external }) {
  return ctx.has(url)
    ? action(ctx, { href: url, label: cta, className, hint: external, external: true })
    : waAction(ctx, { label: wa, text: message, className, hint: ctx.t('donate.ways.waHint') });
}

/**
 * Chapters with alternating grounds. `sections` = [{ when, render(ground) }]; sections whose `when` is false (owner content
 * still missing in a production build) are dropped first, so two neighbours never share a ground.
 */
export function chapters(sections, pattern = ['navy', 'beige', 'navy', 'beige-light']) {
  return sections.filter((s) => s.when !== false).map((s, i) => s.render(pattern[i % pattern.length]));
}

/**
 * Corner stripes: three 45° bands entering from one corner (tone-on-tone by default), decorative.
 * pos is logical (ts | te | bs | be: inline start/end × top/bottom) or physical (tl | tr | bl | br, for a photo whose
 * quiet corner is fixed). The bands are drawn into the corner they sit in, in either reading direction.
 */
export function corner(ctx, pos = 'te', { unit = 22, tone } = {}) {
  const rtl = ctx.dir === 'rtl';
  const W = 260;
  const H = 150;
  let v = pos[0];
  let side; // physical: 'l' | 'r'
  let logical;
  if (pos[1] === 's' || pos[1] === 'e') {
    logical = pos;
    side = (pos[1] === 's') === rtl ? 'r' : 'l';
  } else {
    side = pos[1];
    logical = v + ((side === 'r') === rtl ? 's' : 'e');
  }
  // fall (\) with offset 0 fills bottom-left, with offset W top-right; rise (/) with offset 0 fills top-left, W bottom-right
  const dir = (v === 't') === (side === 'l') ? 'rise' : 'fall';
  const offset = (v === 't' && side === 'r') || (v === 'b' && side === 'r') ? W : 0;
  return html`<div class="${['stripes', 'corner', `corner--${logical}`, tone && `stripes--${tone}`].filter(Boolean).join(' ')}" aria-hidden="true">${ctx.brand.stripes({ width: W, height: H, unit, dir, offset, count: 3 })}</div>`;
}

/** A bilingual owner value ({he,en}) or plain value. */
export const own = (ctx, v) => ctx.l(v);
