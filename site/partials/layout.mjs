// The page document: <html lang dir>, head, skip link, header, <main>, footer, and the phone CTA bar.
import { html } from '../lib/html.mjs';
import { ctaBar as bar } from '../lib/components.mjs';
import { head } from './head.mjs';
import { header } from './header.mjs';
import { footer } from './footer.mjs';

/** Pages without the phone CTA bar unless they ask for it (DESIGN.md: hidden on donate and contact). */
const NO_BAR = new Set(['donate', 'contact']);

export function layout(ctx, { title, description, body, noindex = false, jsonld = [], bodyClass, ctaBar }) {
  const name = ctx.t('site.name');
  const fullTitle = title.includes(name) ? title : `${title}${ctx.t('site.titleSeparator')}${name}`;
  const optOut = NO_BAR.has(ctx.page.id) || /(^|\s)no-cta-bar(\s|$)/.test(bodyClass ?? '');
  const barOpts = ctaBar === undefined ? (optOut ? false : {}) : ctaBar;
  return html`<!doctype html>
<html lang="${ctx.lang}" dir="${ctx.dir}" class="no-js">
${head(ctx, { title: fullTitle, description, noindex, jsonld })}
<body class="${['page-' + ctx.page.id, bodyClass].filter(Boolean).join(' ')}"${ctx.preview ? html` data-preview` : ''}>
<a class="skip-link" href="#main">${ctx.t('skip')}</a>
${header(ctx)}
<main id="main" tabindex="-1">
${body}
</main>
${footer(ctx)}
${barOpts ? bar(ctx, { ...barOpts, label: barOpts.label ? ctx.t(barOpts.label) : undefined }) : ''}
</body>
</html>
`;
}
