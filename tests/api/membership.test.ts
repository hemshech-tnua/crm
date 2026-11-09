// QR check-in v2 (migration 20261106001300): the phone remembers who checked in, association membership,
// the request-to-join form, and the thank-you that is ready 24 hours after a meeting.
import { describe, expect, it } from 'vitest';
import { e164, makeEvent, name, phone, registration, staff, visitor } from './helpers';

const first = (full: string) => full.split(' ')[0];

describe('the phone remembers who checked in from it', () => {
  it('after one check-in, the next meeting is one tap, even without registering', async () => {
    const v = visitor();
    const ev1 = await makeEvent({ startsInMinutes: 20 });
    const reg = registration(ev1.public_code);
    const r = await v.rpc('public_register', { p: reg });
    const c1 = await v.rpc('public_checkin', { p: { code: ev1.checkin_code, token: r.data.token } });
    expect(c1.data).toMatchObject({ result: 'checked_in', membership: 'none' });
    expect(typeof c1.data.device).toBe('string');
    expect(c1.data.device.length).toBeGreaterThanOrEqual(20);

    // another meeting the person did not register for
    const ev2 = await makeEvent({ startsInMinutes: 40, type: 'other', title: 'ערב מדורה (בדיקה)' });
    const c2 = await v.rpc('public_checkin', { p: { code: ev2.checkin_code, device: c1.data.device } });
    expect(c2.error).toBeNull();
    expect(c2.data).toMatchObject({ result: 'checked_in', first_name: first(reg.full_name), device: c1.data.device });
    const again = await v.rpc('public_checkin', { p: { code: ev2.checkin_code, device: c1.data.device } });
    expect(again.data.result).toBe('already_checked_in');

    const coord = await staff('coord');
    const { data: list } = await coord.rpc('staff_checkin_list', { p_event_id: ev2.id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ phone: e164(reg.phone), attendance: 'attended', is_walk_in: true, checkin_method: 'self_qr' });

    // a token the server does not know
    const bad = await v.rpc('public_checkin', { p: { code: ev2.checkin_code, device: 'x'.repeat(32) } });
    expect(bad.data).toEqual({ result: 'device_invalid' });
  });

  it('a walk-in typing someone else\'s phone does not get their identity on this phone', async () => {
    const v = visitor();
    const ev = await makeEvent({ startsInMinutes: 20 });
    const other = await makeEvent({ startsInMinutes: 20 * 24 * 60 });
    const known = registration(other.public_code);
    await v.rpc('public_register', { p: known });

    const stranger = await v.rpc('public_walkin', { p: { code: ev.checkin_code, full_name: name(), phone: known.phone, city: 'לוד', age: '30', source: 'instagram' } });
    expect(stranger.data.result).toBe('checked_in');
    expect(stranger.data.device).toBeUndefined();

    const ev2 = await makeEvent({ startsInMinutes: 25 });
    const self = await v.rpc('public_walkin', { p: { code: ev2.checkin_code, full_name: known.full_name, phone: known.phone, city: 'מודיעין', age: '30', source: 'instagram' } });
    expect(typeof self.data.device).toBe('string');

    const fresh = await v.rpc('public_walkin', { p: { code: ev2.checkin_code, full_name: name(), phone: phone(), city: 'לוד', age: '41', source: 'instagram' } });
    expect(typeof fresh.data.device).toBe('string');
  });

  it('"that\'s not me" also makes the phone forget the person', async () => {
    const v = visitor();
    const ev = await makeEvent({ startsInMinutes: 20 });
    const reg = registration(ev.public_code);
    await v.rpc('public_register', { p: reg });
    const c = await v.rpc('public_checkin', { p: { code: ev.checkin_code, phone: reg.phone } });
    expect(typeof c.data.device).toBe('string');
    const undo = await v.rpc('public_checkin_undo', { p_token: c.data.token });
    expect(undo.data).toEqual({ ok: true });
    const later = await v.rpc('public_checkin', { p: { code: ev.checkin_code, device: c.data.device } });
    expect(later.data).toEqual({ result: 'device_invalid' });
  });
});

