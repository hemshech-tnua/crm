// Shared markup the build hands to page modules through ctx: ctx.events, ctx.slot's preview box, ctx.nextMeeting and
// the ctx.ui.* building blocks (photo frame, corner stripes, the big mark, FAQ, timeline, stats, quotes, logo wall, row
// links, CTA band). Every block is styled in assets/css/components.css and reads the chapter's data-ground.
import { html, attrs, raw, cx } from './html.mjs';

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
  return html`<${T} class="${cx('owner-slot', className)}" data-owner-slot><strong>${prefix}:</strong> ${label}</${T}>`;
}

/**
 * The live meetings list. The build writes the container with a loading skeleton and a link to the CRM (works without
 * JavaScript too); assets/js/events.js fills it from public_list_events with .meet cards (one link per card).
 *   type: 'all' | 'friday' | 'bonfire' | 'other' | 'women'   limit: max cards   filter: show type filter buttons
 *     'women' = the women's evenings among the CRM's "other" meetings (events.js isWomensEvening: the title or activity
 *     says נשים / לוחמות / women); 'other' keeps every "other" meeting, women's evenings included.
 *   heading: heading level of each card title (2–4)   id: a stable id when a page has more than one list
 *   stack: one card per row at every width   more: false to drop the "all meetings in the registration system" link
 *   empty: { title, body } the empty state for this list (default: copy events.emptyTitle / events.emptyBody)
 */
export function eventsBlock(ctx, { type = 'all', limit = 6, filter = false, heading = 3, id = 'events', className, stack = false, more = true, empty } = {}) {
  return html`<div${attrs({
    class: cx('events', stack && 'events--stack', className),
    id,
    tabindex: '-1',
    'data-events': type,
    'data-events-limit': limit,
    'data-events-filter': filter || null,
    'data-events-heading': heading,
    'data-events-empty-title': empty?.title ?? null,
    'data-events-empty-body': empty?.body ?? null,
    'aria-busy': 'true',
  })}>
  <div class="events__filters" data-events-filters hidden></div>
  <ul class="events__list" role="list" data-events-list>
    ${Array.from({ length: Math.min(3, limit) }, () => html`<li class="event-card event-card--skeleton" aria-hidden="true"><span class="meet"><span class="meet__date"></span><span class="meet__body"><span></span><span></span><span></span></span></span></li>`)}
  </ul>
  <p class="events__status" role="status" data-events-status><span class="visually-hidden">${ctx.t('events.loading')}</span></p>
  ${more ? html`<p class="events__more"><a class="link" href="${ctx.crm.home}">${ctx.t('events.fallback')}${ctx.brand.tri()}</a></p>` : ''}
</div>`;
}

/**
 * The live "next meeting" card (hero of home, Friday). Static text first (no JS: it links to the calendar); events.js
 * swaps in the soonest open meeting of `type`, its date, time, place, availability and a registration link.
 *   type: 'friday' (default: the CEO's first goal) | 'all' | 'bonfire' | 'other' | 'women'
 *   label/title/body: copy shown before the data arrives   cta: button label (copy)
 *   more: { href, label } a secondary link   heroCta: mark the button as the page's CTA (the phone bar appears after it)
 */
export function nextMeeting(ctx, { type = 'friday', label, title, body, cta, more, heroCta = true, className, pay = false } = {}) {
  return html`<div${attrs({ class: cx('next', className), 'data-next': type, 'data-next-pay': pay || null, 'aria-busy': 'true', 'aria-live': 'polite' })}>
  <p class="next__label" data-next-label>${label ?? ctx.t('events.nextLabel')}</p>
  <p class="next__when" data-next-when><span>${title}</span></p>
  <p class="next__what" data-next-what>${body}</p>
  <p class="next__status" data-next-status></p>
  <div class="cluster">
    <a${attrs({ class: 'btn', href: ctx.ctaHref, 'data-next-cta': true, 'data-hero-cta': heroCta || null })}><span data-next-cta-label>${cta ?? ctx.t('cta.register')}</span>${ctx.brand.tri()}</a>
    ${more ? html`<a class="link" href="${more.href}">${more.label}</a>` : ''}
  </div>
</div>`;
}

/**
 * The phone CTA bar (layout adds it to every page except those that opt out with `export const ctaBar = false`).
 * Default: the next Friday morning (registration + payment). A page about other meetings asks for { type: 'all' }.
 * Filled live with the meeting's kind on the first line and "שישי 27.11 · 09:00" on the second.
 */
export function ctaBar(ctx, { type = 'friday', label, pay = type === 'friday' } = {}) {
  return html`<div class="cta-bar" data-ground="navy" data-cta-bar data-next="${type}"${pay ? html` data-next-pay` : ''} role="region" aria-label="${ctx.t('cta.barAria')}">
  <p class="cta-bar__text"><b data-next-label>${ctx.t(type === 'friday' ? 'cta.barTitleFriday' : 'cta.barTitle')}</b><span data-next-when></span></p>
  <a class="btn btn--sm" href="${ctx.ctaHref}" data-next-cta><span data-next-cta-label>${label ?? ctx.t('cta.registerShort')}</span>${ctx.brand.tri()}</a>
</div>`;
}

