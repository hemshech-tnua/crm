// The former "involved" hub: now forwards (config.mjs REDIRECTS, pages/_redirect.mjs).
import { redirectPage } from './_redirect.mjs';

export const slug = { he: 'get-involved', en: 'get-involved' };
const page = redirectPage('involved');
export const meta = page.meta;
export const render = page.render;
export const redirect = page.redirect;
export const ctaBar = page.ctaBar;
