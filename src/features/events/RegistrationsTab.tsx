import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import type { EventWithStats } from '@/lib/data';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { fmtListDate, ilParts } from '@/lib/dates';
import { PHONE_EXAMPLE, formatPhone, normalizePhone } from '@/lib/phone';
import { ATTENDANCE_LABEL, COUNT_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, REG_STATUS_LABEL, freePlaces } from '@/lib/labels';
import { isPriced } from '@/lib/money';
import { csvFileName, downloadFile, toCsv } from '@/lib/csv';
import type { RegStatus } from '@/lib/types';
import { Badge, Button, Checkbox, EmptyState, ErrorBox, FilterChips, IconButton, Input, Notice, Panel, SearchInput, Skeleton, Spinner, Td, Th, cx } from '@/ui/kit';
import { Dialog, useConfirm, useToast } from '@/ui/feedback';
import { MoreMenu } from '@/ui/MoreMenu';
import { Icon } from '@/ui/Icon';
import { MessageComposer } from '@/ui/MessageComposer';
import type { EventPeople } from './context';
import { cleanSearch, useEventRegistrations, useInvalidateEvent, type RegRow } from './queries';
import { RowMenu, hasStarted, useDebounced, type MenuItem } from './shared';
import { ConfirmPaymentDialog, PaymentBadge, PaymentDialog, showsPayment, type ConfirmTarget, type PaymentTarget } from './finance';
import { UnmatchedPayments } from './UnmatchedPayments';
import { nameError, phoneError } from '@/features/participants/shared';
import { NoResults } from '@/ui/toolbar';
import { SEARCH_PLACEHOLDER, matchesSearch, phoneTail } from '@/ui/search';

type Filter = 'all' | 'registered' | 'waitlisted' | 'unpaid' | 'attended' | 'no_show' | 'cancelled';
/** Owes the fee: a registered place, not paid, and not a no-show (a waitlisted place pays only once it is registered). */
const owes = (r: RegRow) => r.status === 'registered' && r.payment_status === 'pending' && r.attendance !== 'no_show';
/** Started a pay-first registration and did not pay: no place, not counted; the team may remind them. */
const startedUnpaid = (r: RegRow) => r.status === 'pending_payment';
/** A registration made before the meeting (an active registration); a walk-in is counted apart ("בלי הרשמה"). */
const isRegistered = (r: RegRow) => r.status === 'registered' && !r.is_walk_in;
const FILTERS: { value: Filter; label: string; test: (r: RegRow) => boolean }[] = [
  { value: 'all', label: COUNT_LABEL.all, test: () => true },
  { value: 'registered', label: COUNT_LABEL.registered, test: isRegistered },
  { value: 'waitlisted', label: COUNT_LABEL.waitlisted, test: (r) => r.status === 'waitlisted' },
  { value: 'unpaid', label: COUNT_LABEL.unpaid, test: (r) => owes(r) || startedUnpaid(r) },
  { value: 'attended', label: COUNT_LABEL.attended, test: (r) => r.attendance === 'attended' },
  { value: 'no_show', label: COUNT_LABEL.no_show, test: (r) => r.status === 'registered' && r.attendance === 'no_show' },
  { value: 'cancelled', label: COUNT_LABEL.cancelled, test: (r) => r.status === 'cancelled' },
];
/** Links made before the filters were merged (?filter=active / pending_payment) still land on the right list. */
const LEGACY: Record<string, Filter> = { active: 'all', pending_payment: 'unpaid' };
const initial = (v: string | null): Filter => (v && LEGACY[v]) || (FILTERS.some((f) => f.value === v) ? (v as Filter) : 'all');
const STATUS_RANK: Record<RegStatus, number> = { registered: 0, waitlisted: 1, pending_payment: 2, cancelled: 3 };

type ComposerState = { reg: RegRow; keys?: string[]; defaultKey?: string };