describe('someone already on file at the door', () => {
  it('phone + the same full name checks in without the form; anything else asks for details, with one answer', async () => {
    const coord = await staff('coord');
    const v = visitor();
    const ev = await makeEvent({ startsInMinutes: 20 });
    const who = { n: name(), p: phone() };
    await coord.from('participants').insert({ full_name: who.n, phone: who.p, city: 'לוד' });

    const wrong = await v.rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: who.p, full_name: name(), website: '' } });
    const unknown = await v.rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: phone(), full_name: who.n, website: '' } });
    expect(wrong.data).toEqual({ result: 'need_details' });
    expect(unknown.data).toEqual(wrong.data);

    const ok = await v.rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: who.p, full_name: `  ${who.n.replace(' ', '   ')} `, website: '' } });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ result: 'checked_in', first_name: first(who.n), membership: 'none' });
    expect(typeof ok.data.device).toBe('string');
    const again = await v.rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: who.p, full_name: who.n, website: '' } });
    expect(again.data.result).toBe('already_checked_in');
    const { data: list } = await coord.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ phone: e164(who.p), attendance: 'attended', is_walk_in: true, checkin_method: 'self_qr' });

    // outside the check-in window, bad input, honeypot
    const later = await makeEvent({ startsInMinutes: 6 * 60 });
    expect((await v.rpc('public_checkin_known', { p: { code: later.checkin_code, phone: who.p, full_name: who.n, website: '' } })).data.result).toBe('window_not_open');
    expect((await v.rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: '12', full_name: who.n, website: '' } })).error?.message).toBe('invalid_phone');
    expect((await v.rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: who.p, full_name: who.n, website: 'x' } })).data).toEqual({ result: 'need_details' });
  });

  it('limits name guesses for one phone', async () => {
    const v = visitor();
    const ev = await makeEvent({ startsInMinutes: 20 });
    const p = phone();
    const tries = [];
    for (let i = 0; i < 6; i++) tries.push(await v.rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: p, full_name: name(), website: '' } }));
    expect(tries.slice(0, 5).every((t) => t.data?.result === 'need_details')).toBe(true);
    expect(tries[5].error?.message).toBe('rate_limited');
  });
});

describe('membership in the association', () => {
  it('a phone that checked in asks to join in one tap; staff get a task, which closes when they become a member', async () => {
    const v = visitor();
    const ev = await makeEvent({ startsInMinutes: 20 });
    const reg = registration(ev.public_code);
    await v.rpc('public_register', { p: reg });
    const c = await v.rpc('public_checkin', { p: { code: ev.checkin_code, phone: reg.phone } });

    const ask = await v.rpc('public_membership', { p: { device: c.data.device } });
    expect(ask.error).toBeNull();
    expect(ask.data).toEqual({ result: 'requested', first_name: first(reg.full_name) });
    const twice = await v.rpc('public_membership', { p: { device: c.data.device } });
    expect(twice.data.result).toBe('already_requested');

    const coord = await staff('coord');
    const { data: p } = await coord.from('participants').select('id, membership, membership_requested_at, member_since').eq('phone', e164(reg.phone)).single();
    expect(p).toMatchObject({ membership: 'requested', member_since: null });
    expect(p!.membership_requested_at).not.toBeNull();
    const tasks = async () => (await coord.from('follow_ups').select('status, type, notes').eq('participant_id', p!.id).eq('type', 'membership')).data!;
    expect(await tasks()).toEqual([{ status: 'open', type: 'membership', notes: null }]);

    // the association accepts them
    const up = await coord.from('participants').update({ membership: 'member' }).eq('id', p!.id);
    expect(up.error).toBeNull();
    const { data: after } = await coord.from('participants').select('membership, member_since').eq('id', p!.id).single();
    expect(after!.membership).toBe('member');
    expect(after!.member_since).not.toBeNull();
    expect((await tasks()).map((t: any) => t.status)).toEqual(['done']);

    const member = await v.rpc('public_membership', { p: { device: c.data.device } });
    expect(member.data.result).toBe('already_member');

    // the welcome screen at the next check-in knows
    const ev2 = await makeEvent({ startsInMinutes: 30 });
    const c2 = await v.rpc('public_checkin', { p: { code: ev2.checkin_code, device: c.data.device } });
    expect(c2.data.membership).toBe('member');
  });

  it('the name-and-phone form gives the same answer for every phone and changes nothing it should not', async () => {
    const coord = await staff('coord');
    // an existing member: the form must not reveal it, nor touch the card
    const memberPhone = phone();
    const memberName = name();
    const { data: m } = await coord.from('participants').insert({ full_name: memberName, phone: memberPhone, membership: 'member' }).select('id').single();
    const v = visitor();
    const r1 = await v.rpc('public_membership', { p: { full_name: name(), phone: memberPhone, website: '' } });
    expect(r1.data).toEqual({ result: 'requested' });
    const { data: still } = await coord.from('participants').select('full_name, membership').eq('id', m!.id).single();
    expect(still).toEqual({ full_name: memberName, membership: 'member' });
    expect((await coord.from('follow_ups').select('id').eq('participant_id', m!.id)).data).toEqual([]);

    // someone new: a card from the form, asked to join, with a task
    const newPhone = phone();
    const newName = name();
    const r2 = await v.rpc('public_membership', { p: { full_name: newName, phone: newPhone, website: '' } });
    expect(r2.data).toEqual({ result: 'requested' });
    const { data: n } = await coord.from('participants').select('id, full_name, membership, created_via').eq('phone', e164(newPhone)).single();
    expect(n).toMatchObject({ full_name: newName, membership: 'requested', created_via: 'membership_form' });
    expect((await coord.from('follow_ups').select('type, status').eq('participant_id', n!.id)).data).toEqual([{ type: 'membership', status: 'open' }]);

    // an existing non-member whose phone was typed with another name: the task warns staff
    const otherPhone = phone();
    const { data: o } = await coord.from('participants').insert({ full_name: name(), phone: otherPhone }).select('id').single();
    const typed = name();
    await v.rpc('public_membership', { p: { full_name: typed, phone: otherPhone, website: '' } });
    const { data: t } = await coord.from('follow_ups').select('notes').eq('participant_id', o!.id).single();
    expect(t!.notes).toContain(typed);

    // bad input, and the honeypot
    expect((await v.rpc('public_membership', { p: { full_name: name(), phone: '123', website: '' } })).error?.message).toBe('invalid_phone');
    expect((await v.rpc('public_membership', { p: { full_name: 'א', phone: phone(), website: '' } })).error?.message).toBe('invalid_name');
    const botPhone = phone();
    const bot = await v.rpc('public_membership', { p: { full_name: name(), phone: botPhone, website: 'spam.example' } });
    expect(bot.data).toEqual({ result: 'requested' });
    expect((await coord.from('participants').select('id').eq('phone', e164(botPhone))).data).toEqual([]);
  });

  it('the door list shows members and who invited whom (first name only)', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ startsInMinutes: 20 });
    const v = visitor();
    const host = registration(ev.public_code);
    await v.rpc('public_register', { p: host });
    await coord.from('participants').update({ membership: 'member' }).eq('phone', e164(host.phone));
    const guest = registration(ev.public_code, { source: 'friend', referrer: host.phone });
    await v.rpc('public_register', { p: guest });
    const c = await v.rpc('public_checkin', { p: { code: ev.checkin_code, phone: host.phone } });
    expect(c.data.membership).toBe('member');

    const door = await staff('door');
    const { data: list, error } = await door.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(error).toBeNull();
    const byName = (n: string) => list.find((x: any) => x.display_name === n);
    expect(byName(host.full_name)).toMatchObject({ is_member: true, invited_by: null });
    expect(byName(guest.full_name)).toMatchObject({ is_member: false, invited_by: first(host.full_name), phone: null });
  });
});

