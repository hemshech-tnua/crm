import { useEffect, useState } from 'react';

const PHONE = '(max-width: 767px)';
/** Is this element a text field (one that opens the on-screen keyboard)? */
export const isField = (el: EventTarget | Element | null) =>
  !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type)) || (el instanceof HTMLElement && el.isContentEditable));

/**
 * True on a phone while a text field has the focus, i.e. while the on-screen keyboard is (about to be) open. Screens use
 * it to fold away what is not needed while typing (a tall header) so the results stay above the keyboard. Always false
 * on a wide screen. Caution: it turns false the moment a tap moves the focus to a button, so unfolding something ABOVE
 * the tapped row would shift the row under the finger; fold things above the field only when that is harmless, or
 * keep them folded until the field is cleared.
 */
export function useTypingOnPhone(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    let t: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (t) clearTimeout(t);
      // focus moves field → field through the body for a moment: settle before folding back
      t = setTimeout(() => setTyping(mq.matches && isField(document.activeElement)), 60);
    };
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    mq.addEventListener('change', check);
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
      mq.removeEventListener('change', check);
    };
  }, []);
  return typing;
}

/**
 * The page's own top: where the screen's content starts below the phone app bar. In door mode on a phone the app bar
 * scrolls away when the search is used, so "back to the top" for the results should stop here, not at 0 (which would
 * bring the bar back above the keyboard). On a wide screen this is 0.
 */
export function contentTop(): number {
  const main = document.getElementById('main');
  return main && window.matchMedia(PHONE).matches ? main.offsetTop : 0;
}
/** Scroll the window to contentTop() when it is below it (results start right under the sticky header). */
export function scrollToContentTop(): void {
  const top = contentTop();
  if (window.scrollY > top) window.scrollTo({ top });
}
