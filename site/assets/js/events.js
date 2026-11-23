// Live meetings: fills every [data-events] container from public_list_events (private.event_public shape:
// code, title, type, starts_at, ends_at, location, site_name, activity_name, instructor_name, speaker_name,
// lecture_topic, registration_open, is_full, spots_left, waitlist_enabled, price…). DOM is built with
// createElement/textContent only (no innerHTML: the CSP enforces Trusted Types).
//   data-events="all|friday|bonfire|other"  data-events-limit="6"  data-events-filter  data-events-heading="3"
import { rpc, rpcOnce, pageLang, strings, crmUrl } from './api.js';

const TZ = 'Asia/Jerusalem';
const TYPES = ['friday', 'bonfire', 'other'];
const HEBREW = /[֐-׿]/;
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
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
const yearOf = (d) => fmt(d, { year: 'numeric' });

function whenText(e) {
  const thisYear = yearOf(e.starts_at) === yearOf(new Date().toISOString());
  const day = fmt(e.starts_at, { weekday: 'long', day: 'numeric', month: 'long', ...(thisYear ? {} : { year: 'numeric' }) });
  const t = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return { day, time: `${fmt(e.starts_at, t)}–${fmt(e.ends_at, t)}` };
}

function kindLabel(e, s) {
  if (e.type === 'other' || !s.types[e.type]) return null;
  return e.title?.includes(s.types[e.type]) ? null : s.types[e.type];
}

const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const enc = encodeURIComponent;

function card(e, box, s, level) {
  const id = `${box.id || 'events'}-${e.code}`;
  const kind = kindLabel(e, s);
  const { day, time } = whenText(e);
  const lines = [];
  if (e.activity_name || e.instructor_name) lines.push([e.activity_name, e.instructor_name].filter(Boolean).join(' · '));
  if (e.speaker_name || e.lecture_topic) lines.push([e.speaker_name, e.lecture_topic].filter(Boolean).join(': '));
  let status = null;
  if (e.is_full && !e.waitlist_enabled) status = s.full;
  else if (e.is_full) status = s.waitlist;
  else if (e.spots_left != null) status = fill(s.spotsLeft, { n: e.spots_left });
  const canRegister = e.registration_open && (!e.is_full || e.waitlist_enabled);
  const actions = el('div', { class: 'event-card__actions' });
  if (canRegister) {
    actions.append(el('a', { class: 'btn btn--cta', href: `${crmUrl}#/r/${enc(e.code)}`, 'aria-describedby': id }, el('span', { text: e.is_full ? s.waitlist : s.register }), tri()));
  }
  actions.append(el('a', { class: 'btn', href: `${crmUrl}#/e/${enc(e.code)}`, 'aria-describedby': id }, s.details));
  return el('li', { class: 'event-card', 'data-type': e.type },
    kind && el('p', { class: 'event-card__kind', text: kind }),
    (() => { const h = dbText(`h${level}`, 'event-card__title', e.title); h.id = id; return h; })(),
    el('p', { class: 'event-card__when' }, el('time', { datetime: e.starts_at, text: day }), ' · ', el('bdi', { dir: 'ltr', text: time })),
    (e.location || e.site_name) && dbText('p', 'event-card__where', e.location || e.site_name),
    lines.map((l) => dbText('p', 'event-card__line', l)),
    e.price ? el('p', { class: 'event-card__price', text: fill(s.price, { price: e.price }) }) : null,
    status && el('p', { class: 'event-card__status', text: status }),
    actions,
  );
}

function message(box, text, retry) {
  box.querySelector('.events__message')?.remove();
  const list = box.querySelector('[data-events-list]');
  const msg = el('div', { class: 'events__message' }, el('p', { text }));
  if (retry) {
    const s = strings().events;
    msg.append(el('button', { class: 'btn', type: 'button', text: s.retry }));
    msg.querySelector('button').addEventListener('click', retry);
  }
  list.replaceChildren();
  list.hidden = true;
  list.after(msg);
}

function render(box, all) {
  const s = strings().events;
  const scope = box.dataset.events || 'all';
  const limit = Number(box.dataset.eventsLimit) || 6;
  const level = Math.min(6, Math.max(2, Number(box.dataset.eventsHeading) || 3));
  const pool = (Array.isArray(all) ? all : []).filter((e) => e && e.code && (scope === 'all' || e.type === scope));
  const list = box.querySelector('[data-events-list]');
  const statusEl = box.querySelector('[data-events-status]');
  const filters = box.querySelector('[data-events-filters]');
  box.setAttribute('aria-busy', 'false');
  box.querySelector('.events__message')?.remove();

  if (!pool.length) {
    message(box, s.empty);
    statusEl.replaceChildren(el('span', { class: 'visually-hidden', text: s.empty }));
    return;
  }
  let active = box.dataset.activeType || 'all';
  const draw = () => {
    const shown = pool.filter((e) => active === 'all' || e.type === active).slice(0, limit);
    list.hidden = false;
    list.replaceChildren(...shown.map((e) => card(e, box, s, level)));
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

function load(boxes, fresh = false) {
  boxes.forEach((b) => b.setAttribute('aria-busy', 'true'));
  (fresh ? rpc('public_list_events') : rpcOnce('public_list_events'))
    .then((data) => boxes.forEach((b) => render(b, data)))
    .catch(() => boxes.forEach((b) => {
      b.setAttribute('aria-busy', 'false');
      message(b, strings().events.error, () => load(boxes, true));
      b.querySelector('[data-events-status]').replaceChildren(el('span', { class: 'visually-hidden', text: strings().events.error }));
    }));
}

export function initEvents() {
  const boxes = [...document.querySelectorAll('[data-events]')];
  if (boxes.length) load(boxes);
}
