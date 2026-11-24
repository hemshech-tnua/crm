// Membership — "הצטרפות לעמותה". One job: say what membership is (only as far as the facts go) and hand off to the
// existing CRM form (#/member), which is where joining happens. One action, repeated: "להצטרפות לעמותה".
import { html } from '../lib/html.mjs';
import { tx, action, pageHref, corner, H1 } from './_g.mjs';

export const slug = { he: 'membership', en: 'membership' };

export function render(ctx) {
  const { t, org } = ctx;
  const join = (className = 'btn') =>
    action(ctx, { href: ctx.crm.member, label: t('membership.cta'), className, external: true, hint: t('membership.ctaHint') });

  return html`
<section class="chapter member-hero" data-ground="beige" aria-labelledby="member-h1">
  ${corner(ctx, { pos: 'te', accent: true })}
  <div class="wrap member-hero__grid">
    <div class="member-hero__text">
      <h1 id="member-h1" class="${H1} member-hero__title" data-load>${t('membership.hero.title')}</h1>
      <p class="t-lead" data-load="1">${tx(ctx, 'membership.hero.body')}</p>
      <div class="member-hero__action" data-load="2">
        ${join()}
        <p class="t-small quiet">${t('membership.hero.note')}</p>
      </div>
    </div>
    <div class="member-benefits" data-load="3">
      <h2 class="member-benefits__title">${t('membership.benefits.title')}</h2>
      ${ctx.ui.triList(ctx.list('membership.benefits.items'), { className: 'member-benefits__list' })}
      ${ctx.slot(
        org.membershipFee,
        t('membership.slots.fee'),
        (fee) => html`<div class="member-fee"><h3 class="t-small">${t('membership.fee.title')}</h3><p>${ctx.l(fee)}</p></div>`,
      )}
    </div>
  </div>
</section>

<section class="chapter member-how" data-ground="navy" aria-labelledby="member-how">
  <div class="wrap member-how__grid">
    <div class="member-how__text">
      <h2 id="member-how" class="t-chapter" ${ctx.reveal('up')}>${t('membership.how.title')}</h2>
      ${ctx.ui.timeline(ctx.list('membership.how.steps'), { className: 'member-steps' })}
      <div class="member-how__action" ${ctx.reveal('up')}>
        ${join()}
        <p class="t-small quiet">${t('membership.how.privacy')}</p>
      </div>
    </div>
    <figure class="photo r-45 focus-70 member-how__photo" ${ctx.reveal('fade')}>
      ${ctx.img('bonfire', { alt: '', sizes: '(min-width: 64rem) 40vw, 100vw' })}
    </figure>
  </div>
</section>

<section class="chapter chapter--tight member-also" data-ground="beige-light" aria-labelledby="member-also">
  <div class="wrap member-also__grid">
    <h2 id="member-also" class="t-title" ${ctx.reveal('up')}>${t('membership.also.title')}</h2>
    <ul class="member-also__list" role="list" data-reveal-group>
      ${ctx.list('membership.also.items').map((it) => {
        const href = it.page === 'calendar' ? ctx.ctaHref : pageHref(ctx, it.page);
        return href ? html`<li data-reveal="up">${action(ctx, { href, label: it.label, className: 'member-also__link' })}</li>` : '';
      })}
    </ul>
  </div>
</section>`;
}
