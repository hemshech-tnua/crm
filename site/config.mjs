// Site-wide settings that are not copy. Copy lives in content/{he,en}.json, owner content in content/org.json.

/** Defaults; each can be overridden by the environment variable named beside it. */
export const DEFAULTS = {
  base: '/crm/site/', //                                     SITE_BASE   — path the site is served from
  origin: 'https://hemshech-tnua.github.io', //              SITE_ORIGIN — for canonical / OG / sitemap URLs
  crmUrl: 'https://hemshech-tnua.github.io/crm/', //         SITE_CRM_URL — the existing registration system
  // Same production values as .github/workflows/deploy.yml (the anon key is public by design; RLS guards the data).
  supabaseUrl: 'https://bvoubfasrgumpehyxbcg.supabase.co', // SUPABASE_URL
  supabaseAnonKey: //                                        SUPABASE_ANON_KEY
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2b3ViZmFzcmd1bXBlaHl4YmNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNTMwMTEsImV4cCI6MjEwOTYyOTAxMX0.pNfgZOgR3Z0tdjGF6AvZV1G1xfVODEL39uV6UD9wtCM',
  robots: 'allow', //                                        SITE_ROBOTS = allow | noindex
};

export const LANGS = ['he', 'en'];
export const DEFAULT_LANG = 'he';
export const LANG_META = {
  he: { dir: 'rtl', locale: 'he_IL', intl: 'he-IL', name: 'עברית', prefix: '' },
  en: { dir: 'ltr', locale: 'en_US', intl: 'en-GB', name: 'English', prefix: 'en/' },
};

/**
 * Navigation by page id. Labels come from content nav.<id>. A page id that has no module in pages/ yet is skipped
 * (so the menu only ever links to pages that exist). Order = order on screen.
 */
export const NAV = {
  // the header (desktop) and the first group of the mobile menu: keep it short — "easy navigation"
  primary: ['friday', 'evenings', 'about', 'partners', 'volunteer', 'donate'],
  // the rest of the mobile menu and the footer
  secondary: ['calendar', 'team', 'faq', 'membership', 'contact', 'stories', 'gallery', 'news', 'transparency', 'accessibility'],
};

/** The page the persistent "להרשמה למפגש" button goes to; falls back to the CRM's public meetings list. */
export const CTA_PAGE = 'calendar';

/** Links into the existing CRM (hash routes). */
export const crmLinks = (crmUrl) => ({
  home: `${crmUrl}#/`,
  register: (code) => `${crmUrl}#/r/${encodeURIComponent(code)}`,
  event: (code) => `${crmUrl}#/e/${encodeURIComponent(code)}`,
  friday: `${crmUrl}#/friday`,
  join: `${crmUrl}#/join`,
  member: `${crmUrl}#/member`,
  privacy: `${crmUrl}#/privacy`,
  propose: `${crmUrl}#/join`,
  login: `${crmUrl}#/login`,
});

/** CSS files in cascade order; any other .css file in assets/css is appended after these (alphabetically). */
export const CSS_ORDER = ['layers.css', 'reset.css', 'tokens.css', 'base.css', 'layout.css', 'components.css', 'motion.css', 'utilities.css'];

/** The JS entry module every page loads (it lazy-loads the rest when a page needs it). */
export const JS_ENTRY = 'main.js';
