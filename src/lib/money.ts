// Money in shekels: one format everywhere (₪ with up to two decimals, "—" when there is no value).
const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const fmtMoney = (v: number | string | null | undefined): string => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : ils.format(Number(v)));

/** "20", "20.5", "₪ 1,200" → a number; empty → null; anything else → NaN (the caller shows an error). */
export const parseAmount = (v: string): number | null => (v.trim() ? Number(v.replace(/[,₪\s]/g, '')) : null);

/** A fee is charged: price above zero. */
export const isPriced = (price: number | null | undefined): price is number => price != null && Number(price) > 0;

/** The provider's payment page: an https link (the database enforces the same). */
export const isPaymentUrl = (v: string) => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d{1,5})?([/?#][^\s<>"']*)?$/i.test(v.trim()) && v.trim().length <= 500;
