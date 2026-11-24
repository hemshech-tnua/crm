// No confirmed place without payment (migration 20261106002800_pay_guarantee.sql). Every path that can make a registration
// 'registered' or 'attended' at a meeting with a fee, for every role: public, door, coordinator, admin, the webhook.
// Needs the local edge runtime serving yesh-webhook with YESH_WEBHOOK_KEY in supabase/functions/.env.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { e164, legacyUnpaid, makeEvent, name, phone, registration, staff, visitor } from './helpers';
import { API_URL, DB_URL } from './env';

const PAY_URL = 'https://app.yeshlee.co.il/pay/friday-guarantee';
const KEY = /^YESH_WEBHOOK_KEY=(.+)$/m.exec(readFileSync(new URL('../../supabase/functions/.env', import.meta.url), 'utf8'))?.[1]?.trim() ?? '';
const sql = (q: string) => execSync(`psql "${DB_URL}" -q -v ON_ERROR_STOP=1 -Atc "${q}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

async function hook(customerPhone: string, price = 20) {
  const r = await fetch(`${API_URL}/functions/v1/yesh-webhook?key=${encodeURIComponent(KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Success: true, ReturnValue: { docNumber: `G${Date.now().toString(36)}${randomUUID().slice(0, 6)}`, docType: 8, price, customerPhone } }),
  });
  return (await r.json()) as { result: string };
}

/** A meeting with a fee and a link, around now (the door and the self check-in are open). */
const paidMeeting = (extra: Record<string, unknown> = {}) => makeEvent({ price: 20, payment_url: PAY_URL, startsInMinutes: 10, ...extra });

async function card(full = name(), ph = phone()) {
  const coord = await staff('coord');
  const { data, error } = await coord.from('participants').insert({ full_name: full, phone: ph }).select('id').single();
  if (error) throw error;
  return { id: data!.id as string, full, ph };
}
async function row(id: string) {
  const { data } = await (await staff('coord')).from('registrations')
    .select('status, attendance, payment_status, payment_method, paid_amount, is_walk_in').eq('id', id).single();
  return data!;
}
async function regFor(eventId: string, participantId: string) {
  const { data } = await (await staff('coord')).from('registrations').select('id, status, payment_status, attendance')
    .eq('event_id', eventId).eq('participant_id', participantId).maybeSingle();
  return data;
}

describe('the rule in the database', () => {
  it('a coordinator cannot write a confirmed or arrived place without payment straight into the table', async () => {
    const coord = await staff('coord');
    const admin = await staff('admin');
    const ev = await paidMeeting();
    const a = await card();
    for (const [who, c] of [['coord', coord], ['admin', admin]] as const) {
      const ins = await c.from('registrations').insert({ event_id: ev.id, participant_id: a.id, status: 'registered' });
      expect(ins.error?.message, who).toBe('payment_required');
      const arrived = await c.from('registrations').insert({ event_id: ev.id, participant_id: a.id, status: 'waitlisted', attendance: 'attended' });
      expect(arrived.error?.message, who).toBe('payment_required');
    }
    // a pending one, then made registered by an UPDATE: refused, also with forged payment columns (they are ignored)
    expect((await coord.from('registrations').insert({ event_id: ev.id, participant_id: a.id, status: 'pending_payment' })).error).toBeNull();
    const r = (await regFor(ev.id, a.id))!;
    const up = await coord.from('registrations').update({ status: 'registered', payment_status: 'paid', paid_amount: 20 }).eq('id', r.id);
    expect(up.error?.message).toBe('payment_required');
    expect((await coord.from('registrations').update({ status: 'waitlisted' }).eq('id', r.id)).error).toBeNull();
    expect((await coord.from('registrations').update({ status: 'registered' }).eq('id', r.id)).error?.message).toBe('payment_required');
    expect((await coord.from('registrations').update({ attendance: 'attended' }).eq('id', r.id)).error?.message).toBe('payment_required');
    expect(await row(r.id)).toMatchObject({ status: 'waitlisted', payment_status: 'pending', attendance: 'unknown' });
    // the door team and visitors have no table access at all
    expect((await (await staff('door')).from('registrations').update({ status: 'registered' }).eq('id', r.id).select()).data ?? []).toEqual([]);
    expect((await visitor().from('registrations').update({ status: 'registered' }).eq('id', r.id)).error).not.toBeNull();
    // a free meeting is not affected
    const free = await makeEvent();
    expect((await coord.from('registrations').insert({ event_id: free.id, participant_id: a.id, status: 'registered' })).error).toBeNull();
  });

  it('a meeting with a fee opens only with a payment link; a price is not put under unpaid confirmed places', async () => {
    const coord = await staff('coord');
    await expect(makeEvent({ price: 20 })).rejects.toMatchObject({ message: 'payment_link_required' });
    const ev = await paidMeeting();
    expect((await coord.from('events').update({ payment_url: null }).eq('id', ev.id)).error?.message).toBe('payment_link_required');
    const draft = await makeEvent({ price: 20, status: 'draft' });
    expect((await coord.from('events').update({ status: 'open' }).eq('id', draft.id)).error?.message).toBe('payment_link_required');
    expect((await coord.from('events').update({ status: 'closed' }).eq('id', draft.id)).error).toBeNull();
    // free → priced under a confirmed free place: refused (the place would stay confirmed without payment)
    const free = await makeEvent();
    const a = await card();
    await coord.rpc('staff_register', { p_event_id: free.id, p_participant_id: a.id });
    expect((await coord.from('events').update({ price: 20, payment_url: PAY_URL }).eq('id', free.id)).error?.message).toBe('price_has_registrations');
    // an edit that does not touch the price, the link or the status keeps working on an older meeting
    expect((await coord.from('events').update({ title: 'שם חדש' }).eq('id', ev.id)).error).toBeNull();
  });
});

