import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useReferralLinks, useSettings, useSources, type EventWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { addDays, fmtDateTime, fmtDayLong, fromIl, ilParts, todayIl } from '@/lib/dates';
import { checkinUrl, feedbackUrl, registerUrl } from '@/lib/links';
import { downloadFile } from '@/lib/csv';
import { pct, ratio } from '@/lib/metrics';
import { Badge, Button, ButtonLink, Input, KeyValue, Notice, Panel, Select, Textarea, cx } from '@/ui/kit';
import type { IconName } from '@/ui/Icon';
import { Dialog, useConfirm, useCopy, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { Logo } from '@/ui/Logo';
import { Stripes, Tri } from '@/ui/Shapes';
import type { EventTab } from './EventPage';
import { dataUrlToBlob, type EventPeople } from './context';
import { useInvalidateEvent } from './queries';
import { BigStat, LinkRow, QrImage, freeText, hasEnded, hasStarted, isUnclosed, seats, timeRange } from './shared';
import { MoreMenu, type MoreMenuItem } from '@/ui/MoreMenu';
import { FinancePanel, useEventFinance } from './finance';
import { isOverdue, useEventTasks, useTickMany } from '@/features/prep/shared';
import { slotsFor } from '@/features/volunteers/model';
import { useShifts } from '@/features/volunteers/queries';
import { fmtMoney, isPriced } from '@/lib/money';
import './entrance-sign.css';

type Props = { event: EventWithStats; people: EventPeople; onTab: (t: EventTab, extra?: Record<string, string>) => void };

export function OverviewTab({ event: e, people, onTab }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {e.status === 'draft' && <OpenChecklist e={e} people={people} onTab={onTab} />}
      <Counters e={e} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Facts e={e} people={people} />
          <FinancePanel e={e} onUnpaid={() => onTab('registrations', { filter: 'unpaid' })} onStarted={() => onTab('registrations', { filter: 'pending_payment' })} onExpenses={() => onTab('prep')} />
        </div>
        <div className="flex flex-col gap-5">
          <LinksPanel e={e} />
          <EntrancePanel e={e} />
        </div>
      </div>
    </div>
  );
}

// ───────────── counters ─────────────

