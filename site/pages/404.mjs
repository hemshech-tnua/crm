// The "not found" page: written as /404.html (Hebrew) and /en/404.html; noindex, no canonical, not in the sitemap.
// Every link on it is absolute, so it works at any URL the host serves it for.
import { html } from '../lib/html.mjs';

export const notFound = true;

export function render(ctx) {
  return html`
<section class="section section--navy not-found" aria-labelledby="nf-title">
  ${ctx.brand.stripes({ width: 300, height: 300, unit: 20, className: 'hero__stripes' })}
  <div class="container stack">
    <p class="eyebrow">404</p>
    <h1 id="nf-title" class="display">${ctx.t('notFound.title')}</h1>
    <p class="lead">${ctx.t('notFound.lead')}</p>
    <p class="cluster">
      <a class="btn btn--on-navy" href="${ctx.link('home')}">${ctx.t('notFound.home')}</a>
      <a class="btn btn--cta btn--on-navy" href="${ctx.ctaHref}"><span>${ctx.t('cta.register')}</span>${ctx.brand.tri()}</a>
    </p>
  </div>
</section>`;
}
