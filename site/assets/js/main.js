// Entry module on every page (loaded with type="module", so it runs after parsing, never blocks rendering).
// Live-data modules are fetched only on pages that have a slot for them.
import { initNav } from './nav.js';
import { initScroll } from './scroll.js';

const root = document.documentElement;
root.classList.remove('no-js');
root.classList.add('js');

initNav();
initScroll();

if (document.querySelector('[data-events]')) {
  import('./events.js').then((m) => m.initEvents()).catch(() => {});
}
if (document.querySelector('[data-org-phone]')) {
  import('./org.js').then((m) => m.initOrg()).catch(() => {});
}
