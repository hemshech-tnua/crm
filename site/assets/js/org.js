// The association's contact phone, live from public_org_info, into [data-org-phone] slots:
//   data-org-phone="whatsapp" → href https://wa.me/<digits>[?text=data-org-text]
//   data-org-phone="tel"      → href tel:+972…
//   data-org-phone="text"     → the number as text (050-123-4567)
// Slots stay hidden until a phone arrives (and so does their [data-org-phone-item] wrapper); no phone = nothing shows.
import { rpcOnce } from './api.js';

function display(e164) {
  if (e164.startsWith('+9725') && e164.length === 13) {
    const local = '0' + e164.slice(4);
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return e164.startsWith('+972') ? '0' + e164.slice(4) : e164;
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
          node.textContent = display(phone);
        }
        if (node.tagName === 'A' && kind !== 'text') node.setAttribute('dir', node.getAttribute('dir') ?? 'auto');
        node.hidden = false;
        node.closest('[data-org-phone-item]')?.removeAttribute('hidden');
      }
    })
    .catch(() => {});
}
