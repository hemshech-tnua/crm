import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useSources } from '@/lib/data';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { normalizePhone } from '@/lib/phone';
import { fmtMoney, isPriced } from '@/lib/money';
import { Button, EmptyState, ErrorBox, Input, Notice, Panel, SearchInput, Select, Skeleton, cx } from '@/ui/kit';
import { Dialog, useConfirm, useToast } from '@/ui/feedback';
import { Icon, type IconName } from '@/ui/Icon';
import { scrollToContentTop } from '@/ui/viewport';
import { eventKeys, fetchCheckinList, useDoorEvent, useInvalidateEvent, type CheckinRow } from './queries';
import { RowMenu, inDoorWindow, timeRange, type MenuItem } from './shared';
import { matchScore, searchDigits } from './doorMatch';

/** The 5th, 10th, 20th… Friday is a milestone worth greeting at the door. */
const isMilestone = (n: number) => n === 5 || (n >= 10 && n % 10 === 0);
/** A row marked in the last few seconds stays where the volunteer can fix it (longer while the fee is still open). */
const STAY_MS = 6000;
const STAY_OWES_MS = 20000;
/** Delay before the full header comes back after the search loses focus: a tap on a row must not move the list. */
const EXPAND_DELAY_MS = 450;

type Marked = { at: number; pinned: boolean };

/**
 * How far below the top of the window the door header sticks: under the app bar when the app shows one (phones),
 * at the very top when it doesn't (desktop, or a door mode that hides the bar). Measured, so it works either way.
 */
function useStickyTop() {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const main = document.getElementById('main');
      let h = 0;
      for (const el of Array.from(main?.parentElement?.children ?? [])) {
        if (el === main) break;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || (cs.position !== 'sticky' && cs.position !== 'fixed')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.8 || r.top > 1) continue; // a side bar, or not a bar at the top
        h = Math.max(h, r.bottom);
      }
      setTop(Math.max(0, Math.round(h)));
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, { passive: true });
    return () => {
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', soon);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return top;
}

