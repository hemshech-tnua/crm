// Participant payments and the per-meeting finance snapshot (migration 20261106002300_payments.sql).
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { makeEvent, registration, staff, visitor } from './helpers';
import { DB_URL } from './env';

const PAY_URL = 'https://pay.example.org/p/friday-20?x=1';
const sql = (q: string) => execSync(`psql "${DB_URL}" -q -v ON_ERROR_STOP=1 -Atc "${q}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

async function register(code: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await visitor().rpc('public_register', { p: registration(code, extra) });
  expect(error).toBeNull();
  return data as { status: string; token: string; event: Record<string, unknown> };
}
/** The newest registration of a meeting (only a hash of the personal token is stored). */
async function regId(eventId: string) {
  const coord = await staff('coord');
  const { data } = await coord.from('registrations').select('id').eq('event_id', eventId).order('created_at', { ascending: false }).limit(1).single();
  return data!.id as string;
}

describe('a priced meeting', () => {
  it('shows the price and the payment link publicly, and a public registration owes the fee', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, payment_note: 'אפשר לשלם גם במקום' });
    const v = visitor();
    const { data: pub, error } = await v.rpc('public_get_event', { p_code: ev.public_code });
    expect(error).toBeNull();
    expect(pub.price).toBe(20);
    expect(pub.payment_url).toBe(PAY_URL);
    expect(pub.payment_note).toBe('אפשר לשלם גם במקום');
    const { data: list } = await v.rpc('public_list_events');
    expect((list as Record<string, unknown>[]).every((e) => 'price' in e && 'payment_url' in e)).toBe(true);

    const r = await register(ev.public_code);
    expect(r.status).toBe('registered');
    expect(r.event.price).toBe(20);
    expect(r.event.payment_url).toBe(PAY_URL);
    const { data: mine } = await visitor().rpc('public_registration', { p_token: r.token });
    expect(mine.payment_status).toBe('pending');
    expect(mine.event.price).toBe(20);
    expect(mine.event.payment_url).toBe(PAY_URL);
  });

  it('a waitlisted registration also starts pending, but is not counted as owed', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, capacity: 1 });
    await register(ev.public_code);
    const w = await register(ev.public_code);
    expect(w.status).toBe('waitlisted');
    const { data: mine } = await visitor().rpc('public_registration', { p_token: w.token });
    expect(mine.payment_status).toBe('pending');
    const { data: f } = await (await staff('coord')).rpc('staff_event_finance', { p_event_id: ev.id });
    expect(f.income.pending_count).toBe(1);
    expect(f.income.expected).toBe(20);
  });

  it('staff mark payment; the finance snapshot adds up with the supplier payments', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL });
    const a = await register(ev.public_code);
    const idA = await regId(ev.id);
    await register(ev.public_code);
    await register(ev.public_code);
    const idC = await regId(ev.id);

    // the payment columns cannot be written directly, only through the function
    await coord.from('registrations').update({ payment_status: 'paid', paid_amount: 999 }).eq('id', idA);
    const { data: still } = await coord.from('registrations').select('payment_status, paid_amount').eq('id', idA).single();
    expect(still).toEqual({ payment_status: 'pending', paid_amount: null });

    const { data: paid, error } = await coord.rpc('staff_set_payment', { p_registration_id: idA, p_status: 'paid', p_method: 'bit', p_ref: 'BIT-1234' });
    expect(error).toBeNull();
    expect(paid.payment_status).toBe('paid');
    expect(paid.paid_amount).toBe(20); // the meeting's price by default
    expect(paid.payment_method).toBe('bit');
    expect(paid.paid_at).not.toBeNull();
    const { data: mine } = await visitor().rpc('public_registration', { p_token: a.token });
    expect(mine.payment_status).toBe('paid');

    expect((await coord.rpc('staff_set_payment', { p_registration_id: idC, p_status: 'waived', p_ref: 'אורח של המרצה' })).error).toBeNull();
    // validation
    expect((await coord.rpc('staff_set_payment', { p_registration_id: idC, p_status: 'maybe' })).error?.message).toBe('invalid_payment_status');
    expect((await coord.rpc('staff_set_payment', { p_registration_id: idC, p_status: 'paid', p_amount: -5 })).error?.message).toBe('invalid_amount');
    expect((await coord.rpc('staff_set_payment', { p_registration_id: idC, p_status: 'paid', p_method: 'crypto' })).error?.message).toBe('invalid_payment_method');
    expect((await coord.rpc('staff_set_payment', { p_registration_id: idC, p_status: 'refunded' })).error?.message).toBe('not_paid');

    // supplier payments for the meeting (event_payments): 300 paid, 150 not yet
    const { error: e1 } = await coord.from('event_payments').insert([
      { event_id: ev.id, supplier: 'קייטרינג בדיקה', amount: 300, paid_on: '2026-11-10' },
      { event_id: ev.id, supplier: 'מרצה בדיקה', amount: 150 },
    ]);
    expect(e1).toBeNull();

    const { data: f, error: e2 } = await coord.rpc('staff_event_finance', { p_event_id: ev.id });
    expect(e2).toBeNull();
    expect(f.price).toBe(20);
    expect(f.has_payment_link).toBe(true);
    expect(f.registered).toBe(3);
    expect(f.income).toEqual({
      expected: 40, collected: 20, paid_count: 1, pending_count: 1, pending_amount: 20, waived_count: 1, refunded_count: 0, refunded_amount: 0,
    });
    expect(f.expenses).toEqual({ count: 2, total: 450, paid: 300, unpaid: 150 });
    expect(f.net).toBe(20 - 300);
    expect(f.projected_net).toBe(40 - 450);

    // the period report has the meeting and its totals
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(ev.starts_at));
    const { data: sum, error: e3 } = await coord.rpc('staff_finance_summary', { p_from: day, p_to: day });
    expect(e3).toBeNull();
    const row = sum.rows.find((x: { event_id: string }) => x.event_id === ev.id);
    expect(row).toMatchObject({ registered: 3, paid_count: 1, collected: 20, expenses: 450, net: -280, type: 'friday' });
    expect(sum.totals.events).toBe(sum.rows.length);
    expect(sum.totals.collected).toBeGreaterThanOrEqual(20);

    // refund keeps the amount; the audit log has every change with its amount and method
    const { data: ref } = await coord.rpc('staff_set_payment', { p_registration_id: idA, p_status: 'refunded' });
    expect(ref).toMatchObject({ payment_status: 'refunded', paid_amount: 20 });
    const admin = await staff('admin');
    const { data: log } = await admin.from('audit_log').select('details').eq('entity', 'registrations').eq('entity_id', idA).order('id');
    const details = (log ?? []).map((l) => l.details as Record<string, unknown> | null).filter((d) => d && 'payment_status' in d);
    expect(details.map((d) => d!.payment_status)).toEqual(['pending', 'paid', 'refunded']);
    expect(details[1]).toMatchObject({ paid_amount: 20, payment_method: 'bit' });
  });

  it('the payment link must be https', async () => {
    const coord = await staff('coord');
    for (const bad of ['http://pay.example.org/x', 'javascript:alert(1)', 'https://', 'https://pay example.org', `https://pay.example.org/${'x'.repeat(500)}`]) {
      await expect(makeEvent({ price: 20, payment_url: bad }), bad).rejects.toBeTruthy();
    }
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL });
    const { error } = await coord.from('events').update({ payment_url: 'http://pay.example.org/x' }).eq('id', ev.id);
    expect(error).not.toBeNull();
    await expect(makeEvent({ price: -1 })).rejects.toBeTruthy();
  });

  it('a free meeting keeps "none"; setting a price later makes the active registrations pending, removing it undoes that', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent();
    const r = await register(ev.public_code);
    expect((await visitor().rpc('public_registration', { p_token: r.token })).data.payment_status).toBe('none');
    const { data: pub } = await visitor().rpc('public_get_event', { p_code: ev.public_code });
    expect(pub.price).toBeNull();
    expect(pub.payment_url).toBeNull();

    // a free meeting cannot be "paid at the door" and has no money in its snapshot
    const { data: f0 } = await coord.rpc('staff_event_finance', { p_event_id: ev.id });
    expect(f0.price).toBeNull();
    expect(f0.income.expected).toBe(0);

    await coord.from('events').update({ price: 20 }).eq('id', ev.id);
    expect((await visitor().rpc('public_registration', { p_token: r.token })).data.payment_status).toBe('pending');
    await coord.from('events').update({ price: 0 }).eq('id', ev.id);
    expect((await visitor().rpc('public_registration', { p_token: r.token })).data.payment_status).toBe('none');
  });
});

