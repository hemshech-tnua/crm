// The site footer (navy-deep): the name at full width, a line about the association, four link groups (every page one
// step away; a page appears once it exists), the live WhatsApp line, owner contact content, the legal row.
import { html } from '../lib/html.mjs';
import { langSwitch } from './header.mjs';

export function footer(ctx) {
  const { org } = ctx;
  const columns = ctx.list('footer.columns').map((c) => ({
    title: c.title,
    items: c.items
      .map((it) => {
        if (it.crm) return ctx.crm[it.crm] ? { href: ctx.crm[it.crm], label: it.label } : null;
        if (!ctx.pageExists(it.page)) return null;
        return { href: ctx.link(it.page), label: it.label, current: ctx.page.id === it.page };
      })
      .filter(Boolean),
  })).filter((c) => c.items.length);
  const legal = (k, vars) => ctx.t(`footer.legal.${k}`, vars);
  return html`<footer class="site-footer" data-ground="navy-deep">
  ${ctx.ui.corner({ pos: 'te', tone: 'navy-800' })}
  <div class="wrap">
    <p class="site-footer__name" aria-hidden="true"${ctx.lang === 'he' ? '' : html` lang="he"`}>${ctx.t('site.name')}</p>
    <div class="site-footer__intro">
      <p class="site-footer__slogan">${ctx.t('footer.slogan')}</p>
      <p>${ctx.t('footer.about')}</p>
    </div>
    <nav class="site-footer__nav" aria-label="${ctx.t('nav.footerLabel')}">
      ${columns.map((c, i) => html`<div class="site-footer__col">
        <h2 class="site-footer__title" id="footer-col-${i}">${c.title}</h2>
        <ul class="site-footer__list" role="list" aria-labelledby="footer-col-${i}">${c.items.map((it) => html`<li><a href="${it.href}"${it.current ? html` aria-current="page"` : ''}>${it.label}</a></li>`)}</ul>
      </div>`)}
      <div class="site-footer__col">
        <h2 class="site-footer__title" id="footer-contact">${ctx.t('footer.contactTitle')}</h2>
        <ul class="site-footer__list" role="list" aria-labelledby="footer-contact">
          <li data-org-phone-item hidden><a href="${ctx.crm.home}" data-org-phone="whatsapp" data-org-text="${ctx.t('whatsapp.general')}" rel="noopener">${ctx.t('footer.whatsapp')}</a></li>
          <li data-org-phone-fallback><p>${ctx.t('footer.whatsappNoPhone')}</p></li>
          ${ctx.pageExists('contact') ? html`<li><a href="${ctx.link('contact')}"${ctx.page.id === 'contact' ? html` aria-current="page"` : ''}>${ctx.t('nav.contact')}</a></li>` : ''}
          ${ctx.slot(org.email, ctx.t('slots.email'), (email) => html`<li><a href="mailto:${email}">${email}</a></li>`, { tag: 'li' })}
          ${ctx.slot(org.socials, ctx.t('slots.socials'), (list) => list.map((s) => html`<li><a href="${ctx.safeUrl(s.url)}" rel="noopener">${ctx.l(s.label) ?? ctx.t(`social.${s.network}`)}</a></li>`), { tag: 'li' })}
          <li>${langSwitch(ctx, 'lang-switch')}</li>
        </ul>
      </div>
    </nav>
    <div class="site-footer__base">
      <p>${legal('copyright', { year: ctx.year })}</p>
      ${ctx.slot(org.registrationNumber, ctx.t('slots.registration'), (n) => html`<p>${legal('registration', { registrationNumber: n })}</p>`, { tag: 'span' })}
      <a href="${ctx.crm.privacy}">${legal('privacy')}</a>
      ${ctx.pageExists('accessibility') ? html`<a href="${ctx.link('accessibility')}"${ctx.page.id === 'accessibility' ? html` aria-current="page"` : ''}>${legal('accessibility')}</a>` : ''}
      <a href="${ctx.crm.login}">${legal('staff')}</a>
    </div>
  </div>
</footer>`;
}
