import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useReferralLinks, useSettings, useSources, type EventWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { addDays, fmtDateTime, fmtDayLong, fromIl, ilParts } from '@/lib/dates';
import { checkinUrl, feedbackUrl, registerUrl } from '@/lib/links';
import { downloadFile } from '@/lib/csv';
import { pct, ratio } from '@/lib/metrics';
import { Badge, Button, ButtonLink, Input, KeyValue, Notice, Panel, Select, Textarea, cx } from '@/ui/kit';
import { Dialog, useConfirm, useCopy, useToast } from '@/ui/feedback';
import { Icon, Logo } from '@/ui/Icon';
import type { EventTab } from './EventPage';
import { dataUrlToBlob, type EventPeople } from './context';
import { useInvalidateEvent } from './queries';
import { BigStat, LinkRow, QrImage, hasEnded, hasStarted, isUnclosed, timeRange } from './shared';

type Props = { event: EventWithStats; people: EventPeople; onTab: (t: EventTab, extra?: Record<string, string>) => void };

export function OverviewTab({ event: e, people, onTab }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <Actions e={e} onTab={onTab} />
      <Counters e={e} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Facts e={e} people={people} />
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
  const reg = s?.registered_count ?? 0;
  const free = e.capacity != null ? Math.max(0, e.capacity - reg) : null;
  if (e.status === 'cancelled' && !reg && !s?.waitlisted_count) return null;
  return (
    <section aria-label="מספרים" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {started && e.status !== 'cancelled' && (
        <BigStat highlight label="הגיעו" value={s?.attended_count ?? 0} sub={s?.walk_in_count ? `מתוכם ${s.walk_in_count} בלי הרשמה` : undefined} />
      )}
      <BigStat
        highlight={!started && e.status === 'open'}
        label="נרשמו"
        value={<>{reg}<span className="text-xl text-muted">/{e.capacity ?? '∞'}</span></>}
        sub={free != null ? (free ? `${free} מקומות פנויים` : 'אין מקומות פנויים') : 'בלי הגבלת מקומות'}
      />
      <BigStat label="בהמתנה" value={s?.waitlisted_count ?? 0} />
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
              {sp.status !== 'approved' && <Badge tone="warn">{sp.status === 'proposed' ? 'ממתין לאישור' : 'לא מאושר/ת'}</Badge>}
            </span>
          ) : e.type === 'friday' ? <Badge key="s" tone="warn" icon="mic">עוד לא נקבע/ה</Badge> : null],
          ['נושא', e.lecture_topic],
          ['מקומות', e.capacity != null ? <span key="c"><span className="num">{e.capacity}</span>{e.waitlist_enabled ? ' · עם רשימת המתנה' : ' · בלי רשימת המתנה'}</span> : 'בלי הגבלה'],
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