describe('registering', () => {
  it('public: pending until paid; the webhook confirms; a cancelled paid registration comes back registered without paying again', async () => {
    const ev = await paidMeeting({ startsInMinutes: 3 * 24 * 60 });
    const reg = registration(ev.public_code);
    const { data: res } = await visitor().rpc('public_register', { p: reg });
    expect(res.status).toBe('pending_payment');
    expect((await hook(reg.phone)).result).toBe('matched');
    expect((await visitor().rpc('public_registration', { p_token: res.token })).data).toMatchObject({ status: 'registered', payment_status: 'paid' });
    expect((await visitor().rpc('public_cancel', { p_token: res.token })).error).toBeNull();
    const again = (await visitor().rpc('public_register', { p: reg })).data;
    expect(again.status).toBe('registered');
    expect((await visitor().rpc('public_registration', { p_token: again.token })).data.payment_status).toBe('paid');
  });

  it('staff_register (office): pending payment, the waitlist when full; "אישור תשלום" with the method registers', async () => {
    const coord = await staff('coord');
    const ev = await paidMeeting({ capacity: 1, startsInMinutes: 3 * 24 * 60 });
    const a = await card();
    const b = await card();
    const ra = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: a.id })).data;
    expect(ra.status).toBe('pending_payment');
    // the door and visitors cannot confirm a payment
    expect((await (await staff('door')).rpc('staff_confirm_payment', { p_registration_id: ra.registration_id })).error?.message).toBe('forbidden');
    const ok = (await coord.rpc('staff_confirm_payment', { p_registration_id: ra.registration_id, p_method: 'transfer', p_ref: 'העברה 77' })).data;
    expect(ok).toMatchObject({ status: 'registered', payment_status: 'paid', payment_method: 'transfer' });
    // full: the waitlist (nobody pays to wait), even when staff ask for over-capacity a priced place still waits for payment
    expect((await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: b.id })).data.status).toBe('waitlisted');
    const c = await card();
    expect((await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: c.id, p_over_capacity: true })).data.status).toBe('pending_payment');
    // the audit log says who confirmed and how
    const { data: log } = await (await staff('admin')).from('audit_log').select('actor_role, details').eq('entity', 'registrations')
      .eq('entity_id', ra.registration_id).order('id');
    expect(log!.some((l) => l.actor_role === 'coordinator' && (l.details as Record<string, unknown> | null)?.payment_method === 'transfer')).toBe(true);
  });

  it('promotion from the waitlist: unpaid → waiting for payment (and the webhook then confirms it); paid → registered', async () => {
    const coord = await staff('coord');
    const ev = await paidMeeting({ capacity: 1, startsInMinutes: 3 * 24 * 60 });
    const [a, b, c] = [await card(), await card(), await card()];
    const ra = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: a.id })).data.registration_id;
    await coord.rpc('staff_confirm_payment', { p_registration_id: ra });
    const rb = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: b.id })).data.registration_id;
    const rc = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: c.id })).data.registration_id;
    expect((await row(rb)).status).toBe('waitlisted');
    await coord.rpc('staff_cancel_registration', { p_registration_id: ra });
    const p = (await coord.rpc('staff_promote', { p_registration_id: rb })).data;
    expect(p.status).toBe('pending_payment');
    expect(await row(rb)).toMatchObject({ status: 'pending_payment', payment_status: 'pending' });
    // the personal link for paying can be made for it
    expect((await coord.rpc('staff_personal_link', { p_registration_id: rb })).error).toBeNull();
    expect((await hook(b.ph)).result).toBe('matched');
    expect(await row(rb)).toMatchObject({ status: 'registered', payment_status: 'paid' });
    // a waitlisted row that was paid (after the places ran out) is registered directly
    await coord.rpc('staff_set_payment', { p_registration_id: rc, p_status: 'paid', p_method: 'bit' });
    expect((await row(rc)).status).toBe('waitlisted');
    expect((await coord.rpc('staff_promote', { p_registration_id: rc, p_over_capacity: true })).data.status).toBe('registered');
  });
});

