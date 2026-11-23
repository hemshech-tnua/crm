// Donate (תרומה). One job: let a private donor, in Israel or abroad, choose a way to give, calmly, with who-we-are and
// transparency beside it. No amounts preselected, no urgency, no guilt; it closes with "לא חייבים לתרום כדי להיות חלק".
// Owner content (payment links, numbers, quotes, team, reports) comes from content/org.json and appears when it exists.
import { html } from '../lib/html.mjs';
import { C, pageHref, waAction, action, giveAction, chapters, corner, own } from './_support.mjs';

export const slug = { he: 'donate', en: 'donate' };
export const bodyClass = 'no-cta-bar';

const k = (key) => `donate.${key}`;

export function render(ctx) {
  const { t, org } = ctx;
  const has = ctx.has;
  const ext = t(k('ways.external'));

  // ── the five giving routes. Each works today (WhatsApp, prefilled per route) and switches to the owner's link.
  const routes = [
    {
      id: 'once',
      title: t(k('ways.oneTime.title')),
      body: t(k('ways.oneTime.body')),
      act: giveAction(ctx, { url: org.donateUrl, cta: t(k('ways.oneTime.cta')), wa: t(k('ways.oneTime.wa')), message: t(k('ways.oneTime.message')), className: C.ghost, external: ext }),
      slot: has(org.donateUrl) ? '' : ctx.slot(null, t(k('slots.oneTimeUrl')), () => '', { tag: 'span' }),
    },
    {
      id: 'monthly',
      title: t(k('ways.monthly.title')),
      body: t(k('ways.monthly.body')),
      act: giveAction(ctx, { url: org.donateMonthlyUrl, cta: t(k('ways.monthly.cta')), wa: t(k('ways.monthly.wa')), message: t(k('ways.monthly.message')), className: C.ghost, external: ext }),
      slot: has(org.donateMonthlyUrl) ? '' : ctx.slot(null, t(k('slots.monthlyUrl')), () => '', { tag: 'span' }),
    },
    {
      id: 'sponsor',
      title: t(k('ways.sponsor.title')),
      body: t(k('ways.sponsor.body')),
      note: has(org.sponsorAmount) ? t(k('ways.sponsor.amount'), { amount: org.sponsorAmount }) : '',
      act: waAction(ctx, { label: t(k('ways.sponsor.wa')), text: t(k('ways.sponsor.message')), className: C.ghost, hint: t(k('ways.waHint')) }),
      slot: has(org.sponsorAmount) ? '' : ctx.slot(null, t(k('slots.sponsorAmount')), () => '', { tag: 'span' }),
    },
    {
      id: 'company',
      title: t(k('ways.company.title')),
      body: t(k('ways.company.body')),
      act: action(ctx, { href: pageHref(ctx, 'partners', 'contact'), label: t(k('ways.company.cta')), className: C.ghost }),
    },
    {
      id: 'abroad',
      title: t(k('ways.abroad.title')),
      body: has(org.abroad?.body) ? own(ctx, org.abroad.body) : t(k('ways.abroad.body')),
      act: giveAction(ctx, { url: org.abroad?.url, cta: t(k('ways.abroad.cta')), wa: t(k('ways.abroad.wa')), message: t(k('ways.abroad.message')), className: C.ghost, external: ext }),
      slot: has(org.abroad?.body) ? '' : ctx.slot(null, t(k('slots.abroad')), () => '', { tag: 'span' }),
    },
  ];

  const taxText = org.section46 === true ? t(k('tax.approved')) : t(k('tax.body'));

  const hero = (g) => html`
<section class="${`${C.chapter} give-hero`}" data-ground="${g}" aria-labelledby="donate-h1">
  ${corner(ctx, 'bs', { dir: 'rise' })}
  <div class="${`${C.wrap} give-hero__grid`}">
    <div class="give-hero__text">
      <h1 id="donate-h1" class="${C.display}">${t(k('hero.title'))}</h1>
      <p class="${`${C.lead} give-hero__lead`}">${t(k('hero.body'))}</p>
      <p class="${`${C.actions} give-hero__actions`}">
        ${action(ctx, { href: '#ways', label: t(k('hero.cta')), className: C.btn })}
        <a class="${C.link}" href="${pageHref(ctx, 'partners', 'contact')}">${t(k('hero.partners'))}${ctx.brand.tri()}</a>
      </p>
    </div>
    <figure class="${`${C.photo} give-hero__photo`}">${ctx.img('bonfire', { eager: true, sizes: '(min-width: 64rem) 40vw, 100vw' })}</figure>
  </div>
</section>`;

  const ways = (g) => html`
<section class="${`${C.chapter} give-ways`}" data-ground="${g}" id="ways" aria-labelledby="ways-h2">
  <div class="${`${C.wrap} give-ways__grid`}">
    <div class="give-ways__head">
      <h2 id="ways-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('ways.title'))}</h2>
      <p class="${C.body}" ${ctx.reveal('up', 1)}>${t(k('ways.body'))}</p>
      <div class="give-tax" ${ctx.reveal('up', 2)}>
        <h3 class="give-tax__title">${t(k('tax.title'))}</h3>
        <p>${taxText}</p>
      </div>
    </div>
    <ol class="give-routes" role="list" data-reveal-group>
      ${routes.map(
        (r) => html`<li class="give-route" id="${`way-${r.id}`}" data-reveal="up">
        <div class="give-route__text">
          <h3 class="${C.title}">${r.title}</h3>
          <p>${r.body}</p>
          ${r.note ? html`<p class="give-route__note">${r.note}</p>` : ''}
          ${r.slot || ''}
        </div>
        <div class="give-route__act">${r.act}</div>
      </li>`,
      )}
    </ol>
    ${ctx.slot(
      org.bank,
      t(k('slots.bank')),
      (b) => html`<div class="give-bank">
      <h3 class="give-tax__title">${t(k('bank.title'))}</h3>
      <dl>
        ${b.bankName ? html`<div><dt>${t(k('bank.bank'))}</dt><dd>${own(ctx, b.bankName)}</dd></div>` : ''}
        ${b.branch ? html`<div><dt>${t(k('bank.branch'))}</dt><dd class="${C.ltr}">${b.branch}</dd></div>` : ''}
        ${b.account ? html`<div><dt>${t(k('bank.account'))}</dt><dd class="${C.ltr}">${b.account}</dd></div>` : ''}
        ${b.accountName ? html`<div><dt>${t(k('bank.name'))}</dt><dd>${own(ctx, b.accountName)}</dd></div>` : ''}
      </dl>
    </div>`,
      { className: 'give-bank' },
    )}
  </div>
</section>`;

  // ── proof: owner numbers, what gifts pay for, and participants' words. Omitted in production until one exists.
  const proofExists = ctx.preview || [org.stats, org.impact, org.quotes].some(has);
  const proof = (g) => html`
<section class="${`${C.chapter} give-proof`}" data-ground="${g}" aria-labelledby="proof-h2">
  ${corner(ctx, 'ts', { dir: 'rise' })}
  <div class="${C.wrap}">
    <h2 id="proof-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('proof.title'))}</h2>
    ${ctx.slot(
      org.stats,
      t(k('slots.stats')),
      (stats) => ctx.ui.stats(stats, { className: 'sp-stats' }),
      { className: 'give-proof__slot' },
    )}
    <div class="give-proof__grid">
      ${ctx.slot(
        org.impact,
        t(k('slots.impact')),
        (items) => html`<div class="give-impact">
        <h3 class="${C.title}">${t(k('proof.impactTitle'))}</h3>
        <ul role="list">${items.map((i) => html`<li>${ctx.brand.tri()}<span>${own(ctx, i.label ?? i)}${i.value ? html` <b class="${C.ltr}">${i.value}</b>` : ''}</span></li>`)}</ul>
      </div>`,
        { className: 'give-proof__slot' },
      )}
      ${ctx.slot(
        org.quotes,
        t(k('slots.quotes')),
        (qs) => html`<div class="give-stories">
        <h3 class="${C.title}">${t(k('proof.storiesTitle'))}</h3>
        ${qs.slice(0, 3).map((q) => ctx.ui.quote(q))}
      </div>`,
        { className: 'give-proof__slot' },
      )}
    </div>
  </div>
</section>`;

  // ── who is behind it + transparency (Section 46 status sits beside the routes, where donors look for it first).
  const people = [...(org.team ?? []), ...(org.board ?? [])];
  const trust = (g) => html`
<section class="${`${C.chapter} give-trust`}" data-ground="${g}" aria-labelledby="trust-h2">
  <div class="${`${C.wrap} give-trust__grid`}">
    <div class="give-trust__who" ${ctx.reveal('up')}>
      <h2 id="trust-h2" class="${C.chapterTitle}">${t(k('trust.title'))}</h2>
      <p class="${C.lead}">${t(k('trust.body'))}</p>
      ${ctx.slot(
        people,
        t(k('slots.team')),
        (list) => html`<ul class="give-people" role="list">${list.slice(0, 8).map((p) => html`<li><b>${own(ctx, p.name)}</b><span class="${C.quiet}">${own(ctx, p.role)}</span></li>`)}</ul>`,
      )}
      <p><a class="${C.link}" href="${pageHref(ctx, 'team', 'about')}">${t(k('trust.cta'))}${ctx.brand.tri()}</a></p>
    </div>
    <div class="give-trust__open" ${ctx.reveal('up', 1)}>
      <h3 class="${C.title}">${t(k('transparency.title'))}</h3>
      ${ctx.slot(org.registrationNumber, t(k('slots.registration')), (n) => html`<p class="give-trust__reg">${t(k('transparency.registration'), { n })}</p>`)}
      ${has(org.reports)
        ? html`<ul class="give-reports" role="list">${org.reports.map((r) => html`<li><a class="${C.link}" href="${ctx.asset(r.file)}">${own(ctx, r.title)} <span class="${C.ltr}">${r.year}</span>${ctx.brand.tri()}</a></li>`)}</ul>`
        : html`<p>${t(k('transparency.body'))}</p>${ctx.slot(null, t(k('slots.reports')), () => '')}`}
    </div>
  </div>
</section>`;

  const closing = (g) => html`
<section class="${`${C.chapter} give-close`}" data-ground="${g}" aria-labelledby="close-h2">
  ${corner(ctx, 'te')}
  <div class="${`${C.wrap} cta-band`}">
    <h2 id="close-h2" class="cta-band__title" ${ctx.reveal('up')}>${t(k('closing.title'))}</h2>
    <div class="stack" ${ctx.reveal('up', 1)}>
      <p class="cta-band__body">${t(k('closing.body'))}</p>
      <p class="${`${C.actions} cta-band__actions`}">
        ${action(ctx, { href: pageHref(ctx, 'volunteer', 'contact'), label: t(k('closing.cta')), className: C.btn })}
        <a class="${C.link}" href="${ctx.crm.join}" rel="noopener">${t(k('closing.propose'))}${ctx.brand.tri()}</a>
      </p>
    </div>
  </div>
</section>`;

  return html`${chapters(
    [
      { render: hero },
      { render: ways },
      { when: proofExists, render: proof },
      { render: trust },
      { render: closing },
    ],
    ['navy', 'beige', 'navy', 'beige-light', 'navy'],
  )}`;
}
