// Scenario 1 (new user) at the API layer: an admin creates a user, the user must replace the temporary
// password before seeing any data, roles are enforced, and deactivation blocks sign-in.
import { describe, expect, it } from 'vitest';
import { API_URL } from './env';
import { signIn, staff, visitor } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

async function call(client: SupabaseClient | null, body: Record<string, unknown>) {
  const token = client ? (await client.auth.getSession()).data.session?.access_token : undefined;
  const res = await fetch(`${API_URL}/functions/v1/staff-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('staff administration', () => {
  it('rejects anonymous and non-admin callers', async () => {
    expect((await call(null, { action: 'create' })).status).toBe(401);
    const coord = await staff('coord');
    const r = await call(coord, { action: 'create', email: 'x@example.test', full_name: 'נסיון', role: 'admin' });
    expect(r.status).toBe(403);
  });

  it('creates a coordinator who must change the temporary password before accessing data', async () => {
    const admin = await staff('admin');
    const email = `new-${Date.now()}@example.test`;
    const created = await call(admin, { action: 'create', email, full_name: 'רכזת חדשה', role: 'coordinator' });
    expect(created.status).toBe(200);
    const temp = created.body.temp_password as string;
    expect(temp).toMatch(/^[A-Za-z0-9]{14}$/);

    const dup = await call(admin, { action: 'create', email, full_name: 'שוב', role: 'coordinator' });
    expect(dup.status).toBe(409);

    const user = await signIn(email, temp);
    const me = await user.rpc('staff_me');
    expect(me.data).toMatchObject({ role: 'coordinator', must_change_password: true });
    // still on a temporary password: no data
    const { data: before } = await user.from('events').select('id').limit(1);
    expect(before).toEqual([]);
    const { error: kpiErr } = await user.rpc('report_kpis', {});
    expect(kpiErr?.message).toBe('forbidden');

    expect((await call(user, { action: 'change_password', new_password: 'short1' })).status).toBe(400);
    expect((await call(user, { action: 'change_password', new_password: 'onlyletterslong' })).status).toBe(400);
    const ok = await call(user, { action: 'change_password', new_password: 'Shabbat-Shalom-2026' });
    expect(ok.status).toBe(200);

    const fresh = await signIn(email, 'Shabbat-Shalom-2026');
    const { data: after, error } = await fresh.from('events').select('id').limit(1);
    expect(error).toBeNull();
    expect(after!.length).toBeGreaterThanOrEqual(0);
    const { error: kpi2 } = await fresh.rpc('report_kpis', {});
    expect(kpi2).toBeNull();

    // the coordinator cannot use admin actions
    const self = await call(fresh, { action: 'update', user_id: created.body.user_id, role: 'admin' });
    expect(self.status).toBe(403);

    // admin deactivates: sign-in is blocked and existing sessions lose data access
    const off = await call(admin, { action: 'update', user_id: created.body.user_id, is_active: false });
    expect(off.status).toBe(200);
    const { data: blocked } = await fresh.from('events').select('id').limit(1);
    expect(blocked).toEqual([]);
    await expect(signIn(email, 'Shabbat-Shalom-2026')).rejects.toBeTruthy();

    // reactivate + reset password
    expect((await call(admin, { action: 'update', user_id: created.body.user_id, is_active: true })).status).toBe(200);
    const reset = await call(admin, { action: 'reset_password', user_id: created.body.user_id });
    expect(reset.status).toBe(200);
    const again = await signIn(email, reset.body.temp_password);
    expect((await again.rpc('staff_me')).data.must_change_password).toBe(true);
  });

  it('protects the last admin and the admin\'s own access', async () => {
    const admin = await staff('admin');
    const r = await call(admin, { action: 'update', user_id: '10000000-0000-4000-8000-000000000001', role: 'coordinator' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('cannot_change_self');
  });

  it('staff actions are written to the audit log', async () => {
    const admin = await staff('admin');
    const { data } = await admin.from('audit_log').select('action, entity').eq('entity', 'staff').in('action', ['staff_create', 'password_changed', 'staff_update', 'staff_reset_password']);
    const actions = new Set((data ?? []).map((x) => x.action));
    expect(actions.has('staff_create')).toBe(true);
    expect(actions.has('password_changed')).toBe(true);
    expect(actions.has('staff_update')).toBe(true);
    void visitor;
  });
});
