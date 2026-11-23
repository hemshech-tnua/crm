// Live meetings from public_list_events (private.event_public: code, title, type, starts_at, ends_at, location,
// site_name, activity_name, instructor_name, speaker_name, lecture_topic, status, registration_open, is_full,
// spots_left, waitlist_enabled, price…). DOM is built with createElement/textContent only (Trusted Types CSP).
//   [data-events="all|friday|bonfire|other"] data-events-limit data-events-filter data-events-heading → .meet cards
//   [data-next="all|friday|…"] (+ data-next-pay) → the next-meeting card and the phone CTA bar
import { rpc, rpcOnce, pageLang, strings, crmUrl } from './api.js';

const TZ = 'Asia/Jerusalem';
const TYPES = ['friday', 'bonfire', 'other'];
const HEBREW = /[֐-׿]/;
const SVG = 'http://www.w3.org/2000/svg';
const enc = encodeURIComponent;
const S = () => strings().events;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false && k !== '') n.append(k);
  return n;
}

function tri() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 10 20');
  svg.setAttribute('class', 'tri');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(SVG, 'polygon');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('points', document.documentElement.dir === 'rtl' ? '10,0 10,20 0,10' : '0,0 0,20 10,10');
  svg.append(p);
  return svg;
}

/** Text from the database is Hebrew; on English pages it is marked as such for screen readers and bidi. */
function dbText(tag, cls, text) {
  const n = el(tag, { class: cls, text });
  if (pageLang() !== 'he' && HEBREW.test(text)) { n.lang = 'he'; n.dir = 'auto'; }
  return n;
}

const fmt = (iso, o) => new Intl.DateTimeFormat(strings().locale, { timeZone: TZ, ...o }).format(new Date(iso));
const fill = (str, vars) => String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const time = (e) => {
  const t = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return e.ends_at ? `${fmt(e.starts_at, t)}–${fmt(e.ends_at, t)}` : fmt(e.starts_at, t);
};
const weekday = (iso) => fmt(iso, { weekday: pageLang() === 'he' ? 'long' : 'short' }).replace(/^יום\s+/, '');
const dayLong = (iso) => {
  const sameYear = fmt(iso, { year: 'numeric' }) === fmt(new Date().toISOString(), { year: 'numeric' });
  return fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
};
/** "בעוד 4 ימים" / "in 4 days" / "מחר", by calendar day in Israel. */
function relDays(iso) {
  try {
    const day = (x) => Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x)));
    const days = Math.round((day(iso) - day(Date.now())) / 864e5);
    if (days < 0 || days > 30) return '';
    return new Intl.RelativeTimeFormat(strings().locale, { numeric: 'auto' }).format(days, 'day');
  } catch { return ''; }
}

const canRegister = (e) => e.registration_open && e.status !== 'cancelled' && (!e.is_full || e.waitlist_enabled);
function status(e, s) {
  if (e.status === 'cancelled') return s.status.cancelled;
  if (!e.registration_open) return s.status.closed;
  if (e.is_full) return e.waitlist_enabled ? s.status.fullWaitlist : s.status.full;
  if (e.spots_left === 1) return s.status.oneLeft;
  if (e.spots_left != null && e.spots_left <= 10) return fill(s.status.fewLeft, { n: e.spots_left });
  return null;
}
const ctaLabel = (e, s, pay) => (e.is_full ? s.cta.waitlist : pay || Number(e.price) > 0 ? s.cta.registerAndPay : s.cta.register);
const kindLabel = (e, s) => (e.type === 'other' ? null : s.types[e.type] || null);
/** The card title: the kind ("מפגש שישי" / "Friday morning") when the title just repeats it or the page is English. */
const titleOf = (e, s) => { const k = kindLabel(e, s); return k && (pageLang() !== 'he' || !e.title || e.title.includes(k)) ? k : e.title || k || s.types.other; };
const linkFor = (e) => (canRegister(e) ? `${crmUrl}#/r/${enc(e.code)}` : `${crmUrl}#/e/${enc(e.code)}`);

function card(e, s, level) {
  const title = titleOf(e, s);
  const lines = [];
  if (e.activity_name || e.instructor_name) lines.push([e.activity_name, e.instructor_name].filter(Boolean).join(' · '));
  if (e.speaker_name || e.lecture_topic) lines.push([e.speaker_name, e.lecture_topic].filter(Boolean).join(': '));
  const place = e.location || e.site_name;
  const st = status(e, s);
  const open = canRegister(e);
  const h = dbText(`h${level}`, 'meet__type', title);
  const meta = el('span', { class: 'meet__meta' }, el('time', { class: 'ltr', datetime: e.starts_at, text: time(e) }));
  if (place) meta.append(' · ', dbText('span', '', place));
  return el('li', { class: 'event-card', 'data-type': e.type },
    el('a', { class: `meet${open ? '' : ' meet--closed'}`, href: linkFor(e) },
      el('span', { class: 'meet__date' },
        el('span', { text: weekday(e.starts_at) }),
        el('b', { text: fmt(e.starts_at, { day: 'numeric' }) }),
        el('span', { text: fmt(e.starts_at, { month: pageLang() === 'he' ? 'long' : 'short' }) }),
        el('span', { class: 'visually-hidden', text: dayLong(e.starts_at) })),
      el('span', { class: 'meet__body' },
        h,
        meta,
        lines.map((l) => dbText('span', 'meet__line', l)),
        e.price ? el('span', { class: 'meet__line', text: fill(s.price, { price: e.price }) }) : null,
        st && el('span', { class: 'meet__status', text: st }),
        el('span', { class: 'meet__go' }, open ? ctaLabel(e, s) : s.cta.details, tri()))));
}

