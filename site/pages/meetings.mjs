// The "meetings" section's hub page (pages/_hub.mjs; its pages: config.mjs SECTIONS).
import { hubPage } from './_hub.mjs';

export const slug = { he: 'meetings', en: 'meetings' };
const hub = hubPage('meetings');
export const meta = hub.meta;
export const render = hub.render;