describe('thank-you 24 hours after the meeting', () => {
  it('appears on the dashboard 24 hours after the end, counts who gets the join invitation, and clears once sent', async () => {
    const coord = await staff('coord');
    const mk = async (extra: Record<string, unknown>) =>
      (await coord.from('participants').insert({ full_name: name(), phone: phone(), ...extra }).select('id').single()).data!.id as string;
    const member = await mk({ membership: 'member' });
    const invitee = await mk({ consent_updates: true });
    const noConsent = await mk({});

    const attend = async (eventId: string, ids: string[]) => {
      for (const id of ids) {
        const { data } = await coord.rpc('staff_register', { p_event_id: eventId, p_participant_id: id });
        await coord.rpc('staff_set_attendance', { p_registration_id: data.registration_id, p_attendance: 'attended' });
      }
    };
    const ended = await makeEvent({ startsInMinutes: -30 * 60 });           // ended 27.5 hours ago
    const recent = await makeEvent({ startsInMinutes: -4 * 60 });           // ended 1.5 hours ago
    await attend(ended.id, [member, invitee, noConsent]);
    await attend(recent.id, [member]);

    const item = async (id: string) => ((await coord.rpc('attention_items')).data.aftercare as any[]).find((x) => x.id === id);
    expect(await item(ended.id)).toMatchObject({ pending: 3, join_invites: 1 });
    expect(await item(recent.id)).toBeUndefined();

    const log = (participant_id: string, template_key: string) =>
      coord.from('contact_log').insert({ participant_id, channel: 'whatsapp', template_key, event_id: ended.id });
    await log(invitee, 'join_invite');
    await log(member, 'thanks');
    expect(await item(ended.id)).toMatchObject({ pending: 1, join_invites: 0 });
    await log(noConsent, 'thanks');
    expect(await item(ended.id)).toBeUndefined();

    const { data: tpl } = await coord.from('message_templates').select('key, is_marketing').in('key', ['join_invite', 'membership_reply']).order('key');
    expect(tpl).toEqual([{ key: 'join_invite', is_marketing: true }, { key: 'membership_reply', is_marketing: false }]);
  });
});
