// A forwarding address (config.mjs REDIRECTS): a former section hub whose content now lives on another page. The page
// is noindex, left out of the sitemap, and sends the browser on at once (meta refresh: no script, the CSP stays strict);
// it also shows a plain link, for the rare browser that does not follow it. The leading "_" keeps the build from
// treating this file as a page: association.mjs, involved.mjs and support.mjs each call redirectPage(id).
import { html } from '../lib/html.mjs';
import { REDIRECTS } from '../config.mjs';
import { H1 } from './_g.mjs';

export function redirectPage(id) {
  const to = REDIRECTS[id];
  if (!to) throw new Error(`pages/_redirect.mjs: no "${id}" in config.mjs REDIRECTS`);
  const target = (ctx) => `${ctx.link(to.page)}${to.hash ? `#${to.hash}` : ''}`;
  return {
    redirect: (ctx) => target(ctx),
    ctaBar: false,
    meta: (ctx) => ({ title: ctx.t(`sections.${id}.meta.title`), description: ctx.t(`sections.${id}.meta.description`) }),
    render(ctx) {
      return html`
<section class="chapter moved" data-ground="beige" aria-labelledby="moved-h1">
  <div class="wrap stack">
    <h1 id="moved-h1" class="${H1}">${ctx.t('sections.moved.title')}</h1>
    <p class="t-lead">${ctx.t('sections.moved.body')} <a class="link" href="${target(ctx)}">${ctx.t(`top.${to.page}`)}${ctx.brand.tri()}</a></p>
  </div>
</section>`;
    },
  };
}
