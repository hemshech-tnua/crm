// Live meetings from public_list_events (private.event_public: code, title, type, starts_at, ends_at, location,
// site_name, activity_name, instructor_name, speaker_name, lecture_topic, status, registration_open, is_full,
// spots_left, waitlist_enabled, price…). DOM is built with createElement/textContent only (Trusted Types CSP).
//   [data-events="all|friday|bonfire|other|women"] data-events-limit data-events-filter data-events-heading
//     data-events-empty-title / -body → .meet cards
//   [data-next="friday|all|…"] (+ data-next-pay) → the next-meeting card and the phone CTA bar
// "women" is not a CRM type: women's evenings are "other" meetings whose title or activity says so (isWomensEvening).
import { rpc, rpcOnce, pageLang, strings, crmUrl } from './api.js';

const TZ = 'Asia/Jerusalem';
const TYPES = ['friday', 'bonfire', 'other'];
const HEBREW = /[֐-׿]/;
const WOMEN = /נשים|לוחמות|women/i;

/** A women's evening: an "other" meeting whose title or activity names it (ערב נשים, ללוחמות, women). */
export function isWomensEvening(e) {
  return !!e && e.type === 'other' && WOMEN.test(`${e.title ?? ''} ${e.activity_name ?? ''}`);
}
/** Does meeting e belong to a list scope ('all' | a CRM type | 'women')? */
export function inScope(e, scope) {
  if (!scope || scope === 'all') return true;
  if (scope === 'women') return isWomensEvening(e);
  return e.type === scope;
}

