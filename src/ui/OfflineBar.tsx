import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { errorCode } from '@/lib/errors';
import { RETRY_LABEL, Spinner } from './kit';
import { Icon } from './Icon';

/** The device's online state, as React Query sees it (it pauses queries while offline). */
export function useOnline(): boolean {
  return useSyncExternalStore((cb) => onlineManager.subscribe(cb), () => onlineManager.isOnline(), () => true);
}

/**
 * True when the screen's data may be stale for lack of a connection: the device is offline, a query is paused waiting
 * for the network, or an active query failed with a network error.
 */
export function useConnectionTrouble(): boolean {
  const online = useOnline();
  const qc = useQueryClient();
  const check = () => {
    const all = qc.getQueryCache().findAll({ type: 'active' });
    // a network failure counts at once, also while React Query is still waiting to retry it (fetchFailureReason)
    return all.some((q) => q.state.fetchStatus === 'paused'
      || (q.state.status === 'error' && errorCode(q.state.error) === 'network')
      || (q.state.fetchFailureCount > 0 && errorCode(q.state.fetchFailureReason) === 'network'));
  };
  const [trouble, setTrouble] = useState(check);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (t) return;
      t = setTimeout(() => { t = null; setTrouble(check()); }, 100);
    };
    const unsub = qc.getQueryCache().subscribe(update);
    update();
    return () => { unsub(); if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);
  return !online || trouble;
}

/**
 * One slim bar for the whole staff screen when the connection is lost: says so at once (no long skeleton), and one
 * "ניסיון נוסף" refetches every query on the screen. On a phone it sticks to the top (it is then THE sticky element at
 * the top, G1) and sets --appbar-h to its height, so a page's own sticky header stays below it. `sticky={false}` (door
 * mode, whose header has its own stale line) keeps it in the flow.
 */
export function OfflineBar({ sticky = true }: { sticky?: boolean }) {
  const show = useConnectionTrouble();
  const online = useOnline();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (!show || !sticky || !ref.current) {
      root.style.removeProperty('--appbar-h');
      return;
    }
    const set = () => root.style.setProperty('--appbar-h', `${ref.current?.offsetHeight ?? 0}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(ref.current);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--appbar-h');
    };
  }, [show, sticky]);
  if (!show) return null;
  const retry = async () => {
    setBusy(true);
    try {
      await qc.refetchQueries({ type: 'active' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={ref}
      role="status"
      className={
        'z-20 -mx-4 -mt-5 mb-5 flex min-h-11 items-center gap-2.5 border-b border-warn/30 bg-warn-wash px-4 py-1.5 text-small font-medium text-warn sm:-mx-6 sm:px-6 md:-mx-10 md:-mt-9 md:mb-6 md:px-10 '
        + (sticky ? 'sticky top-0' : 'relative')
      }
    >
      <Icon name="alert" size={18} />
      <span className="min-w-0 flex-1">
        {online ? 'אין חיבור לשרת.' : 'אין חיבור לאינטרנט.'} <span className="max-sm:hidden">מה שעל המסך אולי לא מעודכן.</span>
      </span>
      <button type="button" onClick={retry} disabled={busy} aria-busy={busy || undefined}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 font-semibold underline underline-offset-2 hover:bg-warn/10 pointer-coarse:h-11">
        {busy && <Spinner size={14} />}
        {RETRY_LABEL}
      </button>
    </div>
  );
}
