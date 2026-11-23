// The page document: <html lang dir>, head, skip link, header, <main>, footer.
import { html } from '../lib/html.mjs';
import { head } from './head.mjs';
import { header } from './header.mjs';
import { footer } from './footer.mjs';

export function layout(ctx, { title, description, body, noindex = false, jsonld = [], bodyClass }) {
  const name = ctx.t('site.name');
  const fullTitle = title.includes(name) ? title : `${title}${ctx.t('site.titleSeparator')}${name}`;
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
</body>
</html>
`;
}
