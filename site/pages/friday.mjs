// Friday mornings — the site's first goal: bring new לוחמים ולוחמות to Friday mornings.
// Story (DESIGN.md §8, MOTION.md "Friday"): hero with the live next meeting → the three promises in the CEO's order
// (signature: sticky panels that stack) → "ככה נראה הבוקר" timeline → coming alone + practical facts → for whom
// (+ participant quotes when the owner sends them) → live upcoming dates → approved FAQ → closing ask + share.
import { html } from '../lib/html.mjs';

export const slug = { he: 'friday', en: 'friday' };

/** The phone CTA bar follows the next Friday meeting and says what happens next (DESIGN.md §6). */
export const ctaBar = { type: 'friday', pay: true, label: 'friday.hero.cta' };

/** A run of three stripes entering a chapter from a corner (DESIGN.md §3.1). */
const corner = (ctx, pos, { dir = 'fall', tone = 'beige' } = {}) =>
  ctx.brand.stripes({ width: 260, height: 140, unit: 20, dir, count: 3, className: `stripes stripes--${tone} corner corner--${pos}` });

export function render(ctx) {
  const { t, org } = ctx;
  const tri = () => ctx.brand.tri();
  // stripes cut the corner they sit in: "\" for the top-right corner, "/" for the top-left, in either reading direction
  const cut = (pos) => ((pos[1] === 's') === (ctx.dir === 'rtl') ? 'fall' : 'rise');
  const shareUrl = ctx.abs(ctx.page.url);
  const waShare = `https://wa.me/?text=${encodeURIComponent(`${t('friday.closing.shareMessage')}\n${shareUrl}`)}`;
  const program = ctx.list('friday.program.items');
  const emphasis = ctx.list('friday.emphasis.items');

  // one real fact beside each promise: the morning's structure · the next three Fridays (live) · a photo
  const promiseFact = [
    html`<div class="fr-promise__fact fr-glance" data-reveal="up" data-reveal-delay="2">
      <h4 class="fr-promise__factTitle">${t('friday.emphasis.glanceTitle')}</h4>
      <ol class="fr-glance__list" role="list">${program.map((s) => html`<li><span class="fr-glance__time">${s.time}</span><span class="fr-glance__what">${s.title}</span></li>`)}</ol>
    </div>`,
    html`<div class="fr-promise__fact fr-next3" data-reveal="up" data-reveal-delay="2">
      <h4 class="fr-promise__factTitle">${t('friday.emphasis.datesTitle')}</h4>
      ${ctx.events({ type: 'friday', limit: 3, heading: 5, id: 'fr-next3', stack: true, more: false, className: 'fr-next3__events' })}
    </div>`,
    html`<figure class="photo fr-promise__photo" data-reveal="fade" data-reveal-delay="2">${ctx.img('training', { sizes: '(min-width: 64rem) 34vw, 100vw' })}</figure>`,
  ];

  return html`
<section class="chapter fr-hero" data-ground="beige" aria-labelledby="fr-title">
  <div class="wrap fr-hero__grid">
    <div class="fr-hero__text">
      <h1 id="fr-title" class="t-display" data-load="1">${t('friday.hero.title')}</h1>
      <p class="t-lead fr-hero__lead" data-load="2">${t('friday.hero.lead')}</p>
      <div class="fr-hero__next" data-load="3">${ctx.nextMeeting({
        type: 'friday',
        pay: true,
        label: t('friday.hero.nextTitle'),
        title: t('friday.hero.nextTitleStatic'),
        body: t('friday.hero.nextBodyStatic'),
        cta: t('friday.hero.cta'),
        more: { href: '#dates', label: t('friday.hero.allDates') },
        className: 'fr-next',
      })}</div>
      <p class="t-small quiet fr-hero__quick" data-load="4">${t('friday.hero.quick')}</p>
    </div>
    <div class="fr-hero__media">
      <figure class="photo r-45 fr-hero__photo" data-load="wipe">${ctx.img('running', { eager: true, alt: '', sizes: '(min-width: 64rem) 40vw, 100vw' })}</figure>
      ${ctx.brand.stripes({ width: 220, height: 150, unit: 20, dir: cut('ts'), count: 3, className: 'stripes fr-hero__stripes', anchor: 'ts' })}
    </div>
  </div>
</section>

<section class="fr-promises" data-ground="navy" aria-labelledby="fr-promises-title">
  <h2 id="fr-promises-title" class="visually-hidden">${t('friday.emphasis.title')}</h2>
  ${emphasis.map(
    (p, i) => html`<div class="fr-promise fr-promise--${i + 1}">
    ${i === 0 ? ctx.brand.stripes({ width: 300, height: 420, unit: 34, dir: cut('te'), count: 3, className: 'stripes stripes--beige fr-promise__stripes', anchor: 'te' }) : ''}
    <div class="wrap fr-promise__in">
      <div class="fr-promise__text">
        <h3 class="fr-promise__title" data-reveal="up">${p.lines.map((l) => html`<span>${l}</span>`)}</h3>
        <p class="fr-promise__body" data-reveal="up" data-reveal-delay="1">${p.body}</p>
      </div>
      ${promiseFact[i] ?? ''}
    </div>
  </div>`,
  )}
</section>

<section class="chapter fr-morning" data-ground="beige" aria-labelledby="fr-morning-title">
  <div class="wrap">
    <h2 id="fr-morning-title" class="t-chapter" data-reveal="up">${t('friday.program.title')}</h2>
    <div class="fr-morning__grid">
      <div class="fr-morning__steps">
        <div class="timeline">
          <span class="timeline__fill" aria-hidden="true"></span>
          <ol class="timeline__list" role="list">
            ${program.map(
              (s, i) => html`<li class="timeline__step" data-step="${i + 1}" data-reveal="up">
              <span class="timeline__time">${s.time}</span>
              <h3 class="timeline__title">${s.title}</h3>
              <p class="timeline__body">${s.detail}</p>
            </li>`,
            )}
          </ol>
        </div>
        <p class="t-small quiet fr-morning__note">${t('friday.program.note')}</p>
      </div>
      <div class="fr-morning__media" aria-hidden="true">
        <figure class="photo fr-morning__photo" data-follow=".fr-morning .timeline__step">
          ${ctx.img('training', { alt: '', className: 'fr-morning__img fr-morning__img--1', 'data-step': '1', sizes: '(min-width: 64rem) 42vw, 100vw' })}
          ${ctx.img('talk', { alt: '', className: 'fr-morning__img fr-morning__img--2', 'data-step': '2', sizes: '(min-width: 64rem) 42vw, 100vw' })}
          ${ctx.img('talk', { alt: '', className: 'fr-morning__img fr-morning__img--3', 'data-step': '3', sizes: '(min-width: 64rem) 42vw, 100vw' })}
        </figure>
      </div>
    </div>
    ${ctx.slot(org.photos, t('friday.photos.slot'), (items) => html`<div class="fr-gallery">
      <h3 class="t-title">${t('friday.photos.title')}</h3>
      <ul class="fr-gallery__list" role="list">${items.slice(0, 6).map((p) => html`<li><figure class="photo r-32"><img src="${ctx.asset(p.file)}" alt="${ctx.l(p.alt) ?? ''}" loading="lazy" decoding="async" width="${p.width ?? 1200}" height="${p.height ?? 800}"></figure></li>`)}</ul>
    </div>`, { className: 'fr-gallery' })}
  </div>
</section>

<section class="chapter fr-welcome" data-ground="beige-light" aria-labelledby="fr-welcome-title">
  <div class="wrap fr-welcome__grid">
    <div class="fr-welcome__text">
      <h2 id="fr-welcome-title" class="t-chapter" data-reveal="up">${t('friday.welcome.title')}</h2>
      <p class="t-lead fr-welcome__lead" data-reveal="up" data-reveal-delay="1">${t('friday.welcome.lead')}</p>
      <h3 class="fr-facts__title" data-reveal="up">${t('friday.welcome.listTitle')}</h3>
      <ul class="fr-facts" role="list" data-reveal="group">
        ${ctx.list('friday.welcome.items').map((f) => html`<li class="card"><strong class="card__title">${f.title}</strong><span>${f.body}</span></li>`)}
        ${ctx.slot(t('friday.welcome.parking'), t('friday.welcome.parkingSlot'), (v) => html`<li class="card"><strong class="card__title">${t('friday.welcome.parkingTitle')}</strong><span>${v}</span></li>`, { tag: 'li' })}
      </ul>
    </div>
    <figure class="photo r-45 focus-30 fr-welcome__photo" data-reveal="fade">${ctx.img('walk', { alt: '', sizes: '(min-width: 64rem) 30vw, 100vw' })}</figure>
  </div>
</section>

<section class="chapter fr-forwhom" data-ground="navy" aria-labelledby="fr-forwhom-title">
  ${corner(ctx, 'ts', { dir: 'rise' })}
  <div class="wrap">
    <h2 id="fr-forwhom-title" class="t-chapter" data-reveal="up">${t('friday.forWhom.title')}</h2>
    <ul class="tri-list fr-forwhom__list" role="list" data-reveal="group">
      ${ctx.list('friday.forWhom.items').map((s) => html`<li>${tri()}<span>${s}</span></li>`)}
    </ul>
    ${ctx.slot(org.quotes, t('friday.stories.slot'), (qs) => html`<div class="fr-stories">
      <h3 class="t-title">${t('friday.stories.title')}</h3>
      <div class="fr-stories__list" data-reveal="group">${qs.slice(0, 3).map((q) => html`<figure class="quote"><blockquote><p>${ctx.l(q.text)}</p></blockquote><figcaption>${ctx.l(q.name)}${q.context ? html` · ${ctx.l(q.context)}` : ''}</figcaption></figure>`)}</div>
    </div>`, { className: 'fr-stories' })}
  </div>
</section>

<section class="chapter chapter--tight fr-dates" id="dates" data-ground="beige" aria-labelledby="fr-dates-title">
  <div class="wrap">
    <div class="fr-dates__head">
      <h2 id="fr-dates-title" class="t-chapter" data-reveal="up">${t('friday.dates.title')}</h2>
      <p class="t-body quiet fr-dates__note" data-reveal="up" data-reveal-delay="1">${t('friday.dates.note')}</p>
    </div>
    ${ctx.events({ type: 'friday', limit: 6, heading: 3, id: 'fr-dates', className: 'fr-dates__events' })}
    ${ctx.pageExists('calendar') ? html`<p class="fr-dates__more"><a class="link" href="${ctx.link('calendar')}">${t('friday.dates.calendar')}${tri()}</a></p>` : ''}
  </div>
</section>

<section class="chapter fr-faq" data-ground="beige-light" aria-labelledby="fr-faq-title">
  <div class="wrap fr-faq__grid">
    <div class="fr-faq__head">
      <h2 id="fr-faq-title" class="t-chapter">${t('friday.faq.title')}</h2>
      <p class="t-body">${t('friday.faq.askTitle')} ${ctx.whatsapp(t('friday.faq.ask'), { className: 'link' })}</p>
      ${ctx.pageExists('faq') ? html`<p><a class="link" href="${ctx.link('faq')}">${t('friday.faq.allQuestions')}${tri()}</a></p>` : ''}
    </div>
    <div class="faq fr-faq__list">
      ${ctx.list('friday.faq.groups').map(
        (g) => html`<div class="faq__group">
        <h3 class="faq__group-title">${g.title}</h3>
        <div class="faq__items">
          ${g.items.map(
            (q) => html`<details><summary>${q.q}</summary><div class="faq__answer"><p>${q.a}${q.link ? html` <a class="link" href="${ctx.crm.privacy}">${q.link}</a>` : ''}</p></div></details>`,
          )}
        </div>
      </div>`,
      )}
    </div>
  </div>
</section>

<section class="chapter fr-closing" data-ground="navy" aria-labelledby="fr-closing-title">
  ${corner(ctx, 'ts', { dir: 'rise' })}
  <div class="wrap fr-closing__grid">
    <div class="fr-closing__ask" data-reveal="group">
      <h2 id="fr-closing-title" class="t-chapter">${t('friday.closing.title')}</h2>
      <p><a class="btn" href="#dates"><span>${t('friday.closing.cta')}</span>${tri()}</a></p>
    </div>
    <div class="fr-share" data-reveal="up" data-reveal-delay="2">
      <h3 class="t-title">${t('friday.closing.shareTitle')}</h3>
      <p class="quiet">${t('friday.closing.shareText')}</p>
      <p class="fr-share__actions">
        <a class="btn btn--ghost btn--sm" href="${waShare}" target="_blank" rel="noopener"><span>${t('friday.closing.shareWhatsapp')}</span><span class="visually-hidden"> ${t('friday.a11y.newWindow')}</span></a>
        <button class="btn btn--ghost btn--sm js-only" type="button" data-copy-link="${shareUrl}" data-copied="${t('friday.closing.copied')}"><span data-copy-label aria-live="polite">${t('friday.closing.shareCopy')}</span></button>
      </p>
    </div>
  </div>
</section>`;
}
