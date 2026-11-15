// Two-step sign-in (TOTP) and the admin security overview (migration 20261106002100_security_gaps.sql, staff-admin).
import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ANON_KEY, API_URL, DB_URL, SERVICE_KEY } from './env';
import { phone, staff, totp } from './helpers';

const fresh = () => createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const fn = `${API_URL}/functions/v1/staff-admin`;
async function post(body: unknown, token?: string, query = '') {
  const r = await fetch(`${fn}${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const tokenOf = async (c: SupabaseClient) => (await c.auth.getSession()).data.session!.access_token;

/** A new coordinator with an own password, signed in (aal1). */
async function newCoordinator() {
  const admin = await tokenOf(await staff('admin'));
  const p = phone();
  const created = (await post({ action: 'create', full_name: 'רכזת אימות', phone: p, role: 'coordinator' }, admin)).body;
  const temp = (await post({ action: 'reset_password', user_id: created.user_id }, admin)).body.temp_password;
  let s = (await post({ phone: p, password: temp }, undefined, '?login=1')).body;
  const own = `Mfa-Coord-${Date.now()}`;
  expect((await post({ action: 'change_password', new_password: own }, s.access_token)).status).toBe(200);
  s = (await post({ phone: p, password: own }, undefined, '?login=1')).body;
  const c = fresh();
  await c.auth.setSession(s);
  return { c, p, own, userId: created.user_id as string, admin };
}

describe('two-step sign-in', () => {
  it('once turned on, a password-only session gets no data and no admin actions until the code is entered', async () => {
    const { c, p, own, userId, admin } = await newCoordinator();
    expect((await c.from('participants').select('id').limit(1)).error).toBeNull();

    // turn it on: enroll, verify with a code from the "app"
    const { data: en, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'test' });
    expect(error).toBeNull();
    expect((await c.auth.mfa.challengeAndVerify({ factorId: en!.id, code: totp(en!.totp.secret) })).error).toBeNull();
    expect((await c.rpc('staff_me')).data).toMatchObject({ mfa_enrolled: true, aal: 'aal2', role: 'coordinator' });

    // a new sign-in with the password alone
    const s = (await post({ phone: p, password: own }, undefined, '?login=1')).body;
    const c2 = fresh();
    await c2.auth.setSession(s);
    expect((await c2.rpc('staff_me')).data).toMatchObject({ mfa_enrolled: true, aal: 'aal1' });
    const coordCanSee = (await (await staff('coord')).from('participants').select('id', { count: 'exact', head: true })).count!;
    expect(coordCanSee).toBeGreaterThan(0);
    expect((await c2.from('participants').select('id', { count: 'exact', head: true })).count).toBe(0);
    expect((await c2.rpc('staff_checkin_list', { p_event_id: '00000000-0000-4000-8000-000000000001' })).error).not.toBeNull();
    expect((await post({ action: 'change_password', new_password: 'Another-Pass-2026x' }, s.access_token)).body.error).toBe('mfa_required');

    // a wrong code does nothing; the right one opens everything
    const factorId = (await c2.auth.mfa.listFactors()).data!.totp[0].id;
    expect((await c2.auth.mfa.challengeAndVerify({ factorId, code: '000000' })).error).not.toBeNull();
    expect((await c2.auth.mfa.challengeAndVerify({ factorId, code: totp(en!.totp.secret) })).error).toBeNull();
    expect((await c2.from('participants').select('id', { count: 'exact', head: true })).count).toBe(coordCanSee);

    // lost phone: another admin resets it; the person cannot reset their own through the admin action
    expect((await post({ action: 'reset_mfa', user_id: userId }, await tokenOf(c2))).status).toBe(403);
    expect((await post({ action: 'reset_mfa', user_id: userId }, admin)).status).toBe(200);
    const s3 = (await post({ phone: p, password: own }, undefined, '?login=1')).body;
    const c3 = fresh();
    await c3.auth.setSession(s3);
    expect((await c3.rpc('staff_me')).data).toMatchObject({ mfa_enrolled: false });
    expect((await c3.from('participants').select('id', { count: 'exact', head: true })).count).toBe(coordCanSee);
  });
});

describe('admin security overview', () => {
  it('shows accounts that are not staff, throttles at their limit, and two-step status; admins only', async () => {
    const svc = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const email = `stranger-${Date.now()}@example.org`;
    const { data: u } = await svc.auth.admin.createUser({ email, password: 'Stranger-Pass-2026', email_confirm: true });
    try {
      const admin = await staff('admin');
      const { data, error } = await admin.rpc('admin_security_overview');
      expect(error).toBeNull();
      expect(data.unknown_accounts.some((a: { email: string }) => a.email === email)).toBe(true);
      expect(Object.keys(data.limits_24h)).toEqual(expect.arrayContaining(['staff_phone_locked', 'invite_probing', 'form_flooding']));
      expect(data.staff.some((m: { full_name: string; mfa: boolean }) => typeof m.mfa === 'boolean')).toBe(true);
      expect((await (await staff('coord')).rpc('admin_security_overview')).error).not.toBeNull();
      expect((await fresh().rpc('admin_security_overview')).error).not.toBeNull();
    } finally {
      await svc.auth.admin.deleteUser(u!.user!.id);
    }
  });

  it('signed-in users can run only the private helpers that policies and defaults need', () => {
    const can = (f: string) => execSync(`psql "${DB_URL}" -Atc "select has_function_privilege('authenticated', '${f}', 'execute')"`).toString().trim();
    expect(can('private.has_role(text[])')).toBe('t');
    expect(can('private.issue_device(uuid)')).toBe('f');
    expect(can('private.device_participant(text)')).toBe('f');
    expect(can('private.set_registration_token(uuid, text)')).toBe('f');
  });
});
