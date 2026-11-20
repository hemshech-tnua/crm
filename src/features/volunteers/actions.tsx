// The planner's actions (assign, manage a shift, send the personal link) and their dialogs, shared by the planner
// page and the meeting's "מתנדבים" tab.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/errors';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { formatPhone, telLink, whatsappLink } from '@/lib/phone';
import type { Volunteer, VolunteerRole } from '@/lib/types';
import { Badge, Button, ErrorBox, Notice, SearchInput, Spinner, Textarea, buttonClass, cx } from '@/ui/kit';
import { Dialog, useConfirm, useCopy } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { ago } from '@/features/participants/shared';
import { shortTitle } from '@/features/prep/shared';
import { SEARCH_PLACEHOLDER, matchesSearch } from '@/ui/search';
import {
  ROLE_LABEL, STATUS_LABEL, dayAndDate, firstName, groupByEvent, isUpcoming, linkMessage, reminderMessage, remindable, roleLabel, slotsFor,
  volunteerUrl, type PlanEvent, type Shift, type SlotDef,
} from './model';
import { createVolunteerLink, useAssign, useSetShiftStatus } from './queries';
import { VolunteerDialog } from './VolunteerDialog';

export type PlanData = { volunteers: Volunteer[]; shifts: Shift[]; events: PlanEvent[] };

type Actions = {
  assign: (event: PlanEvent, def: SlotDef, replace?: Shift) => void;
  manage: (shift: Shift) => void;
  send: (volunteerId: string) => void;
  data: PlanData;
  volunteer: (id: string) => Volunteer | undefined;
};
const Ctx = createContext<Actions | null>(null);
export function useVolunteerActions(): Actions {
  const a = useContext(Ctx);
  if (!a) throw new Error('VolunteerActions missing');
  return a;
}

type Open =
  | { kind: 'assign'; event: PlanEvent; def: SlotDef; replace?: Shift }
  | { kind: 'manage'; shiftId: string }
  | { kind: 'send'; volunteerId: string }
  | null;

export function VolunteerActions({ data, children }: { data: PlanData; children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const byId = useMemo(() => new Map(data.volunteers.map((v) => [v.id, v])), [data.volunteers]);
  const api: Actions = {
    assign: (event, def, replace) => setOpen({ kind: 'assign', event, def, replace }),
    manage: (s) => setOpen({ kind: 'manage', shiftId: s.id }),
    send: (volunteerId) => setOpen({ kind: 'send', volunteerId }),
    data,
    volunteer: (id) => byId.get(id),
  };
  const close = () => setOpen(null);
  const managed = open?.kind === 'manage' ? data.shifts.find((s) => s.id === open.shiftId) : undefined;
  const sendTo = open?.kind === 'send' ? byId.get(open.volunteerId) : undefined;
  return (
    <Ctx.Provider value={api}>
      {children}
      {open?.kind === 'assign' && <AssignDialog key={`${open.event.id}-${open.def.role}-${open.replace?.id ?? ''}`} event={open.event} def={open.def} replace={open.replace} onClose={close} />}
      {managed && <ShiftDialog shift={managed} onClose={close} />}
      {sendTo && <SendLinkDialog key={sendTo.id} volunteer={sendTo} onClose={close} />}
    </Ctx.Provider>
  );
}

// ───────────── status ─────────────

export function StatusBadge({ status }: { status: Shift['status'] }) {
  if (status === 'confirmed') return <Badge tone="good" icon="check">{STATUS_LABEL.confirmed}</Badge>;
  if (status === 'declined') return <Badge tone="bad" icon="alert">{STATUS_LABEL.declined}</Badge>;
  if (status === 'invited') return <Badge tone="tide" icon="clock">{STATUS_LABEL.invited}</Badge>;
  return <Badge>{STATUS_LABEL.cancelled}</Badge>;
}

/** One-tap WhatsApp reminder (time, place, role) for a confirmed volunteer. */
export function ReminderLink({ shift, volunteer, size = 'sm', className = '' }: { shift: Shift; volunteer: Volunteer | undefined; size?: 'sm' | 'md'; className?: string }) {
  if (!volunteer?.phone) return null;
  return (
    <a
      href={whatsappLink(volunteer.phone, reminderMessage(volunteer.full_name, shift))}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass('secondary', size, className)}
    >
      <Icon name="message" size={16} />
      תזכורת ל{firstName(volunteer.full_name)}
      <span className="sr-only"> ({roleLabel(shift.event.type, shift.role)}, {shift.event.title})</span>
    </a>
  );
}

