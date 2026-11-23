// Helpers shared by Team F's support pages (donate, partners, volunteer, contact). The leading "_" keeps the build from
// treating this file as a page. Nothing here is a shared component: it only composes the shared ones.
import { html, attrs } from '../lib/html.mjs';

/** Shared class names (from the design system) in one place, so a rename in D's CSS is a one-line change here. */
export const C = {
  wrap: 'wrap',
  chapter: 'chapter',
  display: 't-display', // the shared inner-page h1 size (layout.css)
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
 * quiet corner is fixed). The run is anchored to that corner by the shared stripes helper (lib/brand.mjs), so it stays
 * in the corner whatever the box's shape, in either reading direction.
 */
export function corner(ctx, pos = 'te', { unit = 22, tone } = {}) {
  const rtl = ctx.dir === 'rtl';
  const logical = pos[1] === 's' || pos[1] === 'e' ? pos : pos[0] + ((pos[1] === 'r') === rtl ? 's' : 'e');
  const physical = /^[tb][lr]$/.test(pos) ? pos : pos[0] + ((pos[1] === 's') === rtl ? 'r' : 'l');
  // fall (\) runs into the top-right / bottom-left corners, rise (/) into the top-left / bottom-right ones
  return html`<div class="${['stripes', 'corner', `corner--${logical}`, tone && `stripes--${tone}`].filter(Boolean).join(' ')}" aria-hidden="true">${ctx.brand.stripes({ width: 260, height: 150, unit, dir: 'cut', count: 3, anchor: physical })}</div>`;
}

/** A bilingual owner value ({he,en}) or plain value. */
export const own = (ctx, v) => ctx.l(v);

/**
 * A row for ctx.ui.rows (the shared big row link: whole row clickable, ◀ at the end) that opens WhatsApp with a
 * prefilled message. It links to the contact page until assets/js/org.js fills in the association's phone.
 */
export function waRow(ctx, { title, body, note, label, text, hint, fallback } = {}) {
  return { title, body, note, href: fallback ?? pageHref(ctx, 'contact'), go: label, hint, whatsapp: { text } };
}

/** A row for ctx.ui.rows that goes to a page or an outside link (`hint` is read out after the label, e.g. "(opens …)"). */
export function linkRow(ctx, { title, body, note, label, href, hint, external = false } = {}) {
  return { title, body, note, href, go: label, hint, external };
}

/** A giving route as a row: the owner's payment link when org.json has one, otherwise WhatsApp to arrange it. */
export function giveRow(ctx, { title, body, url, cta, wa, message, external }) {
  return ctx.has(url)
    ? linkRow(ctx, { title, body, label: cta, href: url, hint: external, external: true })
    : waRow(ctx, { title, body, label: wa, text: message, hint: ctx.t('donate.ways.waHint') });
}
