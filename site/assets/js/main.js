// Entry module on every page (type="module": runs after parsing, never blocks rendering).
// Live-data modules are fetched only on pages that have a slot for them.
import { initNav } from './nav.js';
import { initScroll } from './scroll.js';

const root = document.documentElement;
root.classList.remove('no-js');
root.classList.add('js');

initNav();
initScroll();

if (document.querySelector('[data-events], [data-next]')) {
  import('./events.js').then((m) => m.initEvents()).catch(() => {});
}
if (document.querySelector('[data-org-phone]')) {
  import('./org.js').then((m) => m.initOrg()).catch(() => {});
}

// "העתקת הקישור": copies the page URL and confirms in place for 2 s (no toast).
for (const b of document.querySelectorAll('[data-copy-link]')) {
  b.addEventListener('click', async () => {
    const label = b.querySelector('[data-copy-label]') ?? b;
    const before = label.textContent;
    try {
      await navigator.clipboard.writeText(b.dataset.copyLink || location.href);
      label.textContent = b.dataset.copied || before;
      setTimeout(() => { label.textContent = before; }, 2000);
    } catch { /* clipboard refused: the WhatsApp link beside it still works */ }
  });
}