describe('the door (staff)', () => {
  it('arrival of an unpaid person only with the cash, in one call; the undo takes back the payment, the arrival and the place', async () => {
    const door = await staff('door');
    const ev = await paidMeeting();
    const legacy = legacyUnpaid(ev.id);
    expect((await door.rpc('staff_set_attendance', { p_registration_id: legacy, p_attendance: 'attended' })).error?.message).toBe('payment_required');
    expect((await row(legacy)).attendance).toBe('unknown');
    const { data, error } = await door.rpc('staff_set_attendance', { p_registration_id: legacy, p_attendance: 'attended', p_cash: true });
    expect(error).toBeNull();
    expect(data.cash_recorded).toBe(true);
    expect(await row(legacy)).toMatchObject({ status: 'registered', attendance: 'attended', payment_status: 'paid', payment_method: 'cash', paid_amount: 20 });
    // arrived and paid: un-marking the arrival keeps the paid place
    expect((await door.rpc('staff_set_attendance', { p_registration_id: legacy, p_attendance: 'unknown' })).error).toBeNull();
    expect((await door.rpc('staff_set_attendance', { p_registration_id: legacy, p_attendance: 'attended' })).data.cash_recorded).toBe(false);
    // a wrong cash tap undone: not paid, not arrived, not registered
    const undo = (await door.rpc('staff_door_payment', { p_registration_id: legacy, p_paid: false })).data;
    expect(undo).toMatchObject({ payment_status: 'pending', status: 'pending_payment' });
    expect(await row(legacy)).toMatchObject({ status: 'pending_payment', attendance: 'unknown', payment_status: 'pending' });
    // the door list does not show it as a place
    expect(((await door.rpc('staff_checkin_list', { p_event_id: ev.id })).data as { registration_id: string }[]).some((x) => x.registration_id === legacy)).toBe(false);
  });

  it('a walk-in at a meeting with a fee: refused without the cash (nothing is saved), in with it; a known card the same', async () => {
    const door = await staff('door');
    const coord = await staff('coord');
    const ev = await paidMeeting();
    const w = { full_name: name(), phone: phone() };
    expect((await door.rpc('staff_add_walkin', { p_event_id: ev.id, p: w })).error?.message).toBe('payment_required');
    expect((await coord.from('participants').select('id').eq('phone', e164(w.phone))).data).toEqual([]);
    const ok = (await door.rpc('staff_add_walkin', { p_event_id: ev.id, p: w, p_cash: true })).data;
    expect(ok).toMatchObject({ cash_recorded: true, participant_is_new: true, already_registered: false });
    expect(await row(ok.registration_id)).toMatchObject({ status: 'registered', attendance: 'attended', is_walk_in: true, payment_status: 'paid', payment_method: 'cash' });

    const known = await card();
    expect((await door.rpc('staff_checkin_existing', { p_event_id: ev.id, p_participant_id: known.id })).error?.message).toBe('payment_required');
    expect(await regFor(ev.id, known.id)).toBeNull();
    expect((await door.rpc('staff_checkin_existing', { p_event_id: ev.id, p_participant_id: known.id, p_cash: true })).data.cash_recorded).toBe(true);
    // already paid online: no cash is taken twice
    const paid = await card();
    const r = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: paid.id })).data.registration_id;
    await coord.rpc('staff_confirm_payment', { p_registration_id: r });
    expect((await door.rpc('staff_checkin_existing', { p_event_id: ev.id, p_participant_id: paid.id, p_cash: true })).data.cash_recorded).toBe(false);
    expect(await row(r)).toMatchObject({ attendance: 'attended', payment_method: 'card' });
    // a free meeting: in, no cash
    const free = await makeEvent({ startsInMinutes: 10 });
    expect((await door.rpc('staff_add_walkin', { p_event_id: free.id, p: { full_name: name(), phone: phone() } })).data.cash_recorded).toBe(false);
  });

  it('the office: arrival, "not paid", refund and waiver keep the rule', async () => {
    const coord = await staff('coord');
    const ev = await paidMeeting();
    const a = await card();
    const r = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: a.id })).data.registration_id;
    expect((await coord.rpc('staff_set_attendance', { p_registration_id: r, p_attendance: 'attended' })).error?.message).toBe('payment_required');
    await coord.rpc('staff_set_payment', { p_registration_id: r, p_status: 'paid', p_method: 'cash' });
    expect((await row(r)).status).toBe('registered');
    // marked paid by mistake: "not paid" sends it back to waiting for the payment
    expect((await coord.rpc('staff_set_payment', { p_registration_id: r, p_status: 'pending' })).data.status).toBe('pending_payment');
    expect(await row(r)).toMatchObject({ status: 'pending_payment', payment_status: 'pending' });
    // a waiver needs a reason, and then confirms the place
    expect((await coord.rpc('staff_set_payment', { p_registration_id: r, p_status: 'waived' })).error?.message).toBe('reason_required');
    expect((await coord.rpc('staff_set_payment', { p_registration_id: r, p_status: 'waived', p_ref: 'אורחת של המרצה' })).data.status).toBe('registered');
    expect((await coord.rpc('staff_set_attendance', { p_registration_id: r, p_attendance: 'attended' })).error).toBeNull();
    // arrived: cannot be un-paid
    expect((await coord.rpc('staff_set_payment', { p_registration_id: r, p_status: 'none' })).error?.message).toBe('already_attended');
    // the door team cannot waive
    expect((await (await staff('door')).rpc('staff_set_payment', { p_registration_id: r, p_status: 'waived', p_ref: 'x' })).error?.message).toBe('forbidden');
  });

  it('merging two cards keeps the paid registration and never copies a status without its payment', async () => {
    const coord = await staff('coord');
    const ev = await paidMeeting({ startsInMinutes: 3 * 24 * 60 });
    const keep = await card();
    const dup = await card();
    const rk = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: keep.id })).data.registration_id;
    const rd = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: dup.id })).data.registration_id;
    await coord.rpc('staff_confirm_payment', { p_registration_id: rd, p_method: 'bit' });
    expect((await coord.rpc('staff_merge_participants', { p_keep: keep.id, p_merge: dup.id })).error).toBeNull();
    const after = (await regFor(ev.id, keep.id))!;
    expect(after.id).toBe(rd);
    expect(after).toMatchObject({ status: 'registered', payment_status: 'paid' });
    expect((await coord.from('registrations').select('id').eq('id', rk)).data).toEqual([]);
  });
});

