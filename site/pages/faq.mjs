// FAQ — "שאלות ותשובות". One job: answer what stops people from coming or giving, with the approved answers (the CRM's
// public Friday FAQ + Team A's questions about the association). Native <details> accordion, grouped; a topic index
// that follows the reading position (sticky beside the questions from 1024px). Quiet page: reveals only.
import { html } from '../lib/html.mjs';
import { txs, plain, action, waAction, pageHref } from './_g.mjs';

export const slug = { he: 'faq', en: 'faq' };

/** The answer's follow-up link: a page of this site (when it exists in the build) or a CRM page. */
function answerLink(ctx, link) {
  if (!link) return null;
  const href = link.page ? pageHref(ctx, link.page) : link.crm ? ctx.crm[link.crm] : null;
  if (!href) return null;
  return { href, label: link.label, external: !!link.crm };
}

const groupsOf = (ctx) => ctx.list('faq.groups');

export function render(ctx) {
  const { t } = ctx;
  const groups = groupsOf(ctx)
    .map((g) => ({ ...g, items: g.items.filter((it) => ctx.has(it.a) || ctx.preview) }))
    .filter((g) => g.items.length);

  return html`
<section class="chapter faq-hero" data-ground="navy" aria-labelledby="faq-h1">
  <div class="wrap faq-hero__grid">
    <div class="stack">
      <h1 id="faq-h1" class="faq-hero__title" ${ctx.reveal('up')}>${t('faq.hero.title')}</h1>
      <p class="t-lead" ${ctx.reveal('up', 1)}>${t('faq.hero.body')}</p>
    </div>
    <nav class="faq-topics" aria-labelledby="faq-topics-h" ${ctx.reveal('up', 2)}>
      <h2 id="faq-topics-h" class="faq-topics__title">${t('faq.hero.indexLabel')}</h2>
      <ul role="list">
        ${groups.map((g) => html`<li><a class="faq-topics__link" href="#faq-${g.id}"><span>${g.title}</span></a></li>`)}
      </ul>
    </nav>
  </div>
</section>

<section class="chapter faq-body" data-ground="beige-light">
  <div class="wrap faq-groups">
      ${groups.map(
        (g) => html`
      <section class="faq-group" id="faq-${g.id}" aria-labelledby="faq-${g.id}-h">
        <h2 id="faq-${g.id}-h" class="faq-group__title">${g.title}</h2>
        <div class="faq faq__items">
          ${g.items.map((it) => {
            const link = answerLink(ctx, it.link);
            return html`<details>
            <summary><span>${txs(ctx, it.q)}</span></summary>
            <div class="faq__answer">
              ${ctx.has(it.a)
                ? html`<p>${txs(ctx, it.a)}</p>${link ? html`<p>${action(ctx, { href: link.href, label: link.label, className: 'link', external: link.external, hint: link.external ? t('faq.closing.newSystem') : null })}</p>` : ''}`
                : ctx.slot(null, it.slot ?? it.q, () => '')}
            </div>
          </details>`;
          })}
        </div>
      </section>`,
      )}
  </div>
</section>

<section class="chapter faq-closing" data-ground="navy" aria-labelledby="faq-closing">
  <div class="wrap cta-band">
    <div class="stack" ${ctx.reveal('up')}>
      <h2 id="faq-closing" class="cta-band__title">${t('faq.closing.title')}</h2>
      <p class="cta-band__body">${t('faq.closing.body')}</p>
    </div>
    <div class="cluster cta-band__actions" ${ctx.reveal('up', 1)}>
      ${waAction(ctx, { label: t('faq.closing.whatsapp') })}
      ${action(ctx, { href: ctx.ctaHref, label: t('faq.closing.register'), className: 'btn btn--ghost' })}
      ${action(ctx, { href: pageHref(ctx, 'contact'), label: t('faq.closing.contact'), className: 'link' })}
    </div>
  </div>
</section>`;
}

/** FAQPage structured data from the answered questions (owner-pending ones are left out). */
export function jsonld(ctx) {
  const items = groupsOf(ctx).flatMap((g) => g.items).filter((it) => ctx.has(it.a));
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: ctx.lang,
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: plain(it.q),
      acceptedAnswer: { '@type': 'Answer', text: plain(it.a) },
    })),
  };
}

