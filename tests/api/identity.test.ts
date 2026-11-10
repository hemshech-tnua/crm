// A phone number is not proof of identity (security audit, database review findings 1-3;
// migration 20261106001900_phone_is_not_identity.sql). Anyone may know someone's number: typing it must not hand
// out that person's card (invite code, counts, membership, a remembered-phone token), opt them in to updates,
// replace their own link, or overwrite their feedback.
import { describe, expect, it } from 'vitest';
import { e164, makeEvent, name, registration, staff, visitor } from './helpers';

const first = (n: string) => n.split(' ')[0];

describe('a phone number alone is not who you are', () => {
  it('registering with someone else\'s number and another name reveals nothing of their card and changes nothing on it', async () => {
    const coord = await staff('coord');
    const ev1 = await makeEvent();
    const victim = registration(ev1.public_code, { consent_updates: false });
    const own = await visitor().rpc('public_register', { p: victim });
    expect(typeof own.data.invite_code).toBe('string'); // the person themself gets their invite code

    const ev2 = await makeEvent({ startsInMinutes: 20 });
    const attacker = visitor();
    const fake = await attacker.rpc('public_register', { p: { ...registration(ev2.public_code), phone: victim.phone, full_name: 'מישהו אחר לגמרי', consent_updates: true } });
    expect(fake.error).toBeNull();
    expect(fake.data.first_name).toBe('מישהו');
    expect(fake.data.invite_code ?? null).toBeNull();
    expect(JSON.stringify(fake.data)).not.toContain(first(victim.full_name));

    // the manage page of that registration shows no invite code either
    const manage = await attacker.rpc('public_registration', { p_token: fake.data.token });
    expect(manage.data.invite_code ?? null).toBeNull();

    // not opted in to updates by a stranger
    const { data: card } = await coord.from('participants').select('consent_updates').eq('phone', e164(victim.phone)).single();
    expect(card!.consent_updates).toBe(false);

    // checking in with that registration's link: in, but no remembered-phone token and no card details
    const c = await attacker.rpc('public_checkin', { p: { code: ev2.checkin_code, token: fake.data.token } });
    expect(c.data.result).toBe('checked_in');
    expect(c.data.device ?? null).toBeNull();
    expect(c.data.invite_code ?? null).toBeNull();
    expect(c.data.membership ?? null).toBeNull();
    expect(c.data.attended_count ?? null).toBeNull();
    expect(c.data.first_name).toBe('מישהו');
  });

  it('the person themself, with the name on the card, still opts in and gets everything', async () => {
    const coord = await staff('coord');
    const ev1 = await makeEvent();
    const me = registration(ev1.public_code, { consent_updates: false });
    await visitor().rpc('public_register', { p: me });
    const ev2 = await makeEvent({ startsInMinutes: 20 });
    const again = await visitor().rpc('public_register', { p: { ...registration(ev2.public_code), phone: me.phone, full_name: me.full_name, consent_updates: true } });
    expect(typeof again.data.invite_code).toBe('string');
    const { data: card } = await coord.from('participants').select('consent_updates').eq('phone', e164(me.phone)).single();
    expect(card!.consent_updates).toBe(true);
    const c = await visitor().rpc('public_checkin', { p: { code: ev2.checkin_code, token: again.data.token } });
    expect(typeof c.data.device).toBe('string');
    expect(c.data.attended_count).toBe(1);
  });

  it('check-in by phone alone asks for the name, and checks in no one', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ startsInMinutes: 20 });
    const victim = registration(ev.public_code);
    const own = await visitor().rpc('public_register', { p: victim });

    const c = await visitor().rpc('public_checkin', { p: { code: ev.checkin_code, phone: victim.phone } });
    expect(c.data).toEqual({ result: 'not_registered' });
    const { data: reg } = await coord.from('registrations').select('attendance').eq('event_id', ev.id).single();
    expect(reg!.attendance).toBe('unknown');

    // a wrong name: the short walk-in form; the person's own registration keeps its link and is not handed out
    const k = await visitor().rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: victim.phone, full_name: 'מישהו אחר' } });
    expect(k.data).toEqual({ result: 'need_details' });
    const w = await visitor().rpc('public_walkin', { p: { code: ev.checkin_code, full_name: 'מישהו אחר', phone: victim.phone, city: 'לוד', age: '30', source: 'instagram' } });
    expect(w.data.result).toBe('checked_in');
    expect(w.data.token ?? null).toBeNull();
    expect(w.data.device ?? null).toBeNull();
    expect(w.data.invite_code ?? null).toBeNull();
    expect((await visitor().rpc('public_registration', { p_token: own.data.token })).error).toBeNull();

    // the right name: checked in, remembered
    const right = await visitor().rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: victim.phone, full_name: victim.full_name } });
    expect(right.data.result).toBe('already_checked_in');
    expect(typeof right.data.device).toBe('string');
  });

  it('the open event feedback link never overwrites feedback the person already gave', async () => {
    const coord = await staff('coord');
    const ev = await makeEvent({ startsInMinutes: -30 });
    const ph = registration(ev.public_code).phone;
    const full = name();
    await coord.from('participants').insert({ full_name: full, phone: ph });
    const me = await visitor().rpc('public_checkin_known', { p: { code: ev.checkin_code, phone: ph, full_name: full } });
    expect(me.data.result).toBe('checked_in');
    expect((await visitor().rpc('public_submit_feedback', { p: { token: me.data.token, overall: 5, comment: 'היה מעולה' } })).error).toBeNull();

    await visitor().rpc('public_submit_feedback', { p: { event: ev.public_code, phone: ph, overall: 1, comment: 'נכתב על ידי מישהו אחר' } });
    const { data: fb } = await coord.from('feedback').select('overall_rating, comment').eq('event_id', ev.id).not('registration_id', 'is', null);
    expect(fb).toEqual([{ overall_rating: 5, comment: 'היה מעולה' }]);

    // the person's own link may still correct it
    await visitor().rpc('public_submit_feedback', { p: { token: me.data.token, overall: 4, comment: 'תיקון' } });
    const { data: fb2 } = await coord.from('feedback').select('overall_rating').eq('event_id', ev.id).not('registration_id', 'is', null);
    expect(fb2).toEqual([{ overall_rating: 4 }]);
  });
});
