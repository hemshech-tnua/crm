// Volunteer (התנדבות). One job: recruit volunteers, speakers and instructors. The roles are the real ones: the Friday
// welcome team (a WhatsApp message, then a personal link to choose meetings), a guest talk or a workout (the CRM's
// "propose" form, #/join). Signature move: the two "how it works" paths fill as they are read.
import { html } from '../lib/html.mjs';
import { C, pageHref, waAction, action, chapters, corner, waRow, linkRow } from './_support.mjs';

export const slug = { he: 'volunteer', en: 'volunteer' };

const k = (key) => `volunteer.${key}`;

export function render(ctx) {
  const { t } = ctx;
  const message = t(k('ways.message'));
  const toCrm = t(k('ways.toCrm'));
  const items = ctx.list(k('ways.items'));
  // the three roles as the shared row links: the whole row is the action (WhatsApp for the welcome team, the CRM's
  // "propose" form for a talk or a workout)
  const roles = [
    waRow(ctx, { title: items[0]?.title, body: items[0]?.body, label: items[0]?.cta, text: message, hint: t('donate.ways.waHint') }),
    linkRow(ctx, { title: items[1]?.title, body: items[1]?.body, label: items[1]?.cta, href: ctx.crm.join, hint: toCrm, external: true }),
    linkRow(ctx, { title: items[2]?.title, body: items[2]?.body, label: items[2]?.cta, href: ctx.crm.join, hint: toCrm, external: true }),
  ];

  const hero = (g) => html`
<section class="${`${C.chapter} vol-hero`}" data-ground="${g}" aria-labelledby="volunteer-h1">
  <div class="${`${C.wrap} vol-hero__grid`}">
    <div class="vol-hero__text">
      <h1 id="volunteer-h1" class="${C.display}">${t(k('hero.title'))}</h1>
      <p class="${`${C.lead} vol-hero__lead`}">${t(k('hero.body'))}</p>
      <p class="${C.actions}">
        ${waAction(ctx, { label: t(k('hero.cta')), text: message, className: C.btn })}
        <a class="${C.link}" href="${ctx.crm.join}" rel="noopener">${t(k('hero.propose'))}<span class="${C.sr}"> ${toCrm}</span>${ctx.brand.tri()}</a>
      </p>
    </div>
    <div class="vol-hero__media">
      <figure class="${`${C.photo} vol-hero__photo`}">${ctx.img('training', { eager: true, sizes: '(min-width: 64rem) 40vw, 100vw' })}</figure>
      ${corner(ctx, 'tl')}
    </div>
  </div>
</section>`;

  const ways = (g) => html`
<section class="${`${C.chapter} vol-ways`}" data-ground="${g}" aria-labelledby="ways-h2">
  <div class="${C.wrap}">
    <h2 id="ways-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('ways.title'))}</h2>
    ${ctx.ui.rows(roles, { level: 3, className: 'vol-roles' })}
  </div>
</section>`;

  // Signature move: each path's track fills from its first step to its last as it is read (CSS view timeline).
  const path = (key, id) => html`<div class="vol-path" ${ctx.reveal('up')}>
    <h3 class="${C.title}" id="${id}">${t(k(`how.${key}.title`))}</h3>
    <div class="timeline vol-timeline">
      <span class="timeline__fill" aria-hidden="true"></span>
      <ol class="timeline__list" aria-labelledby="${id}">
        ${ctx.list(k(`how.${key}.steps`)).map((s) => html`<li class="timeline__step"><p class="timeline__body">${s}</p></li>`)}
      </ol>
    </div>
  </div>`;

  const how = (g) => html`
<section class="${`${C.chapter} vol-how`}" data-ground="${g}" aria-labelledby="how-h2">
  ${corner(ctx, 'te', { dir: 'fall' })}
  <div class="${C.wrap}">
    <h2 id="how-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('how.title'))}</h2>
    <div class="vol-how__grid">
      ${path('volunteer', 'how-volunteer')}
      ${path('propose', 'how-propose')}
    </div>
  </div>
</section>`;

  const closing = (g) => html`
<section class="${`${C.chapter} vol-close`}" data-ground="${g}" aria-labelledby="close-h2">
  <div class="${`${C.wrap} cta-band`}">
    <h2 id="close-h2" class="cta-band__title" ${ctx.reveal('up')}>${t(k('closing.title'))}</h2>
    <div class="stack" ${ctx.reveal('up', 1)}>
      <p class="cta-band__body">${t(k('closing.body'))}</p>
      <p class="${`${C.actions} cta-band__actions`}">
        ${action(ctx, { href: ctx.ctaHref, label: t(k('closing.cta')), className: C.btn })}
        <a class="${C.link}" href="${pageHref(ctx, 'friday', 'calendar')}">${t(k('closing.friday'))}${ctx.brand.tri()}</a>
      </p>
    </div>
  </div>
</section>`;

  return html`${chapters([{ render: hero }, { render: ways }, { render: how }, { render: closing }], ['navy', 'beige', 'navy', 'beige-light'])}`;
}
