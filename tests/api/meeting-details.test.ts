// "כל הפרטים על המפגש": the public payload gains the people of a meeting (approved only, never their private fields)
// and the lecture description; photos live in the public Storage bucket `people`, writable only by admin/coordinator.
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { API_URL } from './env';
import { makeEvent, staff, visitor } from './helpers';

type Person = { role: string; name: string; label: string | null; line: string | null; about: string | null; photo_path: string | null };

// a tiny valid PNG (1×1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const png = () => new Blob([PNG], { type: 'image/png' });

async function presenter(kind: 'speaker' | 'instructor', status: 'approved' | 'proposed', extra: Record<string, unknown> = {}) {
  const admin = await staff('admin');
  const tag = randomUUID().slice(0, 6);
  const { data, error } = await admin.from('speakers').insert({
    kind,
    full_name: `${kind === 'speaker' ? 'מרצה' : 'מדריך'} בדיקה ${tag.replace(/\d/g, 'א')}`,
    topic: kind === 'speaker' ? 'נושא בדיקה' : 'קרוספיט',
    status,
    bio_line: `שורה לכרטיס ${tag}`,
    role_label: kind === 'speaker' ? 'מרצה אורחת' : 'מאמן קרוספיט',
    about: `כמה מילים ${tag}`,
    photo_path: `${tag}-test.webp`,
    phone: '+972521234567',
    notes: `הערה פנימית ${tag}`,
    social_url: `https://example.test/${tag}`,
    proposal_message: `הודעת הצעה ${tag}`,
    ...extra,
  }).select('*').single();
  if (error) throw error;
  return data as Record<string, string>;
}

describe('meeting details in the public payload', () => {
  it('lists the approved instructor, then the approved speaker, with their public fields only', async () => {
    const ins = await presenter('instructor', 'approved');
    const sp = await presenter('speaker', 'approved');
    const ev = await makeEvent({ instructor_id: ins.id, speaker_id: sp.id, activity_name: 'קרוספיט', lecture_description: 'על מה ההרצאה' });
    const { data, error } = await visitor().rpc('public_get_event', { p_code: ev.public_code, p_ref: null });
    expect(error).toBeNull();
    expect(data.lecture_description).toBe('על מה ההרצאה');
    const people = data.people as Person[];
    expect(people.map((p) => p.role)).toEqual(['instructor', 'speaker']);
    expect(people[0]).toEqual({ role: 'instructor', name: ins.full_name, label: 'מאמן קרוספיט', line: ins.bio_line, about: ins.about, photo_path: ins.photo_path });
    expect(people[1]).toEqual({ role: 'speaker', name: sp.full_name, label: 'מרצה אורחת', line: sp.bio_line, about: sp.about, photo_path: sp.photo_path });
    // the flat fields of before stay as they were
    expect(data.speaker_name).toBe(sp.full_name);
    expect(data.speaker_bio).toBe(sp.bio_line);
    expect(data.instructor_name).toBe(ins.full_name);

    // phone, notes, the social link and the proposal never leave the database
    const text = JSON.stringify(data);
    for (const p of [ins, sp]) {
      expect(text).not.toContain(p.phone);
      expect(text).not.toContain('521234567');
      expect(text).not.toContain(p.notes);
      expect(text).not.toContain(p.social_url);
      expect(text).not.toContain(p.proposal_message);
      expect(text).not.toContain(p.id);
    }
  });

  it('shows people only once they are approved', async () => {
    const sp = await presenter('speaker', 'proposed');
    const ins = await presenter('instructor', 'proposed');
    const ev = await makeEvent({ instructor_id: ins.id, speaker_id: sp.id });
    const before = (await visitor().rpc('public_get_event', { p_code: ev.public_code, p_ref: null })).data;
    expect(before.people).toEqual([]);
    expect(JSON.stringify(before)).not.toContain(sp.full_name);
    expect(JSON.stringify(before)).not.toContain(sp.about);
    expect(JSON.stringify(before)).not.toContain(sp.photo_path);

    const admin = await staff('admin');
    expect((await admin.from('speakers').update({ status: 'approved' }).eq('id', sp.id)).error).toBeNull();
    const after = (await visitor().rpc('public_get_event', { p_code: ev.public_code, p_ref: null })).data;
    expect((after.people as Person[]).map((p) => p.name)).toEqual([sp.full_name]);

    // archived again: gone again
    expect((await admin.from('speakers').update({ status: 'archived' }).eq('id', sp.id)).error).toBeNull();
    const archived = (await visitor().rpc('public_get_event', { p_code: ev.public_code, p_ref: null })).data;
    expect(archived.people).toEqual([]);
  });

  it('a meeting without people has an empty list and no description', async () => {
    const ev = await makeEvent();
    const { data } = await visitor().rpc('public_get_event', { p_code: ev.public_code, p_ref: null });
    expect(data.people).toEqual([]);
    expect(data.lecture_description).toBeNull();
  });

  it('rejects texts over their limits and photo paths outside the bucket naming', async () => {
    const coord = await staff('coord');
    const base = { full_name: 'בדיקת גבולות', topic: 'נושא', status: 'proposed' };
    expect((await coord.from('speakers').insert({ ...base, role_label: 'א'.repeat(31) })).error).not.toBeNull();
    expect((await coord.from('speakers').insert({ ...base, about: 'א'.repeat(601) })).error).not.toBeNull();
    for (const bad of ['../secret.webp', 'https://evil.test/a.webp', 'A-upper.webp', 'x/../../y.webp', '-start.webp']) {
      expect((await coord.from('speakers').insert({ ...base, photo_path: bad })).error, bad).not.toBeNull();
    }
    expect((await coord.from('events').insert({ site_id: '00000000-0000-4000-8000-000000000001', title: 'בדיקה', starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 2 * 864e5 - 1).toISOString(), lecture_description: 'א'.repeat(601) })).error).not.toBeNull();
  });
});

