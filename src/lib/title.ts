import { useEffect, useLayoutEffect } from 'react';

/** The site's name at the end of every browser-tab title. */
export const SITE_NAME = 'המשך תנועה';
/** The one separator between the parts of a title, on public and staff pages alike. */
export const TITLE_SEPARATOR = ' · ';

export type TitlePart = string | null | undefined | false;

/** ["יום שישי", "מפגשים"] → "יום שישי · מפגשים · המשך תנועה". Empty parts are left out. */
export function formatTitle(parts: TitlePart | TitlePart[]): string {
  return [...titleParts(parts), SITE_NAME].join(TITLE_SEPARATOR);
}
const titleParts = (parts: TitlePart | TitlePart[]) => (Array.isArray(parts) ? parts : [parts]).filter((p): p is string => !!p && !!p.trim());
/** null when there is nothing to name (still loading): the hooks then set nothing */
const titleKey = (parts: TitlePart | TitlePart[]) => (titleParts(parts).length ? formatTitle(parts) : null);

// Titles form a stack: the last page title set wins; when it goes, the one below shows again; with none, the section's
// title (useSectionTitle, set by the staff layout) or index.html's own default. So unmount order never leaves a stale title.
const stack: { title: string }[] = [];
let section: string | null = null;
const initial = typeof document === 'undefined' ? SITE_NAME : document.title;
function apply() {
  document.title = stack.length ? stack[stack.length - 1].title : section ?? initial;
}

/**
 * The browser tab's title: "[screen] · [section] · המשך תנועה" (most specific first, STYLE.md).
 * `null`/`undefined`/`false` (e.g. while the data loads) sets nothing (the section's title, or index.html's default,
 * shows). A page's useTitle wins over the staff layout's section title.
 *
 *   useTitle('מפגשי שישי')                               → "מפגשי שישי · המשך תנועה"
 *   useTitle(event.data && [event.data.title, 'מפגשים'])  → "<title> · מפגשים · המשך תנועה" (once loaded)
 */
export function useTitle(parts: TitlePart | TitlePart[]) {
  const key = titleKey(parts);
  useEffect(() => {
    if (!key) return;
    const entry = { title: key };
    stack.push(entry);
    apply();
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      apply();
    };
  }, [key]);
}

/** The staff layout's fallback title for the current section ("מפגשים · המשך תנועה"); pages refine it with useTitle. */
export function useSectionTitle(parts: TitlePart | TitlePart[]) {
  const key = titleKey(parts);
  useLayoutEffect(() => {
    section = key;
    apply();
    return () => {
      section = null;
      apply();
    };
  }, [key]);
}
