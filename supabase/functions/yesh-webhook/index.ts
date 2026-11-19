// "יש חשבונית" (yeshlee.co.il) payment webhook for Hemshech Tnua CRM.
//
// The provider calls this on "document created" (a document issued with status issued: the receipt after a payment on
// its payment page). It has no signature, so the URL carries a long random key:
//
//   POST https://<project>.supabase.co/functions/v1/yesh-webhook?key=<YESH_WEBHOOK_KEY>
//
// Accepted body: JSON, or form-encoded (fields at the top level, or a ReturnValue / data field holding JSON), up to
// 32 KB. Only these fields are read, case-insensitively, from ReturnValue (or the top level): docNumber, docType, price
// (a number or a string; the total), customerPhone, customerName, date. Everything else in the body is ignored, and the
// database validates the fields again (public.service_yesh_payment → private.yesh_payment, migration
// 20261106002700_pay_before_register.sql), matches the phone to a pending registration, and is idempotent on the
// document number.
//
// Answers: 404 {} for a missing or wrong key (no detail), 413 for a body over 32 KB, 429 when flooded, 200
// {ok, result: matched|unmatched|duplicate|ignored} otherwise, 500 when the database could not be reached (so the
// provider may retry). GET with the right key answers 200 {ok: true} without touching anything (a setup check).
// Server to server only: no CORS headers, so a browser page cannot read the answers.
//
// Runs with the service role. Secrets: YESH_WEBHOOK_KEY (at least 32 characters). No third-party imports.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!;
const WEBHOOK_KEY = Deno.env.get('YESH_WEBHOOK_KEY') ?? '';
const MAX_BODY = 32 * 1024;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const notFound = () => reply(404, {});

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Constant time: both sides are hashed to 32 bytes first, so neither the length nor the first differing character of
// the configured key shows in the timing. An unset (or too short) key accepts nothing.
async function keyMatches(given: string): Promise<boolean> {
  if (WEBHOOK_KEY.length < 32 || !given || given.length > 256) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(WEBHOOK_KEY)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function rpc(fn: string, args: unknown): Promise<{ ok: boolean; data: unknown }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: r.ok, data };
}

/** The body, read up to the cap (a missing or false Content-Length must not let a large body through). */
async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function tryJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** JSON or form-encoded; a form field that holds JSON (ReturnValue, data) is opened too. */
function parseBody(text: string, contentType: string): Obj | null {
  const t = text.trim();
  if (!t) return null;
  if (/json/i.test(contentType) || t.startsWith('{')) {
    const j = tryJson(t);
    return isObj(j) ? j : null;
  }
  const out: Obj = {};
  for (const [k, v] of new URLSearchParams(t)) out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** A field by name, any letter case, as a string. */
function field(o: Obj, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(o)) {
    if (k.toLowerCase() !== want) continue;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** "189.74", 189.74, "1,234.50", "₪ 20" → a number; anything else → null. */
function amountOf(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/[,\s₪]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The document out of the provider's envelope ({Success, ErrorMessage, ReturnValue}), or the body itself. */
function documentOf(body: Obj): Obj | null {
  const success = field(body, 'Success');
  if (success && /^(false|0)$/i.test(success)) return null;
  if (body.Success === false) return null;
  for (const k of Object.keys(body)) {
    if (!['returnvalue', 'data', 'document'].includes(k.toLowerCase())) continue;
    const v = body[k];
    if (isObj(v)) return v;
    if (typeof v === 'string') {
      const j = tryJson(v);
      if (isObj(j)) return j;
    }
  }
  return body;
}

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || req.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
    || 'unknown';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return notFound();
  if (!(await keyMatches(new URL(req.url).searchParams.get('key') ?? ''))) return notFound();

  // a leaked key must not let anyone flood the database: per caller, generous for a payment page's real traffic
  const ip = [...(await sha256(clientIp(req)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const rl = await rpc('service_rate_limit', { p_bucket: `yesh-hook:${ip}`, p_limit: 300, p_window_seconds: 600 });
  if (!rl.ok) return reply(429, { error: 'rate_limited' });

  if (req.method === 'GET') return reply(200, { ok: true });

  const text = await readCapped(req);
  if (text == null) return reply(413, { error: 'too_large' });
  const body = parseBody(text, req.headers.get('content-type') ?? '');
  const doc = body ? documentOf(body) : null;
  if (!doc) return reply(200, { ok: true, result: 'ignored' });

  let amount = amountOf(field(doc, 'price'));
  if (amount == null && Array.isArray(doc.payments)) {
    // no total on the document: the sum of its payments
    amount = (doc.payments as unknown[]).reduce<number>((s, p) => s + (isObj(p) ? amountOf(field(p, 'price')) ?? 0 : 0), 0) || null;
  }
  const res = await rpc('service_yesh_payment', {
    p: {
      doc_number: field(doc, 'docNumber'),
      doc_type: field(doc, 'docType'),
      amount,
      phone: field(doc, 'customerPhone'),
      customer_name: field(doc, 'customerName'),
      doc_date: field(doc, 'date'),
    },
  });
  if (!res.ok || !isObj(res.data)) {
    console.error('yesh-webhook: the database call failed');
    return reply(500, { error: 'failed' });
  }
  const result = String(res.data.result ?? 'ignored');
  console.log(`yesh-webhook: ${result}`);
  return reply(200, { ok: true, result });
});
