// Home (the designer's order, 25.11): as clean and inviting as possible, one idea per chapter.
//   1 hero        the headline over one full-bleed photo, one action (the next Friday's registration, live)
//   2 story       the movement and the story we tell, short, to the story page
//   3 band        one action between the story and the founders: the next Friday ("first time? Itai is at the door")
//   4 founders    the two faces, names, one line, to the founders page
//   5 meetings    our meetings in general: Friday mornings, women's evenings, bonfire evenings, to the meetings page
//   6 join        "כל אחד ואחת יכולים להצטרף": one row per audience (kept as it was)
//   7 sponsors    credit to donors and sponsors (org.json sponsors; omitted in production until it has names)
//   8 closing     "נתראה בשישי?" + "באים עם חבר?"
// Every chapter after the hero sits on the calm beige ground (partials/layout.mjs calmGrounds).
import { html } from '../lib/html.mjs';
import { HEADER_CTA } from '../config.mjs';

export const slug = { he: '', en: '' };
export const meta = (ctx) => ({ title: ctx.t('home.meta.title'), description: ctx.t('home.meta.description') });

/** Team A writes links as site paths ("/friday/", "/en/donate/"); map them to page ids so the build checks them. */
const PAGE_OF = (href) => String(href ?? '').replace(/^\/(en\/)?/, '').replace(/\/$/, '') || 'home';
const hrefOf = (ctx, href, fallback = null) => {
  const id = PAGE_OF(href);
  if (id === 'calendar') return ctx.ctaHref;
  return ctx.pageExists(id) ? ctx.link(id) : fallback;
};

/** "להרשמה לשישי הקרוב ◀": the Friday page's dates without data; events.js points it at the next Friday's registration. */
const nextFriday = (ctx, label, cls = '') => {
  const href = ctx.pageExists(HEADER_CTA.page) ? `${ctx.link(HEADER_CTA.page)}#${HEADER_CTA.hash}` : ctx.ctaHref;
  return html`<a class="btn ${cls}" href="${href}" data-next-link="${HEADER_CTA.type}">${label}${ctx.brand.tri()}</a>`;
};

