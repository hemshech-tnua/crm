// The site header (sticky, navy): the mark + typeset wordmark, four section buttons (≥1024px; config.mjs SECTIONS), the
// language switch and the persistent "לשישי הקרוב ◀" button (the next Friday's registration, live); below 1024px wordmark + CTA + "תפריט". Under it, the 4px
// reading-progress stripe.
// Each section button is a disclosure (aria-expanded/aria-controls) for a panel that lists "הכל על <section>" (the hub)
// and the section's pages with a one-line description; nav.js opens it on click (Enter/Space), closes it on Esc (focus
// back to the button), on a click outside and when focus leaves it. Without JS a focused button shows its panel (CSS).
// The phone menu is a native <dialog> (modal, Esc, inert page; nav.js adds aria-expanded, the focus trap and return)
// with the same four groups and the CTA pinned at its foot.
import { html } from '../lib/html.mjs';
import { HEADER_CTA } from '../config.mjs';
import { sections } from '../lib/sections.mjs';

const cur = (on) => (on ? html` aria-current="page"` : '');

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

/** The dropdown arrow: the brand's triangle, pointing down (up while open). */
const caret = html`<span class="site-nav__caret" aria-hidden="true"></span>`;

export function header(ctx) {
  const secs = sections(ctx);
  return html`<header class="site-header" data-ground="navy" data-header>
  <div class="wrap site-header__bar">
    ${brandLink(ctx)}
    ${secs.length ? html`<nav class="site-nav" aria-label="${ctx.t('nav.label')}" data-site-nav>
      <ul class="site-nav__list" role="list">${secs.map((s) => html`<li class="site-nav__item" data-nav-item>
        <button class="site-nav__toggle" type="button" aria-expanded="false" aria-controls="nav-${s.id}"${s.current ? html` aria-current="true"` : ''} data-nav-toggle><span>${s.label}</span>${caret}</button>
        <div class="site-nav__panel" id="nav-${s.id}" data-nav-panel>
          <ul class="site-nav__menu" role="list">
            ${s.hub ? html`<li><a class="site-nav__link site-nav__link--hub" href="${s.hub.href}"${cur(s.hub.current)}><span class="site-nav__name">${s.all}</span>${ctx.brand.tri()}</a></li>` : ''}
            ${s.items.map((i) => html`<li><a class="site-nav__link" href="${i.href}"${cur(i.current)}><span class="site-nav__text"><span class="site-nav__name">${i.label}</span><span class="site-nav__desc">${i.desc}</span></span>${ctx.brand.tri()}</a></li>`)}
          </ul>
        </div>
      </li>`)}</ul>
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
    ${secs.map((s) => html`<div class="site-menu__group" data-menu-section="${s.id}">
      <div class="site-menu__head">
        <h2 class="site-menu__title" id="menu-${s.id}"${s.current ? html` data-current` : ''}>${s.label}</h2>
        ${s.hub ? html`<a class="site-menu__all" href="${s.hub.href}"${cur(s.hub.current)}>${s.all}${ctx.brand.tri()}</a>` : ''}
      </div>
      <ul class="site-menu__list" role="list" aria-labelledby="menu-${s.id}">
        ${s.items.map((i) => html`<li><a class="site-menu__link" href="${i.href}"${cur(i.current)}>${i.label}</a></li>`)}
      </ul>
    </div>`)}
  </nav>
  <div class="site-menu__cta"><div class="wrap">${ctaButton(ctx, 'btn--block')}</div></div>
</dialog>`;
}