describe('the people bucket (Supabase Storage)', () => {
  const path = () => `test-${randomUUID()}.png`;

  it('is public to read and closed to anonymous writes', async () => {
    const coord = await staff('coord');
    const p = path();
    expect((await coord.storage.from('people').upload(p, png(), { contentType: 'image/png' })).error).toBeNull();
    const res = await fetch(`${API_URL}/storage/v1/object/public/people/${p}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');

    const v = visitor();
    expect((await v.storage.from('people').upload(path(), png(), { contentType: 'image/png' })).error).not.toBeNull();
    expect((await v.storage.from('people').upload(p, png(), { contentType: 'image/png', upsert: true })).error).not.toBeNull();
    await v.storage.from('people').remove([p]);
    // anonymous listing shows nothing, and the object is still there
    const { data: listed } = await v.storage.from('people').list();
    expect(listed ?? []).toEqual([]);
    expect((await fetch(`${API_URL}/storage/v1/object/public/people/${p}`)).status).toBe(200);
    await coord.storage.from('people').remove([p]);
  });

  it('refuses the door team (signed in, not managing speakers)', async () => {
    const door = await staff('door');
    expect((await door.storage.from('people').upload(path(), png(), { contentType: 'image/png' })).error).not.toBeNull();
    const coord = await staff('coord');
    const p = path();
    expect((await coord.storage.from('people').upload(p, png(), { contentType: 'image/png' })).error).toBeNull();
    await door.storage.from('people').remove([p]);
    expect((await fetch(`${API_URL}/storage/v1/object/public/people/${p}`)).status).toBe(200);
    await coord.storage.from('people').remove([p]);
  });

  it('lets coordinators and admins upload, replace and delete', async () => {
    for (const role of ['coord', 'admin'] as const) {
      const c = await staff(role);
      const p = path();
      expect((await c.storage.from('people').upload(p, png(), { contentType: 'image/png' })).error, role).toBeNull();
      expect((await c.storage.from('people').upload(p, png(), { contentType: 'image/png', upsert: true })).error, role).toBeNull();
      const { data: removed, error } = await c.storage.from('people').remove([p]);
      expect(error, role).toBeNull();
      expect(removed?.length, role).toBe(1);
      expect((await fetch(`${API_URL}/storage/v1/object/public/people/${p}`)).status, role).not.toBe(200);
    }
  });

  it('accepts only images up to 2 MB', async () => {
    const coord = await staff('coord');
    const text = new Blob(['<script>alert(1)</script>'], { type: 'text/html' });
    expect((await coord.storage.from('people').upload(`test-${randomUUID()}.html`, text, { contentType: 'text/html' })).error).not.toBeNull();
    const big = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/png' });
    expect((await coord.storage.from('people').upload(path(), big, { contentType: 'image/png' })).error).not.toBeNull();
  });
});
