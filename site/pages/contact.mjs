// Contact (יצירת קשר). One job: route every kind of question to the right channel in one step. WhatsApp and the phone are
// live (public_org_info); email, address, hours and social links are owner content and appear when they exist.
import { html } from '../lib/html.mjs';
import { C, pageHref, chapters, corner, own } from './_support.mjs';

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
  const routes = (g) => html`
<section class="${`${C.chapter} ct-routes`}" data-ground="${g}" id="routes" aria-labelledby="routes-h2">
  <div class="${`${C.wrap} ct-routes__grid`}">
    <h2 id="routes-h2" class="${`${C.chapterTitle} ct-routes__title`}" ${ctx.reveal('up')}>${t(k('routes.title'))}</h2>
    <ul class="rows ct-rows" role="list" data-reveal-group>
      ${routeItems.map((r) => {
        const inner = html`<span class="row__text"><b class="row__title">${r.title}</b><span class="row__body">${r.body}</span></span>`;
        return r.page
          ? html`<li data-reveal="up"><a class="row" href="${pageHref(ctx, r.page, 'contact')}">${inner}<span class="row__go">${r.cta}${ctx.brand.tri()}</span></a></li>`
          : html`<li data-reveal="up"><div class="row ct-row--static">${inner}</div></li>`;
      })}
      ${pressEmail
        ? html`<li data-reveal="up"><a class="row" href="${`mailto:${pressEmail}`}"><span class="row__text"><b class="row__title">${t(k('routes.press.title'))}</b><span class="row__body">${t(k('routes.press.body'))}</span></span><span class="row__go">${t(k('routes.press.cta'))}${ctx.brand.tri()}</span></a></li>`
        : ctx.slot(null, `${t(k('routes.press.title'))}: ${t(k('slots.press'))}`, () => '', { tag: 'li' })}
    </ul>
  </div>
</section>`;

  const channelsExist = ctx.preview || [email, org.address, org.hours, socials].some(has);
  const channels = (g) => html`
<section class="${`${C.chapter} ct-channels`}" data-ground="${g}" aria-labelledby="channels-h2">
  <div class="${C.wrap}">
    <h2 id="channels-h2" class="${C.chapterTitle}" ${ctx.reveal('up')}>${t(k('channels.title'))}</h2>
    <dl class="ct-channels__list" data-reveal-group>
      ${ctx.slot(email, t(k('slots.email')), (e) => html`<div data-reveal="up"><dt>${t(k('channels.email'))}</dt><dd><a class="${`${C.link} ${C.ltr}`}" href="${`mailto:${e}`}">${e}</a></dd></div>`)}
      ${ctx.slot(org.address, t(k('slots.address')), (a) => html`<div data-reveal="up"><dt>${t(k('channels.address'))}</dt><dd>${own(ctx, a)}</dd></div>`)}
      ${ctx.slot(org.hours, t(k('slots.hours')), (h) => html`<div data-reveal="up"><dt>${t(k('channels.hours'))}</dt><dd>${own(ctx, h)}</dd></div>`)}
      ${ctx.slot(
        socials,
        t(k('slots.socials')),
        (list) => html`<div data-reveal="up"><dt>${t(k('channels.socialTitle'))}</dt><dd><ul class="ct-social" role="list">${list.map(
          (s) => html`<li><a class="${C.link}" href="${ctx.safeUrl(s.url)}" rel="noopener">${s.label ? own(ctx, s.label) : (ctx.get(k('channels.networks'))?.[s.network] ?? s.network)}${ctx.brand.tri()}</a></li>`,
        )}</ul></dd></div>`,
      )}
    </dl>
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
