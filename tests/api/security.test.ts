// Scenario 7 (security) at the API layer: what each role can and cannot do, enforced by the database.
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { makeEvent, registration, staff, visitor, SITE_ID } from './helpers';
import { DB_URL } from './env';

const TABLES = ['participants', 'registrations', 'events', 'staff', 'audit_log', 'settings', 'feedback', 'follow_ups',
  'contact_log', 'consents', 'speakers', 'message_templates', 'referral_links', 'acquisition_sources', 'sites'];

describe('anonymous visitor (no login)', () => {
  it('cannot read any table', async () => {
    const v = visitor();
    for (const t of TABLES) {
      const { data, error } = await v.from(t).select('*').limit(1);
      // either a permission error or (never) data
      expect(error, `table ${t} should be denied`).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it('cannot read the stats views', async () => {
    const v = visitor();
    for (const t of ['participant_stats', 'event_stats']) {
      const { error } = await v.from(t).select('*').limit(1);
      expect(error, t).not.toBeNull();
    }
  });

  it('cannot write to tables', async () => {
    const v = visitor();
    const { error } = await v.from('participants').insert({ full_name: 'פורץ', phone: '+972501234567' });
    expect(error).not.toBeNull();
    const { error: e2 } = await v.from('events').update({ status: 'cancelled' }).neq('id', '00000000-0000-0000-0000-000000000000');
    expect(e2).not.toBeNull();
  });

  it('cannot call staff, admin or report functions', async () => {
    const v = visitor();
    const calls: [string, Record<string, unknown>][] = [
      ['staff_checkin_list', { p_event_id: SITE_ID }],
      ['staff_complete_event', { p_event_id: SITE_ID }],
      ['report_kpis', {}],
      ['attention_items', {}],
      ['admin_anonymize_participant', { p_id: SITE_ID }],
      ['staff_find_duplicates', {}],
      ['log_export', { p_kind: 'participants', p_rows: 1 }],
    ];
    for (const [fn, args] of calls) {
      const { error } = await v.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
  });

  it('public event info does not leak codes, capacity internals or unapproved speakers', async () => {
    const coord = await staff('coord');
    const { data: sp } = await coord.from('speakers').insert({ full_name: 'מרצה לא מאושר', topic: 'נושא סודי', status: 'proposed' }).select('id').single();
    const ev = await makeEvent({ speaker_id: sp!.id, internal_notes: 'הערה פנימית' });
    const { data, error } = await visitor().rpc('public_get_event', { p_code: ev.public_code });
    expect(error).toBeNull();
    const text = JSON.stringify(data);
    expect(text).not.toContain(ev.checkin_code);
    expect(text).not.toContain('הערה פנימית');
    expect(text).not.toContain('מרצה לא מאושר');
    expect(text).not.toContain('נושא סודי');
    expect(text).not.toContain(ev.id);
  });

  it('draft events are invisible to the public', async () => {
    const ev = await makeEvent({ status: 'draft' });
    const { data, error } = await visitor().rpc('public_get_event', { p_code: ev.public_code });
    // the visitor learns only that registration has not opened yet: no title, date or any other detail
    expect(error?.message).toBe('registration_not_open');
    expect(data).toBeNull();
    const { error: e2 } = await visitor().rpc('public_register', { p: registration(ev.public_code) });
    expect(e2?.message).toBe('event_not_found');
  });
});

describe('door team (volunteer)', () => {
  it('cannot read participants, registrations, feedback or reports directly', async () => {
    const door = await staff('door');
    for (const t of ['participants', 'registrations', 'feedback', 'follow_ups', 'contact_log', 'audit_log', 'speakers', 'participant_stats']) {
      const { data, error } = await door.from(t).select('*').limit(5);
      // RLS returns no rows (or an error for views without grants)
      expect(error ? [] : data, t).toEqual([]);
    }
    const { error } = await door.rpc('report_kpis', {});
    expect(error?.message).toBe('forbidden');
  });

  it('sees the attendance list of today\'s event with last 4 digits only', async () => {
    const ev = await makeEvent({ startsInMinutes: 30 });
    const reg = registration(ev.public_code);
    await visitor().rpc('public_register', { p: reg });
    const door = await staff('door');
    const { data, error } = await door.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = data[0];
    expect(row.display_name).toBe(reg.full_name);
    expect(row.phone).toBeNull();
    expect(row.participant_id).toBeNull();
    expect(row.phone_last4).toBe(reg.phone.slice(-4));
  });

  it('cannot open an event that is not today', async () => {
    const ev = await makeEvent({ startsInMinutes: 5 * 24 * 60 });
    const door = await staff('door');
    const { error } = await door.rpc('staff_checkin_list', { p_event_id: ev.id });
    expect(error?.message).toBe('forbidden');
  });

  it('cannot create, edit or close events', async () => {
    const door = await staff('door');
    const { error } = await door.from('events').insert({ site_id: SITE_ID, title: 'ניסיון', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString() });
    expect(error).not.toBeNull();
    const ev = await makeEvent({ startsInMinutes: -10 });
    const { error: e2 } = await door.rpc('staff_complete_event', { p_event_id: ev.id });
    expect(e2?.message).toBe('forbidden');
    const { data } = await door.from('events').update({ title: 'שונה' }).eq('id', ev.id).select();
    expect(data ?? []).toEqual([]);
  });
});

describe('coordinator', () => {
  it('cannot read the audit log, change settings, approve speakers or anonymize', async () => {
    const coord = await staff('coord');
    const { data: audit } = await coord.from('audit_log').select('*').limit(1);
    expect(audit).toEqual([]);
    const { data: s } = await coord.from('settings').update({ goal_avg_attendance: 99 }).eq('id', true).select();
    expect(s ?? []).toEqual([]);
    const { data: sp } = await coord.from('speakers').insert({ full_name: 'מרצה בדיקה', topic: 'חוסן', status: 'proposed' }).select('id').single();
    const { error } = await coord.from('speakers').update({ status: 'approved' }).eq('id', sp!.id);
    expect(error?.message).toBe('only_admin_approves');
    const { error: e2 } = await coord.rpc('admin_anonymize_participant', { p_id: sp!.id });
    expect(e2?.message).toBe('forbidden');
    const { error: e3 } = await coord.rpc('log_export', { p_kind: 'participants', p_rows: 3 });
    expect(e3?.message).toBe('forbidden');
  });

  it('cannot delete participants or registrations directly', async () => {
    const coord = await staff('coord');
    const { data } = await coord.from('participants').delete().neq('id', '00000000-0000-0000-0000-000000000000').select();
    expect(data ?? []).toEqual([]);
    const { error } = await coord.from('registrations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    expect(error).not.toBeNull();
  });

  it('cannot forge event codes', async () => {
    const coord = await staff('coord');
    const { data, error } = await coord.from('events').insert({
      site_id: SITE_ID, title: 'קוד מזויף', starts_at: new Date(Date.now() + 864e5).toISOString(),
      ends_at: new Date(Date.now() + 864e5 + 3600e3).toISOString(), public_code: 'aaaaaaaa', checkin_code: 'bbbbbbbbbbbbbb',
    }).select('public_code, checkin_code').single();
    expect(error).toBeNull();
    expect(data!.public_code).not.toBe('aaaaaaaa');
    expect(data!.checkin_code).not.toBe('bbbbbbbbbbbbbb');
  });
});

describe('admin', () => {
  it('approves a speaker and reads the audit log without personal values', async () => {
    const admin = await staff('admin');
    const { data: sp } = await admin.from('speakers').insert({ full_name: 'מרצה לאישור', topic: 'נושא', status: 'proposed', phone: '+972521111111' }).select('id').single();
    const { error } = await admin.from('speakers').update({ status: 'approved' }).eq('id', sp!.id);
    expect(error).toBeNull();
    const { data: row } = await admin.from('speakers').select('approved_by, approved_at').eq('id', sp!.id).single();
    expect(row!.approved_by).toBe('10000000-0000-4000-8000-000000000001');

    const ev = await makeEvent();
    const reg = registration(ev.public_code);
    await visitor().rpc('public_register', { p: reg });
    const { data: log } = await admin.from('audit_log').select('*').order('id', { ascending: false }).limit(200);
    expect(log!.length).toBeGreaterThan(0);
    const text = JSON.stringify(log);
    expect(text).not.toContain(reg.full_name);
    expect(text).not.toContain(reg.phone.slice(1));
    expect(text).not.toContain('מרצה לאישור');
  });

  it('cannot delete an event that has registrations', async () => {
    const admin = await staff('admin');
    const ev = await makeEvent();
    await visitor().rpc('public_register', { p: registration(ev.public_code) });
    const { error } = await admin.from('events').delete().eq('id', ev.id);
    expect(error).not.toBeNull();
  });
});

describe('input validation and injection', () => {
  it('rejects invalid registration fields on the server', async () => {
    const ev = await makeEvent();
    const v = visitor();
    const cases: [Record<string, unknown>, string][] = [
      [{ phone: '123' }, 'invalid_phone'],
      [{ phone: '0501234' }, 'invalid_phone'],
      [{ full_name: 'a' }, 'invalid_name'],
      [{ full_name: 'בוט https://spam.example' }, 'invalid_name'],
      [{ full_name: '<script>alert(1)</script>' }, 'invalid_name'],
      [{ age: '12' }, 'invalid_age'],
      [{ age: 'abc' }, 'invalid_age'],
      [{ age: '' }, 'invalid_age'],
      [{ city: '' }, 'invalid_city'],
      [{ source: 'nonexistent' }, 'invalid_source'],
      [{ source: '' }, 'invalid_source'],
    ];
    for (const [patch, code] of cases) {
      const { error } = await v.rpc('public_register', { p: registration(ev.public_code, patch) });
      expect(error?.message, JSON.stringify(patch)).toBe(code);
    }
  });

  it('treats SQL-like input as plain text', async () => {
    const ev = await makeEvent();
    const evil = "'; drop table participants; --";
    const { error } = await visitor().rpc('public_register', { p: registration(ev.public_code, { city: 'תל אביב', source_detail: evil, source: 'other' }) });
    expect(error).toBeNull();
    const coord = await staff('coord');
    const { count } = await coord.from('participants').select('id', { count: 'exact', head: true });
    expect(count).toBeGreaterThan(0);
    const { error: e2 } = await visitor().rpc('public_get_event', { p_code: "x' or '1'='1" });
    expect(e2?.message).toBe('event_not_found');
  });

  it('honeypot submissions are answered but not stored', async () => {
    const ev = await makeEvent();
    const reg = registration(ev.public_code, { website: 'http://bot.example' });
    const { data, error } = await visitor().rpc('public_register', { p: reg });
    expect(error).toBeNull();
    expect(data.status).toBe('registered');
    const coord = await staff('coord');
    const { data: found } = await coord.from('participants').select('id').eq('phone', '+972' + reg.phone.slice(1));
    expect(found).toEqual([]);
  });

  it('rate-limits repeated registrations from one address', async () => {
    const ev = await makeEvent();
    const v = visitor('192.0.2.77');
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const { error } = await v.rpc('public_register', { p: registration(ev.public_code) });
      if (error?.message === 'rate_limited') { limited = true; break; }
      expect(error).toBeNull();
    }
    expect(limited).toBe(true);
  });

  it('rejects forged or random manage tokens', async () => {
    const v = visitor();
    for (const t of ['', 'abc', 'x'.repeat(32), "' or 1=1 --aaaaaaaaaaaaaaaaaaaaaaaa"]) {
      const { error } = await v.rpc('public_registration', { p_token: t });
      expect(error?.message).toBe('token_invalid');
      const { error: e2 } = await v.rpc('public_cancel', { p_token: t });
      expect(e2?.message).toBe('token_invalid');
    }
  });
});

describe('privilege surface (defense in depth)', () => {
  const sql = (q: string) => execSync(`psql "${DB_URL}" -Atc "${q}"`).toString().trim();
  it('anonymous visitors can execute exactly the public endpoints and read no table or view', () => {
    const fns = sql("select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and has_function_privilege('anon', p.oid, 'execute')");
    expect(fns.split(',')).toEqual([
      'public_cancel', 'public_checkin', 'public_checkin_info', 'public_checkin_undo', 'public_feedback_context', 'public_get_event',
      'public_list_events', 'public_org_info', 'public_propose', 'public_register', 'public_registration', 'public_sources',
      'public_submit_feedback', 'public_walkin',
    ]);
    expect(sql("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v') and has_table_privilege('anon', c.oid, 'select')")).toBe('0');
  });
  it('every table in public has row level security, and every security definer function pins its search_path', () => {
    expect(sql("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")).toBe('0');
    expect(sql("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')")).toBe('0');
  });
});
