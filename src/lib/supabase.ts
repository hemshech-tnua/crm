import { createClient } from '@supabase/supabase-js';

// VITE_SUPABASE_URL is the project URL (https://<ref>.supabase.co). For local demos it may be a path such as
// "/sb": the page's own server forwards it to the local Supabase, so the app works wherever the page is opened.
const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const url = raw?.startsWith('/') ? `${window.location.origin}${raw.replace(/\/$/, '')}` : raw;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://invalid.local', key ?? 'missing', {
  // Data requests (/rest/v1/ only; db.* never reaches /auth/v1/): no retries of supabase-js's own (React Query retries
  // once), and a hung request gives up after 15 s, so a lost connection shows the offline bar instead of waiting for ever.
  db: { retry: false, timeout: 15_000 },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'hemshech-auth' },
});

export const functionsUrl = `${url}/functions/v1`;

/** The public Storage bucket of people's photos (published only with consent; never in the git repository). */
export const PEOPLE_BUCKET = 'people';

/** The public URL of a photo in the `people` bucket. The CSP allows images from exactly this path. */
export const personPhotoUrl = (path: string) =>
  `${url ?? ''}/storage/v1/object/public/${PEOPLE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
