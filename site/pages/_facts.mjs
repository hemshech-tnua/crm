// Shared Friday blocks for the home and Friday pages (files starting with _ are not pages).
//   factStrip  "שישי · 09:00 · הולמס פלייס מודיעין · ‎25 ₪ · איתי מחכה בכניסה": each fact with its icon and its words
//              (NN/g: an icon never stands alone). Static facts first (facts.ts, approved copy); events.js
//              ([data-next-facts]) swaps in the next open Friday's date, start time, venue and price.
//   askLine    "שאלה לפני שבאים? כתבו לנו בוואטסאפ" beside a registration button (hidden until the phone arrives live)
//   iconList   labelled icon answers (the "פעם ראשונה?" strip, "אחרי ההרשמה", the women's evenings facts)
import { html, cx } from '../lib/html.mjs';

const icon = (ctx, name, o) => (typeof ctx.icon === 'function' ? ctx.icon(name, o) : '');

export function factStrip(ctx, { type = 'friday', className } = {}) {
  const f = (k) => ctx.t(`facts.${k}`);
  const item = (name, key, text, cls) => html`<li class="facts__item">${icon(ctx, name, { className: 'facts__icon' })}<span${cls ? html` class="${cls}"` : ''}${key ? html` data-fact="${key}"` : ''}>${text}</span></li>`;
  return html`<ul class="${cx('facts', className)}" role="list" aria-label="${f('label')}" data-next-facts="${type}">
  ${item('calendar-3', 'day', f('day'))}
  ${item('clock', 'time', f('time'), 'ltr')}
  ${item('map-pin', 'place', f('place'))}
  ${item('price', 'price', f('priceFallback'))}
  ${item('greeter', null, f('greeter'))}
</ul>`;
}

export function askLine(ctx, { className } = {}) {
  return html`<p class="${cx('ask', className)}" data-org-phone-item hidden>${icon(ctx, 'whatsapp', { className: 'ask__icon' })}${ctx.whatsapp(ctx.t('facts.ask'), { className: 'link', text: ctx.t('whatsapp.friday') })}</p>`;
}

/**
 * items [{ icon, title, body, href?, link? }] → <ul class="icon-list"> with a heading per item (level) or a bold title.
 */
export function iconList(ctx, items, { className, level = 3, label, reveal = true } = {}) {
  const tag = `h${level}`;
  return html`<ul class="${cx('icon-list', className)}" role="list"${label ? html` aria-label="${label}"` : ''}${reveal ? html` data-reveal="group"` : ''}>
  ${items.map((it) => html`<li class="icon-list__item">
    <span class="icon-list__mark">${icon(ctx, it.icon, { size: 32, className: 'icon-list__icon' })}</span>
    <span class="icon-list__text">
      ${level ? html`<${tag} class="icon-list__title">${it.title}</${tag}>` : html`<strong class="icon-list__title">${it.title}</strong>`}
      <span class="icon-list__body">${it.body}${it.href ? html` <a class="link" href="${it.href}">${it.link}${ctx.brand.tri()}</a>` : ''}</span>
    </span>
  </li>`)}
</ul>`;
}
