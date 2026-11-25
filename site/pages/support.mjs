// The former "support" hub: now forwards (config.mjs REDIRECTS, pages/_redirect.mjs).
import { redirectPage } from './_redirect.mjs';

export const slug = { he: 'support', en: 'support' };
const page = redirectPage('support');
export const meta = page.meta;
export const render = page.render;
export const redirect = page.redirect;
export const ctaBar = page.ctaBar;