export function RegistrationsTab({ event: e, people, initialFilter }: { event: EventWithStats; people: EventPeople; initialFilter: string | null }) {
  const role = useRole();
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateEvent();
  const q = useEventRegistrations(e);
  const [filter, setFilter] = useState<Filter>(initial(initialFilter));
  // a link to another list (?filter=…) while the tab is open moves the chips with it
  useEffect(() => { if (initialFilter) setFilter(initial(initialFilter)); }, [initialFilter]);
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<PaymentTarget | null>(null);
  const [confirming, setConfirming] = useState<ConfirmTarget | null>(null);
  const started = hasStarted(e);
  const priced = isPriced(e.price);
  const paysFirst = priced && !!e.payment_url;
  const confirmFor = (r: RegRow) => setConfirming({ id: r.id, name: r.participant?.full_name ?? null });
  const payFor = (r: RegRow) => setPaying({
    id: r.id, name: r.participant?.full_name ?? null, payment_status: r.payment_status, paid_amount: r.paid_amount,
    payment_method: r.payment_method, payment_ref: r.payment_ref,
  });

  const rows = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.registered_at.localeCompare(b.registered_at)),
    [q.data],
  );
  const waitPos = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter((r) => r.status === 'waitlisted').forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [rows]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter(f.test).length])) as Record<Filter, number>, [rows]);

  const term = search.trim();
  const shown = rows
    .filter(FILTERS.find((f) => f.value === filter)!.test)
    .filter((r) => matchesSearch(term, { name: r.participant?.full_name, phone: r.participant?.phone }));

  // one count definition everywhere: registered (before the meeting) · walk-ins ("בלי הרשמה") · places taken of capacity
  const registered = counts.registered;
  const walkIns = rows.filter((r) => r.status === 'registered' && r.is_walk_in).length;
  const waiting = counts.waitlisted;
  const free = freePlaces(registered, walkIns, e.capacity);
  const canRegister = e.status !== 'cancelled' && e.status !== 'completed';
  const owing = rows.filter(owes).length;
  const notStarted = rows.filter(startedUnpaid).length;

  // ── mutations ──
  const promote = useMutation({
    mutationFn: async (r: RegRow) => {
      const { error } = await supabase.rpc('staff_promote', { p_registration_id: r.id });
      if (error) throw error;
      return r;
    },
    onSuccess: async (r) => {
      await invalidate(e.id);
      toast.success(`ההרשמה של ${r.participant?.full_name ?? ''} עברה לרשומים`);
      if (r.participant?.phone) setComposer({ reg: { ...r, status: 'registered' }, keys: ['waitlist_promoted'], defaultKey: 'waitlist_promoted' });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const cancelReg = useMutation({
    mutationFn: async (r: RegRow) => {
      const { error } = await supabase.rpc('staff_cancel_registration', { p_registration_id: r.id, p_reason: null });
      if (error) throw error;
      return r;
    },
    onSuccess: async (r) => {
      await invalidate(e.id);
      toast.success(`ההרשמה של ${r.participant?.full_name ?? ''} בוטלה`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const reRegister = useMutation({
    mutationFn: async (r: RegRow) => {
      const { data, error } = await supabase.rpc('staff_register', { p_event_id: e.id, p_participant_id: r.participant_id, p_over_capacity: false });
      if (error) throw error;
      return { r, status: (data as { status: RegStatus }).status };
    },
    onSuccess: async ({ r, status }) => {
      await invalidate(e.id);
      toast.success(status === 'waitlisted' ? `המפגש מלא: ${r.participant?.full_name ?? ''} ברשימת ההמתנה` : `ההרשמה של ${r.participant?.full_name ?? ''} חודשה`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const attendance = useMutation({
    mutationFn: async (v: { r: RegRow; attendance: 'attended' | 'no_show' | 'unknown' }) => {
      const { error } = await supabase.rpc('staff_set_attendance', { p_registration_id: v.r.id, p_attendance: v.attendance });
      if (error) throw error;
      return v;
    },
    onSuccess: async (v) => {
      await invalidate(e.id);
      const who = v.r.participant?.full_name ?? '';
      toast.success(v.attendance === 'attended' ? `ההגעה של ${who} סומנה` : v.attendance === 'no_show' ? `אי־ההגעה של ${who} סומנה` : `סימון ההגעה של ${who} הוסר`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const askCancel = async (r: RegRow) => {
    const ok = await confirm({
      title: 'ביטול הרשמה',
      body: <>לבטל את ההרשמה של <b>{r.participant?.full_name}</b>? {r.status === 'registered' && waiting > 0 ? 'המקום יתפנה, ואפשר יהיה לקדם מרשימת ההמתנה.' : 'המקום יתפנה.'}</>,
      confirm: 'ביטול ההרשמה',
      cancel: 'לא, להשאיר את ההרשמה',
      danger: true,
    });
    if (ok) cancelReg.mutate(r);
  };

  const exportCsv = async () => {
    const { error } = await supabase.rpc('log_export', { p_kind: 'event_registrations', p_rows: shown.length });
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    const csv = toCsv(shown, [
      { header: 'שם', value: (r) => r.participant?.full_name },
      { header: 'טלפון', value: (r) => formatPhone(r.participant?.phone) },
      { header: 'עיר', value: (r) => r.participant?.city },
      { header: 'סטטוס', value: (r) => REG_STATUS_LABEL[r.status] },
      { header: 'נוכחות', value: (r) => ATTENDANCE_LABEL[r.attendance] },
      { header: 'הגעה בלי הרשמה', value: (r) => (r.is_walk_in ? 'כן' : '') },
      { header: 'פעם ראשונה', value: (r) => (r.first_time ? 'כן' : '') },
      { header: 'מועד הרשמה', value: (r) => fmtListDate(r.registered_at, { weekday: false }) },
      { header: 'מקור הגעה', value: (r) => r.source?.label },
      { header: 'מי הפנה', value: (r) => r.referrer?.full_name ?? r.referrer_name },
      { header: 'קישור', value: (r) => r.link?.label },
      { header: 'צ׳ק־אין', value: (r) => (r.checkin_method === 'self_qr' ? 'עצמי (QR)' : r.checkin_method === 'staff' ? 'צוות' : '') },
      ...(priced || rows.some((r) => r.payment_status !== 'none') ? [
        { header: 'תשלום', value: (r: RegRow) => (r.payment_status === 'none' ? '' : PAYMENT_STATUS_LABEL[r.payment_status]) },
        { header: 'סכום ששולם', value: (r: RegRow) => r.paid_amount },
        { header: 'אמצעי תשלום', value: (r: RegRow) => (r.payment_method ? PAYMENT_METHOD_LABEL[r.payment_method] : '') },
        { header: 'אסמכתה', value: (r: RegRow) => r.payment_ref },
      ] : []),
    ]);
    downloadFile(csvFileName(`נרשמים ${e.title}`, ilParts(e.starts_at).date.split('-').reverse().join('.')), csv);
    toast.success('הקובץ ירד');
  };

  const menuFor = (r: RegRow): MenuItem[] => {
    const items: MenuItem[] = [];
    if (r.participant && !r.participant.anonymized_at) items.push({ label: 'פתיחת הכרטיס', icon: 'people', onClick: () => navigate(`/app/participants/${r.participant_id}`) });
    if (started && r.status === 'registered' && r.attendance !== 'attended') items.push({ label: 'סימון הגעה', icon: 'check', onClick: () => attendance.mutate({ r, attendance: 'attended' }) });
    if (started && r.status === 'registered' && r.attendance !== 'no_show') items.push({ label: 'סימון אי־הגעה', icon: 'close', onClick: () => attendance.mutate({ r, attendance: 'no_show' }) });
    if (r.status === 'pending_payment') items.push({ label: 'אישור תשלום', icon: 'check', onClick: () => confirmFor(r) });
    else if ((priced && r.status !== 'cancelled') || r.payment_status === 'paid' || r.payment_status === 'refunded' || r.payment_status === 'waived') {
      items.push({ label: owes(r) ? 'סימון תשלום' : 'עדכון תשלום', icon: 'check', onClick: () => payFor(r) });
    }
    if (r.status === 'cancelled' && canRegister) items.push({ label: 'רישום מחדש', icon: 'undo', onClick: () => reRegister.mutate(r) });
    if (r.status !== 'cancelled') items.push({ label: 'ביטול ההרשמה', icon: 'close', danger: true, onClick: () => askCancel(r) });
    return items;
  };

  const openComposer = (r: RegRow) => {
    const key = r.attendance === 'attended' ? 'thanks' : r.attendance === 'no_show' ? 'missed_you' : r.status === 'registered' ? (started ? undefined : 'reminder') : undefined;
    setComposer({ reg: r, defaultKey: key });
  };
  const toReminders = () => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'messages'); n.set('group', 'unpaid'); n.delete('filter'); return n; });
  const clear = () => { setSearch(''); setFilter('all'); };

  if (q.isLoading) return <Skeleton shape="rows" count={6} height={72} />;
  // a failed refresh keeps the list on screen (the offline bar says the connection dropped); an error only when nothing loaded
  if (q.isError && !q.data) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  const addButton = canRegister ? <Button icon="userPlus" onClick={() => setAdding(true)}>הוספת נרשם</Button> : null;
  const chips = FILTERS
    // show the exceptions only where they can happen: unpaid with a fee, absent after the meeting starts
    .filter((f) => (f.value !== 'unpaid' || priced || counts.unpaid > 0) && (f.value !== 'no_show' || counts.no_show > 0) && (f.value !== 'attended' || started || counts.attended > 0))
    .map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }));

  return (
    <div className="flex flex-col gap-4">
      {/* the counts are in the status strip above the tabs (said once); here only the tab's own actions */}
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {can.admin(role) && rows.length > 0 && <Button variant="ghost" icon="download" onClick={exportCsv}>ייצוא לאקסל</Button>}
          {addButton}
        </div>
      </div>

      {waiting > 0 && (free == null || free > 0) && canRegister && !started && (
        <Notice tone="light" icon="userPlus">
          {free == null ? 'אין הגבלת מקומות' : free === 1 ? 'יש מקום פנוי אחד' : `יש ${free} מקומות פנויים`}, ו־<b className="num">{waiting}</b> ברשימת ההמתנה. מקדמים לפי הסדר ושולחים הודעה "התפנה מקום".{' '}
          {filter !== 'waitlisted' && <button type="button" className="font-bold underline" onClick={() => setFilter('waitlisted')}>לרשימת ההמתנה</button>}
        </Notice>
      )}

      {paysFirst && <UnmatchedPayments eventId={e.id} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <FilterChips label="סינון לפי סטטוס" value={filter} onChange={setFilter} className="min-w-0 flex-1" options={chips} />
        <div className="shrink-0 sm:mr-auto sm:w-64">
          <SearchInput value={search} onChange={setSearch} placeholder={SEARCH_PLACEHOLDER} label="חיפוש בנרשמים" />
        </div>
      </div>

      {filter === 'unpaid' && counts.unpaid > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-control)] border border-edge bg-paper px-3.5 py-2.5 text-small text-ink-soft">
          <span className="flex-1">
            {owing > 0 && <><span className="num font-bold text-ink">{owing}</span> רשומים עוד לא שילמו{notStarted > 0 ? ' · ' : ''}</>}
            {notStarted > 0 && <><span className="num font-bold text-ink">{notStarted}</span> התחילו הרשמה ולא שילמו (אין להם מקום עד התשלום)</>}
          </span>
          <Button size="sm" variant="secondary" icon="message" onClick={toReminders}>תזכורת תשלום בוואטסאפ</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon="people" title="עוד אין נרשמים" action={addButton ?? undefined}>
            {e.status === 'draft' ? 'המפגש עדיין טיוטה. אחרי פתיחת ההרשמה משתפים את הקישור.' : 'משתפים את קישור ההרשמה (בלשונית "סקירה"), ומי שפנה בטלפון מוסיפים כאן.'}
          </EmptyState>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel>
          <NoResults onClear={clear} title={term ? undefined : 'אין כאן אף אחד כרגע'} icon={term ? 'search' : 'filter'}>
            {term && canRegister ? 'מי שפנה בטלפון ועוד לא רשום? מוסיפים בכפתור "הוספת נרשם".' : undefined}
          </NoResults>
        </Panel>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5 md:hidden">
            {shown.map((r) => (
              <li key={r.id} className={cx('rounded-[var(--radius-panel)] border border-edge bg-paper p-4', r.status === 'cancelled' && 'opacity-75')}>
                <div className="flex items-start justify-between gap-2">
                  <NameCell r={r} />
                  <StatusCell r={r} pos={waitPos.get(r.id)} started={started} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-small text-ink-soft">
                  {r.participant?.phone && <a href={`tel:${r.participant.phone}`} className="num text-tide">{formatPhone(r.participant.phone)}</a>}
                  {r.participant?.city && <span>{r.participant.city}</span>}
                  <span className="text-muted">הרשמה <span className="tabular-nums">{fmtListDate(r.registered_at)}</span></span>
                </div>
                <SourceCell r={r} className="mt-1" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {r.participant?.phone && <Button size="sm" variant="secondary" icon="message" onClick={() => openComposer(r)}>וואטסאפ</Button>}
                  {r.status === 'waitlisted' && <Button size="sm" icon="userPlus" busy={promote.isPending && promote.variables?.id === r.id} onClick={() => promote.mutate(r)}>קידום לרשומים</Button>}
                  {owes(r) && <Button size="sm" variant="secondary" icon="check" onClick={() => payFor(r)}>סימון תשלום</Button>}
                  {r.status === 'pending_payment' && <Button size="sm" variant="secondary" icon="check" onClick={() => confirmFor(r)}>אישור תשלום</Button>}
                  <div className="mr-auto"><RowMenu items={menuFor(r)} /></div>
                </div>
              </li>
            ))}
          </ul>

          {/* the kit's Th/Td; a narrow tablet scrolls the table sideways inside its frame (the row menus open in a
              layer of their own, so the scrolling frame does not clip them) */}
          <div className="relative hidden overflow-x-auto rounded-[var(--radius-panel)] border border-edge bg-paper md:block">
            <table className="w-full border-collapse text-body" aria-label="נרשמים">
              <thead>
                <tr>
                  <Th className="rounded-tr-[var(--radius-panel)]">שם</Th>
                  <Th>טלפון ועיר</Th>
                  <Th>סטטוס</Th>
                  <Th>מועד הרשמה</Th>
                  <Th>מקור הגעה</Th>
                  <Th className="rounded-tl-[var(--radius-panel)]"><span className="sr-only">פעולות</span></Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={cx('align-top', r.status === 'cancelled' && 'text-muted')}>
                    <Td className="py-3"><NameCell r={r} /></Td>
                    <Td className="py-3">
                      {r.participant?.phone && <a href={`tel:${r.participant.phone}`} className="num block text-right text-tide hover:underline">{formatPhone(r.participant.phone)}</a>}
                      <div className="text-small text-muted">{r.participant?.city ?? ''}</div>
                    </Td>
                    <Td className="py-3"><StatusCell r={r} pos={waitPos.get(r.id)} started={started} /></Td>
                    <Td className="py-3 text-right text-small text-ink-soft tabular-nums">{fmtListDate(r.registered_at)}</Td>
                    <Td className="py-3"><SourceCell r={r} /></Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'waitlisted' && <Button size="sm" icon="userPlus" busy={promote.isPending && promote.variables?.id === r.id} onClick={() => promote.mutate(r)}>קידום</Button>}
                        {owes(r) && <Button size="sm" variant="secondary" onClick={() => payFor(r)}>סימון תשלום</Button>}
                        {r.status === 'pending_payment' && <Button size="sm" variant="secondary" onClick={() => confirmFor(r)}>אישור תשלום</Button>}
                        {r.participant?.phone && (
                          <IconButton icon="message" label={`הודעת וואטסאפ ל${r.participant.full_name ?? ''}`} title="הודעת וואטסאפ" onClick={() => openComposer(r)} />
                        )}
                        <MoreMenu variant="icon" size="sm" items={menuFor(r)} label={`פעולות נוספות ל${r.participant?.full_name ?? 'נרשם'}`} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {composer?.reg.participant && (
        <MessageComposer
          key={`${composer.reg.id}-${composer.defaultKey ?? ''}`}
          open
          onClose={() => setComposer(null)}
          recipient={{
            id: composer.reg.participant.id,
            full_name: composer.reg.participant.full_name,
            phone: composer.reg.participant.phone,
            consent_updates: composer.reg.participant.consent_updates,
          }}
          context={people.ctx}
          templateKeys={composer.keys}
          defaultKey={composer.defaultKey}
          eventId={e.id}
          registrationId={composer.reg.id}
        />
      )}
      <PaymentDialog target={paying} event={e} onClose={() => setPaying(null)} />
      <ConfirmPaymentDialog target={confirming} event={e} onClose={() => setConfirming(null)} />
      <AddRegistrantDialog
        open={adding}
        onClose={() => setAdding(false)}
        e={e}
        regs={rows}
        free={free}
        onRegistered={(r) => r && setComposer({ reg: r, defaultKey: 'confirmation' })}
      />
    </div>
  );
}

function NameCell({ r }: { r: RegRow }) {
  const p = r.participant;
  // the normal case carries no badge; only what the team should notice does
  return (
    <div className="min-w-0">
      {p && !p.anonymized_at ? (
        <Link to={`/app/participants/${r.participant_id}`} className="font-bold hover:text-tide hover:underline">{p.full_name}</Link>
      ) : (
        <span className="font-bold text-muted">פרטים נמחקו</span>
      )}
      {(r.first_time && r.status !== 'cancelled') || r.is_walk_in || r.submitted_name || p?.photo_opt_out ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {r.first_time && r.status !== 'cancelled' && <Badge tone="first">פעם ראשונה</Badge>}
          {r.is_walk_in && <Badge tone="neutral">בלי הרשמה</Badge>}
          {r.submitted_name && (
            <Badge tone="warn" icon="alert" title="השם שהוקלד בהרשמה שונה מהשם בכרטיס. ייתכן שהוקלד טלפון של מישהו אחר: כדאי לברר.">
              הרשמה בשם: {r.submitted_name}
            </Badge>
          )}
          {p?.photo_opt_out && <Badge tone="neutral" icon="noCamera" title="בקשה לא להופיע בתמונות">בלי צילום</Badge>}
        </div>
      ) : null}
    </div>
  );
}

function StatusCell({ r, pos, started }: { r: RegRow; pos?: number; started: boolean }) {
  const quiet = 'text-small text-muted';
  return (
    <div className="flex flex-col items-start gap-1">
      {r.status === 'registered' && r.attendance === 'attended' ? (
        <Badge tone="good" icon="check">הגעה{r.checkin_method === 'self_qr' ? ' (QR)' : ''}</Badge>
      ) : r.status === 'registered' && r.attendance === 'no_show' ? (
        <Badge tone="neutral">אי־הגעה</Badge>
      ) : r.status === 'waitlisted' ? (
        <Badge tone="tide">רשימת המתנה{pos ? <span className="num"> #{pos}</span> : null}</Badge>
      ) : r.status === 'cancelled' ? (
        <span className={quiet}>ביטול{r.cancelled_by === 'staff' ? ' (צוות)' : ''}</span>
      ) : r.status === 'pending_payment' ? (
        <Badge tone="warn" icon="alert" title="התחילו הרשמה ועוד לא שילמו. אין להם מקום, והם לא נספרים ברשומים.">מחכה לתשלום</Badge>
      ) : (
        <span className={quiet}>{started ? 'עוד לא סומנה הגעה' : 'הרשמה פעילה'}</span>
      )}
      {showsPayment(r.status, r.payment_status) && !(r.payment_status === 'pending' && r.attendance === 'no_show') && (
        r.payment_status === 'pending' ? <PaymentBadge status="pending" /> : <PaymentNote status={r.payment_status} />
      )}
    </div>
  );
}

/** Paid, waived, refunded: worth knowing, not worth a badge. */
function PaymentNote({ status }: { status: RegRow['payment_status'] }) {
  if (status === 'paid') return <span className="inline-flex items-center gap-1 text-small text-ink-soft"><Icon name="check" size={13} strokeWidth={2.4} /><span>שולם</span></span>;
  if (status === 'waived') return <span className="text-small text-muted">פטור מתשלום</span>;
  if (status === 'refunded') return <span className="text-small text-muted">התשלום הוחזר</span>;
  return null;
}

function SourceCell({ r, className = '' }: { r: RegRow; className?: string }) {
  const parts: ReactNode[] = [];
  if (r.source) parts.push(<span key="s">{r.source.label}{r.how_heard_detail ? `: ${r.how_heard_detail}` : ''}</span>);
  if (r.link) parts.push(<span key="l" className="inline-flex items-center gap-1"><Icon name="link" size={14} />{r.link.label}</span>);
  if (r.referrer) parts.push(<span key="r">הפניה: <Link to={`/app/participants/${r.referrer.id}`} className="text-tide hover:underline">{r.referrer.full_name}</Link></span>);
  else if (r.referrer_name) parts.push(<span key="r">הפניה: {r.referrer_name}</span>);
  if (r.utm_source && !r.link) parts.push(<span key="u" dir="ltr" className="num">utm: {r.utm_source}</span>);
  if (!parts.length) return <span className={cx('text-small text-faint', className)}>{r.created_via === 'staff' ? 'הוספה על ידי הצוות' : '—'}</span>;
  return <div className={cx('flex flex-col gap-0.5 text-small text-ink-soft', className)}>{parts}</div>;
}

// ───────────── adding someone who phoned in: search, and if they are not there, a new card in the same dialog ─────────────

type Found = { id: string; full_name: string | null; phone: string | null; city: string | null };

function AddRegistrantDialog({ open, onClose, e, regs, free, onRegistered }: {
  open: boolean; onClose: () => void; e: EventWithStats; regs: RegRow[]; free: number | null; onRegistered: (r: RegRow | null) => void;
}) {
  // typing starts in the search right away (the dialog would otherwise focus its close button first)
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', touched: false });
  const [errors, setErrors] = useState<{ name?: string | null; phone?: string | null; form?: string | null }>({});
  const dq = useDebounced(q, 250);
  const term = cleanSearch(dq);
  const letters = term.replace(/[\d+-]/g, ' ').replace(/\s+/g, ' ').trim();
  // "דנה 4567" searches the name and the phone's end alike
  const digits = phoneTail(dq.replace(/[^\d+\s-]/g, ' ')) ?? '';
  const enabled = open && (letters.length >= 2 || digits.length >= 3);
  const existing = useMemo(() => new Map(regs.map((r) => [r.participant_id, r])), [regs]);

  // every opening starts clean
  useEffect(() => {
    if (!open) return;
    setQ(''); setOver(false); setCreating(false); setErrors({}); setForm({ name: '', phone: '', touched: false });
  }, [open]);

  const results = useQuery({
    queryKey: ['participant-search', letters, digits],
    enabled,
    queryFn: async () => {
      const ors: string[] = [];
      if (letters.length >= 2) ors.push(`full_name.ilike.*${letters}*`);
      // a phone matches by its end (the last digits, or the whole number in any format)
      if (digits.length >= 3) ors.push(`phone.like.*${digits}`);
      return must(
        await supabase.from('participants').select('id, full_name, phone, city').is('anonymized_at', null).or(ors.join(',')).order('full_name').limit(8),
      ) as Found[];
    },
  });
  const noMatch = enabled && results.isSuccess && results.data.length === 0;
  const showForm = creating || noMatch;
  // the new card starts from what was typed in the search (name and/or phone) until the form itself is edited
  useEffect(() => {
    if (!showForm || form.touched) return;
    setForm({ name: letters, phone: digits.length >= 3 ? dq.replace(/[^\d+\-\s]/g, '').trim() : '', touched: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, dq]);

  const finish = async (p: Found, status: RegStatus, regId: string) => {
    await invalidate(e.id);
    const send = () => onRegistered({
      id: regId, participant_id: p.id, status, participant: { id: p.id, full_name: p.full_name, phone: p.phone, city: p.city, consent_updates: false, photo_opt_out: false, anonymized_at: null },
    } as RegRow);
    if (status === 'waitlisted') toast.success(`המפגש מלא: ${p.full_name} ברשימת ההמתנה`);
    else toast.success(`ההרשמה של ${p.full_name} נשמרה`, p.phone ? { label: 'שליחת אישור', run: send } : undefined);
    onClose();
  };

  const register = useMutation({
    mutationFn: async (p: Found) => {
      const { data, error } = await supabase.rpc('staff_register', { p_event_id: e.id, p_participant_id: p.id, p_over_capacity: over });
      if (error) throw error;
      const d = data as { status: RegStatus; registration_id: string };
      return { p, status: d.status, regId: d.registration_id };
    },
    onSuccess: ({ p, status, regId }) => finish(p, status, regId),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('participants')
        .insert({ full_name: form.name.trim(), phone: normalizePhone(form.phone) })
        .select('id, full_name, phone, city').single();
      if (error) throw error;
      const p = data as Found;
      const r = await supabase.rpc('staff_register', { p_event_id: e.id, p_participant_id: p.id, p_over_capacity: over });
      if (r.error) return { p, regError: r.error };
      const d = r.data as { status: RegStatus; registration_id: string };
      return { p, status: d.status, regId: d.registration_id };
    },
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ['participants'] });
      if ('regError' in res) {
        toast.error(`הכרטיס של ${res.p.full_name} נוצר, אבל ההרשמה למפגש לא נשמרה: ${errorMessage(res.regError)}`);
        setCreating(false);
        setQ(res.p.full_name ?? '');
        return;
      }
      await finish(res.p, res.status!, res.regId!);
    },
    onError: (err) => {
      if (errorCode(err) === 'duplicate_phone') {
        // the card exists: show it in the results, where "רישום" is one click
        setErrors({ phone: 'כבר יש כרטיס עם הטלפון הזה. הוא מופיע למעלה.' });
        setQ(form.phone);
        setCreating(false);
        setForm((f) => ({ ...f, touched: false }));
      } else setErrors({ form: errorMessage(err) });
    },
  });

  const submitNew = (ev: FormEvent) => {
    ev.preventDefault();
    const next = { name: nameError(form.name), phone: phoneError(form.phone) };
    setErrors(next);
    if (!next.name && !next.phone) create.mutate();
  };
  const setField = (k: 'name' | 'phone', v: string) => { setForm((f) => ({ ...f, [k]: v, touched: true })); setErrors((x) => ({ ...x, [k]: null, form: null })); };
  const fullForm = `/app/participants/new?${new URLSearchParams({ event: e.id, ...(form.name.trim() ? { name: form.name.trim() } : {}), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) })}`;

  return (
    <Dialog open={open} onClose={onClose} title="הוספת נרשם" dismissible={!(form.touched && (form.name.trim() || form.phone.trim()))}>
      <div className="flex flex-col gap-4">
        <SearchInput ref={searchRef} value={q} onChange={(v) => { setQ(v); setErrors((x) => ({ ...x, phone: null })); }} placeholder={SEARCH_PLACEHOLDER} label="חיפוש כרטיס" />
        {!showForm && errors.phone && <p className="-mt-2 text-small font-medium text-ink" role="status">{errors.phone}</p>}
        {free === 0 && (
          <Checkbox label="לרשום גם אם אין מקום" hint="בלי סימון, ההרשמה תיכנס לרשימת ההמתנה" checked={over} onChange={setOver} />
        )}
        {!enabled ? (
          <p className="text-small text-muted">מקלידים לפחות 2 אותיות מהשם או 3 ספרות מהטלפון. אם אין כרטיס, יוצרים אותו כאן.</p>
        ) : results.isLoading ? (
          <div className="flex justify-center py-4 text-muted"><Spinner /></div>
        ) : results.isError ? (
          <ErrorBox error={errorMessage(results.error)} />
        ) : results.data?.length ? (
          <ul className="flex flex-col divide-y divide-edge" aria-label="כרטיסים שנמצאו">
            {results.data.map((p) => {
              const reg = existing.get(p.id);
              // started a paid registration and did not pay: the team may still register them
              const active = reg && reg.status !== 'cancelled' && reg.status !== 'pending_payment';
              return (
                <li key={p.id} className="flex min-h-14 items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{p.full_name}</div>
                    <div className="text-small text-muted">
                      <span className="num">{formatPhone(p.phone)}</span>{p.city ? ` · ${p.city}` : ''}
                    </div>
                  </div>
                  {active ? (
                    <Badge tone="tide">{REG_STATUS_LABEL[reg.status]}</Badge>
                  ) : (
                    <Button size="sm" variant="secondary" busy={register.isPending && register.variables?.id === p.id} onClick={() => register.mutate(p)}>
                      {reg ? 'רישום מחדש' : 'רישום'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {enabled && !showForm && results.isSuccess && (
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 self-start text-small font-semibold text-tide hover:underline" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />לא ברשימה? כרטיס חדש ורישום
          </button>
        )}

        {showForm && (
          <form onSubmit={submitNew} noValidate className="flex flex-col gap-3 border-t border-edge pt-4" aria-label="כרטיס חדש ורישום למפגש">
            <p className="text-small text-ink-soft">
              {noMatch ? <><b className="text-ink">אין כרטיס כזה.</b> יוצרים כרטיס ורושמים למפגש בבת אחת:</> : 'כרטיס חדש, ורישום למפגש בבת אחת:'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="שם מלא" required value={form.name} onChange={(x) => setField('name', x.target.value)} error={errors.name} maxLength={80} autoComplete="off" />
              <Input label="טלפון" required ltr type="tel" inputMode="tel" value={form.phone} onChange={(x) => setField('phone', x.target.value)} error={errors.phone} autoComplete="off" hint={`למשל ${PHONE_EXAMPLE}`} />
            </div>
            {errors.form && <p className="text-small font-medium text-bad" role="alert">{errors.form}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" icon="userPlus" busy={create.isPending}>יצירת כרטיס ורישום</Button>
              <Link to={fullForm} className="inline-flex min-h-11 items-center px-2 text-small font-semibold text-tide hover:underline">טופס מלא עם עוד פרטים</Link>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
