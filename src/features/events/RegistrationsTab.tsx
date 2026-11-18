import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import type { EventWithStats } from '@/lib/data';
import { errorMessage, must } from '@/lib/errors';
import { fmtDateTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { ATTENDANCE_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, REG_STATUS_LABEL } from '@/lib/labels';
import { isPriced } from '@/lib/money';
import { downloadFile, toCsv } from '@/lib/csv';
import type { RegStatus } from '@/lib/types';
import { Badge, Button, ButtonLink, Checkbox, EmptyState, ErrorBox, FilterChips, IconButton, Notice, Panel, SearchInput, Skeleton, Spinner, Td, Th, cx } from '@/ui/kit';
import { Dialog, useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { MessageComposer } from '@/ui/MessageComposer';
import type { EventPeople } from './context';
import { cleanSearch, useEventRegistrations, useInvalidateEvent, type RegRow } from './queries';
import { RowMenu, hasStarted, useDebounced, type MenuItem } from './shared';
import { PaymentBadge, PaymentDialog, showsPayment, type PaymentTarget } from './finance';

type Filter = 'active' | 'registered' | 'waitlisted' | 'unpaid' | 'attended' | 'no_show' | 'cancelled' | 'all';
/** Owes the fee: a registered place, not paid, and not a no-show (a waitlisted place pays only once it is registered). */
const owes = (r: RegRow) => r.status === 'registered' && r.payment_status === 'pending' && r.attendance !== 'no_show';
const FILTERS: { value: Filter; label: string; test: (r: RegRow) => boolean }[] = [
  { value: 'active', label: 'רשומים והמתנה', test: (r) => r.status !== 'cancelled' },
  { value: 'registered', label: 'רשומים', test: (r) => r.status === 'registered' },
  { value: 'waitlisted', label: 'בהמתנה', test: (r) => r.status === 'waitlisted' },
  { value: 'unpaid', label: 'לא שילמו', test: owes },
  { value: 'attended', label: 'הגיעו', test: (r) => r.attendance === 'attended' },
  { value: 'no_show', label: 'לא הגיעו', test: (r) => r.attendance === 'no_show' },
  { value: 'cancelled', label: 'ביטלו', test: (r) => r.status === 'cancelled' },
  { value: 'all', label: 'הכול', test: () => true },
];
const STATUS_RANK: Record<RegStatus, number> = { registered: 0, waitlisted: 1, cancelled: 2 };

type ComposerState = { reg: RegRow; keys?: string[]; defaultKey?: string };

export function RegistrationsTab({ event: e, people, initialFilter }: { event: EventWithStats; people: EventPeople; initialFilter: string | null }) {
  const role = useRole();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateEvent();
  const q = useEventRegistrations(e);
  const [filter, setFilter] = useState<Filter>(FILTERS.some((f) => f.value === initialFilter) ? (initialFilter as Filter) : 'active');
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<PaymentTarget | null>(null);
  const started = hasStarted(e);
  const priced = isPriced(e.price);
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

  const term = search.trim().toLowerCase();
  const digits = search.replace(/\D/g, '');
  const shown = rows
    .filter(FILTERS.find((f) => f.value === filter)!.test)
    .filter((r) => {
      if (!term) return true;
      const name = (r.participant?.full_name ?? '').toLowerCase();
      const phone = (r.participant?.phone ?? '').replace(/\D/g, '');
      return name.includes(term) || (digits.length >= 3 && phone.includes(digits.replace(/^0/, '')));
    });

  const registeredNow = rows.filter((r) => r.status === 'registered').length;
  const waiting = counts.waitlisted;
  const free = e.capacity == null ? null : Math.max(0, e.capacity - registeredNow);
  const canRegister = e.status !== 'cancelled' && e.status !== 'completed';

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
      toast.success(status === 'waitlisted' ? `המפגש מלא: ההרשמה של ${r.participant?.full_name ?? ''} ברשימת ההמתנה` : `ההרשמה של ${r.participant?.full_name ?? ''} חודשה`);
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
      toast.success(`${v.r.participant?.full_name ?? ''}: ${ATTENDANCE_LABEL[v.attendance]}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const askCancel = async (r: RegRow) => {
    const ok = await confirm({
      title: 'ביטול הרשמה',
      body: <>לבטל את ההרשמה של <b>{r.participant?.full_name}</b>? {r.status === 'registered' && waiting > 0 ? 'המקום יתפנה, ואפשר יהיה לקדם מרשימת ההמתנה.' : 'המקום יתפנה.'}</>,
      confirm: 'ביטול ההרשמה',
      cancel: 'חזרה',
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
      { header: 'מועד הרשמה', value: (r) => fmtDateTime(r.registered_at) },
      { header: 'מקור', value: (r) => r.source?.label },
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
    downloadFile(`registrations-${e.public_code}-${e.starts_at.slice(0, 10)}.csv`, csv);
    toast.success('הקובץ ירד. הייצוא נרשם ביומן הפעולות.');
  };

  const menuFor = (r: RegRow): MenuItem[] => {
    const items: MenuItem[] = [];
    if (r.participant && !r.participant.anonymized_at) items.push({ label: 'פתיחת הכרטיס', icon: 'people', onClick: () => navigate(`/app/participants/${r.participant_id}`) });
    if (started && r.status === 'registered' && r.attendance !== 'attended') items.push({ label: 'סימון הגעה', icon: 'check', onClick: () => attendance.mutate({ r, attendance: 'attended' }) });
    if (started && r.status === 'registered' && r.attendance !== 'no_show') items.push({ label: 'סימון אי־הגעה', icon: 'close', onClick: () => attendance.mutate({ r, attendance: 'no_show' }) });
    if ((priced && r.status !== 'cancelled') || r.payment_status === 'paid' || r.payment_status === 'refunded' || r.payment_status === 'waived') {
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

  if (q.isLoading) return <Panel><Skeleton lines={7} /></Panel>;
  if (q.isError) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canRegister && <Button icon="userPlus" onClick={() => setAdding(true)}>רישום ידני</Button>}
        <ButtonLink to="/app/participants/new" variant="secondary" icon="plus">כרטיס חדש</ButtonLink>
        {can.admin(role) && rows.length > 0 && <Button variant="ghost" icon="download" onClick={exportCsv}>ייצוא לאקסל</Button>}
      </div>

      {waiting > 0 && (free == null || free > 0) && canRegister && !started && (
        <Notice tone="light" icon="userPlus">
          {free == null ? 'אין הגבלת מקומות' : free === 1 ? 'יש מקום פנוי אחד' : `יש ${free} מקומות פנויים`}, ו-<b className="num">{waiting}</b> ממתינים ברשימה. מקדמים לפי הסדר ושולחים הודעה "התפנה מקום".{' '}
          {filter !== 'waitlisted' && <button type="button" className="font-bold underline" onClick={() => setFilter('waitlisted')}>לרשימת ההמתנה</button>}
        </Notice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <FilterChips label="סינון לפי סטטוס" value={filter} onChange={setFilter} className="min-w-0 flex-1"
          options={FILTERS.filter((f) => f.value !== 'unpaid' || priced || counts.unpaid > 0).map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
        <div className="shrink-0 sm:mr-auto sm:w-64">
          <SearchInput value={search} onChange={setSearch} placeholder="שם או טלפון" label="חיפוש בנרשמים" />
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon="people" title="עוד אין נרשמים" action={canRegister ? <Button icon="userPlus" onClick={() => setAdding(true)}>רישום ידני</Button> : undefined}>
            {e.status === 'draft' ? 'המפגש עדיין טיוטה. אחרי פתיחת ההרשמה משתפים את הקישור.' : 'משתפים את קישור ההרשמה (בלשונית "סקירה"), או רושמים ידנית מי שפנה בטלפון.'}
          </EmptyState>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel><EmptyState icon="filter" title="אין תוצאות">אין נרשמים שמתאימים לסינון או לחיפוש.</EmptyState></Panel>
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
                  <span className="text-muted">הרשמה <span className="num">{fmtDateTime(r.registered_at)}</span></span>
                </div>
                <SourceCell r={r} className="mt-1" />
                <div className="mt-3 flex items-center gap-2">
                  {r.participant?.phone && <Button size="sm" variant="secondary" icon="message" onClick={() => openComposer(r)}>וואטסאפ</Button>}
                  {r.status === 'waitlisted' && <Button size="sm" icon="userPlus" busy={promote.isPending && promote.variables?.id === r.id} onClick={() => promote.mutate(r)}>קידום לרשומים</Button>}
                  {owes(r) && <Button size="sm" variant="secondary" icon="check" onClick={() => payFor(r)}>סימון תשלום</Button>}
                  <div className="mr-auto"><RowMenu items={menuFor(r)} /></div>
                </div>
              </li>
            ))}
          </ul>

          {/* the kit's Th/Td, in a wrapper that does not clip: each row has a menu that opens below it */}
          <div className="hidden rounded-[var(--radius-panel)] border border-edge bg-paper md:block">
            <table className="w-full border-collapse text-body" aria-label="נרשמים">
              <thead>
                <tr>
                  <Th className="rounded-tr-[var(--radius-panel)]">שם</Th>
                  <Th>טלפון ועיר</Th>
                  <Th>סטטוס</Th>
                  <Th>מועד הרשמה</Th>
                  <Th>מקור</Th>
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
                    <Td className="num py-3 text-right text-small text-ink-soft">{fmtDateTime(r.registered_at)}</Td>
                    <Td className="py-3"><SourceCell r={r} /></Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'waitlisted' && <Button size="sm" icon="userPlus" busy={promote.isPending && promote.variables?.id === r.id} onClick={() => promote.mutate(r)}>קידום</Button>}
                        {owes(r) && <Button size="sm" variant="secondary" onClick={() => payFor(r)}>סימון תשלום</Button>}
                        {r.participant?.phone && (
                          <IconButton icon="message" label={`הודעת וואטסאפ ל${r.participant.full_name ?? ''}`} title="הודעת וואטסאפ" onClick={() => openComposer(r)} />
                        )}
                        <RowMenu items={menuFor(r)} />
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
      <ManualRegisterDialog
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
  return (
    <div className="min-w-0">
      {p && !p.anonymized_at ? (
        <Link to={`/app/participants/${r.participant_id}`} className="font-bold hover:text-tide hover:underline">{p.full_name}</Link>
      ) : (
        <span className="font-bold text-muted">פרטים נמחקו</span>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {r.first_time && r.status !== 'cancelled' && <Badge tone="tide" icon="sparkle">פעם ראשונה</Badge>}
        {r.is_walk_in && <Badge tone="neutral">הגעה בלי הרשמה</Badge>}
        {r.submitted_name && (
          <Badge tone="warn" icon="alert" title="השם שהוקלד בהרשמה שונה מהשם בכרטיס. ייתכן שהוקלד טלפון של מישהו אחר: כדאי לברר.">
            הרשמה בשם: {r.submitted_name}
          </Badge>
        )}
        {p?.photo_opt_out && <Badge tone="neutral" icon="noCamera" title="בקשה לא להופיע בתמונות">בלי צילום</Badge>}
      </div>
    </div>
  );
}

function StatusCell({ r, pos, started }: { r: RegRow; pos?: number; started: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {r.status === 'registered' && r.attendance === 'attended' ? (
        <Badge tone="good" icon="check">הגעה{r.checkin_method === 'self_qr' ? ' (QR)' : ''}</Badge>
      ) : r.status === 'registered' && r.attendance === 'no_show' ? (
        <Badge tone="bad" icon="alert">אי־הגעה</Badge>
      ) : r.status === 'waitlisted' ? (
        <Badge tone="warn" icon="alert">בהמתנה{pos ? <span className="num"> #{pos}</span> : null}</Badge>
      ) : r.status === 'cancelled' ? (
        <Badge tone="neutral">ביטול{r.cancelled_by === 'staff' ? ' (צוות)' : ''}</Badge>
      ) : (
        <Badge tone="tide">{started ? 'טרם סומנה הגעה' : 'הרשמה פעילה'}</Badge>
      )}
      {showsPayment(r.status, r.payment_status) && !(r.payment_status === 'pending' && r.attendance === 'no_show') && <PaymentBadge status={r.payment_status} />}
    </div>
  );
}

function SourceCell({ r, className = '' }: { r: RegRow; className?: string }) {
  const parts: ReactNode[] = [];
  if (r.source) parts.push(<span key="s">{r.source.label}{r.how_heard_detail ? `: ${r.how_heard_detail}` : ''}</span>);
  if (r.link) parts.push(<span key="l" className="inline-flex items-center gap-1"><Icon name="link" size={14} />{r.link.label}</span>);
  if (r.referrer) parts.push(<span key="r">הפניה: <Link to={`/app/participants/${r.referrer.id}`} className="text-tide hover:underline">{r.referrer.full_name}</Link></span>);
  else if (r.referrer_name) parts.push(<span key="r">הפניה: {r.referrer_name}</span>);
  if (r.utm_source && !r.link) parts.push(<span key="u" dir="ltr" className="num">utm: {r.utm_source}</span>);
  if (!parts.length) return <span className={cx('text-small text-faint', className)}>{r.created_via === 'staff' ? 'רישום ידני' : '—'}</span>;
  return <div className={cx('flex flex-col gap-0.5 text-small text-ink-soft', className)}>{parts}</div>;
}

// ───────────── manual registration ─────────────

type Found = { id: string; full_name: string | null; phone: string | null; city: string | null };

function ManualRegisterDialog({ open, onClose, e, regs, free, onRegistered }: {
  open: boolean; onClose: () => void; e: EventWithStats; regs: RegRow[]; free: number | null; onRegistered: (r: RegRow | null) => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const dq = useDebounced(q, 250);
  const term = cleanSearch(dq);
  const digits = dq.replace(/\D/g, '');
  const enabled = open && (term.replace(/\d/g, '').trim().length >= 2 || digits.length >= 3);
  const existing = useMemo(() => new Map(regs.map((r) => [r.participant_id, r])), [regs]);

  const results = useQuery({
    queryKey: ['participant-search', term, digits],
    enabled,
    queryFn: async () => {
      const ors: string[] = [];
      const name = term.replace(/\d/g, '').trim();
      if (name.length >= 2) ors.push(`full_name.ilike.*${name}*`);
      if (digits.length >= 3) ors.push(`phone.like.*${digits.replace(/^0/, '')}*`);
      return must(
        await supabase.from('participants').select('id, full_name, phone, city').is('anonymized_at', null).or(ors.join(',')).order('full_name').limit(8),
      ) as Found[];
    },
  });

  const register = useMutation({
    mutationFn: async (p: Found) => {
      const { data, error } = await supabase.rpc('staff_register', { p_event_id: e.id, p_participant_id: p.id, p_over_capacity: over });
      if (error) throw error;
      return { p, status: (data as { status: RegStatus; registration_id: string }).status, regId: (data as { registration_id: string }).registration_id };
    },
    onSuccess: async ({ p, status, regId }) => {
      await invalidate(e.id);
      const send = () => onRegistered({
        id: regId, participant_id: p.id, status, participant: { id: p.id, full_name: p.full_name, phone: p.phone, city: p.city, consent_updates: false, photo_opt_out: false, anonymized_at: null },
      } as RegRow);
      if (status === 'waitlisted') toast.success(`המפגש מלא: ההרשמה של ${p.full_name} ברשימת ההמתנה`);
      else toast.success(`ההרשמה של ${p.full_name} נשמרה`, p.phone ? { label: 'שליחת אישור', run: send } : undefined);
      setQ('');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={open} onClose={onClose} title="רישום ידני למפגש">
      <div className="flex flex-col gap-4">
        <SearchInput value={q} onChange={setQ} placeholder="שם או מספר טלפון" label="חיפוש כרטיס" />
        {free === 0 && (
          <Checkbox
            label="לרשום גם מעבר למכסה"
            hint="בלי סימון, הרישום ייכנס לרשימת ההמתנה"
            checked={over}
            onChange={setOver}
          />
        )}
        {!enabled ? (
          <p className="text-small text-muted">מקלידים לפחות 2 אותיות מהשם, או 3 ספרות מהטלפון.</p>
        ) : results.isLoading ? (
          <div className="flex justify-center py-4 text-muted"><Spinner /></div>
        ) : results.isError ? (
          <ErrorBox error={errorMessage(results.error)} />
        ) : results.data?.length ? (
          <ul className="flex flex-col divide-y divide-edge">
            {results.data.map((p) => {
              const reg = existing.get(p.id);
              const active = reg && reg.status !== 'cancelled';
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{p.full_name}</div>
                    <div className="text-small text-muted">
                      <span className="num">{formatPhone(p.phone)}</span>{p.city ? ` · ${p.city}` : ''}
                    </div>
                  </div>
                  {active ? (
                    <Badge tone="tide">{REG_STATUS_LABEL[reg.status]}</Badge>
                  ) : (
                    <Button size="sm" busy={register.isPending && register.variables?.id === p.id} onClick={() => register.mutate(p)}>
                      {reg ? 'רישום מחדש' : 'רישום'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-small text-muted">לא נמצאו לוחמים בשם או במספר הזה.</p>
        )}
        <div className="border-t border-edge pt-3 text-small text-ink-soft">
          לא במערכת? <Link to="/app/participants/new" className="font-semibold text-tide hover:underline">יצירת כרטיס חדש</Link>, ואז חוזרים לכאן לרישום.
        </div>
      </div>
    </Dialog>
  );
}
