// The association's contact phone, live from public_org_info, into [data-org-phone] slots:
//   data-org-phone="whatsapp" → href https://wa.me/<digits>[?text=data-org-text]
//   data-org-phone="tel"      → href tel:+972…
//   data-org-phone="text"     → the number as text (050-123-4567; +972 50-123-4567 on English pages)
// Slots stay hidden until a phone arrives (and so does their [data-org-phone-item] wrapper); no phone = nothing shows.
// [data-org-phone-fallback] (a plain "contact the team" line) is hidden once the phone is there.
import { rpcOnce } from './api.js';

/** 050-123-4567 on Hebrew pages; +972 50-123-4567 on English ones (readers abroad dial the country code). */
function display(e164, lang) {
  if (!e164.startsWith('+972')) return e164;
  const rest = e164.slice(4);
  const groups = rest.startsWith('5') && rest.length === 9 ? `${rest.slice(0, 2)}-${rest.slice(2, 5)}-${rest.slice(5)}` : rest;
  return lang === 'he' ? `0${groups}` : `+972 ${groups}`;
}

export function initOrg() {
  rpcOnce('public_org_info')
    .then((info) => {
      const phone = typeof info?.contact_phone === 'string' ? info.contact_phone.trim() : '';
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) return;
      for (const node of document.querySelectorAll('[data-org-phone]')) {
        const kind = node.dataset.orgPhone;
        if (kind === 'whatsapp') {
          const text = node.dataset.orgText;
          node.setAttribute('href', `https://wa.me/${phone.slice(1)}${text ? `?text=${encodeURIComponent(text)}` : ''}`);
        } else if (kind === 'tel') {
          node.setAttribute('href', `tel:${phone}`);
        } else if (kind === 'text') {
          node.textContent = display(phone, document.documentElement.lang === 'en' ? 'en' : 'he');
          node.setAttribute('dir', 'ltr'); // a number inside a Hebrew sentence keeps its digit order
        }
        node.hidden = false;
        node.closest('[data-org-phone-item]')?.removeAttribute('hidden');
      }
      for (const f of document.querySelectorAll('[data-org-phone-fallback]')) f.hidden = true;
    })
    .catch(() => {});
}