describe('self check-in (QR, personal link, saved phone, site sign)', () => {
  it('a pending registration by its personal link: payment_required (with the link), checked in once the webhook confirms', async () => {
    const ev = await paidMeeting();
    const reg = registration(ev.public_code);
    const { data: res } = await visitor().rpc('public_register', { p: reg });
    expect(res.status).toBe('pending_payment');
    const v = visitor();
    const first = (await v.rpc('public_checkin', { p: { code: ev.checkin_code, token: res.token } })).data;
    expect(first).toMatchObject({ result: 'payment_required', can_pay_online: true });
    expect(first.event.payment_url).toBe(PAY_URL);
    expect((await v.rpc('public_registration', { p_token: res.token })).data).toMatchObject({ status: 'pending_payment', attendance: 'unknown' });
    expect((await hook(reg.phone)).result).toBe('matched');
    expect((await v.rpc('public_checkin', { p: { code: ev.checkin_code, token: res.token } })).data.result).toBe('checked_in');
  });

  it('a registered place from before pay-first that never paid is not checked in by itself', async () => {
    const ev = await paidMeeting();
    const id = legacyUnpaid(ev.id);
    const token = randomUUID().replace(/-/g, '');
    sql(`select private.set_registration_token('${id}', '${token}')`);
    const out = (await visitor().rpc('public_checkin', { p: { code: ev.checkin_code, token } })).data;
    expect(out).toMatchObject({ result: 'payment_required', can_pay_online: true });
    expect(await row(id)).toMatchObject({ status: 'registered', attendance: 'unknown', payment_status: 'pending' });
  });

  it('known (phone + full name) and the walk-in form: a registration waiting for the payment, not a place', async () => {
    const coord = await staff('coord');
    const ev = await paidMeeting();
    const known = await card();
    const k = (await visitor().rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: known.ph, full_name: known.full } })).data;
    expect(k.result).toBe('payment_required');
    expect(k.device).toBeTruthy();
    expect(await regFor(ev.id, known.id)).toMatchObject({ status: 'pending_payment', attendance: 'unknown' });
    // the saved phone (device) again: still not in
    expect((await visitor().rpc('public_checkin', { p: { code: ev.checkin_code, device: k.device } })).data.result).toBe('payment_required');

    const w = { code: ev.checkin_code, ...registration(ev.public_code) };
    const out = (await visitor().rpc('public_walkin', { p: w })).data;
    expect(out.result).toBe('payment_required');
    const { data: p } = await coord.from('participants').select('id').eq('phone', e164(w.phone)).single();
    expect(await regFor(ev.id, p!.id)).toMatchObject({ status: 'pending_payment', attendance: 'unknown' });
    // the door then lets them in with the cash
    expect((await (await staff('door')).rpc('staff_checkin_existing', { p_event_id: ev.id, p_participant_id: p!.id, p_cash: true })).data.cash_recorded).toBe(true);
    // a cancelled registration that turns up waits for the payment again
    const c = await card();
    const rc = (await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: c.id })).data.registration_id;
    await coord.rpc('staff_cancel_registration', { p_registration_id: rc });
    expect((await visitor().rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: c.ph, full_name: c.full } })).data.result).toBe('payment_required');
    expect((await row(rc)).status).toBe('pending_payment');
  });

  it('free meetings check in as before', async () => {
    const ev = await makeEvent({ startsInMinutes: 10 });
    const out = (await visitor().rpc('public_walkin', { p: { code: ev.checkin_code, ...registration(ev.public_code) } })).data;
    expect(out.result).toBe('checked_in');
  });
});

describe('the repair proposal', () => {
  it('the read-only query lists exactly the confirmed places without payment', async () => {
    const ev = await paidMeeting();
    const id = legacyUnpaid(ev.id);
    const text = readFileSync(new URL('../../supabase/repair/pay_guarantee_unpaid_registered.sql', import.meta.url), 'utf8');
    const query = text.slice(text.indexOf('select r.id'), text.indexOf(';', text.indexOf('select r.id')));
    expect(query).not.toMatch(/\b(update\s+\w|delete\s+from|insert\s+into)\b/i);
    const ids = execSync(`psql "${DB_URL}" -q -v ON_ERROR_STOP=1 -At -f -`, { input: `select registration_id from (${query}) x;` }).toString().trim().split('\n');
    expect(ids).toContain(id);
    const paid = await paidMeeting();
    const coord = await staff('coord');
    const a = await card();
    const r = (await coord.rpc('staff_register', { p_event_id: paid.id, p_participant_id: a.id })).data.registration_id;
    await coord.rpc('staff_confirm_payment', { p_registration_id: r });
    expect(ids).not.toContain(r);
  });
});
