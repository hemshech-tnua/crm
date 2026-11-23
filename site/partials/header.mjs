// The site header (sticky, navy): the mark + typeset wordmark, six plain links (≥1200px), the language switch and the
// persistent "להרשמה למפגש ◀" button; below 1200px wordmark + CTA + "תפריט". Under it, the 4px reading-progress stripe.
// The phone menu is a native <dialog> (modal, Esc, inert page; nav.js adds aria-expanded, the focus trap and return).
import { html } from '../lib/html.mjs';
import { NAV, CTA_PAGE } from '../config.mjs';

/** Nav entries for the pages of `ids` that are in this build (a page waiting for owner content is skipped). */
export function navItems(ctx, ids) {
  const longer = ctx.get('nav.menuNames') ?? {};
  return ids.filter((id) => ctx.pageExists(id)).map((id) => ({ id, href: ctx.link(id), label: ctx.t(`nav.${id}`), menuLabel: longer[id] || ctx.t(`nav.${id}`), current: ctx.page.id === id }));
}

const cur = (on) => (on ? html` aria-current="page"` : '');

export function langSwitch(ctx, cls = 'lang-switch', { short = false } = {}) {
  const other = ctx.otherLang;
  const label = short ? ctx.t('nav.switchShort') : ctx.t('nav.switchTo');
  return html`<a class="${cls}" href="${ctx.page.otherUrl}" hreflang="${other}" lang="${other}">${label}</a>`;
}

export function brandLink(ctx) {
  return html`<a class="brand" href="${ctx.link('home')}" aria-label="${ctx.t('nav.homeLabel')}">${ctx.brand.logo({ variant: 'symbol' })}<span class="brand__name"${ctx.lang === 'he' ? '' : html` lang="he"`}>${ctx.t('site.name')}</span></a>`;
}

export function ctaButton(ctx, cls = '') {
  return html`<a class="btn ${cls}" href="${ctx.ctaHref}"${cur(ctx.page.id === CTA_PAGE)}><span class="cta-long">${ctx.t('cta.register')}</span><span class="cta-short" aria-hidden="true">${ctx.t('cta.registerShort')}</span>${ctx.brand.tri()}</a>`;
}

export function header(ctx) {
  const primary = navItems(ctx, NAV.primary);
  const secondary = navItems(ctx, NAV.secondary);
  return html`<header class="site-header" data-ground="navy" data-header>
  <div class="wrap site-header__bar">
    ${brandLink(ctx)}
    ${primary.length ? html`<nav class="site-nav" aria-label="${ctx.t('nav.label')}">
      <ul class="site-nav__list" role="list">${primary.map((i) => html`<li><a class="site-nav__link" href="${i.href}"${cur(i.current)}>${i.label}</a></li>`)}</ul>
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
    <button class="menu-close" type="button" data-menu-close><span>${ctx.t('nav.close')}</span><span class="menu-close__icon" aria-hidden="true"></span></button>
  </div>
  <nav class="wrap site-menu__nav" aria-label="${ctx.t('nav.menuLabel')}">
    <ul class="site-menu__list site-menu__list--primary" role="list">
      ${primary.map((i) => html`<li><a class="site-menu__link" href="${i.href}"${cur(i.current)}><span>${i.menuLabel}</span>${ctx.brand.tri()}</a></li>`)}
    </ul>
    ${secondary.length ? html`<ul class="site-menu__list site-menu__list--secondary" role="list" aria-label="${ctx.t('nav.secondaryLabel')}">${secondary.map((i) => html`<li><a class="site-menu__link" href="${i.href}"${cur(i.current)}>${i.menuLabel}</a></li>`)}</ul>` : ''}
    <div class="site-menu__extra">
      <a href="${ctx.crm.home}" data-org-phone="whatsapp" data-org-text="${ctx.t('whatsapp.general')}" rel="noopener" hidden>${ctx.t('footer.whatsapp')}</a>
      ${langSwitch(ctx, 'lang-switch')}
    </div>
  </nav>
  <div class="site-menu__cta"><div class="wrap">${ctaButton(ctx, 'btn--block')}</div></div>
</dialog>`;
}
