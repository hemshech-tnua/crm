// Pay before registering (migration 20261106002700_pay_before_register.sql) and the "יש חשבונית" webhook
// (supabase/functions/yesh-webhook). Needs the local edge runtime serving the functions with YESH_WEBHOOK_KEY set in
// supabase/functions/.env (see docs/08-payments-webhook.md).
import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { e164, makeEvent, registration, staff, visitor } from './helpers';
import { API_URL, DB_URL } from './env';

const PAY_URL = 'https://app.yeshlee.co.il/pay/friday-e2e';
const sql = (q: string) => execSync(`psql "${DB_URL}" -q -v ON_ERROR_STOP=1 -Atc "${q}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function webhookKey(): string {
  let text = '';
  try {
    text = readFileSync(new URL('../../supabase/functions/.env', import.meta.url), 'utf8');
  } catch {
    // reported below
  }
  const key = /^YESH_WEBHOOK_KEY=(.+)$/m.exec(text)?.[1]?.trim();
  if (!key) throw new Error('supabase/functions/.env needs YESH_WEBHOOK_KEY (a fake local value), and `npx supabase functions serve` running');
  return key;
}
let KEY = '';
const HOOK = `${API_URL}/functions/v1/yesh-webhook`;

/** Posts a document the way the provider does (its sample body), JSON or form-encoded. */
async function hook(doc: Record<string, unknown>, opts: { key?: string; form?: boolean; raw?: string } = {}) {
  const url = `${HOOK}?key=${encodeURIComponent(opts.key ?? KEY)}`;
  const envelope = { Success: true, ErrorMessage: 'OK', ReturnValue: { docType: 8, currencyID: 1, title: 'עבור השתתפות', customerEmail: 'x@example.test', ...doc } };
  const init: RequestInit = opts.raw != null
    ? { method: 'POST', body: opts.raw, headers: { 'Content-Type': 'application/json' } }
    : opts.form
      ? { method: 'POST', body: new URLSearchParams(Object.entries(doc).map(([k, v]) => [k, String(v)])).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      : { method: 'POST', body: JSON.stringify(envelope), headers: { 'Content-Type': 'application/json' } };
  const r = await fetch(url, init);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const docNo = () => `T${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;

async function register(code: string, extra: Record<string, unknown> = {}) {
  const reg = registration(code, extra);
  const { data, error } = await visitor().rpc('public_register', { p: reg });
  expect(error).toBeNull();
  return { reg, res: data as { status: string; token: string; first_name: string; invite_code: string | null; event: Record<string, unknown> } };
}
const info = async (token: string) => (await visitor().rpc('public_registration', { p_token: token })).data as Record<string, unknown>;
async function regOf(eventId: string, phoneLocal: string) {
  const coord = await staff('coord');
  const { data } = await coord.from('registrations').select('id, status, payment_status, paid_amount, payment_method, payment_ref, participant:participants!registrations_participant_id_fkey!inner(phone)')
    .eq('event_id', eventId).eq('participant.phone', e164(phoneLocal)).single();
  return data as unknown as { id: string; status: string; payment_status: string; paid_amount: number | null; payment_method: string | null; payment_ref: string | null };
}

beforeAll(() => {
  KEY = webhookKey();
});

describe('a meeting with a fee and a payment link', () => {
  it('submitting the form does not register: pending payment, no place held, the personal link knows the payer', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, capacity: 1 });
    const { reg, res } = await register(ev.public_code);
    expect(res.status).toBe('pending_payment');
    expect(res.token).toMatch(/.{20,}/);
    expect(res.event).toMatchObject({ price: 20, payment_url: PAY_URL, is_full: false });

    const mine = await info(res.token);
    expect(mine).toMatchObject({ status: 'pending_payment', payment_status: 'pending', full_name: reg.full_name, phone: e164(reg.phone) });
    // a second person also gets the pay step: a pending registration holds no place (capacity 1)
    const other = await register(ev.public_code);
    expect(other.res.status).toBe('pending_payment');
    const { data: pub } = await visitor().rpc('public_get_event', { p_code: ev.public_code });
    expect(pub.is_full).toBe(false);
    expect(pub.spots_left).toBe(1);

    // not on the door list, not registered in the stats or the finance snapshot
    const coord = await staff('coord');
    const { data: list } = await coord.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(list).toEqual([]);
    const { data: st } = await coord.from('event_stats').select('registered_count, waitlisted_count').eq('event_id', ev.id).single();
    expect(st).toEqual({ registered_count: 0, waitlisted_count: 0 });
    const { data: f } = await coord.rpc('staff_event_finance', { p_event_id: ev.id });
    expect(f).toMatchObject({ registered: 0, started_unpaid: 2, income: { expected: 0, collected: 0, pending_count: 0 } });
  });

  it('asking again: the same pending registration (and the same link when the page sends it back); a paid one is "already registered"', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL });
    const { reg, res } = await register(ev.public_code);
    const again = (await visitor().rpc('public_register', { p: { ...reg, token: res.token } })).data;
    expect(again.status).toBe('pending_payment');
    expect(again.token).toBe(res.token);
    // without the token (another device, or someone who only knows the phone and name): "pay", but no new link and no
    // change to the registration, so nobody can take it over; the person's own link keeps working
    const third = (await visitor().rpc('public_register', { p: reg })).data;
    expect(third.status).toBe('pending_payment');
    expect(third.token).toBeNull();
    expect((await visitor().rpc('public_registration', { p_token: res.token })).error).toBeNull();
    expect(await info(res.token)).toMatchObject({ status: 'pending_payment' });
    const wrongToken = (await visitor().rpc('public_register', { p: { ...reg, token: 'x'.repeat(40) } })).data;
    expect(wrongToken.token).toBeNull();
    expect(await info(res.token)).toMatchObject({ status: 'pending_payment' });
    const coord = await staff('coord');
    const { count } = await coord.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', ev.id);
    expect(count).toBe(1);
    // someone else on the same phone is still told the phone is in use
    const other = (await visitor().rpc('public_register', { p: { ...reg, full_name: 'מישהו אחר לגמרי' } })).data;
    expect(other.status).toBe('phone_in_use');

    const r = await regOf(ev.id, reg.phone);
    expect((await coord.rpc('staff_confirm_payment', { p_registration_id: r.id })).error).toBeNull();
    const after = (await visitor().rpc('public_register', { p: reg })).data;
    expect(after.status).toBe('already_registered');
  });

  it('free meetings and priced meetings without a link keep today\'s flow', async () => {
    const free = await makeEvent();
    expect((await register(free.public_code)).res.status).toBe('registered');
    const noLink = await makeEvent({ price: 20 });
    const { res } = await register(noLink.public_code);
    expect(res.status).toBe('registered');
    expect((await info(res.token)).payment_status).toBe('pending');
    expect((await info(res.token)).full_name).toBeNull();
    // a full pay-first meeting: the waitlist as today (nobody pays to wait)
    const full = await makeEvent({ price: 20, payment_url: PAY_URL, capacity: 1 });
    const first = await register(full.public_code);
    await (await staff('coord')).rpc('staff_confirm_payment', { p_registration_id: (await regOf(full.id, first.reg.phone)).id });
    expect((await register(full.public_code)).res.status).toBe('waitlisted');
  });
});

