// The "involved" section's hub page (pages/_hub.mjs; its pages: config.mjs SECTIONS).
import { hubPage } from './_hub.mjs';

export const slug = { he: 'get-involved', en: 'get-involved' };
const hub = hubPage('involved');
export const meta = hub.meta;
export const render = hub.render;
