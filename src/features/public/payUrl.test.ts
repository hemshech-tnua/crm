import { describe, expect, it } from 'vitest';
import { payUrl } from './payUrl';

const YESH = 'https://yeshlee.co.il/payment/1609c794-b2b5-4955-af2c-3c266a2f175f';

describe('payUrl: the payment link opens with the registrant’s details', () => {
  it('adds name and a local mobile number for "יש חשבונית"', () => {
    const u = new URL(payUrl(YESH, { name: 'דנה כהן', phone: '+972501234567' }));
    expect(u.origin + u.pathname).toBe(YESH);
    expect(u.searchParams.get('name')).toBe('דנה כהן');
    expect(u.searchParams.get('mobile')).toBe('0501234567');
  });
  it('leaves out a phone that is not an Israeli mobile, and keeps the name', () => {
    const u = new URL(payUrl(YESH, { name: 'דנה', phone: '+97236123456' }));
    expect(u.searchParams.get('mobile')).toBeNull();
    expect(u.searchParams.get('name')).toBe('דנה');
  });
  it('returns the plain link for other providers or without a payer', () => {
    expect(payUrl('https://pay.example.com/x', { name: 'דנה', phone: '+972501234567' })).toBe('https://pay.example.com/x');
    expect(payUrl(YESH, null)).toBe(YESH);
    expect(payUrl('not a url', { name: 'א', phone: '+972501234567' })).toBe('not a url');
  });
  it('does not accept a look-alike host', () => {
    expect(payUrl('https://yeshlee.co.il.evil.example/p', { name: 'א', phone: '+972501234567' })).toBe('https://yeshlee.co.il.evil.example/p');
  });
});
