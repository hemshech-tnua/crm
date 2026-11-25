// The page document: <html lang dir>, head, skip link, header, <main>, footer, and the phone CTA bar.
import { html, raw } from '../lib/html.mjs';
import { ctaBar as bar } from '../lib/components.mjs';
import { head } from './head.mjs';
import { header } from './header.mjs';
import { footer } from './footer.mjs';
import { sectionOf, resolveSection } from '../lib/sections.mjs';

/** Pages without the phone CTA bar unless they ask for it (DESIGN.md: hidden on donate and contact). */
const NO_BAR = new Set(['donate', 'contact']);

/** Spaces of any kind (the build's non-breaking space inside the name included) compare as one plain space. */
const plain = (s) => String(s).replace(/[\s\u00a0\u202f]+/g, ' ').trim();

/** "<page title> · המשך תנועה", unless the page title already carries the name (then it is used as is: never twice). */
export function fullTitle(title, name, sep) {
  return plain(title).includes(plain(name)) ? title : `${title}${sep}${name}`;
}

/**
 * The breadcrumb under the header on every page that belongs to a section (not its hub): "<section> ◀ <page>" (the
 * brand's triangle as the separator: it follows the reading direction, a › glyph does not), the section linking to its
 * hub. It sits on the ground of the page's first chapter, so it reads as that chapter's top line.
 */
export function crumbs(ctx, body) {
  const s = sectionOf(ctx.page.id);
  if (!s || s.hub === ctx.page.id) return '';
  const sec = resolveSection(ctx, s);
  const ground = String(body).match(/<section\b[^>]*\sdata-ground="([a-z-]+)"/)?.[1] ?? 'navy';
  return html`<nav class="crumbs" data-ground="${ground}" aria-label="${ctx.t('sections.crumbsLabel')}">
  <ol class="wrap crumbs__list" role="list">
    <li>${sec.hub ? html`<a class="crumbs__link" href="${sec.hub.href}">${sec.label}</a>` : html`<span>${sec.label}</span>`}<span class="crumbs__sep" aria-hidden="true">${ctx.brand.tri()}</span></li>
    <li><span class="crumbs__here" aria-current="page">${ctx.t(`nav.${ctx.page.id}`)}</span></li>
  </ol>
</nav>
`;
}

/**
 * The ground system (R3 "Ground, Anchor, Stripe Field"): the page opens on its own first chapter (the opener, navy as the
 * page sets it). Every later chapter alternates between beige and beige-100, a quiet tone step that is felt rather than
 * seen (no navy/beige zebra). One chapter per page may carry data-anchor: it keeps its navy, full bleed, the page's one
 * strong moment (on home the "first time?" band). Panels and cards inside a chapter keep their own data-ground.
 */
export function calmGrounds(body) {
  let first = true;
  let n = 0;
  return String(body).replace(/<section\b([^>]*)>/g, (tag, attrs) => {
    if (first) { first = false; return tag; }
    if (!/\sdata-ground="/.test(attrs)) return tag;
    if (/\sdata-anchor[\s=>]/.test(` ${attrs} `)) return tag.replace(/\sdata-ground="[a-z-]+"/, ' data-ground="navy"');
    n += 1;
    return tag.replace(/\sdata-ground="[a-z-]+"/, ` data-ground="${n % 2 ? 'beige' : 'beige-100'}"`);
  });
}

export function layout(ctx, { title, description, body, noindex = false, redirect = null, jsonld = [], bodyClass, ctaBar }) {
  const optOut = NO_BAR.has(ctx.page.id) || /(^|\s)no-cta-bar(\s|$)/.test(bodyClass ?? '');
  // default bar: the next Friday morning (registration + payment); a page asks for another kind with ctaBar { type }
  const barOpts = ctaBar === undefined ? (optOut ? false : {}) : ctaBar;
  const barHtml = barOpts ? bar(ctx, { ...barOpts, label: barOpts.label ? ctx.t(barOpts.label) : undefined }) : '';
  const footHtml = footer(ctx);
  // the page talks to Supabase (meetings, the next meeting, the WhatsApp phone): open that connection early
  const live = /\sdata-(events|next|org-phone)[=\s>]/.test(`${body}${barHtml}${footHtml}`);
  return html`<!doctype html>
<html lang="${ctx.lang}" dir="${ctx.dir}" class="no-js">
${head(ctx, { title: fullTitle(title, ctx.t('site.name'), ctx.t('site.titleSeparator')), description, noindex, redirect, jsonld, live })}
<body class="${['page-' + ctx.page.id, bodyClass].filter(Boolean).join(' ')}"${ctx.preview ? html` data-preview` : ''}>
<a class="skip-link" href="#main">${ctx.t('skip')}</a>
${header(ctx)}
<main id="main" tabindex="-1">
${crumbs(ctx, body)}${raw(calmGrounds(body))}
</main>
${footHtml}
${barHtml}
</body>
</html>
`;
}
