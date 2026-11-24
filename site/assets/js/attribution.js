// Campaign attribution for the visit. A landing with ?ref=<code> and/or utm_source|medium|campaign (what the CRM reads) is kept
// in sessionStorage for the visit (a later landing with new ones replaces it); every registration link into the CRM
// (…/crm/#/r/<code>) then carries them as …#/r/<code>?ref=…&utm_source=… — the CRM's RegisterPage reads ref (channel
// links, personal "חבר מביא חבר" f- links) and utm_*. Nothing is sent anywhere by this module.
const KEY = 'ht-attribution';
const UTM = ['utm_source', 'utm_medium', 'utm_campaign'];
let cur = null;

/** The landing parameters, cleaned (the CRM's referral code format; utm_* up to 100 characters). */
export function fromSearch(search) {
  const p = new URLSearchParams(search);
  const out = {};
  const ref = p.get('ref')?.trim().toLowerCase();
  if (ref && /^[a-z0-9][a-z0-9-]{1,39}$/.test(ref)) out.ref = ref;
  for (const k of UTM) { const v = p.get(k)?.trim(); if (v) out[k] = v.slice(0, 100); }
  return out;
}

const params = () => {
  if (!cur) try { cur = JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { cur = {}; }
  return cur;
};

/** A CRM registration URL with the visit's ref/utm_* in its hash query (parameters already there win). */
export function decorate(url) {
  const a = Object.entries(params());
  const i = url?.indexOf('#/r/') ?? -1;
  if (i < 0 || !a.length) return url;
  const [route, query] = url.slice(i + 1).split('?');
  const q = new URLSearchParams(query);
  for (const [k, v] of a) if (!q.has(k)) q.set(k, v);
  return `${url.slice(0, i)}#${route}?${q}`;
}

export function initAttribution() {
  const landed = fromSearch(location.search);
  if (Object.keys(landed).length) {
    cur = landed;
    try { sessionStorage.setItem(KEY, JSON.stringify(landed)); } catch { /* this page still carries them */ }
  }
  // registration links that are already in the page get the parameters as they are used
  const fix = (e) => { const a = e.target.closest?.('a[href*="#/r/"]'); if (a) a.href = decorate(a.getAttribute('href')); };
  if (Object.keys(params()).length) for (const t of ['pointerdown', 'focusin', 'click']) document.addEventListener(t, fix, true);
}
