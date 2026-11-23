# The המשך תנועה website (`site/`)

A fast, static, bilingual site built by a **zero-dependency** Node 22 script. Hebrew at `/crm/site/` (RTL), English at
`/crm/site/en/` (LTR). No framework, no npm packages, no inline scripts. The CRM (`src/`) is separate and untouched.

```
site/
  build.mjs          the generator → dist/site/
  serve.mjs          local static server (http://127.0.0.1:4173/crm/site/)
  config.mjs         base path, origin, nav order, CTA target, CRM links, CSS order
  content/           he.json, en.json (copy) · org.json (owner content) · optional he/<name>.json, en/<name>.json
  pages/*.mjs        one module per page (home.mjs, 404.mjs …); files starting with _ are ignored
  partials/*.mjs     layout, head (meta/OG/hreflang/canonical/CSP), header + mobile menu, footer
  lib/               html.mjs (templates), brand.mjs (logo/stripes/◀), images.mjs, components.mjs
  assets/css/        layered CSS, concatenated + fingerprinted into one file
  assets/js/         ES modules (main, nav, scroll, events, org, api), fingerprinted; config.js is generated
  assets/photos/     <name>-<width>.webp variants (640/1024/≤1600)
  tools/             resize-photos.py (one-off helper, Pillow; not part of the build)
  test/              node --test suites + smoke.cjs (Playwright)
```

## Commands

| | |
|---|---|
| `npm run build:site` | production build → `dist/site/` |
| `npm run dev:site` | preview build + server on http://127.0.0.1:4173/crm/site/, rebuilds on every change in `site/` (reload the page) |
| `npm run test:site` (`node --test site/test`) | build contract tests (both modes), CSS rules, copy rules, template helpers |
| `npm run smoke:site` (`node site/test/smoke.cjs [--build] [--shots dir]`) | every page at 320/390/768/1440 in Chromium: console/CSP errors, overflow, white backgrounds, 44px targets, skip link, menu focus trap/Esc, live meetings states, reveals, reduced motion, axe WCAG 2.2 AA. Supabase is mocked. |

Environment: `SITE_PREVIEW=1` (same as `--preview`), `SITE_BASE` (default `/crm/site/`), `SITE_ORIGIN`
(`https://hemshech-tnua.github.io`), `SITE_OUT` (`dist/site`; must be under `dist/` or `/tmp`, it is emptied first),
`SITE_CRM_URL`, `SUPABASE_URL` / `SUPABASE_ANON_KEY` (default: the production values of the CRM deploy),
`SITE_ROBOTS=noindex` (meta robots + `Disallow`).

## Adding a page

Create `site/pages/<id>.mjs`. The file name is the page id (used by `ctx.link('<id>')` and the nav in `config.mjs`).

```js
import { html } from '../lib/html.mjs';

export const slug = { he: 'friday', en: 'friday' };          // '' = the home page; lowercase latin + dashes

// optional — default: copy keys <id>.meta.title / <id>.meta.description
export const meta = (ctx) => ({ title: ctx.t('friday.meta.title'), description: ctx.t('friday.meta.description') });

export function render(ctx) {
  return html`
<section class="section" aria-labelledby="friday-h1">
  <div class="container">
    <h1 id="friday-h1">${ctx.t('friday.hero.title')}</h1>           <!-- exactly one h1 per page -->
    <p class="lead" data-reveal="up">${ctx.rich('friday.hero.lead')}</p>
    ${ctx.img('training', { eager: true, sizes: '(min-width: 64rem) 50vw, 100vw' })}
    ${ctx.events({ type: 'friday', limit: 3 })}
    ${ctx.slot(ctx.org.quotes, ctx.t('slots.quotes'), (qs) => qs.map((q) => html`<blockquote>${ctx.l(q.text)}</blockquote>`))}
  </div>
</section>`;
}
```

Also optional: `export const ctaBar = false | { type: 'friday', label: '<copy key>', pay: true }` (the phone CTA bar;
default on, off for donate/contact), `export const bodyClass = '…'`, `export function jsonld(ctx) { return {…} }` (structured data),
`export const notFound = true` (only the 404). The page appears in the header/menu/footer once its id is in
`config.mjs` `NAV` and it has a `nav.<id>` label in both languages. Pages must exist in both languages.

### `ctx` — what a page gets

