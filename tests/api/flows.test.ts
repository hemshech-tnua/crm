// Scenarios 2–6 at the API layer: create an event, register (new and returning), waitlist, cancel,
// check in (QR, phone, walk-in, staff), close the event, feedback, and the numbers in the reports.
import { describe, expect, it } from 'vitest';
import { e164, makeEvent, name, phone, registration, staff, visitor } from './helpers';

describe('registration', () => {
  it('registers a new participant and keeps the source', async () => {
    const ev = await makeEvent();
    const reg = registration(ev.public_code, { source: 'whatsapp_group', consent_updates: true, photo_opt_out: true, utm: { source: 'wa', campaign: 'nov' } });
    const { data, error } = await visitor().rpc('public_register', { p: reg });
    expect(error).toBeNull();
    expect(data.status).toBe('registered');
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(data.invite_code).toMatch(/^f-[a-z2-9]{7}$/);
    expect(data.first_name).toBe(reg.full_name.split(' ')[0]);

    const coord = await staff('coord');
    const { data: p } = await coord.from('participants')
      .select('id, full_name, city, birth_year, consent_updates, photo_opt_out, created_via, acquisition_sources!participants_first_source_id_fkey(key)')
      .eq('phone', e164(reg.phone)).single();
    expect(p!.full_name).toBe(reg.full_name);
    expect(p!.city).toBe('מודיעין');
    expect(p!.birth_year).toBe(new Date().getFullYear() - 29);
    expect(p!.consent_updates).toBe(true);
    expect(p!.photo_opt_out).toBe(true);
    expect(p!.created_via).toBe('registration');
    expect((p as any).acquisition_sources.key).toBe('whatsapp_group');

    const { data: r } = await coord.from('registrations').select('status, utm_source, utm_campaign, created_via').eq('participant_id', p!.id).single();
    expect(r).toMatchObject({ status: 'registered', utm_source: 'wa', utm_campaign: 'nov', created_via: 'public_form' });

    const { data: consents } = await coord.from('consents').select('kind, granted, source').eq('participant_id', p!.id);
    expect(consents).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'updates_whatsapp', granted: true, source: 'registration_form' }),
      expect.objectContaining({ kind: 'photo_opt_out', granted: true, source: 'registration_form' }),
    ]));
  });

  it('recognizes a returning participant by phone in any format, without duplicates or overwriting', async () => {
    const ev1 = await makeEvent();
    const ev2 = await makeEvent({ startsInMinutes: 10 * 24 * 60 });
    const local = phone();
    const first = registration(ev1.public_code, { phone: local });
    await visitor().rpc('public_register', { p: first });
    const formatted = `+972-${local.slice(1, 3)}-${local.slice(3)}`;
    const { data, error } = await visitor().rpc('public_register', {
      p: registration(ev2.public_code, { phone: formatted, full_name: 'שם אחר לגמרי', city: 'חיפה' }),
    });
    expect(error).toBeNull();
    expect(data.status).toBe('registered');
    expect(data.first_name).toBe(first.full_name.split(' ')[0]);

    const coord = await staff('coord');
    const { data: people } = await coord.from('participants').select('id, full_name, city').eq('phone', e164(local));
    expect(people).toHaveLength(1);
    expect(people![0].full_name).toBe(first.full_name);
    expect(people![0].city).toBe('מודיעין');
    const { data: regs } = await coord.from('registrations').select('event_id, submitted_name').eq('participant_id', people![0].id);
    expect(regs).toHaveLength(2);
    expect(regs!.find((r) => r.event_id === ev2.id)!.submitted_name).toBe('שם אחר לגמרי');

    // same event again: no second registration
    const again = await visitor().rpc('public_register', { p: registration(ev2.public_code, { phone: local }) });
    expect(again.data.status).toBe('already_registered');
    expect(again.data.token).toBeUndefined();
  });

  it('fills capacity, then waitlists, and re-registers after cancelling', async () => {
    const ev = await makeEvent({ capacity: 2 });
    const v = visitor();
    const a = await v.rpc('public_register', { p: registration(ev.public_code) });
    const b = await v.rpc('public_register', { p: registration(ev.public_code) });
    const c = await v.rpc('public_register', { p: registration(ev.public_code) });
    const d = await v.rpc('public_register', { p: registration(ev.public_code) });
    expect([a.data.status, b.data.status, c.data.status, d.data.status]).toEqual(['registered', 'registered', 'waitlisted', 'waitlisted']);
    expect(c.data.waitlist_position).toBe(1);
    expect(d.data.waitlist_position).toBe(2);

    const info = await v.rpc('public_get_event', { p_code: ev.public_code });
    expect(info.data.is_full).toBe(true);
    expect(info.data.spots_left).toBe(0);

    // cancel via the personal link
    const view = await v.rpc('public_registration', { p_token: a.data.token });
    expect(view.data.can_cancel).toBe(true);
    const cancel = await v.rpc('public_cancel', { p_token: a.data.token, p_reason: 'מילואים' });
    expect(cancel.data.status).toBe('cancelled');
    const after = await v.rpc('public_registration', { p_token: a.data.token });
    expect(after.data.status).toBe('cancelled');

    // coordinator sees a free spot with people waiting, and promotes the first in line
    const coord = await staff('coord');
    const att = await coord.rpc('attention_items');
    expect(att.data.waitlist_with_space.map((x: any) => x.id)).toContain(ev.id);
    const { data: waiting } = await coord.from('registrations').select('id, registered_at').eq('event_id', ev.id).eq('status', 'waitlisted').order('registered_at');
    const promoted = await coord.rpc('staff_promote', { p_registration_id: waiting![0].id });
    expect(promoted.error).toBeNull();
    const { count } = await coord.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', ev.id).eq('status', 'registered');
    expect(count).toBe(2);
  });

  it('refuses registration to closed, cancelled or past events', async () => {
    const closed = await makeEvent({ status: 'closed' });
    const cancelled = await makeEvent({ status: 'cancelled' });
    const past = await makeEvent({ startsInMinutes: -60 });
    const v = visitor();
    expect((await v.rpc('public_register', { p: registration(closed.public_code) })).error?.message).toBe('registration_closed');
    expect((await v.rpc('public_register', { p: registration(cancelled.public_code) })).error?.message).toBe('event_cancelled');
    expect((await v.rpc('public_register', { p: registration(past.public_code) })).error?.message).toBe('registration_closed');
  });

  it('links a friend through a personal invite link and through the "who brought you" answer', async () => {
    const ev = await makeEvent();
    const v = visitor();
    const inviter = registration(ev.public_code);
    const r1 = await v.rpc('public_register', { p: inviter });
    const code = r1.data.invite_code;

    const shown = await v.rpc('public_get_event', { p_code: ev.public_code, p_ref: code });
    expect(shown.data.invited_by).toBe(inviter.full_name.split(' ')[0]);

    const friend = registration(ev.public_code, { source: 'friend', ref: code });
    await v.rpc('public_register', { p: friend });
    const friend2 = registration(ev.public_code, { source: 'friend', referrer: inviter.phone });
    await v.rpc('public_register', { p: friend2 });
    const friend3 = registration(ev.public_code, { source: 'friend', referrer: 'דוד מהמילואים' });
    await v.rpc('public_register', { p: friend3 });

    const coord = await staff('coord');
    const { data: inv } = await coord.from('participants').select('id').eq('phone', e164(inviter.phone)).single();
    const { data: f1 } = await coord.from('participants').select('referred_by_participant_id').eq('phone', e164(friend.phone)).single();
    const { data: f2 } = await coord.from('participants').select('referred_by_participant_id').eq('phone', e164(friend2.phone)).single();
    const { data: f3 } = await coord.from('participants').select('referred_by_participant_id, referred_by_name').eq('phone', e164(friend3.phone)).single();
    expect(f1!.referred_by_participant_id).toBe(inv!.id);
    expect(f2!.referred_by_participant_id).toBe(inv!.id);
    expect(f3).toEqual({ referred_by_participant_id: null, referred_by_name: 'דוד מהמילואים' });
    const { data: stats } = await coord.from('participant_stats').select('friends_brought').eq('participant_id', inv!.id).single();
    expect(stats!.friends_brought).toBe(2);
  });

  it('attributes registrations to a channel link', async () => {
    const coord = await staff('coord');
    const code = `ig-test-${Date.now().toString(36)}`;
    const { data: src } = await coord.from('acquisition_sources').select('id').eq('key', 'instagram').single();
    const { error } = await coord.from('referral_links').insert({ code, label: 'ביו באינסטגרם', source_id: src!.id });
    expect(error).toBeNull();
    const ev = await makeEvent();
    const reg = registration(ev.public_code, { ref: code });
    await visitor().rpc('public_register', { p: reg });
    const { data } = await coord.rpc('report_links', {});
    const row = data.find((l: any) => l.code === code);
    expect(row.registrations).toBe(1);
    expect(row.new_people).toBe(1);
  });
});

