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
 * The site's sections: the header (one dropdown per section), the phone menu (one group per section), the footer (one
 * column per section), the breadcrumb ("<section> › <page>") and the section's own hub page all read this one list.
 *   id      the section (copy: sections.<id>.label / .lead / .all / .meta.*)
 *   hub     the page id of the section's hub page (pages/<hub>.mjs, built from pages/_hub.mjs)
 *   pages   the section's pages, in order on screen (copy: nav.<id> label, sections.desc.<id> one-line description)
 * A page id that is not in this build (no module yet, or waiting for owner content: PAGE_WHEN) is skipped everywhere.
 * Every page belongs to exactly one section; the home page, the accessibility statement (footer legal row) and the
 * 404 belong to none.
 */
export const SECTIONS = [
  { id: 'meetings', hub: 'meetings', pages: ['friday', 'evenings', 'calendar'] },
  { id: 'association', hub: 'association', pages: ['about', 'team', 'faq'] },
  { id: 'involved', hub: 'involved', pages: ['volunteer', 'membership'] },
  { id: 'support', hub: 'support', pages: ['donate', 'partners', 'contact'] },
];

/** Pages outside the sections (the home page, the legal row, the 404). */
export const OUTSIDE_SECTIONS = ['home', 'accessibility', '404'];

/**
 * Pages that are built and listed only while their owner content exists (content/org.json). In a production build a
 * page whose test is false is not written at all: it leaves the header, menu and footer, the sitemap, and
 * ctx.pageExists(id) answers false, so links to it fall back by themselves. Fill the content and rebuild: it returns.
 * Preview builds always build and list it, with its dashed owner-content boxes.
 */
export const PAGE_WHEN = {
  team: (org) => [org.team, org.board, org.advisors].some((v) => Array.isArray(v) && v.length > 0),
};

/** Pages whose main job is the live meetings list: the browser fetches the meetings modules at once (modulepreload). */
export const LIVE_FIRST = ['calendar'];

/** The page the persistent "להרשמה למפגש" button goes to; falls back to the CRM's public meetings list. */
export const CTA_PAGE = 'calendar';

/**
 * The header's button (and the phone menu's): "לשישי הקרוב ◀". Without data it goes to the Friday page's dates
 * (`page` + `hash`); events.js then points it straight at the registration of the next open meeting of `type`
 * (with the visit's ref/utm_*, assets/js/attribution.js).
 */
export const HEADER_CTA = { page: 'friday', hash: 'dates', type: 'friday' };

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
