// Friday mornings — the site's first goal: bring new לוחמים ולוחמות to Friday mornings.
// Story (DESIGN.md §8, MOTION.md "Friday", R2): hero ("שלושה בקרים בחודש. באים לבד? איתי מחכה בכניסה." + the fact
// strip, live, + the next meeting + a WhatsApp question) → "פעם ראשונה?" labelled icon answers → the three promises in
// the CEO's order (sticky panels that stack) → "הפעם הראשונה שלך, צעד אחר צעד" (arrival → איתי → workout → coffee →
// lecture; leaving after the workout is fine) → for whom (+ quotes when the owner sends them) → live dates beside
// "אחרי ההרשמה" (details + payment → a reminder two days before → איתי) → FAQ → closing + "באים עם חבר?".
import { html } from '../lib/html.mjs';
import { factStrip, askLine, iconList } from './_facts.mjs';

export const slug = { he: 'friday', en: 'friday' };

/** The phone CTA bar follows the next Friday meeting and says what happens next (DESIGN.md §6). */
export const ctaBar = { type: 'friday', pay: true, label: 'friday.hero.cta' };

export function render(ctx) {
  const { t, org } = ctx;
  const tri = () => ctx.brand.tri();
  const shareUrl = ctx.abs(ctx.page.url);
  // the shared link says where it came from (ref=wa-share: a channel code the CRM counts once it exists there)
  const waShare = `https://wa.me/?text=${encodeURIComponent(`${t('friday.closing.shareMessage')}\n${shareUrl}?ref=wa-share&utm_source=whatsapp&utm_medium=share`)}`;
  const program = ctx.list('friday.program.items');
  const glance = ctx.list('friday.program.glance');
  const emphasis = ctx.list('friday.emphasis.items');

  // one real fact beside each promise: the morning's structure · the next three Fridays (live) · a photo (the path)
  const promiseFact = [
    html`<div class="fr-promise__fact fr-glance" data-reveal="up" data-reveal-delay="2">
      <h4 class="fr-promise__factTitle">${t('friday.emphasis.glanceTitle')}</h4>
      <ol class="fr-glance__list" role="list">${glance.map((s) => html`<li><span class="fr-glance__time">${s.time}</span><span class="fr-glance__what">${s.title}</span></li>`)}</ol>
    </div>`,
    html`<div class="fr-promise__fact fr-next3" data-reveal="up" data-reveal-delay="2">
      <h4 class="fr-promise__factTitle">${t('friday.emphasis.datesTitle')}</h4>
      ${ctx.events({ type: 'friday', limit: 3, heading: 5, id: 'fr-next3', stack: true, more: false, className: 'fr-next3__events' })}
    </div>`,
    html`<figure class="photo fr-promise__photo" data-reveal="fade" data-reveal-delay="2">${ctx.img('hills', { sizes: '(min-width: 64rem) 34vw, 100vw' })}</figure>`,
  ];

  return html`
<section class="chapter fr-hero" data-ground="beige" aria-labelledby="fr-title">
  <div class="wrap fr-hero__grid">
    <div class="fr-hero__text">
      <h1 id="fr-title" class="t-display" data-load="1">${t('friday.hero.title')}</h1>
      <p class="t-lead fr-hero__lead" data-load="2">${t('friday.hero.lead')}</p>
      <p class="fr-hero__who" data-load="2">${t('friday.hero.who')}</p>
      ${factStrip(ctx, { className: 'fr-hero__facts' })}
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
      ${askLine(ctx, { className: 'fr-hero__ask' })}
    </div>
    <div class="fr-hero__media">
      <figure class="photo r-45 fr-hero__photo" data-load="wipe">${ctx.img('training', { eager: true, alt: '', sizes: '(min-width: 64rem) 40vw, 100vw' })}</figure>
      ${ctx.brand.stripes({ width: 220, height: 150, unit: 20, dir: 'cut', count: 3, className: 'stripes fr-hero__stripes', anchor: 'ts' })}
    </div>
  </div>
</section>

<section class="chapter chapter--tight fr-first" data-ground="beige-light" aria-labelledby="fr-first-title">
  <div class="wrap fr-first__grid">
    <h2 id="fr-first-title" class="t-chapter fr-first__title" data-reveal="up">${t('friday.first.title')}</h2>
    ${iconList(ctx, ctx.list('friday.first.items').map((it) => ({ icon: it.icon, title: it.q, body: it.a })), { className: 'fr-first__list' })}
  </div>
</section>

<section class="fr-promises" data-ground="navy" aria-labelledby="fr-promises-title">
  <h2 id="fr-promises-title" class="visually-hidden">${t('friday.emphasis.title')}</h2>
  ${emphasis.map(
    (p, i) => html`<div class="fr-promise fr-promise--${i + 1}">
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
              <span class="timeline__time">${ctx.icon(s.icon, { size: 24, className: 'timeline__icon' })}<span>${s.time}</span></span>
              <h3 class="timeline__title">${s.title}</h3>
              <p class="timeline__body">${s.detail}</p>
            </li>`,
            )}
          </ol>
        </div>
        <p class="fr-morning__note">${ctx.icon('route', { size: 24, className: 'fr-morning__noteIcon' })}<span>${t('friday.program.note')}</span></p>
        ${ctx.slot(t('friday.parking.value'), t('friday.parking.slot'), (v) => html`<p class="t-body fr-morning__parking"><strong>${t('friday.parking.title')}:</strong> ${v}</p>`)}
      </div>
      <div class="fr-morning__media" aria-hidden="true">
        <div class="fr-morning__panel" data-follow=".fr-morning .timeline__step">
          ${program.map((s, i) => html`<div class="fr-morning__slide fr-morning__slide--${i + 1}" data-step="${i + 1}">
            <span class="fr-morning__count">${String(i + 1).padStart(2, '0')}</span>
            <span class="fr-morning__time">${s.time}</span>
            <span class="fr-morning__big">${s.short ?? s.title}</span>
            ${ctx.icon(s.icon, { size: 96, className: 'fr-morning__icon' })}
          </div>`)}
        </div>
      </div>
    </div>
    ${ctx.slot(org.photos, t('friday.photos.slot'), (items) => html`<div class="fr-gallery">
      <h3 class="t-title">${t('friday.photos.title')}</h3>
      <ul class="fr-gallery__list" role="list">${items.slice(0, 6).map((p) => html`<li><figure class="photo r-32"><img src="${ctx.asset(p.file)}" alt="${ctx.l(p.alt) ?? ''}" loading="lazy" decoding="async" width="${p.width ?? 1200}" height="${p.height ?? 800}"></figure></li>`)}</ul>
    </div>`, { className: 'fr-gallery' })}
  </div>
</section>

<section class="chapter fr-forwhom" data-ground="navy" aria-labelledby="fr-forwhom-title">
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
    <div class="fr-dates__grid">
      <div class="fr-dates__main">
        <div class="fr-dates__head">
          <h2 id="fr-dates-title" class="t-chapter" data-reveal="up">${t('friday.dates.title')}</h2>
          <p class="t-body quiet fr-dates__note" data-reveal="up" data-reveal-delay="1">${t('friday.dates.note')}</p>
        </div>
        ${ctx.events({ type: 'friday', limit: 6, heading: 3, id: 'fr-dates', className: 'fr-dates__events' })}
        ${askLine(ctx, { className: 'fr-dates__ask' })}
        ${ctx.pageExists('calendar') ? html`<p class="fr-dates__more"><a class="link" href="${ctx.link('calendar')}">${t('friday.dates.calendar')}${tri()}</a></p>` : ''}
      </div>
      <div class="fr-after" data-ground="navy">
        <h3 class="t-title fr-after__title">${t('friday.after.title')}</h3>
        <ol class="fr-after__list" role="list" data-reveal="group">
          ${ctx.list('friday.after.items').map((it) => html`<li class="fr-after__step">${ctx.icon(it.icon, { size: 32, className: 'fr-after__icon' })}<span class="fr-after__text"><strong>${it.title}</strong><span>${it.body}</span></span></li>`)}
        </ol>
      </div>
    </div>
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
          ${g.items.filter((q) => ctx.has(q.a) || ctx.preview).map(
            (q) => html`<details><summary>${q.q}</summary><div class="faq__answer">${ctx.has(q.a) ? html`<p>${q.a}${q.link ? html` <a class="link" href="${ctx.crm.privacy}">${q.link}</a>` : ''}</p>` : ctx.slot(null, q.slot ?? q.q, () => '')}</div></details>`,
          )}
        </div>
      </div>`,
      )}
    </div>
  </div>
