// The site's only network code: anonymous calls to the public Supabase RPCs (the same ones the CRM's public pages use).
import config from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /rest/v1/rpc/<fn> with the public anon key, within one time budget (8 s by default, all attempts together).
 * A network error or a 5xx/429 is retried once if enough of the budget is left; a timeout is final (a hung network
 * must not keep the skeleton up for twice the budget), and so is any other 4xx.
 */
export async function rpc(fn, args = {}, { timeout = 8000, retries = 1 } = {}) {
  const deadline = Date.now() + timeout;
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(0, deadline - Date.now()));
    try {
      const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(args),
        credentials: 'omit',
        signal: ctl.signal,
      });
      if (!res.ok) {
        const err = new Error(`${fn}: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      const final = ctl.signal.aborted || (e.status && e.status < 500 && e.status !== 429);
      if (final || attempt >= retries || deadline - Date.now() < 2000) throw e;
      await sleep(600);
    } finally {
      clearTimeout(timer);
    }
  }
}

const once = new Map();
/** One shared request per page for a no-argument RPC (several containers share it); a failure can be retried. */
export function rpcOnce(fn) {
  if (!once.has(fn)) once.set(fn, rpc(fn).catch((e) => { once.delete(fn); throw e; }));
  return once.get(fn);
}

export const pageLang = () => (document.documentElement.lang === 'en' ? 'en' : 'he');
export const strings = () => config.i18n[pageLang()];
export const crmUrl = config.crmUrl;