function Counters({ e }: { e: EventWithStats }) {
  const s = e.stats;
  const started = hasStarted(e);
  const st = seats(e);
  if (e.status === 'cancelled' && !st.registered && !st.waitlisted) return null;
  // one definition everywhere: "24 רשומים · 2 בלי הרשמה · 26 מתוך 28", free = capacity − (registered + walk-ins)
  const regSub = [st.walkIns ? `${st.walkIns} בלי הרשמה` : null, st.capacity != null ? `${st.taken} מתוך ${st.capacity}` : null, freeText(e)].filter(Boolean).join(' · ');
  return (
    <section aria-label="מספרים" className={cx('grid gap-3', started && e.status !== 'cancelled' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
      {started && e.status !== 'cancelled' && (
        <BigStat highlight label="הגיעו" value={s?.attended_count ?? 0} sub={s?.walk_in_count ? `מתוכם ${s.walk_in_count} בלי הרשמה` : undefined} />
      )}
      <BigStat highlight={!started && e.status === 'open'} label="רשומים" value={st.registered} sub={regSub} />
      <BigStat label="רשימת המתנה" value={st.waitlisted} />
      <BigStat label="ביטלו" value={s?.cancelled_count ?? 0} />
      {started && e.status !== 'cancelled' && (
        <>
          <BigStat label="חדשים" value={s?.new_count ?? 0} />
          <BigStat label="חוזרים" value={s?.returning_count ?? 0} />
          <BigStat label="לא הגיעו" value={s?.no_show_count ?? 0} sub={e.status !== 'completed' ? 'מסומנים בסגירת המפגש' : undefined} />
          <BigStat label="צ׳ק־אין עצמי" value={pct(ratio(s?.self_checkin_count ?? 0, s?.attended_count ?? 0))} sub="מתוך מי שהגיעו" />
        </>
      )}
    </section>
  );
}

// ───────────── facts ─────────────

function Facts({ e, people }: { e: EventWithStats; people: EventPeople }) {
  const sp = people.speaker;
  return (
    <Panel title="פרטי המפגש" actions={<ButtonLink to={`/app/events/${e.id}/edit`} variant="ghost" size="sm" icon="edit">עריכה</ButtonLink>}>
      <KeyValue
        items={[
          ['מתי', <span key="w">{fmtDayLong(e.starts_at)} · <span className="num whitespace-nowrap">{timeRange(e)}</span></span>],
          ['מקום', people.place ? <span key="p">{people.place}{people.site && people.site.name !== people.place ? <span className="text-muted"> · {people.site.name}</span> : null}</span> : null],
          ['פעילות', e.activity_name || people.instructor ? <span key="a">{e.activity_name ?? 'פעילות'}{people.instructor ? <span className="text-muted"> עם {people.instructor.full_name}</span> : null}</span> : null],
          ['מרצה', sp ? (
            <span key="s" className="inline-flex flex-wrap items-center gap-1.5">
              {sp.full_name}
              {sp.status !== 'approved' && <Badge tone="neutral">{sp.status === 'proposed' ? 'מחכה לאישור' : 'בלי אישור'}</Badge>}
            </span>
          ) : e.type === 'friday' ? <span key="s" className="text-muted">עוד אין</span> : null],
          ['נושא', e.lecture_topic],
          ['מקומות', e.capacity != null ? <span key="c"><span className="num">{e.capacity}</span>{e.waitlist_enabled ? ' · עם רשימת המתנה' : ' · בלי רשימת המתנה'}</span> : 'בלי הגבלה'],
          ['השתתפות', isPriced(e.price) ? (
            <span key="pr"><span className="num">{fmtMoney(e.price)}</span>{e.payment_url
              ? <> · <a href={e.payment_url} target="_blank" rel="noopener noreferrer" className="text-tide hover:underline">קישור לתשלום</a></>
              : <span className="text-muted"> · משלמים בכניסה</span>}{e.payment_note ? <span className="text-muted"> · {e.payment_note}</span> : null}</span>
          ) : 'בלי תשלום'],
          ['סגירת הרשמה', e.registration_closes_at ? <span key="r" className="num">{fmtDateTime(e.registration_closes_at)}</span> : 'כשהמפגש מתחיל'],
          ['תיאור', e.description ? <span key="d" className="whitespace-pre-line">{e.description}</span> : null],
          ['הערות לצוות', e.internal_notes ? <span key="n" className="whitespace-pre-line">{e.internal_notes}</span> : null],
        ]}
      />
    </Panel>
  );
}

// ───────────── actions ─────────────

type CompleteResult = { no_shows: number; tasks_no_show: number; tasks_first_time: number; tasks_lapsed: number };

/**
 * Everything the meeting can do, by stage (draft → open/closed → running → over → completed / cancelled):
 * `primary` is the one next step, `secondary` stays visible next to it, `menu` holds the rest ("⋯ עוד", destructive
 * last). `dialogs` must be rendered once wherever the hook is used.
 */
export function useMeetingActions(e: EventWithStats, onTab: Props['onTab']) {
  const role = useRole();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const copy = useCopy();
  const invalidate = useInvalidateEvent();
  const qc = useQueryClient();
  const settings = useSettings();
  const [dupOpen, setDupOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [result, setResult] = useState<CompleteResult | null>(null);
  const tasks = useEventTasks(e.id);
  const tick = useTickMany();
  // tasks of the meeting day (and before) still open: offered in one tap once the meeting is closed
  const meetingDay = ilParts(e.starts_at).date;
  const dayOpen = (tasks.data ?? []).filter((t) => t.kind === 'task' && !t.dismissed && !t.done_at && !!t.due_date && t.due_date <= meetingDay);

  const now = Date.now();
  const started = hasStarted(e, now);
  const ended = hasEnded(e, now);
  const doorSoon = new Date(e.starts_at).getTime() - now < 12 * 3600_000 && !ended;
  const active = e.status === 'open' || e.status === 'closed';
  const s = e.stats;

  const regCount = useQuery({
    queryKey: ['event-registrations', e.id, 'count'],
    enabled: can.admin(role),
    queryFn: async () => {
      const { count, error } = await supabase.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', e.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const setStatus = useMutation({
    mutationFn: async (status: 'open' | 'closed') => {
      const { error } = await supabase.from('events').update({ status }).eq('id', e.id).select('id').single();
      if (error) throw error;
      return status;
    },
    onSuccess: async (status) => {
      await invalidate(e.id);
      toast.success(status === 'open' ? 'ההרשמה נפתחה. אפשר לשתף את הקישור.' : 'ההרשמה נסגרה');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('staff_complete_event', { p_event_id: e.id });
      if (error) throw error;
      return data as CompleteResult;
    },
    onSuccess: async (r) => {
      await invalidate(e.id);
      void qc.invalidateQueries({ queryKey: ['followups'] });
      setResult(r);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('events').delete().eq('id', e.id).select('id');
      if (error) throw error;
      if (!data?.length) throw { message: 'forbidden' };
    },
    onSuccess: () => {
      // leave first: refetching the deleted event would fail
      navigate('/app/events', { replace: true });
      toast.success('המפגש נמחק');
      setTimeout(() => {
        qc.removeQueries({ queryKey: ['event', e.id] });
        qc.removeQueries({ queryKey: ['event-registrations', e.id] });
        qc.invalidateQueries({ queryKey: ['events'] });
      }, 0);
    },
    onError: (err) => toast.error((err as { code?: string }).code === '23503' ? 'יש למפגש הרשמות, ולכן אי אפשר למחוק אותו. אפשר לבטל אותו.' : errorMessage(err)),
  });

  const askComplete = async () => {
    const st = settings.data;
    const attended = s?.attended_count ?? 0;
    const unmarked = Math.max(0, (s?.registered_count ?? 0) - (s?.attended_registered_count ?? 0) - (s?.no_show_count ?? 0));
    const tasks = [
      st?.auto_task_no_show !== false && '"חסרת לנו" ושיחה לכל מי שלא הגיע',
      st?.auto_task_first_time !== false && 'שיחת היכרות לכל מי שהגיע בפעם הראשונה',
      st?.auto_task_lapsed !== false && 'פנייה לקבועים שהפסיקו להגיע',
    ].filter(Boolean) as string[];
    const ok = await confirm({
      title: 'סגירת המפגש',
      confirm: 'סגירת המפגש',
      body: (
        <div className="flex flex-col gap-2.5">
          {attended === 0 && (s?.registered_count ?? 0) > 0 && (
            <Notice tone="warn" icon="alert">
              עוד לא סומנה אף הגעה. אם המפגש התקיים, כדאי לסמן קודם מי הגיעו (ב"מצב כניסה"). אחרת כל <b className="num">{s?.registered_count}</b> הרשומים יסומנו כאי־הגעה ויקבלו משימת מעקב.
            </Notice>
          )}
          <p>מה יקרה עכשיו:</p>
          <ul className="flex list-disc flex-col gap-1.5 pr-5">
            <li>
              {unmarked > 0 ? <><b className="num">{unmarked}</b> רשומים שלא סומנו כהגעה יסומנו כאי־הגעה.</> : 'כל הרשומים כבר מסומנים. אף אחד לא יסומן אוטומטית כאי־הגעה.'}
            </li>
            {tasks.length > 0 && <li>ייפתחו משימות מעקב: {tasks.join('; ')}.</li>}
            <li>המפגש יסומן "התקיים" וייכנס לדוחות ולמדדים.</li>
          </ul>
          <p className="text-sm text-muted">אפשר לתקן נוכחות גם אחרי הסגירה, בלשונית "נרשמים".</p>
        </div>
      ),
    });
    if (ok) complete.mutate();
  };

  const askOpen = async () => {
    if (e.type === 'friday' && !e.speaker_id) {
      const ok = await confirm({
        title: 'פתיחת הרשמה בלי מרצה?',
        body: 'עוד אין מרצה למפגש. אפשר לפתוח הרשמה עכשיו ולהוסיף מרצה ונושא אחר כך.',
        confirm: 'פתיחת הרשמה',
      });
      if (!ok) return;
    }
    setStatus.mutate('open');
  };

  const askDelete = async () => {
    const ok = await confirm({
      title: 'מחיקת המפגש',
      body: 'המפגש יימחק לגמרי, כולל הקישורים שלו. אין בו הרשמות. אי אפשר לשחזר.',
      confirm: 'מחיקה',
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const copyLink = () => copy(registerUrl(e.public_code), 'קישור ההרשמה הועתק');
  const doorTo = `/app/events/${e.id}/door`;

  // the one next step, by stage
  let primary: ReactNode = null;
  let primaryKey: 'open' | 'complete' | 'door' | 'copy' | 'reopen' | 'dup' | null = null;
  if (e.status === 'draft') {
    primaryKey = 'open';
    primary = <Button key="open" icon="check" cta busy={setStatus.isPending} onClick={askOpen}>פתיחת הרשמה</Button>;
  } else if (active && ended) {
    primaryKey = 'complete';
    primary = <Button key="complete" icon="checkCircle" cta busy={complete.isPending} onClick={askComplete}>סגירת המפגש</Button>;
  } else if (active && (started || doorSoon)) {
    primaryKey = 'door';
    primary = <ButtonLink key="door" icon="door" cta to={doorTo}>מצב כניסה</ButtonLink>;
  } else if (e.status === 'open') {
    primaryKey = 'copy';
    primary = <Button key="copy" icon="copy" cta onClick={copyLink}>העתקת קישור ההרשמה</Button>;
  } else if (e.status === 'closed') {
    primaryKey = 'reopen';
    primary = <Button key="reopen" icon="undo" cta busy={setStatus.isPending} onClick={() => setStatus.mutate('open')}>פתיחת הרשמה מחדש</Button>;
  } else if (e.status === 'completed') {
    primaryKey = 'dup';
    primary = <Button key="dup" icon="copy" cta onClick={() => setDupOpen(true)}>שכפול לשבוע הבא</Button>;
  }

  const secondary: ReactNode[] = [];
  // while it runs, closing is one step away (the door is the main thing)
  if (active && started && !ended) {
    secondary.push(<Button key="complete" variant="secondary" icon="checkCircle" busy={complete.isPending} onClick={askComplete}>סגירת המפגש</Button>);
  }
  secondary.push(<ButtonLink key="edit" variant="secondary" icon="edit" to={`/app/events/${e.id}/edit`}>עריכה</ButtonLink>);

  const menu: MoreMenuItem[] = [];
  if (e.status === 'open' && primaryKey !== 'copy') menu.push({ label: 'העתקת קישור ההרשמה', icon: 'copy', onClick: copyLink });
  if ((active || e.status === 'completed') && primaryKey !== 'door') {
    menu.push({ label: active && !ended ? 'מצב כניסה' : 'רשימת נוכחות', icon: 'door', onClick: () => navigate(doorTo) });
  }
  if (e.status === 'open' && !started) menu.push({ label: 'סגירת הרשמה', icon: 'close', disabled: setStatus.isPending, onClick: () => setStatus.mutate('closed') });
  if (e.status === 'closed' && !started && primaryKey !== 'reopen') menu.push({ label: 'פתיחת הרשמה מחדש', icon: 'undo', disabled: setStatus.isPending, onClick: () => setStatus.mutate('open') });
  if (primaryKey !== 'dup') menu.push({ label: 'שכפול לשבוע הבא', icon: 'copy', onClick: () => setDupOpen(true) });
  if ((e.status === 'draft' || active) && !ended) menu.push({ label: 'ביטול המפגש', icon: 'close', danger: true, onClick: () => setCancelOpen(true) });
  if (can.admin(role) && regCount.data === 0) menu.push({ label: 'מחיקת המפגש', danger: true, disabled: remove.isPending, onClick: askDelete });

  const dialogs = (
    <>
      <DuplicateDialog open={dupOpen} onClose={() => setDupOpen(false)} e={e} />
      <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} e={e} onTab={onTab} />
      <Dialog
        open={!!result}
        onClose={() => setResult(null)}
        title="המפגש נסגר"
        footer={
          <>
            <ButtonLink to={`/app/followups?event=${e.id}`} icon="task">למשימות המעקב של המפגש</ButtonLink>
            <Button variant="secondary" onClick={() => { setResult(null); onTab('summary'); }} icon="chart">לסיכום המפגש</Button>
            <Button variant="ghost" onClick={() => setResult(null)}>סגירה</Button>
          </>
        }
      >
        {result && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <BigStat label="הגיעו" value={s?.attended_count ?? 0} highlight />
              <BigStat label="לא הגיעו" value={result.no_shows} />
            </div>
            <KeyValue
              items={[
                ['משימות "חסרת לנו"', <span key="1" className="num">{result.tasks_no_show}</span>],
                ['שיחות היכרות לחדשים', <span key="2" className="num">{result.tasks_first_time}</span>],
                ['קבועים שהפסיקו להגיע', <span key="3" className="num">{result.tasks_lapsed}</span>],
              ]}
            />
            <p className="text-sm text-muted">המשימות מחכות במסך "מעקב". כדאי לשלוח לכל מי שהגיע הודעת תודה עם קישור למשוב (לשונית "הודעות").</p>
            {dayOpen.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
                <span className="text-sm">{dayOpen.length === 1 ? 'משימת הכנה אחת עד יום המפגש עדיין פתוחה.' : <><span className="num">{dayOpen.length}</span> משימות הכנה עד יום המפגש עדיין פתוחות.</>}</span>
                <Button size="sm" variant="secondary" icon="check" busy={tick.isPending} onClick={() => tick.mutate(dayOpen.map((t) => t.id))}>סימון שבוצעו</Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );

  return { primary, secondary, menu, dialogs, askComplete, askOpen, openDuplicate: () => setDupOpen(true), completing: complete.isPending, opening: setStatus.isPending };
}

/**
 * The meeting's actions in the page header: the stage's one primary step, "עריכה", and "⋯ עוד".
 * Links may ask for a dialog: `?dup=1` opens the duplicate dialog, `?close=1` the closing confirmation.
 */
export function EventHeaderActions({ e, onTab }: { e: EventWithStats; onTab: Props['onTab'] }) {
  const a = useMeetingActions(e, onTab);
  const [params, setParams] = useSearchParams();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    const dup = params.get('dup') === '1';
    const close = params.get('close') === '1' && isUnclosed(e);
    if (!dup && !params.has('close')) return;
    asked.current = true;
    const next = new URLSearchParams(params);
    next.delete('dup');
    next.delete('close');
    setParams(next, { replace: true });
    if (dup) a.openDuplicate();
    else if (close) void a.askComplete();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {a.primary}
      {a.secondary}
      <MoreMenu items={a.menu} />
      {a.dialogs}
    </>
  );
}

// ───────────── status at a glance ─────────────

type StripItem = { key: string; icon?: IconName; text: ReactNode; state: 'done' | 'todo' | 'warn' | 'info'; go: () => void; label: string };

/**
 * One line under the title: places, speaker, coach, volunteers, payments and tasks. Each item opens its tab.
 * ✓ when done, muted when still missing, the warning colour only for what needs doing today (late tasks).
 */
export function EventStatusStrip({ e, people, onTab }: { e: EventWithStats; people: EventPeople; onTab: Props['onTab'] }) {
  const navigate = useNavigate();
  const live = e.status !== 'cancelled';
  /** not closed yet: tasks still count */
  const open = live && e.status !== 'completed';
  /** still ahead or running: who speaks, who coaches, who volunteers still matter */
  const ahead = open && !hasEnded(e);
  const tasks = useEventTasks(e.id);
  const shifts = useShifts(e.id);
  const finance = useEventFinance(e.id, live && isPriced(e.price));
  const st = seats(e);
  const started = hasStarted(e);
  const items: StripItem[] = [];
  const edit = () => navigate(`/app/events/${e.id}/edit`);

  items.push({
    key: 'seats', icon: 'people', state: 'info', label: 'לנרשמים', go: () => onTab('registrations'),
    text: <>
      {started && live ? <><span className="num font-bold">{e.stats?.attended_count ?? 0}</span> הגיעו · </> : null}
      <span className="num font-bold">{st.registered}</span> רשומים
      {st.walkIns ? <> · <span className="num">{st.walkIns}</span> בלי הרשמה</> : null}
      {st.capacity != null ? <> · <span className="num">{st.taken}</span> מתוך <span className="num">{st.capacity}</span></> : null}
      {st.waitlisted ? <> · <span className="num">{st.waitlisted}</span> ברשימת המתנה</> : null}
    </>,
  });
  if (ahead && (e.type === 'friday' || e.speaker_id)) {
    const sp = people.speaker;
    items.push(sp
      ? { key: 'sp', icon: 'mic', state: sp.status === 'approved' ? 'done' : 'todo', label: 'לעריכת המרצה', go: edit, text: sp.status === 'approved' ? 'מרצה' : 'מרצה מחכה לאישור' }
      : { key: 'sp', icon: 'mic', state: 'todo', label: 'לשיבוץ מרצה', go: edit, text: 'בלי מרצה' });
  }
  if (ahead && (e.type === 'friday' || e.instructor_id)) {
    items.push(e.instructor_id
      ? { key: 'in', state: 'done', label: 'לעריכת המדריך', go: edit, text: 'מדריך' }
      : { key: 'in', state: 'todo', label: 'לשיבוץ מדריך', go: edit, text: 'בלי מדריך' });
  }
  if (ahead && shifts.data) {
    const slots = slotsFor(e, shifts.data).filter((x) => (x.def.need ?? 1) > 0);
    const need = slots.reduce((n, x) => n + (x.def.need ?? 1), 0);
    const filled = slots.reduce((n, x) => n + Math.min(x.filled, x.def.need ?? 1), 0);
    if (need > 0) {
      items.push({ key: 'vol', state: filled >= need ? 'done' : 'todo', label: 'למתנדבים', go: () => onTab('volunteers'),
        text: <>מתנדבים <span className="num">{filled}/{need}</span></> });
    }
  }
  const pending = finance.data?.income.pending_count ?? 0;
  if (live && pending > 0) {
    items.push({ key: 'pay', state: e.status === 'completed' || hasEnded(e) ? 'warn' : 'info', label: 'למי שלא שילמו', go: () => onTab('registrations', { filter: 'unpaid' }),
      text: <><span className="num font-bold">{pending}</span> לא שילמו</> });
  }
  if (open && tasks.data) {
    const list = tasks.data.filter((t) => t.kind === 'task' && !t.dismissed);
    const late = list.filter((t) => isOverdue(t, todayIl())).length;
    const done = list.filter((t) => t.done_at).length;
    if (late > 0) items.push({ key: 'tasks', icon: 'task', state: 'warn', label: 'להכנות', go: () => onTab('prep'), text: late === 1 ? 'משימה אחת שעבר התאריך שלה' : <><span className="num font-bold">{late}</span> משימות שעבר התאריך שלהן</> });
    else if (list.length) items.push({ key: 'tasks', icon: 'task', state: done === list.length ? 'done' : 'info', label: 'להכנות', go: () => onTab('prep'), text: <>הכנות <span className="num">{done}/{list.length}</span></> });
  }
  if (e.status === 'completed' && (e.stats?.feedback_count ?? 0) > 0) {
    items.push({ key: 'fb', icon: 'star', state: 'info', label: 'לסיכום', go: () => onTab('summary'),
      text: <><span className="num">{e.stats!.feedback_count}</span> משובים{e.stats?.avg_overall != null ? <> · דירוג <span className="num">{Number(e.stats.avg_overall).toFixed(1)}</span></> : null}</> });
  }

  const tone = {
    done: 'border-ink/40 text-ink',
    todo: 'border-dashed border-ink/35 text-muted',
    warn: 'border-warn/50 bg-warn-wash text-warn',
    info: 'border-edge text-ink',
  };
  return (
    <ul aria-label="מצב המפגש" className="mb-4 flex flex-wrap gap-2">
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            onClick={it.go}
            title={it.label}
            className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border bg-paper px-3 text-small font-medium transition-colors hover:border-ink', tone[it.state], it.state === 'warn' && 'bg-warn-wash')}
          >
            {it.icon && <Icon name={it.icon} size={16} />}
            <span>{it.text}</span>
            {it.state === 'done' && <Icon name="check" size={15} strokeWidth={2.4} label="מוכן" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ───────────── a draft: what is missing before registration opens ─────────────

function OpenChecklist({ e, people, onTab }: { e: EventWithStats; people: EventPeople; onTab: Props['onTab'] }) {
  const a = useMeetingActions(e, onTab);
  const friday = e.type === 'friday';
  const rows: { label: string; ok: boolean; note?: string; optional?: boolean }[] = [
    { label: 'תאריך, שעה ומקום', ok: true, note: `${fmtDayLong(e.starts_at)} · ${people.place ?? 'בלי כתובת'}` },
    ...(friday || e.speaker_id ? [{ label: 'מרצה', ok: !!people.speaker, note: people.speaker?.full_name, optional: true }] : []),
    ...(friday || e.lecture_topic ? [{ label: 'נושא ההרצאה', ok: !!e.lecture_topic?.trim(), note: e.lecture_topic ?? undefined, optional: true }] : []),
    ...(friday || e.activity_name ? [{ label: 'פעילות ומדריך', ok: !!e.activity_name && !!e.instructor_id, note: [e.activity_name, people.instructor?.full_name].filter(Boolean).join(' עם '), optional: true }] : []),
    { label: 'מספר מקומות', ok: true, note: e.capacity != null ? `${e.capacity}${e.waitlist_enabled ? ' · עם רשימת המתנה' : ''}` : 'בלי הגבלה' },
  ];
  const missing = rows.filter((r) => !r.ok);
  return (
    <Panel title="מה חסר כדי לפתוח הרשמה" description={missing.length ? 'אפשר לפתוח גם עכשיו ולהשלים אחר כך. כל עוד המפגש טיוטה, הוא לא מוצג ללוחמים.' : 'הכול מוכן. כשפותחים הרשמה, הקישור מתחיל לעבוד.'}>
      <ul className="mb-4 flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2.5">
            <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px]', r.ok ? 'bg-ink text-light' : 'border border-dashed border-ink/40')} aria-hidden="true">
              {r.ok && <Icon name="check" size={13} strokeWidth={2.6} />}
            </span>
            <span className="min-w-0">
              <span className={cx('font-semibold', !r.ok && 'text-ink-soft')}>{r.label}</span>
              {r.ok && r.note ? <span className="text-muted"> · {r.note}</span> : null}
              {!r.ok && <span className="text-muted"> · עוד לא נקבע</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button icon="check" cta busy={a.opening} onClick={a.askOpen}>פתיחת הרשמה</Button>
        {missing.length > 0 && <ButtonLink variant="secondary" icon="edit" to={`/app/events/${e.id}/edit`}>השלמת הפרטים</ButtonLink>}
      </div>
      {a.dialogs}
    </Panel>
  );
}

/** Same weekday next week (or the next one still ahead), same start time. */
function nextWeekDate(e: EventWithStats) {
  const p = ilParts(e.starts_at);
  let d = addDays(p.date, 7);
  while (new Date(fromIl(d, p.time)).getTime() < Date.now()) d = addDays(d, 7);
  return { date: d, time: p.time };
}

function DuplicateDialog({ open, onClose, e }: { open: boolean; onClose: () => void; e: EventWithStats }) {
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const [{ date, time }, setWhen] = useState(() => nextWeekDate(e));
  const [err, setErr] = useState<string | null>(null);
  const dup = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('staff_duplicate_event', { p_event_id: e.id, p_starts_at: fromIl(date, time) });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      await invalidate(e.id);
      onClose();
      toast.success('נוצרה טיוטה. מעדכנים מרצה ונושא ושומרים');
      navigate(`/app/events/${id}/edit?from=dup`);
      window.scrollTo({ top: 0 });
    },
    onError: (x) => setErr(errorMessage(x)),
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr('צריך לבחור תאריך.');
    setErr(null);
    dup.mutate();
  };
  return (
    <Dialog open={open} onClose={onClose} title="שכפול לשבוע הבא" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[0.95rem] text-ink-soft">נוצרת טיוטה עם אותם פרטים, מקום, מכסה ופעילות. המרצה והנושא מתאפסים (בכל שבוע הרצאה חדשה).</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="תאריך" type="date" ltr value={date} onChange={(x) => setWhen({ date: x.target.value, time })} error={err} hint={/^\d{4}-\d{2}-\d{2}$/.test(date) && !err ? fmtDayLong(fromIl(date, '12:00')) : undefined} />
          <Input label="שעת התחלה" type="time" ltr value={time} onChange={(x) => setWhen({ date, time: x.target.value })} step={300} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={dup.isPending} icon="copy">יצירת טיוטה</Button>
          <Button variant="ghost" onClick={onClose}>ביטול</Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({ open, onClose, e, onTab }: { open: boolean; onClose: () => void; e: EventWithStats; onTab: Props['onTab'] }) {
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const [reason, setReason] = useState('');
  const reg = e.stats?.registered_count ?? 0;
  const wait = e.stats?.waitlisted_count ?? 0;
  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('events').update({ status: 'cancelled', cancel_reason: reason.trim() || null }).eq('id', e.id).select('id').single();
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate(e.id);
      onClose();
      if (reg + wait > 0) toast.success('המפגש בוטל. כדאי לעדכן את הנרשמים.', { label: 'להודעות', run: () => onTab('messages', { group: 'registered' }) });
      else toast.success('המפגש בוטל');
    },
    onError: (x) => toast.error(errorMessage(x)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="ביטול המפגש"
      size="sm"
      footer={
        <>
          <Button variant="danger" busy={cancel.isPending} onClick={() => cancel.mutate()}>ביטול המפגש</Button>
          <Button variant="ghost" onClick={onClose}>חזרה</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {reg + wait > 0 ? (
          <Notice tone="warn" icon="alert">
            רשומים למפגש <b className="num">{reg}</b> אנשים{wait ? <> ועוד <b className="num">{wait}</b> בהמתנה</> : null}. הם לא יקבלו הודעה אוטומטית. אחרי הביטול כדאי לעדכן אותם בוואטסאפ מלשונית "הודעות".
          </Notice>
        ) : (
          <p className="text-[0.95rem] text-ink-soft">אין הרשמות למפגש.</p>
        )}
        <p className="text-[0.95rem] text-ink-soft">ההרשמה תיסגר, ומי שייכנס לקישור יראה שהמפגש בוטל.</p>
        <Textarea label="סיבת הביטול" value={reason} onChange={(x) => setReason(x.target.value)} maxLength={300} rows={2} hint="מוצגת לצוות בלבד" />
      </div>
    </Dialog>
  );
}

// ───────────── registration links ─────────────

function LinksPanel({ e }: { e: EventWithStats }) {
  const copy = useCopy();
  const links = useReferralLinks();
  const [creating, setCreating] = useState(false);
  const [more, setMore] = useState(false);
  const pub = registerUrl(e.public_code);
  const active = (links.data ?? []).filter((l) => l.is_active);

  return (
    <Panel title="קישורי הרשמה" actions={<Button size="sm" variant="ghost" icon="plus" onClick={() => setCreating(true)}>קישור לערוץ חדש</Button>}>
      {e.status === 'draft' && (
        <div className="mb-3"><Notice tone="light" icon="alert">המפגש עדיין טיוטה. הקישורים יעבדו אחרי פתיחת ההרשמה.</Notice></div>
      )}
      {e.status === 'cancelled' && (
        <div className="mb-3"><Notice tone="warn" icon="alert">המפגש בוטל. מי שייכנס לקישור יראה שהמפגש בוטל.</Notice></div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <LinkRow label="הקישור הכללי" url={pub} onCopy={() => copy(pub, 'הקישור הועתק')} />
          <p className="mt-1 text-sm text-muted">
            לכל ערוץ כדאי קישור משלו: כך הדוחות יודעים מאיפה הגיעה כל הרשמה.
          </p>
        </div>
        <QrBlock value={pub} label="QR להרשמה" filename={`registration-qr-${e.public_code}.png`} size={132} />
      </div>
      {links.isError ? (
        <p className="mt-3 text-sm text-bad">{errorMessage(links.error)}</p>
      ) : active.length > 0 && !more ? (
        <div className="mt-3 border-t border-line-soft pt-2">
          <button type="button" aria-expanded={false} onClick={() => setMore(true)} className="-mx-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-small font-semibold text-tide hover:underline">
            {active.length === 1 ? 'עוד ערוץ אחד' : <>עוד <span className="num">{active.length}</span> ערוצים</>}
            <Icon name="chevron" size={15} className="-rotate-90" />
          </button>
        </div>
      ) : active.length > 0 ? (
        <div className="mt-3 border-t border-line-soft pt-1">
          {active.map((l) => {
            const url = registerUrl(e.public_code, l.code);
            return (
              <LinkRow
                key={l.id}
                label={<span>{l.label}{l.campaign ? <span className="font-normal text-muted"> · {l.campaign}</span> : null}</span>}
                url={url}
                onCopy={() => copy(url, `הקישור ל${l.label} הועתק`)}
              />
            );
          })}
        </div>
      ) : null}
      <NewLinkDialog open={creating} onClose={() => setCreating(false)} />
    </Panel>
  );
}

function QrBlock({ value, label, filename, size }: { value: string; label: string; filename: string; size: number }) {
  const toast = useToast();
  const download = async () => {
    try {
      const url = await QRCode.toDataURL(value, { width: 1024, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#142837', light: '#FFFFFF' } });
      downloadFile(filename, dataUrlToBlob(url));
    } catch {
      toast.error('לא הצלחנו ליצור את הקוד. נסו שוב.');
    }
  };
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <QrImage value={value} size={size} label={label} className="rounded-[var(--radius-panel)] border border-line-soft" />
      <button type="button" onClick={download} className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-tide hover:bg-tide-wash">
        <Icon name="download" size={16} />
        הורדת QR
      </button>
    </div>
  );
}

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

function NewLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sources = useSources();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [campaign, setCampaign] = useState('');
  const [errors, setErrors] = useState<{ code?: string; label?: string; form?: string }>({});

  useEffect(() => {
    if (open) {
      setCode(''); setLabel(''); setSourceId(''); setCampaign(''); setErrors({});
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('referral_links').insert({
        code: code.trim().toLowerCase(),
        label: label.trim(),
        source_id: sourceId || null,
        campaign: campaign.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['links'] });
      toast.success('הקישור נוצר');
      onClose();
    },
    onError: (x) => setErrors({ form: (x as { code?: string }).code === '23505' ? 'כבר יש קישור עם הקוד הזה. בוחרים קוד אחר.' : errorMessage(x) }),
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const c = code.trim().toLowerCase();
    const errs: typeof errors = {};
    if (!CODE_RE.test(c) || c.startsWith('f-')) errs.code = 'אותיות באנגלית קטנות, ספרות ומקף (2–40 תווים), לא מתחיל ב-f-.';
    if (label.trim().length < 2 || label.trim().length > 80) errs.label = 'צריך תיאור קצר (2–80 תווים).';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    create.mutate();
  };

  return (
    <Dialog open={open} onClose={onClose} title="קישור הרשמה לערוץ חדש" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-[0.95rem] text-ink-soft">הקישור עובד לכל מפגש: מוסיפים לקישור ההרשמה <span dir="ltr" className="num">?ref=קוד</span>, והדוחות סופרים כמה נרשמו והגיעו דרכו.</p>
        <Input label="תיאור" required value={label} onChange={(x) => setLabel(x.target.value)} error={errors.label} placeholder="קבוצת הוואטסאפ של מודיעין" maxLength={80} />
        <Input label="קוד" required ltr value={code} onChange={(x) => setCode(x.target.value.toLowerCase().replace(/\s+/g, '-'))} error={errors.code} placeholder="wa-modiin" maxLength={40} hint="אותיות באנגלית, ספרות ומקף. מופיע בקישור." />
        <Select label="מקור" value={sourceId} onChange={(x) => setSourceId(x.target.value)} hint="איך שמעו עלינו מי שנרשמים דרך הקישור">
          <option value="">בלי מקור</option>
          {(sources.data ?? []).filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        <Input label="קמפיין" value={campaign} onChange={(x) => setCampaign(x.target.value)} maxLength={80} placeholder="לא חובה" />
        {errors.form && <p className="text-sm font-medium text-bad" role="alert">{errors.form}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={create.isPending} icon="link">יצירת קישור</Button>
          <Button variant="ghost" onClick={onClose}>ביטול</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────────── entrance QR and feedback link ─────────────

function EntrancePanel({ e }: { e: EventWithStats }) {
  const copy = useCopy();
  const [printing, setPrinting] = useState(false);
  const checkin = checkinUrl(e.checkin_code);
  const fb = feedbackUrl(e.public_code);
  return (
    <Panel title="צ׳ק־אין בכניסה ומשוב">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] text-ink-soft">
            קוד QR להדפסה ולתלייה בכניסה: מי שמגיע סורק אותו ומסמן הגעה, בלי עזרה מהצוות. הסריקה פתוחה {e.status === 'draft' ? 'אחרי פתיחת ההרשמה, ' : ''}סביב שעת המפגש.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon="qr" onClick={() => setPrinting(true)}>שלט כניסה להדפסה</Button>
          </div>
          <div className="mt-2">
            <LinkRow label="קישור הצ׳ק־אין" url={checkin} onCopy={() => copy(checkin, 'הקישור הועתק')} />
            <LinkRow label="קישור למשוב" url={fb} onCopy={() => copy(fb, 'קישור המשוב הועתק')} />
          </div>
        </div>
        <QrBlock value={checkin} label="QR לצ׳ק־אין בכניסה" filename={`checkin-qr-${e.public_code}.png`} size={132} />
      </div>
      <PrintSignDialog open={printing} onClose={() => setPrinting(false)} e={e} url={checkin} />
    </Panel>
  );
}

/**
 * The entrance sign, on the brand book's poster grid: a navy image zone with the logo in the top-right corner and
 * beige stripes entering from the opposite corner; the headline is the action ("סרקו לצ׳ק־אין"); the content zone below
 * on white, with the QR code (navy on white, so every phone camera reads it), the short link for anyone without a
 * camera, and the triangle bullets for the steps. `page`: the printed A4 sheet (fixed size, the footer band at the foot).
 */
function EntranceSign({ e, url, qrSize, page = false }: { e: EventWithStats; url: string; qrSize: string; page?: boolean }) {
  const short = url.replace(/^https?:\/\//, '');
  const steps = [
    'פותחים את המצלמה בטלפון ומכוונים לקוד',
    'לוחצים על הקישור ומקלידים מספר טלפון',
    'לא נרשמתם מראש? אפשר להירשם במקום',
    'אין מצלמה או קליטה? פונים לצוות בכניסה',
  ];
  return (
    // white is the paper, as on the book's letterhead (p.65): the sign prints on any office printer without a beige flood
    <div className={cx('flex flex-col overflow-hidden bg-white text-right text-ink', page && 'entrance-sign-page h-[297mm] w-[210mm]')}>
      <div className={cx('relative overflow-hidden bg-ink pt-[1.4em] pb-[1.5em] text-light', page ? 'px-[12mm]' : 'px-[1.6em]')}>
        <Stripes width={300} height={150} unit={28} dir="fall" count={3} className="absolute top-0 left-0 h-[9em] w-[18em]" />
        <div className="relative flex justify-start">
          <Logo variant="full" height="3.4em" label="המשך תנועה" />
        </div>
        <div className="relative mt-[1.4em] text-[1.25em] font-semibold">טוב שבאתם · {e.title}</div>
        <div className="relative mt-[0.1em] font-display text-[2.9em] leading-[1.05]">סרקו לצ׳ק־אין</div>
        <div className="relative mt-[0.3em] text-[1.1em]">{fmtDayLong(e.starts_at)} · <span dir="ltr" className="num">{timeRange(e)}</span></div>
      </div>
      <div className={cx('flex flex-col items-center gap-[0.8em] pt-[1.3em] pb-[1.2em]', page ? 'flex-1 justify-center px-[12mm]' : 'px-[1.6em]')}>
        <SignQr url={url} size={qrSize} />
        <div dir="ltr" className={cx('num -mt-[0.4em] font-medium tracking-wide break-all text-center', page ? 'text-[14pt]' : 'text-[0.9em]')}>{short}</div>
        <ul className="mt-[0.3em] flex flex-col gap-[0.4em] self-stretch text-[1.25em] leading-snug">
          {steps.map((s) => (
            <li key={s} className="flex items-start gap-[0.55em]"><Tri className="mt-[0.34em]" />{s}</li>
          ))}
        </ul>
      </div>
      {/* the closing band uses the header's stripe unit (one X per composition, book p.38): same viewBox scale, 0.06em */}
      <div className="relative mt-auto h-[3.42em] shrink-0 overflow-hidden bg-ink" aria-hidden="true">
        <Stripes width={300} height={57} unit={28} dir="fall" count={3} className="absolute top-0 left-0 h-full w-[18em] text-light" />
      </div>
    </div>
  );
}

function SignQr({ url, size }: { url: string; size: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 1200, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#142837', light: '#FFFFFF' } })
      .then((u) => { if (alive) setSrc(u); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [url]);
  return src ? <img src={src} alt="קוד QR לצ׳ק־אין" style={{ width: size, height: size }} /> : <div className="skeleton" style={{ width: size, height: size }} />;
}

/** Preview + print. While open, the app itself is hidden from print and only the sign is printed, on one A4 page. */
function PrintSignDialog({ open, onClose, e, url }: { open: boolean; onClose: () => void; e: EventWithStats; url: string }) {
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById('root');
    root?.classList.add('print:hidden');
    return () => root?.classList.remove('print:hidden');
  }, [open]);
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="שלט כניסה להדפסה"
        size="lg"
        footer={
          <>
            <Button onClick={() => window.print()}>הדפסה</Button>
            <Button variant="ghost" onClick={onClose}>סגירה</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          מדפיסים ותולים בכניסה, בגובה העיניים. הקוד עובד רק למפגש הזה.
          <br />
          בהגדרות ההדפסה: A4, גרפיקת רקע מסומנת.
        </p>
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line text-[13px] sm:text-[15px]">
          <EntranceSign e={e} url={url} qrSize="min(15rem, 56vw)" />
        </div>
      </Dialog>
      {open && createPortal(
        <div className="hidden bg-white text-[16pt] print:block">
          <EntranceSign e={e} url={url} qrSize="96mm" page />
        </div>,
        document.body,
      )}
    </>
  );
}
