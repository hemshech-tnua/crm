// Contact (יצירת קשר). One job: route every kind of question to the right channel in one step. WhatsApp and the phone are
// live (public_org_info); email, address, hours and social links are owner content and appear when they exist.
import { html } from '../lib/html.mjs';
import { C, pageHref, chapters, corner, own, linkRow } from './_support.mjs';

export const slug = { he: 'contact', en: 'contact' };
export const bodyClass = 'no-cta-bar';

const k = (key) => `contact.${key}`;

export function render(ctx) {
  const { t, org } = ctx;
  const has = ctx.has;
  const email = org.email || '';
  const pressEmail = org.pressEmail || email;
  const socials = (org.socials ?? []).filter((s) => s?.url);

  const hero = (g) => html`
<section class="${`${C.chapter} ct-hero`}" data-ground="${g}" aria-labelledby="contact-h1">
  ${corner(ctx, 'be', { dir: 'rise' })}
  <div class="${`${C.wrap} ct-hero__grid`}">
    <div>
      <h1 id="contact-h1" class="${C.display}">${t(k('hero.title'))}</h1>
      <p class="${`${C.lead} ct-hero__lead`}">${t(k('hero.body'))}</p>
    </div>
    <div class="ct-primary">
      <div class="ct-primary__live">
        ${ctx.whatsapp(html`<span>${t(k('primary.cta'))}</span>${ctx.brand.tri()}`, { className: `${C.btn} ct-primary__wa`, text: t(k('primary.message')) })}
        <p class="ct-primary__phone" data-org-phone-item hidden>
          <span>${t(k('primary.phoneLabel'))}</span>
          <a class="${`${C.link} ${C.ltr}`}" href="${pageHref(ctx, 'contact')}" data-org-phone="tel" hidden><span data-org-phone="text"></span></a>
        </p>
      </div>
      <p class="${`${C.quiet} ct-primary__none`}">${t(k('primary.noPhone'))}</p>
    </div>
  </div>
</section>`;

  const routeItems = ctx.list(k('routes.items'));
  /** A route goes to a page of the site, or to one answer on the FAQ page (`faq: 'cancel'` → …/faq/#faq-cancel). */
  const routeHref = (r) => (r.faq && ctx.pageExists('faq') ? `${ctx.link('faq')}#faq-${r.faq}` : pageHref(ctx, r.page || 'faq', 'contact'));
  const routes = (g) => html`
<section class="${`${C.chapter} ct-routes`}" data-ground="${g}" id="routes" aria-labelledby="routes-h2">
  <div class="${`${C.wrap} ct-routes__grid`}">
    <h2 id="routes-h2" class="${`${C.chapterTitle} ct-routes__title`}" ${ctx.reveal('up')}>${t(k('routes.title'))}</h2>
    ${ctx.ui.rows(
      [
        ...routeItems.map((r) => linkRow(ctx, { title: r.title, body: r.body, label: r.cta, href: routeHref(r) })),
        ...(pressEmail ? [linkRow(ctx, { title: t(k('routes.press.title')), body: t(k('routes.press.body')), label: t(k('routes.press.cta')), href: `mailto:${pressEmail}` })] : []),
      ],
      { className: 'ct-rows' },
    )}
    ${pressEmail ? '' : ctx.slot(null, `${t(k('routes.press.title'))}: ${t(k('slots.press'))}`, () => '', { className: 'ct-slot' })}
  </div>
</section>`;

  const channelsExist = ctx.preview || [email, org.address, org.hours, socials].some(has);
  // present channels as <dt>/<dd> pairs; missing ones (preview only) as owner boxes outside the list (a <dl> may hold
  // nothing else)
  const channelDefs = [
    [email, 'email', (e) => html`<div data-reveal="up"><dt>${t(k('channels.email'))}</dt><dd><a class="${`${C.link} ${C.ltr}`}" href="${`mailto:${e}`}">${e}</a></dd></div>`],
    [org.address, 'address', (a) => html`<div data-reveal="up"><dt>${t(k('channels.address'))}</dt><dd>${own(ctx, a)}</dd></div>`],
    [org.hours, 'hours', (h) => html`<div data-reveal="up"><dt>${t(k('channels.hours'))}</dt><dd>${own(ctx, h)}</dd></div>`],
    [socials, 'socials', (list) => html`<div data-reveal="up"><dt>${t(k('channels.socialTitle'))}</dt><dd><ul class="ct-social" role="list">${list.map(
      (s) => html`<li><a class="${C.link}" href="${ctx.safeUrl(s.url)}" rel="noopener">${s.label ? own(ctx, s.label) : (ctx.get(k('channels.networks'))?.[s.network] ?? s.network)}${ctx.brand.tri()}</a></li>`,
    )}</ul></dd></div>`],
  ];
  const channelItems = channelDefs.filter(([v]) => has(v)).map(([v, , render]) => render(v));
  const channelSlots = channelDefs.filter(([v]) => !has(v)).map(([, key]) => ctx.slot(null, t(k(`slots.${key}`)), () => ''));
  const channels = (g) => html`
<section class="${`${C.chapter} ct-channels`}" data-ground="${g}" aria-labelledby="channels-h2">
  <div class="${C.wrap}">
    <h2 id="channels-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('channels.title'))}</h2>
    ${channelItems.length ? html`<dl class="ct-channels__list" data-reveal-group>${channelItems}</dl>` : ''}
    ${channelSlots.length ? html`<div class="ct-channels__list ct-channels__slots">${channelSlots}</div>` : ''}
  </div>
</section>`;

  const faq = (g) => html`
<section class="${`${C.chapter} ct-faq`}" data-ground="${g}" aria-labelledby="faq-h2">
  <div class="${`${C.wrap} ct-faq__grid`}">
    <h2 id="faq-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('faq.title'))}</h2>
    <p ${ctx.reveal('up', 1)}><a class="${C.btn}" href="${pageHref(ctx, 'faq')}"><span>${t(k('faq.cta'))}</span>${ctx.brand.tri()}</a></p>
  </div>
</section>`;

  return html`${chapters(
    [
      { render: hero },
      { render: routes },
      { when: channelsExist, render: channels },
      { when: ctx.pageExists('faq'), render: faq },
    ],
    ['navy', 'beige', 'navy', 'beige-light'],
  )}`;
}
