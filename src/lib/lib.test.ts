import { describe, expect, it } from 'vitest';
import { normalizePhone, formatPhone, whatsappLink } from './phone';
import { renderTemplate, unknownPlaceholders } from './templates';
import { toCsv } from './csv';
import { derived, pct, progress, type Kpis } from './metrics';
import { fromIl, ilParts, nextFriday, addDays } from './dates';

describe('phone (mirrors private.normalize_phone)', () => {
  it.each([
    ['050-1234567', '+972501234567'],
    ['0501234567', '+972501234567'],
    ['+972 50 123 4567', '+972501234567'],
    ['972501234567', '+972501234567'],
    ['00972501234567', '+972501234567'],
    ['+9720501234567', '+972501234567'],
    ['08-9123456', '+97289123456'],
    ['077-1234567', '+972771234567'],
    ['+1 415 555 0100', '+14155550100'],
  ])('%s → %s', (raw, out) => expect(normalizePhone(raw)).toBe(out));

  it.each(['', '123', '0501234', '05012345678', 'abc', '+972 1234'])('rejects %s', (raw) => expect(normalizePhone(raw)).toBeNull());

  it('formats and links', () => {
    expect(formatPhone('+972501234567')).toBe('050-123-4567');
    expect(whatsappLink('+972501234567', 'שלום')).toBe('https://wa.me/972501234567?text=%D7%A9%D7%9C%D7%95%D7%9D');
  });
});

describe('message templates', () => {
  it('fills placeholders and drops lines with missing values', () => {
    const body = 'היי {שם_פרטי},\nהרצאה של {מרצה} על {נושא}\nנפגשים ב{מקום}';
    expect(renderTemplate(body, { firstName: 'דני', location: 'מודיעין' })).toBe('היי דני,\nנפגשים במודיעין');
    expect(renderTemplate(body, { firstName: 'דני', location: 'מודיעין', speaker: 'רוני', topic: 'חוסן' }))
      .toBe('היי דני,\nהרצאה של רוני על חוסן\nנפגשים במודיעין');
  });
  it('finds unknown placeholders', () => {
    expect(unknownPlaceholders('היי {שם_פרטי} {שם}')).toEqual(['שם']);
  });
});

describe('csv export', () => {
  it('has a BOM, quotes, and neutralizes formulas', () => {
    const csv = toCsv([{ a: 'שלום, עולם', b: '=HYPERLINK("x")', c: -5 }], [
      { header: 'א', value: (r) => r.a }, { header: 'ב', value: (r) => r.b }, { header: 'ג', value: (r) => r.c },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"שלום, עולם"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.endsWith(',-5')).toBe(true);
  });
});

describe('metrics', () => {
  const base: Kpis = {
    events: 2, attendances: 4, unique_attendees: 3, preregistered: 6, preregistered_attended: 4, walk_ins: 0, cancelled: 0,
    new_attendees: 3, returning_attendees: 1, friend_new: 2, feedback_count: 2, avg_rating: 4.5, self_checkins: 1,
    goals: { avg_attendance: 20, show_rate: 0.8, return_rate: 0.2, friend_share: 0.25, avg_rating: 4 },
  };
  it('derives ratios from the server counts', () => {
    const d = derived(base);
    expect(d.avgAttendance).toBe(2);
    expect(d.showRate).toBeCloseTo(4 / 6);
    expect(d.returnRate).toBeCloseTo(1 / 3);
    expect(d.friendShare).toBeCloseTo(2 / 3);
  });
  it('shows — when there is no data, never 0%', () => {
    const d = derived({ ...base, events: 0, attendances: 0, preregistered: 0, unique_attendees: 0, new_attendees: 0, avg_rating: null });
    expect(d.avgAttendance).toBeNull();
    expect(pct(d.showRate)).toBe('—');
    expect(progress(null, 0.8)).toBeNull();
  });
});

describe('dates in Israel time', () => {
  it('converts Israel local time to an instant across DST', () => {
    expect(fromIl('2026-11-13', '09:00')).toBe('2026-11-13T07:00:00.000Z'); // winter, UTC+2
    expect(fromIl('2026-07-10', '09:00')).toBe('2026-07-10T06:00:00.000Z'); // summer, UTC+3
    expect(ilParts('2026-11-13T07:00:00.000Z')).toEqual({ date: '2026-11-13', time: '09:00' });
  });
  it('finds the next Friday', () => {
    expect(nextFriday('2026-11-06')).toBe('2026-11-06'); // a Friday
    expect(nextFriday('2026-11-07')).toBe('2026-11-13');
    expect(addDays('2026-11-13', 7)).toBe('2026-11-20');
  });
});
