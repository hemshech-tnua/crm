// Scroll storytelling helpers. Contract with the markup:
//   data-reveal="up|fade|start|end|scale"   element animates in the first time it enters the viewport
//   data-reveal-delay="1".."6"               a fixed stagger step
//   data-reveal-group (on a parent)          its direct [data-reveal] children are staggered in order
//   data-chapters / data-chapter / data-chapter-link   sticky chapters: the active one gets data-active,
//                                            its link aria-current="true", the container data-active-chapter="<id>"
//   data-parallax (CSS only, scroll-driven)  subtle movement of the child where the browser supports it
//   data-progress                            the reading-progress bar (CSS scroll timeline, JS fallback)
// Without JS, with reduced motion, or without IntersectionObserver everything is simply visible and static.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

export function initScroll() {
  const root = document.documentElement;
  const supports = (p) => typeof CSS !== 'undefined' && CSS.supports && CSS.supports(p);
  if (supports('animation-timeline: view()') && supports('animation-timeline: scroll()')) root.classList.add('sda');
  else progressFallback();
  initReveal(root);
  initChapters();
}

function initReveal(root) {
  const els = [...document.querySelectorAll('[data-reveal]')];
  if (!els.length) return;
  for (const group of document.querySelectorAll('[data-reveal-group]')) {
    [...group.children].filter((el) => el.hasAttribute('data-reveal') && !el.hasAttribute('data-reveal-delay'))
      .forEach((el, i) => el.style.setProperty('--reveal-i', String(Math.min(i, 8))));
  }
  if (reduce.matches || !('IntersectionObserver' in window)) return;
  // what is already on screen stays put (no flash); only what is below the fold waits for its entrance
  const vh = window.innerHeight;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) el.classList.add('is-revealed');
  }
  root.classList.add('js-reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-revealed'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  els.filter((el) => !el.classList.contains('is-revealed')).forEach((el) => io.observe(el));
  const showAll = () => { els.forEach((el) => el.classList.add('is-revealed')); io.disconnect(); };
  reduce.addEventListener?.('change', () => reduce.matches && showAll());
  window.addEventListener('beforeprint', showAll);
}

function initChapters() {
  if (!('IntersectionObserver' in window)) return;
  for (const box of document.querySelectorAll('[data-chapters]')) {
    const chapters = [...box.querySelectorAll('[data-chapter]')];
    const links = [...box.querySelectorAll('[data-chapter-link]')];
    if (!chapters.length) continue;
    const set = (id) => {
      if (box.dataset.activeChapter === id) return;
      box.dataset.activeChapter = id;
      chapters.forEach((c) => c.toggleAttribute('data-active', c.id === id));
      links.forEach((a) => (a.getAttribute('href') === `#${id}` ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    };
    // a chapter is active while it crosses the middle band of the viewport
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (hit) set(hit.target.id);
    }, { rootMargin: '-40% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] });
    chapters.forEach((c) => io.observe(c));
  }
}

function progressFallback() {
  const bar = document.querySelector('[data-progress]');
  if (!bar) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--progress', String(max > 0 ? Math.min(1, window.scrollY / max) : 0));
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}
