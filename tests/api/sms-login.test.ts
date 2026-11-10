// Staff sign-in by a one-time SMS code (migration 20261106001600 + staff-admin). Local Supabase answers the test
// numbers in supabase/config.toml ([auth.sms.test_otp]) with a fixed code and sends nothing.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { ANON_KEY, API_URL, DB_URL } from './env';
import { staff } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const CODE = '246810';
const fresh = () => createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function call(client: SupabaseClient, body: Record<string, unknown>) {
  const token = (await client.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${API_URL}/functions/v1/staff-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// the test numbers are fixed (they have fixed codes), so accounts from an earlier run are removed first
beforeAll(() => {
  execSync(`psql "${DB_URL}" -qc "delete from auth.users where phone in ('972500000901','972500000902','972500000903','972500000904')"`);
});

describe('staff sign-in by SMS code', () => {
  it('an admin adds a person by phone; they sign in with the code, without any password', async () => {
    const admin = await staff('admin');
    const created = await call(admin, { action: 'create', full_name: 'מנהלת בקוד', phone: '050-000-0901', role: 'admin' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ login: 'code', temp_password: null });

    const user = fresh();
    expect((await user.auth.signInWithOtp({ phone: '+972500000901', options: { shouldCreateUser: false } })).error).toBeNull();
    const wrong = await user.auth.verifyOtp({ phone: '+972500000901', token: '000000', type: 'sms' });
    expect(wrong.error).not.toBeNull();
    const ok = await user.auth.verifyOtp({ phone: '+972500000901', token: CODE, type: 'sms' });
    expect(ok.error).toBeNull();
    const { data: me } = await user.rpc('staff_me');
    expect(me).toMatchObject({ full_name: 'מנהלת בקוד', phone: '+972500000901', email: null, role: 'admin', must_change_password: false });
    // full access right away (no temporary password step)
    const { error } = await user.from('events').select('id').limit(1);
    expect(error).toBeNull();
    // and no password to reset
    expect((await call(admin, { action: 'reset_password', user_id: created.body.user_id })).body.error).toBe('no_email');
    // the same phone cannot be given to a second person
    expect((await call(admin, { action: 'create', full_name: 'כפילות', phone: '0500000901', role: 'volunteer' })).body.error).toBe('phone_exists');
  });

  it('a phone that is not on the team gets no account and no access', async () => {
    const stranger = fresh();
    const r = await stranger.auth.signInWithOtp({ phone: '+972500000903', options: { shouldCreateUser: false } });
    expect(r.error).not.toBeNull();
    const v = await stranger.auth.verifyOtp({ phone: '+972500000903', token: CODE, type: 'sms' });
    expect(v.error).not.toBeNull();
    expect((await stranger.auth.getSession()).data.session).toBeNull();
  });

  it('an existing email account can switch to SMS sign-in, and a deactivated person cannot get in', async () => {
    const admin = await staff('admin');
    const created = await call(admin, { action: 'create', full_name: 'רכז מעבר', email: `switch-${Date.now()}@example.test`, role: 'coordinator', login: 'password' });
    expect(created.body.login).toBe('password');
    const id = created.body.user_id;
    expect((await call(admin, { action: 'update', user_id: id, phone: '050 000 0902' })).status).toBe(200);
    const { data: row } = await admin.from('staff').select('phone, must_change_password').eq('user_id', id).single();
    expect(row).toEqual({ phone: '+972500000902', must_change_password: false });

    const user = fresh();
    await user.auth.signInWithOtp({ phone: '+972500000902', options: { shouldCreateUser: false } });
    expect((await user.auth.verifyOtp({ phone: '+972500000902', token: CODE, type: 'sms' })).error).toBeNull();
    expect((await user.rpc('staff_me')).data.role).toBe('coordinator');

    expect((await call(admin, { action: 'update', user_id: id, is_active: false })).status).toBe(200);
    const again = fresh();
    await again.auth.signInWithOtp({ phone: '+972500000902', options: { shouldCreateUser: false } });
    expect((await again.auth.verifyOtp({ phone: '+972500000902', token: CODE, type: 'sms' })).error).not.toBeNull();
    // bad input
    expect((await call(admin, { action: 'create', full_name: 'בלי כלום', role: 'volunteer' })).body.error).toBe('login_required');
    expect((await call(admin, { action: 'create', full_name: 'קווי', phone: '02-6543210', role: 'volunteer' })).body.error).toBe('invalid_phone');
  });
});
