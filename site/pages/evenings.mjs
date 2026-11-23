// Women's evenings and other meetings — what each kind of evening is (only the facts we have; the owner's details
// fill the slots), with the live upcoming meetings of each kind. Women's evenings first (the CEO named them), then
// bonfire evenings, then other meetings. Women's evenings never get a stand-in photo of people: a brand colour field.
import { html } from '../lib/html.mjs';

export const slug = { he: 'evenings', en: 'evenings' };

export function render(ctx) {
  const { t } = ctx;
  const tri = () => ctx.brand.tri();
  const kinds = [
    ['women', 'ev-women'],
    ['bonfire', 'ev-bonfire'],
    ['other', 'ev-other'],
  ];

  return html`
<section class="chapter ev-hero" data-ground="navy" aria-labelledby="ev-title">
  ${ctx.brand.stripes({ width: 260, height: 140, unit: 20, dir: 'fall', count: 3, className: 'stripes stripes--beige corner corner--te' })}
  <div class="wrap ev-hero__grid">
    <div class="ev-hero__text">
      <h1 id="ev-title" class="t-display ev-hero__title" data-load="1">${t('evenings.hero.title')}</h1>
      <p class="t-lead ev-hero__lead" data-load="2">${t('evenings.hero.lead')}</p>
    </div>
    <nav class="ev-index" aria-label="${t('evenings.hero.indexLabel')}" data-load="3">
      <ul class="rows" role="list">
        ${kinds.map(([k, id]) => html`<li><a class="row" href="#${id}"><span class="row__title">${t(`evenings.${k}.name`)}</span>${tri()}</a></li>`)}
      </ul>
    </nav>
  </div>
</section>

<section class="chapter ev-kind ev-women" id="ev-women" data-ground="beige" aria-labelledby="ev-women-title">
  <div class="wrap ev-women__grid">
    <div class="ev-kind__text">
      <h2 id="ev-women-title" class="t-chapter" data-reveal="up">${t('evenings.women.name')}</h2>
      <p class="t-lead ev-kind__lead" data-reveal="up" data-reveal-delay="1">${t('evenings.women.note')}</p>
      ${ctx.slot(t('evenings.women.details'), t('evenings.women.slot'), (v) => html`<p class="t-body ev-kind__body" data-reveal="up" data-reveal-delay="2">${v}</p>`)}
      <p class="ev-kind__cta" data-reveal="up" data-reveal-delay="2"><a class="link" href="#ev-other-list">${t('evenings.women.cta')}${tri()}</a></p>
    </div>
    <div class="ev-women__field" data-reveal="fade">
      ${ctx.ui.corner({ pos: 'te', tone: 'beige', unit: 24 })}
      <p class="ev-women__statement">${t('evenings.women.title')}</p>
    </div>
  </div>
</section>

<section class="chapter ev-kind ev-bonfire" id="ev-bonfire" data-ground="navy" aria-labelledby="ev-bonfire-title">
  <div class="wrap">
    <div class="ev-bonfire__grid">
      <div class="ev-kind__text">
        <h2 id="ev-bonfire-title" class="t-chapter" data-reveal="up">${t('evenings.bonfire.name')}</h2>
        <p class="t-title ev-kind__statement" data-reveal="up" data-reveal-delay="1">${t('evenings.bonfire.title')}</p>
        ${ctx.slot(t('evenings.bonfire.details'), t('evenings.bonfire.slot'), (v) => html`<p class="t-body ev-kind__body" data-reveal="up" data-reveal-delay="2">${v}</p>`)}
      </div>
      <figure class="photo r-32 ev-bonfire__photo" data-reveal="fade">${ctx.img('bonfire', { sizes: '(min-width: 64rem) 58vw, 100vw' })}</figure>
    </div>
    <div class="ev-live" id="ev-bonfire-list">
      <h3 class="t-title" data-reveal="up">${t('evenings.upcoming.bonfire')}</h3>
      ${ctx.events({ type: 'bonfire', limit: 3, heading: 4, id: 'ev-bonfire-events' })}
    </div>
  </div>
</section>

<section class="chapter ev-kind ev-other" id="ev-other" data-ground="beige-light" aria-labelledby="ev-other-title">
  <div class="wrap">
    <div class="ev-other__head">
      <h2 id="ev-other-title" class="t-chapter" data-reveal="up">${t('evenings.other.name')}</h2>
      <div>
        <p class="t-title ev-kind__statement" data-reveal="up" data-reveal-delay="1">${t('evenings.other.title')}</p>
        <p class="t-body ev-kind__body" data-reveal="up" data-reveal-delay="2">${t('evenings.other.body')}</p>
      </div>
    </div>
    <div class="ev-live" id="ev-other-list">
      <h3 class="t-title" data-reveal="up">${t('evenings.upcoming.other')}</h3>
      ${ctx.events({ type: 'other', limit: 6, heading: 4, id: 'ev-other-events' })}
      <p class="t-small quiet ev-live__note">${t('evenings.upcoming.note')}</p>
    </div>
    ${ctx.slot(ctx.org.eveningPhotos, t('evenings.photos.slot'), (items) => html`<div class="ev-gallery">
      <h3 class="t-title">${t('evenings.photos.title')}</h3>
      <ul class="ev-gallery__list" role="list">${items.slice(0, 6).map((p) => html`<li><figure class="photo"><img src="${ctx.asset(p.file)}" alt="${ctx.l(p.alt) ?? ''}" loading="lazy" decoding="async" width="${p.width ?? 1200}" height="${p.height ?? 900}"></figure></li>`)}</ul>
    </div>`, { className: 'ev-gallery' })}
  </div>
</section>

<section class="chapter ev-closing" data-ground="navy" aria-labelledby="ev-closing-title">
  ${ctx.brand.stripes({ width: 260, height: 140, unit: 20, dir: 'rise', count: 3, className: 'stripes stripes--beige corner corner--ts' })}
  <div class="wrap ev-closing__grid">
    <div>
      <h2 id="ev-closing-title" class="t-chapter" data-reveal="up">${t('evenings.closing.title')}</h2>
      <p class="t-lead ev-closing__body" data-reveal="up" data-reveal-delay="1">${t('evenings.closing.body')}</p>
    </div>
    <p class="actions ev-closing__actions" data-reveal="up" data-reveal-delay="2">
      ${ctx.pageExists('friday') ? html`<a class="btn" href="${ctx.link('friday')}"><span>${t('evenings.closing.cta')}</span>${tri()}</a>` : ''}
      ${ctx.pageExists('calendar') ? html`<a class="link" href="${ctx.link('calendar')}">${t('evenings.upcoming.cta')}${tri()}</a>` : ''}
    </p>
  </div>
</section>`;
}