| | |
|---|---|
| `ctx.lang`, `ctx.dir`, `ctx.otherLang` | `'he'`/`'en'`, `'rtl'`/`'ltr'` |
| `ctx.t(key, vars?)` | a copy string from `content/<lang>.json` (`'a.b.c'`, `{n}` placeholders). **A missing key fails a production build**; preview shows `⟦key⟧`. |
| `ctx.rich(key)` | copy with light markup: `**bold**`, `_em_`, `[text](url)`, `\n` → `<br>` (escaped first) |
| `ctx.list(key)`, `ctx.get(key)` | arrays / objects from copy |
| `html\`…\``, `raw()`, `esc()`, `attrs({})`, `cx()` | from `lib/html.mjs`: interpolations are **escaped** unless they are `html` results; `raw()` only for markup you made yourself |
| `ctx.link(id)`, `ctx.link(id, 'en')` | URL of a page (build error if it does not exist) |
| `ctx.asset('img/x.svg')` | URL of a file in `site/assets/` (checked) |
| `ctx.img(name, { alt?, sizes, eager, className })` | responsive `<img>` from `assets/photos/<name>-<w>.webp`: srcset, width/height, lazy (eager + `fetchpriority=high` for the hero). `alt` defaults to copy `photos.<name>`. |
| `ctx.org`, `ctx.l(v)`, `ctx.has(v)` | owner content (`org.json`); `l()` picks `{he,en}`; `has()` = not empty |
| `ctx.slot(value, label, render, { tag })` | owner content slot: `render(value)` when it exists; otherwise a dashed **“תוכן מהעמותה: label”** box in preview builds and **nothing** in production. `tag: 'li'` inside lists. |
| `ctx.events({ type, limit, filter, heading, id, stack, more })` | the live meetings list (see below) |
| `ctx.nextMeeting({ type, label, title, body, cta, more, heroCta, pay })` | the live "next meeting" card (static text until the data arrives) |
| `ctx.ui.*` | shared blocks (lib/components.mjs): `photo(name,{ratio,focus,bleed,wipe,…})`, `corner({pos,tone})`, `mark()`, `faq(groups)`, `timeline(steps)`, `stats(items)`, `quote(q)`, `logos(list)`, `rows(items)`, `triList(items)`, `ctaBand({…})`, `button(label, href)`, `link(label, href)` |
| `ctx.inline(str)` | the `ctx.rich` markup for a string you already hold |
| `ctx.whatsapp(label, { className, text })` | WhatsApp link to the association's phone, filled live; hidden until the phone arrives |
| `ctx.reveal('up', 2)` | `data-reveal="up" data-reveal-delay="2"` |
| `ctx.brand.logo({ variant: 'symbol'|'lockup' })`, `.stripes({…})`, `.chevron()`, `.tri()` | brand artwork as inline SVG (logo paths read from `src/ui/Logo.tsx`; ◀/▶ follows the language) |
| `ctx.crm.register(code)`, `.event(code)`, `.home`, `.join`, `.member`, `.privacy` | links into the CRM |
| `ctx.ctaHref` | the "להרשמה למפגש" target (`calendar` page, or the CRM's meetings list until it exists) |
| `ctx.preview`, `ctx.page.id`, `ctx.site.base` | flags and paths |

The build applies a non-breaking space inside **“המשך תנועה”** everywhere, so the name never splits across lines.

### Rules the tests enforce

One `<h1>`; `lang`/`dir`, title, description, canonical, hreflang (he/en/x-default), OG on every page; header/main/footer
landmarks and the skip link (from the layout); **no inline `<script>`, `style="…"`, `<style>` or `on…=` handlers** (the
CSP blocks them: set CSS custom properties from JS with `el.style.setProperty`, which is allowed); unique ids; every
internal link, `src` and `srcset` resolves; images have `alt` + `width`/`height`; JS < 30 KB; CSS has **no white
background** and only **logical properties** (`margin-inline-start`, `inset-inline-end`, `text-align: start` …);
he/en copy have identical keys; no slashed/dotted gender forms (`לוחמים/ות`, `ללוחמים.ות`).

## Content model

- `content/he.json`, `content/en.json` — copy. Keys the frame itself needs: `site.{name,description,titleSeparator}`,
  `skip`, `nav.{label,footerLabel,menuLabel,menu,close,homeLabel,switchTo,<page ids>}`, `cta.register`, `footer.*`,
  `events.*` (also sent to the browser for the meetings list), `slots.*`, `notFound.*`, `photos.<name>` (alt texts).
  A page's copy goes under its id (`friday.hero.title`). Large page copy may live in `content/<lang>/<id>.json`, merged
  in under the key `<id>`.
- `content/org.json` — owner content, empty until the association sends it. Bilingual text is `{ "he": "…", "en": "…" }`;
  file paths are relative to `site/assets/`.

| key | shape |
|---|---|
| `nameEn` | string — official English name |
| `donateUrl` | URL of the donation payment page |
| `section46` | boolean — tax credit approved |
| `bank` | `{ bankName:{he,en}, branch, account, accountName:{he,en} }` |
| `email`, `address` | string, `{he,en}` |
| `socials` | `[{ network, url, label?:{he,en} }]` |
| `stats` | `[{ value, label:{he,en}, period?:{he,en} }]` |
| `team`, `board` | `[{ name:{he,en}, role:{he,en}, photo?: 'photos/…' }]` |
| `partners` | `[{ name:{he,en}, logo: 'img/partners/x.svg', url? }]` |
| `quotes` | `[{ text:{he,en}, name:{he,en}, context?:{he,en} }]` (written consent required) |
| `reports` | `[{ year, title:{he,en}, file: 'files/x.pdf' }]` |
| `photos`, `videos` | lists for a gallery |
| `registrationNumber` | string — ע״ר number (footer legal row, donate) |
| `donateMonthlyUrl` | URL for a monthly standing order |
| `sponsorAmount` | number (₪) — cost of sponsoring one meeting, if public |
| `abroad` | `{ url, body:{he,en} }` — how to give from abroad |
| `impact` | `[{ label:{he,en}, value }]` — what donations pay for |
| `partnersEmail`, `partnersContact`, `partnersDeck` | string · `{ name:{he,en}, role:{he,en} }` · `'files/x.pdf'` |
| `pressEmail`, `hours` | string · `{he,en}` |
| `properConduct` | `{ file:'files/x.pdf', validUntil }` — אישור ניהול תקין |

**Preview vs production:** `--preview` / `SITE_PREVIEW=1` shows every empty owner slot as a dashed box so the board sees
the full layout; production omits those sections (and fails on missing copy). Deploys are production builds.

## Live data (browser)

`assets/js/config.js` is generated with the Supabase URL + anon key (public by design; RLS and SQL functions guard the
data). `api.js` POSTs to `/rest/v1/rpc/<fn>` (8 s timeout, one retry, one shared request per page).

- **Meetings** — `<div data-events="all|friday|bonfire|other" data-events-limit="6" data-events-filter
  data-events-heading="3">` (write it with `ctx.events()`). Renders cards from `public_list_events`
  (`private.event_public`): kind, title, date + time in Asia/Jerusalem (he-IL / en-GB), place, activity/lecture, price,
  "full / waiting list / N places left", **להרשמה** → `…/crm/#/r/<code>`, **פרטים** → `…/crm/#/e/<code>`. Skeleton while
  loading, an empty state, an error state with retry; the "all meetings in the registration system" link is always
  there (also without JS). DB text on English pages is marked `lang="he"`.
- **Phone** — `data-org-phone="whatsapp|tel|text"` (+ optional `data-org-text`) from `public_org_info.contact_phone`;
  a `[data-org-phone-item]` wrapper is un-hidden with it.

## Scroll and motion (`scroll.js`, `motion.css`)

`data-reveal="up|fade|start|end|scale"`, `data-reveal-delay="1…6"`, `data-reveal-group` (staggers direct children),
`data-chapters` + `data-chapter` + `data-chapter-link` (sticky chapters: active chapter gets `data-active`, its link
`aria-current="true"`), `data-parallax` (CSS scroll-driven, where supported: `html.sda`), `data-progress` (reading bar;
scroll timeline or JS fallback). Content is visible at rest and without JS; what is on screen at load never animates;
`prefers-reduced-motion: reduce` disables all of it. Transform/opacity only. The full contract (bare `data-reveal` =
stagger the children, `data-load`, `data-wipe`, `data-follow`, `data-count`) is at the top of `assets/css/motion.css`.
The header never hides (MOTION.md); below 1024px a phone CTA bar slides in once the page's `[data-hero-cta]` has
scrolled away. The mobile menu is a native `<dialog>`
(modal, Esc, inert page) with `aria-expanded`, a Tab focus trap and focus return.

## CSS

One file in cascade layers: `reset, tokens, base, layout, components, motion, utilities` (order in `layers.css` /
`config.mjs`; extra `.css` files are appended alphabetically, each must start with `@layer`). `tokens.css` is a
placeholder that the design system replaces; `components.css` is neutral temporary styling. Fonts: Google Sans
(self-hosted, preloaded per language) with a metric-adjusted local fallback.

## Photos

`python3 site/tools/resize-photos.py <file>…` writes `assets/photos/<name>-{640,1024,≤1600}.webp` (Pillow, run once,
commit the results). Add `photos.<name>` alt text in both languages. The current six photos are illustrative: never
caption them as specific people or events.

## Deploy

`.github/workflows/deploy.yml` runs `node site/build.mjs` after the CRM's `npm run build` (same `SUPABASE_URL` /
`SUPABASE_ANON_KEY` repository variables, production fallback) and publishes `dist/` → the site is at
`https://hemshech-tnua.github.io/crm/site/`. Notes for that host: GitHub Pages serves only the repository-root
`404.html` (the CRM's), so `dist/site/404.html` is used only by hosts that honour per-folder 404s, and `robots.txt` is
only read at a domain root — both work as-is with a custom domain and `SITE_BASE=/`. The CSP is a `<meta>` (Pages sends
no headers). The site shares the CRM's origin, so it must never load third-party scripts.
