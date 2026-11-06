// The only thing kept on the participant's phone: the registration token per event, so check-in at the door
// is one tap. No name or phone is stored. Storage can be blocked (private mode, settings), so every access is guarded.
const KEY = 'hemshech-reg-tokens';
const KEEP_DAYS = 120;

type Entry = { t: string; at: number };

function readAll(): Record<string, Entry> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Entry>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: check-in falls back to the phone number
  }
}

export function savedToken(eventCode: string | null | undefined): string | null {
  if (!eventCode) return null;
  const e = readAll()[eventCode];
  return e && typeof e.t === 'string' && e.t.length >= 20 ? e.t : null;
}

export function saveToken(eventCode: string | null | undefined, token: string | null | undefined) {
  if (!eventCode || !token) return;
  const all = readAll();
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const [k, v] of Object.entries(all)) if (!v || typeof v.at !== 'number' || v.at < cutoff) delete all[k];
  all[eventCode] = { t: token, at: Date.now() };
  writeAll(all);
}

export function forgetToken(eventCode: string | null | undefined) {
  if (!eventCode) return;
  const all = readAll();
  if (!(eventCode in all)) return;
  delete all[eventCode];
  writeAll(all);
}