// ───────────── assign ─────────────

type Candidate = { v: Volunteer; prefers: boolean; upcoming: number; here: Shift[]; declinedHere: boolean };

/**
 * Pick who fills a place. After a pick the dialog stays open on the meeting's next empty role, so a whole meeting is
 * booked in one go ("סיום" when done); a replacement closes at once.
 */
function AssignDialog({ event, def: firstDef, replace, onClose }: { event: PlanEvent; def: SlotDef; replace?: Shift; onClose: () => void }) {
  const { data, volunteer } = useVolunteerActions();
  const assign = useAssign();
  const [q, setQ] = useState('');
  const [also, setAlso] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<VolunteerRole>(firstDef.role);
  const [booked, setBooked] = useState<string[]>([]);
  const slots = useMemo(() => slotsFor(event, data.shifts.filter((s) => s.event_id === event.id)), [event, data.shifts]);
  const def: SlotDef = slots.find((s) => s.def.role === role)?.def ?? (role === firstDef.role ? firstDef : { role, label: roleLabel(event.type, role) });
  const label = def.label;
  const switchRole = (r: VolunteerRole) => { setRole(r); setAlso([]); setQ(''); };

  const upcomingBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data.shifts) {
      if ((s.status === 'invited' || s.status === 'confirmed') && isUpcoming(s.event)) m.set(s.volunteer_id, (m.get(s.volunteer_id) ?? 0) + 1);
    }
    return m;
  }, [data.shifts]);

  const candidates = useMemo(() => {
    const here = data.shifts.filter((s) => s.event_id === event.id);
    const out: Candidate[] = [];
    for (const v of data.volunteers) {
      if (!v.is_active) continue;
      const mine = here.filter((s) => s.volunteer_id === v.id);
      // already fills this very slot
      if (mine.some((s) => s.role === def.role && (s.status === 'invited' || s.status === 'confirmed'))) continue;
      if (!matchesSearch(q, { name: v.full_name, phone: v.phone })) continue;
      out.push({
        v, prefers: v.roles.includes(def.role), upcoming: upcomingBy.get(v.id) ?? 0,
        here: mine.filter((s) => s.status !== 'declined'), declinedHere: mine.some((s) => s.status === 'declined'),
      });
    }
    // free at this meeting first, then whoever has the fewest shifts ahead (spreads the load), then by name
    const rank = (c: Candidate) => (c.declinedHere ? 2 : c.here.length ? 1 : 0);
    out.sort((a, b) => rank(a) - rank(b) || a.upcoming - b.upcoming || a.v.full_name.localeCompare(b.v.full_name, 'he'));
    return out;
  }, [data.shifts, data.volunteers, event.id, def.role, q, upcomingBy]);
  const preferred = candidates.filter((c) => c.prefers);
  const others = candidates.filter((c) => !c.prefers);

  // the same role at the next meetings where it is still missing: book one person for several meetings at once
  const next = useMemo(() => {
    const byEvent = groupByEvent(data.shifts);
    return data.events
      .filter((e) => e.id !== event.id && e.starts_at > event.starts_at)
      .filter((e) => slotsFor(e, byEvent.get(e.id) ?? []).some((s) => s.def.role === def.role && (s.def.need ?? 1) > 0 && s.missing > 0))
      .slice(0, 8);
  }, [data.events, data.shifts, event, def.role]);

  /** After a booking: on to the next empty role of this meeting, or close when none is left. */
  const after = (doneText: string) => {
    if (replace) return onClose();
    const nextRole = slots.find((s) => s.def.role !== role && (s.def.need ?? 1) > 0 && s.missing > 0);
    if (!nextRole) return onClose();
    setBooked((b) => [...b, doneText]);
    switchRole(nextRole.def.role);
  };

  const pick = (v: Pick<Volunteer, 'id' | 'full_name'>) => {
    // skip meetings where this person already has this role
    const taken = new Set(data.shifts.filter((s) => s.volunteer_id === v.id && s.role === def.role && s.status !== 'declined').map((s) => s.event_id));
    const ids = [event.id, ...also.filter((id) => !taken.has(id))];
    const n = ids.length;
    assign.mutate(
      {
        volunteerId: v.id, role: def.role, eventIds: ids, replace: replace?.id ?? null,
        done: n > 1 ? `${v.full_name}: שיבוץ ל${label} ב-${n} מפגשים` : `${v.full_name}: שיבוץ ל${label}`,
      },
      { onSuccess: () => after(`${v.full_name}: ${label}${n > 1 ? ` (${n} מפגשים)` : ''}`) },
    );
  };

  const row = (c: Candidate) => (
    <li key={c.v.id}>
      <button
        type="button"
        disabled={assign.isPending}
        onClick={() => pick(c.v)}
        className="flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-control)] border border-transparent px-3 py-2 text-start transition-colors hover:border-ink hover:bg-ink/[0.03] disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{c.v.full_name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
            <span>{c.upcoming ? <><span className="num">{c.upcoming}</span> שיבוצים קרובים</> : 'אין שיבוצים קרובים'}</span>
            {c.v.roles.length > 0 && <span>· {c.v.roles.map((r) => ROLE_LABEL[r]).join(', ')}</span>}
            {!c.v.phone && <span>· אין טלפון</span>}
          </span>
          {(c.here.length > 0 || c.declinedHere) && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {c.here.map((s) => <Badge key={s.id} tone="tide">כבר במפגש: {roleLabel(event.type, s.role)}</Badge>)}
              {c.declinedHere && <Badge tone="bad" icon="alert">לא מסתדר במפגש הזה</Badge>}
            </span>
          )}
        </span>
        <Icon name="plus" size={18} className="shrink-0 text-ink-soft" />
      </button>
    </li>
  );

  const roleSlots = slots.filter((s) => (s.def.need ?? 1) > 0);

  return (
    <>
      <Dialog
        open={!adding}
        onClose={onClose}
        title={`שיבוץ ל${label}`}
        footer={<>
          <Button variant="secondary" icon="userPlus" onClick={() => setAdding(true)}>מתנדב חדש</Button>
          <Button variant="ghost" onClick={onClose}>{booked.length ? 'סיום' : 'סגירה'}</Button>
        </>}
      >
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-soft">
            <span className="font-semibold text-ink">{event.title}</span> · {fmtDayLong(event.starts_at)}, <span className="num">{fmtTime(event.starts_at)}</span>
          </p>
          {booked.length > 0 && (
            <div role="status" className="flex items-start gap-2 rounded-[var(--radius-control)] border-s-[3px] border-ink bg-sky-wash px-3.5 py-2.5 text-small">
              <Icon name="checkCircle" size={17} className="mt-0.5 shrink-0" />
              <p><span className="font-semibold">שובצו: </span>{booked.join(' · ')}. ממשיכים ל{label}, או "סיום".</p>
            </div>
          )}
          {replace && <Notice icon="undo">במקום {volunteer(replace.volunteer_id)?.full_name ?? 'השיבוץ הקודם'}. השיבוץ הקודם יבוטל.</Notice>}
          {!replace && roleSlots.length > 1 && (
            <div role="group" aria-label="תפקיד במפגש" className="flex flex-wrap gap-2">
              {roleSlots.map((s) => {
                const on = s.def.role === role;
                const full = s.missing === 0;
                return (
                  <button
                    key={s.def.role}
                    type="button"
                    aria-pressed={on}
                    onClick={() => switchRole(s.def.role)}
                    className={cx(
                      'inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-small font-medium pointer-coarse:h-11',
                      on ? 'border-ink bg-ink text-light' : full ? 'border-edge text-muted hover:border-ink hover:text-ink' : 'border-dashed border-ink/40 text-ink-soft hover:border-ink hover:text-ink',
                    )}
                  >
                    {full ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} />}
                    {s.def.label}
                    <span className="sr-only">{full ? ' (משובץ)' : ' (מקום פנוי)'}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!replace && next.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-small font-medium">לשבץ את אותו אדם גם למפגשים הבאים שחסר בהם {label}?</legend>
              <div className="flex flex-wrap gap-2">
                {next.map((e) => {
                  const on = also.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={on}
                      title={e.title}
                      onClick={() => setAlso(on ? also.filter((x) => x !== e.id) : [...also, e.id])}
                      className={cx(
                        'inline-flex h-10 max-w-full items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-small font-medium pointer-coarse:h-11',
                        on ? 'border-ink bg-ink text-light' : 'border-control-line text-ink-soft hover:border-ink hover:text-ink',
                      )}
                    >
                      {on && <Icon name="check" size={14} />}
                      <span className="num whitespace-nowrap">{dayAndDate(e.starts_at)}</span>
                      <span className={cx('truncate text-micro', on ? 'text-light/80' : 'text-muted')}>· {shortTitle(e.title, 18)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <SearchInput value={q} onChange={setQ} label="חיפוש מתנדבים" placeholder={SEARCH_PLACEHOLDER} />
          {assign.isError && <ErrorBox error={errorMessage(assign.error)} />}
          {candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center text-muted">
              <p className="font-semibold text-ink">{q ? 'אין תוצאות לחיפוש הזה' : 'אין מתנדבים פעילים פנויים'}</p>
              {q ? <Button size="sm" variant="secondary" onClick={() => setQ('')}>ניקוי החיפוש והסינון</Button> : <p>אפשר להוסיף מתנדב חדש מכאן.</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {preferred.length > 0 && (
                <section aria-labelledby="pick-pref">
                  <h3 id="pick-pref" className="mb-1 text-small font-semibold text-muted">מעדיפים {ROLE_LABEL[def.role]}</h3>
                  <ul className="-mx-3 flex flex-col">{preferred.map(row)}</ul>
                </section>
              )}
              {others.length > 0 && (
                <section aria-labelledby="pick-rest">
                  <h3 id="pick-rest" className="mb-1 text-small font-semibold text-muted">{preferred.length ? 'שאר המתנדבים' : 'המתנדבים'}</h3>
                  <ul className="-mx-3 flex flex-col">{others.map(row)}</ul>
                </section>
              )}
            </div>
          )}
        </div>
      </Dialog>
      {adding && (
        <VolunteerDialog
          volunteer={null}
          defaultRoles={[def.role]}
          onClose={() => setAdding(false)}
          onSaved={(id, name) => {
            assign.mutate(
              { volunteerId: id, role: def.role, eventIds: [event.id, ...also], replace: replace?.id ?? null, done: `${name}: הוספה לרשימה ושיבוץ ל${label}` },
              { onSuccess: () => after(`${name}: ${label}`) },
            );
          }}
        />
      )}
    </>
  );
}

// ───────────── one shift ─────────────

function ShiftDialog({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const { volunteer, assign, send } = useVolunteerActions();
  const set = useSetShiftStatus();
  const confirm = useConfirm();
  const v = volunteer(shift.volunteer_id);
  const name = v?.full_name ?? '(בלי שם)';
  const e = shift.event;
  const def = { role: shift.role, label: roleLabel(e.type, shift.role) };
  const mark = (status: Shift['status']) => set.mutate({ shift, status, name }, { onSuccess: onClose });
  const cancel = async () => {
    const ok = await confirm({
      title: `לבטל את השיבוץ של ${name}?`,
      body: `${def.label} ב${e.title}, ${fmtDayLong(e.starts_at)}. המקום יסומן "חסר". אם כבר נשלח קישור אישי, המשמרת תיעלם ממנו.`,
      confirm: 'ביטול השיבוץ',
      cancel: 'חזרה',
      danger: true,
    });
    if (ok) mark('cancelled');
  };
  const upcoming = isUpcoming(e);
  return (
    <Dialog open onClose={onClose} title={name} size="sm">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-body"><span className="font-semibold">{def.label}</span> · {e.title}</p>
          <p className="text-small text-muted">{fmtDayLong(e.starts_at)}, <span className="num">{fmtTime(e.starts_at)}</span>{e.location ? ` · ${e.location}` : ''}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={shift.status} />
            {shift.responded_at && <span className="text-small text-muted">עודכן {ago(shift.responded_at)}</span>}
            {v && !v.is_active && <Badge>ברשימת הלא פעילים</Badge>}
          </div>
          {v?.phone && (
            <a href={telLink(v.phone)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-tide hover:underline">
              <Icon name="phone" size={16} /><span className="num">{formatPhone(v.phone)}</span>
            </a>
          )}
          {v?.notes && <p className="mt-1 text-small whitespace-pre-line text-ink-soft"><span className="font-semibold text-muted">הערות: </span>{v.notes}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-small font-medium text-muted">התשובה הגיעה בטלפון? מסמנים כאן:</p>
          <div className="grid grid-cols-2 gap-2">
            <Button icon="check" variant={shift.status === 'confirmed' ? 'primary' : 'secondary'} aria-pressed={shift.status === 'confirmed'} disabled={set.isPending || shift.status === 'confirmed'} onClick={() => mark('confirmed')}>אישור הגעה</Button>
            <Button icon="close" variant={shift.status === 'declined' ? 'primary' : 'secondary'} aria-pressed={shift.status === 'declined'} disabled={set.isPending || shift.status === 'declined'} onClick={() => mark('declined')}>לא מסתדר</Button>
          </div>
          {shift.status !== 'invited' && (
            <Button variant="ghost" icon="undo" className="self-start" disabled={set.isPending} onClick={() => mark('invited')}>חזרה ל"בהמתנה"</Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-edge pt-4">
          {v?.is_active && upcoming && <Button variant="secondary" icon="link" onClick={() => send(v.id)}>שליחת קישור</Button>}
          {shift.status === 'confirmed' && remindable(e) && <ReminderLink shift={shift} volunteer={v} size="md" />}
          {upcoming && (shift.status === 'declined'
            ? <Button variant="secondary" icon="userPlus" onClick={() => assign(e, def)}>שיבוץ מישהו אחר</Button>
            : <Button variant="secondary" icon="merge" onClick={() => assign(e, def, shift)}>החלפה</Button>)}
          <Button variant="danger" disabled={set.isPending} onClick={cancel}>ביטול השיבוץ</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ───────────── the personal link ─────────────

function SendLinkDialog({ volunteer: v, onClose }: { volunteer: Volunteer; onClose: () => void }) {
  const { data } = useVolunteerActions();
  const copy = useCopy();
  const [link, setLink] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  const [text, setText] = useState('');
  const started = useRef(false);
  const mine = useMemo(() => data.shifts.filter((s) => s.volunteer_id === v.id), [data.shifts, v.id]);
  const pending = mine.filter((s) => s.status === 'invited' && isUpcoming(s.event)).length;

  // a new link replaces the previous one, so it is made once per opened dialog
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createVolunteerLink(v.id).then(
      (token) => {
        const url = volunteerUrl(token);
        setLink({ url, error: null });
        setText(linkMessage(v.full_name, mine, url));
      },
      (e) => setLink({ url: null, error: errorMessage(e) }),
    );
  }, [v.id, v.full_name, mine]);

  return (
    <Dialog open onClose={onClose} title={`קישור אישי ל${v.full_name}`}>
      <div className="flex flex-col gap-4">
        <p className="text-small text-muted">
          {pending ? <>מחכים לתשובה ב-<span className="num">{pending}</span> {pending === 1 ? 'מפגש' : 'מפגשים'}. </> : null}
          בקישור מופיעים כל המפגשים של {firstName(v.full_name)}, ושם מאשרים הגעה או מעדכנים שלא מסתדר.
        </p>
        {link.error ? (
          <ErrorBox error={`לא הצלחנו ליצור קישור: ${link.error}`} />
        ) : !link.url ? (
          <div className="flex items-center gap-2 text-muted" role="status"><Spinner /> מכין קישור אישי…</div>
        ) : (
          <Textarea label="הטקסט (אפשר לערוך לפני השליחה)" value={text} onChange={(e) => setText(e.target.value)} rows={9} />
        )}
        {!v.phone && <Notice tone="warn" icon="alert">אין מספר טלפון ברשימה. אפשר להעתיק את ההודעה ולשלוח בדרך אחרת, או להוסיף טלפון בעריכה.</Notice>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {v.phone && link.url && (
          <a href={whatsappLink(v.phone, text)} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'md')} onClick={onClose}>
            <Icon name="message" size={18} />
            פתיחה בוואטסאפ
          </a>
        )}
        {link.url && <Button variant="secondary" icon="copy" onClick={() => copy(text, 'ההודעה הועתקה')}>העתקת ההודעה</Button>}
        {link.url && <Button variant="ghost" icon="link" onClick={() => copy(link.url!, 'הקישור הועתק')}>רק הקישור</Button>}
      </div>
      <p className="mt-3 text-sm text-muted">הקישור חדש ומחליף קישור קודם שנשלח ל{firstName(v.full_name)}. ההודעה נשלחת מהוואטסאפ שלך, רק כשלוחצים "שליחה" שם.</p>
    </Dialog>
  );
}

/** "Waiting for an answer": one chip per volunteer with invitations, each opens the personal-link message. */
export function PendingLinks({ shifts, className = '' }: { shifts: Shift[]; className?: string }) {
  const { send, volunteer } = useVolunteerActions();
  const by = new Map<string, number>();
  for (const s of shifts) if (s.status === 'invited' && isUpcoming(s.event)) by.set(s.volunteer_id, (by.get(s.volunteer_id) ?? 0) + 1);
  const rows = [...by.entries()].map(([id, n]) => ({ v: volunteer(id), n })).filter((r) => r.v?.is_active)
    .sort((a, b) => a.v!.full_name.localeCompare(b.v!.full_name, 'he'));
  if (!rows.length) return null;
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <p className="text-small font-medium text-muted">מחכים לתשובה. שולחים לכל שם ברשימה קישור אישי עם כל המפגשים שלו:</p>
      <ul className="flex flex-wrap gap-2">
        {rows.map(({ v, n }) => (
          <li key={v!.id}>
            {/* the name says the visible text ("דנה כהן 2") inside it, for voice control */}
            <Button size="sm" variant="secondary" icon="link" onClick={() => send(v!.id)} aria-label={`${v!.full_name} ${n}: שליחת קישור אישי`} title={`${n} מחכים לתשובה`}>
              {v!.full_name}{' '}
              <span className="num text-micro text-muted">{n}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reminders for the meetings of the next two days: one WhatsApp link per confirmed volunteer. */
export function Reminders({ shifts, className = '', title = true }: { shifts: Shift[]; className?: string; title?: boolean }) {
  const { volunteer } = useVolunteerActions();
  const due = shifts.filter((s) => s.status === 'confirmed' && remindable(s.event))
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  if (!due.length) return null;
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {title && <p className="text-small font-medium text-muted">תזכורת למי שאישר הגעה, למפגשים של היומיים הקרובים:</p>}
      <ul className="flex flex-wrap gap-2">
        {due.map((s) => {
          const v = volunteer(s.volunteer_id);
          return (
            <li key={s.id} className="flex items-center gap-1.5">
              {v?.phone ? <ReminderLink shift={s} volunteer={v} /> : <span className="text-small text-muted">{v?.full_name ?? ''}: אין טלפון</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

