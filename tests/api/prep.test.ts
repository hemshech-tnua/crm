// Event preparation and volunteers (migration 20261106002200_event_prep.sql), after Itai's questionnaire and sheet.
import { describe, expect, it } from 'vitest';
import { e164, makeEvent, name, phone, staff, visitor } from './helpers';

const ilDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

describe('a meeting gets its checklist', () => {
  it('a new Friday meeting gets the Friday tasks and the equipment list, each on its weekday of its week', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ startsInMinutes: 30 * 24 * 60 });
    const { data: tasks, error } = await coord.from('event_tasks').select('title, kind, due_date, hours, template_id').eq('event_id', ev.id);
    expect(error).toBeNull();
    expect(tasks!.filter((t) => t.kind === 'task').length).toBe(17);
    expect(tasks!.filter((t) => t.kind === 'equipment').map((t) => t.title)).toContain('כבל מאריך ומפצל');
    const day = ilDay(ev.starts_at);
    const weekStart = addDays(day, -weekday(day));
    const speaker = tasks!.find((t) => t.title.startsWith('סגירת מרצה ונושא'))!;
    expect(speaker.due_date).toBe(addDays(weekStart, -14 + 2)); // two weeks before, Tuesday
    expect(Number(speaker.hours)).toBe(1);
    const setup = tasks!.find((t) => t.title.startsWith('הקמה, מפגש ופירוק'))!;
    expect(setup.due_date).toBe(day);
  });

  it('when the meeting moves a week, its open tasks move with it; done and hand-moved tasks stay', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ startsInMinutes: 30 * 24 * 60 });
    const { data: before } = await coord.from('event_tasks').select('id, title, due_date').eq('event_id', ev.id).eq('kind', 'task').order('sort_order');
    const [done, manual, open] = before!;
    await coord.from('event_tasks').update({ done_at: new Date().toISOString() }).eq('id', done.id);
    await coord.from('event_tasks').update({ due_date: '2030-01-01', due_manual: true }).eq('id', manual.id);
    const later = new Date(new Date(ev.starts_at).getTime() + 7 * 864e5);
    const { error } = await coord.from('events').update({ starts_at: later.toISOString(), ends_at: new Date(later.getTime() + 150 * 60_000).toISOString() }).eq('id', ev.id);
    expect(error).toBeNull();
    const { data: after } = await coord.from('event_tasks').select('id, due_date, done_by').in('id', [done.id, manual.id, open.id]);
    const by = Object.fromEntries(after!.map((t) => [t.id, t]));
    expect(by[done.id].due_date).toBe(done.due_date);
    expect(by[done.id].done_by).not.toBeNull(); // stamped by the database
    expect(by[manual.id].due_date).toBe('2030-01-01');
    expect(by[open.id].due_date).toBe(addDays(open.due_date, 7));
  });

  it('items added to the template later can be picked up by an existing meeting, without duplicates', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ type: 'bonfire', startsInMinutes: 20 * 24 * 60 });
    const { count: first } = await coord.from('event_tasks').select('id', { count: 'exact', head: true }).eq('event_id', ev.id);
    const { data: tpl, error: e1 } = await coord.from('prep_templates')
      .insert({ event_type: 'bonfire', kind: 'equipment', category: 'equipment', title: 'פריט בדיקה לתבנית', week_offset: 0, weekday: 2 }).select('id').single();
    expect(e1).toBeNull();
    try {
      const { data: added, error } = await coord.rpc('staff_prep_init', { p_event_id: ev.id });
      expect(error).toBeNull();
      expect(added).toBe(1);
      expect((await coord.rpc('staff_prep_init', { p_event_id: ev.id })).data).toBe(0);
      const { count: again } = await coord.from('event_tasks').select('id', { count: 'exact', head: true }).eq('event_id', ev.id);
      expect(again).toBe((first ?? 0) + 1);
    } finally {
      await coord.from('prep_templates').delete().eq('id', tpl!.id);
    }
  });

  it('a template task deleted from a meeting stays gone; a one-off task is really deleted; deleting the meeting clears all', async () => {
    const coord = await staff('coord');
    const admin = await staff('admin');
    const ev = await makeEvent({ startsInMinutes: 25 * 24 * 60 });
    const { data: tasks } = await coord.from('event_tasks').select('id').eq('event_id', ev.id).eq('kind', 'task').limit(1);
    const tid = tasks![0].id;
    await coord.from('event_tasks').delete().eq('id', tid);
    const { data: hidden } = await coord.from('event_tasks').select('dismissed').eq('id', tid).single();
    expect(hidden!.dismissed).toBe(true);
    expect((await coord.rpc('staff_prep_init', { p_event_id: ev.id })).data).toBe(0);
    const { data: own } = await coord.from('event_tasks').insert({ event_id: ev.id, title: 'משימה חד־פעמית' }).select('id').single();
    await coord.from('event_tasks').delete().eq('id', own!.id);
    expect((await coord.from('event_tasks').select('id').eq('id', own!.id)).data).toEqual([]);
    const { error } = await admin.from('events').delete().eq('id', ev.id);
    expect(error).toBeNull();
    const { count } = await admin.from('event_tasks').select('id', { count: 'exact', head: true }).eq('event_id', ev.id);
    expect(count).toBe(0);
  });

  it('the door team and visitors see none of it', async () => {
    const door = await staff('door');
    const ev = await makeEvent();
    for (const t of ['event_tasks', 'prep_templates', 'event_payments', 'suppliers', 'volunteers', 'volunteer_shifts']) {
      const { data } = await door.from(t).select('id').limit(1);
      expect(data ?? []).toEqual([]);
      const { data: anon } = await visitor().from(t).select('id').limit(1);
      expect(anon ?? []).toEqual([]);
    }
    const { error } = await door.rpc('staff_prep_init', { p_event_id: ev.id });
    expect(error?.message).toBe('forbidden');
  });
});

