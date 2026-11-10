// Staff administration for Hemshech Tnua CRM.
// Actions:
//   change_password  any signed-in staff member (also on a temporary password)
//   create           admin: new staff user who signs in with a one-time code by email and/or SMS (no password).
//                    With login: 'password' (email required): a one-time temporary password instead.
//   reset_password   admin: new temporary password, user must change it on next sign-in (email accounts)
//   update           admin: name / role / active (deactivation also blocks sign-in) / phone / email
//   invite           admin: a one-time first-entry link for a staff member (7 days)
//   claim_invite     no session: the link's owner types their email and gets a sign-in token (no email is sent)
// Runs with the service role. The caller's session is verified here, and every action is written to audit_log.

// No third-party imports: plain fetch against the project's Auth and REST APIs (smaller attack surface, no install step).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!;
// Default: the association's GitHub Pages site (and the earlier address, until it is retired) plus local development. A custom domain is added with the ALLOWED_ORIGINS secret.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://hemshech-tnua.github.io,https://hanochgo7-gif.github.io,http://127.0.0.1:3100,http://localhost:3100,http://127.0.0.1:4173,http://localhost:4173')
  .split(',').map((s) => s.trim()).filter(Boolean);

const ROLES = ['admin', 'coordinator', 'volunteer'] as const;
type Role = (typeof ROLES)[number];

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function tempPassword(): string {
  // 14 characters from a 54-symbol alphabet (~80 bits); retried until it has a digit and a letter
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    let out = '';
    for (const b of bytes) out += alphabet[b % alphabet.length];
    if (/\d/.test(out) && /[A-Za-z]/.test(out)) return out;
  }
}

function validPassword(pw: unknown, email?: string): pw is string {
  return typeof pw === 'string' && pw.length >= 10 && pw.length <= 72 && /[A-Za-z֐-׿]/.test(pw) && /\d/.test(pw)
    && (!email || !pw.toLowerCase().includes(email.split('@')[0].toLowerCase()));
}

const emailRe = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;

// Mirrors private.normalize_phone() in the database: Israeli formats to E.164 (+9725…).
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.replace(/[\s\-.()\u200e\u200f\u202a-\u202e]/g, '');
  if (!v) return null;
  if (v.startsWith('00')) v = '+' + v.slice(2);
  if (/^0[2-9]\d{7,8}$/.test(v)) v = '+972' + v.slice(1);
  if (/^972[2-9]\d{7,8}$/.test(v)) v = '+' + v;
  if (v.startsWith('+9720')) v = '+972' + v.slice(5);
  if (v.startsWith('+972')) return /^\+9725\d{8}$/.test(v) ? v : null; // staff sign in by SMS: mobile numbers only
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function inviteToken(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(32))) out += alphabet[b % alphabet.length];
  return out;
}

