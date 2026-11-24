// The "not found" page: written as /404.html (Hebrew) and /en/404.html; noindex, no canonical, not in the sitemap.
// Every link on it is absolute, so it works at any URL the host serves it for. One job: back to a meeting.
import { html } from '../lib/html.mjs';

export const notFound = true;

export function render(ctx) {
  const { t, ui } = ctx;
  return html`
<section class="chapter nf" data-ground="navy" aria-labelledby="nf-title">
  ${ui.corner({ pos: 'te', tone: 'beige', unit: 24, accent: true })}
  <div class="wrap nf__in">
    <p class="nf__code" aria-hidden="true" data-load="0">404</p>
    <h1 id="nf-title" class="t-display nf__title" data-load="1">${t('notFound.title')}</h1>
    <p class="t-lead quiet" data-load="2">${t('notFound.body')}</p>
    <div class="cluster" data-load="3">
      ${ui.button(t('notFound.cta'), ctx.ctaHref)}
      ${ui.link(t('notFound.secondary'), ctx.link('home'), { arrow: false })}
    </div>
  </div>
</section>`;
}
