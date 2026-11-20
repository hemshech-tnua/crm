import { describe, expect, it } from 'vitest';
import { matchScore } from './doorMatch';

const p = (display_name: string, phone_last4: string, phone: string | null = null) => ({ display_name, phone_last4, phone });

describe('door search', () => {
  const sasha = p('אלכסנדר (סשה) וולקוב', '8765', '+972541098765');
  const noam = p('נועם מזרחי', '3210');
  const dana = p('דנה כהן', '4567');

  it('finds a name by any word, in any order, and by a nickname in brackets', () => {
    expect(matchScore(dana, 'דנה')).toBeGreaterThan(0);
    expect(matchScore(dana, 'כהן דנה')).toBeGreaterThan(0);
    expect(matchScore(sasha, 'סשה וולקוב')).toBeGreaterThan(0);
    expect(matchScore(dana, 'דנה לוי')).toBe(0);
  });

  it('forgives a missing or extra ו / י', () => {
    expect(matchScore(noam, 'נעם')).toBeGreaterThan(0);
    expect(matchScore(noam, 'נעם מזרחי')).toBeGreaterThan(0);
  });

  it('ranks a name that starts with the typed text first', () => {
    expect(matchScore(dana, 'דנ')).toBeGreaterThan(matchScore(p('עדנה לוי', '1111'), 'דנ'));
  });

  it('accepts the last digits or a full phone in any format', () => {
    expect(matchScore(dana, '4567')).toBeGreaterThan(0);
    expect(matchScore(dana, '56')).toBeGreaterThan(0);
    expect(matchScore(dana, '054-7774567')).toBeGreaterThan(0); // the door sees only the last four
    expect(matchScore(dana, '054-7774568')).toBe(0);
    expect(matchScore(sasha, '054-1098765')).toBeGreaterThan(0);
    expect(matchScore(sasha, '+972 54 109 8765')).toBeGreaterThan(0);
    expect(matchScore(sasha, '052-1098765')).toBe(0); // a manager sees the full number: it must match in full
  });
});
