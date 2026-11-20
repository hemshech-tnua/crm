// Search at the entrance: forgiving, because the volunteer types fast with one thumb and people say their name
// the way they say it ("נעם" for "נועם", "סשה וולקוב" for "אלכסנדר (סשה) וולקוב", a full phone in any format).

/** Hebrew letters that are often written or left out (ו, י), punctuation and brackets do not decide a match. */
export function looseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[()[\]{}"'׳״`.,\-־]/g, ' ')
    .replace(/[וי]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string) => s.toLowerCase().replace(/[()[\]{}"'׳״`.,\-־]/g, ' ').split(/\s+/).filter(Boolean);

/** The typed digits, made comparable with the end of a stored number: 054-0123456, +972 54…, 0540123456. */
export function searchDigits(term: string): string {
  return term.replace(/\D/g, '');
}

export type Matchable = { display_name: string; phone_last4: string | null; phone?: string | null };

/**
 * 0 = no match; higher = better (used to put the most likely person first).
 * - digits: 2–3 digits match inside the last four; 4+ digits match the end of the number (full numbers in any format)
 * - words: every typed word must appear in the name, exactly or loosely (ו/י, brackets)
 */
export function matchScore(r: Matchable, term: string): number {
  const t = term.trim();
  if (!t) return 1;
  const d = searchDigits(t);
  const letters = t.replace(/[\d\s+\-().]/g, '');
  if (d.length >= 2 && !letters) {
    const last4 = r.phone_last4 ?? '';
    if (d.length < 4) return last4.includes(d) ? 2 : 0;
    if (last4 !== d.slice(-4)) return 0;
    // a full phone (only managers get it): the whole typed tail must match, after the country code or the leading 0
    if (r.phone && d.length > 4) {
      const full = searchDigits(r.phone);
      const tail = d.replace(/^(972|0)/, '');
      return full.endsWith(tail) ? 4 : 0;
    }
    return 3;
  }
  const name = r.display_name.toLowerCase();
  const nameWords = words(r.display_name);
  const typed = words(t);
  if (!typed.length) return 0;
  let score = 0;
  for (const w of typed) {
    if (nameWords.some((n) => n.startsWith(w))) score += 3;
    else if (name.includes(w)) score += 2;
    else {
      const lw = looseName(w);
      if (lw.length >= 2 && nameWords.some((n) => looseName(n).startsWith(lw))) score += 1;
      else return 0;
    }
  }
  // the whole name starting with what was typed is the strongest hint
  if (name.startsWith(t.toLowerCase())) score += 2;
  return score;
}