function Actions({ e, onTab }: { e: EventWithStats; onTab: Props['onTab'] }) {
  const role = useRole();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const settings = useSettings();
  const [dupOpen, setDupOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [result, setResult] = useState<CompleteResult | null>(null);

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
    onSuccess: async () => {
      await invalidate(e.id);
      toast.success('המפגש נמחק');
      navigate('/app/events', { replace: true });
    },
    onError: (err) => toast.error((err as { code?: string }).code === '23503' ? 'יש למפגש הרשמות, ולכן אי אפשר למחוק אותו. אפשר לבטל אותו.' : errorMessage(err)),
  });

  const askComplete = async () => {
    const st = settings.data;
    const unmarked = Math.max(0, (s?.registered_count ?? 0) - (s?.attended_registered_count ?? 0) - (s?.no_show_count ?? 0));
    const tasks = [
      st?.auto_task_no_show !== false && '"חסרת לנו" ושיחה לכל מי שלא הגיע/ה',
      st?.auto_task_first_time !== false && 'שיחת היכרות לכל מי שהגיע/ה בפעם הראשונה',
      st?.auto_task_lapsed !== false && 'פנייה לקבועים שהפסיקו להגיע',
    ].filter(Boolean) as string[];
    const ok = await confirm({
      title: 'סגירת המפגש',
      confirm: 'סגירת המפגש',
      body: (
        <div className="flex flex-col gap-2.5">
          <p>מה יקרה עכשיו:</p>
          <ul className="flex list-disc flex-col gap-1.5 pr-5">
            <li>
              {unmarked > 0 ? <><b className="num">{unmarked}</b> רשומים שלא סומנו כהגעה יסומנו "לא הגיע/ה".</> : 'כל הרשומים כבר מסומנים. אף אחד לא יסומן "לא הגיע/ה" אוטומטית.'}
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
        body: 'עוד לא נקבע/ה מרצה למפגש. אפשר לפתוח הרשמה עכשיו ולהוסיף מרצה ונושא אחר כך.',
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

  const primary: ReactNode[] = [];
  const secondary: ReactNode[] = [];

  if (e.status === 'draft') {
    primary.push(<Button key="open" size="lg" icon="check" busy={setStatus.isPending} onClick={askOpen}>פתיחת הרשמה</Button>);
  }
  if (active && started) {
    primary.push(<Button key="complete" size="lg" icon="checkCircle" busy={complete.isPending} onClick={askComplete}>סגירת המפגש</Button>);
  }
  if (active && doorSoon && !started) {
    primary.push(<ButtonLink key="door" size="lg" icon="door" to={`/app/events/${e.id}/door`}>מצב כניסה</ButtonLink>);
  } else if (active && !ended) {
    secondary.push(<ButtonLink key="door" variant="secondary" icon="door" to={`/app/events/${e.id}/door`}>מצב כניסה</ButtonLink>);
  } else if (active || e.status === 'completed') {
    secondary.push(<ButtonLink key="door" variant="secondary" icon="door" to={`/app/events/${e.id}/door`}>רשימת נוכחות</ButtonLink>);
  }
  if (e.status === 'open' && !started) {
    secondary.push(<Button key="close" variant="secondary" icon="close" busy={setStatus.isPending} onClick={() => setStatus.mutate('closed')}>סגירת הרשמה</Button>);
  }
  if (e.status === 'closed' && !started) {
    secondary.push(<Button key="reopen" variant="secondary" icon="undo" busy={setStatus.isPending} onClick={() => setStatus.mutate('open')}>פתיחת הרשמה מחדש</Button>);
  }
  if (e.status === 'completed') {
    primary.push(<Button key="dup" size="lg" icon="copy" onClick={() => setDupOpen(true)}>שכפול לשבוע הבא</Button>);
    secondary.push(<Button key="sum" variant="secondary" icon="chart" onClick={() => onTab('summary')}>סיכום המפגש</Button>);
  } else {
    secondary.push(<Button key="dup" variant="secondary" icon="copy" onClick={() => setDupOpen(true)}>שכפול לשבוע הבא</Button>);
  }
  secondary.push(<ButtonLink key="edit" variant="secondary" icon="edit" to={`/app/events/${e.id}/edit`}>עריכה</ButtonLink>);

  const canCancel = (e.status === 'draft' || active) && !ended;
  const canDelete = can.admin(role) && regCount.data === 0;

  return (
    <Panel title="פעולות">
      {isUnclosed(e, now) && (
        <div className="mb-4">
          <Notice tone="warn" icon="alert">המפגש הסתיים ועדיין לא נסגר. בסגירה מסומנים מי שלא הגיעו ונוצרות משימות מעקב.</Notice>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {primary.length > 0 && <div className="grid gap-2 sm:flex sm:flex-wrap [&>*]:w-full sm:[&>*]:w-auto">{primary}</div>}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*]:w-full sm:[&>*]:w-auto">{secondary}</div>
        {(canCancel || canDelete) && (
          <div className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
            {canCancel && <Button variant="danger" size="sm" icon="close" onClick={() => setCancelOpen(true)}>ביטול המפגש</Button>}
            {canDelete && <Button variant="danger" size="sm" busy={remove.isPending} onClick={askDelete}>מחיקת המפגש</Button>}
          </div>
        )}
      </div>

      <DuplicateDialog open={dupOpen} onClose={() => setDupOpen(false)} e={e} />
      <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} e={e} onTab={onTab} />
      <Dialog
        open={!!result}
        onClose={() => setResult(null)}
        title="המפגש נסגר"
        footer={
          <>
            <Button onClick={() => { setResult(null); onTab('summary'); }} icon="chart">לסיכום המפגש</Button>
            <ButtonLink to="/app/followups" variant="secondary" icon="task">למשימות המעקב</ButtonLink>
            <Button variant="ghost" onClick={() => setResult(null)}>סגירה</Button>
          </>
        }
      >
        {result && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <BigStat label="הגיעו" value={s?.attended_count ?? 0} highlight />
              <BigStat label='סומנו "לא הגיע/ה"' value={result.no_shows} />
            </div>
            <KeyValue
              items={[
                ['משימות "חסרת לנו"', <span key="1" className="num">{result.tasks_no_show}</span>],
                ['שיחות היכרות לחדשים', <span key="2" className="num">{result.tasks_first_time}</span>],
                ['קבועים שהפסיקו להגיע', <span key="3" className="num">{result.tasks_lapsed}</span>],
              ]}
            />
            <p className="text-sm text-muted">המשימות מחכות במסך "מעקב". כדאי לשלוח לכל מי שהגיע הודעת תודה עם קישור למשוב (לשונית "הודעות").</p>
          </div>
        )}
      </Dialog>
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
      toast.success('נוצרה טיוטה. מעדכנים מרצה ונושא, שומרים ופותחים הרשמה.');
      navigate(`/app/events/${id}/edit`);
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
        <p className="text-[0.95rem] text-ink-soft">נוצרת טיוטה עם אותם פרטים, מקום, מכסה ופעילות. המרצה והנושא מתאפסים (מרצה חדש/ה בכל שבוע).</p>
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
      const url = await QRCode.toDataURL(value, { width: 1024, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#12343B', light: '#FFFFFF' } });
      downloadFile(filename, dataUrlToBlob(url));
    } catch {
      toast.error('לא הצלחנו ליצור את הקוד. נסו שוב.');
    }
  };
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <QrImage value={value} size={size} label={label} className="rounded-lg border border-line-soft" />
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
          <option value="">ללא</option>
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
            קוד QR להדפסה ולתלייה בכניסה: מי שמגיע/ה סורק/ת ומסמן/ת הגעה בעצמו/ה. הסריקה פתוחה {e.status === 'draft' ? 'אחרי פתיחת ההרשמה, ' : ''}סביב שעת המפגש.
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

function EntranceSign({ e, url, qrSize }: { e: EventWithStats; url: string; qrSize: string }) {
  return (
    <div className="flex flex-col items-center gap-[0.6em] text-center text-ink">
      <div className="flex items-center gap-[0.4em]">
        <Logo size={44} />
        <span className="font-display text-[1.6em] leading-none">המשך תנועה</span>
      </div>
      <div className="font-display text-[2.4em] leading-tight">ברוכים הבאים!</div>
      <div className="text-[1.15em] font-semibold">{e.title} · {fmtDayLong(e.starts_at)}</div>
      <div className="h-[0.25em] w-[5em] rounded-full bg-light" aria-hidden="true" />
      <div className="text-[1.5em] font-bold">הגעתם? סורקים ומסמנים הגעה</div>
      <SignQr url={url} size={qrSize} />
      <div className="max-w-[26em] text-[1em] leading-relaxed text-ink-soft">
        פותחים את המצלמה בטלפון, מכוונים לקוד ולוחצים על הקישור שמופיע.
        <br />
        לא נרשמתם מראש? אפשר להירשם במקום אחרי הסריקה.
      </div>
    </div>
  );
}

function SignQr({ url, size }: { url: string; size: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 1200, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#12343B', light: '#FFFFFF' } })
      .then((u) => { if (alive) setSrc(u); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [url]);
  return src ? <img src={src} alt="קוד QR לצ׳ק־אין" style={{ width: size, height: size }} /> : <div className="skeleton" style={{ width: size, height: size }} />;
}

/** Preview + print. While open, the app itself is hidden from print and only the sign is printed. */
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
        <p className="mb-3 text-sm text-muted">מדפיסים בדף A4 ותולים בכניסה, בגובה העיניים. הקוד עובד רק למפגש הזה.</p>
        <div className="rounded-[var(--radius-panel)] border border-line bg-white p-6 text-[13px] sm:text-[15px]">
          <EntranceSign e={e} url={url} qrSize="min(16rem, 60vw)" />
        </div>
      </Dialog>
      {open && createPortal(
        <div className={cx('hidden print:flex', 'min-h-[260mm] items-center justify-center bg-white p-[10mm] text-[16pt]')}>
          <EntranceSign e={e} url={url} qrSize="120mm" />
        </div>,
        document.body,
      )}
    </>
  );
}
