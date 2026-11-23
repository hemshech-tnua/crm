// Header behaviour: the mobile menu (native <dialog>: modal, Esc, inert page behind it) with aria-expanded, a Tab
// wrap-around focus trap and focus returned to the button; the header hides on scroll down and returns on scroll up.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function initNav() {
  const root = document.documentElement;
  const header = document.querySelector('[data-header]');
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
        if (e.target === menu) return close(); // a click on the backdrop
        const a = e.target.closest('a[href]');
        if (a && a.pathname === location.pathname && a.hash) close(); // a link to this page's own section
      });
      menu.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const items = [...menu.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      // leaving the phone layout with the menu open (rotating a tablet) keeps it usable: nothing to do, it is a dialog
    }
  }

  if (header) {
    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const dy = y - lastY;
      if (Math.abs(dy) < 8) return;
      const hide = dy > 0 && y > header.offsetHeight * 2 && !header.contains(document.activeElement) && !menu?.open;
      header.toggleAttribute('data-hidden', hide);
      lastY = y;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    header.addEventListener('focusin', () => header.removeAttribute('data-hidden'));
  }
}