describe('the יש חשבונית webhook', () => {
  it('rejects a missing or wrong key with a bare 404, and caps the body at 32 KB', async () => {
    expect((await fetch(HOOK, { method: 'POST', body: '{}' })).status).toBe(404);
    const wrong = await hook({ docNumber: docNo(), price: 20 }, { key: 'x'.repeat(48) });
    expect(wrong).toEqual({ status: 404, body: {} });
    expect((await hook({}, { key: KEY.slice(0, -1) })).status).toBe(404);
    expect((await hook({}, { raw: `{"pad":"${'a'.repeat(33 * 1024)}"}` })).status).toBe(413);
    // GET with the key: a setup check that touches nothing
    expect((await fetch(`${HOOK}?key=${KEY}`)).status).toBe(200);
  });

  it('matches the phone (05x, +9725x, 9725x) to the pending registration: paid by card and registered; a retry changes nothing', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL });
    for (const fmt of [(p: string) => p, (p: string) => e164(p), (p: string) => e164(p).slice(1), (p: string) => `${p.slice(0, 3)}-${p.slice(3)}`]) {
      const { reg, res } = await register(ev.public_code);
      const doc = docNo();
      const out = await hook({ docNumber: doc, price: '20.00', customerName: 'Ploni', customerPhone: fmt(reg.phone), date: '2026-11-19 17:35' });
      expect(out).toEqual({ status: 200, body: { ok: true, result: 'matched' } });
      expect(await info(res.token)).toMatchObject({ status: 'registered', payment_status: 'paid' });
      expect(await regOf(ev.id, reg.phone)).toMatchObject({ status: 'registered', payment_status: 'paid', paid_amount: 20, payment_method: 'card', payment_ref: doc });
      // the same document again (the provider retries): nothing changes
      expect((await hook({ docNumber: doc, price: 20, customerPhone: reg.phone })).body.result).toBe('duplicate');
    }
    // form-encoded, flat fields
    const { reg, res } = await register(ev.public_code);
    expect((await hook({ docNumber: docNo(), price: 25, customerPhone: reg.phone }, { form: true })).body.result).toBe('matched');
    expect((await info(res.token)).status).toBe('registered');
  });

  it('pays less than the price, or an unknown phone: kept as unmatched for the team; the registration stays pending', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL });
    const { reg, res } = await register(ev.public_code);
    const doc = docNo();
    // 25 > 20 so the meeting is a plausible subject, but the phone is not registered anywhere
    expect((await hook({ docNumber: doc, price: 25, customerName: 'לא רשום', customerPhone: '0529999' + String(Date.now()).slice(-3) })).body.result).toBe('unmatched');
    expect((await info(res.token)).status).toBe('pending_payment');
    const coord = await staff('coord');
    const { data: list } = await coord.rpc('staff_unmatched_payments', { p_event_id: ev.id });
    const u = (list as { id: string; doc_number: string; amount: number; candidates: { registration_id: string; phone_match: boolean }[] }[]).find((x) => x.doc_number === doc)!;
    expect(u).toMatchObject({ amount: 25 });
    const target = await regOf(ev.id, reg.phone);
    expect(u.candidates.map((c) => c.registration_id)).toContain(target.id);
    // attach it: paid with the document's amount and number, and registered
    const { data: att, error } = await coord.rpc('staff_attach_payment', { p_payment_id: u.id, p_registration_id: target.id });
    expect(error).toBeNull();
    expect(att).toMatchObject({ status: 'registered', payment_status: 'paid', paid_amount: 25, payment_ref: doc });
    expect((await coord.rpc('staff_attach_payment', { p_payment_id: u.id, p_registration_id: target.id })).error?.message).toBe('already_resolved');
    // a less-than-price payment does not register anyone
    const two = await register(ev.public_code);
    const low = await hook({ docNumber: docNo(), price: 5, customerPhone: two.reg.phone });
    expect(['unmatched', 'ignored']).toContain(low.body.result);
    expect((await info(two.res.token)).status).toBe('pending_payment');
    // dismiss
    const d2 = docNo();
    await hook({ docNumber: d2, price: 30, customerPhone: '0528888' + String(Date.now()).slice(-3) });
    const id2 = ((await coord.rpc('staff_unmatched_payments')).data as { id: string; doc_number: string }[]).find((x) => x.doc_number === d2)!.id;
    expect((await coord.rpc('staff_dismiss_payment', { p_payment_id: id2 })).data).toMatchObject({ status: 'dismissed' });
    expect(((await coord.rpc('staff_unmatched_payments')).data as { doc_number: string }[]).some((x) => x.doc_number === d2)).toBe(false);
  });

  it('a receipt never marks a place paid at a meeting without a payment link (fee at the entrance)', async () => {
    const ev = await makeEvent({ price: 20 });
    const { reg } = await register(ev.public_code);
    expect((await regOf(ev.id, reg.phone))).toMatchObject({ status: 'registered', payment_status: 'pending' });
    const out = await hook({ docNumber: docNo(), price: 300, customerName: 'Ploni', customerPhone: reg.phone, date: '2026-11-19 17:35' });
    expect(out.body.result).not.toBe('matched');
    expect((await regOf(ev.id, reg.phone))).toMatchObject({ status: 'registered', payment_status: 'pending', payment_ref: null });
  });

  it('no document number, no positive amount, Success false: ignored, nothing stored', async () => {
    expect((await hook({ price: 20, customerPhone: '0501234567' })).body.result).toBe('ignored');
    expect((await hook({ docNumber: docNo(), price: 0 })).body.result).toBe('ignored');
    expect((await hook({}, { raw: JSON.stringify({ Success: false, ReturnValue: { docNumber: docNo(), price: 20 } }) })).body.result).toBe('ignored');
    expect((await hook({}, { raw: 'not json at all' })).status).toBe(200);
  });

  it('paid after the places ran out: on the waitlist (paid) with a task for the team', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, capacity: 1 });
    const a = await register(ev.public_code);
    const b = await register(ev.public_code);
    expect((await hook({ docNumber: docNo(), price: 20, customerPhone: a.reg.phone })).body.result).toBe('matched');
    expect((await info(a.res.token)).status).toBe('registered');
    expect((await hook({ docNumber: docNo(), price: 20, customerPhone: b.reg.phone })).body.result).toBe('matched');
    expect(await info(b.res.token)).toMatchObject({ status: 'waitlisted', payment_status: 'paid', waitlist_position: 1 });
    const coord = await staff('coord');
    const r = await regOf(ev.id, b.reg.phone);
    const { data: tasks } = await coord.from('follow_ups').select('type, title, status').eq('event_id', ev.id);
    expect(tasks).toEqual([{ type: 'payment', title: 'תשלום התקבל ואין מקום פנוי', status: 'open' }]);
    expect(r.status).toBe('waitlisted');
  });
});

