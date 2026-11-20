import { describe, expect, it } from 'vitest';
import { matchesSearch, phoneMatches, phoneTail } from './search';

describe('people search', () => {
  const dana = { name: 'דנה כהן', phone: '+972540123456', also: ['מודיעין'] };
  it('finds a phone in any format, or by its last digits', () => {
    for (const q of ['054-0123456', '0540123456', '+972 54 012 3456', '00972540123456', '3456', '23456', '054 012 3456']) {
      expect(matchesSearch(q, dana), q).toBe(true);
    }
    expect(matchesSearch('054-0123457', dana)).toBe(false);
    expect(phoneTail('דנה')).toBeNull();
    expect(phoneTail('12')).toBeNull();
    expect(phoneMatches('3456', null)).toBe(false);
  });
  it('finds a name by every word, in any order, ignoring final letters and quote marks', () => {
    expect(matchesSearch('כהן דנה', dana)).toBe(true);
    expect(matchesSearch('כה', dana)).toBe(true);
    expect(matchesSearch('מודיעין', dana)).toBe(true);
    expect(matchesSearch('דנה לוי', dana)).toBe(false);
    expect(matchesSearch('', dana)).toBe(true);
    expect(matchesSearch('ג׳ורג׳', { name: 'גורג סעיד' })).toBe(true);
    expect(matchesSearch('גורג', { name: 'גורג׳ סעיד' })).toBe(true);
  });
});
