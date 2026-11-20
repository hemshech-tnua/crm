import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { buttonClass, cx } from './kit';

export type MoreMenuItem = {
  label: string;
  onClick: () => void;
  icon?: IconName;
  /** destructive (ביטול המפגש, מחיקה…): set apart at the bottom of the menu, in the "bad" colour */
  danger?: boolean;
  disabled?: boolean;
  /** a short second line under the label (why it is disabled, what it does) */
  hint?: ReactNode;
};

/**
 * "⋯ עוד": the secondary and destructive actions of a page or a row, out of the way of the everyday ones.
 *
 * - `variant="button"` (default): an outlined button "⋯ עוד" for page headers; `variant="icon"`: the ⋯ icon alone for
 *   rows (then `label` names it for screen readers, e.g. "פעולות נוספות לדנה כהן").
 * - Destructive items (`danger`) always go last, after a divider.
 * - The list opens below the trigger (above when there is no room), stays inside the screen, is not clipped by tables
 *   or scrolling panels, and works with the keyboard (arrows, Home/End, Esc returns to the trigger).
 */
export function MoreMenu({ items, label = 'עוד', variant = 'button', size = 'md', className = '', children }: {
  items: (MoreMenuItem | false | null | undefined)[];
  label?: string;
  variant?: 'button' | 'icon';
  size?: 'sm' | 'md';
  className?: string;
  /** the trigger's visible text with variant="button" (default "עוד") */
  children?: ReactNode;
}) {
  const list = items.filter(Boolean) as MoreMenuItem[];
  const everyday = list.filter((i) => !i.danger);
  const danger = list.filter((i) => i.danger);
  const ordered = [...everyday, ...danger];
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const id = useId();

  const close = (focus = true) => {
    setOpen(false);
    setPos(null);
    if (focus) trigger.current?.focus();
  };

  // place it: under the trigger, its left edge on the trigger's left edge (RTL pages keep these buttons on the left);
  // flipped or clamped when it would leave the screen
  useLayoutEffect(() => {
    if (!open) return;
    const t = trigger.current?.getBoundingClientRect();
    const m = menu.current;
    if (!t || !m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = t.left;
    if (left + w > vw - 8) left = t.right - w;
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = t.bottom + 4;
    if (top + h > vh - 8 && t.top - h - 4 > 8) top = t.top - h - 4;
    setPos({ top, left });
  }, [open]);
  // once placed (visible), the first action takes the focus, so arrows and Enter work right away
  const placed = !!pos;
  useEffect(() => {
    if (placed) menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const off = (ev: PointerEvent) => {
      const n = ev.target as Node;
      if (!menu.current?.contains(n) && !trigger.current?.contains(n)) close(false);
    };
    const away = (ev: Event) => { if (!menu.current?.contains(ev.target as Node)) close(false); };
    const resize = () => close(false);
    document.addEventListener('pointerdown', off, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', off, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  if (!list.length) return null;

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = (i + 1) % els.length;
    else if (e.key === 'ArrowUp') to = (i - 1 + els.length) % els.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = els.length - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    else if (e.key === 'Tab') { close(false); return; }
    if (to < 0) return;
    e.preventDefault();
    els[to]?.focus();
  };

  // inside a modal dialog the list must stay in the dialog's top layer; elsewhere it goes to <body>, clear of clipping
  const host = open ? (trigger.current?.closest('dialog') ?? document.body) : null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={variant === 'icon' ? label : undefined}
        title={variant === 'icon' ? label : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        className={variant === 'icon'
          ? cx('inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:bg-ink/[0.07] hover:text-ink aria-expanded:bg-ink/[0.07]', size === 'sm' ? 'h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11' : 'h-11 w-11', className)
          : buttonClass('secondary', size, cx('aria-expanded:border-ink aria-expanded:bg-ink/[0.06]', className))}
      >
        <Icon name="more" size={variant === 'icon' ? 20 : size === 'sm' ? 16 : 18} />
        {variant === 'button' && (children ?? label)}
      </button>
      {open && host && createPortal(
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={variant === 'icon' ? label : typeof children === 'string' ? children : label}
          onKeyDown={keys}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          className="menu-in z-50 max-h-[70vh] max-w-[calc(100vw-1rem)] min-w-52 overflow-y-auto rounded-[var(--radius-control)] border border-edge bg-paper py-1 text-ink shadow-lg"
        >
          {ordered.map((it, n) => (
            <div key={`${it.label}-${n}`}>
              {it.danger && n === everyday.length && everyday.length > 0 && <div role="separator" className="my-1 border-t border-edge" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { close(); it.onClick(); }}
                className={cx(
                  'flex min-h-12 w-full items-center gap-2.5 px-3.5 py-2 text-right font-medium hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] focus-visible:outline-none disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent',
                  it.danger && !it.disabled ? 'text-bad' : null,
                )}
              >
                {it.icon && <Icon name={it.icon} size={18} />}
                <span className="min-w-0 flex-1">
                  <span className="block">{it.label}</span>
                  {it.hint && <span className="block text-small font-normal text-muted">{it.hint}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>,
        host,
      )}
    </>
  );
}
