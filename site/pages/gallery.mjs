// Gallery (תמונות ממפגשים ואירועים): real photos from the meetings and events, from content/org.json `photos`
// ([{ photo: '<photo set name>' | file: 'photos/…', alt: {he,en}, caption?: {he,en} }], with the consent of the people
// in them). Until the association sends some, the page says so plainly and points to its Instagram, where the real
// photos are; the site's illustrative photos are never shown here as if they were from a meeting.
import { html } from '../lib/html.mjs';
import { H1 } from './_g.mjs';

export const slug = { he: 'gallery', en: 'gallery' };
export const meta = (ctx) => ({ title: ctx.t('gallery.meta.title'), description: ctx.t('gallery.meta.description') });

export function render(ctx) {
  const { t, org, ui } = ctx;
  const insta = (org.socials ?? []).find((s) => s.network === 'instagram');
  const back = ctx.pageExists('meetings') ? ctx.link('meetings') : ctx.ctaHref;
  const pic = (p) => (p.photo
    ? ctx.img(p.photo, { alt: ctx.l(p.alt) ?? '', sizes: '(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw' })
    : html`<img src="${ctx.asset(p.file)}" alt="${ctx.l(p.alt) ?? ''}" loading="lazy" decoding="async">`);
  const grid = ctx.slot(org.photos, t('gallery.slot'), (list) => html`<ul class="gallery" role="list">
    ${list.map((p) => html`<li><figure class="photo gallery__item">${pic(p)}${p.caption ? html`<figcaption class="t-small">${ctx.l(p.caption)}</figcaption>` : ''}</figure></li>`)}
  </ul>`);
  const empty = ctx.has(org.photos) ? '' : html`<div class="gallery-empty" data-ground="navy">
    <h2 class="t-title">${t('gallery.empty.title')}</h2>
    <p>${t('gallery.empty.body')}</p>
    ${insta ? html`<p><a class="btn" href="${ctx.safeUrl(insta.url)}" rel="noopener" target="_blank"><span>${t('gallery.empty.instagram')}</span><span class="visually-hidden"> ${t('a11y.newWindow')}</span></a></p>` : ''}
  </div>`;

  return html`
<section class="chapter gl-hero" data-ground="navy" aria-labelledby="gl-h1">
  <div class="wrap">
    <h1 id="gl-h1" class="${H1}" data-load="1">${t('gallery.hero.title')}</h1>
    <p class="t-lead gl-hero__lead" data-load="2">${t('gallery.hero.lead')}</p>
  </div>
</section>

<section class="chapter gl-body" data-ground="beige">
  <div class="wrap stack">
    ${grid}
    ${empty}
    <p>${ui.link(t('gallery.back'), back)}</p>
  </div>
</section>`;
}
