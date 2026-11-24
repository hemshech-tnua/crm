// Home: in ten seconds, what המשך תנועה is, what happens there, why it is different and where it is going; then each
// audience is routed to its page. Chapters follow the CEO's order (DESIGN.md §8, Team A's home story):
//   1 hero (navy)            "ללוחמים וללוחמות במילואים ואחרי השירות" · the two-line promise · the Friday facts with the
//                            fact strip (שישי · 09:00 · הולמס פלייס מודיעין · price · איתי, live) · the next FRIDAY card
//                            (its button on the first screen at 390) · the WhatsApp question · the founders' faces
//                            ("שניהם משרתי מילואים פעילים") · the group photo (after the card on phones)
//   2 the four verbs (beige)  לפגוש · לזוז · למצוא כיוון · להצליח — a sticky index follows the block at mid-screen
//   3 פה תמיד (navy)          the difference (also between reserve rounds) and the direction (the centers, with the municipalities); the hills band opens from the reading edge
//   4 Friday (beige-light)   the three promises beside the next live Fridays; the other meeting formats as tiles
//   5 proof (navy)           numbers + participant quotes — owner content, omitted in production until it exists
//   6 join (beige/navy-deep) one row per audience (veterans, companies, donors, volunteers) + the partner logo wall
//   7 closing                "נתראה בשישי?" + "באים עם חבר?" (share; everyone signs up separately)
// The ~15,000 figure lives on donate and partners (R2: lead the veteran with belonging, not with a statistic).
import { html } from '../lib/html.mjs';
import { factStrip, askLine } from './_facts.mjs';

export const slug = { he: '', en: '' };
export const meta = (ctx) => ({ title: ctx.t('home.meta.title'), description: ctx.t('home.meta.description') });

/** Team A writes links as site paths ("/friday/", "/en/donate/"); map them to page ids so the build checks them. */
const PAGE_OF = (href) => String(href ?? '').replace(/^\/(en\/)?/, '').replace(/\/$/, '') || 'home';
const hrefOf = (ctx, href, fallback = null) => {
  const id = PAGE_OF(href);
  if (id === 'calendar') return ctx.ctaHref;
  return ctx.pageExists(id) ? ctx.link(id) : fallback;
};

/** One icon per Friday promise (home.friday.items, in order): no commitment · three a month · every fitness level. */
const PROMISE_ICONS = ['no-commitment', 'calendar-3', 'all-levels'];

