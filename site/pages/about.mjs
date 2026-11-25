// About — "מי אנחנו". One job: why we exist (פה תמיד), where we are going, what we do today, who is behind it.
// One primary action: come to a meeting. Signature motion: the large cropped mark drifting behind "where we're going"
// (DESIGN §3.5 — once on home, once here). Owner content (founding story, first-center rendering, team, a real photo)
// renders only when it exists in content/org.json; preview builds show dashed boxes in its place.
import { html } from '../lib/html.mjs';
import { tx, txs, action, pageHref, corner, ownerImg, personPhoto, H1 } from './_g.mjs';

export const slug = { he: 'about', en: 'about' };

export function render(ctx) {
  const { t, org } = ctx;
  const teamHref = pageHref(ctx, 'team');
  const hasStory = ctx.has(org.story);
  const team = Array.isArray(org.team) ? org.team.slice(0, 4) : [];

  // grounds: navy → beige → navy → beige-light → navy → (beige-light story) → beige → navy, footer navy-deep
  const hero = html`
<section class="chapter about-hero" data-ground="navy" aria-labelledby="about-h1">
  <div class="wrap about-hero__grid">
    <h1 id="about-h1" class="${H1} about-hero__title" data-load>${t('about.hero.title')}</h1>
    <div class="about-hero__text">
      <p class="t-lead" data-load="1">${t('about.hero.body')}</p>
      <div class="cluster about-hero__actions" data-load="2">
        ${action(ctx, { href: ctx.ctaHref, label: t('cta.register') })}
        ${action(ctx, { href: teamHref, label: t('about.hero.secondary'), className: 'link' })}
      </div>
    </div>
    <div class="about-hero__media">
      <div class="about-hero__frame" data-load="wipe">
        <figure class="photo focus-30 about-hero__photo">
          ${ctx.has(org.aboutPhoto)
            ? ownerImg(ctx, org.aboutPhoto, { alt: ctx.l(org.aboutPhotoAlt) ?? '', sizes: '(min-width: 64rem) 50vw, 100vw' })
            : ctx.img('walk', { eager: true, sizes: '(min-width: 64rem) 50vw, 100vw' })}
        </figure>
        <div class="about-hero__stripes" aria-hidden="true">${ctx.brand.stripes({ width: 240, height: 150, unit: 22, dir: 'cut', anchor: 'bs', count: 3 })}</div>
      </div>
      ${ctx.has(org.aboutPhoto) ? '' : ctx.slot(null, t('about.slots.photo'), () => '', { className: 'about-hero__slot' })}
    </div>
  </div>
</section>`;

  const why = html`
<section class="chapter about-why" data-ground="beige" aria-labelledby="about-why">
  ${corner(ctx, { pos: 'te' })}
  <div class="wrap about-why__grid">
    <h2 id="about-why" class="about-why__title" ${ctx.reveal('up')}>${t('about.why.title')}</h2>
    <div class="about-why__body" data-reveal-group>
      ${ctx.list('about.why.body').map((p) => html`<p class="t-lead" data-reveal="up">${txs(ctx, p)}</p>`)}
    </div>
    <div class="about-name" ${ctx.reveal('up')}>
      <h3 class="t-title">${t('about.name.title')}</h3>
      <p class="t-body">${tx(ctx, 'about.name.body')}</p>
    </div>
  </div>
</section>`;

  const direction = html`
<section class="chapter about-direction" data-ground="navy" aria-labelledby="about-direction">
  <div class="wrap about-direction__grid">
    <h2 id="about-direction" class="t-chapter about-direction__title" ${ctx.reveal('up')}>${t('about.direction.title')}</h2>
    <div class="stack about-direction__body" data-reveal-group>
      ${ctx.list('about.direction.body').map((p) => html`<p class="t-lead" data-reveal="up">${p}</p>`)}
    </div>
    <div class="about-centers">
      <h3 class="t-title about-centers__title" ${ctx.reveal('up')}>${t('about.direction.centersTitle')}</h3>
      <ol class="about-centers__list" role="list" data-reveal-group>
        ${ctx.list('about.direction.centers').map((c) => html`<li data-reveal="up"><h4 class="about-centers__name">${c.title}</h4><p class="t-body quiet">${c.body}</p></li>`)}
      </ol>
      <p class="t-lead about-direction__start" ${ctx.reveal('up')}>${t('about.direction.start')}</p>
    </div>
    ${ctx.slot(
      org.firstCenter?.image,
      t('about.slots.rendering'),
      () => html`<figure class="about-direction__center" ${ctx.reveal('fade')}>
        <div class="photo">${ownerImg(ctx, org.firstCenter.image, { alt: ctx.l(org.firstCenter.alt) ?? '', sizes: '(min-width: 82.5rem) 1320px, 100vw' })}</div>
        <figcaption class="t-small quiet">${ctx.l(org.firstCenter.caption) || t('about.direction.renderingCaption')}</figcaption>
      </figure>`,
      { className: 'about-direction__center about-direction__center--slot' },
    )}
  </div>
</section>`;

  const today = html`
<section class="chapter about-today" data-ground="beige-light" aria-labelledby="about-today">
  ${corner(ctx, { pos: 'ts', dir: 'rise' })}
  <div class="wrap about-today__grid">
    <div class="about-today__main">
      <div class="head" ${ctx.reveal('up')}>
        <h2 id="about-today" class="t-chapter">${t('about.today.title')}</h2>
        <p class="t-lead">${t('about.today.lead')}</p>
      </div>
      ${ctx.ui.rows(
        ctx.list('about.today.items').map((it) => ({
          title: it.title,
          body: it.body,
          href: pageHref(ctx, it.page, 'calendar') ?? ctx.ctaHref,
          go: html`<span class="about-row__cta">${it.cta}</span>`,
        })),
        { level: 3, className: 'about-rows' },
      )}
    </div>
    <figure class="photo r-45 about-today__photo" ${ctx.reveal('fade')}>${ctx.img('training', { sizes: '(min-width: 64rem) 35vw, 100vw' })}</figure>
  </div>
</section>`;

  const principles = html`
<section class="chapter about-principles" data-ground="navy" aria-labelledby="about-principles">
  ${corner(ctx, { pos: 'be' })}
  <div class="wrap">
    <h2 id="about-principles" class="t-chapter" ${ctx.reveal('up')}>${t('about.principles.title')}</h2>
    <dl class="about-principles__list" data-reveal-group>
      ${ctx.list('about.principles.items').map(
        (p) => html`<div class="about-principle" data-reveal="up"><dt>${p.title}</dt><dd>${p.body}</dd></div>`,
      )}
    </dl>
  </div>
</section>`;

  const story = hasStory
    ? html`
<section class="chapter about-story" data-ground="beige-light" aria-labelledby="about-story">
  <div class="wrap about-story__grid">
    <div class="stack" ${ctx.reveal('up')}>
      <h2 id="about-story" class="t-chapter">${t('about.story.title')}</h2>
      ${ctx.has(org.founded) ? html`<p class="t-title about-story__year">${t('about.story.founded', { year: org.founded })}</p>` : ''}
    </div>
    <div class="stack about-story__body">${String(ctx.l(org.story)).split(/\n+/).map((p) => html`<p class="t-lead">${p}</p>`)}</div>
  </div>
</section>`
    : ctx.preview
      ? html`
<section class="chapter chapter--tight about-story" data-ground="beige-light" aria-labelledby="about-story">
  <div class="wrap about-story__grid">
    <h2 id="about-story" class="t-chapter">${t('about.story.title')}</h2>
    <div class="stack">${ctx.slot(null, t('about.slots.founded'), () => '')}${ctx.slot(null, t('about.slots.story'), () => '')}</div>
  </div>
</section>`
      : '';

  // with faces (or the preview slot) the text sits beside them; without (production, no team yet) the heading and the
  // text share the width, so the chapter never leaves half the screen empty
  const showFaces = team.length > 0 || ctx.preview;
  // the team page is built only once the association's team is in org.json; until then this chapter points to
  // volunteering (the part of "the people behind it" anyone can join), never to a missing or empty page
  const peopleAct = teamHref
    ? action(ctx, { href: teamHref, label: t('about.people.cta'), className: 'btn btn--ghost' })
    : action(ctx, { href: pageHref(ctx, 'volunteer'), label: t('about.people.volunteer'), className: 'btn btn--ghost' });
  const peopleText = html`<p class="t-lead">${t('about.people.body')}</p>
      ${peopleAct ? html`<div class="cluster">${peopleAct}</div>` : ''}`;
  const people = html`
<section class="chapter about-people" data-ground="beige" aria-labelledby="about-people">
  ${showFaces
    ? html`<div class="wrap about-people__grid">
    <div class="stack" ${ctx.reveal('up')}>
      <h2 id="about-people" class="t-chapter">${t('about.people.title')}</h2>
      ${peopleText}
    </div>
    ${ctx.slot(
      team,
      t('about.slots.team'),
      (list) => html`<ul class="about-faces" role="list" data-reveal-group>
        ${list.map((p) => html`<li data-reveal="up"><figure class="photo r-45 focus-top about-faces__photo">${personPhoto(ctx, p, { sizes: '(min-width: 64rem) 15vw, 45vw' })}</figure><p class="about-faces__name">${ctx.l(p.name)}</p><p class="t-small quiet">${ctx.l(p.role)}</p></li>`)}
      </ul>`,
      { className: 'about-faces--slot' },
    )}
  </div>`
    : html`<div class="wrap about-people__grid about-people__grid--text">
    <h2 id="about-people" class="t-chapter" ${ctx.reveal('up')}>${t('about.people.title')}</h2>
    <div class="stack" ${ctx.reveal('up', 1)}>${peopleText}</div>
  </div>`}
</section>`;

  const closing = html`
<section class="chapter about-closing" data-ground="navy" aria-labelledby="about-closing">
  ${corner(ctx, { pos: 'ts', dir: 'rise' })}
  <div class="wrap cta-band">
    <h2 id="about-closing" class="cta-band__title" ${ctx.reveal('up')}>${t('about.closing.title')}</h2>
    <div class="cluster cta-band__actions" ${ctx.reveal('up', 1)}>
      ${action(ctx, { href: ctx.ctaHref, label: t('cta.register') })}
      ${ctx.pageExists('donate') ? action(ctx, { href: ctx.link('donate'), label: t('about.closing.donate'), className: 'btn btn--ghost' }) : ''}
    </div>
  </div>
</section>`;

  return html`${hero}${why}${direction}${today}${principles}${story}${people}${closing}`;
}

export function jsonld(ctx) {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: ctx.t('about.meta.title'),
    description: ctx.t('about.meta.description'),
    url: ctx.page.alternates[ctx.lang],
    inLanguage: ctx.lang,
  };
}
