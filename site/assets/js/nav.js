// Header behaviour (the flat six-link menu has no dropdowns). The phone menu (native <dialog>: modal, Esc, inert page behind it) with aria-expanded, a Tab
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
      matchMedia('(min-width: 70rem)').addEventListener?.('change', (q) => q.matches && close());
    }
  }

  // the header bar wraps under text spacing / zoom: --header-h (scroll padding, sticky offsets) follows its real height
  const head = document.querySelector('.site-header__bar');
  if (head && 'ResizeObserver' in window) {
    new ResizeObserver(() => root.style.setProperty('--header-h', `${Math.ceil(head.getBoundingClientRect().height)}px`)).observe(head);
  }

  // phone CTA bar: shown once the page's CTA (or, without one, the first chapter) is above the viewport, AND no
  // registration link is on screen (a meeting card's link, a registration button in a chapter): the bar never covers a
  // card's own link and never doubles a button the reader can already see. A scroll check (rAF-throttled) for the CTA (a
  // jump past it never intersects), an IntersectionObserver counting the registration links in view.
  const bar = document.querySelector('[data-cta-bar]');
  const anchor = document.querySelector('[data-hero-cta]') ?? document.querySelector('main > section');
  if (bar && anchor) {
    let ticking = false;
    let covered = 0;
    const check = () => { ticking = false; bar.toggleAttribute('data-shown', anchor.getBoundingClientRect().bottom < 0 && covered === 0); };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    if ('IntersectionObserver' in window) {
      const seen = new Set();
      const io = new IntersectionObserver((es) => { es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))); covered = seen.size; check(); });
      const watch = () => document.querySelectorAll('main [data-events] a[href], main [data-events] .chip, main [data-next-link], main [data-next-cta]').forEach((el) => { if (!el.closest('[data-hero-cta]')) io.observe(el); });
      watch();
      document.addEventListener('events:rendered', watch); // the meetings list arrives later
    }
    check();
  }
}