export function DoorPage() {
  const { id = '' } = useParams();
  const role = useRole();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateEvent();
  const ev = useDoorEvent(id);
  const key = eventKeys.checkin(id);
  const busy = useIsMutating({ mutationKey: ['door', id] });
  // the door team gets the list only around the event's time; don't ask the server outside it
  const outside = role === 'volunteer' && !!ev.data && !inDoorWindow(ev.data);
  const list = useQuery({
    queryKey: key,
    enabled: !!id && !!ev.data && !outside,
    retry: (n, err) => errorCode(err) !== 'forbidden' && n < 1,
    queryFn: () => fetchCheckinList(id),
    // self check-ins via the QR sign show up without reloading; paused while a tap is being saved
    refetchInterval: busy ? false : 15_000,
  });
  const stickyTop = useStickyTop();

  const [search, setSearch] = useState('');
  const [onlyOwing, setOnlyOwing] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);
  const focusSearch = () => searchBox.current?.querySelector('input')?.focus();
  // while the search has focus (the phone keyboard is open) the header shrinks to the search row
  const [typing, setTyping] = useState(false);
  const expandTimer = useRef<number>(0);
  const onSearchFocus = () => { window.clearTimeout(expandTimer.current); setTyping(true); };
  const onSearchBlur = () => { window.clearTimeout(expandTimer.current); expandTimer.current = window.setTimeout(() => setTyping(false), EXPAND_DELAY_MS); };

  // rows marked in the last few seconds stay in place, so a wrong tap is fixed right where it happened;
  // a row marked from a search goes to the top ("סומנו עכשיו"), because the search is cleared for the next person
  const [marked, setMarked] = useState<Record<string, Marked>>({});
  const timers = useRef<Record<string, number>>({});
  const remember = (rid: string, pinned: boolean, ms = STAY_MS) => {
    setMarked((m) => ({ ...m, [rid]: { at: m[rid]?.at ?? Date.now(), pinned: pinned || !!m[rid]?.pinned } }));
    window.clearTimeout(timers.current[rid]);
    timers.current[rid] = window.setTimeout(() => {
      setMarked((m) => { const n = { ...m }; delete n[rid]; return n; });
      delete timers.current[rid];
    }, ms);
  };
  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => () => window.clearTimeout(expandTimer.current), []);

  const [walkin, setWalkin] = useState<{ name: string; phone: string } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const setAttendance = useMutation({
    mutationKey: ['door', id],
    mutationFn: async (v: { row: CheckinRow; attendance: 'attended' | 'unknown'; quiet?: boolean }) => {
      const { error } = await supabase.rpc('staff_set_attendance', { p_registration_id: v.row.registration_id, p_attendance: v.attendance });
      if (error) throw error;
      return v;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CheckinRow[]>(key);
      qc.setQueryData<CheckinRow[]>(key, (rows) =>
        rows?.map((r) =>
          r.registration_id !== v.row.registration_id
            ? r
            : v.attendance === 'attended'
              ? { ...r, attendance: 'attended', status: 'registered', checked_in_at: r.checked_in_at ?? new Date().toISOString(), checkin_method: r.checkin_method ?? 'staff' }
              : { ...r, attendance: 'unknown', checked_in_at: null, checkin_method: null },
        ),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(`ההגעה של ${v.row.display_name} לא נשמרה. ${errorMessage(err)}`);
    },
    onSuccess: (v) => {
      if (v.quiet) return;
      if (v.attendance === 'attended') {
        const unpaid = owes(v.row) ? ' · לא שולם' : '';
        toast.undo(`ההגעה של ${v.row.display_name} סומנה${unpaid}`, () => setAttendance.mutate({ row: v.row, attendance: 'unknown' }));
      } else {
        toast.undo(`הסימון של ${v.row.display_name} הוסר`, () => setAttendance.mutate({ row: v.row, attendance: 'attended' }));
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['event', id] });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  // "paid at the entrance": one tap, cash, at the meeting's price (undo from the toast or the row menu)
  const doorPay = useMutation({
    mutationKey: ['door', id],
    mutationFn: async (v: { row: CheckinRow; paid: boolean; arrived?: boolean }) => {
      const { error } = await supabase.rpc('staff_door_payment', { p_registration_id: v.row.registration_id, p_paid: v.paid });
      if (error) throw error;
      return v;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CheckinRow[]>(key);
      qc.setQueryData<CheckinRow[]>(key, (rows) =>
        rows?.map((r) => (r.registration_id !== v.row.registration_id ? r : { ...r, payment_status: v.paid ? 'paid' : 'pending', cash_just_marked: v.paid })),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(`התשלום של ${v.row.display_name} לא נשמר. ${errorMessage(err)}`);
    },
    onSuccess: (v) => {
      if (v.paid) {
        toast.undo(v.arrived ? `ההגעה והתשלום של ${v.row.display_name} סומנו` : `התשלום של ${v.row.display_name} סומן · שולם במקום`, () => {
          doorPay.mutate({ row: v.row, paid: false });
          // the arrival was marked together with the cash: a mistaken tap takes both back
          if (v.arrived) setAttendance.mutate({ row: v.row, attendance: 'unknown', quiet: true });
        });
      } else toast.success(`הסימון "שולם במקום" של ${v.row.display_name} הוסר`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['event_payments', 'finance', id] });
    },
  });

  const cancelReg = useMutation({
    mutationKey: ['door', id],
    mutationFn: async (row: CheckinRow) => {
      const { error } = await supabase.rpc('staff_cancel_registration', { p_registration_id: row.registration_id, p_reason: null });
      if (error) throw error;
      return row;
    },
    onSuccess: async (row) => {
      await invalidate(id);
      toast.success(`הביטול של ${row.display_name} סומן`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const askCancel = async (row: CheckinRow) => {
    const ok = await confirm({
      title: 'סימון ביטול',
      body: <>לסמן ביטול של <b>{row.display_name}</b>? המקום יתפנה. אם בסוף תהיה הגעה, מסמנים אותה כרגיל.</>,
      confirm: 'סימון ביטול',
      cancel: 'חזרה',
      danger: true,
    });
    if (ok) cancelReg.mutate(row);
  };

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const term = search.trim();
  const e = ev.data;
  const price = isPriced(e?.price) ? Number(e!.price) : null;
  // a priced meeting: who still owes the fee (a registered place, or a walk-in); a waitlisted place pays once it is in
  function owes(r: CheckinRow) {
    return price != null && r.status === 'registered' && r.payment_status === 'pending';
  }

  // each new search starts at the top, so the best match sits right under the search box (and above the keyboard)
  const firstTerm = useRef(true);
  useEffect(() => {
    if (firstTerm.current) { firstTerm.current = false; return; }
    // to the top of the page content, not 0: in door mode on a phone the app bar has scrolled away and stays away
    scrollToContentTop();
  }, [term, onlyOwing]);

  const score = (r: CheckinRow) => matchScore(r, term);
  const pinned = (r: CheckinRow) => !!marked[r.registration_id]?.pinned;
  const stays = (r: CheckinRow) => r.attendance === 'attended' && !!marked[r.registration_id];
  const justNow = rows.filter(pinned).sort((a, b) => marked[b.registration_id].at - marked[a.registration_id].at);
  const shown = rows.filter((r) => !pinned(r) && (!onlyOwing || owes(r)) && score(r) > 0);
  const best = term ? (a: CheckinRow, b: CheckinRow) => score(b) - score(a) : () => 0;
  const notYet = shown.filter((r) => (r.status === 'registered' && r.attendance !== 'attended') || stays(r)).sort(best);
  const arrived = shown.filter((r) => r.attendance === 'attended' && !stays(r)).sort((a, b) => best(a, b) || (b.checked_in_at ?? '').localeCompare(a.checked_in_at ?? ''));
  const waiting = shown.filter((r) => r.status === 'waitlisted' && r.attendance !== 'attended').sort((a, b) => best(a, b) || (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0));
  const cancelled = shown.filter((r) => r.status === 'cancelled' && r.attendance !== 'attended').sort(best);

  const totalArrived = rows.filter((r) => r.attendance === 'attended').length;
  const totalRegistered = rows.filter((r) => r.status === 'registered' && !r.is_walk_in).length;
  const totalNotYet = rows.filter((r) => r.status === 'registered' && r.attendance !== 'attended').length;
  const walkIns = rows.filter((r) => r.is_walk_in && r.attendance === 'attended').length;
  const totalOwing = rows.filter(owes).length;
  const inactive = e && (e.status === 'draft' || e.status === 'cancelled');
  const forbidden = outside || (list.isError && errorCode(list.error) === 'forbidden');
  const filtering = !!term || onlyOwing;

  // tap the box: arrived (or back). From a search, the search is cleared and the keyboard stays up for the next person.
  const toggle = (r: CheckinRow) => {
    const attend = r.attendance !== 'attended';
    const fromSearch = !!term;
    remember(r.registration_id, fromSearch, attend && owes(r) ? STAY_OWES_MS : STAY_MS);
    // from a search the row itself, highlighted on top under "סומנו עכשיו", is the confirmation (and its box the undo):
    // no toast over it while the keyboard leaves little room
    setAttendance.mutate({ row: r, attendance: attend ? 'attended' : 'unknown', quiet: fromSearch && attend });
    if (fromSearch) {
      setSearch('');
      focusSearch();
    }
  };
  // "שולם במקום" also marks the arrival: whoever pays at the entrance is here
  const payCash = (r: CheckinRow) => {
    const arrive = r.attendance !== 'attended';
    remember(r.registration_id, !!term || pinned(r));
    if (arrive) setAttendance.mutate({ row: r, attendance: 'attended', quiet: true });
    doorPay.mutate({ row: r, paid: true, arrived: arrive });
    if (term) setSearch('');
  };
  const openWalkin = () => {
    const d = searchDigits(term);
    setWalkin(/\d/.test(term) ? { name: '', phone: d.length >= 9 ? term : '' } : { name: term, phone: '' });
  };

  const rowProps = (r: CheckinRow) => ({
    r,
    friday: e?.type === 'friday',
    disabled: !!inactive,
    owes: owes(r),
    // the cash button where money changes hands: once in (or just marked), and in the "לא שילמו" view;
    // the rest of the list keeps one row height, with only the "לא שולם" tag
    payHere: owes(r) && (r.attendance === 'attended' || pinned(r) || onlyOwing),
    price,
    onToggle: () => toggle(r),
    onPaid: () => payCash(r),
    menu: [
      ...(owes(r) && price != null && r.attendance !== 'attended' ? [{ label: `הגעה ושולם במקום · ${fmtMoney(price)}`, icon: 'check' as const, onClick: () => payCash(r) }] : []),
      ...(price && r.payment_status === 'paid' && r.cash_just_marked ? [{ label: 'הסרת "שולם במקום"', icon: 'undo' as const, onClick: () => doorPay.mutate({ row: r, paid: false }) }] : []),
      ...(r.status !== 'cancelled' && r.attendance !== 'attended' ? [{ label: 'סימון ביטול', icon: 'close' as const, danger: true, onClick: () => askCancel(r) }] : []),
    ],
  });

  // marked a moment ago from a search: on top while the list is open; under the results while searching again
  const strip = justNow.length > 0 && (
    <Section title="סומנו עכשיו" count={justNow.length} live>
      {justNow.map((r) => <Row key={r.registration_id} {...rowProps(r)} recent />)}
    </Section>
  );
  const compact = typing ? 'max-sm:hidden' : '';
  const updated = list.dataUpdatedAt ? fmtTime(new Date(list.dataUpdatedAt)) : null;
  const chipRow = !forbidden && price != null && (totalOwing > 0 || onlyOwing);

  return (
    <div className="mx-auto max-w-2xl">
      {/* sticky header: meeting + live count, then the search; while typing on a phone only the search row stays */}
      <div
        style={{ top: stickyTop }}
        className="sticky z-20 -mx-4 -mt-5 border-b border-edge bg-sky/95 px-4 pt-2 pb-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-10 md:-mt-9 md:px-10 md:pt-4"
      >
        <div className={cx('flex items-center gap-2', compact)}>
          <Link
            to={can.manage(role) ? `/app/events/${id}` : '/app/door'}
            aria-label={can.manage(role) ? 'לעמוד המפגש' : 'לכל המפגשים של היום'}
            title={can.manage(role) ? 'לעמוד המפגש' : 'לכל המפגשים של היום'}
            className="-ms-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink hover:bg-ink/[0.07]"
          >
            <Icon name="back" size={22} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-heading font-bold sm:text-section">{e?.title ?? 'רשימת נוכחות'}</h1>
            {e && <div className="hidden text-small text-muted sm:block">{fmtDayLong(e.starts_at)} · <span className="num">{timeRange(e)}</span></div>}
            {!forbidden && list.data && (
              <p className="flex flex-wrap items-baseline gap-x-1.5 text-small text-ink-soft">
                <span><b className="num text-ink">{totalNotYet}</b> עוד לא הגיעו</span>
                {walkIns > 0 && <span aria-hidden="true">·</span>}
                {walkIns > 0 && <span><b className="num text-ink">{walkIns}</b> בלי הרשמה</span>}
                {updated && !chipRow && <span className="text-muted">· עודכן <span className="num">{updated}</span></span>}
              </p>
            )}
          </div>
          {/* one live tile: how many are in */}
          {!forbidden && list.data && (
            <div className="shrink-0 rounded-[var(--radius-control)] bg-ink px-3 py-1.5 text-center text-light" aria-live="polite" aria-atomic="true">
              <div className="num font-display text-[1.75rem] leading-none" aria-label={`הגיעו ${totalArrived}, מתוכם ${walkIns} בלי הרשמה. ${totalRegistered} רשומים`}>
                {totalArrived}
              </div>
              <div className="mt-0.5 text-micro font-medium" aria-hidden="true">הגיעו</div>
            </div>
          )}
        </div>

        {!forbidden && (
          <div className={cx('mt-2 flex gap-2', typing && 'max-sm:mt-0')} onFocus={onSearchFocus} onBlur={onSearchBlur}>
            <div ref={searchBox} className="min-w-0 flex-1">
              <SearchInput value={search} onChange={setSearch} label="חיפוש לפי שם או טלפון" placeholder="שם או טלפון" size="lg" />
            </div>
            <button
              type="button"
              onClick={openWalkin}
              disabled={!!inactive || forbidden}
              className="flex h-14 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-tide px-2.5 font-semibold text-light hover:bg-ink-soft active:bg-tide-deep disabled:bg-tide/40 disabled:text-light/80 sm:px-3"
            >
              <Icon name="userPlus" size={20} />
              <span className="text-right text-small leading-tight">הגעה<br />בלי הרשמה</span>
            </button>
          </div>
        )}

        {chipRow && (
          <div className={cx('mt-2 flex items-center gap-2', compact)}>
            <button
              type="button"
              aria-pressed={onlyOwing}
              onClick={() => setOnlyOwing((v) => !v)}
              className={cx(
                'inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-small font-semibold transition-colors',
                onlyOwing ? 'border-ink bg-ink text-light' : 'border-warn/40 bg-warn-wash text-warn hover:border-warn',
              )}
            >
              {onlyOwing ? <Icon name="check" size={16} /> : <span aria-hidden="true" className="font-display">₪</span>}
              לא שילמו <span className="num">{totalOwing}</span>
            </button>
            <span className="ms-auto text-small text-muted">
              {onlyOwing ? <>רק מי שעוד לא שילמו · <span className="num">{fmtMoney(price!)}</span></> : updated && <>עודכן <span className="num">{updated}</span></>}
            </span>
          </div>
        )}
      </div>

      <div className="pt-4">
        {e?.status === 'draft' && <div className="mb-3"><Notice tone="warn" icon="alert">המפגש עדיין טיוטה, ולכן אי אפשר לסמן הגעה.</Notice></div>}
        {e?.status === 'cancelled' && <div className="mb-3"><Notice tone="warn" icon="alert">המפגש בוטל.</Notice></div>}
        {e?.status === 'completed' && <div className="mb-3"><Notice tone="light" icon="alert">המפגש כבר נסגר. סימון כאן מתקן את הנוכחות (גם בדוחות), ומשימות המעקב מתעדכנות בהתאם.</Notice></div>}

        {ev.isError ? (
          <ErrorBox error={errorMessage(ev.error)} onRetry={() => ev.refetch()} />
        ) : forbidden ? (
          <Panel>
            <EmptyState icon="door" title={e && new Date(e.ends_at).getTime() < Date.now() ? 'הרשימה כבר נסגרה' : 'הרשימה עוד לא פתוחה'}>
              לצוות הכניסה רשימת הנוכחות נפתחת 12 שעות לפני המפגש ונסגרת 12 שעות אחריו.
            </EmptyState>
          </Panel>
        ) : list.isLoading || ev.isLoading ? (
          <Panel><Skeleton lines={8} /></Panel>
        ) : list.isError ? (
          <ErrorBox error={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <Panel>
            <EmptyState icon="people" title="עוד אין רשומים" action={!inactive ? <Button size="lg" icon="userPlus" onClick={() => setWalkin({ name: '', phone: '' })}>הגעה בלי הרשמה</Button> : undefined}>
              מי שמגיע בלי הרשמה נרשם כאן בשנייה.
            </EmptyState>
          </Panel>
        ) : (
          <div className="flex flex-col gap-6">
            {!term && strip}
            {filtering && shown.length === 0 && (
              // compact on purpose: with the keyboard open, the way forward ("הגעה בלי הרשמה") must be in view
              <div className="rounded-[var(--radius-panel)] border border-edge bg-paper p-4" role="status">
                <p className="text-heading font-bold">{onlyOwing && !term ? 'כולם שילמו' : 'אין תוצאות לחיפוש הזה'}</p>
                {term && <p className="mt-0.5 text-small text-muted">אין ברשימה את ״{term}״. אולי ההרשמה בשם אחר? אפשר לחפש גם לפי טלפון.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {term && !inactive && <Button size="lg" icon="userPlus" onClick={openWalkin}>הגעה בלי הרשמה</Button>}
                  <Button variant="ghost" size="lg" onClick={() => { setSearch(''); setOnlyOwing(false); focusSearch(); }}>ניקוי החיפוש והסינון</Button>
                </div>
              </div>
            )}
            {notYet.length > 0 && (
              <Section title="עוד לא הגיעו" count={notYet.length}>
                {notYet.map((r) => <Row key={r.registration_id} {...rowProps(r)} />)}
              </Section>
            )}
            {!filtering && notYet.length === 0 && totalRegistered > 0 && (
              <p className="flex items-center gap-2 rounded-[var(--radius-control)] bg-ink px-4 py-3 font-semibold text-light">
                <Icon name="checkCircle" />כל הרשומים הגיעו
              </p>
            )}
            {arrived.length > 0 && (
              <Section title="הגיעו" count={arrived.length}>
                {arrived.map((r) => <Row key={r.registration_id} {...rowProps(r)} />)}
              </Section>
            )}
            {waiting.length > 0 && (
              <Section title="ברשימת המתנה" count={waiting.length} hint="אם מגיעים ויש מקום, מסמנים הגעה כרגיל">
                {waiting.map((r) => <Row key={r.registration_id} {...rowProps(r)} />)}
              </Section>
            )}
            {cancelled.length > 0 && (
              <section>
                <button
                  type="button"
                  aria-expanded={showCancelled || !!term}
                  onClick={() => setShowCancelled((v) => !v)}
                  className="flex h-12 w-full items-center justify-between rounded-[var(--radius-control)] px-1 text-right font-bold text-muted"
                >
                  <span>ביטלו <span className="num font-normal">({cancelled.length})</span></span>
                  <Icon name="chevron" className={cx('transition-transform', (showCancelled || term) && '-rotate-90')} />
                </button>
                {(showCancelled || !!term) && (
                  <ul className="mt-1 flex flex-col gap-2">
                    {cancelled.map((r) => <Row key={r.registration_id} {...rowProps(r)} />)}
                  </ul>
                )}
              </section>
            )}
            {term && strip}
            <p className="text-center text-small text-muted">כל סימון נשמר מיד, והרשימה מתעדכנת לבד.</p>
          </div>
        )}
      </div>

      <WalkinDialog
        open={walkin !== null}
        initial={walkin ?? { name: '', phone: '' }}
        onClose={() => setWalkin(null)}
        eventId={id}
        price={price}
        onDone={(rid) => {
          setSearch('');
          if (rid) remember(rid, true);
        }}
      />
    </div>
  );
}

function Section({ title, count, hint, live, children }: { title: string; count: number; hint?: string; live?: boolean; children: ReactNode }) {
  return (
    <section aria-live={live ? 'polite' : undefined}>
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-heading font-bold">
        {title}
        <span className="num text-small font-normal text-muted">({count})</span>
      </h2>
      {hint && <p className="-mt-1 mb-2 px-1 text-small text-muted">{hint}</p>}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/** A quiet filled tag: information, not a button. Only "לא שולם" (act now) gets the warning colour. */
function Tag({ tone = 'plain', icon, title, children }: { tone?: 'plain' | 'warn' | 'bad'; icon?: IconName; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-7 items-center gap-1 rounded-[2px] px-2 text-small font-medium whitespace-nowrap',
        tone === 'warn' ? 'bg-warn-wash font-semibold text-warn' : tone === 'bad' ? 'bg-bad-wash text-bad' : 'bg-ink/[0.07] text-ink-soft',
      )}
    >
      {icon && <Icon name={icon} size={14} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

function Row({ r, friday, disabled, owes, payHere, price, recent, onToggle, onPaid, menu }: {
  r: CheckinRow; friday: boolean; disabled: boolean; owes: boolean; payHere: boolean; price: number | null; recent?: boolean; onToggle: () => void; onPaid: () => void; menu: MenuItem[];
}) {
  const on = r.attendance === 'attended';
  const nth = r.prior_fridays + 1;
  const gone = r.status === 'cancelled';
  return (
    <li className={cx(
      'flex min-h-[4.75rem] items-center gap-3 rounded-[var(--radius-panel)] border py-2.5 pr-2.5 pl-1.5',
      gone ? 'border-edge bg-paper/60' : 'bg-paper',
      recent ? 'border-ink ring-1 ring-ink' : on ? 'border-ink/50' : !gone && 'border-edge',
    )}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={on}
        aria-label={on ? `${r.display_name}: הגעה מסומנת. לחיצה מבטלת` : `סימון הגעה של ${r.display_name}`}
        className={cx(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-control)] border-2 transition-colors active:scale-95 disabled:opacity-50',
          on ? 'border-ink bg-ink text-light' : 'border-control-line bg-paper text-ink hover:border-ink hover:bg-ink/[0.06]',
        )}
      >
        {on ? <Icon name="check" size={30} strokeWidth={3} /> : <span aria-hidden="true" className="h-7 w-7 rounded-[var(--radius-control)] border-[3px] border-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-heading font-bold', gone && 'font-semibold text-muted')}>{r.display_name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-small text-muted">
          {r.phone_last4 && <span className="num" aria-label={`טלפון שמסתיים ב-${r.phone_last4}`}>••{r.phone_last4}</span>}
          {gone && <Tag>ביטול</Tag>}
          {owes && <Tag tone="warn" icon="alert">לא שולם</Tag>}
          {r.attendance === 'no_show' && <Tag tone="bad" icon="alert">סומנה אי־הגעה</Tag>}
          {r.photo_opt_out && (
            <span className="inline-flex items-center gap-1 font-semibold text-bad" title="בקשה לא להופיע בתמונות">
              <Icon name="noCamera" size={17} label="לא מצלמים" />
              בלי צילום
            </span>
          )}
          {r.first_time && <Tag icon="sparkle">פעם ראשונה</Tag>}
          {friday && !r.first_time && isMilestone(nth) && <Tag icon="star" title={`מפגש שישי מספר ${nth}. כדאי לברך!`}>מפגש שישי {nth}</Tag>}
          {r.is_member && <Tag title="חברות בעמותה">חברות בעמותה</Tag>}
          {r.is_walk_in && <Tag>בלי הרשמה</Tag>}
          {r.invited_by && <span title="מי הזמין">בהזמנת {r.invited_by}</span>}
          {r.status === 'waitlisted' && r.waitlist_position && <span>בהמתנה <span className="num">#{r.waitlist_position}</span></span>}
          {price != null && r.payment_status === 'paid' && r.cash_just_marked && <span className="inline-flex items-center gap-1"><Icon name="check" size={14} />שולם במקום</span>}
          {on && r.checked_in_at && (
            <span>
              <span className="num">{fmtTime(r.checked_in_at)}</span>
              {r.checkin_method === 'self_qr' ? ' · סריקת QR' : ''}
            </span>
          )}
        </div>
        {payHere && !disabled && price != null && (
          <button
            type="button"
            onClick={onPaid}
            aria-label={`שולם במקום במזומן, ${fmtMoney(price)}, עבור ${r.display_name}${on ? '' : '. מסמן גם הגעה'}`}
            className="mt-1.5 inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-control-line bg-paper px-3 text-small font-semibold text-ink hover:border-ink hover:bg-ink/[0.06] active:scale-95"
          >
            <span aria-hidden="true" className="font-display">₪</span>
            שולם במקום · <span className="num">{fmtMoney(price)}</span>
          </button>
        )}
      </div>
      {menu.length > 0 && !disabled && <RowMenu items={menu} big label={`פעולות נוספות ל${r.display_name}`} />}
    </li>
  );
}

// ───────────── walk-in ─────────────

function WalkinDialog({ open, initial, onClose, eventId, price, onDone }: {
  open: boolean; initial: { name: string; phone: string }; onClose: () => void; eventId: string; price: number | null; onDone: (registrationId: string | null) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="הגעה בלי הרשמה" size="sm">
      {open && <WalkinForm key={`${initial.name}|${initial.phone}`} initial={initial} onClose={onClose} eventId={eventId} price={price} onDone={onDone} />}
    </Dialog>
  );
}

function WalkinForm({ initial, onClose, eventId, price, onDone }: {
  initial: { name: string; phone: string }; onClose: () => void; eventId: string; price: number | null; onDone: (registrationId: string | null) => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const sources = useSources();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [city, setCity] = useState('');
  const [age, setAge] = useState('');
  const [source, setSource] = useState('');
  const [more, setMore] = useState(false);
  // the fee, taken in cash right here: recorded together with the arrival, so the money is not forgotten later
  const [paid, setPaid] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; age?: string; form?: string }>({});

  /** After the arrival is saved: record the cash, if it was taken. Returns a note for the toast. */
  const recordCash = async (registrationId: string): Promise<string> => {
    if (!paid || price == null) return price != null ? ' · לא שולם' : '';
    const { data, error } = await supabase.rpc('staff_door_payment', { p_registration_id: registrationId, p_paid: true });
    if (error) return ` · התשלום לא נשמר (${errorMessage(error)})`;
    // already paid (online, before the meeting): nothing to take at the door
    return (data as { already?: boolean } | null)?.already ? ' · כבר שולם, אין לגבות' : ' · שולם במקום';
  };

  // S3: someone we already know, typed by name: suggest the existing card instead of creating a duplicate
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(name.trim()), 300);
    return () => clearTimeout(t);
  }, [name]);
  const suggestions = useQuery({
    queryKey: ['walkin-suggest', eventId, q],
    enabled: q.length >= 3,
    queryFn: async () => must(await supabase.rpc('staff_walkin_suggest', { p_event_id: eventId, p_query: q })) as
      { participant_id: string; full_name: string; phone_last4: string | null; city: string | null }[],
  });
  const pick = useMutation({
    mutationFn: async (p: { participant_id: string; full_name: string }) => {
      const { data, error } = await supabase.rpc('staff_checkin_existing', { p_event_id: eventId, p_participant_id: p.participant_id });
      if (error) throw error;
      const rid = (data as { registration_id?: string } | null)?.registration_id ?? null;
      return { ...p, rid, cash: rid ? await recordCash(rid) : '' };
    },
    onSuccess: async (p) => {
      await invalidate(eventId);
      toast.success(`ההגעה של ${p.full_name} סומנה · כרטיס מוכר${p.cash}`);
      onDone(p.rid);
      onClose();
    },
    onError: (err) => setErrors({ form: errorMessage(err) }),
  });

  const add = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('staff_add_walkin', {
        p_event_id: eventId,
        p: { full_name: name.trim(), phone: phone.trim(), city: city.trim() || null, age: age.trim() || null, source: source || null },
      });
      if (error) throw error;
      const r = data as { registration_id: string; participant_is_new: boolean; already_registered: boolean; card_name?: string | null };
      return { ...r, cash: await recordCash(r.registration_id) };
    },
    onSuccess: async (r) => {
      await invalidate(eventId);
      const n = name.trim();
      toast.success(
        r.card_name ? `המספר שייך ל${r.card_name}. ההגעה סומנה בכרטיס הזה${r.cash}`
        : r.already_registered ? `${n} כבר ברשימה. ההגעה סומנה${r.cash}`
          : r.participant_is_new ? `ההגעה של ${n} סומנה · כרטיס חדש${r.cash}`
            : `ההגעה של ${n} סומנה · כרטיס מוכר${r.cash}`,
      );
      onDone(r.registration_id);
      onClose();
    },
    onError: (err) => {
      const code = errorCode(err);
      if (code === 'invalid_name') setErrors({ name: errorMessage(err) });
      else if (code === 'invalid_phone') setErrors({ phone: errorMessage(err) });
      else if (code === 'invalid_age') setErrors({ age: errorMessage(err) });
      else setErrors({ form: errorMessage(err) });
    },
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const errs: typeof errors = {};
    if (name.trim().length < 2 || /[0-9<>@/\\{}=;]/.test(name)) errs.name = 'צריך שם מלא (אותיות בלבד).';
    if (!normalizePhone(phone)) errs.phone = 'מספר הטלפון לא נראה תקין. למשל: 050-1234567.';
    if (age.trim() && !(Number(age) >= 16 && Number(age) <= 99)) errs.age = 'גיל בין 16 ל-99, או להשאיר ריק.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    add.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Input label="שם מלא" required autoFocus={!initial.name} value={name} onChange={(x) => setName(x.target.value)} error={errors.name} autoComplete="off" maxLength={80} />
      {(suggestions.data?.length ?? 0) > 0 && !phone && (
        <div className="rounded-[var(--radius-control)] border border-tide/30 bg-tide-wash p-3" aria-live="polite">
          <p className="mb-2 text-small font-semibold text-tide-deep">כבר מכירים? אם זה אחד מאלה, לוחצים עליו במקום להוסיף כרטיס חדש:</p>
          <ul className="flex flex-col gap-1.5">
            {suggestions.data!.map((p) => (
              <li key={p.participant_id}>
                <button type="button" disabled={pick.isPending} onClick={() => pick.mutate(p)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] bg-paper px-3 text-right hover:ring-2 hover:ring-tide/40">
                  <span className="font-semibold">{p.full_name}{p.city ? <span className="font-normal text-muted"> · {p.city}</span> : null}</span>
                  {p.phone_last4 && <span className="num text-small text-muted">••{p.phone_last4}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Input label="טלפון" required type="tel" inputMode="tel" ltr autoFocus={!!initial.name} value={phone} onChange={(x) => setPhone(x.target.value)} error={errors.phone} hint="למשל 050-1234567" autoComplete="off" />
      {more ? (
        <>
          <Input label="עיר" value={city} onChange={(x) => setCity(x.target.value)} maxLength={60} autoComplete="off" />
          <Input label="גיל" type="number" inputMode="numeric" ltr value={age} onChange={(x) => setAge(x.target.value)} error={errors.age} min={16} max={99} />
          <Select label="מקור הגעה" value={source} onChange={(x) => setSource(x.target.value)}>
            <option value="">לא ידוע</option>
            {(sources.data ?? []).filter((s) => s.is_active).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="h-11 self-start font-semibold text-tide">הוספת עיר, גיל ומקור הגעה (לא חובה)</button>
      )}
      {price != null && (
        <button
          type="button"
          role="switch"
          aria-checked={paid}
          onClick={() => setPaid((v) => !v)}
          className={cx(
            'flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] border-2 px-3 text-right transition-colors',
            paid ? 'border-ink bg-ink/[0.06] text-ink' : 'border-control-line bg-paper text-ink hover:border-ink',
          )}
        >
          <span aria-hidden="true" className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border-2 border-ink', paid ? 'bg-ink text-light' : 'bg-paper')}>
            {paid && <Icon name="check" size={18} strokeWidth={3} />}
          </span>
          <span className="flex-1">
            <span className="block font-semibold">שולם במקום · <span className="num">{fmtMoney(price)}</span></span>
            <span className="block text-small text-muted">{paid ? 'התשלום במזומן יירשם עם ההגעה' : 'אם לא שולם עכשיו, השורה תסומן "לא שולם"'}</span>
          </span>
        </button>
      )}
      {errors.form && <p className="text-small font-medium text-bad" role="alert">{errors.form}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="lg" icon="check" busy={add.isPending}>רישום וסימון הגעה</Button>
        <Button variant="ghost" size="lg" onClick={onClose}>חזרה לרשימה</Button>
      </div>
    </form>
  );
}