describe('check-in at the door', () => {
  it('is closed before the window and open from two hours before', async () => {
    const early = await makeEvent({ startsInMinutes: 5 * 60 });
    const v = visitor();
    const { data } = await v.rpc('public_checkin', { p: { code: early.checkin_code, phone: phone() } });
    expect(data.result).toBe('window_not_open');
    const info = await v.rpc('public_checkin_info', { p_code: early.checkin_code });
    expect(info.data.window).toBe('not_open');
  });

  it('checks in by phone, by device token, unknown phone, known phone without registration, and walk-in', async () => {
    const ev = await makeEvent({ startsInMinutes: 20 });
    const v = visitor();
    const reg = registration(ev.public_code);
    const r = await v.rpc('public_register', { p: reg });

    // by device token (registered on this phone)
    const byToken = await v.rpc('public_checkin', { p: { code: ev.checkin_code, token: r.data.token } });
    expect(byToken.data.result).toBe('checked_in');
    expect(byToken.data.first_name).toBe(reg.full_name.split(' ')[0]);
    const again = await v.rpc('public_checkin', { p: { code: ev.checkin_code, phone: reg.phone } });
    expect(again.data.result).toBe('already_checked_in');

    // unknown phone -> the walk-in form
    const unknown = phone();
    const nr = await v.rpc('public_checkin', { p: { code: ev.checkin_code, phone: unknown } });
    expect(nr.data.result).toBe('not_registered');
    const walk = await v.rpc('public_walkin', { p: { code: ev.checkin_code, full_name: name(), phone: unknown, city: 'לוד', age: '33', source: 'friend', referrer: reg.phone } });
    expect(walk.error).toBeNull();
    expect(walk.data.result).toBe('checked_in');

    // a known participant who did not register for this event
    const other = await makeEvent({ startsInMinutes: 15 * 24 * 60 });
    const known = registration(other.public_code);
    await v.rpc('public_register', { p: known });
    const k = await v.rpc('public_checkin', { p: { code: ev.checkin_code, phone: known.phone } });
    expect(k.data.result).toBe('checked_in');

    const coord = await staff('coord');
    const { data: list } = await coord.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(list).toHaveLength(3);
    const walkRow = list.find((x: any) => x.phone === e164(unknown));
    expect(walkRow).toMatchObject({ attendance: 'attended', is_walk_in: true, checkin_method: 'self_qr', first_time: true });
    const { data: wp } = await coord.from('participants').select('created_via, referred_by_participant_id').eq('phone', e164(unknown)).single();
    expect(wp!.created_via).toBe('checkin');
    expect(wp!.referred_by_participant_id).not.toBeNull();
  });

  it('door team marks attendance, cancels, and adds a walk-in; every change is saved', async () => {
    const ev = await makeEvent({ startsInMinutes: 10 });
    const v = visitor();
    const a = registration(ev.public_code);
    const b = registration(ev.public_code);
    await v.rpc('public_register', { p: a });
    await v.rpc('public_register', { p: b });
    const door = await staff('door');
    const { data: list } = await door.rpc('staff_checkin_list', { p_event_id: ev.id });
    const rowA = list.find((x: any) => x.display_name === a.full_name);
    const rowB = list.find((x: any) => x.display_name === b.full_name);
    expect((await door.rpc('staff_set_attendance', { p_registration_id: rowA.registration_id, p_attendance: 'attended' })).error).toBeNull();
    expect((await door.rpc('staff_cancel_registration', { p_registration_id: rowB.registration_id })).error).toBeNull();
    const w = await door.rpc('staff_add_walkin', { p_event_id: ev.id, p: { full_name: name(), phone: phone() } });
    expect(w.error).toBeNull();
    // undo a mistaken tap
    expect((await door.rpc('staff_set_attendance', { p_registration_id: rowA.registration_id, p_attendance: 'unknown' })).error).toBeNull();
    expect((await door.rpc('staff_set_attendance', { p_registration_id: rowA.registration_id, p_attendance: 'attended' })).error).toBeNull();

    const coord = await staff('coord');
    const { data: stats } = await coord.from('event_stats').select('*').eq('event_id', ev.id).single();
    expect(stats).toMatchObject({ attended_count: 2, walk_in_count: 1, cancelled_count: 1, registered_count: 1 });
    const { data: regA } = await coord.from('registrations').select('checkin_method, checked_in_by').eq('id', rowA.registration_id).single();
    expect(regA).toEqual({ checkin_method: 'staff', checked_in_by: '10000000-0000-4000-8000-000000000003' });
  });
});