// Minimal service-role clients for Auth admin and PostgREST.
function svcHeaders(extra: HeadersInit = {}): HeadersInit {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra };
}
async function authGetUser(jwt: string): Promise<{ id: string; email?: string } | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!r.ok) return null;
  return await r.json();
}
async function authAdmin(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users${path}`, { method, headers: svcHeaders(), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  return { ok: r.ok, status: r.status, data };
}
async function rest(method: string, path: string, body?: unknown, prefer = 'return=representation'): Promise<{ ok: boolean; data: any; count: number | null }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: svcHeaders({ Prefer: prefer }), body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const range = r.headers.get('content-range');
  return { ok: r.ok, data: text ? JSON.parse(text) : null, count: range ? Number(range.split('/')[1]) : null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply(req, 405, { error: 'method_not_allowed' });

  // ── first entry by a personal link (no session yet) ──
  if (new URL(req.url).searchParams.get('claim') === '1') {
    let b: Record<string, unknown>;
    try {
      b = await req.json();
    } catch {
      return reply(req, 400, { error: 'invalid_body' });
    }
    const token = String(b.token ?? '');
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!/^[A-Za-z0-9]{32}$/.test(token)) return reply(req, 404, { error: 'invite_invalid' });
    if (!emailRe.test(email) || email.length > 254) return reply(req, 400, { error: 'invalid_email' });
    const hash = await sha256hex(token);
    const inv = (await rest('GET', `staff_invites?token_hash=eq.${hash}&select=*`)).data?.[0];
    if (!inv || inv.used_at || new Date(inv.expires_at).getTime() < Date.now()) return reply(req, 404, { error: 'invite_invalid' });
    const member = (await rest('GET', `staff?user_id=eq.${inv.user_id}&select=*`)).data?.[0];
    if (!member || !member.is_active) return reply(req, 404, { error: 'invite_invalid' });
    if (email !== member.email) {
      const res = await authAdmin('PUT', `/${inv.user_id}`, { email, email_confirm: true });
      if (!res.ok) {
        const exists = res.status === 422 || /already|registered|exists/i.test(JSON.stringify(res.data ?? ''));
        return reply(req, exists ? 409 : 400, { error: exists ? 'email_exists' : 'update_failed' });
      }
      await rest('PATCH', `staff?user_id=eq.${inv.user_id}`, { email, must_change_password: false }, 'return=minimal');
    }
    await rest('PATCH', `staff_invites?token_hash=eq.${hash}`, { used_at: new Date().toISOString() }, 'return=minimal');
    // a sign-in token for this one time, handed back instead of emailed
    const link = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: svcHeaders(), body: JSON.stringify({ type: 'magiclink', email }),
    });
    const ld = await link.json().catch(() => null);
    const hashed = ld?.hashed_token ?? ld?.properties?.hashed_token;
    if (!link.ok || !hashed) return reply(req, 400, { error: 'update_failed' });
    await rest('POST', 'audit_log', { actor_id: inv.user_id, actor_role: member.role, action: 'staff_first_entry', entity: 'staff', entity_id: inv.user_id, details: {} }, 'return=minimal');
    return reply(req, 200, { token_hash: hashed, email });
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(req, 401, { error: 'unauthenticated' });
  const caller = await authGetUser(jwt);
  if (!caller?.id) return reply(req, 401, { error: 'unauthenticated' });

  const meRes = await rest('GET', `staff?user_id=eq.${encodeURIComponent(caller.id)}&select=*`);
  const me = meRes.ok ? meRes.data?.[0] : null;
  if (!me || !me.is_active) return reply(req, 403, { error: 'forbidden' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(req, 400, { error: 'invalid_body' });
  }
  const action = body.action;

  const audit = (act: string, entityId: string | null, details: Record<string, unknown> = {}) =>
    rest('POST', 'audit_log', { actor_id: caller.id, actor_role: me.role, action: act, entity: 'staff', entity_id: entityId, details }, 'return=minimal');
  const setStaff = (userId: string, patch: Record<string, unknown>) =>
    rest('PATCH', `staff?user_id=eq.${encodeURIComponent(userId)}`, patch, 'return=minimal');

  // ── any staff member: change own password ──
  if (action === 'change_password') {
    if (!validPassword(body.new_password, caller.email ?? undefined)) return reply(req, 400, { error: 'weak_password' });
    const res = await authAdmin('PUT', `/${caller.id}`, { password: body.new_password });
    if (!res.ok) return reply(req, 400, { error: 'weak_password' });
    await setStaff(caller.id, { must_change_password: false });
    await audit('password_changed', caller.id);
    return reply(req, 200, { ok: true });
  }

  // ── admin only from here ──
  if (me.role !== 'admin' || me.must_change_password) return reply(req, 403, { error: 'forbidden' });

  if (action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const rawPhone = String(body.phone ?? '').trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? '') as Role;
    if (email && (!emailRe.test(email) || email.length > 254)) return reply(req, 400, { error: 'invalid_email' });
    if (rawPhone && !phone) return reply(req, 400, { error: 'invalid_phone' });
    if (!email && !phone) return reply(req, 400, { error: 'login_required' });
    if (fullName.length < 2 || fullName.length > 80) return reply(req, 400, { error: 'invalid_name' });
    if (!ROLES.includes(role)) return reply(req, 400, { error: 'invalid_role' });
    // sign-in by a one-time code (email or SMS), no password at all, unless a password was asked for
    if (body.login === 'password' && !email) return reply(req, 400, { error: 'invalid_email' });
    const password = body.login === 'password' ? tempPassword() : null;
    const created = await authAdmin('POST', '', {
      ...(email ? { email, email_confirm: true } : {}),
      ...(phone ? { phone: phone.slice(1), phone_confirm: true } : {}),
      ...(password ? { password } : {}),
    });
    if (!created.ok || !created.data?.id) {
      const text = JSON.stringify(created.data ?? '');
      const exists = created.status === 422 || /already|registered|exists/i.test(text);
      return reply(req, exists ? 409 : 400, { error: exists ? (/phone/i.test(text) ? 'phone_exists' : 'email_exists') : 'create_failed' });
    }
    const newId = created.data.id as string;
    const ins = await rest('POST', 'staff', {
      user_id: newId, full_name: fullName, email: email || null, phone, role, is_active: true,
      must_change_password: !!password, created_by: caller.id,
    }, 'return=minimal');
    if (!ins.ok) {
      await authAdmin('DELETE', `/${newId}`);
      return reply(req, 400, { error: 'create_failed' });
    }
    const login = password ? 'password' : 'code';
    await audit('staff_create', newId, { role, login });
    return reply(req, 200, { user_id: newId, temp_password: password, login });
  }

  const targetId = String(body.user_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return reply(req, 404, { error: 'not_found' });
  const targetRes = await rest('GET', `staff?user_id=eq.${targetId}&select=*`);
  const target = targetRes.ok ? targetRes.data?.[0] : null;
  if (!target) return reply(req, 404, { error: 'not_found' });

  if (action === 'invite') {
    if (!target.is_active) return reply(req, 400, { error: 'update_failed' });
    const token = inviteToken();
    await rest('DELETE', `staff_invites?user_id=eq.${targetId}&used_at=is.null`, undefined, 'return=minimal');
    const ins = await rest('POST', 'staff_invites', { token_hash: await sha256hex(token), user_id: targetId, created_by: caller.id }, 'return=minimal');
    if (!ins.ok) return reply(req, 400, { error: 'update_failed' });
    await audit('staff_invite', targetId);
    return reply(req, 200, { token });
  }

  if (action === 'reset_password') {
    if (!target.email) return reply(req, 400, { error: 'no_email' }); // SMS-only accounts have no password to reset
    const password = tempPassword();
    const res = await authAdmin('PUT', `/${targetId}`, { password });
    if (!res.ok) return reply(req, 400, { error: 'reset_failed' });
    await setStaff(targetId, { must_change_password: true });
    await audit('staff_reset_password', targetId);
    return reply(req, 200, { temp_password: password });
  }

  if (action === 'update') {
    const patch: Record<string, unknown> = {};
    if (body.full_name !== undefined) {
      const n = String(body.full_name).trim();
      if (n.length < 2 || n.length > 80) return reply(req, 400, { error: 'invalid_name' });
      patch.full_name = n;
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role as Role)) return reply(req, 400, { error: 'invalid_role' });
      patch.role = body.role;
    }
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.phone !== undefined) {
      const raw = String(body.phone ?? '').trim();
      const phone = raw ? normalizePhone(raw) : null;
      if (raw && !phone) return reply(req, 400, { error: 'invalid_phone' });
      if (!phone && !target.email) return reply(req, 400, { error: 'login_required' });
      if (phone !== target.phone) {
        // the auth user's phone is what the SMS code goes to
        const res = await authAdmin('PUT', `/${targetId}`, phone ? { phone: phone.slice(1), phone_confirm: true } : { phone: '' });
        if (!res.ok) {
          const exists = res.status === 422 || /already|registered|exists/i.test(JSON.stringify(res.data ?? ''));
          return reply(req, exists ? 409 : 400, { error: exists ? 'phone_exists' : 'update_failed' });
        }
        patch.phone = phone;
        if (phone) patch.must_change_password = false;
      }
    }
    if (body.email !== undefined) {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (email && (!emailRe.test(email) || email.length > 254)) return reply(req, 400, { error: 'invalid_email' });
      const phoneAfter = 'phone' in patch ? patch.phone : target.phone;
      if (!email && !phoneAfter) return reply(req, 400, { error: 'login_required' });
      if ((email || null) !== target.email) {
        // the auth user's email is where the sign-in code goes
        const res = await authAdmin('PUT', `/${targetId}`, email ? { email, email_confirm: true } : { email: '' });
        if (!res.ok) {
          const exists = res.status === 422 || /already|registered|exists/i.test(JSON.stringify(res.data ?? ''));
          return reply(req, exists ? 409 : 400, { error: exists ? 'email_exists' : 'update_failed' });
        }
        patch.email = email || null;
        if (email) patch.must_change_password = false;
      }
    }

    const changesAccess = ('role' in patch && patch.role !== target.role) || ('is_active' in patch && patch.is_active !== target.is_active);
    if (targetId === caller.id && changesAccess) return reply(req, 400, { error: 'cannot_change_self' });
    const losesAdmin = target.role === 'admin' && target.is_active &&
      (('role' in patch && patch.role !== 'admin') || patch.is_active === false);
    if (losesAdmin) {
      const others = await rest('GET', `staff?role=eq.admin&is_active=eq.true&user_id=neq.${targetId}&select=user_id`);
      if (!others.ok || !others.data?.length) return reply(req, 400, { error: 'last_admin' });
    }
    const upd = await setStaff(targetId, patch);
    if (!upd.ok) return reply(req, 400, { error: 'update_failed' });
    if ('is_active' in patch && patch.is_active !== target.is_active) {
      await authAdmin('PUT', `/${targetId}`, { ban_duration: patch.is_active ? 'none' : '876000h' });
    }
    await audit('staff_update', targetId, { role: patch.role ?? target.role, is_active: patch.is_active ?? target.is_active, phone_changed: 'phone' in patch, email_changed: 'email' in patch });
    return reply(req, 200, { ok: true });
  }

  return reply(req, 400, { error: 'unknown_action' });
});
