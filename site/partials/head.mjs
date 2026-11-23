// <head>: meta, CSP, canonical + hreflang, Open Graph, fonts preload, the stylesheet and the one entry script.
import { html, raw, attrs } from '../lib/html.mjs';

/** The Content-Security-Policy for every page: own files only, no inline script, network only to Supabase. */
export function csp(supabaseOrigin) {
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
    "require-trusted-types-for 'script'",
  ].join('; ');
}

const jsonLd = (obj) => raw(`<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`);

export function head(ctx, { title, description, noindex, jsonld, live = false }) {
  const { page, site } = ctx;
  const fonts = ctx.lang === 'he' ? ['google-sans-hebrew-wght-normal.woff2', 'google-sans-latin-wght-normal.woff2'] : ['google-sans-latin-wght-normal.woff2'];
  const ogImage = site.origin + site.base + 'assets/og-image.png';
  const alt = page.alternates; // { he: absUrl, en: absUrl } (null for the 404)
  return html`<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${raw(csp(site.supabaseOrigin).replace(/"/g, ''))}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex || site.robots === 'noindex' ? html`<meta name="robots" content="noindex">` : ''}
${alt ? html`<link rel="canonical" href="${alt[ctx.lang]}">
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
<meta property="og:image" content="${ogImage}">
<meta property="og:locale" content="${ctx.meta.locale}">
<meta property="og:locale:alternate" content="${ctx.lang === 'he' ? 'en_US' : 'he_IL'}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${ctx.t('site.ogImageAlt')}">
<meta name="twitter:image:alt" content="${ctx.t('site.ogImageAlt')}">
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