describe('after the meeting', () => {
  it('closing marks no-shows, creates follow-ups, and feedback is collected', async () => {
    const ev = await makeEvent({ startsInMinutes: -30, activity_name: 'יוגה', lecture_topic: 'חזרה לשגרה' });
    const coord = await staff('coord');
    const people = [registration(ev.public_code), registration(ev.public_code), registration(ev.public_code)];
    // event already started: register through the office
    const ids: string[] = [];
    for (const p of people) {
      const { data: part } = await coord.from('participants').insert({ full_name: p.full_name, phone: p.phone, city: 'מודיעין' }).select('id').single();
      const { data: r } = await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: part!.id });
      ids.push(r.registration_id);
    }
    await coord.rpc('staff_set_attendance', { p_registration_id: ids[0], p_attendance: 'attended' });
    await coord.rpc('staff_set_attendance', { p_registration_id: ids[1], p_attendance: 'attended' });

    const { data: done, error } = await coord.rpc('staff_complete_event', { p_event_id: ev.id });
    expect(error).toBeNull();
    expect(done).toMatchObject({ no_shows: 1, tasks_no_show: 1, tasks_first_time: 2 });
    // closing twice does not duplicate tasks
    const { data: twice } = await coord.rpc('staff_complete_event', { p_event_id: ev.id });
    expect(twice).toMatchObject({ no_shows: 0, tasks_no_show: 0, tasks_first_time: 0 });

    const { data: tasks } = await coord.from('follow_ups').select('type, status, due_date').eq('event_id', ev.id);
    expect(tasks!.filter((t) => t.type === 'no_show')).toHaveLength(1);
    expect(tasks!.filter((t) => t.type === 'first_time')).toHaveLength(2);

    // event-link feedback, matched by phone, then anonymous
    const v = visitor();
    const ctx = await v.rpc('public_feedback_context', { p: { event: (await coord.from('events').select('public_code').eq('id', ev.id).single()).data!.public_code } });
    expect(ctx.data).toMatchObject({ state: 'open', has_activity: true, has_lecture: true });
    const code = ctx.data.event.code;
    expect((await v.rpc('public_submit_feedback', { p: { event: code, phone: people[0].phone, overall: 5, activity: 4, lecture: 5, comment: 'היה מעולה' } })).error).toBeNull();
    expect((await v.rpc('public_submit_feedback', { p: { event: code, overall: 3 } })).error).toBeNull();
    expect((await v.rpc('public_submit_feedback', { p: { event: code, overall: 9 } })).error?.message).toBe('invalid_rating');

    const { data: st } = await coord.from('event_stats').select('*').eq('event_id', ev.id).single();
    expect(st).toMatchObject({ attended_count: 2, no_show_count: 1, feedback_count: 2, new_count: 2, returning_count: 0 });
    expect(Number(st!.avg_overall)).toBe(4);
    const { data: fb } = await coord.from('feedback').select('participant_id, comment').eq('event_id', ev.id).not('participant_id', 'is', null);
    expect(fb).toHaveLength(1);
  });

  it('duplicates an event for next week (speaker cleared, new codes, draft)', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ activity_name: 'פילאטיס', lecture_topic: 'נושא השבוע' });
    const next = new Date(new Date(ev.starts_at).getTime() + 7 * 864e5).toISOString();
    const { data: id, error } = await coord.rpc('staff_duplicate_event', { p_event_id: ev.id, p_starts_at: next });
    expect(error).toBeNull();
    const { data: copy } = await coord.from('events').select('*').eq('id', id).single();
    expect(copy).toMatchObject({ status: 'draft', activity_name: 'פילאטיס', lecture_topic: null, capacity: 40 });
    expect(new Date(copy!.starts_at).toISOString()).toBe(next);
    expect(copy!.public_code).not.toBe(ev.public_code);
  });
});

