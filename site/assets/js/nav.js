// Header behaviour: the phone menu (native <dialog>: modal, Esc, inert page behind it) with aria-expanded, a Tab
// wrap-around focus trap and focus returned to the button. The header itself never hides or shrinks (MOTION.md: easy
// navigation wins); the phone CTA bar appears once the page's own CTA has scrolled away.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function initNav() {
  const root = document.documentElement;
  const menu = document.querySelector('[data-menu]');
  const openBtn = document.querySelector('[data-menu-open]');

  if (menu && openBtn) {
    if (typeof menu.showModal !== 'function') {
      openBtn.hidden = true; // very old browser: the footer lists every page
    } else {
      const closeBtn = menu.querySelector('[data-menu-close]');
      const open = () => {
        menu.showModal();
        openBtn.setAttribute('aria-expanded', 'true');
        root.classList.add('menu-open');
        (closeBtn ?? menu.querySelector(FOCUSABLE))?.focus();
      };
      const close = () => menu.open && menu.close();
      openBtn.addEventListener('click', open);
      closeBtn?.addEventListener('click', close);
      menu.addEventListener('close', () => {
        openBtn.setAttribute('aria-expanded', 'false');
        root.classList.remove('menu-open');
        openBtn.focus();
      });
      menu.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (a && a.pathname === location.pathname && a.hash) close(); // a link to this page's own section
      });
      menu.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const items = [...menu.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      // a desktop-width window never needs the sheet: close it if the viewport grows past the phone layout
      matchMedia(document.documentElement.lang === 'en' ? '(min-width: 80rem)' : '(min-width: 75rem)').addEventListener?.('change', (q) => q.matches && close());
    }
  }

  // phone CTA bar: shown once the page's CTA (or, without one, the first chapter) has scrolled above the viewport
  const bar = document.querySelector('[data-cta-bar]');
  const anchor = document.querySelector('[data-hero-cta]') ?? document.querySelector('main > :first-child');
  if (bar && anchor && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      bar.toggleAttribute('data-shown', !e.isIntersecting && e.boundingClientRect.top < 0);
    }).observe(anchor);
  }
}