export function render(ctx) {
  const { t, ui, org } = ctx;
  const page = (id) => (ctx.pageExists(id) ? ctx.link(id) : null);

  // ── 1 · hero: headline, photo, one action ──
  const hero = html`
<section class="chapter hero" data-ground="navy" aria-labelledby="home-title">
  <div class="wrap hero__layout">
    <div class="hero__media" data-load="wipe">
      ${ctx.img('highfive', { alt: '', eager: true, sizes: '(min-width: 64rem) 60vw, 100vw', className: 'hero__img' })}
    </div>
    <div class="hero__content">
      <h1 id="home-title" class="t-hero hero__title">${ctx.list('home.hero.title').map((line, i) => html`<span data-load="${i}">${line}</span> `)}</h1>
      <p class="hero__act" data-load="2" data-hero-cta>${nextFriday(ctx, t('home.hero.ctaPrimary'), 'hero__btn')}</p>
    </div>
  </div>
</section>`;

  // ── 2 · the movement and our story ──
  const storyUrl = page('about');
  const story = html`
<section class="chapter story" data-ground="beige" aria-labelledby="story-title">
  <div class="wrap story__grid">
    <div class="story__head" data-reveal="up">
      <h2 id="story-title" class="t-chapter">${t('home.story.title')}</h2>
    </div>
    <div class="stack story__text" data-reveal>
      <p class="t-lead">${t('home.story.lead')}</p>
      ${ctx.list('home.story.body').map((p) => html`<p class="t-body quiet">${p}</p>`)}
      ${storyUrl ? html`<p>${ui.link(t('home.story.cta'), storyUrl)}</p>` : ''}
    </div>
  </div>
</section>`;

  // ── 3 · one action between the story and the founders ──
  const band = html`
<section class="chapter chapter--tight band" data-ground="beige" aria-labelledby="band-title">
  <div class="wrap">
    <div class="band__box" data-ground="navy" data-reveal="up">
      <div class="band__text">
        <h2 id="band-title" class="t-title band__title">${t('home.band.title')}</h2>
        <p class="t-body band__body">${t('home.band.body')}</p>
      </div>
      <p class="band__act">${nextFriday(ctx, t('home.band.cta'))}</p>
    </div>
  </div>
</section>`;

  // ── 4 · the founders, briefly ──
  const pair = (org.team ?? []).filter((m) => m.photo).slice(0, 2);
  const teamUrl = page('team');
  const founders = pair.length ? html`
<section class="chapter founders-ch" data-ground="beige" aria-labelledby="founders-title">
  <div class="wrap founders-ch__grid">
    <div class="founders-ch__head" data-reveal="up">
      <h2 id="founders-title" class="t-chapter">${t('home.founders.title')}</h2>
      <p class="t-lead">${t('home.founders.fact')}</p>
      ${teamUrl ? html`<p class="founders-ch__act">${ui.button(t('home.founders.cta'), teamUrl, { ghost: true })}</p>` : ''}
    </div>
    <ul class="founders-ch__people" role="list" data-reveal-group>
      ${pair.map((m) => html`<li class="person" data-reveal="up">
        <figure class="photo r-45 focus-top person__photo">${ctx.img(m.photo, { alt: '', sizes: '(min-width: 64rem) 22vw, 45vw' })}</figure>
        <p class="person__name">${ctx.l(m.name)}</p>
        <p class="t-small quiet person__role">${ctx.l(m.role)}</p>
      </li>`)}
    </ul>
  </div>
</section>` : '';

  // ── 5 · our meetings, in general ──
  const ev = ctx.list('home.evenings.items');
  const meetingsUrl = page('meetings') ?? ctx.ctaHref;
  const kinds = [
    { title: t('nav.friday'), body: t('sections.desc.friday'), href: page('friday') ?? meetingsUrl, photo: 'coffee' },
    { title: ev[0].title, body: ev[0].body, href: page('evenings') ?? meetingsUrl, icon: 'women' },
    { title: ev[1].title, body: ev[1].body, href: page('evenings') ?? meetingsUrl, photo: 'bonfire' },
  ];
  const meetings = html`
<section class="chapter kinds" data-ground="beige" aria-labelledby="kinds-title">
  <div class="wrap">
    <div class="kinds__head" data-reveal="up">
      <h2 id="kinds-title" class="t-chapter">${t('home.kinds.title')}</h2>
      <p class="t-lead">${t('home.kinds.lead')}</p>
    </div>
    <ul class="types kinds__list" role="list" data-reveal>
      ${kinds.map((k) => html`<li><a class="type" href="${k.href}">${k.photo ? ctx.img(k.photo, { alt: '', sizes: '(min-width: 48rem) 33vw, 100vw', className: 'focus-70' }) : ctx.icon(k.icon, { size: 40, className: 'type__icon' })}<span class="type__title">${k.title}</span><span class="type__body">${k.body}</span></a></li>`)}
    </ul>
    <p class="kinds__act" data-reveal="up">${ui.button(t('home.kinds.cta'), meetingsUrl)}</p>
  </div>
</section>`;

  // ── 6 · join: one row per audience ──
  const joinRows = ctx.list('home.join.items')
    .map((it) => ({ title: it.audience, body: it.body, go: it.cta, href: hrefOf(ctx, it.href) }))
    .filter((r) => r.href);
  const join = html`
<section class="chapter join" data-ground="beige" aria-labelledby="join-title">
  <div class="wrap">
    <div class="join__grid">
      <h2 id="join-title" class="t-chapter join__title" data-reveal="up">${t('home.join.title')}</h2>
      ${ui.rows(joinRows, { level: 3 })}
    </div>
  </div>
</section>`;

  // ── 7 · thank you, donors and sponsors (owner content only) ──
  const sponsors = ctx.preview || ctx.has(org.sponsors) ? html`
<section class="chapter chapter--tight sponsors" data-ground="beige" aria-labelledby="sponsors-title">
  <div class="wrap sponsors__in">
    <div class="sponsors__head" data-reveal="up">
      <h2 id="sponsors-title" class="t-title">${t('home.sponsors.title')}</h2>
      <p class="quiet">${t('home.sponsors.lead')}</p>
    </div>
    ${ctx.slot(org.sponsors, t('home.sponsors.slot'), (list) => ui.logos(list), { className: 'sponsors__logos' })}
  </div>
</section>` : '';

  // ── 8 · closing: see you on Friday, and bring someone ──
  // the shared link says where it came from (ref=wa-share, a channel code the CRM can count once it exists there)
  const fridayUrl = page('friday');
  const shareUrl = ctx.abs(fridayUrl ?? ctx.link('home'));
  const waShare = `https://wa.me/?text=${encodeURIComponent(`${t('whatsapp.share')} ${shareUrl}?ref=wa-share&utm_source=whatsapp&utm_medium=share`)}`;
  const closing = html`
<section class="chapter closing" data-ground="beige" aria-labelledby="closing-title">
  <div class="wrap closing__grid">
    <div class="closing__text">
      <div class="stack" data-reveal>
        <h2 id="closing-title" class="t-display closing__title">${t('home.closing.title')}</h2>
        <div class="cluster">${ui.button(t('home.closing.cta'), ctx.ctaHref)}</div>
      </div>
    </div>
    <div class="closing__share" data-ground="navy" data-reveal>
      ${ctx.icon('friend', { size: 56, className: 'closing__icon' })}
      <h3 class="t-title">${t('home.closing.shareTitle')}</h3>
      <p class="t-lead">${t('home.closing.shareText')}</p>
      <div class="cluster">
        <a class="btn btn--sm" href="${waShare}" rel="noopener" target="_blank">${ctx.icon('whatsapp', { size: 20 })}<span>${t('home.closing.shareWhatsapp')}</span><span class="visually-hidden"> ${t('a11y.whatsappNewWindow')}</span></a>
        <button class="btn btn--ghost btn--sm js-only" type="button" data-copy-link="${shareUrl}" data-copied="${t('home.closing.copied')}"><span data-copy-label aria-live="polite">${t('home.closing.shareCopy')}</span></button>
      </div>
    </div>
  </div>
</section>`;

  return html`${hero}${story}${band}${founders}${meetings}${join}${sponsors}${closing}`;
}
