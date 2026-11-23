import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DISMISS, LEAVE_UNSAVED } from '@/lib/labels';
import { Button, cx } from './kit';
import { Icon } from './Icon';

export { DISMISS };

// ───────────── toasts ─────────────
//
// One toast at a time, one short line ("[thing] [past verb]", with the name). It stays ~4s (6s with an action such as
// "החזרה", 7s for an error), pauses while pointed at, focused or while the tab is hidden, and can be swiped sideways
// (or down) or closed with ×. Position: at the bottom; on a phone above the tab bar (StaffLayout marks it on <html>),
// moved to the top while a centred modal dialog is open so it never covers the dialog's own buttons; while a phone sheet
// (a full-height form dialog) is open it stays at the bottom, just above the sheet's footer; on a wide screen in the
// bottom-left corner, clear of centred dialogs and of the start-side primary buttons. One live region: each toast is
// itself the status (or alert, for an error), and there is one toast at a time.

type ToastAction = { label: string; run: () => void };
type Toast = { id: number; tone: 'good' | 'bad' | 'info'; text: string; action?: ToastAction; top: boolean; bar: number };
type ToastApi = {
  success: (text: string, action?: ToastAction) => void;
  error: (text: string) => void;
  info: (text: string, action?: ToastAction) => void;
  /** A reversible action was done: the toast carries "החזרה", which runs `revert`. */
  undo: (text: string, revert: () => void) => void;
};

/** The undo action is always "החזרה" ("ביטול" means cancelling a registration or a meeting). */
export const UNDO_LABEL = 'החזרה';
const actionLabel = (label: string) => (/^(ביטול|לבטל|בטל|ביטול פעולה)$/.test(label.trim()) ? UNDO_LABEL : label);

const ToastCtx = createContext<ToastApi | null>(null);

/** On a phone: how much of the screen's bottom is taken by a fixed bar (the tab bar, a page's own action bar), so the
 *  toast sits just above it and never covers its buttons. */
function bottomBar(): number {
  if (typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches) return 0;
  let top = window.innerHeight;
  for (const el of document.elementsFromPoint(window.innerWidth / 2, window.innerHeight - 4)) {
    if (el.closest('.toast-layer')) continue;
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') {
        top = Math.min(top, n.getBoundingClientRect().top);
        break;
      }
    }
  }
  return Math.max(0, window.innerHeight - top);
}
const DURATION = { plain: 4000, action: 6000, bad: 7000 } as const;

/** Where a new toast goes: over an open centred dialog → the top; over a phone sheet → the bottom, above its footer;
 *  otherwise the bottom, above the page's own bottom bar. */
