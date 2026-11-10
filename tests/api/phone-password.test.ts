// Sign-in with phone + password (staff-admin ?login=1, migration 20261106001800).
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { ANON_KEY, API_URL, DB_URL } from './env';
import { e164, phone, staff } from './helpers';

async function call(body: Record<string, unknown>) {
  const admin = await staff('admin');
  const token = (await admin.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${API_URL}/functions/v1/staff-admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function login(p: string, password: string) {
  const res = await fetch(`${API_URL}/functions/v1/staff-admin?login=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, password }),
  });
  return { status: res.status, body: await res.json() };
}

// every local test shares one IP; start each test with fresh sign-in throttles
beforeEach(() => { execSync(`psql "${DB_URL}" -qc "delete from private.rate_limits where key like 'pwlogin-%'"`); });

describe('sign-in with phone and password', () => {
  it('a phone-only account gets a temporary password, signs in with phone + password, and must choose its own', async () => {
    const p = phone();
    const created = await call({ action: 'create', full_name: 'מנהל בטלפון', phone: p, role: 'admin' });
    expect(created.status).toBe(200);
    expect((await login(p, 'nothing-yet-1')).body.error).toBe('invalid_login');

    const reset = await call({ action: 'reset_password', user_id: created.body.user_id });
    expect(reset.status).toBe(200);
    const ok = await login(p.replace(/^0/, '+972'), reset.body.temp_password);
    expect(ok.status).toBe(200);
    const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await c.auth.setSession(ok.body)).error).toBeNull();
    const me = (await c.rpc('staff_me')).data;
    expect(me).toMatchObject({ phone: e164(p), email: null, must_change_password: true });

    expect((await login(p, 'wrong-password-1')).body.error).toBe('invalid_login');
    expect((await login('0509999999', reset.body.temp_password)).body.error).toBe('invalid_login');
  });

  it('a deactivated person cannot sign in', async () => {
    const p = phone();
    const created = await call({ action: 'create', full_name: 'חסומה', phone: p, role: 'coordinator' });
    const reset = await call({ action: 'reset_password', user_id: created.body.user_id });
    await call({ action: 'update', user_id: created.body.user_id, is_active: false });
    expect((await login(p, reset.body.temp_password)).body.error).toBe('invalid_login');
  });
});

describe('no staff-phone enumeration by timing (security audit F3)', () => {
  it('an unknown phone and a known phone with a wrong password take the same minimum time', async () => {
    const p = phone();
    await call({ action: 'create', full_name: 'תזמון', phone: p, role: 'volunteer' });
    const time = async (ph: string) => { const t = Date.now(); const r = await login(ph, 'wrong-password-1'); return { ms: Date.now() - t, r }; };
    const unknown = await time('0501111111');
    const known = await time(p);
    expect(unknown.r.body).toEqual({ error: 'invalid_login' });
    expect(known.r.body).toEqual({ error: 'invalid_login' });
    expect(unknown.ms).toBeGreaterThanOrEqual(340);
    expect(known.ms).toBeGreaterThanOrEqual(340);
  });
});
