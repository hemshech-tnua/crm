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
      matchMedia(document.documentElement.lang === 'en' ? '(min-width: 75rem)' : '(min-width: 64rem)').addEventListener?.('change', (q) => q.matches && close());
    }
  }

  // the header bar wraps under text spacing / zoom: --header-h (scroll padding, sticky offsets) follows its real height
  const head = document.querySelector('.site-header__bar');
  if (head && 'ResizeObserver' in window) {
    new ResizeObserver(() => root.style.setProperty('--header-h', `${Math.ceil(head.getBoundingClientRect().height)}px`)).observe(head);
  }

  // phone CTA bar: shown once the page's CTA (or, without one, the first chapter) is above the viewport. A scroll check
  // (rAF-throttled), not an IntersectionObserver: a jump from below the fold to past the CTA never intersects it.
  const bar = document.querySelector('[data-cta-bar]');
  const anchor = document.querySelector('[data-hero-cta]') ?? document.querySelector('main > :first-child');
  if (bar && anchor) {
    let ticking = false;
    const check = () => { ticking = false; bar.toggleAttribute('data-shown', anchor.getBoundingClientRect().bottom < 0); };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    check();
  }
}
