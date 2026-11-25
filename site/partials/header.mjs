// The site header (sticky, navy): the mark + typeset wordmark, the six-page menu (≥1024px; config.mjs NAV), the
// language switch and the persistent "לשישי הקרוב ◀" button (the next Friday's registration, live); below 1024px
// wordmark + CTA + "תפריט". Under it, the 4px reading-progress stripe.
// The phone menu is a native <dialog> (modal, Esc, inert page; nav.js adds aria-expanded, the focus trap and return)
// with the same six links and the CTA pinned at its foot.
import { html } from '../lib/html.mjs';
import { HEADER_CTA } from '../config.mjs';
import { topNav } from '../lib/sections.mjs';


export function langSwitch(ctx, cls = 'lang-switch', { short = false } = {}) {
  const other = ctx.otherLang;
  const label = short ? ctx.t('nav.switchShort') : ctx.t('nav.switchTo');
  return html`<a class="${cls}" href="${ctx.page.otherUrl}" hreflang="${other}" lang="${other}">${label}</a>`;
}

export function brandLink(ctx) {
  return html`<a class="brand" href="${ctx.link('home')}" aria-label="${ctx.t('nav.homeLabel')}">${ctx.brand.logo({ variant: 'symbol' })}<span class="brand__name"${ctx.lang === 'he' ? '' : html` lang="he"`}>${ctx.t('site.name')}</span></a>`;
}

/** "לשישי הקרוב ◀": the Friday page's dates without data; events.js swaps in the next Friday's registration link. */
export function ctaButton(ctx, cls = '') {
  const href = ctx.pageExists(HEADER_CTA.page) ? `${ctx.link(HEADER_CTA.page)}#${HEADER_CTA.hash}` : ctx.ctaHref;
  return html`<a class="btn ${cls}" href="${href}" data-next-link="${HEADER_CTA.type}" aria-label="${ctx.t('cta.headerAria')}"><span class="cta-long">${ctx.t('cta.header')}</span><span class="cta-short" aria-hidden="true">${ctx.t('cta.headerShort')}</span>${ctx.brand.tri()}</a>`;
}

export function header(ctx) {
  const items = topNav(ctx);
  const mark = (i) => (i.current ? html` aria-current="page"` : i.within ? html` aria-current="true"` : '');
  return html`<header class="site-header" data-ground="navy" data-header>
  <div class="wrap site-header__bar">
    ${brandLink(ctx)}
    ${items.length ? html`<nav class="site-nav" aria-label="${ctx.t('nav.label')}" data-site-nav>
      <ul class="site-nav__list" role="list">${items.map((i) => html`<li class="site-nav__item"><a class="site-nav__top" href="${i.href}"${mark(i)}>${i.label}</a></li>`)}</ul>
    </nav>` : ''}
    <div class="site-header__actions">
      ${langSwitch(ctx, 'lang-switch site-header__lang', { short: true })}
      ${ctaButton(ctx, 'btn--sm site-header__cta')}
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu" data-menu-open>
        <span class="menu-toggle__icon" aria-hidden="true"><span></span><span></span><span></span></span>
        <span class="menu-toggle__label">${ctx.t('nav.menu')}</span>
      </button>
    </div>
  </div>
  <div class="scroll-progress" data-progress aria-hidden="true"></div>
</header>
<dialog class="site-menu" id="site-menu" aria-label="${ctx.t('nav.menuLabel')}" data-ground="navy" data-menu>
  <div class="wrap site-menu__top">
    ${brandLink(ctx)}
    <div class="site-menu__tools">
      ${langSwitch(ctx, 'lang-switch site-menu__lang')}
      <button class="menu-close" type="button" data-menu-close><span>${ctx.t('nav.close')}</span><span class="menu-close__icon" aria-hidden="true"></span></button>
    </div>
  </div>
  <nav class="wrap site-menu__nav" aria-label="${ctx.t('nav.menuLabel')}">
    <ul class="site-menu__list" role="list">
      ${items.map((i) => html`<li><a class="site-menu__link" href="${i.href}"${mark(i)}>${i.label}${ctx.brand.tri()}</a></li>`)}
    </ul>
  </nav>
  <div class="site-menu__cta"><div class="wrap">${ctaButton(ctx, 'btn--block')}</div></div>
</dialog>`;
}
