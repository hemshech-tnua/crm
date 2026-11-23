// Partners & companies (שותפויות). One job: start a conversation with a company, organization or foundation.
// Order: the invitation → why us (facts only) → the partnership models (Team A's list, pending the owner's confirmation)
// → partners' logos (owner content) → the conversation itself (email when the owner gives one, WhatsApp today).
import { html } from '../lib/html.mjs';
import { C, pageHref, waAction, action, chapters, corner, own } from './_support.mjs';

export const slug = { he: 'partners', en: 'partners' };

const k = (key) => `partners.${key}`;

export function render(ctx) {
  const { t, org } = ctx;
  const has = ctx.has;
  const email = org.partnersEmail || org.email || '';
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent(t(k('contact.emailSubject')))}` : '';

  /** The one primary action of the page: email when there is an address, WhatsApp (prefilled) until then. */
  const talk = (className) =>
    email
      ? action(ctx, { href: mailto, label: t(k('hero.cta')), className })
      : waAction(ctx, { label: t(k('hero.cta')), text: t(k('contact.message')), className, hint: t('donate.ways.waHint') });

  const hero = (g) => html`
<section class="${`${C.chapter} pt-hero`}" data-ground="${g}" aria-labelledby="partners-h1">
  <div class="${`${C.wrap} pt-hero__grid`}">
    <div class="pt-hero__text">
      <h1 id="partners-h1" class="${C.display}">${t(k('hero.title'))}</h1>
      <p class="${`${C.lead} pt-hero__lead`}">${t(k('hero.body'))}</p>
      <p class="${C.quiet}">${t(k('hero.audience'))}</p>
      <p class="${C.actions}">
        ${talk(C.btn)}
        <a class="${C.link}" href="${pageHref(ctx, 'about')}">${t(k('hero.about'))}${ctx.brand.tri()}</a>
      </p>
    </div>
    <div class="pt-hero__media">
      <figure class="${`${C.photo} pt-hero__photo`}">${ctx.img('talk', { eager: true, sizes: '(min-width: 64rem) 45vw, 100vw' })}</figure>
      ${corner(ctx, 'tl')}
    </div>
  </div>
</section>`;

  // Signature move: a stripe "road" runs under the three reasons and fills from the reading edge as the chapter is read
  // (today's meetings → the direction → together). Static and full without scroll-driven animation support.
  const why = (g) => html`
<section class="${`${C.chapter} pt-why`}" data-ground="${g}" aria-labelledby="why-h2">
  ${corner(ctx, 'te')}
  <div class="${C.wrap}">
    <h2 id="why-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('why.title'))}</h2>
    <div class="pt-why__track">
    <div class="pt-road" aria-hidden="true"><span class="pt-road__fill"></span></div>
    <ul class="pt-why__list" role="list" data-reveal-group>
      ${ctx.list(k('why.items')).map(
        (it) => html`<li class="pt-why__item" data-reveal="up"><h3 class="${C.title}">${it.title}</h3><p class="${C.body}">${it.body}</p></li>`,
      )}
    </ul>
    </div>
    ${ctx.slot(
      org.stats,
      t(k('slots.stats')),
      (stats) => ctx.ui.stats(stats, { className: 'sp-stats' }),
      { className: 'pt-slot' },
    )}
  </div>
</section>`;

  const ways = (g) => html`
<section class="${`${C.chapter} pt-ways`}" data-ground="${g}" aria-labelledby="ways-h2">
  <div class="${`${C.wrap} pt-ways__grid`}">
    <div class="pt-ways__head">
      <h2 id="ways-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('ways.title'))}</h2>
      <p class="${C.lead}" ${ctx.reveal('up', 1)}>${t(k('ways.body'))}</p>
      ${ctx.slot(null, t(k('slots.confirm')), () => '', { className: 'pt-slot' })}
    </div>
    <ul class="pt-models" role="list" data-reveal-group>
      ${ctx.list(k('ways.items')).map(
        (it) => html`<li class="pt-model" data-reveal="up"><h3 class="${C.title}">${it.title}</h3><p>${it.body}</p></li>`,
      )}
    </ul>
  </div>
</section>`;

  const logos = (g) => html`
<section class="${`${C.chapter} pt-logos`}" data-ground="${g}" aria-labelledby="logos-h2">
  <div class="${C.wrap}">
    <h2 id="logos-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('logos.title'))}</h2>
    ${ctx.slot(
      org.partners,
      t(k('slots.logos')),
      (list) => ctx.ui.logos(list, { className: 'pt-logowall' }),
      { className: 'pt-slot pt-slot--logos' },
    )}
  </div>
</section>`;

  const contact = (g) => html`
<section class="${`${C.chapter} pt-talk`}" data-ground="${g}" id="talk" aria-labelledby="talk-h2">
  ${corner(ctx, 'ts', { dir: 'rise' })}
  <div class="${`${C.wrap} pt-talk__grid`}">
    <div ${ctx.reveal('up')}>
      <h2 id="talk-h2" class="${`${C.chapterTitle} pt-talk__title`}">${t(k('contact.title'))}</h2>
      <p class="${C.lead}">${t(k('contact.body'))}</p>
    </div>
    <div class="pt-talk__act" ${ctx.reveal('up', 1)}>
      ${ctx.slot(
        org.partnersContact,
        t(k('slots.person')),
        (p) => html`<p class="pt-person"><b>${own(ctx, p.name)}</b><span class="${C.quiet}">${own(ctx, p.role)}</span></p>`,
      )}
      <p class="${C.actions}">
        ${email ? action(ctx, { href: mailto, label: t(k('contact.ctaEmail')), className: C.btn }) : ''}
        ${waAction(ctx, { label: t(k('contact.ctaWhatsapp')), text: t(k('contact.message')), className: email ? C.ghost : C.btn })}
      </p>
      ${email ? html`<p class="${C.quiet}"><a class="${C.ltr}" href="${mailto}">${email}</a></p>` : ctx.slot(null, t(k('slots.email')), () => '')}
      ${ctx.slot(
        org.partnersDeck,
        t(k('slots.deck')),
        (file) => html`<p><a class="${C.link}" href="${ctx.asset(file)}" download>${t(k('contact.deckCta'))}${ctx.brand.tri()}</a></p>`,
      )}
      <p class="pt-talk__more">
        <a class="${C.link}" href="${pageHref(ctx, 'about')}">${t(k('contact.about'))}${ctx.brand.tri()}</a>
        <a class="${C.link}" href="${pageHref(ctx, 'donate')}">${t(k('contact.donate'))}${ctx.brand.tri()}</a>
      </p>
    </div>
  </div>
</section>`;

  return html`${chapters(
    [
      { render: hero },
      { render: why },
      { when: ctx.preview || has(org.partners), render: logos },
      { render: ways },
      { render: contact },
    ],
    // with logos: beige · navy · beige-light · navy · beige; without: beige · navy · beige-light · navy
    ['beige', 'navy', 'beige-light', 'navy', 'beige'],
  )}`;
}
