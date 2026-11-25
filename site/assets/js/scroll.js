// Scroll storytelling (MOTION.md). The markup contract is documented at the top of assets/css/motion.css.
// Without JS, with reduced motion, or without IntersectionObserver everything is simply visible and static.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const hasIO = 'IntersectionObserver' in window;

export function initScroll() {
  const root = document.documentElement;
  const supports = (p) => typeof CSS !== 'undefined' && CSS.supports && CSS.supports(p);
  if (supports('animation-timeline: view()') && supports('animation-timeline: scroll()')) root.classList.add('sda');
  else progressFallback();
  initReveal(root);
  initFollow();
  initChapters();
  initCount();
}

const isGroup = (el) => el.getAttribute('data-reveal') === '' || el.getAttribute('data-reveal') === 'group';

function initReveal(root) {
  const els = [...document.querySelectorAll('[data-reveal]')];
  // stagger indexes: children of a group (max 6 steps), and [data-reveal] children of a legacy data-reveal-group
  for (const g of els.filter(isGroup)) [...g.children].forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 6))));
  for (const g of document.querySelectorAll('[data-reveal-group]')) {
    [...g.children].filter((el) => el.hasAttribute('data-reveal') && !el.hasAttribute('data-reveal-delay'))
      .forEach((el, i) => el.style.setProperty('--reveal-i', String(Math.min(i, 6))));
  }
  if (!els.length || reduce.matches || !hasIO) return;
  // what is on screen at load stays put (no flash); only what is below the fold waits for its entrance
  const vh = window.innerHeight;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) el.classList.add('is-in');
  }
  root.classList.add('js-reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-revealed'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
  els.filter((el) => !el.classList.contains('is-in')).forEach((el) => io.observe(el));
  const showAll = () => { els.forEach((el) => el.classList.add('is-in')); io.disconnect(); };
  reduce.addEventListener?.('change', () => reduce.matches && showAll());
  window.addEventListener('beforeprint', showAll);
}

/** Follow-the-middle: [data-follow="<selector>"] marks its [data-step] item that matches the block at mid-screen. */
function initFollow() {
  if (!hasIO) return;
  for (const box of document.querySelectorAll('[data-follow]')) {
    const items = box.querySelectorAll('[data-step]');
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const k = e.target.dataset.step;
      items.forEach((it) => it.toggleAttribute('data-active', it.dataset.step === k));
    }), { rootMargin: '-45% 0px -45% 0px' });
    document.querySelectorAll(box.dataset.follow).forEach((t) => io.observe(t));
  }
}

/** Sticky chapters (legacy contract): data-chapters / data-chapter / data-chapter-link. */
function initChapters() {
  if (!hasIO) return;
  for (const box of document.querySelectorAll('[data-chapters]')) {
    const chapters = [...box.querySelectorAll('[data-chapter]')];
    const links = [...box.querySelectorAll('[data-chapter-link]')];
    if (!chapters.length) continue;
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting)[0];
      if (!hit || box.dataset.activeChapter === hit.target.id) return;
      const id = hit.target.id;
      box.dataset.activeChapter = id;
      chapters.forEach((c) => c.toggleAttribute('data-active', c.id === id));
      links.forEach((a) => (a.getAttribute('href') === `#${id}` ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    }, { rootMargin: '-45% 0px -45% 0px' });
    chapters.forEach((c) => io.observe(c));
  }
}

/** [data-count]: the printed number counts up once (900 ms) when half visible; screen readers get the final value. */
function initCount() {
  const els = [...document.querySelectorAll('[data-count]')];
  if (!els.length || reduce.matches || !hasIO) return;
  const vh = window.innerHeight;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const el = e.target;
    const to = Number(el.dataset.count);
    const text = el.textContent;
    el.setAttribute('aria-label', text);
    el.style.minInlineSize = `${text.length}ch`; // the width never jitters while the digits change
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      el.textContent = p < 1 ? String(Math.round(to * (1 - Math.pow(1 - p, 4)))) : text;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { threshold: 0.6 });
  // a number already on screen at load is simply shown (counting it would flash)
  els.filter((el) => { const r = el.getBoundingClientRect(); return !(r.top < vh && r.bottom > 0); }).forEach((el) => io.observe(el));
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