describe('who may mark payment', () => {
  it('the door team and visitors cannot call the staff payment and finance functions', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, startsInMinutes: 30 });
    await register(ev.public_code);
    const id = await regId(ev.id);
    const calls: [string, Record<string, unknown>][] = [
      ['staff_set_payment', { p_registration_id: id, p_status: 'paid' }],
      ['staff_event_finance', { p_event_id: ev.id }],
      ['staff_finance_summary', { p_from: '2026-01-01', p_to: '2026-12-31' }],
    ];
    const door = await staff('door');
    for (const [fn, args] of calls) {
      expect((await door.rpc(fn, args)).error?.message, `door ${fn}`).toBe('forbidden');
      expect((await visitor().rpc(fn, args)).error, `anon ${fn}`).not.toBeNull();
    }
    expect((await visitor().rpc('staff_door_payment', { p_registration_id: id })).error).not.toBeNull();
  });

  it('the door team marks cash at the entrance (and can undo a wrong tap), on the meeting day only', async () => {
    const door = await staff('door');
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL, startsInMinutes: 30 });
    await register(ev.public_code);
    const id = await regId(ev.id);

    const { data: list } = await door.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(list[0].payment_status).toBe('pending');

    const { data, error } = await door.rpc('staff_door_payment', { p_registration_id: id });
    expect(error).toBeNull();
    expect(data).toMatchObject({ payment_status: 'paid', paid_amount: 20, payment_method: 'cash' });
    expect((await door.rpc('staff_door_payment', { p_registration_id: id })).data.already).toBe(true);
    const { data: list2 } = await door.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(list2[0]).toMatchObject({ payment_status: 'paid', cash_just_marked: true });
    expect((await door.rpc('staff_door_payment', { p_registration_id: id, p_paid: false })).data.payment_status).toBe('pending');

    // a meeting on another day: no access
    const later = await makeEvent({ price: 20, startsInMinutes: 5 * 24 * 60 });
    await register(later.public_code);
    const id2 = await regId(later.id);
    expect((await door.rpc('staff_door_payment', { p_registration_id: id2 })).error?.message).toBe('forbidden');
    // a free meeting: nothing to pay
    const free = await makeEvent({ startsInMinutes: 30 });
    await register(free.public_code);
    const id3 = await regId(free.id);
    expect((await door.rpc('staff_door_payment', { p_registration_id: id3 })).error?.message).toBe('not_priced');
  });

  it('the provider hook marks paid once, for the service role only', async () => {
    const ev = await makeEvent({ price: 20, payment_url: PAY_URL });
    const r = await register(ev.public_code);
    const id = await regId(ev.id);
    const call = (role: string, ref: string) =>
      sql(`set role ${role}; select private.mark_paid_by_provider('${id}', 20, '${ref}')::text`);
    expect(() => call('authenticated', 'TX-1')).toThrow();
    expect(() => call('anon', 'TX-1')).toThrow();
    expect(JSON.parse(call('service_role', 'TX-1'))).toMatchObject({ payment_status: 'paid', paid_amount: 20, payment_method: 'card', payment_ref: 'TX-1' });
    // a retried callback changes nothing
    expect(JSON.parse(call('service_role', 'TX-1'))).toMatchObject({ already: true, same_ref: true });
    const { data: mine } = await visitor().rpc('public_registration', { p_token: r.token });
    expect(mine.payment_status).toBe('paid');
  });
});
