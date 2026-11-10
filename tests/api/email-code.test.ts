// Staff sign-in by a one-time code sent by email. Local Supabase delivers the email to Mailpit, read here by API.
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ANON_KEY, API_URL } from './env';
import { mailedCode, staff } from './helpers';

const fresh = () => createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function call(body: Record<string, unknown>) {
  const admin = await staff('admin');
  const token = (await admin.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${API_URL}/functions/v1/staff-admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('staff sign-in by email code', () => {
  it('a new account gets a code by email and is in, with no password', async () => {
    const email = `code-${Date.now()}@example.test`;
    const created = await call({ action: 'create', full_name: 'מנהל בקוד מייל', email, role: 'admin' });
    expect(created.body).toMatchObject({ login: 'code', temp_password: null });

    const user = fresh();
    expect((await user.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })).error).toBeNull();
    const code = await mailedCode(email);
    expect(code).toMatch(/^\d{6,8}$/);
    expect((await user.auth.verifyOtp({ email, token: '000000', type: 'email' })).error).not.toBeNull();
    expect((await user.auth.verifyOtp({ email, token: code!, type: 'email' })).error).toBeNull();
    expect((await user.rpc('staff_me')).data).toMatchObject({ email, role: 'admin', must_change_password: false });
    expect((await user.from('events').select('id').limit(1)).error).toBeNull();
  });

  it('an address that is not on the team gets no code and no account', async () => {
    const email = `stranger-${Date.now()}@example.test`;
    const r = await fresh().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    expect(r.error).not.toBeNull();
    expect(await mailedCode(email).then((c) => c, () => null)).toBeNull();
  });

  it('an admin can add or change the email of an SMS account', async () => {
    const created = await call({ action: 'create', full_name: 'מוסיפה מייל', phone: '050-000-0904', role: 'coordinator' });
    expect(created.status).toBe(200);
    const email = `added-${Date.now()}@example.test`;
    expect((await call({ action: 'update', user_id: created.body.user_id, email })).status).toBe(200);
    const user = fresh();
    await user.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    const code = await mailedCode(email);
    expect((await user.auth.verifyOtp({ email, token: code!, type: 'email' })).error).toBeNull();
    expect((await call({ action: 'update', user_id: created.body.user_id, email: 'not-an-email' })).body.error).toBe('invalid_email');
  });
});
