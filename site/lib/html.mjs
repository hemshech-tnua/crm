// HTML building blocks for page modules: an auto-escaping tagged template and a few helpers.
//
//   html`<p>${userText}</p>`          → userText is escaped
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`  → nested html`` and arrays are kept as HTML
//   raw(trustedString)                → inserted as-is (only for markup you produced yourself)
//   null / undefined / false / true   → nothing (so `${cond && html`…`}` works)

class Html {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for an HTML text node or a quoted attribute value. */
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

/** Mark a string as trusted HTML. Never pass content that came from JSON or a visitor through this. */
export const raw = (s) => new Html(s == null ? '' : String(s));

export const isHtml = (v) => v instanceof Html;

function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

/** Tagged template: interpolations are escaped unless they are html`` results (or arrays of them). */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Html(out);
}

/**
 * Attributes from an object: attrs({ class: 'a', hidden: true, 'data-x': 3, title: null })
 * → ` class="a" hidden data-x="3"`. false/null/undefined drop the attribute; true writes it bare.
 */
export function attrs(obj) {
  let out = '';
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v == null || v === false) continue;
    if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) throw new Error(`attrs: bad attribute name "${k}"`);
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return new Html(out);
}

/** class list from strings / falsy values: cx('btn', primary && 'btn--primary'). */
export const cx = (...c) => c.flat().filter(Boolean).join(' ');

/** Only http(s), mailto, tel, relative and fragment URLs pass; anything else (javascript:, data:) becomes "#". */
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  if (/^(https?:|mailto:|tel:|\/|#|\.\.?\/)/i.test(s) || !/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return '#';
}

/**
 * Light inline markup for copy strings (from content JSON), escaped first:
 *   **bold** → <strong>, _em_ → <em>, [text](url) → <a>, a line break "\n" → <br>.
 * Anything else stays text. Use ctx.rich(key) rather than calling this directly.
 */
export function inline(text) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])_(.+?)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(safeUrl(u.replace(/&amp;/g, '&')))}">${t}</a>`);
  s = s.replace(/\n/g, '<br>');
  return new Html(s);
}

/**
 * Names that never break across lines: "המשך תנועה" (and "להמשיך תנועה"), "Hemshech Tnua".
 * Applied to the whole rendered page by the build, so authors never need to think about it.
 */
export const keepNames = (s) =>
  s
    .replace(/(המשך|המשיך) תנועה/g, '$1 תנועה')
    .replace(/Hemshech Tnua/g, 'Hemshech Tnua');
