// Calendar — every upcoming meeting, live from public_list_events, with filter chips by type. The target of the
// persistent "להרשמה למפגש" button, so the list comes first and the page stays short: hero + how registration works,
// the list, then what happens at each kind of meeting and where to ask.
import { html } from '../lib/html.mjs';

export const slug = { he: 'calendar', en: 'calendar' };

export function render(ctx) {
  const { t } = ctx;
  const rows = [
    ['friday', 'calendar.kinds.friday'],
    ['evenings', 'calendar.kinds.evenings'],
    ['faq', 'calendar.kinds.faq'],
  ].filter(([id]) => ctx.pageExists(id));

  return html`
<section class="chapter cal-hero" data-ground="navy" aria-labelledby="cal-title">
  ${ctx.brand.stripes({ width: 260, height: 140, unit: 20, dir: 'fall', count: 3, className: 'stripes stripes--beige corner corner--te' })}
  <div class="wrap cal-hero__grid">
    <div>
      <h1 id="cal-title" class="t-display cal-hero__title" data-load="1">${t('calendar.hero.title')}</h1>
      <p class="t-lead cal-hero__lead" data-load="2">${t('calendar.hero.lead')}</p>
    </div>
    <aside class="cal-note" aria-labelledby="cal-note-title" data-load="3">
      <h2 id="cal-note-title" class="cal-note__title">${t('calendar.note.title')}</h2>
      <p>${t('calendar.note.body')}</p>
      <p class="quiet">${t('calendar.note.quick')}</p>
    </aside>
  </div>
</section>

<section class="chapter chapter--tight cal-list" data-ground="beige" aria-labelledby="cal-list-title">
  <div class="wrap">
    <h2 id="cal-list-title" class="visually-hidden">${t('calendar.list.title')}</h2>
    ${ctx.events({ type: 'all', limit: 60, filter: true, heading: 3, id: 'cal-events', className: 'cal-events' })}
  </div>
</section>

<section class="chapter cal-kinds" data-ground="beige-light" aria-labelledby="cal-kinds-title">
  <div class="wrap cal-kinds__grid">
    <div class="cal-kinds__head">
      <h2 id="cal-kinds-title" class="t-chapter" data-reveal="up">${t('calendar.kinds.title')}</h2>
      <p class="t-body cal-kinds__ask" data-reveal="up" data-reveal-delay="1">
        <span>${t('calendar.help.title')}</span>
        ${ctx.whatsapp(t('calendar.help.whatsapp'), { className: 'link' })}
      </p>
    </div>
    ${ctx.ui.rows(rows.map(([id, key]) => ({ title: t(`nav.${id}`), body: t(key), href: ctx.link(id) })), { className: 'cal-rows' })}
  </div>
</section>`;
}
