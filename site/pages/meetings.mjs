// Meetings (מפגשים) — the menu's first page (the designer's IA, 25.11): our meetings in detail and the upcoming dates
// (live from public_list_events), each leading to its registration in the CRM. One chapter each:
//   1 hero      title, lead, the next Friday's live card (registration + payment)
//   2 kinds     Friday mornings, women's evenings, bonfire evenings: what each is, to its own page
//   3 dates     the upcoming meetings of every kind, with the filter chips, and the full calendar
//   4 gallery   photos from meetings and events (its own page)
//   5 ask       a question before signing up: the FAQ and WhatsApp
import { html } from '../lib/html.mjs';
import { H1 } from './_g.mjs';

export const slug = { he: 'meetings', en: 'meetings' };
export const meta = (ctx) => ({ title: ctx.t('meetings.meta.title'), description: ctx.t('meetings.meta.description') });

export function render(ctx) {
  const { t, ui } = ctx;
  const page = (id) => (ctx.pageExists(id) ? ctx.link(id) : null);
  const ev = ctx.list('home.evenings.items');
  const kinds = [
    { title: t('nav.friday'), body: t('sections.desc.friday'), href: page('friday') ?? ctx.ctaHref, photo: 'coffee', go: t('home.friday.cta') },
    { title: ev[0].title, body: ev[0].body, href: page('evenings') ?? ctx.ctaHref, icon: 'women', go: t('home.evenings.cta') },
    { title: ev[1].title, body: ev[1].body, href: page('evenings') ?? ctx.ctaHref, photo: 'bonfire', go: t('home.evenings.cta') },
  ];
  const cal = page('calendar');
  const gallery = page('gallery');
  const faq = page('faq');

  return html`
<section class="chapter mt-hero" data-ground="navy" aria-labelledby="mt-h1">
  <div class="wrap mt-hero__grid">
    <div class="mt-hero__head">
      <h1 id="mt-h1" class="${H1}" data-load="1">${t('meetings.hero.title')}</h1>
      <p class="t-lead mt-hero__lead" data-load="2">${t('meetings.hero.lead')}</p>
    </div>
    <div class="mt-hero__next" data-load="3">${ctx.nextMeeting({
      type: 'friday',
      pay: true,
      label: t('home.next.title'),
      title: t('home.next.fallbackTitle'),
      body: t('home.next.fallbackBody'),
      cta: t('home.hero.ctaPrimary'),
    })}</div>
  </div>
</section>

<section class="chapter mt-kinds" data-ground="beige" aria-labelledby="mt-kinds">
  <div class="wrap">
    <h2 id="mt-kinds" class="t-chapter mt-kinds__title" data-reveal="up">${t('meetings.kinds.title')}</h2>
    <ul class="types" role="list" data-reveal>
      ${kinds.map((k) => html`<li><a class="type" href="${k.href}">${k.photo ? ctx.img(k.photo, { alt: '', sizes: '(min-width: 48rem) 33vw, 100vw', className: 'focus-70' }) : ctx.icon(k.icon, { size: 40, className: 'type__icon' })}<span class="type__title">${k.title}</span><span class="type__body">${k.body}</span><span class="type__go">${k.go}${ctx.brand.tri()}</span></a></li>`)}
    </ul>
  </div>
</section>

<section class="chapter mt-dates" data-ground="beige" id="dates" aria-labelledby="mt-dates">
  <div class="wrap mt-dates__grid">
    <div class="mt-dates__head" data-reveal="up">
      <h2 id="mt-dates" class="t-chapter">${t('meetings.dates.title')}</h2>
      <p class="t-lead">${t('meetings.dates.lead')}</p>
      ${cal ? html`<p>${ui.link(t('meetings.dates.all'), cal)}</p>` : ''}
    </div>
    <div class="mt-dates__list">${ctx.events({ type: 'all', limit: 8, filter: true, heading: 3, id: 'mt-events', stack: true })}</div>
  </div>
</section>

${gallery ? html`<section class="chapter chapter--tight mt-gallery" data-ground="beige" aria-labelledby="mt-gallery">
  <div class="wrap">
    <div class="mt-gallery__card" data-ground="navy" data-reveal="up">
      <div class="mt-gallery__text">
        <h2 id="mt-gallery" class="t-title">${t('meetings.gallery.title')}</h2>
        <p class="mt-gallery__lead">${t('meetings.gallery.lead')}</p>
      </div>
      <p>${ui.button(t('meetings.gallery.cta'), gallery)}</p>
    </div>
  </div>
</section>` : ''}

<section class="chapter chapter--tight mt-ask" data-ground="beige" aria-labelledby="mt-ask">
  <div class="wrap mt-ask__in">
    <h2 id="mt-ask" class="t-title">${t('meetings.ask.title')}</h2>
    <p class="cluster">
      ${faq ? ui.link(t('meetings.ask.faq'), faq) : ''}
      ${ctx.whatsapp(t('calendar.help.whatsapp'), { className: 'link' })}
    </p>
  </div>
</section>`;
}
