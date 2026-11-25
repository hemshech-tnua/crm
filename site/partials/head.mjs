// <head>: meta, CSP, canonical + hreflang, Open Graph, fonts preload, the stylesheet and the one entry script.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { html, raw, attrs } from '../lib/html.mjs';

/**
 * Per-page share images (assets/og/og.json, written by tools/og.mjs): { <page id>: { he|en: { image, alt } } }.
 * A page without one (accessibility, 404) shares the default assets/og-image.png with copy site.ogImageAlt.
 */
const OG_JSON = fileURLToPath(new URL('../assets/og/og.json', import.meta.url));
export const OG_IMAGES = existsSync(OG_JSON) ? JSON.parse(readFileSync(OG_JSON, 'utf8')) : {};

/** The share image of a page: { url, alt, type } (absolute URL). */
export function ogImage(ctx) {
  const own = OG_IMAGES[ctx.page.id]?.[ctx.lang];
  const base = ctx.site.origin + ctx.site.base + 'assets/';
  return own
    ? { url: base + own.image, alt: own.alt, type: 'image/jpeg' }
    : OG_IMAGES.home?.[ctx.lang]
      ? { url: base + OG_IMAGES.home[ctx.lang].image, alt: OG_IMAGES.home[ctx.lang].alt, type: 'image/jpeg' }
      : { url: base + 'og-image.png', alt: ctx.t('site.ogImageAlt'), type: 'image/png' };
}

/**
 * The Content-Security-Policy for every page: own files only, no inline script, network only to Supabase.
 * { editorFrame: true } is the site editor's private copy of the pages (build.mjs SITE_EDITOR_FRAME): the same policy
 * without require-trusted-types, so the editor page (same origin) can put an edited text back into the page.
 */
export function csp(supabaseOrigin, { editorFrame = false } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "manifest-src 'self'",
    ...(editorFrame ? [] : ["require-trusted-types-for 'script'"]),
  ].join('; ');
}

const jsonLd = (obj) => raw(`<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`);

export function head(ctx, { title, description, noindex, redirect = null, jsonld, live = false }) {
  const { page, site } = ctx;
  const fonts = ctx.lang === 'he' ? ['google-sans-hebrew-wght-normal.woff2', 'google-sans-latin-wght-normal.woff2'] : ['google-sans-latin-wght-normal.woff2'];
  const og = ogImage(ctx);
  const alt = page.alternates; // { he: absUrl, en: absUrl } (null for the 404)
  return html`<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${raw(csp(site.supabaseOrigin, { editorFrame: !!site.editorFrame }).replace(/"/g, ''))}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex || site.robots === 'noindex' ? html`<meta name="robots" content="noindex">` : ''}
${redirect ? html`<meta http-equiv="refresh" content="0; url=${redirect}">` : ''}
${alt ? html`<link rel="canonical" href="${redirect ? ctx.abs(redirect) : alt[ctx.lang]}">
<link rel="alternate" hreflang="he" href="${alt.he}">
<link rel="alternate" hreflang="en" href="${alt.en}">
<link rel="alternate" hreflang="x-default" href="${alt.he}">` : ''}
<meta name="theme-color" content="#142837">
<meta name="color-scheme" content="light">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${ctx.t('site.name')}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${alt ? html`<meta property="og:url" content="${alt[ctx.lang]}">` : ''}
<meta property="og:image" content="${og.url}">
<meta property="og:image:type" content="${og.type}">
<meta property="og:locale" content="${ctx.meta.locale}">
<meta property="og:locale:alternate" content="${ctx.lang === 'he' ? 'en_US' : 'he_IL'}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${og.alt}">
<meta name="twitter:image:alt" content="${og.alt}">
<link rel="icon" href="${site.base}assets/favicon.svg" type="image/svg+xml">
${live && site.supabaseOrigin ? html`<link rel="preconnect" href="${site.supabaseOrigin}" crossorigin>
` : ''}${fonts.map((f) => html`<link rel="preload" href="${site.base}assets/fonts/${f}" as="font" type="font/woff2" crossorigin>
`)}<link rel="stylesheet" href="${ctx.assetUrl('css')}">
<script type="module" src="${ctx.assetUrl('js')}"></script>
${(ctx.livePreload ?? []).map((m) => html`<link rel="modulepreload" href="${ctx.jsUrl(m)}">
`)}
${(jsonld ?? []).map(jsonLd)}
</head>`;
}

export { attrs };
