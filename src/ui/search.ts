// One way to read what staff type into a "חיפוש לפי שם או טלפון" box, for every list.
//
// A phone is found by any form of it: the last digits ("4567"), a local number ("054-0123456", "0540123456"), or an
// international one ("+972 54 012 3456", "00972…"). Stored numbers are E.164 (+972540123456), so the query is reduced
// to digits without the country code or the trunk 0, and matched against the END of the stored number.
// A name is found by every word of the query, in any order, ignoring geresh/quote marks and final letters.

/** The digits of a phone query, ready to match the end of a stored phone; null when the query is not a phone. */
export function phoneTail(query: string): string | null {
  const q = query.trim();
  if (!q || /[\p{L}]/u.test(q)) return null; // words → a name search
  let digits = q.replace(/\D/g, '');
  if (digits.length < 3) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('972') && digits.length > 9) digits = digits.slice(3);
  if (digits.startsWith('0') && digits.length > 4) digits = digits.slice(1);
  return digits;
}

/** Does a stored phone (any format) match the query? */
export function phoneMatches(query: string, phone: string | null | undefined): boolean {
  const tail = phoneTail(query);
  if (!tail || !phone) return false;
  return phone.replace(/\D/g, '').endsWith(tail);
}

const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
/** Lower-case, no niqqud, no quote marks, final letters as regular ones, single spaces. */
export function foldText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'׳״`´]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Client-side search over people (or anything with a name and a phone): true when the query is empty, when it is a
 * phone that ends the stored phone, or when every word of it appears in the name or in one of the `also` texts
 * (city, nickname, alias…).
 */
export function matchesSearch(query: string, item: { name?: string | null; phone?: string | null; also?: (string | null | undefined)[] }): boolean {
  const q = query.trim();
  if (!q) return true;
  if (phoneTail(q)) return phoneMatches(q, item.phone);
  const hay = foldText([item.name, ...(item.also ?? [])].filter(Boolean).join(' '));
  return foldText(q).split(' ').every((w) => hay.includes(w));
}

/** The shared placeholder of people searches; add "…או עיר" only where the city is searched too. */
export const SEARCH_PLACEHOLDER = 'חיפוש לפי שם או טלפון';
export const SEARCH_PLACEHOLDER_CITY = 'חיפוש לפי שם, טלפון או עיר';