export function render(ctx) {
  const { t, ui, org } = ctx;
  const get = (k) => ctx.get(`home.${k}`);
  const hasProof = ctx.preview || ctx.has(org.stats) || ctx.has(org.quotes);
  // the closing chapter is always a light band, so it never runs into the navy footer
  const grounds = hasProof ? { join: 'beige', closing: 'beige-light' } : { join: 'navy-deep', closing: 'beige' };
  const fridayUrl = ctx.pageExists('friday') ? ctx.link('friday') : null;

  // ── 1 · hero ──
  const title = ctx.list('home.hero.title');
  // the founders, beside the action: both are active reservists (org.json team lines; the association's own site)
  const pair = (org.team ?? []).filter((m) => m.photo).slice(0, 2);
  const names = pair.map((m) => String(ctx.l(m.name)).split(' ')[0]).join(t('home.hero.and'));
  const aboutUrl = ctx.pageExists('about') ? ctx.link('about') : null;
  const founders = pair.length === 2 ? html`<div class="founders" data-load="4">
      <ul class="founders__faces" role="list">${pair.map((m) => html`<li>${ctx.img(m.photo, { alt: '', sizes: '64px', className: 'founders__img' })}</li>`)}</ul>
      <p class="founders__text"><strong>${t('home.hero.founders', { names })}</strong> ${t('home.hero.foundersFact')}${aboutUrl ? html` <a class="link" href="${aboutUrl}">${t('home.hero.foundersLink')}${ctx.brand.tri()}</a>` : ''}</p>
    </div>` : '';
  const hero = html`
<section class="chapter hero" data-ground="navy" aria-labelledby="home-title">
  <div class="wrap hero__grid">
    <p class="hero__who" data-load="0">${t('home.hero.eyebrow')}</p>
    <h1 id="home-title" class="t-hero hero__title">${title.map((line, i) => html`<span data-load="${i}">${line}</span> `)}</h1>
    <div class="hero__lead" data-load="2">
      <p class="t-lead">${t('home.hero.body')}</p>
      ${factStrip(ctx, { className: 'hero__facts' })}
    </div>
    <div class="hero__photo" data-load="wipe">
      ${ui.photo('training', { ratio: '4:5', focus: 40, bleed: true, eager: true, sizes: '(min-width: 64rem) 58vw, 100vw' })}
      ${ctx.brand.stripes({ width: 240, height: 140, unit: 22, dir: 'cut', count: 3, anchor: 'te', className: 'stripes stripes--beige hero__stripes' })}
    </div>
    <div class="hero__act">
      <div data-load="3">${ctx.nextMeeting({
        type: 'friday',
        pay: true,
        label: t('home.next.title'),
        title: t('home.next.fallbackTitle'),
        body: t('home.next.fallbackBody'),
        cta: t('home.hero.ctaPrimary'),
        more: { href: hrefOf(ctx, get('next.moreHref'), ctx.crm.home), label: t('home.next.moreLink') },
      })}</div>
      ${askLine(ctx, { className: 'hero__ask' })}
      ${founders}
      ${fridayUrl ? html`<p data-load="4">${ui.link(t('home.hero.ctaSecondary'), fridayUrl)}</p>` : ''}
    </div>
  </div>
</section>`;

  // ── 2 · the four verbs ──
  const verbs = ctx.list('home.what.items').map((it, i) => ({ step: i + 1, ...it }));
  const succeed = get('what.succeed') ?? {};
  const showSucceed = ctx.preview || ctx.has(succeed.body);
  const index = [...verbs.map((v) => v.label), ...(showSucceed ? [succeed.label] : [])];
  const verbsChapter = html`
<section class="chapter verbs" data-ground="beige" aria-labelledby="verbs-title">
  <div class="wrap">
    <div class="head verbs__head" data-reveal>
      <h2 id="verbs-title" class="t-chapter">${t(showSucceed ? 'home.what.title' : 'home.what.titleShown')}</h2>
      <p class="t-lead">${t('home.what.lead')}</p>
    </div>
    <div class="verbs__grid">
      <ol class="verbs__index" role="list" aria-hidden="true" data-follow=".verb">
        ${index.map((v, i) => html`<li data-step="${i + 1}"${i === 0 ? html` data-active` : ''}><span>${v}</span>${ctx.brand.tri()}</li>`)}
      </ol>
      <div class="verbs__list">
        ${verbs.map((v) => html`<article class="verb" data-step="${v.step}" aria-labelledby="verb-${v.step}" data-reveal>
          <h3 id="verb-${v.step}" class="verb__name">${v.label}</h3>
          <div class="verb__field verb__field--${v.step}">
            <span class="verb__num" aria-hidden="true">${String(v.step).padStart(2, '0')}</span>
            <p class="verb__what">${v.title}</p>
            <p class="verb__body">${v.body}</p>
          </div>
        </article>`)}
        ${showSucceed ? html`<article class="verb" data-step="${verbs.length + 1}" aria-labelledby="verb-${verbs.length + 1}" data-reveal>
          <h3 id="verb-${verbs.length + 1}" class="verb__name">${succeed.label}</h3>
          ${ctx.slot(succeed.body, succeed.slot, (b) => html`<div class="verb__text"><p class="t-body">${b}</p></div>`)}
        </article>` : ''}
      </div>
    </div>
  </div>
</section>`;

  // ── 3 · פה תמיד: the difference and the direction (signature: the hills band) ──
  const always = html`
<section class="chapter always" data-ground="navy" aria-labelledby="always-title">
  <div class="wrap">
    <h2 id="always-title" class="t-chapter always__title" data-reveal="up">${t('home.always.title')}</h2>
  </div>
  ${ui.photo('hills', { ratio: '21:9', bleed: true, wipe: true, alt: '', sizes: '100vw', className: 'always__band' })}
  <div class="wrap always__head">
    <div class="stack" data-reveal>
      <p class="t-title">${t('home.always.lead')}</p>
      ${ctx.list('home.always.body').map((p) => html`<p class="t-body quiet">${p}</p>`)}
    </div>
  </div>
  <div class="wrap always__direction">
    <h3 class="t-chapter always__subtitle" data-reveal="up">${t('home.direction.title')}</h3>
    <div class="stack" data-reveal>
      ${ctx.list('home.direction.body').map((p, i) => html`<p class="${i === 0 ? 't-lead' : 't-body quiet'}">${p}</p>`)}
      ${ctx.slot(get('direction.rendering'), t('home.direction.renderingSlot'), (src) => html`<figure class="photo r-169"><img src="${ctx.asset(src)}" alt="${get('direction.renderingAlt') ?? ''}" width="1600" height="900" loading="lazy"></figure>`)}
      ${ctx.pageExists('about') ? html`<p>${ui.link(t('home.direction.cta'), ctx.link('about'))}</p>` : ''}
    </div>
  </div>
</section>`;

  // ── 4 · Friday, the other meetings, the next dates ──
  const evItems = ctx.list('home.evenings.items');
  const eveningsUrl = ctx.pageExists('evenings') ? ctx.link('evenings') : ctx.ctaHref;
  const meetings = html`
<section class="chapter meetings" data-ground="beige-light" aria-labelledby="friday-title">
  <div class="wrap">
    <div class="meetings__friday">
      <div class="meetings__promise">
        <h2 id="friday-title" class="t-chapter" data-reveal="up">${t('home.friday.title')}</h2>
        <ul class="promises" role="list" data-reveal>
          ${ctx.list('home.friday.items').map((p, i) => html`<li><h3 class="promises__title">${ctx.icon(PROMISE_ICONS[i], { size: 32, className: 'promises__icon' })}<span>${p.title}</span></h3><p class="t-body">${p.body}</p></li>`)}
        </ul>
        ${fridayUrl ? html`<div class="cluster" data-reveal="up">${ui.button(t('home.friday.cta'), fridayUrl)}</div>` : ''}
      </div>
      <div class="meetings__dates" data-reveal="up">
        <h3 class="t-title">${t('home.next.upcomingTitle')}</h3>
        ${ctx.events({ type: 'friday', limit: 3, heading: 4, id: 'home-events', stack: true })}
      </div>
    </div>
    <div class="meetings__more">
      <h3 class="t-title" data-reveal="up">${t('home.evenings.title')}</h3>
      <ul class="types" role="list" data-reveal>
        <li><a class="type" href="${eveningsUrl}">${ctx.icon('women', { size: 40, className: 'type__icon' })}<span class="type__title">${evItems[0].title}</span><span class="type__body">${evItems[0].body}</span></a></li>
        <li><a class="type" href="${eveningsUrl}">${ctx.img('bonfire', { alt: '', sizes: '(min-width: 48rem) 33vw, 100vw', className: 'focus-70' })}<span class="type__title">${evItems[1].title}</span><span class="type__body">${evItems[1].body}</span></a></li>
        <li><a class="type type--deep" href="${ctx.ctaHref}">${ctx.icon('calendar-3', { size: 40, className: 'type__icon' })}<span class="type__title">${evItems[2].title}</span><span class="type__body">${evItems[2].body}</span><span class="type__go">${t('events.calendar')}${ctx.brand.tri()}</span></a></li>
      </ul>
    </div>
  </div>
</section>`;

  // ── 5 · proof (owner content only) ──
  const statsBlock = ctx.slot(org.stats, t('home.numbers.slot'), (s) => ui.stats(s));
  const quotesBlock = ctx.slot(org.quotes, t('home.stories.slot'), (qs) => html`<div class="proof__quotes" data-reveal>${qs.slice(0, 2).map((q) => ui.quote(q))}</div>`);
  const hasStats = ctx.preview || ctx.has(org.stats);
  const proof = hasProof ? html`
<section class="chapter proof" data-ground="navy" aria-labelledby="proof-title">
  ${ui.corner({ pos: 'ts', tone: 'navy-700', dir: 'rise' })}
  <div class="wrap">
    <h2 id="proof-title" class="t-chapter" data-reveal="up">${hasStats ? t('home.numbers.title') : t('home.stories.title')}</h2>
    ${hasStats ? html`<div class="proof__stats">${statsBlock}</div>` : ''}
    ${ctx.preview || ctx.has(org.quotes) ? html`<div class="proof__stories">${hasStats ? html`<h3 class="t-title">${t('home.stories.title')}</h3>` : ''}${quotesBlock}</div>` : ''}
  </div>
</section>` : '';

  // ── 6 · join: one row per audience, then the partners ──
  const joinRows = ctx.list('home.join.items')
    .map((it) => ({ title: it.audience, body: it.body, go: it.cta, href: hrefOf(ctx, it.href) }))
    .filter((r) => r.href);
  const join = html`
<section class="chapter join" data-ground="${grounds.join}" aria-labelledby="join-title">
  ${ui.corner({ pos: 'te', tone: grounds.join === 'beige' ? 'beige-400' : 'navy-800' })}
  <div class="wrap">
    <div class="join__grid">
      <h2 id="join-title" class="t-chapter join__title" data-reveal="up">${t('home.join.title')}</h2>
      ${ui.rows(joinRows, { level: 3 })}
    </div>
    ${ctx.slot(org.partners, t('home.partners.slot'), (list) => html`<div class="join__partners"><h3 class="t-title">${t('home.partners.title')}</h3>${ui.logos(list)}</div>`, { className: 'join__partners' })}
  </div>
</section>`;

  // ── 7 · closing: see you on Friday, and bring someone ──
  // the shared link says where it came from (ref=wa-share, a channel code the CRM can count once it exists there)
  const shareUrl = ctx.abs(fridayUrl ?? ctx.link('home'));
  const waShare = `https://wa.me/?text=${encodeURIComponent(`${t('whatsapp.share')} ${shareUrl}?ref=wa-share&utm_source=whatsapp&utm_medium=share`)}`;
  const closing = html`
<section class="chapter closing" data-ground="${grounds.closing}" aria-labelledby="closing-title">
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

  return html`${hero}${verbsChapter}${always}${meetings}${proof}${join}${closing}`;
}
