import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useSources } from '@/lib/data';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { PHONE_EXAMPLE, normalizePhone } from '@/lib/phone';
import { fmtMoney, isPriced } from '@/lib/money';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, Input, Notice, Panel, RETRY_LABEL, SearchInput, Select, Skeleton, cx } from '@/ui/kit';
import { DISMISS, Dialog, useConfirm, useToast } from '@/ui/feedback';
import { useConnectionTrouble } from '@/ui/OfflineBar';
import { useTitle } from '@/lib/title';
import { Icon } from '@/ui/Icon';
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
  // the greeter's view: only who comes for the first time
  const [onlyFirst, setOnlyFirst] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);
  const focusSearch = () => searchBox.current?.querySelector('input')?.focus();
  // while the search has focus (the phone keyboard is open) the header shrinks to the search row
  const [typing, setTyping] = useState(false);
  const expandTimer = useRef<number>(0);
  // only the text field itself: a button that takes the focus (the × in the box, "הגעה בלי הרשמה") must not move
  const onSearchFocus = (ev: FocusEvent) => {
    if (!(ev.target instanceof HTMLInputElement)) return;
    window.clearTimeout(expandTimer.current);
    setTyping(true);
  };
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

  // a tap that was not saved: the row says so in place ("לא נשמר · לסמן שוב") instead of looking marked, until the
  // next try succeeds. Keyed by registration, the value is what the tap asked for.
  const [failed, setFailed] = useState<Record<string, 'attended' | 'unknown'>>({});
  const clearFailed = (rid: string) => setFailed((f) => {
    if (!(rid in f)) return f;
    const n = { ...f }; delete n[rid]; return n;
  });

  const [walkin, setWalkin] = useState<{ name: string; phone: string } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const setAttendance = useMutation({
    mutationKey: ['door', id],
    // cash: the fee taken at the entrance, recorded in the same call as the arrival (at a meeting with a fee the database
    // records an unpaid arrival only together with it)
    mutationFn: async (v: { row: CheckinRow; attendance: 'attended' | 'unknown'; quiet?: boolean; cash?: boolean }) => {
      const { error } = await supabase.rpc('staff_set_attendance', { p_registration_id: v.row.registration_id, p_attendance: v.attendance, p_cash: !!v.cash });
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
              ? { ...r, attendance: 'attended', status: 'registered', checked_in_at: r.checked_in_at ?? new Date().toISOString(), checkin_method: r.checkin_method ?? 'staff',
                  ...(v.cash ? { payment_status: 'paid' as const, cash_just_marked: true } : {}) }
              : { ...r, attendance: 'unknown', checked_in_at: null, checkin_method: null },
        ),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      setFailed((f) => ({ ...f, [v.row.registration_id]: v.attendance }));
      // the row stays where the tap happened, for as long as a fee would keep it there
      remember(v.row.registration_id, false, STAY_OWES_MS);
      toast.error(`ההגעה של ${v.row.display_name} לא נשמרה. ${errorMessage(err)}`);
    },
    onSuccess: (v) => {
      clearFailed(v.row.registration_id);
      if (v.quiet) return;
      if (v.attendance === 'attended' && v.cash) {
        // a wrong tap: the undo takes back the payment and the arrival together
        toast.undo(`ההגעה והתשלום של ${v.row.display_name} סומנו`, () => doorPay.mutate({ row: v.row, paid: false }));
      } else if (v.attendance === 'attended') {
        toast.undo(`ההגעה של ${v.row.display_name} סומנה`, () => setAttendance.mutate({ row: v.row, attendance: 'unknown' }));
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
    mutationFn: async (v: { row: CheckinRow; paid: boolean }) => {
      const { error } = await supabase.rpc('staff_door_payment', { p_registration_id: v.row.registration_id, p_paid: v.paid });
      if (error) throw error;
      return v;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CheckinRow[]>(key);
      qc.setQueryData<CheckinRow[]>(key, (rows) =>
        // undoing the cash takes back the arrival and the place too (nobody stays in without paying)
        v.paid ? rows?.map((r) => (r.registration_id !== v.row.registration_id ? r : { ...r, payment_status: 'paid', cash_just_marked: true }))
          : rows?.filter((r) => r.registration_id !== v.row.registration_id || r.status !== 'registered'),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(`התשלום של ${v.row.display_name} לא נשמר. ${errorMessage(err)}`);
    },
    onSuccess: (v) => {
      if (v.paid) {
        toast.undo(`התשלום של ${v.row.display_name} סומן · שולם במקום`, () => doorPay.mutate({ row: v.row, paid: false }));
      } else toast.success(`הסימון "שולם במקום" של ${v.row.display_name} הוסר. ההרשמה ממתינה לתשלום`);
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
      cancel: DISMISS,
      danger: true,
    });
    if (ok) cancelReg.mutate(row);
  };

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const term = search.trim();
  const e = ev.data;
  useTitle(e && [e.title, 'כניסה']);
  const price = isPriced(e?.price) ? Number(e!.price) : null;
  // a priced meeting: who still owes the fee (a registered place, or a walk-in); a waitlisted place pays once it is in
  function owes(r: CheckinRow) {
    return price != null && r.status === 'registered' && r.payment_status !== 'paid' && r.payment_status !== 'waived';
  }
  /** At a meeting with a fee the arrival of someone without a recorded payment is marked only with the cash. */
  const needsCash = (r: CheckinRow) => price != null && r.attendance !== 'attended' && r.payment_status !== 'paid' && r.payment_status !== 'waived';

  // each new search starts at the top, so the best match sits right under the search box (and above the keyboard)
  const firstTerm = useRef(true);
  useEffect(() => {
    if (firstTerm.current) { firstTerm.current = false; return; }
    // to the top of the page content, not 0: in door mode on a phone the app bar has scrolled away and stays away
    scrollToContentTop();
  }, [term, onlyOwing, onlyFirst]);

  const score = (r: CheckinRow) => matchScore(r, term);
  const pinned = (r: CheckinRow) => !!marked[r.registration_id]?.pinned;
  const stays = (r: CheckinRow) => r.attendance === 'attended' && !!marked[r.registration_id];
  const justNow = rows.filter(pinned).sort((a, b) => marked[b.registration_id].at - marked[a.registration_id].at);
  const shown = rows.filter((r) => !pinned(r) && (!onlyOwing || owes(r)) && (!onlyFirst || r.first_time) && score(r) > 0);
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
  const totalFirst = rows.filter((r) => r.first_time && r.status !== 'cancelled').length;
  const inactive = e && (e.status === 'draft' || e.status === 'cancelled');
  const forbidden = outside || (list.isError && errorCode(list.error) === 'forbidden');
  const filtering = !!term || onlyOwing || onlyFirst;

  // tap the box: arrived (or back). From a search, the search is cleared and the keyboard stays up for the next person.
  const toggle = async (r: CheckinRow) => {
    const attend = r.attendance !== 'attended';
    if (attend && needsCash(r)) {
      // no arrival without the payment: the box asks for the cash, in the same tap's flow
      const ok = await confirm({
        title: 'הגעה ותשלום במקום',
        body: <>למפגש יש דמי השתתפות, ול<b>{r.display_name}</b> עוד אין תשלום רשום. ההגעה נרשמת רק יחד עם התשלום במקום: <span className="num">{fmtMoney(price!)}</span> במזומן.</>,
        confirm: `התקבל מזומן · ${fmtMoney(price!)}`,
        cancel: DISMISS,
      });
      if (ok) payCash(r);
      return;
    }
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
    remember(r.registration_id, !!term || pinned(r));
    // one call: the cash and the arrival together (already in: the cash only)
    if (r.attendance !== 'attended') setAttendance.mutate({ row: r, attendance: 'attended', cash: true });
    else doorPay.mutate({ row: r, paid: true });
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
    payHere: owes(r),
    price,
    onToggle: () => toggle(r),
    onPaid: () => payCash(r),
    failed: failed[r.registration_id],
    onRetry: () => {
      const want = failed[r.registration_id];
      if (!want) return;
      remember(r.registration_id, pinned(r), STAY_OWES_MS);
      setAttendance.mutate({ row: r, attendance: want, cash: want === 'attended' && needsCash(r) });
    },
    menu: [
      ...(needsCash(r) && r.status !== 'registered' ? [{ label: `הגעה ושולם במקום · ${fmtMoney(price!)}`, icon: 'check' as const, onClick: () => payCash(r) }] : []),
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
  const owingChip = !forbidden && price != null && (totalOwing > 0 || onlyOwing);
  const firstChip = !forbidden && !!list.data && (totalFirst > 0 || onlyFirst);
  // the greeter's chip sits next to the "עוד לא הגיעו" heading, not in the sticky header: the header keeps to what
  // every tap needs (the count, the search, and money owed, which is never toned down at the door)
  const firstToggle = firstChip && (
    <button
      type="button"
      aria-pressed={onlyFirst}
      onClick={() => setOnlyFirst((v) => !v)}
      className={cx(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-small font-semibold transition-colors',
        onlyFirst ? 'border-ink bg-ink text-light' : 'border-control-line bg-paper text-ink hover:border-ink',
      )}
    >
      <Icon name={onlyFirst ? 'check' : 'heart'} size={16} />
      פעם ראשונה <span className="num">{totalFirst}</span>
    </button>
  );
  // a refresh or a tap that failed never wipes the list at the door: the list stays, and one line says since when
  // it is not up to date (the door header is the one sticky element here, so the line lives inside it)
  const trouble = useConnectionTrouble();
  const stale = !forbidden && !!list.data && (list.isError || trouble);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await Promise.all([list.refetch(), ev.refetch()]); } finally { setRetrying(false); }
  };
  const clearFilters = () => { setSearch(''); setOnlyOwing(false); setOnlyFirst(false); focusSearch(); };

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
                <span>{totalNotYet === 1 ? <><b className="text-ink">אחד</b> עוד לא הגיע</> : <><b className="num text-ink">{totalNotYet}</b> עוד לא הגיעו</>}</span>
                {/* each "·" travels with the item after it, so a wrapped line never ends on a separator */}
                {walkIns > 0 && <span className="whitespace-nowrap"><span aria-hidden="true">· </span><b className="num text-ink">{walkIns}</b> בלי הרשמה</span>}
                {updated && !stale && <span className="whitespace-nowrap text-muted"><span aria-hidden="true">· </span>עודכן <span className="num">{updated}</span></span>}
              </p>
            )}
          </div>
          {/* one live tile: how many are in */}
          {!forbidden && list.data && (
            <div className="shrink-0 rounded-[var(--radius-control)] bg-ink px-3 py-1.5 text-center text-light" aria-live="polite" aria-atomic="true">
              <div className="num font-display text-title-sm leading-none" aria-label={`הגיעו ${totalArrived}, מתוכם ${walkIns} בלי הרשמה. ${totalRegistered} רשומים`}>
                {totalArrived}
              </div>
              <div className="mt-0.5 text-micro font-medium" aria-hidden="true">הגיעו</div>
            </div>
          )}
        </div>

        {!forbidden && (
          <div className={cx('mt-2 flex gap-2', typing && 'max-sm:mt-0')}>
            {/* only the search field shrinks the header: a tap on "הגעה בלי הרשמה" focuses that button, and if the header
                collapsed under the finger the tap would land on nothing (two taps were needed) */}
            <div ref={searchBox} className="min-w-0 flex-1" onFocus={onSearchFocus} onBlur={onSearchBlur}>
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

        {stale && (
          <p role="status" className="mt-2 flex min-h-9 items-center gap-1.5 text-small font-semibold text-warn">
            <Icon name="alert" size={16} />
            <span>לא מעודכן{updated ? <> מ־<span className="num">{updated}</span></> : null}</span>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={retry} disabled={retrying} aria-busy={retrying || undefined}
              className="-my-1 inline-flex h-11 items-center rounded-[var(--radius-control)] px-1.5 underline underline-offset-2 hover:bg-warn/10">
              {RETRY_LABEL}
            </button>
          </p>
        )}

        {owingChip && (
          <div className={cx('mt-2 flex flex-wrap items-center gap-2', compact)}>
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
            {onlyOwing && <span className="ms-auto text-small text-muted">רק מי שעוד לא שילמו · <span className="num">{fmtMoney(price!)}</span></span>}
          </div>
        )}
      </div>

      <div className="pt-4">
        {e?.status === 'draft' && <div className="mb-3"><Notice tone="warn" icon="alert">המפגש עדיין טיוטה, ולכן אי אפשר לסמן הגעה.</Notice></div>}
        {e?.status === 'cancelled' && <div className="mb-3"><Notice tone="warn" icon="alert">המפגש בוטל.</Notice></div>}
        {e?.status === 'completed' && <div className="mb-3"><Notice tone="light" icon="alert">המפגש כבר נסגר. סימון כאן מתקן את הנוכחות (גם בדוחות), ומשימות המעקב מתעדכנות בהתאם.</Notice></div>}

        {ev.isError && !ev.data ? (
          <ErrorBox error={errorMessage(ev.error)} onRetry={() => ev.refetch()} />
        ) : forbidden ? (
          <Panel>
            <EmptyState
              icon="door"
              title={e && new Date(e.ends_at).getTime() < Date.now() ? 'הרשימה כבר נסגרה' : 'הרשימה עוד לא פתוחה'}
              action={<ButtonLink to="/app/door" variant="secondary" icon="back">למפגשים של היום</ButtonLink>}
            >
              לצוות הכניסה רשימת הנוכחות נפתחת 12 שעות לפני המפגש ונסגרת 12 שעות אחריו.
            </EmptyState>
          </Panel>
        ) : list.isLoading || ev.isLoading ? (
          <Skeleton shape="rows" count={6} height={78} />
        ) : list.isError && !list.data ? (
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
            {/* no "עוד לא הגיעו" heading to sit next to (all in, or the filter left none): the chip stays reachable */}
            {firstToggle && notYet.length === 0 && <div>{firstToggle}</div>}
            {filtering && shown.length === 0 && (
              // compact on purpose: with the keyboard open, the way forward ("הגעה בלי הרשמה") must be in view
              <div className="rounded-[var(--radius-panel)] border border-edge bg-paper p-4" role="status">
                <p className="text-heading font-bold">{term ? 'אין תוצאות לחיפוש הזה' : onlyOwing ? 'כולם שילמו' : 'אין כאן מי שמגיעים בפעם הראשונה'}</p>
                {term && <p className="mt-0.5 text-small text-muted">אין ברשימה את "{term}". אולי ההרשמה בשם אחר? אפשר לחפש גם לפי טלפון.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {term && !inactive && <Button size="lg" icon="userPlus" onClick={openWalkin}>הגעה בלי הרשמה</Button>}
                  <Button variant="ghost" size="lg" onClick={clearFilters}>ניקוי החיפוש והסינון</Button>
                </div>
              </div>
            )}
            {notYet.length > 0 && (
              <Section title="עוד לא הגיעו" count={notYet.length} action={firstToggle || undefined}>
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
              <Section title="ברשימת ההמתנה" count={waiting.length} hint="אם מגיעים ויש מקום, מסמנים הגעה כרגיל">
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

function Section({ title, count, hint, live, action, children }: {
  title: string; count: number; hint?: string; live?: boolean; action?: ReactNode; children: ReactNode;
}) {
  const heading = (
    <h2 className={cx('flex items-baseline gap-2 px-1 text-heading font-bold', !action && 'mb-2')}>
      {title}
      <span className="num text-small font-normal text-muted">({count})</span>
    </h2>
  );
  return (
    <section aria-live={live ? 'polite' : undefined}>
      {action ? <div className="mb-2 flex flex-wrap items-center justify-between gap-2">{heading}{action}</div> : heading}
      {hint && <p className="-mt-1 mb-2 px-1 text-small text-muted">{hint}</p>}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Row({ r, friday, disabled, owes, payHere, price, recent, onToggle, onPaid, failed, onRetry, menu }: {
  r: CheckinRow; friday: boolean; disabled: boolean; owes: boolean; payHere: boolean; price: number | null; recent?: boolean; onToggle: () => void; onPaid: () => void;
  /** the last tap on this row was not saved: what it asked for */
  failed?: 'attended' | 'unknown'; onRetry: () => void; menu: MenuItem[];
}) {
  const on = r.attendance === 'attended';
  const nth = r.prior_fridays + 1;
  const gone = r.status === 'cancelled';
  return (
    <li className={cx(
      'flex min-h-[4.75rem] items-center gap-3 rounded-[var(--radius-panel)] border py-2.5 pr-2.5 pl-1.5',
      gone ? 'border-edge bg-paper/60' : 'bg-paper',
      failed ? 'border-warn ring-1 ring-warn' : recent ? 'border-ink ring-1 ring-ink' : on ? 'border-ink/50' : !gone && 'border-edge',
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
        {/* names wrap (two lines at most) instead of being cut: at 320px a long name must still be readable */}
        <div className={cx('line-clamp-2 text-heading leading-snug font-bold break-words', gone && 'font-semibold text-muted')}>{r.display_name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-small text-muted">
          {r.phone_last4 && <span className="num" aria-label={`טלפון שמסתיים ב־${r.phone_last4}`}>••{r.phone_last4}</span>}
          {gone && <Badge size="md">ביטול</Badge>}
          {/* money owed and "בלי צילום" are never toned down at the door */}
          {owes && <Badge size="md" tone="warn" icon="alert">לא שולם</Badge>}
          {r.attendance === 'no_show' && <Badge size="md" tone="bad" icon="alert">סומנה אי־הגעה</Badge>}
          {r.photo_opt_out && (
            <span className="inline-flex items-center gap-1 font-semibold text-bad" title="בקשה לא להופיע בתמונות">
              <Icon name="noCamera" size={17} label="לא מצלמים" />
              בלי צילום
            </span>
          )}
          {r.first_time && <Badge size="md" tone="first" icon="heart">פעם ראשונה</Badge>}
          {friday && !r.first_time && isMilestone(nth) && <Badge size="md" icon="star" title={`מפגש שישי מספר ${nth}. כדאי לברך!`}>מפגש שישי {nth}</Badge>}
          {r.is_member && <Badge size="md" title="חברות בעמותה">חברות בעמותה</Badge>}
          {r.is_walk_in && <Badge size="md">בלי הרשמה</Badge>}
          {r.invited_by && <span title="מי הזמין">בהזמנת {r.invited_by}</span>}
          {r.status === 'waitlisted' && r.waitlist_position && <span>רשימת המתנה <span className="num">#{r.waitlist_position}</span></span>}
          {price != null && r.payment_status === 'paid' && r.cash_just_marked && <span className="inline-flex items-center gap-1"><Icon name="check" size={14} />שולם במקום</span>}
          {on && r.checked_in_at && (
            <span>
              <span className="num">{fmtTime(r.checked_in_at)}</span>
              {r.checkin_method === 'self_qr' ? ' · סריקת QR' : ''}
            </span>
          )}
        </div>
        {failed && (
          <p role="alert" className="mt-1 flex items-center gap-x-1 text-small font-semibold whitespace-nowrap text-warn">
            <Icon name="alert" size={16} className="shrink-0" />
            {failed === 'attended' ? 'לא נשמר' : 'ההסרה לא נשמרה'}
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onRetry} disabled={disabled}
              className="-my-1 inline-flex h-11 items-center rounded-[var(--radius-control)] px-1 underline underline-offset-2 hover:bg-warn/10">
              {failed === 'attended' ? 'לסמן שוב' : RETRY_LABEL}
            </button>
          </p>
        )}
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
  // typed details are not lost to a stray tap outside the dialog
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!open) setDirty(false); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="הגעה בלי הרשמה" size="sm" dismissible={!dirty}>
      {open && <WalkinForm key={`${initial.name}|${initial.phone}`} initial={initial} onClose={onClose} eventId={eventId} price={price} onDone={onDone} onDirty={setDirty} />}
    </Dialog>
  );
}

function WalkinForm({ initial, onClose, eventId, price, onDone, onDirty }: {
  initial: { name: string; phone: string }; onClose: () => void; eventId: string; price: number | null; onDone: (registrationId: string | null) => void;
  onDirty: (dirty: boolean) => void;
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
  const dirty = name !== initial.name || phone !== initial.phone || !!city || !!age || !!source || paid;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  /** The note for the toast: the cash was recorded with the arrival, or it had been paid before (nothing to take). */
  const cashNote = (recorded: boolean | undefined) => (price == null ? '' : recorded ? ' · שולם במקום' : ' · כבר שולם, אין לגבות');
  /** At a meeting with a fee the arrival is saved only together with the cash taken here (the database insists too). */
  const needPaid = () => {
    if (price == null || paid) return false;
    setErrors({ form: `למפגש יש דמי השתתפות: ההגעה נרשמת רק יחד עם התשלום במקום (${fmtMoney(price)}).` });
    return true;
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
      const { data, error } = await supabase.rpc('staff_checkin_existing', { p_event_id: eventId, p_participant_id: p.participant_id, p_cash: price != null && paid });
      if (error) throw error;
      const d = data as { registration_id?: string; cash_recorded?: boolean } | null;
      return { ...p, rid: d?.registration_id ?? null, cash: cashNote(d?.cash_recorded) };
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
        p_cash: price != null && paid,
      });
      if (error) throw error;
      const r = data as { registration_id: string; participant_is_new: boolean; already_registered: boolean; card_name?: string | null; cash_recorded?: boolean };
      return { ...r, cash: cashNote(r.cash_recorded) };
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
    if (!normalizePhone(phone)) errs.phone = `צריך מספר טלפון נייד, למשל ${PHONE_EXAMPLE}.`;
    if (age.trim() && !(Number(age) >= 16 && Number(age) <= 99)) errs.age = 'הגיל צריך להיות בין 16 ל־99. אפשר גם להשאיר ריק.';
    setErrors(errs);
    if (Object.keys(errs).length || needPaid()) return;
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
                <button type="button" disabled={pick.isPending} onClick={() => { if (!needPaid()) pick.mutate(p); }}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] bg-paper px-3 text-right hover:ring-2 hover:ring-tide/40">
                  <span className="font-semibold">{p.full_name}{p.city ? <span className="font-normal text-muted"> · {p.city}</span> : null}</span>
                  {p.phone_last4 && <span className="num text-small text-muted">••{p.phone_last4}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Input label="טלפון" required type="tel" inputMode="tel" ltr autoFocus={!!initial.name} value={phone} onChange={(x) => setPhone(x.target.value)} error={errors.phone} hint={`למשל ${PHONE_EXAMPLE}`} autoComplete="off" />
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
          onClick={() => { setPaid((v) => !v); setErrors((x) => ({ ...x, form: undefined })); }}
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
            <span className="block text-small text-muted">{paid ? 'התשלום במזומן יירשם עם ההגעה' : 'חובה במפגש בתשלום: ההגעה נרשמת רק יחד עם התשלום'}</span>
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
