// The permanent entrance sign (migration 20261106001500): one QR per site leads to whichever meeting there is open.
import { describe, expect, it } from 'vitest';
import { makeEvent, staff, visitor } from './helpers';

describe('one permanent QR per site', () => {
  it('leads to the meeting open for check-in now, or says when the next one opens', async () => {
    const admin = await staff('admin');
    const { data: site } = await admin.from('sites').insert({ name: `מתחם שלט ${Date.now()}` }).select('id, checkin_code').single();
    expect(site!.checkin_code).toMatch(/^[a-z2-9]{10}$/);
    const v = visitor();
    const ask = async () => (await v.rpc('public_site_checkin', { p_code: site!.checkin_code.toUpperCase() })).data;

    expect(await ask()).toMatchObject({ open: [], next: null });

    const later = await makeEvent({ site_id: site!.id, startsInMinutes: 5 * 60 });
    const n = await ask();
    expect(n.open).toEqual([]);
    expect(n.next.event.code).toBe(later.public_code);
    expect(new Date(n.next.opens_at).getTime()).toBe(new Date(later.starts_at).getTime() - 120 * 60_000);

    const now1 = await makeEvent({ site_id: site!.id, startsInMinutes: 20 });
    const one = await ask();
    expect(one.open.map((o: any) => o.checkin_code)).toEqual([now1.checkin_code]);
    expect(one.next).toBeNull();

    const now2 = await makeEvent({ site_id: site!.id, startsInMinutes: 40, type: 'other', title: 'פעילות נוספת (בדיקה)' });
    expect((await ask()).open.map((o: any) => o.checkin_code)).toEqual([now1.checkin_code, now2.checkin_code]);

    // a draft or cancelled meeting is never offered
    await makeEvent({ site_id: site!.id, startsInMinutes: 30, status: 'draft' });
    expect((await ask()).open).toHaveLength(2);
  });

  it('unknown or inactive sites answer "not found"; only an admin can replace a leaked code', async () => {
    const admin = await staff('admin');
    const { data: site } = await admin.from('sites').insert({ name: `מתחם החלפה ${Date.now()}` }).select('id, checkin_code').single();
    const v = visitor();
    expect((await v.rpc('public_site_checkin', { p_code: 'nosuchcode' })).error?.message).toBe('site_not_found');

    const coord = await staff('coord');
    expect((await coord.rpc('admin_rotate_site_code', { p_site_id: site!.id })).error?.message).toBe('forbidden');
    const { data: fresh, error } = await admin.rpc('admin_rotate_site_code', { p_site_id: site!.id });
    expect(error).toBeNull();
    expect(fresh).not.toBe(site!.checkin_code);
    expect((await v.rpc('public_site_checkin', { p_code: site!.checkin_code })).error?.message).toBe('site_not_found');
    expect((await v.rpc('public_site_checkin', { p_code: fresh })).error).toBeNull();

    await admin.from('sites').update({ is_active: false }).eq('id', site!.id);
    expect((await v.rpc('public_site_checkin', { p_code: fresh })).error?.message).toBe('site_not_found');
  });
});