/** Typography for text typed into the CRM: Hebrew quote marks (״ ׳) and the en dash in ranges and between words. */
export function tidy(text) {
  return String(text ?? '')
    .replace(/([א-ת])"(?=[א-ת])/g, '$1״')
    .replace(/([א-ת])'/g, '$1׳')
    .replace(/(?<![\d:])(\d{1,2}(?::\d\d)?)\s?-\s?(\d{1,2}(?::\d\d)?)(?![\d:])/g, '$1–$2')
    .replace(/\s-\s/g, ' – ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
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

/**
 * Text typed into the CRM: tidied, isolated in a <bdi dir="auto"> (a Hebrew title never reorders the English around
 * it, and vice versa), and marked lang="he" on English pages so screen readers switch voice.
 */
function dbText(tag, cls, text) {
  const t = tidy(text);
  const b = el('bdi', { dir: 'auto', text: t });
  if (pageLang() !== 'he' && HEBREW.test(t)) b.lang = 'he';
  return el(tag, { class: cls }, b);
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
  if (!e.registration_open) return s.status.notOpen;
  if (e.is_full) return e.waitlist_enabled ? s.status.fullWaitlist : s.status.full;
  if (e.spots_left === 1) return s.status.oneLeft;
  if (e.spots_left != null && e.spots_left <= 10) return fill(s.status.fewLeft, { n: e.spots_left });
  return null;
}
const ctaLabel = (e, s, pay) => (e.is_full ? s.cta.waitlist : pay || Number(e.price) > 0 ? s.cta.registerAndPay : s.cta.register);
const kindLabel = (e, s) => (isWomensEvening(e) ? s.types.women : e.type === 'other' ? null : s.types[e.type] || null);
/** The card title: the kind ("מפגש שישי" / "Friday morning") when the title just repeats it or the page is English. */
// (a women's evening keeps its own Hebrew title, which says more than the kind: "ערב נשים – ״לוחמות בתנועה״")
const titleOf = (e, s) => { const k = kindLabel(e, s); return k && (pageLang() !== 'he' || !e.title || (e.title.includes(k) && !isWomensEvening(e))) ? k : e.title || k || s.types.other; };
const countText = (n, s) => (n === 1 ? s.countOne : fill(s.count, { n }));
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
        el('span', { 'aria-hidden': 'true', text: weekday(e.starts_at) }),
        el('b', { 'aria-hidden': 'true', text: fmt(e.starts_at, { day: 'numeric' }) }),
        el('span', { 'aria-hidden': 'true', text: fmt(e.starts_at, { month: pageLang() === 'he' ? 'long' : 'short' }) }),
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
  const pool = all.filter((e) => inScope(e, scope));
  const list = box.querySelector('[data-events-list]');
  const statusEl = box.querySelector('[data-events-status]');
  const filters = box.querySelector('[data-events-filters]');
  box.setAttribute('aria-busy', 'false');
  box.querySelector('.events__message')?.remove();
  if (!pool.length) {
    const title = box.dataset.eventsEmptyTitle || s.emptyTitle;
    message(box, title, box.dataset.eventsEmptyBody ?? s.emptyBody);
    statusEl.replaceChildren(el('span', { class: 'visually-hidden', text: title }));
    return;
  }
  let active = box.dataset.activeType || 'all';
  const draw = () => {
    const shown = pool.filter((e) => active === 'all' || e.type === active).slice(0, limit);
    list.hidden = false;
    list.replaceChildren(...shown.map((e) => card(e, s, level)));
    statusEl.replaceChildren(el('span', { class: 'visually-hidden', text: countText(shown.length, s) }));
  };
  const present = TYPES.filter((t) => pool.some((e) => e.type === t));
  if (box.hasAttribute('data-events-filter') && filters && present.length > 1) {
    const group = el('div', { class: 'cluster', role: 'group', 'aria-label': s.filterLabel });
    for (const t of ['all', ...present]) {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(t === active), text: t === 'all' ? s.all : s.filters[t] });
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
  const scope = box.dataset.next || 'friday';
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
  const pool = all.filter((e) => inScope(e, scope));
  const next = pool.find(canRegister) ?? pool[0];
  if (!next) {
    if (isBar) return;
    set('when', s.emptyTitle);
    set('what', s.emptyBody);
    return;
  }
  const rel = relDays(next.starts_at);
  const label = q('label');
  const when = q('when');
  if (isBar) {
    // "מפגש שישי" / "שישי 27.11 · 09:00": the bar always names the meeting it registers for
    if (label) label.replaceChildren(dbText('span', '', titleOf(next, s)));
    when.textContent = `${weekday(next.starts_at)} ${fmt(next.starts_at, { day: 'numeric', month: 'numeric' })} · `;
    when.append(el('span', { class: 'ltr', text: time(next).split('–')[0] }));
  } else {
    if (label) {
      label.textContent = s.nextLabel;
      if (rel) label.append(el('span', { text: rel }));
    }
    const title = dbText('span', '', titleOf(next, s));
    when.replaceChildren(title, el('span', { text: dayLong(next.starts_at) }));
    const what = q('what');
    what.replaceChildren(el('span', { class: 'ltr', text: time(next) }));
    for (const part of [next.activity_name || next.lecture_topic, next.location || next.site_name]) if (part) what.append(' · ', dbText('span', '', part));
    const st = next.status === 'cancelled' ? s.status.cancelled : canRegister(next) ? status(next, s) : !next.registration_open ? s.notOpenYet : s.fullNextSoon;
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

const valid = (iso) => typeof iso === 'string' && Number.isFinite(Date.parse(iso));
/** Rows the cards can show: a code and a real start date (a broken end date is dropped, not the meeting). */
function clean(data) {
  return (Array.isArray(data) ? data : [])
    .filter((e) => e && e.code && valid(e.starts_at))
    .map((e) => (e.ends_at && !valid(e.ends_at) ? { ...e, ends_at: null } : e))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

/** focusBox: after "לנסות שוב" the button is gone, so focus moves to the list it reloaded (tabindex=-1). */
function load(fresh = false, focusBox = null) {
  const lists = [...document.querySelectorAll('[data-events]')];
  const nexts = [...document.querySelectorAll('[data-next]')];
  lists.forEach((b) => b.setAttribute('aria-busy', 'true'));
  const done = () => focusBox?.focus({ preventScroll: false });
  (fresh ? rpc('public_list_events') : rpcOnce('public_list_events'))
    .then((data) => {
      const all = clean(data);
      lists.forEach((b) => renderList(b, all));
      nexts.forEach((b) => renderNext(b, all));
      done();
    })
    .catch(() => {
      const s = S();
      lists.forEach((b) => {
        b.setAttribute('aria-busy', 'false');
        const retry = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: s.retry });
        retry.addEventListener('click', () => load(true, b));
        message(b, s.error, null, retry);
        b.querySelector('[data-events-status]').replaceChildren(el('span', { class: 'visually-hidden', text: s.error }));
      });
      nexts.forEach((b) => renderNext(b, [], true));
      done();
    });
}

export function initEvents() {
  load();
}
