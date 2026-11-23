// The site footer: every page, contact (WhatsApp from the live org phone; owner content when it exists), CRM links.
import { html } from '../lib/html.mjs';
import { NAV } from '../config.mjs';
import { navItems, langSwitch } from './header.mjs';

export function footer(ctx) {
  const pages = navItems(ctx, [...NAV.primary, ...NAV.secondary]);
  const { org } = ctx;
  return html`<footer class="site-footer">
  <div class="site-footer__inner">
    <div class="site-footer__brand">
      ${ctx.brand.logo({ variant: 'symbol', className: 'site-footer__mark' })}
      <p class="site-footer__name">${ctx.t('site.name')}</p>
    </div>
    ${pages.length ? html`<nav class="site-footer__col" aria-label="${ctx.t('nav.footerLabel')}">
      <h2 class="site-footer__title">${ctx.t('footer.pagesTitle')}</h2>
      <ul class="site-footer__list" role="list">${pages.map((p) => html`<li><a href="${p.href}"${p.current ? html` aria-current="page"` : ''}>${p.label}</a></li>`)}</ul>
    </nav>` : ''}
    <section class="site-footer__col" aria-labelledby="footer-contact">
      <h2 class="site-footer__title" id="footer-contact">${ctx.t('footer.contactTitle')}</h2>
      <ul class="site-footer__list" role="list">
        <li data-org-phone-item hidden><a href="${ctx.crm.home}" data-org-phone="whatsapp" rel="noopener">${ctx.t('footer.whatsapp')}</a></li>
        ${ctx.slot(org.email, ctx.t('slots.email'), (email) => html`<li><a href="mailto:${email}">${email}</a></li>`, { tag: 'li' })}
        ${ctx.slot(org.address, ctx.t('slots.address'), (a) => html`<li>${ctx.l(a)}</li>`, { tag: 'li' })}
        ${ctx.slot(org.socials, ctx.t('slots.socials'), (list) => list.map((s) => html`<li><a href="${ctx.safeUrl(s.url)}" rel="noopener">${ctx.l(s.label ?? s.network)}</a></li>`), { tag: 'li' })}
      </ul>
    </section>
    <section class="site-footer__col" aria-labelledby="footer-system">
      <h2 class="site-footer__title" id="footer-system">${ctx.t('footer.systemTitle')}</h2>
      <ul class="site-footer__list" role="list">
        <li><a href="${ctx.ctaHref}">${ctx.t('cta.register')}</a></li>
        <li><a href="${ctx.crm.join}">${ctx.t('footer.propose')}</a></li>
        <li><a href="${ctx.crm.member}">${ctx.t('footer.member')}</a></li>
        <li><a href="${ctx.crm.privacy}">${ctx.t('footer.privacy')}</a></li>
      </ul>
    </section>
  </div>
  <div class="site-footer__bottom">
    <p>© ${ctx.year} ${ctx.t('site.name')}. ${ctx.t('footer.rights')}.</p>
    ${langSwitch(ctx)}
  </div>
</footer>`;
}