describe('participant records', () => {
  it('merges two cards of the same person', async () => {
    const coord = await staff('coord');
    const ev1 = await makeEvent({ startsInMinutes: -24 * 60 });
    const ev2 = await makeEvent({ startsInMinutes: -2 * 24 * 60 });
    const { data: keep } = await coord.from('participants').insert({ full_name: 'יוסי מיזוג', phone: phone() }).select('id').single();
    const { data: dup } = await coord.from('participants').insert({ full_name: 'יוסי מיזוג', phone: phone(), city: 'רמלה', occupation: 'סטודנט' }).select('id').single();
    const r1 = await coord.rpc('staff_register', { p_event_id: ev1.id, p_participant_id: keep!.id });
    const r2 = await coord.rpc('staff_register', { p_event_id: ev2.id, p_participant_id: dup!.id });
    const r3 = await coord.rpc('staff_register', { p_event_id: ev1.id, p_participant_id: dup!.id });
    await coord.rpc('staff_set_attendance', { p_registration_id: r2.data.registration_id, p_attendance: 'attended' });
    await coord.rpc('staff_set_attendance', { p_registration_id: r3.data.registration_id, p_attendance: 'attended' });
    void r1;

    const dupes = await coord.rpc('staff_find_duplicates');
    expect(dupes.data.some((d: any) => [d.a.id, d.b.id].includes(keep!.id) && [d.a.id, d.b.id].includes(dup!.id))).toBe(true);

    const { error } = await coord.rpc('staff_merge_participants', { p_keep: keep!.id, p_merge: dup!.id });
    expect(error).toBeNull();
    const { data: k } = await coord.from('participants').select('city, occupation').eq('id', keep!.id).single();
    expect(k).toEqual({ city: 'רמלה', occupation: 'סטודנט' });
    const { data: gone } = await coord.from('participants').select('id').eq('id', dup!.id);
    expect(gone).toEqual([]);
    const { data: regs } = await coord.from('registrations').select('event_id, attendance').eq('participant_id', keep!.id);
    expect(regs).toHaveLength(2);
    expect(regs!.every((r) => r.attendance === 'attended')).toBe(true);
  });

  it('warns about an existing phone and similar names before creating', async () => {
    const coord = await staff('coord');
    const p = phone();
    await coord.from('participants').insert({ full_name: 'רונית בדיקת כפילות', phone: p });
    const { data } = await coord.rpc('staff_check_duplicate', { p_full_name: 'רונית בדיקת כפילויות', p_phone: p });
    expect(data.by_phone.full_name).toBe('רונית בדיקת כפילות');
    const { error } = await coord.from('participants').insert({ full_name: 'מישהו אחר', phone: p });
    expect(error?.code).toBe('23505');
  });

  it('anonymizes on request and keeps anonymous statistics', async () => {
    const admin = await staff('admin');
    const ev = await makeEvent({ startsInMinutes: -3 * 24 * 60 });
    const { data: part } = await admin.from('participants').insert({ full_name: 'למחיקה בבקשה', phone: phone(), city: 'גבעתיים', notes: 'מעדיף שיחה בערב' }).select('id').single();
    const r = await admin.rpc('staff_register', { p_event_id: ev.id, p_participant_id: part!.id });
    await admin.rpc('staff_set_attendance', { p_registration_id: r.data.registration_id, p_attendance: 'attended' });
    await admin.from('contact_log').insert({ participant_id: part!.id, channel: 'phone', summary: 'שיחה', created_by: '10000000-0000-4000-8000-000000000001' });

    const { error } = await admin.rpc('admin_anonymize_participant', { p_id: part!.id });
    expect(error).toBeNull();
    const { data: after } = await admin.from('participants').select('full_name, phone, city, notes, anonymized_at').eq('id', part!.id).single();
    expect(after).toMatchObject({ full_name: null, phone: null, city: null, notes: null });
    expect(after!.anonymized_at).not.toBeNull();
    const { data: st } = await admin.from('event_stats').select('attended_count').eq('event_id', ev.id).single();
    expect(st!.attended_count).toBe(1);
    const { data: logs } = await admin.from('contact_log').select('id').eq('participant_id', part!.id);
    expect(logs).toEqual([]);
    // the anonymized card cannot be edited back
    const { data: edit } = await admin.from('participants').update({ full_name: 'חזרה' }).eq('id', part!.id).select();
    expect(edit).toEqual([]);
  });
});