</section>

<section class="chapter fr-closing" data-ground="navy" aria-labelledby="fr-closing-title">
  <div class="wrap fr-closing__grid">
    <div class="fr-closing__ask" data-reveal="group">
      <h2 id="fr-closing-title" class="t-chapter">${t('friday.closing.title')}</h2>
      <p><a class="btn" href="#dates"><span>${t('friday.closing.cta')}</span>${tri()}</a></p>
      ${askLine(ctx, { className: 'fr-closing__q' })}
    </div>
    <div class="fr-share" data-reveal="up" data-reveal-delay="2">
      ${ctx.icon('friend', { size: 48, className: 'fr-share__icon' })}
      <h3 class="t-title">${t('friday.closing.shareTitle')}</h3>
      <p class="quiet">${t('friday.closing.shareText')}</p>
      <p class="fr-share__actions">
        <a class="btn btn--sm" href="${waShare}" target="_blank" rel="noopener">${ctx.icon('whatsapp', { size: 20 })}<span>${t('friday.closing.shareWhatsapp')}</span><span class="visually-hidden"> ${t('friday.a11y.newWindow')}</span></a>
        <button class="btn btn--ghost btn--sm js-only" type="button" data-copy-link="${shareUrl}" data-copied="${t('friday.closing.copied')}"><span data-copy-label aria-live="polite">${t('friday.closing.shareCopy')}</span></button>
      </p>
    </div>
  </div>
</section>`;
}
