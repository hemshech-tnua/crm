// The site header: brand, short primary nav, language switch, the persistent "להרשמה למפגש" button and the menu
// button; plus the mobile menu (a native <dialog>: focus trap, Esc and inert background come from the browser).
import { html } from '../lib/html.mjs';
import { NAV, CTA_PAGE } from '../config.mjs';

export function navItems(ctx, ids) {
  return ids.filter((id) => ctx.pageExists(id)).map((id) => ({ id, href: ctx.link(id), label: ctx.t(`nav.${id}`), current: ctx.page.id === id }));
}

const navLink = (item, cls) =>
  html`<li><a class="${cls}" href="${item.href}"${item.current ? html` aria-current="page"` : ''}>${item.label}</a></li>`;

export function langSwitch(ctx, cls = 'lang-switch') {
  const other = ctx.otherLang;
  return html`<a class="${cls}" href="${ctx.page.otherUrl}" hreflang="${other}" lang="${other}">${ctx.t('nav.switchTo')}</a>`;
}

export function ctaButton(ctx, cls = '') {
  return html`<a class="btn btn--cta ${cls}" href="${ctx.ctaHref}"${ctx.page.id === CTA_PAGE ? html` aria-current="page"` : ''}><span>${ctx.t('cta.register')}</span>${ctx.brand.tri()}</a>`;
}

export function header(ctx) {
  const primary = navItems(ctx, NAV.primary);
  const secondary = navItems(ctx, NAV.secondary);
  return html`<header class="site-header" data-header>
  <div class="site-header__bar">
    <a class="site-header__brand" href="${ctx.link('home')}" aria-label="${ctx.t('nav.homeLabel')}">${ctx.brand.logo({ variant: 'lockup', className: 'site-header__logo' })}</a>
    ${primary.length ? html`<nav class="site-nav" aria-label="${ctx.t('nav.label')}">
      <ul class="site-nav__list" role="list">${primary.map((i) => navLink(i, 'site-nav__link'))}</ul>
    </nav>` : ''}
    <div class="site-header__actions">
      ${langSwitch(ctx, 'lang-switch site-header__lang')}
      ${ctaButton(ctx, 'site-header__cta')}
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu" data-menu-open>
        <span class="menu-toggle__icon" aria-hidden="true"><span></span><span></span><span></span></span>
        <span class="menu-toggle__label">${ctx.t('nav.menu')}</span>
      </button>
    </div>
  </div>
  <div class="scroll-progress" data-progress aria-hidden="true"></div>
</header>
<dialog class="site-menu" id="site-menu" aria-label="${ctx.t('nav.menuLabel')}" data-menu>
  <div class="site-menu__inner">
    <div class="site-menu__top">
      <a class="site-header__brand" href="${ctx.link('home')}" aria-label="${ctx.t('nav.homeLabel')}">${ctx.brand.logo({ variant: 'lockup', className: 'site-header__logo' })}</a>
      <button class="menu-close" type="button" data-menu-close aria-label="${ctx.t('nav.close')}">
        <span class="menu-close__icon" aria-hidden="true"></span>
      </button>
    </div>
    <nav class="site-menu__nav" aria-label="${ctx.t('nav.menuLabel')}">
      <ul class="site-menu__list site-menu__list--primary" role="list">
        ${navLink({ href: ctx.link('home'), label: ctx.t('nav.home'), current: ctx.page.id === 'home' }, 'site-menu__link')}
        ${primary.map((i) => navLink(i, 'site-menu__link'))}
      </ul>
      ${secondary.length ? html`<ul class="site-menu__list site-menu__list--secondary" role="list">${secondary.map((i) => navLink(i, 'site-menu__link'))}</ul>` : ''}
    </nav>
    <div class="site-menu__actions">
      ${ctaButton(ctx, 'btn--block')}
      ${langSwitch(ctx, 'lang-switch site-menu__lang')}
    </div>
  </div>
</dialog>`;
}