// ───────────── ctx.ui ─────────────

const RATIO = { '4:5': 'r-45', '3:2': 'r-32', '4:3': 'r-43', '16:9': 'r-169', '21:9': 'r-219', '1:1': 'r-11', '16:10': 'r-1610' };
const FOCUS = { top: 'focus-top', 30: 'focus-30', 40: 'focus-40', 70: 'focus-70', bottom: 'focus-bottom' };

export function ui(ctx) {
  const tri = () => ctx.brand.tri();
  const H = (level, cls, content, extra = {}) => {
    const n = Math.min(6, Math.max(2, Number(level) || 3));
    return html`<h${n}${attrs({ class: cls, ...extra })}>${content}</h${n}>`;
  };
  return {
    /**
     * A framed photo: <figure class="photo r-32">…</figure>.
     *   ratio '4:5'|'3:2'|'4:3'|'16:9'|'21:9'|'1:1'|'16:10'   focus 'top'|30|40|70|'bottom' (object-position)
     *   bleed (no radius) · sizes · eager (the LCP image) · alt ('' when decorative) · caption · wipe (the page's signature)
     *   stripes: { width, height, unit, dir, anchor, className } three stripes in one corner of the frame: anchor
 *     'ts'|'te'|'bs'|'be' (or a corner--xx class) pins them there; pick the corner with no faces in the photo
     */
    photo(name, { ratio = '3:2', focus, bleed, sizes = '(min-width: 64rem) 50vw, 100vw', eager, alt, caption, className, wipe, load, stripes, attrs: extra = {} } = {}) {
      return html`<figure${attrs({ class: cx('photo', RATIO[ratio] ?? ratio, focus != null && FOCUS[focus], bleed && 'photo--bleed', className), 'data-wipe': wipe || null, 'data-load': load ?? null, ...extra })}>${ctx.img(name, { sizes, eager, alt })}${stripes ? ctx.brand.stripes({ count: 3, unit: 22, dir: 'rise', width: 240, height: 140, ...stripes, className: cx('stripes', stripes.className) }) : ''}${caption ? html`<figcaption>${caption}</figcaption>` : ''}</figure>`;
    },
    /**
     * Three stripes entering a chapter from a corner: pos 'ts'|'te'|'bs'|'be', tone 'soft'|'ink'|'beige'|'navy'|'beige-400'|'navy-700'|'navy-800'.
     * Cleaner pages (24.11): the stripe is an accent once per page, in its hero. A corner renders only with
     * `accent: true`; every other chapter divider is a tone step alone.
     */
    corner({ pos = 'te', dir, tone = 'soft', unit = 20, count = 3, accent = false } = {}) {
      if (!accent) return '';
      const d = dir ?? (pos === 'ts' || pos === 'be' ? 'rise' : 'fall');
      return ctx.brand.stripes({ width: 260, height: 140, unit, dir: d, count, className: cx('stripes corner', `corner--${pos}`, tone !== 'soft' && `stripes--${tone}`) });
    },
    /** The large cropped brand mark (decorative; once per page at most). Position it with a page class. */
    mark({ className, parallax = true } = {}) {
      return html`<div${attrs({ class: cx('mark', className), 'data-parallax': parallax || null, 'aria-hidden': 'true' })}>${ctx.brand.logo({ variant: 'symbol' })}</div>`;
    },
    /** FAQ: groups [{ title?, items: [{ q, a }] }] → <details> rows. `a` may be a string (rich markup) or an array of paragraphs. */
    faq(groups, { level = 3, className } = {}) {
      const answer = (a) => (Array.isArray(a) ? a : [a]).filter(Boolean).map((p) => html`<p>${ctx.inline(p)}</p>`);
      return html`<div class="${cx('faq', className)}">${groups.map((g) => html`<div class="faq__group">${g.title ? H(level, 'faq__group-title', g.title) : ''}<div class="faq__items">${g.items.map((it) => html`<details><summary>${it.q}</summary><div class="faq__answer">${answer(it.a)}</div></details>`)}</div></div>`)}</div>`;
    },
    /** Timeline: steps [{ time?, title, body? }] with diamond nodes and a track that fills with the scroll. */
    timeline(steps, { level = 3, className } = {}) {
      return html`<div class="${cx('timeline', className)}"><span class="timeline__fill" aria-hidden="true"></span><ol class="timeline__list" role="list">${steps.map((s) => html`<li class="timeline__step" data-reveal="up">${s.time ? html`<span class="timeline__time ltr">${s.time}</span>` : ''}${H(level, 'timeline__title', s.title)}${s.body ? html`<p class="timeline__body">${s.body}</p>` : ''}</li>`)}</ol></div>`;
    },
    /** Stat blocks (owner numbers only, never rounded or "+"): items [{ value, label, period? }] (bilingual objects ok). Counts up once. */
    stats(items, { className } = {}) {
      return html`<dl class="${cx('stats', className)}" data-reveal>${items.map((s) => {
        const v = String(ctx.l(s.value));
        const n = /^\d{1,7}$/.test(v) ? v : null;
        return html`<div class="stat"><dt class="stat__label">${ctx.l(s.label)}${s.period ? html`<span class="stat__period">${ctx.l(s.period)}</span>` : ''}</dt><dd class="stat__value"${n ? html` data-count="${n}"` : ''}>${v}</dd></div>`;
      })}</dl>`;
    },
    /** One quote (owner content, consent): { text, name, context? } (bilingual objects ok). */
    quote(q, { className } = {}) {
      return html`<figure class="${cx('quote', className)}"><blockquote><p>${ctx.l(q.text)}</p></blockquote><figcaption>${ctx.l(q.name)}${q.context ? html`, ${ctx.l(q.context)}` : ''}</figcaption></figure>`;
    },
    /** Logo wall from owner content: [{ name, logo: 'img/partners/x.svg', url? }]. */
    logos(list, { className } = {}) {
      return html`<ul class="${cx('logos', className)}" role="list" data-reveal="fade">${list.map((p) => {
        const img = html`<img src="${ctx.asset(p.logo)}" alt="${ctx.l(p.name)}" width="${p.width ?? 240}" height="${p.height ?? 96}" loading="lazy" decoding="async">`;
        return html`<li>${p.url ? html`<a href="${ctx.safeUrl(p.url)}" rel="noopener">${img}</a>` : img}</li>`;
      })}</ul>`;
    },
    /**
     * Big row links: the whole row is one link, ending in "<go> ◀". items [{ title, body?, note?, href, go?, hint?,
     * external?, whatsapp?, attrs?, li? }]
     *   body / note: a line (string or html) and a smaller second line (e.g. an amount)
     *   hint: words for screen readers only (e.g. "(opens WhatsApp)")   external: rel="noopener" (an outside site)
     *   whatsapp: { text } the row becomes the association's WhatsApp link (filled live like ctx.whatsapp(); it keeps
     *     `href` — e.g. the contact page — until the phone arrives, so it always works)
     *   attrs / li: extra attributes for the <a> / the <li>   level: render titles as h<level> (inside the link)
     *   A row without href is plain text (no ◀).
     */
    rows(items, { level, className, reveal = true } = {}) {
      const title = (r) => (level ? H(level, 'row__title', r.title) : html`<span class="row__title">${r.title}</span>`);
      const text = (r) => html`<span class="row__text">${title(r)}${r.body ? html`<span class="row__body">${r.body}</span>` : ''}${r.note ? html`<span class="row__note">${r.note}</span>` : ''}</span>`;
      return html`<ul class="${cx('rows', className)}" role="list"${reveal ? html` data-reveal` : ''}>${items.filter(Boolean).map((r) => html`<li${attrs(r.li ?? {})}>${r.href
        ? html`<a${attrs({
          class: cx('row', !r.go && 'row--bare'),
          href: ctx.safeUrl(r.href),
          rel: r.external || r.whatsapp ? 'noopener' : null,
          'data-org-phone': r.whatsapp ? 'whatsapp' : null,
          'data-org-text': r.whatsapp?.text ?? null,
          ...(r.attrs ?? {}),
        })}>${text(r)}<span class="row__go">${r.go ?? ''}${tri()}</span>${r.hint ? html`<span class="visually-hidden"> ${r.hint}</span>` : ''}</a>`
        : html`<div class="row row--static">${text(r)}</div>`}</li>`)}</ul>`;
    },
    /** A list with ◀ bullets. */
    triList(items, { className } = {}) {
      return html`<ul class="${cx('tri-list', className)}" role="list">${items.map((t) => html`<li>${tri()}<span>${t}</span></li>`)}</ul>`;
    },
    /** The closing action of a chapter: big title, a line, actions (html). */
    ctaBand({ title, body, actions, id, level = 2 } = {}) {
      return html`<div class="cta-band" data-reveal><div class="stack">${H(level, 'cta-band__title', title, { id })}${body ? html`<p class="cta-band__body">${body}</p>` : ''}</div><div class="cta-band__actions cluster">${actions}</div></div>`;
    },
    /** A primary button (filled for the ground) with ◀. ghost: outlined. */
    button(label, href, { ghost, small, className, attrs: extra = {} } = {}) {
      return html`<a${attrs({ class: cx('btn', ghost && 'btn--ghost', small && 'btn--sm', className), href, ...extra })}><span>${label}</span>${tri()}</a>`;
    },
    /** An underlined text link with ◀ (navigation). */
    link(label, href, { className, arrow = true, attrs: extra = {} } = {}) {
      return html`<a${attrs({ class: cx('link', className), href, ...extra })}>${label}${arrow ? tri() : ''}</a>`;
    },
  };
}

export { raw };
