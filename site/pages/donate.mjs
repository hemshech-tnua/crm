// Donate (תרומה). One job: let a private donor, in Israel or abroad, choose a way to give, calmly, with who-we-are and
// transparency beside it. No amounts preselected, no urgency, no guilt; it closes with "לא חייבים לתרום כדי להיות חלק".
// Owner content (payment links, numbers, quotes, team, reports) comes from content/org.json and appears when it exists.
import { html } from '../lib/html.mjs';
import { C, pageHref, action, chapters, corner, own, waRow, linkRow, giveRow } from './_support.mjs';

export const slug = { he: 'donate', en: 'donate' };
export const bodyClass = 'no-cta-bar';

const k = (key) => `donate.${key}`;

export function render(ctx) {
  const { t, org } = ctx;
  const has = ctx.has;
  const ext = t(k('ways.external'));

  // ── the five giving routes, as the shared row links (the whole row is the action, ◀ at its end). Each works today
  // (WhatsApp, prefilled per route) and switches to the owner's payment link once org.json has it.
  const routes = [
    giveRow(ctx, { title: t(k('ways.oneTime.title')), body: t(k('ways.oneTime.body')), url: org.donateUrl, cta: t(k('ways.oneTime.cta')), wa: t(k('ways.oneTime.wa')), message: t(k('ways.oneTime.message')), external: ext }),
    giveRow(ctx, { title: t(k('ways.monthly.title')), body: t(k('ways.monthly.body')), url: org.donateMonthlyUrl, cta: t(k('ways.monthly.cta')), wa: t(k('ways.monthly.wa')), message: t(k('ways.monthly.message')), external: ext }),
    waRow(ctx, {
      title: t(k('ways.sponsor.title')),
      body: t(k('ways.sponsor.body')),
      note: has(org.sponsorAmount) ? t(k('ways.sponsor.amount'), { amount: org.sponsorAmount }) : null,
      label: t(k('ways.sponsor.wa')),
      text: t(k('ways.sponsor.message')),
      hint: t(k('ways.waHint')),
    }),
    linkRow(ctx, { title: t(k('ways.company.title')), body: t(k('ways.company.body')), label: t(k('ways.company.cta')), href: pageHref(ctx, 'partners', 'contact') }),
    giveRow(ctx, { title: t(k('ways.abroad.title')), body: has(org.abroad?.body) ? own(ctx, org.abroad.body) : t(k('ways.abroad.body')), url: org.abroad?.url, cta: t(k('ways.abroad.cta')), wa: t(k('ways.abroad.wa')), message: t(k('ways.abroad.message')), external: ext }),
  ];
  // preview only: what the association still has to send for the routes (production renders nothing here)
  const routeSlots = [
    has(org.donateUrl) ? '' : ctx.slot(null, t(k('slots.oneTimeUrl')), () => '', { tag: 'li' }),
    has(org.donateMonthlyUrl) ? '' : ctx.slot(null, t(k('slots.monthlyUrl')), () => '', { tag: 'li' }),
    has(org.sponsorAmount) ? '' : ctx.slot(null, t(k('slots.sponsorAmount')), () => '', { tag: 'li' }),
    has(org.abroad?.body) ? '' : ctx.slot(null, t(k('slots.abroad')), () => '', { tag: 'li' }),
  ].filter((x) => String(x).trim());

  const approved = org.section46 === true;
  const taxTitle = approved ? t(k('tax.titleApproved')) : t(k('tax.title'));
  const taxText = approved ? t(k('tax.approved')) : t(k('tax.body'));

  const hero = (g) => html`
<section class="${`${C.chapter} give-hero`}" data-ground="${g}" aria-labelledby="donate-h1">
  ${corner(ctx, 'bs', { dir: 'rise', accent: true })}
  <div class="${`${C.wrap} give-hero__grid`}">
    <div class="give-hero__text">
      <h1 id="donate-h1" class="${C.display}">${t(k('hero.title'))}</h1>
      <p class="${`${C.lead} give-hero__lead`}">${t(k('hero.body'))}</p>
      ${ctx.ui.stats([ctx.get(k('stat'))], { className: 'give-hero__stat' })}
      <p class="${`${C.actions} give-hero__actions`}">
        ${action(ctx, { href: '#ways', label: t(k('hero.cta')), className: C.btn })}
        <a class="${C.link}" href="${pageHref(ctx, 'partners', 'contact')}">${t(k('hero.partners'))}${ctx.brand.tri()}</a>
      </p>
    </div>
    <figure class="${`${C.photo} give-hero__photo`}">${ctx.img('walk', { eager: true, sizes: '(min-width: 64rem) 40vw, 100vw' })}</figure>
  </div>
</section>`;

  const ways = (g) => html`
<section class="${`${C.chapter} give-ways`}" data-ground="${g}" id="ways" aria-labelledby="ways-h2">
  <div class="${`${C.wrap} give-ways__grid`}">
    <div class="give-ways__head">
      <h2 id="ways-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('ways.title'))}</h2>
      <p class="${C.body}" ${ctx.reveal('up', 1)}>${t(k('ways.body'))}</p>
      <div class="give-tax" ${ctx.reveal('up', 2)}>
        <h3 class="give-tax__title">${taxTitle}</h3>
        <p>${taxText}</p>
      </div>
    </div>
    <div class="give-routes">
      ${ctx.ui.rows(routes, { level: 3, className: 'give-rows' })}
      ${routeSlots.length ? html`<ul class="give-slots" role="list">${routeSlots}</ul>` : ''}
    </div>
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

  // ── who is behind it + transparency. The transparency panel exists only once there is something to show (the
  // registration number or reports); until then a production build leaves it out entirely: no promises on an empty box.
  const people = [...(org.team ?? []), ...(org.board ?? [])];
  const teamPage = ctx.pageExists('team');
  const hasOpen = has(org.registrationNumber) || has(org.reports);
  const showOpen = hasOpen || ctx.preview;
  const trust = (g) => html`
<section class="${`${C.chapter} give-trust`}" data-ground="${g}" aria-labelledby="trust-h2">
  <div class="${`${C.wrap} give-trust__grid${showOpen ? '' : ' give-trust__grid--solo'}`}">
    <div class="give-trust__who" ${ctx.reveal('up')}>
      <h2 id="trust-h2" class="${C.chapterTitle}">${t(k('trust.title'))}</h2>
      <p class="${C.lead}">${t(k('trust.body'))}</p>
      ${ctx.slot(
        people,
        t(k('slots.team')),
        (list) => html`<ul class="give-people" role="list">${list.slice(0, 8).map((p) => html`<li><b>${own(ctx, p.name)}</b><span class="${C.quiet}">${own(ctx, p.role)}</span></li>`)}</ul>`,
      )}
      <p><a class="${C.link}" href="${pageHref(ctx, 'team', 'about')}">${teamPage ? t(k('trust.cta')) : t(k('trust.ctaAbout'))}${ctx.brand.tri()}</a></p>
    </div>
    ${showOpen
      ? html`<div class="give-trust__open" ${ctx.reveal('up', 1)}>
      <h3 class="${C.title}">${t(k('transparency.title'))}</h3>
      ${ctx.slot(org.registrationNumber, t(k('slots.registration')), (n) => html`<p class="give-trust__reg">${t(k('transparency.registration'), { n })}</p>`)}
      ${ctx.slot(
        org.reports,
        t(k('slots.reports')),
        (reports) => html`<ul class="give-reports" role="list">${reports.map((r) => html`<li><a class="${C.link}" href="${ctx.asset(r.file)}">${own(ctx, r.title)} <span class="${C.ltr}">${r.year}</span>${ctx.brand.tri()}</a></li>`)}</ul>`,
      )}
    </div>`
      : ''}
  </div>
</section>`;

  // ── volunteering, on the same page (the menu's "תרומה והתנדבות", 25.11): the three real roles as rows, and the
  // volunteer page for the details. Anchor #volunteer (the former get-involved hub forwards here).
  const vItems = ctx.list('volunteer.ways.items');
  const vMessage = t('volunteer.ways.message');
  const vToCrm = t('volunteer.ways.toCrm');
  const vRoles = [
    waRow(ctx, { title: vItems[0]?.title, body: vItems[0]?.body, label: vItems[0]?.cta, text: vMessage, hint: t(k('ways.waHint')) }),
    linkRow(ctx, { title: vItems[1]?.title, body: vItems[1]?.body, label: vItems[1]?.cta, href: ctx.crm.join, hint: vToCrm, external: true }),
    linkRow(ctx, { title: vItems[2]?.title, body: vItems[2]?.body, label: vItems[2]?.cta, href: ctx.crm.join, hint: vToCrm, external: true }),
  ];
  const volunteer = (g) => html`
<section class="${`${C.chapter} give-volunteer`}" data-ground="${g}" id="volunteer" aria-labelledby="volunteer-h2">
  <div class="${`${C.wrap} give-volunteer__grid`}">
    <div class="give-volunteer__head" ${ctx.reveal('up')}>
      <h2 id="volunteer-h2" class="${C.chapterTitle}">${t(k('volunteer.title'))}</h2>
      <p class="${C.lead}">${t(k('volunteer.lead'))}</p>
      ${ctx.pageExists('volunteer') ? html`<p><a class="${C.link}" href="${ctx.link('volunteer')}">${t(k('volunteer.more'))}${ctx.brand.tri()}</a></p>` : ''}
    </div>
    ${ctx.ui.rows(vRoles, { level: 3, className: 'vol-roles' })}
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
      { render: volunteer },
      { render: closing },
    ],
    ['navy', 'beige', 'navy', 'beige-light', 'beige', 'navy'],
  )}`;
}
