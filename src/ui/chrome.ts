import { useEffect, useSyncExternalStore } from 'react';

// The staff shell's phone chrome, shared between a page and StaffLayout without prop drilling.
// G1 (one fixed element at the bottom of a phone screen): a page with its own sticky bottom bar (a save bar) hides the
// tab bar while that bar is shown.

let hiders = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Hide the phone tab bar while this page shows its own bottom bar (e.g. a sticky "שמירה" bar on an edit page).
 * `on` may change (show the save bar only once the form is dirty, say). Wide screens are not affected (no tab bar there).
 *
 *   useHideTabBar(true);
 *   … <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">…</div>
 */
export function useHideTabBar(on = true) {
  useEffect(() => {
    if (!on) return;
    hiders += 1;
    emit();
    return () => {
      hiders -= 1;
      emit();
    };
  }, [on]);
}

/** True while some page asked to hide the tab bar (read by StaffLayout). */
export function useTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hiders > 0, () => false);
}
