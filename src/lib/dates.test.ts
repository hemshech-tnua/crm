import { describe, expect, it } from 'vitest';
import { fmtListDate, fmtTitleDate, fmtWeekdayShort, isThisYear } from './dates';
import { freePlaces, meetingCountLine } from './labels';

const now = new Date('2026-11-18T10:00:00Z');

describe('list and title dates (Israel time)', () => {
  it('lists: weekday letter, day.month, time; the year only outside the current year', () => {
    expect(fmtWeekdayShort('2026-11-20T09:55:00Z')).toBe('ו׳');
    expect(fmtListDate('2026-11-20T09:55:00Z', { now })).toBe('ו׳ 20.11 · 11:55');
    expect(fmtListDate('2026-11-20T09:55:00Z', { now, time: false })).toBe('ו׳ 20.11');
    expect(fmtListDate('2026-11-20T09:55:00Z', { now, weekday: false })).toBe('20.11 · 11:55');
    expect(fmtListDate('2025-03-07T08:00:00Z', { now })).toBe('ו׳ 7.03.25 · 10:00');
  });
  it('uses Israel time across midnight', () => {
    // 22:30 UTC on Thursday is already Friday 00:30 in Israel (winter, UTC+2)
    expect(fmtListDate('2026-11-19T22:30:00Z', { now })).toBe('ו׳ 20.11 · 00:30');
  });
  it('titles: full weekday and month name, the year only outside the current year', () => {
    expect(fmtTitleDate('2026-11-20T09:55:00Z', now)).toBe('יום שישי, 20 בנובמבר');
    expect(fmtTitleDate('2025-11-21T09:55:00Z', now)).toBe('יום שישי, 21 בנובמבר 2025');
    expect(isThisYear('2026-01-01T12:00:00Z', now)).toBe(true);
  });
});

describe('one count definition per meeting', () => {
  it('registered · walk-ins · total of capacity', () => {
    expect(meetingCountLine(24, 2, 28)).toBe('24 רשומים · 2 בלי הרשמה · 26 מתוך 28');
    expect(meetingCountLine(24, 0, null)).toBe('24 רשומים');
    expect(freePlaces(24, 2, 28)).toBe(2);
    expect(freePlaces(30, 2, 28)).toBe(0);
    expect(freePlaces(3, 0, null)).toBeNull();
  });
});

describe('Hebrew counts with the dual', () => {
  it('one, two (dual), many', async () => {
    const { countUnit } = await import('./dates');
    expect(countUnit(1, 'day')).toBe('יום אחד');
    expect(countUnit(2, 'day')).toBe('יומיים');
    expect(countUnit(2, 'week')).toBe('שבועיים');
    expect(countUnit(2, 'month')).toBe('חודשיים');
    expect(countUnit(2, 'year')).toBe('שנתיים');
    expect(countUnit(1, 'year')).toBe('שנה אחת');
    expect(countUnit(5, 'day')).toBe('5 ימים');
  });
  it('titles: one separator, site name last, empty parts dropped', async () => {
    const { formatTitle } = await import('./title');
    expect(formatTitle(['שישי בבוקר', null, 'מפגשים'])).toBe('שישי בבוקר · מפגשים · המשך תנועה');
    expect(formatTitle('מפגשי שישי')).toBe('מפגשי שישי · המשך תנועה');
  });
});
