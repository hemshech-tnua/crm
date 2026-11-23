// Home — PLACEHOLDER from the engineering team (Team C). It proves the pipeline and shows every building block a page
// author has: copy via ctx.t / ctx.list, photos via ctx.img, reveal attributes, sticky chapters, the live meetings list,
// owner-content slots and the WhatsApp link. The real home page replaces this file.
import { html } from '../lib/html.mjs';

export const slug = { he: '', en: '' };

// Optional: meta(ctx) → { title, description }. Without it the build uses <id>.meta.title / <id>.meta.description.
export const meta = (ctx) => ({ title: ctx.t('home.meta.title'), description: ctx.t('home.meta.description') });

export function render(ctx) {
  const { t, org } = ctx;
  return html`
<section class="hero section section--navy" aria-labelledby="hero-title">
  ${ctx.brand.stripes({ width: 360, height: 360, unit: 22, className: 'hero__stripes' })}
  <div class="container hero__grid">
    <div class="hero__text">
      <p class="eyebrow">${t('home.hero.eyebrow')}</p>
      <h1 id="hero-title" class="display">${t('home.hero.title')}</h1>
      <p class="lead">${t('home.hero.lead')}</p>
      <p class="cluster"><a class="btn btn--cta btn--on-navy" href="${ctx.ctaHref}"><span>${t('cta.register')}</span>${ctx.brand.tri()}</a></p>
    </div>
    <figure class="hero__media">${ctx.img('training', { eager: true, sizes: '(min-width: 64rem) 50vw, 100vw', className: 'photo' })}</figure>
  </div>
</section>

<section class="section" aria-labelledby="friday-title">
  <div class="container">
    <h2 id="friday-title" ${ctx.reveal('up')}>${t('home.friday.title')}</h2>
    <ul class="grid grid--3 tri-list" role="list" data-reveal-group>
      ${ctx.list('home.friday.points').map((p) => html`<li class="card" data-reveal="up">${ctx.brand.tri()}<span>${p}</span></li>`)}
    </ul>
  </div>
</section>

<section class="section section--beige-deep" aria-labelledby="chapters-title">
  <div class="container chapters" data-chapters>
    <div class="chapters__aside">
      <h2 id="chapters-title" class="chapters__title">${t('home.chapters.title')}</h2>
      <ol class="chapters__nav" role="list">
        ${ctx.list('home.chapters.items').map((c, i) => html`<li><a href="#chapter-${i + 1}" data-chapter-link>${c.title}</a></li>`)}
      </ol>
    </div>
    <div class="chapters__body">
      ${ctx.list('home.chapters.items').map(
        (c, i) => html`<article class="chapter" id="chapter-${i + 1}" data-chapter>
        <figure class="chapter__media" data-reveal="fade">${ctx.img(['running', 'talk', 'bonfire'][i % 3], { sizes: '(min-width: 64rem) 40vw, 100vw', className: 'photo' })}</figure>
        <h3 data-reveal="up">${c.title}</h3>
        <p data-reveal="up" data-reveal-delay="1">${c.text}</p>
      </article>`,
      )}
    </div>
  </div>
</section>

<section class="section" aria-labelledby="events-title">
  <div class="container">
    <h2 id="events-title" ${ctx.reveal('up')}>${t('home.events.title')}</h2>
    ${ctx.events({ type: 'all', limit: 6, filter: true, heading: 3 })}
  </div>
</section>

<section class="section section--navy parallax-host" aria-labelledby="owner-title">
  ${ctx.brand.stripes({ width: 240, height: 240, unit: 18, dir: 'rise', className: 'corner-stripes', })}
  <div class="container stack">
    <h2 id="owner-title">${t('home.owner.title')}</h2>
    ${ctx.slot(org.stats, t('slots.stats'), (stats) => html`<dl class="stats">${stats.map((s) => html`<div><dt>${ctx.l(s.label)}</dt><dd>${s.value}</dd></div>`)}</dl>`)}
    ${ctx.slot(org.partners, t('slots.partners'), (list) => html`<ul class="logos" role="list">${list.map((p) => html`<li><img src="${ctx.asset(p.logo)}" alt="${ctx.l(p.name)}" loading="lazy"></li>`)}</ul>`)}
    ${ctx.slot(org.quotes, t('slots.quotes'), (list) => list.map((q) => html`<blockquote class="quote"><p>${ctx.l(q.text)}</p><footer>${ctx.l(q.name)}</footer></blockquote>`))}
    <p>${ctx.whatsapp(t('footer.whatsapp'), { className: 'btn btn--on-navy' })}</p>
  </div>
</section>

<section class="section" aria-label="${t('photos.hills')}">
  <div class="container">
    <figure class="wide-photo" data-parallax>${ctx.img('hills', { sizes: '100vw', className: 'photo' })}</figure>
  </div>
</section>`;
}
