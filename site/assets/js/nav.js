// Header behaviour: the section dropdowns (disclosure buttons: click / Enter / Space toggles, Esc closes and returns
// focus to the button, a click outside or focus leaving the section closes it, one open at a time; with a mouse,
// moving onto another section while one is open switches to it — hover never opens the first one). The panel's
// visibility follows aria-expanded in CSS (components.css), so the state and what is shown never disagree. The phone menu (native <dialog>: modal, Esc, inert page behind it) with aria-expanded, a Tab
// wrap-around focus trap and focus returned to the button. The header itself never hides or shrinks (MOTION.md: easy
// navigation wins); the phone CTA bar appears once the page's own CTA has scrolled away.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function initSections() {
  const nav = document.querySelector('[data-site-nav]');
  if (!nav) return;
  const items = [...nav.querySelectorAll('[data-nav-item]')].map((li) => ({ li, btn: li.querySelector('[data-nav-toggle]'), panel: li.querySelector('[data-nav-panel]') })).filter((i) => i.btn && i.panel);
  let open = null;
  const set = (item, on) => {
    item.btn.setAttribute('aria-expanded', String(on));
    item.li.toggleAttribute('data-open', on);
  };
  const close = (focusBtn = false) => {
    if (!open) return;
    const item = open;
    set(item, false);
    open = null;
    if (focusBtn) item.btn.focus();
  };
  const show = (item) => {
    if (open === item) return;
    close();
    set(item, true);
    open = item;
  };
  for (const item of items) {
    item.btn.addEventListener('click', () => (open === item ? close() : show(item)));
    item.btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      show(item);
      item.panel.querySelector('a[href]')?.focus();
    });
    item.btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && open && open !== item) show(item); });
    item.li.addEventListener('focusout', (e) => { if (open === item && !item.li.contains(e.relatedTarget) && e.relatedTarget) close(); });
  }
  nav.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.preventDefault(); close(true); } });
  document.addEventListener('pointerdown', (e) => { if (open && !open.li.contains(e.target)) close(); });
  // a window that shrinks to the phone layout hides the header nav: nothing stays open behind it
  matchMedia('(max-width: 63.99rem)').addEventListener?.('change', (q) => q.matches && close());
}

export function initNav() {
  const root = document.documentElement;
  initSections();
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

  // phone CTA bar: shown once the page's CTA (or, without one, the first chapter: not the breadcrumb above it) is above the viewport. A scroll check
  // (rAF-throttled), not an IntersectionObserver: a jump from below the fold to past the CTA never intersects it.
  const bar = document.querySelector('[data-cta-bar]');
  const anchor = document.querySelector('[data-hero-cta]') ?? document.querySelector('main > section');
  if (bar && anchor) {
    let ticking = false;
    const check = () => { ticking = false; bar.toggleAttribute('data-shown', anchor.getBoundingClientRect().bottom < 0); };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    check();
  }
}
