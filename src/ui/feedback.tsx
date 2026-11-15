import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, cx } from './kit';
import { Icon } from './Icon';

// ───────────── toasts ─────────────

type Toast = { id: number; tone: 'good' | 'bad' | 'info'; text: string; action?: { label: string; run: () => void } };
type ToastApi = {
  success: (text: string, action?: Toast['action']) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
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
  // one timer at a time (one toast at a time); it pauses while the pointer or focus is on the toast, so an undo can
  // still be reached, and resumes with the time that was left
  const timer = useRef<{ id: number; handle: ReturnType<typeof setTimeout> | null; left: number; since: number } | null>(null);
  const arm = useCallback((id: number, ms: number) => {
    if (timer.current?.handle) clearTimeout(timer.current.handle);
    timer.current = { id, left: ms, since: Date.now(), handle: setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms) };
  }, []);
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
  const push = useCallback((tone: Toast['tone'], text: string, action?: Toast['action']) => {
    const id = ++seq.current;
    setToasts([{ id, tone, text, action }]);
    arm(id, action ? 10000 : tone === 'bad' ? 7000 : 3500);
  }, [arm]);
  const api = useRef<ToastApi>({
    success: (t, a) => push('good', t, a),
    error: (t) => push('bad', t),
    info: (t) => push('info', t),
  });
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div
        ref={layer}
        popover="manual"
        className="pointer-events-none fixed inset-x-0 top-auto bottom-20 z-50 m-0 flex h-auto w-full flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4 sm:bottom-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            onPointerEnter={pause}
            onPointerLeave={resume}
            onFocus={pause}
            onBlur={resume}
            className={cx(
              'toast-in pointer-events-auto flex max-w-md items-center gap-3 rounded-[var(--radius-control)] px-4 py-3 text-body font-medium shadow-lg',
              t.tone === 'bad' ? 'bg-bad text-white' : 'bg-ink text-light',
            )}
          >
            <Icon name={t.tone === 'bad' ? 'alert' : 'checkCircle'} size={18} />
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button type="button" className="-my-2 -me-2 inline-flex min-h-11 items-center px-3 font-bold text-light underline underline-offset-2" onClick={() => { t.action!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
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
            <Button variant="ghost" onClick={() => close(false)}>{state?.cancel ?? 'ביטול'}</Button>
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
