// The "support" section's hub page (pages/_hub.mjs; its pages: config.mjs SECTIONS).
import { hubPage } from './_hub.mjs';

export const slug = { he: 'support', en: 'support' };
const hub = hubPage('support');
export const meta = hub.meta;
export const render = hub.render;
