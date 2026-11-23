// Team & board — "צוות והנהלה". One job: show the people behind the association (trust for donors and partners).
// One action: get in touch. People come from content/org.json (team, board, advisors) and render the moment they
// arrive: { name:{he,en}, role:{he,en}, line?:{he,en}, photo?: '<photo set name>' | 'photos/…' }.
// Preview builds show the layout with dashed portraits; production omits every empty group.
import { html } from '../lib/html.mjs';
import { action, pageHref, corner, personPhoto, rhythm } from './_g.mjs';

export const slug = { he: 'team', en: 'team' };

const list = (v) => (Array.isArray(v) ? v.filter((p) => p && p.name) : []);

/** A preview-only skeleton in the real layout, so the board sees how the page fills. */
function skeleton(ctx, n, { portrait = true, label }) {
  return html`<ul class="${portrait ? 'team-grid' : 'team-rows'} team-skeleton" role="list">
    ${Array.from({ length: n }, (_, i) => html`<li class="${portrait ? 'team-person' : 'team-row'}">
      ${portrait ? html`<div class="team-person__photo team-skeleton__photo" data-owner-slot>${i === 0 ? html`<span><strong>${ctx.t('slots.prefix')}:</strong> ${label}</span>` : ''}</div>` : ''}
      <div class="${portrait ? 'team-person__text' : 'team-row__text'}">
        <p class="team-person__name">${ctx.t('team.sample.name')}</p>
        <p class="team-person__role">${ctx.t('team.sample.role')}</p>
        <p class="team-person__line">${ctx.t('team.sample.line')}</p>
      </div>
      ${!portrait && i === 0 ? html`<div class="owner-slot team-row__slot" data-owner-slot><strong>${ctx.t('slots.prefix')}:</strong> ${label}</div>` : ''}
    </li>`)}
  </ul>`;
}

function person(ctx, p) {
  const line = ctx.l(p.line);
  return html`<li class="team-person" data-reveal="up">
    ${ctx.has(p.photo) ? html`<figure class="photo r-45 focus-top team-person__photo">${personPhoto(ctx, p)}</figure>` : html`<div class="team-person__photo team-person__mark" aria-hidden="true">${ctx.brand.logo({ variant: 'symbol' })}</div>`}
    <div class="team-person__text">
      <h3 class="team-person__name">${ctx.l(p.name)}</h3>
      <p class="team-person__role">${ctx.l(p.role)}</p>
      ${ctx.has(line) ? html`<p class="team-person__line">${line}</p>` : ''}
    </div>
  </li>`;
}

function row(ctx, p, tag = 'h3') {
  const line = ctx.l(p.line);
  const name = tag === 'h4' ? html`<h4 class="team-person__name">${ctx.l(p.name)}</h4>` : html`<h3 class="team-person__name">${ctx.l(p.name)}</h3>`;
  return html`<li class="team-row" data-reveal="up">
    ${ctx.has(p.photo) ? html`<figure class="photo r-11 focus-top team-row__photo">${personPhoto(ctx, p, { sizes: '6rem' })}</figure>` : ''}
    <div class="team-row__text">
      ${name}
      <p class="team-person__role">${ctx.l(p.role)}</p>
      ${ctx.has(line) ? html`<p class="team-person__line">${line}</p>` : ''}
    </div>
  </li>`;
}

export function render(ctx) {
  const { t, org } = ctx;
  const members = list(org.team);
  const board = list(org.board);
  const advisors = list(org.advisors);
  const ground = rhythm(1); // the hero is navy; the chapters after it continue the rhythm from beige

  const group = (id, people, { portrait, preview, extra = '' }) => {
    if (!people.length && !ctx.preview && !extra) return '';
    const g = ground();
    const lead = id === 'board' && people.length ? html`<p class="t-lead">${t('team.board.body')}</p>` : '';
    return html`
<section class="chapter team-group team-group--${id}" data-ground="${g}" aria-labelledby="team-${id}">
  <div class="wrap">
    <div class="head head--wide team-group__head" ${ctx.reveal('up')}>
      <h2 id="team-${id}" class="t-chapter">${t(`team.${id}.title`)}</h2>
      ${lead}
    </div>
    ${people.length
      ? html`<ul class="${portrait ? 'team-grid' : 'team-rows'}" role="list" data-reveal-group>${people.map((p) => (portrait ? person(ctx, p) : row(ctx, p)))}</ul>`
      : ctx.preview ? skeleton(ctx, preview, { portrait, label: t(`team.slots.${id}`) }) : ''}
    ${extra}
  </div>
</section>`;
  };

  // board members with photos read better as portraits; without photos (the usual case) as rows
  const boardPortraits = board.length > 0 && board.every((p) => ctx.has(p.photo));

  const advisorsBlock = advisors.length
    ? html`<div class="team-sub"><h3 class="t-title team-sub__title">${t('team.advisors.title')}</h3><ul class="team-rows" role="list" data-reveal-group>${advisors.map((p) => row(ctx, p, 'h4'))}</ul></div>`
    : ctx.slot(null, t('team.slots.advisors'), () => '', { className: 'team-sub team-sub--slot' });

  const sections = [
    group('members', members, { portrait: true, preview: 4 }),
    group('board', board, { portrait: boardPortraits, preview: 2, extra: advisorsBlock }),
  ];

  const volunteersGround = ground();
  const closingGround = ground();
  const volunteerHref = pageHref(ctx, 'volunteer');
  return html`
<section class="chapter team-hero" data-ground="navy" aria-labelledby="team-h1">
  ${corner(ctx, { pos: 'be', dir: 'rise' })}
  <div class="wrap team-hero__grid">
    <h1 id="team-h1" class="team-hero__title" data-load>${t('team.hero.title')}</h1>
    <p class="t-lead" data-load="1">${t('team.hero.body')}</p>
  </div>
</section>
${sections}
<section class="chapter team-volunteers" data-ground="${volunteersGround}" aria-labelledby="team-volunteers">
  ${corner(ctx, { pos: 'te' })}
  <div class="wrap team-volunteers__grid">
    <h2 id="team-volunteers" class="t-chapter" ${ctx.reveal('up')}>${t('team.volunteers.title')}</h2>
    <p class="team-volunteers__body" ${ctx.reveal('up', 1)}>${t('team.volunteers.body')}</p>
    <div class="cluster" ${ctx.reveal('up', 2)}>${action(ctx, { href: volunteerHref, label: t('team.volunteers.cta'), className: 'btn btn--ghost' })}</div>
  </div>
</section>
<section class="chapter team-closing" data-ground="${closingGround}" aria-labelledby="team-closing">
  <div class="wrap cta-band">
    <h2 id="team-closing" class="cta-band__title" ${ctx.reveal('up')}>${t('team.closing.title')}</h2>
    <div class="cluster cta-band__actions" ${ctx.reveal('up', 1)}>
      ${action(ctx, { href: pageHref(ctx, 'contact'), label: t('team.closing.cta') })}
      ${action(ctx, { href: pageHref(ctx, 'about'), label: t('team.closing.secondary'), className: 'link' })}
    </div>
  </div>
</section>`;
}