function placement(): { top: boolean; bar: number } {
  if (typeof document === 'undefined') return { top: false, bar: 0 };
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
  const last = open[open.length - 1];
  if (!last) return { top: false, bar: bottomBar() };
  if (last.hasAttribute('data-sheet') && window.matchMedia('(max-width: 639px)').matches) {
    const foot = last.querySelector('footer');
    return { top: false, bar: foot ? Math.round(foot.getBoundingClientRect().height) : 0 };
  }
  return { top: true, bar: 0 };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leaving, setLeaving] = useState<number | null>(null);
  const seq = useRef(0);
  // Toasts live in the browser's top layer (popover), re-shown on each change so they stay above an open modal dialog.
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = layer.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el?.showPopover) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover!();
      if (toasts.length) el.showPopover();
    } catch {
      /* popover not supported: the fixed layer still shows outside dialogs */
    }
  }, [toasts]);
  const remove = useCallback((id: number) => {
    setLeaving(null);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  // leave with a short fade (instant with reduced motion: the animation is cut to ~0 by the global rule)
  const dismiss = useCallback((id: number) => {
    setLeaving(id);
    setTimeout(() => remove(id), 160);
  }, [remove]);
  // one timer at a time (one toast at a time); it pauses while the pointer or focus is on the toast, so an undo can
  // still be reached, and resumes with the time that was left
  const timer = useRef<{ id: number; handle: ReturnType<typeof setTimeout> | null; left: number; since: number } | null>(null);
  const arm = useCallback((id: number, ms: number) => {
    if (timer.current?.handle) clearTimeout(timer.current.handle);
    timer.current = { id, left: ms, since: Date.now(), handle: setTimeout(() => dismiss(id), ms) };
  }, [dismiss]);
  const pause = useCallback(() => {
    const t = timer.current;
    if (!t?.handle) return;
    clearTimeout(t.handle);
    t.handle = null;
    t.left = Math.max(1500, t.left - (Date.now() - t.since));
  }, []);
  const resume = useCallback(() => {
    const t = timer.current;
    if (t && !t.handle) arm(t.id, t.left);
  }, [arm]);
  useEffect(() => {
    const vis = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [pause, resume]);
  const push = useCallback((tone: Toast['tone'], text: string, action?: ToastAction) => {
    const id = ++seq.current;
    const { top, bar } = placement();
    setLeaving(null);
    setToasts([{ id, tone, text, top, bar, action: action && { ...action, label: actionLabel(action.label) } }]);
    arm(id, tone === 'bad' ? DURATION.bad : action ? DURATION.action : DURATION.plain);
  }, [arm]);
  const api = useRef<ToastApi>({
    success: (t, a) => push('good', t, a),
    error: (t) => push('bad', t),
    info: (t, a) => push('info', t, a),
    undo: (t, revert) => push('good', t, { label: UNDO_LABEL, run: revert }),
  });
  // a toast that outlives a page change (saved → moved to the new page) follows the new page's bottom bar
  useEffect(() => {
    if (!toasts.length) return;
    let t: ReturnType<typeof setTimeout>;
    const again = () => {
      clearTimeout(t);
      t = setTimeout(() => setToasts((all) => all.map((x) => (x.top ? x : { ...x, bar: bottomBar() }))), 120);
    };
    window.addEventListener('hashchange', again);
    window.addEventListener('popstate', again);
    // in-app links push history without an event; the staff layout marks the tab bar on <html> as it comes and goes
    const mo = new MutationObserver(again);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tabbar'] });
    // a toast raised from a dialog went to the top; once the dialog closes it moves back down, clear of the page's header
    // (the search box and the next action are there)
    const settle = () => setToasts((all) => (document.querySelector('dialog[open]') || !all.some((x) => x.top) ? all
      : all.map((x) => (x.top ? { ...x, top: false, bar: bottomBar() } : x))));
    const dialogs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(settle, 60); });
    dialogs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => {
      clearTimeout(t);
      mo.disconnect();
      dialogs.disconnect();
      window.removeEventListener('hashchange', again);
      window.removeEventListener('popstate', again);
    };
  }, [toasts.length]);
  const top = toasts.some((t) => t.top);
  const bar = toasts[0]?.bar ?? 0;
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div
        ref={layer}
        popover="manual"
        data-at={top ? 'top' : 'bottom'}
        style={bar ? { bottom: `calc(${bar}px + 0.75rem)` } : undefined}
        className="toast-layer pointer-events-none fixed inset-x-0 z-50 m-0 flex h-auto w-full flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4 md:items-end md:px-6"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} t={t} leaving={leaving === t.id} onPause={pause} onResume={resume} onDismiss={() => dismiss(t.id)}
            onAction={() => { t.action!.run(); remove(t.id); }} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ t, leaving, onPause, onResume, onDismiss, onAction }: {
  t: Toast; leaving: boolean; onPause: () => void; onResume: () => void; onDismiss: () => void; onAction: () => void;
}) {
  // swipe: sideways either way, or down (up when the toast is at the top); a short flick or a third of the width closes it
  const drag = useRef<{ x: number; y: number; t: number; on: boolean } | null>(null);
  const [off, setOff] = useState<{ x: number; y: number; live: boolean } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, y: e.clientY, t: Date.now(), on: false };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = (e.clientY - d.y) * (t.top ? -1 : 1);
    if (!d.on && Math.hypot(dx, dy) < 6) return;
    if (!d.on) {
      d.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onPause();
    }
    // sideways moves freely; towards the screen's middle it resists
    setOff({ x: dx, y: dy > 0 ? dy : dy / 4, live: true });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on || !off) return;
    const w = e.currentTarget.offsetWidth;
    const fast = Math.hypot(off.x, off.y) / Math.max(1, Date.now() - d.t) > 0.5;
    if (Math.abs(off.x) > w / 3 || off.y > 40 || (fast && (Math.abs(off.x) > 24 || off.y > 16))) {
      setOff({ ...off, live: false });
      onDismiss();
    }
    else {
      setOff(null);
      onResume();
    }
  };
  const moved = off ? { transform: `translate(${off.x}px, ${t.top ? -off.y : off.y}px)`, opacity: Math.max(0.2, 1 - Math.abs(off.x) / 320 - Math.max(0, off.y) / 160), transition: off.live ? 'none' : undefined } : undefined;
  return (
    <div
      role={t.tone === 'bad' ? 'alert' : 'status'}
      aria-atomic="true"
      onPointerEnter={onPause}
      onPointerLeave={() => { if (!off?.live) onResume(); }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onFocus={onPause}
      onBlur={onResume}
      style={moved}
      className={cx(
        'pointer-events-auto flex w-full max-w-md touch-pan-y items-center gap-2.5 rounded-[var(--radius-control)] py-1.5 ps-4 pe-1.5 text-body-sm font-medium shadow-lg transition-[transform,opacity] duration-200 ease-out select-none md:w-auto md:min-w-72',
        leaving ? 'toast-out' : 'toast-in',
        t.tone === 'bad' ? 'bg-bad text-paper' : 'bg-ink text-light',
      )}
    >
      <Icon name={t.tone === 'bad' ? 'alert' : 'checkCircle'} size={18} />
      {/* at most two lines (an error keeps its whole text): a long name must not grow the toast over the list */}
      <span title={t.text} className={cx('min-w-0 flex-1 py-1.5 leading-snug', t.tone !== 'bad' && 'line-clamp-2')}>{t.text}</span>
      {t.action && (
        <button type="button" onClick={onAction}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-tag px-2.5 font-bold text-current underline underline-offset-2 hover:bg-light/10">
          {t.action.label === UNDO_LABEL && <Icon name="undo" size={16} />}
          {t.action.label}
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label="סגירת ההודעה"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-tag opacity-75 hover:bg-light/10 hover:opacity-100">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('ToastProvider missing');
  return ctx;
}

// ───────────── dialogs ─────────────

/** The close (×) button's name in every dialog: it closes the window, not the thing the dialog is about. */
export const CLOSE_WINDOW_LABEL = 'סגירת החלון';

const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=button]):not([type=submit]), textarea, select';

/**
 * A modal dialog (native <dialog>: focus trap, Escape, top layer).
 * - `dismissible` (default true): false while a form in it has unsaved input (`dismissible={!dirty}`). Then a tap outside
 *   does nothing, and Escape or × first ask "לצאת בלי לשמור?" (the footer's own "חזרה" button is the caller's and closes
 *   at once).
 * - `layout`: on a phone (<640px) a dialog with text fields is a full-height sheet (header fixed, body scrolls, footer at
 *   the bottom); a dialog without fields (a confirm, a list, a menu) stays a centred card. 'auto' (default) decides by
 *   looking for fields; 'sheet' or 'center' force it. Wide screens always get the centred card.
 * - Validation: prefer validate-on-submit (the primary stays enabled; on submit, errors appear under the fields and the
 *   focus goes to the first one) over a disabled primary button.
 */
export function Dialog({ open, onClose, title, children, footer, size = 'md', dismissible = true, layout = 'auto' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg';
  /** false = unsaved input: ignore a tap outside; Escape/× ask before closing */
  dismissible?: boolean;
  /** phone layout: 'auto' (sheet when the dialog has text fields), 'sheet', 'center' */
  layout?: 'auto' | 'sheet' | 'center';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirm = useContext(ConfirmCtx);
  const asking = useRef(false);
  // The content mounts only once the dialog is open, so an `autoFocus` field (or the confirm's "חזרה") can take the
  // focus; otherwise it goes to `[data-autofocus]`, else to the first control (the browser's own rule).
  const [shown, setShown] = useState(false);
  // The element that opened the dialog gets the focus back when it closes — also after "יציאה בלי שמירה" (the confirm
  // dialog on top had moved the browser's own memory of it) and when the dialog unmounts while still open.
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = () => {
    const el = opener.current;
    opener.current = null;
    if (!el) return;
    // after the commit: a confirm on top may close in the same render, and its own opener (a field in this dialog) is
    // gone by then. Only when the focus was left nowhere (the body) or in a dialog that is closed now.
    queueMicrotask(() => {
      const a = document.activeElement;
      const lost = !a || a === document.body || !a.isConnected || !!a.closest('dialog:not([open])');
      if (lost && el.isConnected && !el.closest('dialog:not([open])')) el.focus({ preventScroll: true });
    });
  };
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      d.showModal();
    }
    if (!open && d.open) {
      d.close();
      restoreFocus();
    }
    setShown(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useLayoutEffect(() => {
    const d = ref.current;
    return () => {
      // unmounted while open (a dialog that mounts only while open). Checked after the commit: React's StrictMode
      // re-runs effects without removing the element, and then nothing is to be done.
      const el = opener.current;
      queueMicrotask(() => {
        if (!d || d.isConnected || !el) return;
        opener.current = el;
        restoreFocus();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !shown) return;
    const active = document.activeElement;
    if (active && active !== d && d.contains(active)) return; // an autoFocus field took it
    const target = d.querySelector<HTMLElement>('[data-autofocus]')
      ?? d.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    target?.focus();
  }, [shown]);
  // sheet or card: decided after each render (fields may arrive with data); no state, so no extra render
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    const sheet = layout === 'sheet' || (layout === 'auto' && !!d.querySelector(FIELD));
    if (sheet) d.setAttribute('data-sheet', '');
    else d.removeAttribute('data-sheet');
  });
  const tryClose = async () => {
    if (dismissible || !confirm) return onClose();
    if (asking.current) return;
    asking.current = true;
    const leave = await confirm({ title: LEAVE_UNSAVED.title, body: LEAVE_UNSAVED.body, confirm: LEAVE_UNSAVED.confirm, danger: true });
    asking.current = false;
    if (leave) onClose();
  };
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); void tryClose(); }}
      onClick={(e) => { if (e.target === ref.current && dismissible) onClose(); }}
      className={cx(
        'dialog-in m-auto w-[calc(100%-1.5rem)] rounded-[var(--radius-panel)] bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/45',
        size === 'sm' ? 'max-w-md' : size === 'md' ? 'max-w-xl' : 'max-w-3xl',
        // phone sheet: the whole screen, squared to the edges
        'max-sm:data-sheet:m-0 max-sm:data-sheet:h-dvh max-sm:data-sheet:max-h-dvh max-sm:data-sheet:w-full max-sm:data-sheet:max-w-none max-sm:data-sheet:rounded-none max-sm:data-sheet:shadow-none',
      )}
      aria-labelledby={titleId}
    >
      {open && shown && (
        <div className="flex max-h-[88dvh] flex-col in-data-sheet:max-sm:h-full in-data-sheet:max-sm:max-h-none">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge py-2.5 ps-5 pe-3">
            <h2 id={titleId} className="text-heading font-semibold">{title}</h2>
            <button type="button" onClick={() => void tryClose()} aria-label={CLOSE_WINDOW_LABEL} title={CLOSE_WINDOW_LABEL} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-ink/[0.06] hover:text-ink">
              <Icon name="close" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <footer className="flex shrink-0 flex-wrap justify-start gap-2 border-t border-edge px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** `cancel`: the dismiss button's words, "חזרה" by default (DISMISS). When the subject IS cancelling (a registration, a
 *  meeting), say it plainly: "לא, להשאיר את ההרשמה". `danger`: the confirm button is red and the focus starts on the
 *  dismiss button, so Enter never destroys by accident. */
export type ConfirmOptions = { title: string; body?: ReactNode; confirm: string; danger?: boolean; cancel?: string };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Dialog
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        size="sm"
        layout="center"
        footer={
          <>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus={!state?.danger}>
              {state?.confirm}
            </Button>
            {/* "חזרה", not "ביטול": in this app "ביטול" means cancelling a registration or a meeting */}
            <Button variant="ghost" onClick={() => close(false)} autoFocus={!!state?.danger}>{state?.cancel ?? DISMISS}</Button>
          </>
        }
      >
        <div className="text-body text-ink-soft">{state?.body}</div>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('ConfirmProvider missing');
  return ctx;
}

/** Copy text with a toast. Falls back to a prompt when the clipboard API is blocked. */
export function useCopy() {
  const toast = useToast();
  return async (text: string, done = 'הועתק') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      window.prompt('אפשר להעתיק מכאן:', text);
    }
  };
}
