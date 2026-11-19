// The payment link, opened with the registrant's details when the provider supports it.

/** The person who just registered, so the payment page can open with their details already in it. */
export type Payer = { name: string; phone: string };

/**
 * The payment link with the payer's name and mobile filled in, when the provider supports it. "יש חשבונית" (yeshlee.co.il)
 * reads `name` and `mobile` from the link and shows those fields filled in and locked, so the person types only what we
 * do not have (the email) and the card. They would type the same details there anyway; nothing else is sent. Any other
 * provider gets the plain link.
 */
export function payUrl(url: string, payer?: Payer | null): string {
  if (!payer) return url;
  try {
    const u = new URL(url);
    if (!/(^|\.)yeshlee\.co\.il$/.test(u.hostname)) return url;
    if (payer.name.trim()) u.searchParams.set('name', payer.name.trim());
    const local = payer.phone.replace(/^\+972/, '0').replace(/\D/g, '');
    if (/^05\d{8}$/.test(local)) u.searchParams.set('mobile', local);
    return u.toString();
  } catch {
    return url;
  }
}