describe('payments and suppliers', () => {
  it('a payment is recorded against a meeting and a supplier, and paid later', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent();
    const { data: sup, error: e1 } = await coord.from('suppliers').insert({ name: 'קייטרינג בדיקה', what: 'ארוחת בוקר', phone: e164(phone()) }).select('id').single();
    expect(e1).toBeNull();
    const { data: pay, error: e2 } = await coord.from('event_payments')
      .insert({ event_id: ev.id, supplier_id: sup!.id, supplier: 'קייטרינג בדיקה', description: 'ארוחת בוקר ל-30', amount: 1450 }).select('id').single();
    expect(e2).toBeNull();
    await coord.from('event_payments').update({ invoice_received: true, paid_on: '2026-11-20' }).eq('id', pay!.id);
    const { data: row } = await coord.from('event_payments').select('amount, invoice_received, paid_on').eq('id', pay!.id).single();
    expect(row).toMatchObject({ invoice_received: true, paid_on: '2026-11-20' });
    expect(Number(row!.amount)).toBe(1450);
  });
});

describe('volunteers book ahead from a personal link', () => {
  async function volunteerWithShifts() {
    const coord = await staff('coord');
    const full = name();
    const { data: v, error } = await coord.from('volunteers').insert({ full_name: full, phone: e164(phone()), roles: ['entrance', 'setup'] }).select('id').single();
    expect(error).toBeNull();
    const a = await makeEvent({ startsInMinutes: 10 * 24 * 60 });
    const b = await makeEvent({ startsInMinutes: 40 * 24 * 60 });
    const { data: shifts } = await coord.from('volunteer_shifts')
      .insert([{ event_id: a.id, volunteer_id: v!.id, role: 'entrance' }, { event_id: b.id, volunteer_id: v!.id, role: 'setup' }]).select('id, event_id');
    return { coord, full, id: v!.id, shifts: shifts! };
  }

  it('the volunteer sees their upcoming shifts and confirms or declines each one', async () => {
    const { coord, full, id, shifts } = await volunteerWithShifts();
    const { data: token, error } = await coord.rpc('staff_volunteer_link', { p_volunteer_id: id });
    expect(error).toBeNull();
    const v = visitor();
    const { data: page, error: e2 } = await v.rpc('public_volunteer', { p_token: token });
    expect(e2).toBeNull();
    expect(page.first_name).toBe(full.split(' ')[0]);
    expect(page.shifts.map((s: { status: string }) => s.status)).toEqual(['invited', 'invited']);
    expect(Object.keys(page.shifts[0]).sort()).toEqual(['ends_at', 'id', 'location', 'role', 'starts_at', 'status', 'title', 'type']);

    expect((await v.rpc('public_volunteer_respond', { p_token: token, p_shift_id: shifts[0].id, p_answer: 'confirmed' })).data).toBe('confirmed');
    expect((await v.rpc('public_volunteer_respond', { p_token: token, p_shift_id: shifts[1].id, p_answer: 'declined' })).data).toBe('declined');
    const { data: rows } = await coord.from('volunteer_shifts').select('id, status, responded_at').eq('volunteer_id', id);
    expect(Object.fromEntries(rows!.map((r) => [r.id, r.status]))).toEqual({ [shifts[0].id]: 'confirmed', [shifts[1].id]: 'declined' });
  });

  it('a link reaches only its own shifts, a new link replaces the old one, and the hash is never readable', async () => {
    const one = await volunteerWithShifts();
    const two = await volunteerWithShifts();
    const t1 = (await one.coord.rpc('staff_volunteer_link', { p_volunteer_id: one.id })).data;
    const v = visitor();
    const other = await v.rpc('public_volunteer_respond', { p_token: t1, p_shift_id: two.shifts[0].id, p_answer: 'confirmed' });
    expect(other.error?.message).toBe('not_found');
    expect((await v.rpc('public_volunteer_respond', { p_token: t1, p_shift_id: one.shifts[0].id, p_answer: 'maybe' })).error?.message).toBe('invalid_input');

    const t2 = (await one.coord.rpc('staff_volunteer_link', { p_volunteer_id: one.id })).data;
    expect((await v.rpc('public_volunteer', { p_token: t1 })).error?.message).toBe('not_found');
    expect((await v.rpc('public_volunteer', { p_token: t2 })).error).toBeNull();
    expect((await v.rpc('public_volunteer', { p_token: 'x'.repeat(32) })).error?.message).toBe('not_found');

    const { error } = await one.coord.from('volunteers').select('link_token_hash').eq('id', one.id);
    expect(error).not.toBeNull();
  });
});