describe('staff', () => {
  it('confirm a payment by hand (אישור תשלום): registered; only admin and coordinator; only a pending registration', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, startsInMinutes: 60 });
    const { reg, res } = await register(ev.public_code);
    const r = await regOf(ev.id, reg.phone);
    const door = await staff('door');
    expect((await door.rpc('staff_confirm_payment', { p_registration_id: r.id })).error?.message).toBe('forbidden');
    expect((await visitor().rpc('staff_confirm_payment', { p_registration_id: r.id })).error).not.toBeNull();
    // the door cannot take cash for a registration that was never completed
    expect((await door.rpc('staff_door_payment', { p_registration_id: r.id })).error?.message).toBe('payment_not_pending');
    const coord = await staff('coord');
    const { data, error } = await coord.rpc('staff_confirm_payment', { p_registration_id: r.id, p_amount: 20, p_ref: 'R-77' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: 'registered', payment_status: 'paid', paid_amount: 20, payment_method: 'card', payment_ref: 'R-77' });
    expect((await info(res.token)).status).toBe('registered');
    expect((await coord.rpc('staff_confirm_payment', { p_registration_id: r.id })).error?.message).toBe('not_pending');
    // now on the door list
    const { data: list } = await door.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(list).toHaveLength(1);
  });

  it('a pending person who turns up is checked in as a walk-in (and pays at the door)', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, startsInMinutes: 30 });
    const { reg } = await register(ev.public_code);
    const r = await regOf(ev.id, reg.phone);
    const coord = await staff('coord');
    const { data: pid } = await coord.from('registrations').select('participant_id').eq('id', r.id).single();
    expect((await coord.rpc('staff_checkin_existing', { p_event_id: ev.id, p_participant_id: pid!.participant_id })).error).toBeNull();
    const { data: row } = await coord.from('registrations').select('status, attendance, is_walk_in, payment_status').eq('id', r.id).single();
    expect(row).toEqual({ status: 'registered', attendance: 'attended', is_walk_in: true, payment_status: 'pending' });
    expect((await (await staff('door')).rpc('staff_door_payment', { p_registration_id: r.id })).data).toMatchObject({ payment_status: 'paid', payment_method: 'cash' });
  });

  it('the unmatched payments table: admin and coordinator read it, nobody writes it directly', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL });
    void ev;
    const doc = docNo();
    expect((await hook({ docNumber: doc, price: 40, customerName: 'בדיקת הרשאות', customerPhone: '0527777' + String(Date.now()).slice(-3) })).body.result).toBe('unmatched');
    const coord = await staff('coord');
    const admin = await staff('admin');
    for (const c of [coord, admin]) {
      const { data } = await c.from('unmatched_payments').select('doc_number').eq('doc_number', doc);
      expect(data).toEqual([{ doc_number: doc }]);
    }
    const { data: dd } = await (await staff('door')).from('unmatched_payments').select('*').limit(5);
    expect(dd ?? []).toEqual([]);
    expect((await visitor().from('unmatched_payments').select('*').limit(1)).error).not.toBeNull();
    const ins = await coord.from('unmatched_payments').insert({ doc_number: 'FAKE-1', amount: 10 });
    expect(ins.error).not.toBeNull();
    const { data: upd } = await coord.from('unmatched_payments').update({ status: 'dismissed' }).eq('doc_number', doc).select();
    expect(upd ?? []).toEqual([]);
    expect((await (await staff('door')).rpc('staff_unmatched_payments')).error?.message).toBe('forbidden');
    // the settings status is for admins
    expect((await coord.rpc('staff_payment_webhook_status')).error?.message).toBe('forbidden');
    const { data: st } = await admin.rpc('staff_payment_webhook_status');
    expect(st.last_received_at).not.toBeNull();
    expect(st.unmatched_open).toBeGreaterThan(0);
  });

  it('the webhook entry point is for the service role only', () => {
    const call = (role: string) => sql(`set role ${role}; select public.service_yesh_payment('{}'::jsonb)::text`);
    expect(() => call('anon')).toThrow();
    expect(() => call('authenticated')).toThrow();
    expect(JSON.parse(call('service_role'))).toEqual({ result: 'ignored' });
    for (const fn of ['private.yesh_payment(jsonb)', 'private.place_paid_registration(uuid)', 'private.lock_registration(uuid)']) {
      expect(sql(`select has_function_privilege('authenticated', '${fn}', 'execute') or has_function_privilege('anon', '${fn}', 'execute')`), fn).toBe('f');
    }
  });
});
