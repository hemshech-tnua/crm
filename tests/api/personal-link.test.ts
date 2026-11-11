// A personal link for someone the team registered (migration 20261106002000_personal_link.sql).
import { describe, expect, it } from 'vitest';
import { makeEvent, name, phone, staff, visitor } from './helpers';

async function teamRegistered(startsInMinutes = 20) {
  const coord = await staff('coord');
  const ev = await makeEvent({ startsInMinutes });
  const full = name();
  const { data: p } = await coord.from('participants').insert({ full_name: full, phone: phone(), created_via: 'import' }).select('id').single();
  const { data: reg, error } = await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });
  expect(error).toBeNull();
  return { coord, ev, full, registrationId: reg.registration_id as string };
}

describe('personal link for a registration the team made', () => {
  it('opens the person\'s registration, and at the door their check-in is one tap that remembers the phone', async () => {
    const { coord, ev, full, registrationId } = await teamRegistered();
    const { data: token, error } = await coord.rpc('staff_personal_link', { p_registration_id: registrationId });
    expect(error).toBeNull();
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const v = visitor();
    const mine = await v.rpc('public_registration', { p_token: token });
    expect(mine.error).toBeNull();
    expect(mine.data).toMatchObject({ status: 'registered', first_name: full.split(' ')[0] });

    const c = await v.rpc('public_checkin', { p: { code: ev.checkin_code, token } });
    expect(c.data.result).toBe('checked_in');
    expect(typeof c.data.device).toBe('string');
    const { data: row } = await coord.from('registrations').select('attendance, checkin_method').eq('id', registrationId).single();
    expect(row).toEqual({ attendance: 'attended', checkin_method: 'self_qr' });
  });

  it('a new link replaces the previous one', async () => {
    const { coord, registrationId } = await teamRegistered();
    const first = (await coord.rpc('staff_personal_link', { p_registration_id: registrationId })).data;
    const second = (await coord.rpc('staff_personal_link', { p_registration_id: registrationId })).data;
    expect(second).not.toBe(first);
    expect((await visitor().rpc('public_registration', { p_token: first })).error?.message).toBe('token_invalid');
    expect((await visitor().rpc('public_registration', { p_token: second })).error).toBeNull();
  });

  it('only admins and coordinators make links, and only for an active registration', async () => {
    const { coord, registrationId } = await teamRegistered();
    expect((await (await staff('door')).rpc('staff_personal_link', { p_registration_id: registrationId })).error).not.toBeNull();
    expect((await visitor().rpc('staff_personal_link', { p_registration_id: registrationId })).error).not.toBeNull();
    expect((await coord.rpc('staff_personal_link', { p_registration_id: '00000000-0000-4000-8000-0000000000aa' })).error?.message).toBe('not_found');
    expect((await coord.rpc('staff_cancel_registration', { p_registration_id: registrationId })).error).toBeNull();
    expect((await coord.rpc('staff_personal_link', { p_registration_id: registrationId })).error?.message).toBe('not_found');
  });
});
