// The page document: <html lang dir>, head, skip link, header, <main>, footer, and the phone CTA bar.
import { html } from '../lib/html.mjs';
import { ctaBar as bar } from '../lib/components.mjs';
import { head } from './head.mjs';
import { header } from './header.mjs';
import { footer } from './footer.mjs';

/** Pages without the phone CTA bar unless they ask for it (DESIGN.md: hidden on donate and contact). */
const NO_BAR = new Set(['donate', 'contact']);

/** Spaces of any kind (the build's non-breaking space inside the name included) compare as one plain space. */
const plain = (s) => String(s).replace(/[\s\u00a0\u202f]+/g, ' ').trim();

/** "<page title> · המשך תנועה", unless the page title already carries the name (then it is used as is: never twice). */
export function fullTitle(title, name, sep) {
  return plain(title).includes(plain(name)) ? title : `${title}${sep}${name}`;
}

export function layout(ctx, { title, description, body, noindex = false, jsonld = [], bodyClass, ctaBar }) {
  const optOut = NO_BAR.has(ctx.page.id) || /(^|\s)no-cta-bar(\s|$)/.test(bodyClass ?? '');
  // default bar: the next Friday morning (registration + payment); a page asks for another kind with ctaBar { type }
  const barOpts = ctaBar === undefined ? (optOut ? false : {}) : ctaBar;
  const barHtml = barOpts ? bar(ctx, { ...barOpts, label: barOpts.label ? ctx.t(barOpts.label) : undefined }) : '';
  const footHtml = footer(ctx);
  // the page talks to Supabase (meetings, the next meeting, the WhatsApp phone): open that connection early
  const live = /\sdata-(events|next|org-phone)[=\s>]/.test(`${body}${barHtml}${footHtml}`);
  return html`<!doctype html>
<html lang="${ctx.lang}" dir="${ctx.dir}" class="no-js">
${head(ctx, { title: fullTitle(title, ctx.t('site.name'), ctx.t('site.titleSeparator')), description, noindex, jsonld, live })}
<body class="${['page-' + ctx.page.id, bodyClass].filter(Boolean).join(' ')}"${ctx.preview ? html` data-preview` : ''}>
<a class="skip-link" href="#main">${ctx.t('skip')}</a>
${header(ctx)}
<main id="main" tabindex="-1">
${body}
</main>
${footHtml}
${barHtml}
</body>
</html>
`;
}
