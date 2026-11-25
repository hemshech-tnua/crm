// The site footer (navy-deep): the name at full width, a line about the association, the four sections as four columns
// (config.mjs SECTIONS: the same grouping as the header and the phone menu; each title links to the section's hub page,
// every page is one step away), a row of ways to reach us (the live WhatsApp line, owner contact content, the language
// switch), the legal row.
import { html } from '../lib/html.mjs';
import { langSwitch } from './header.mjs';
import { sections } from '../lib/sections.mjs';

const cur = (on) => (on ? html` aria-current="page"` : '');

export function footer(ctx) {
  const { org } = ctx;
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
      ${sections(ctx).map((s) => html`<div class="site-footer__col" data-footer-section="${s.id}">
        <h2 class="site-footer__title" id="footer-${s.id}">${s.hub ? html`<a href="${s.hub.href}"${cur(s.hub.current)}>${s.label}${ctx.brand.tri()}</a>` : s.label}</h2>
        <ul class="site-footer__list" role="list" aria-labelledby="footer-${s.id}">${s.items.map((it) => html`<li><a href="${it.href}"${cur(it.current)}>${it.label}</a></li>`)}</ul>
      </div>`)}
    </nav>
    <dl class="site-footer__inst" aria-label="${ctx.t('footer.inst.label')}">
      ${ctx.slot(org.registrationNumber, ctx.t('slots.registration'), (n) => html`<div><dt>${ctx.t('footer.inst.registered')}</dt><dd>${legal('registration', { registrationNumber: n })}</dd></div>`)}
      <div><dt>${ctx.t('footer.inst.s46')}</dt><dd>${ctx.t(org.section46 ? 'footer.inst.s46Approved' : 'footer.inst.s46Pending')}</dd></div>
      ${(org.team ?? []).length ? html`<div><dt>${ctx.t('footer.inst.founders')}</dt><dd>${ctx.pageExists('team') ? html`<a href="${ctx.link('team')}">${org.team.map((m) => ctx.l(m.name)).join(ctx.lang === 'he' ? ' ו' : ' and ')}</a>` : org.team.map((m) => ctx.l(m.name)).join(', ')}</dd></div>` : ''}
    </dl>
    <ul class="site-footer__reach" role="list" aria-label="${ctx.t('footer.contactTitle')}">
      <li data-org-phone-item hidden><a href="${ctx.crm.home}" data-org-phone="whatsapp" data-org-text="${ctx.t('whatsapp.general')}" rel="noopener">${ctx.t('footer.whatsapp')}</a></li>
      <li data-org-phone-fallback><p>${ctx.t('footer.whatsappNoPhone')}</p></li>
      ${ctx.slot(org.email, ctx.t('slots.email'), (email) => html`<li><a href="mailto:${email}">${email}</a></li>`, { tag: 'li' })}
      ${ctx.slot(org.socials, ctx.t('slots.socials'), (list) => list.map((s) => html`<li><a href="${ctx.safeUrl(s.url)}" rel="noopener">${ctx.l(s.label) ?? ctx.t(`social.${s.network}`)}</a></li>`), { tag: 'li' })}
      <li>${langSwitch(ctx, 'lang-switch')}</li>
    </ul>
    <div class="site-footer__base">
      <p>${legal('copyright', { year: ctx.year })}</p>
      <a href="${ctx.crm.privacy}">${legal('privacy')}</a>
      ${ctx.pageExists('accessibility') ? html`<a href="${ctx.link('accessibility')}"${ctx.page.id === 'accessibility' ? html` aria-current="page"` : ''}>${legal('accessibility')}</a>` : ''}
      <a href="${ctx.crm.login}">${legal('staff')}</a>
    </div>
  </div>
</footer>`;
}
