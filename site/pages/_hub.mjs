// A section's hub page (config.mjs SECTIONS): h1 = the section's name, its one-line lead, and the section's pages as
// large row links with their one-line descriptions. Meetings adds the live next-Friday card; Support adds "לא חייבים
// לתרום כדי להיות חלק" with the way to the Get-involved hub. The leading "_" keeps the build from treating this file as
// a page (Meetings has no corner stripes: its next-meeting card fills that corner): meetings.mjs, association.mjs, involved.mjs and support.mjs each call hubPage(id).
import { html } from '../lib/html.mjs';
import { SECTIONS } from '../config.mjs';
import { resolveSection } from '../lib/sections.mjs';
import { H1 } from './_g.mjs';

export function hubPage(id) {
  const def = SECTIONS.find((s) => s.id === id);
  if (!def) throw new Error(`pages/_hub.mjs: no section "${id}" in config.mjs SECTIONS`);
  return {
    meta: (ctx) => ({ title: ctx.t(`sections.${id}.meta.title`), description: ctx.t(`sections.${id}.meta.description`) }),
    render(ctx) {
      const s = resolveSection(ctx, def);
      const h1 = `hub-${id}-h1`;
      const next = id === 'meetings'
        ? ctx.nextMeeting({
          type: 'friday',
          pay: true,
          label: ctx.t('home.next.title'),
          title: ctx.t('home.next.fallbackTitle'),
          body: ctx.t('home.next.fallbackBody'),
          cta: ctx.t('home.hero.ctaPrimary'),
          more: ctx.pageExists('calendar') ? { href: ctx.link('calendar'), label: ctx.t('home.next.moreLink') } : null,
        })
        : '';
      const involved = SECTIONS.find((x) => x.id === 'involved');
      const also = id === 'support' && involved && ctx.pageExists(involved.hub)
        ? html`<div class="hub__also" data-reveal="up">
      <p class="t-title">${ctx.t('donate.closing.title')}</p>
      <p class="quiet">${ctx.t('donate.closing.body')}</p>
      ${ctx.ui.link(ctx.t('sections.involved.all'), ctx.link(involved.hub))}
    </div>`
        : '';
      return html`
<section class="chapter hub hub--${id}" data-ground="navy" aria-labelledby="${h1}">
  ${id === 'meetings' ? '' : ctx.ui.corner({ pos: 'te', tone: 'navy-700', accent: true })}
  <div class="wrap hub__grid${next ? ' hub__grid--next' : ''}">
    <div class="hub__head">
      <h1 id="${h1}" class="${H1} hub__title" data-load>${s.label}</h1>
      <p class="t-lead hub__lead" data-load="1">${s.lead}</p>
    </div>
    ${next ? html`<div class="hub__aside" data-load="2">${next}</div>` : ''}
  </div>
</section>

<section class="chapter chapter--tight hub-pages" data-ground="beige" aria-labelledby="hub-${id}-pages">
  <div class="wrap hub-pages__grid">
    <h2 id="hub-${id}-pages" class="visually-hidden">${ctx.t('sections.pagesTitle', { section: s.label })}</h2>
    ${ctx.ui.rows(s.items.map((i) => ({ title: i.label, body: i.desc, href: i.href })), { className: 'hub-pages__rows', level: 3 })}
    ${also}
  </div>
</section>`;
    },
  };
}
