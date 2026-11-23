// Shared markup the build hands to page modules through ctx (ctx.events, ctx.slot box).
import { html, attrs } from './html.mjs';

/** True when owner content exists: not null/undefined, not '', not [], not {} (and not { he: '', en: '' }). */
export function present(v) {
  if (v == null || v === false) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v).some(present);
  return true;
}

/** The dashed "תוכן מהעמותה: …" box shown in preview builds where owner content is still missing. */
export function ownerBox(ctx, label, { tag = 'div', className } = {}) {
  const prefix = ctx.lang === 'he' ? html`${ctx.t('slots.prefix')}` : html`<span lang="he">תוכן מהעמותה</span> · ${ctx.t('slots.prefix')}`;
  const T = tag === 'li' ? 'li' : tag === 'span' ? 'span' : 'div';
  return html`<${T} class="${['owner-slot', className].filter(Boolean).join(' ')}" data-owner-slot><strong>${prefix}:</strong> ${label}</${T}>`;
}

/**
 * The live meetings list. The build writes the container with a loading skeleton and a link to the CRM (works without
 * JavaScript too); assets/js/events.js fills it from public_list_events.
 *   type: 'all' | 'friday' | 'bonfire' | 'other'   limit: max cards   filter: show type filter buttons
 *   heading: heading level of each card title (2–4)   id: a stable id when a page has more than one list
 */
export function eventsBlock(ctx, { type = 'all', limit = 6, filter = false, heading = 3, id = 'events', className } = {}) {
  return html`<div${attrs({
    class: ['events', className].filter(Boolean).join(' '),
    id,
    'data-events': type,
    'data-events-limit': limit,
    'data-events-filter': filter || null,
    'data-events-heading': heading,
    'aria-busy': 'true',
  })}>
  <div class="events__filters" data-events-filters hidden></div>
  <ul class="events__list" role="list" data-events-list>
    ${Array.from({ length: Math.min(3, limit) }, () => html`<li class="event-card event-card--skeleton" aria-hidden="true"><span></span><span></span><span></span></li>`)}
  </ul>
  <p class="events__status" role="status" data-events-status><span class="visually-hidden">${ctx.t('events.loading')}</span></p>
  <p class="events__more"><a class="link-arrow" href="${ctx.crm.home}">${ctx.t('events.fallback')}${ctx.brand.tri()}</a></p>
</div>`;
}