function message(box, title, body, action) {
  box.querySelector('.events__message')?.remove();
  const list = box.querySelector('[data-events-list]');
  const msg = el('div', { class: 'events__message' }, el('p', { text: title }), body && el('p', { text: body }));
  if (action) msg.append(action);
  list.replaceChildren();
  list.hidden = true;
  list.after(msg);
}

function renderList(box, all) {
  const s = S();
  const scope = box.dataset.events || 'all';
  const limit = Number(box.dataset.eventsLimit) || 6;
  const level = Math.min(6, Math.max(2, Number(box.dataset.eventsHeading) || 3));
  const pool = all.filter((e) => scope === 'all' || e.type === scope);
  const list = box.querySelector('[data-events-list]');
  const statusEl = box.querySelector('[data-events-status]');
  const filters = box.querySelector('[data-events-filters]');
  box.setAttribute('aria-busy', 'false');
  box.querySelector('.events__message')?.remove();
  if (!pool.length) {
    message(box, s.emptyTitle, s.emptyBody);
    statusEl.replaceChildren(el('span', { class: 'visually-hidden', text: s.emptyTitle }));
    return;
  }
  let active = box.dataset.activeType || 'all';
  const draw = () => {
    const shown = pool.filter((e) => active === 'all' || e.type === active).slice(0, limit);
    list.hidden = false;
    list.replaceChildren(...shown.map((e) => card(e, s, level)));
    statusEl.replaceChildren(el('span', { class: 'visually-hidden', text: fill(s.count, { n: shown.length }) }));
  };
  const present = TYPES.filter((t) => pool.some((e) => e.type === t));
  if (box.hasAttribute('data-events-filter') && filters && present.length > 1) {
    const group = el('div', { class: 'cluster', role: 'group', 'aria-label': s.filterLabel });
    for (const t of ['all', ...present]) {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(t === active), text: t === 'all' ? s.all : s.types[t] });
      b.addEventListener('click', () => {
        active = t;
        box.dataset.activeType = t;
        group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        draw();
      });
      group.append(b);
    }
    filters.replaceChildren(group);
    filters.hidden = false;
  }
  draw();
}

/** The next-meeting card and the phone bar: [data-next-label|when|what|status|cta|cta-label] inside a [data-next]. */
function renderNext(box, all, failed) {
  const s = S();
  const q = (k) => box.querySelector(`[data-next-${k}]`);
  const scope = box.dataset.next || 'all';
  const pay = box.hasAttribute('data-next-pay');
  const isBar = box.hasAttribute('data-cta-bar');
  const set = (k, text) => { const n = q(k); if (n) { n.textContent = text ?? ''; n.hidden = !text && k === 'status'; } };
  const cta = q('cta');
  const ctaText = q('cta-label');
  box.removeAttribute('aria-busy');
  box.removeAttribute('aria-live');
  if (failed) {
    if (isBar) return;
    set('when', s.error);
    set('what', '');
    if (cta) { cta.href = `${crmUrl}#/`; ctaText.textContent = s.errorCta; }
    return;
  }
  const pool = all.filter((e) => scope === 'all' || e.type === scope);
  const next = pool.find(canRegister) ?? pool[0];
  if (!next) {
    if (isBar) return;
    set('when', s.emptyTitle);
    set('what', s.emptyBody);
    return;
  }
  const rel = relDays(next.starts_at);
  const label = q('label');
  if (label) {
    label.textContent = s.nextLabel;
    if (rel && !isBar) label.append(el('span', { text: rel }));
  }
  const when = q('when');
  if (isBar) {
    when.textContent = `${weekday(next.starts_at)} ${fmt(next.starts_at, { day: 'numeric', month: 'numeric' })} · `;
    when.append(el('span', { class: 'ltr', text: time(next).split('–')[0] }));
  } else {
    const title = dbText('span', '', titleOf(next, s));
    when.replaceChildren(title, el('span', { text: dayLong(next.starts_at) }));
    const what = q('what');
    what.replaceChildren(el('span', { class: 'ltr', text: time(next) }));
    for (const part of [next.activity_name || next.lecture_topic, next.location || next.site_name]) if (part) what.append(' · ', dbText('span', '', part));
    const st = canRegister(next) ? status(next, s) : !next.registration_open ? s.notOpenYet : s.fullNextSoon;
    set('status', st);
  }
  if (cta) {
    if (canRegister(next)) {
      cta.href = `${crmUrl}#/r/${enc(next.code)}`;
      if (!isBar) ctaText.textContent = ctaLabel(next, s, pay);
      else if (next.is_full) ctaText.textContent = s.cta.waitlist;
    }
  }
  box.setAttribute('data-filled', '');
}

function load(fresh = false) {
  const lists = [...document.querySelectorAll('[data-events]')];
  const nexts = [...document.querySelectorAll('[data-next]')];
  lists.forEach((b) => b.setAttribute('aria-busy', 'true'));
  (fresh ? rpc('public_list_events') : rpcOnce('public_list_events'))
    .then((data) => {
      const all = (Array.isArray(data) ? data : []).filter((e) => e && e.code && e.starts_at)
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      lists.forEach((b) => renderList(b, all));
      nexts.forEach((b) => renderNext(b, all));
    })
    .catch(() => {
      const s = S();
      lists.forEach((b) => {
        b.setAttribute('aria-busy', 'false');
        const retry = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: s.retry });
        retry.addEventListener('click', () => load(true));
        message(b, s.error, null, retry);
        b.querySelector('[data-events-status]').replaceChildren(el('span', { class: 'visually-hidden', text: s.error }));
      });
      nexts.forEach((b) => renderNext(b, [], true));
    });
}

export function initEvents() {
  load();
}
