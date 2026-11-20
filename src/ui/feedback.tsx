import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Button, cx } from './kit';
import { Icon } from './Icon';

// ───────────── toasts ─────────────
//
// One toast at a time, one short line ("[thing] [past verb]", with the name). It stays ~4s (6s with an action such as
// "החזרה", 7s for an error), pauses while pointed at, focused or while the tab is hidden, and can be swiped sideways
// (or down) or closed with ×. Position: at the bottom; on a phone above the tab bar (StaffLayout marks it on <html>),
// moved to the top while a modal dialog is open so it never covers the dialog's own buttons; on a wide screen in the
// bottom-left corner, clear of centred dialogs and of the start-side primary buttons.

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
    const top = typeof document !== 'undefined' && !!document.querySelector('dialog[open]');
    const bar = top ? 0 : bottomBar();
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
    return () => {
      clearTimeout(t);
      mo.disconnect();
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
        aria-live="polite"
        aria-atomic="false"
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
        'pointer-events-auto flex w-full max-w-md touch-pan-y items-center gap-2.5 rounded-[var(--radius-control)] py-1.5 ps-4 pe-1.5 text-[0.9375rem] font-medium shadow-lg transition-[transform,opacity] duration-200 ease-out select-none md:w-auto md:min-w-72',
        leaving ? 'toast-out' : 'toast-in',
        t.tone === 'bad' ? 'bg-bad text-white' : 'bg-ink text-light',
      )}
    >
      <Icon name={t.tone === 'bad' ? 'alert' : 'checkCircle'} size={18} />
      <span className="min-w-0 flex-1 py-1.5 leading-snug">{t.text}</span>
      {t.action && (
        <button type="button" onClick={onAction}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[2px] px-2.5 font-bold text-current underline underline-offset-2 hover:bg-light/10">
          {t.action.label === UNDO_LABEL && <Icon name="undo" size={16} />}
          {t.action.label}
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label="סגירת ההודעה"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] opacity-75 hover:bg-light/10 hover:opacity-100">
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

export function Dialog({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx(
        'm-auto w-[calc(100%-1.5rem)] rounded-[var(--radius-panel)] bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/45',
        size === 'sm' ? 'max-w-md' : size === 'md' ? 'max-w-xl' : 'max-w-3xl',
      )}
      aria-labelledby="dialog-title"
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-edge py-2.5 ps-5 pe-3">
            <h2 id="dialog-title" className="text-heading font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="סגירה" className="rounded-[var(--radius-control)] p-2.5 text-muted hover:bg-ink/[0.06] hover:text-ink">
              <Icon name="close" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-start gap-2 border-t border-edge px-5 py-3.5">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

type ConfirmOptions = { title: string; body?: ReactNode; confirm: string; danger?: boolean; cancel?: string };
const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

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
        footer={
          <>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {state?.confirm}
            </Button>
            {/* "חזרה", not "ביטול": in this app "ביטול" means cancelling a registration or a meeting */}
            <Button variant="ghost" onClick={() => close(false)}>{state?.cancel ?? 'חזרה'}</Button>
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
      window.prompt('העתיקו את הטקסט:', text);
    }
  };
}
