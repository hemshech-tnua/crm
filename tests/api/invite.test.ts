// First entry by a personal link (migration 20261106001700 + staff-admin invite / claim).
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ANON_KEY, API_URL } from './env';
import { phone, staff } from './helpers';

const fresh = () => createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function call(body: Record<string, unknown>, as: 'admin' | 'coord' = 'admin') {
  const c = await staff(as);
  const token = (await c.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${API_URL}/functions/v1/staff-admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function claim(token: string, email: string) {
  const res = await fetch(`${API_URL}/functions/v1/staff-admin?claim=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, email }),
  });
  return { status: res.status, body: await res.json() };
}

describe('first entry by a personal link', () => {
  it('the person types their own email and is signed in; the link works once', async () => {
    const created = await call({ action: 'create', full_name: 'מנהל בקישור', phone: phone(), role: 'admin' });
    expect(created.status).toBe(200);
    const inv = await call({ action: 'invite', user_id: created.body.user_id });
    expect(inv.body.token).toMatch(/^[A-Za-z0-9]{32}$/);

    const email = `first-${Date.now()}@example.test`;
    const c = await claim(inv.body.token, email);
    expect(c.status).toBe(200);
    const user = fresh();
    expect((await user.auth.verifyOtp({ token_hash: c.body.token_hash, type: 'magiclink' })).error).toBeNull();
    expect((await user.rpc('staff_me')).data).toMatchObject({ email, role: 'admin', must_change_password: false });

    // once only
    expect((await claim(inv.body.token, `other-${Date.now()}@example.test`)).body.error).toBe('invite_invalid');
  });

  it('only admins create links; a new link replaces the old one; nonsense is refused', async () => {
    const created = await call({ action: 'create', full_name: 'רכזת בקישור', phone: phone(), role: 'coordinator' });
    expect((await call({ action: 'invite', user_id: created.body.user_id }, 'coord')).status).toBe(403);
    const first = await call({ action: 'invite', user_id: created.body.user_id });
    const second = await call({ action: 'invite', user_id: created.body.user_id });
    expect((await claim(first.body.token, `a-${Date.now()}@example.test`)).body.error).toBe('invite_invalid');
    expect((await claim(second.body.token, 'not-an-email')).body.error).toBe('invalid_email');
    expect((await claim('x'.repeat(32), `b-${Date.now()}@example.test`)).body.error).toBe('invite_invalid');
    expect((await claim(second.body.token, `c-${Date.now()}@example.test`)).status).toBe(200);
  });
});
