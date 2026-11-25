// The site's sections (config.mjs SECTIONS) resolved for one page: what the header dropdowns, the phone menu, the
// footer columns, the breadcrumb and the hub pages show. Pages that are not in this build are skipped, so every list
// only ever links to pages that exist. Labels: sections.<id>.label (the section), nav.<page> (a page), one-line
// descriptions: sections.desc.<page> (the page's meta description, shortened).
import { SECTIONS, NAV } from '../config.mjs';

/** The section a page belongs to (as its hub or as one of its pages), or null (home, accessibility, 404). */
export function sectionOf(pageId) {
  return SECTIONS.find((s) => s.hub === pageId || s.pages.includes(pageId)) ?? null;
}

/** One section for this page: { id, label, all, lead, hub: { href, current } | null, items: [{ id, href, label, desc, current }], current }. */
export function resolveSection(ctx, s) {
  const here = ctx.page.id;
  const items = s.pages
    .filter((id) => ctx.pageExists(id))
    .map((id) => ({ id, href: ctx.link(id), label: ctx.t(`nav.${id}`), desc: ctx.t(`sections.desc.${id}`), current: here === id }));
  const hub = ctx.pageExists(s.hub) ? { href: ctx.link(s.hub), current: here === s.hub } : null;
  return {
    id: s.id,
    label: ctx.t(`sections.${s.id}.label`),
    all: ctx.t(`sections.${s.id}.all`),
    lead: ctx.t(`sections.${s.id}.lead`),
    hub,
    items,
    current: here === s.hub || s.pages.includes(here),
  };
}

/** Every section that has at least one page in this build, in config order. */
export function sections(ctx) {
  return SECTIONS.map((s) => resolveSection(ctx, s)).filter((s) => s.items.length);
}

/** The header and phone menu: the six NAV pages that are in this build, { id, href, label, current }. A page counts as
 * current also when the visitor is on one of its section's sub-pages (e.g. Friday → מפגשים). */
export function topNav(ctx) {
  const here = ctx.page.id;
  const sec = sectionOf(here);
  return NAV.filter((id) => ctx.pageExists(id)).map((id) => ({
    id,
    href: ctx.link(id),
    label: ctx.t(`top.${id}`),
    current: here === id,
    within: here !== id && !!sec && sec.hub === id && !NAV.includes(here),
  }));
}
