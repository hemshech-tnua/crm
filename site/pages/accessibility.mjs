// Accessibility statement — "הצהרת נגישות" (Israeli Equal Rights for Persons with Disabilities regulations, service
// accessibility, reg. 35). Read mode: one reading chapter with a sticky table of contents from 1024px. The structure
// follows the required parts: the standard, what was done, how it was checked, what is not yet accessible, the
// accessibility of the places where the service is given, the coordinator's contact details and the update date.
// Owner fields come from content/org.json → accessibility: { coordinator: { name:{he,en}, phone, email },
// audit: { date, by:{he,en} }, venues:{he,en}, updated }. Preview builds show dashed boxes where they are missing.
import { html } from '../lib/html.mjs';
import { waAction, action, pageHref } from './_g.mjs';

export const slug = { he: 'accessibility', en: 'accessibility' };

const fmtDate = (ctx, iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat(ctx.meta.intl, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(d);
};

export function render(ctx) {
  const { t, org } = ctx;
  const a = org.accessibility ?? {};
  const c = a.coordinator ?? {};
  const hasCoordinator = ctx.has(c.name) && (ctx.has(c.phone) || ctx.has(c.email));

  const sections = [
    {
      id: 'standard',
      body: html`<p>${t('accessibility.standard.body')}</p>
        ${ctx.slot(a.audit?.date, t('accessibility.slots.audit'), (date) => html`<p class="quiet">${t('accessibility.standard.auditLabel', { date: fmtDate(ctx, date), by: ctx.l(a.audit.by) ?? '' }).replace(/,\s*$/, '')}</p>`)}`,
    },
    {
      id: 'features',
      body: html`<ul class="tri-list a11y-list" role="list">${ctx.list('accessibility.features.items').map((x) => html`<li>${ctx.brand.tri()}<span>${x}</span></li>`)}</ul>`,
    },
    { id: 'testing', body: html`<p>${t('accessibility.testing.body')}</p>` },
    {
      id: 'limits',
      body: html`<ul class="tri-list a11y-list" role="list">${ctx.list('accessibility.limits.items').map((x) => html`<li>${ctx.brand.tri()}<span>${x}</span></li>`)}</ul>`,
    },
    ctx.has(a.venues) || ctx.preview
      ? { id: 'venues', body: ctx.slot(a.venues, t('accessibility.slots.venues'), (v) => String(ctx.l(v)).split(/\n+/).map((p) => html`<p>${p}</p>`)) }
      : null,
    {
      id: 'contact',
      body: html`<p>${t('accessibility.contact.body')}</p>
        ${ctx.slot(
          hasCoordinator ? c : null,
          t('accessibility.slots.coordinator'),
          () => html`<div class="a11y-coordinator">
            <h3 class="t-small quiet">${t('accessibility.contact.coordinatorTitle')}</h3>
            <p class="a11y-coordinator__name">${ctx.l(c.name)}</p>
            <dl>
              ${ctx.has(c.phone) ? html`<div><dt>${t('accessibility.contact.phone')}</dt><dd><a class="ltr" href="tel:${String(c.phone).replace(/[^\d+]/g, '')}">${c.phone}</a></dd></div>` : ''}
              ${ctx.has(c.email) ? html`<div><dt>${t('accessibility.contact.email')}</dt><dd><a class="ltr" href="mailto:${c.email}">${c.email}</a></dd></div>` : ''}
            </dl>
          </div>`,
        )}
        <h3 class="t-small a11y-tips__title">${t('accessibility.contact.tipsTitle')}</h3>
        <ul class="tri-list a11y-list a11y-list--plain" role="list">${ctx.list('accessibility.contact.tips').map((x) => html`<li>${ctx.brand.tri()}<span>${x}</span></li>`)}</ul>
        <div class="cluster a11y-actions">
          ${waAction(ctx, { label: t('accessibility.contact.whatsapp') })}
          ${action(ctx, { href: pageHref(ctx, 'contact'), label: t('accessibility.contact.contactPage'), className: 'link' })}
        </div>`,
    },
  ].filter(Boolean);

  return html`
<section class="chapter chapter--tight a11y-hero" data-ground="navy" aria-labelledby="a11y-h1">
  <div class="wrap a11y-hero__grid">
    <h1 id="a11y-h1" class="a11y-hero__title">${t('accessibility.title')}</h1>
    <div class="stack a11y-hero__text">
      <p class="t-lead">${t('accessibility.intro')}</p>
      ${ctx.slot(a.updated, t('accessibility.slots.updated'), (d) => html`<p class="t-small quiet">${t('accessibility.updatedLabel', { date: fmtDate(ctx, d) })}</p>`)}
    </div>
  </div>
</section>

<section class="chapter a11y-body" data-ground="beige-light" aria-label="${t('accessibility.title')}">
  <div class="wrap a11y-body__grid" data-chapters>
    <nav class="a11y-toc" aria-label="${t('accessibility.tocLabel')}">
      <p class="a11y-toc__title" aria-hidden="true">${t('accessibility.tocLabel')}</p>
      <ul role="list">
        ${sections.map((s) => html`<li><a href="#a11y-${s.id}" data-chapter-link>${t(`accessibility.${s.id}.title`)}</a></li>`)}
      </ul>
    </nav>
    <div class="a11y-sections">
      ${sections.map(
        (s) => html`<section class="a11y-section" id="a11y-${s.id}" data-chapter aria-labelledby="a11y-${s.id}-h">
        <h2 id="a11y-${s.id}-h" class="a11y-section__title">${t(`accessibility.${s.id}.title`)}</h2>
        <div class="a11y-section__body">${s.body}</div>
      </section>`,
      )}
    </div>
  </div>
</section>`;
}