describe('reports (scenario 6): numbers match the source data', () => {
  it('computes attendance, show rate, new vs returning, friend share and ratings for an isolated site', async () => {
    const admin = await staff('admin');
    const { data: site } = await admin.from('sites').insert({ name: `מתחם בדיקה ${Date.now()}` }).select('id').single();
    const coord = await staff('coord');
    const { data: srcFriend } = await coord.from('acquisition_sources').select('id').eq('key', 'friend').single();
    const { data: srcIg } = await coord.from('acquisition_sources').select('id').eq('key', 'instagram').single();

    // 4 people: A (friend), B (instagram), C (instagram), D (friend)
    const mk = async (n: string, src: string) =>
      (await coord.from('participants').insert({ full_name: n, phone: phone(), first_source_id: src }).select('id').single()).data!.id as string;
    const A = await mk('אלף דוחות', srcFriend!.id);
    const B = await mk('בית דוחות', srcIg!.id);
    const C = await mk('גימל דוחות', srcIg!.id);
    const D = await mk('דלת דוחות', srcFriend!.id);

    const ev = async (daysAgo: number) =>
      (await makeEvent({ site_id: site!.id, startsInMinutes: -daysAgo * 24 * 60 })).id;
    const E1 = await ev(14);
    const E2 = await ev(7);

    const reg = async (e: string, p: string, attended: boolean | 'walkin') => {
      const { data } = await coord.rpc('staff_register', { p_event_id: e, p_participant_id: p });
      if (attended) await coord.rpc('staff_set_attendance', { p_registration_id: data.registration_id, p_attendance: 'attended' });
    };
    // E1: A, B attend; C registered, no-show
    await reg(E1, A, true); await reg(E1, B, true); await reg(E1, C, false);
    // E2: A attends again, D attends; B no-show
    await reg(E2, A, true); await reg(E2, D, true); await reg(E2, B, false);
    await coord.rpc('staff_complete_event', { p_event_id: E1 });
    await coord.rpc('staff_complete_event', { p_event_id: E2 });

    const { data: k, error } = await coord.rpc('report_kpis', { p_site: site!.id, p_type: 'friday' });
    expect(error).toBeNull();
    expect(k).toMatchObject({
      events: 2,
      attendances: 4,          // A,B + A,D
      unique_attendees: 3,     // A,B,D
      preregistered: 6,
      preregistered_attended: 4,
      new_attendees: 3,
      returning_attendees: 1,  // A
      friend_new: 2,           // A, D
    });
    // show rate 4/6, return rate 1/3, friend share 2/3, avg 2 per event

    const { data: drill } = await coord.rpc('report_drilldown', { p_kind: 'returning', p_site: site!.id, p_type: 'friday' });
    expect(drill.map((x: any) => x.id)).toEqual([A]);

    const { data: evs } = await coord.rpc('report_events', { p_site: site!.id });
    const e2row = evs.find((x: any) => x.id === E2);
    expect(e2row).toMatchObject({ attended_count: 2, new_count: 1, returning_count: 1, no_show_count: 1 });

    const { data: monthly } = await coord.rpc('report_monthly', { p_site: site!.id });
    const total = monthly.reduce((s: number, m: any) => s + m.attendances, 0);
    expect(total).toBe(4);
  });

  it('flags a regular who stopped coming after 3 Fridays and creates a follow-up', async () => {
    const admin = await staff('admin');
    const coord = await staff('coord');
    const { data: site } = await admin.from('sites').insert({ name: `מתחם קבועים ${Date.now()}` }).select('id').single();
    const { data: p } = await coord.from('participants').insert({ full_name: 'קבוע שנעלם', phone: phone() }).select('id').single();
    const days = [40, 33, 26, 19, 12, 5];
    const events: string[] = [];
    for (const d of days) events.push((await makeEvent({ site_id: site!.id, startsInMinutes: -d * 24 * 60 })).id);
    // came to the first two Fridays (7 days apart => regular), then missed the next four
    for (const e of events.slice(0, 2)) {
      const { data } = await coord.rpc('staff_register', { p_event_id: e, p_participant_id: p!.id });
      await coord.rpc('staff_set_attendance', { p_registration_id: data.registration_id, p_attendance: 'attended' });
    }
    const { data: st } = await coord.from('participant_stats').select('engagement_status, ever_regular, fridays_missed, friday_count').eq('participant_id', p!.id).single();
    expect(st).toMatchObject({ engagement_status: 'lapsed', ever_regular: true, fridays_missed: 4, friday_count: 2 });
    const { data: att } = await coord.rpc('attention_items');
    expect(att.lapsed.map((x: any) => x.participant_id)).toContain(p!.id);
    await coord.rpc('staff_complete_event', { p_event_id: events[5] });
    const { data: tasks } = await coord.from('follow_ups').select('type').eq('participant_id', p!.id).eq('type', 'lapsed');
    expect(tasks).toHaveLength(1);
  });
});
