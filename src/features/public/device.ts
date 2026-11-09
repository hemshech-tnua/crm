// What is kept on the participant's own phone: for each event, the registrations made from this phone
// (token + the first name typed in the form), so check-in at the door is one tap and asks "who arrived?" when
// one phone registered several people. Storage can be blocked (private mode, settings), so every access is guarded.
const KEY = 'hemshech-reg-tokens';
const KEEP_DAYS = 120;
const MAX_PER_EVENT = 6;

export type SavedRegistration = { token: string; name: string | null };
type Entry = { t: string; at: number; n?: string | null };

function readAll(): Record<string, Entry[]> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, Entry[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      // older format kept one entry per event
      const list = Array.isArray(v) ? v : [v];
      out[k] = list.filter((e): e is Entry => !!e && typeof (e as Entry).t === 'string' && (e as Entry).t.length >= 20 && typeof (e as Entry).at === 'number');
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Entry[]>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: check-in falls back to the phone number
  }
}

/** Registrations made from this phone for an event, most recent first. */
export function savedRegistrations(eventCode: string | null | undefined): SavedRegistration[] {
  if (!eventCode) return [];
  return (readAll()[eventCode] ?? []).slice().sort((a, b) => b.at - a.at).map((e) => ({ token: e.t, name: e.n ?? null }));
}

export function savedToken(eventCode: string | null | undefined): string | null {
  return savedRegistrations(eventCode)[0]?.token ?? null;
}

export function hasToken(eventCode: string | null | undefined, token: string): boolean {
  return savedRegistrations(eventCode).some((r) => r.token === token);
}

export function saveToken(eventCode: string | null | undefined, token: string | null | undefined, name?: string | null) {
  if (!eventCode || !token) return;
  const all = readAll();
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const k of Object.keys(all)) {
    all[k] = all[k].filter((e) => e.at >= cutoff);
    if (!all[k].length) delete all[k];
  }
  const list = (all[eventCode] ?? []).filter((e) => e.t !== token && (!name || e.n !== name));
  list.push({ t: token, at: Date.now(), n: name ?? (all[eventCode] ?? []).find((e) => e.t === token)?.n ?? null });
  all[eventCode] = list.slice(-MAX_PER_EVENT);
  writeAll(all);
}

/** Forget one registration (or all of an event's when no token is given). */
export function forgetToken(eventCode: string | null | undefined, token?: string) {
  if (!eventCode) return;
  const all = readAll();
  if (!(eventCode in all)) return;
  all[eventCode] = token ? all[eventCode].filter((e) => e.t !== token) : [];
  if (!all[eventCode].length) delete all[eventCode];
  writeAll(all);
}

// People who checked in from this phone before (device token + first name). The token lets the next check-in be
// one tap, also for a meeting they did not register for, and recognises them on the "join the association" page.
// The server keeps only a hash, forgets it after 180 days without use, and "that's not me" removes it.
const PEOPLE_KEY = 'hemshech-people';
const MAX_PEOPLE = 4;

export type KnownPerson = { device: string; name: string | null };
type PersonEntry = { d: string; n?: string | null; at: number };

function readPeople(): PersonEntry[] {
  try {
    const raw = window.localStorage.getItem(PEOPLE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - 180 * 864e5;
    return parsed.filter((e): e is PersonEntry => !!e && typeof (e as PersonEntry).d === 'string' && (e as PersonEntry).d.length >= 20
      && typeof (e as PersonEntry).at === 'number' && (e as PersonEntry).at >= cutoff);
  } catch {
    return [];
  }
}

function writePeople(list: PersonEntry[]) {
  try {
    window.localStorage.setItem(PEOPLE_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: the phone number still works
  }
}

/** People remembered on this phone, most recent first. */
export function knownPeople(): KnownPerson[] {
  return readPeople().sort((a, b) => b.at - a.at).map((e) => ({ device: e.d, name: e.n ?? null }));
}

/** Remember (or refresh) a person after a successful check-in. One entry per name: a new token replaces the old one. */
export function rememberPerson(device: string | null | undefined, name: string | null | undefined) {
  if (!device) return;
  const list = readPeople().filter((e) => e.d !== device && (!name || e.n !== name));
  list.push({ d: device, n: name ?? null, at: Date.now() });
  writePeople(list.sort((a, b) => b.at - a.at).slice(0, MAX_PEOPLE));
}

export function forgetPerson(device: string | null | undefined) {
  if (!device) return;
  writePeople(readPeople().filter((e) => e.d !== device));
}
