// The "association" section's hub page (pages/_hub.mjs; its pages: config.mjs SECTIONS).
import { hubPage } from './_hub.mjs';

export const slug = { he: 'association', en: 'association' };
const hub = hubPage('association');
export const meta = hub.meta;
export const render = hub.render;
