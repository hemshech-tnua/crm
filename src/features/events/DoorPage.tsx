import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useSources } from '@/lib/data';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { normalizePhone } from '@/lib/phone';
import { Badge, Button, EmptyState, ErrorBox, Input, Notice, Panel, Select, Skeleton, cx } from '@/ui/kit';
import { Dialog, useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { eventKeys, fetchCheckinList, useDoorEvent, useInvalidateEvent, type CheckinRow } from './queries';
import { RowMenu, inDoorWindow, timeRange } from './shared';

const firstName = (n: string) => n.split(' ')[0];
/** The 5th, 10th, 20th… Friday is a milestone worth greeting at the door. */
const isMilestone = (n: number) => n === 5 || (n >= 10 && n % 10 === 0);

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
  const [search, setSearch] = useState('');
  // rows marked in the last few seconds stay in place, so a wrong tap is fixed right where it happened
  const [justMarked, setJustMarked] = useState<Record<string, number>>({});
  const remember = (id: string) => {
    setJustMarked((m) => ({ ...m, [id]: Date.now() }));
    setTimeout(() => setJustMarked((m) => { const n = { ...m }; delete n[id]; return n; }), 6000);
  };
  const [walkin, setWalkin] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const setAttendance = useMutation({
    mutationKey: ['door', id],
    mutationFn: async (v: { row: CheckinRow; attendance: 'attended' | 'unknown' }) => {
      const { error } = await supabase.rpc('staff_set_attendance', { p_registration_id: v.row.registration_id, p_attendance: v.attendance });
      if (error) throw error;
      return v;
    },
    onMutate: async (v) => {
      if (v.attendance === 'attended') remember(v.row.registration_id);
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
      toast.error(`${firstName(v.row.display_name)}: לא נשמר. ${errorMessage(err)}`);
    },
    onSuccess: (v) => {
      if (v.attendance === 'attended') {
        toast.success(`${v.row.display_name} הגיע/ה`, { label: 'ביטול', run: () => setAttendance.mutate({ row: v.row, attendance: 'unknown' }) });
      } else {
        toast.success(`הסימון של ${v.row.display_name} הוסר`, { label: 'החזרה', run: () => setAttendance.mutate({ row: v.row, attendance: 'attended' }) });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['event', id] });
      qc.invalidateQueries({ queryKey: ['events'] });
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
      toast.success(`${firstName(row.display_name)} סומן/ה כמי שביטל/ה`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const askCancel = async (row: CheckinRow) => {
    const ok = await confirm({
      title: 'סימון ביטול',
      body: <>לסמן ש<b>{row.display_name}</b> ביטל/ה ולא יגיע/תגיע? המקום יתפנה. אם בכל זאת יגיע/תגיע, מסמנים הגעה כרגיל.</>,
      confirm: 'סימון ביטל/ה',
      cancel: 'חזרה',
      danger: true,
    });
    if (ok) cancelReg.mutate(row);
  };

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const term = search.trim();
  const digits = term.replace(/\D/g, '');
  const match = (r: CheckinRow) =>
    !term || r.display_name.includes(term) || r.display_name.toLowerCase().includes(term.toLowerCase()) || (digits.length >= 2 && (r.phone_last4 ?? '').includes(digits));
  const shown = rows.filter(match);
  const stays = (r: CheckinRow) => r.attendance === 'attended' && !!justMarked[r.registration_id];
  const arrived = shown.filter((r) => r.attendance === 'attended' && !stays(r)).sort((a, b) => (b.checked_in_at ?? '').localeCompare(a.checked_in_at ?? ''));
  const notYet = shown.filter((r) => (r.status === 'registered' && r.attendance !== 'attended') || stays(r));
  const waiting = shown.filter((r) => r.status === 'waitlisted' && r.attendance !== 'attended').sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0));
  const cancelled = shown.filter((r) => r.status === 'cancelled' && r.attendance !== 'attended');

  const totalArrived = rows.filter((r) => r.attendance === 'attended').length;
  const totalRegistered = rows.filter((r) => r.status === 'registered' && !r.is_walk_in).length;
  const walkIns = rows.filter((r) => r.is_walk_in && r.attendance === 'attended').length;
  const e = ev.data;
  const inactive = e && (e.status === 'draft' || e.status === 'cancelled');
  const forbidden = outside || (list.isError && errorCode(list.error) === 'forbidden');

  const rowProps = (r: CheckinRow) => ({
    r,
    friday: e?.type === 'friday',
    disabled: !!inactive,
    onToggle: () => setAttendance.mutate({ row: r, attendance: r.attendance === 'attended' ? 'unknown' : 'attended' }),
    menu: r.status !== 'cancelled' && r.attendance !== 'attended' ? [{ label: 'סימון ביטל/ה', icon: 'close' as const, danger: true, onClick: () => askCancel(r) }] : [],
  });

  return (
    <div className="mx-auto max-w-2xl">
      {/* sticky header: event, live counter, search */}
      <div className="sticky top-14 z-20 -mx-4 -mt-5 border-b border-line bg-mist/95 px-4 pt-3 pb-3 backdrop-blur sm:-mx-6 sm:px-6 md:top-0 md:-mx-10 md:-mt-9 md:px-10 md:pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={can.manage(role) ? `/app/events/${id}` : '/app/door'} className="inline-flex items-center gap-1 text-sm font-medium text-tide">
              <Icon name="back" size={16} />
              {can.manage(role) ? 'לעמוד המפגש' : 'כניסה'}
            </Link>
            <h1 className="truncate font-display text-[1.45rem] leading-tight">{e?.title ?? 'רשימת נוכחות'}</h1>
            {e && <div className="text-sm text-muted">{fmtDayLong(e.starts_at)} · <span className="num">{timeRange(e)}</span></div>}
          </div>
          {!forbidden && <div className="shrink-0 rounded-[var(--radius-control)] bg-light px-3.5 py-1.5 text-center text-ink" aria-live="polite">
            <div className="num font-display text-[2rem] leading-none">{totalArrived}</div>
            <div className="text-xs font-semibold">הגיעו</div>
          </div>}
        </div>
        {!forbidden && <>
        <div className="mt-1.5 text-[0.95rem] font-medium text-ink-soft">
          הגיעו <span className="num font-bold text-ink">{totalArrived}</span> · רשומים <span className="num font-bold text-ink">{totalRegistered}</span>
          {walkIns > 0 && <> · בלי הרשמה <span className="num font-bold text-ink">{walkIns}</span></>}
        </div>
        <div className="mt-2.5 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-faint" />
            <input
              type="search"
              inputMode="search"
              aria-label="חיפוש לפי שם או 4 ספרות אחרונות"
              placeholder="שם או 4 ספרות"
              value={search}
              onChange={(x) => setSearch(x.target.value)}
              className="h-14 w-full rounded-[var(--radius-control)] border border-line bg-paper pr-11 pl-3 text-[1.05rem] placeholder:text-faint focus:border-tide focus:ring-2 focus:ring-tide/20 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setWalkin(/\d/.test(term) ? '' : term)}
            disabled={!!inactive || forbidden}
            className="flex h-14 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-tide px-3.5 font-semibold text-white hover:bg-tide-deep disabled:bg-faint"
          >
            <Icon name="userPlus" size={20} />
            <span className="text-right text-[0.9rem] leading-tight">הגיע/ה<br />בלי הרשמה</span>
          </button>
        </div>
        </>}
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
            <EmptyState icon="people" title="עוד אין רשומים" action={!inactive ? <Button size="lg" icon="userPlus" onClick={() => setWalkin('')}>הגיע/ה בלי הרשמה</Button> : undefined}>
              מי שמגיע/ה בלי הרשמה נרשם/ת כאן בשנייה.
            </EmptyState>
          </Panel>
        ) : (
          <div className="flex flex-col gap-6">
            {term && shown.length === 0 && (
              <Panel>
                <EmptyState icon="search" title={`אין ברשימה את "${term}"`} action={!inactive ? <Button size="lg" icon="userPlus" onClick={() => setWalkin(/\d/.test(term) ? '' : term)}>הגיע/ה בלי הרשמה</Button> : undefined}>
                  אולי נרשם/ה בשם אחר? אפשר לחפש לפי 4 הספרות האחרונות של הטלפון.
                </EmptyState>
              </Panel>
            )}
            {notYet.length > 0 && (
              <Section title="עוד לא הגיעו" count={notYet.length}>
                {notYet.map((r) => <Row key={r.registration_id} {...rowProps(r)} />)}
              </Section>
            )}
            {!term && notYet.length === 0 && totalRegistered > 0 && (
              <p className="flex items-center gap-2 rounded-[var(--radius-control)] bg-good-wash px-4 py-3 font-semibold text-good">
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
            <p className="text-center text-sm text-muted">
              כל סימון נשמר מיד. הרשימה מתעדכנת לבד כל 15 שניות{list.dataUpdatedAt ? <>, עודכנה ב-<span className="num">{fmtTime(new Date(list.dataUpdatedAt))}</span></> : null}.
            </p>
          </div>
        )}
      </div>

      <WalkinDialog
        open={walkin !== null}
        initialName={walkin ?? ''}
        onClose={() => setWalkin(null)}
        eventId={id}
        onDone={() => setSearch('')}
      />
    </div>
  );
}

function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[1.05rem] font-bold">
        {title}
        <span className="num text-sm font-normal text-muted">({count})</span>
      </h2>
      {hint && <p className="-mt-1 mb-2 px-1 text-sm text-muted">{hint}</p>}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Row({ r, friday, disabled, onToggle, menu }: {
  r: CheckinRow; friday: boolean; disabled: boolean; onToggle: () => void; menu: { label: string; icon: 'close'; danger: boolean; onClick: () => void }[];
}) {
  const on = r.attendance === 'attended';
  const nth = r.prior_fridays + 1;
  return (
    <li className={cx('flex min-h-[4.75rem] items-center gap-3 rounded-[var(--radius-panel)] border bg-paper py-2.5 pr-2.5 pl-1.5', on ? 'border-good/40' : 'border-line-soft')}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={on}
        aria-label={on ? `${r.display_name} הגיע/ה. לחיצה מבטלת` : `סימון ש${r.display_name} הגיע/ה`}
        className={cx(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border-2 transition-colors active:scale-95 disabled:opacity-50',
          on ? 'border-good bg-good text-white' : 'border-tide/50 bg-paper text-tide hover:bg-tide-wash',
        )}
      >
        {on ? <Icon name="check" size={30} strokeWidth={3} /> : <span aria-hidden="true" className="h-7 w-7 rounded-full border-[3px] border-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-[1.1rem] font-bold leading-snug', r.status === 'cancelled' && 'text-muted')}>{r.display_name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {r.phone_last4 && <span className="num" aria-label={`טלפון שמסתיים ב-${r.phone_last4}`}>••{r.phone_last4}</span>}
          {r.first_time && <Badge tone="tide" icon="sparkle">פעם ראשונה</Badge>}
          {friday && !r.first_time && isMilestone(nth) && <Badge tone="good" icon="star" title={`מפגש השישי ה-${nth} שלו/ה. כדאי לברך!`}>מפגש שישי {nth}</Badge>}
          {r.photo_opt_out && (
            <span className="inline-flex items-center gap-1 font-semibold text-bad" title="לא מעוניין/ת להופיע בתמונות">
              <Icon name="noCamera" size={17} label="לא מצלמים" />
              בלי צילום
            </span>
          )}
          {r.is_walk_in && <Badge tone="neutral">בלי הרשמה</Badge>}
          {r.status === 'waitlisted' && r.waitlist_position && <span>בהמתנה <span className="num">#{r.waitlist_position}</span></span>}
          {r.attendance === 'no_show' && <Badge tone="bad">סומן/ה לא הגיע/ה</Badge>}
          {on && r.checked_in_at && (
            <span>
              <span className="num">{fmtTime(r.checked_in_at)}</span>
              {r.checkin_method === 'self_qr' ? ' · סרק/ה QR' : ''}
            </span>
          )}
        </div>
      </div>
      {menu.length > 0 && !disabled && <RowMenu items={menu} big label={`פעולות נוספות ל${r.display_name}`} />}
    </li>
  );
}

// ───────────── walk-in ─────────────

function WalkinDialog({ open, initialName, onClose, eventId, onDone }: {
  open: boolean; initialName: string; onClose: () => void; eventId: string; onDone: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="הגיע/ה בלי הרשמה" size="sm">
      {open && <WalkinForm key={initialName} initialName={initialName} onClose={onClose} eventId={eventId} onDone={onDone} />}
    </Dialog>
  );
}

function WalkinForm({ initialName, onClose, eventId, onDone }: { initialName: string; onClose: () => void; eventId: string; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const sources = useSources();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [age, setAge] = useState('');
  const [source, setSource] = useState('');
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; age?: string; form?: string }>({});

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
      const { error } = await supabase.rpc('staff_checkin_existing', { p_event_id: eventId, p_participant_id: p.participant_id });
      if (error) throw error;
      return p;
    },
    onSuccess: async (p) => {
      await invalidate(eventId);
      toast.success(`${p.full_name} מוכר/ת ממפגשים קודמים, וסומן/ה שהגיע/ה`);
      onDone();
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
      return data as { registration_id: string; participant_is_new: boolean; already_registered: boolean; card_name?: string | null };
    },
    onSuccess: async (r) => {
      await invalidate(eventId);
      const first = firstName(name.trim());
      toast.success(
        r.card_name ? `המספר הזה שייך ל${r.card_name}. ההגעה נרשמה בכרטיס שלו/ה, והצוות יראה שנכתב שם אחר.`
        : r.already_registered ? `${first} כבר היה/תה ברשימה, וסומן/ה שהגיע/ה`
          : r.participant_is_new ? `${first} נוסף/ה וסומן/ה שהגיע/ה. ברוך/ה הבא/ה!`
            : `${first} מוכר/ת ממפגשים קודמים, וסומן/ה שהגיע/ה`,
      );
      onDone();
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
    if (!normalizePhone(phone)) errs.phone = 'מספר הטלפון לא נראה תקין. כותבים כמו 050-1234567.';
    if (age.trim() && !(Number(age) >= 16 && Number(age) <= 99)) errs.age = 'גיל בין 16 ל-99, או להשאיר ריק.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    add.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Input label="שם מלא" required autoFocus={!initialName} value={name} onChange={(x) => setName(x.target.value)} error={errors.name} autoComplete="off" maxLength={80} />
      {(suggestions.data?.length ?? 0) > 0 && !phone && (
        <div className="rounded-[var(--radius-control)] border border-tide/30 bg-tide-wash p-3" aria-live="polite">
          <p className="mb-2 text-sm font-semibold text-tide-deep">כבר מכירים? אם זה אחד מאלה, לוחצים עליו במקום להוסיף כרטיס חדש:</p>
          <ul className="flex flex-col gap-1.5">
            {suggestions.data!.map((p) => (
              <li key={p.participant_id}>
                <button type="button" disabled={pick.isPending} onClick={() => pick.mutate(p)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] bg-paper px-3 text-right hover:ring-2 hover:ring-tide/40">
                  <span className="font-semibold">{p.full_name}{p.city ? <span className="font-normal text-muted"> · {p.city}</span> : null}</span>
                  {p.phone_last4 && <span className="num text-sm text-muted">••{p.phone_last4}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Input label="טלפון" required type="tel" inputMode="tel" ltr autoFocus={!!initialName} value={phone} onChange={(x) => setPhone(x.target.value)} error={errors.phone} placeholder="050-1234567" autoComplete="off" />
      {more ? (
        <>
          <Input label="עיר" value={city} onChange={(x) => setCity(x.target.value)} maxLength={60} autoComplete="off" />
          <Input label="גיל" type="number" inputMode="numeric" ltr value={age} onChange={(x) => setAge(x.target.value)} error={errors.age} min={16} max={99} />
          <Select label="איך שמע/ה עלינו" value={source} onChange={(x) => setSource(x.target.value)}>
            <option value="">לא ידוע</option>
            {(sources.data ?? []).filter((s) => s.is_active).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="h-11 self-start font-semibold text-tide">הוספת עיר, גיל ומקור (לא חובה)</button>
      )}
      {errors.form && <p className="text-sm font-medium text-bad" role="alert">{errors.form}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="lg" icon="check" busy={add.isPending}>רישום וסימון הגעה</Button>
        <Button variant="ghost" size="lg" onClick={onClose}>ביטול</Button>
      </div>
    </form>
  );
}
