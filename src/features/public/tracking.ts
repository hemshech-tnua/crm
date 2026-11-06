// Channel attribution travels with the visitor: ?ref= (channel link or personal invite) and utm_* survive
// the hop from the event list to the registration page.
const KEEP = ['ref', 'utm_source', 'utm_medium', 'utm_campaign'];

export function trackingQuery(params: URLSearchParams): string {
  const keep = new URLSearchParams();
  for (const k of KEEP) {
    const v = params.get(k)?.trim();
    if (v) keep.set(k, v.slice(0, 100));
  }
  const s = keep.toString();
  return s ? `?${s}` : '';
}
