// Mirrors private.normalize_phone() in the database (the server is the source of truth).
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.replace(/[\s\-.()‎‏‪-‮]/g, '');
  if (!v) return null;
  if (v.startsWith('00')) v = '+' + v.slice(2);
  if (/^0[2-9]\d{7,8}$/.test(v)) v = '+972' + v.slice(1);
  if (/^972[2-9]\d{7,8}$/.test(v)) v = '+' + v;
  if (v.startsWith('+9720')) v = '+972' + v.slice(5);
  if (v.startsWith('+972')) {
    return /^\+9725\d{8}$/.test(v) || /^\+972[2-489]\d{7}$/.test(v) || /^\+9727\d{8}$/.test(v) ? v : null;
  }
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
}

/** +972501234567 → 050-123-4567 for display. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (e164.startsWith('+9725') && e164.length === 13) {
    const local = '0' + e164.slice(4);
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  if (e164.startsWith('+972')) return '0' + e164.slice(4);
  return e164;
}

/** wa.me wants digits only, with country code. */
export function whatsappLink(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function telLink(e164: string): string {
  return `tel:${e164}`;
}
