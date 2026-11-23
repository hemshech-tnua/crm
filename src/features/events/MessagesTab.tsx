import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useTemplates, type EventWithStats } from '@/lib/data';
import { errorMessage, must } from '@/lib/errors';
import { fmtDateTime, fmtListDate } from '@/lib/dates';
import { fmtMoney, isPriced } from '@/lib/money';
import { formatPhone, whatsappLink } from '@/lib/phone';
import { manageUrl } from '@/lib/links';
import { needsPersonalLink, renderTemplate, type TemplateContext } from '@/lib/templates';
import type { Membership, Template } from '@/lib/types';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, FilterChips, Notice, Panel, Select, Skeleton, Textarea, buttonClass, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { allowedFor, useLogContact, type Recipient } from '@/ui/MessageComposer';
import { Dialog, useCopy } from '@/ui/feedback';
import type { EventPeople } from './context';
import { useConsentedRecent, useEventRegistrations, useSentForEvent, type RegRow } from './queries';
import { hasStarted } from './shared';

type Group = 'registered' | 'waitlisted' | 'unpaid' | 'attended' | 'no_show' | 'aftercare' | 'consented';
// "למי" comes first: the audience picks the message, not the other way round
const GROUPS: { value: Group; label: string }[] = [
  { value: 'registered', label: 'רשומים' },
  { value: 'waitlisted', label: 'רשימת המתנה' },
  { value: 'unpaid', label: 'לא שילמו' },
  { value: 'attended', label: 'הגיעו' },
  { value: 'no_show', label: 'לא הגיעו' },
  { value: 'aftercare', label: 'תודה אחרי המפגש' },
  { value: 'consented', label: 'מוזמנים (הסכימו לעדכונים)' },
];
const AUDIENCE_GROUP: Record<Template['audience'], Group> = {
  registered: 'registered',
  waitlisted: 'waitlisted',
  attended: 'attended',
  no_show: 'no_show',
  consented: 'consented',
  participant: 'consented',
};
const GROUP_HINT: Record<Group, string> = {
  aftercare: 'כל מי שהגיע, בנוסח המתאים: מי שאישר עדכונים ועוד לא הצטרף לעמותה מקבל תודה והזמנה להצטרף. כל השאר מקבלים תודה ובקשה למשוב.',
  registered: 'כל מי שרשום למפגש (בלי רשימת המתנה, מי שביטל ומי שהגיע בלי הרשמה).',
  waitlisted: 'מי שברשימת ההמתנה.',
  unpaid: 'רשומים שעוד לא שילמו, ומי שהתחיל הרשמה ולא שילם (אין לו מקום עד התשלום). כל אחד מקבל את הנוסח שמתאים לו.',
  attended: 'רשומים שסומנה להם הגעה.',
  no_show: 'רשומים שלא הגיעו. מסומנים בסגירת המפגש.',
  consented: 'אישרו לקבל עדכונים בוואטסאפ, הגיעו לפעילות כלשהי ב־90 הימים האחרונים, ועדיין לא רשומים למפגש הזה.',
};
/** The template each audience starts from (when the meeting has it). */
const PREFERRED: Partial<Record<Group, string>> = { registered: 'reminder', attended: 'thanks', no_show: 'missed_you' };

type Person = Recipient & { note?: string; membership?: Membership; registrationId?: string; startedUnpaid?: boolean };

// The thank-you 24 hours after the meeting: the invitation to join is a marketing message (Communications Law
// §30A), so it goes only to non-members who agreed to updates; everyone else gets the plain thank-you.
const AFTERCARE_KEYS = ['thanks', 'join_invite'];
const AFTERCARE_DELAY_MS = 24 * 3600_000;
const aftercareKey = (p: Person, templates: Template[]) =>
  p.membership === 'none' && p.consent_updates && templates.some((t) => t.key === 'join_invite') ? 'join_invite' : 'thanks';

// ── the payment reminder: written here (no stored template), logged in the contact history with this summary ──
const PAYMENT_SUMMARY = 'תזכורת תשלום';
/** A reminder counts as done for the day; an older one does not stop the next round. */
const PAYMENT_FRESH_MS = 20 * 3600_000;
const owes = (r: RegRow) => r.status === 'registered' && r.payment_status === 'pending' && r.attendance !== 'no_show';

function paymentBody(e: EventWithStats, started: boolean): string {
  if (started) {
    return [
      'היי {שם_פרטי},',
      'ההרשמה שלך ל{שם_המפגש} ({תאריך} בשעה {שעה}) עוד מחכה לתשלום.',
      'המקום נשמר רק אחרי התשלום. להשלמת ההרשמה:',
      '{קישור_אישי}',
      'אם כבר שילמת, אפשר פשוט לענות להודעה הזו.',
    ].join('\n');
  }
  const price = isPriced(e.price) ? fmtMoney(e.price) : null;
  return [
    'היי {שם_פרטי},',
    `תזכורת קטנה: ${price ? `דמי ההשתתפות ב{שם_המפגש} ({תאריך}) הם ${price}` : 'דמי ההשתתפות ב{שם_המפגש} ({תאריך})'} ועוד לא שולמו.`,
    e.payment_url ? `אפשר לשלם כאן: ${e.payment_url}` : 'אפשר לשלם בכניסה למפגש.',
    'אם כבר שילמת, אפשר פשוט לענות להודעה הזו. תודה!',
  ].join('\n');
}

/** What the composer sends to one person: stored templates to choose from, or the written payment reminder. */
type Plan = { keys: string[]; defaultKey: string } | { payment: true };

export function MessagesTab({ event: e, people, initialGroup }: { event: EventWithStats; people: EventPeople; initialGroup: string | null }) {
  const role = useRole();
  const templates = useTemplates();
  const regs = useEventRegistrations(e);
  const sent = useSentForEvent(e.id);
  const started = hasStarted(e);
  const list = useMemo(() => templates.data ?? [], [templates.data]);
  const ended = new Date(e.ends_at).getTime() < Date.now();

  const [group, setGroup] = useState<Group>(() =>
    initialGroup && GROUPS.some((g) => g.value === initialGroup) ? (initialGroup as Group)
      : ended && e.status !== 'cancelled' ? 'aftercare' : e.status === 'completed' ? 'attended' : 'registered');
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  // a link to another audience (?group=…) while the tab is open moves the choice with it
  useEffect(() => {
    if (initialGroup && GROUPS.some((g) => g.value === initialGroup)) { setGroup(initialGroup as Group); setPickedKey(null); }
  }, [initialGroup]);
  const aftercare = group === 'aftercare';
  const payment = group === 'unpaid';
  const forGroup = list.filter((t) => AUDIENCE_GROUP[t.audience] === group);
  const others = list.filter((t) => AUDIENCE_GROUP[t.audience] !== group);
  const firstKey = (forGroup.find((t) => t.key === PREFERRED[group] && !(group === 'registered' && started)) ?? forGroup[0] ?? list[0])?.key ?? '';
  const key = pickedKey && list.some((t) => t.key === pickedKey) ? pickedKey : firstKey;
  const tpl = list.find((t) => t.key === key);
  const pickGroup = (g: Group) => { setGroup(g); setPickedKey(null); };
  const readyAt = new Date(new Date(e.ends_at).getTime() + AFTERCARE_DELAY_MS);
  const [queue, setQueue] = useState<Person[] | null>(null);

  const activeIds = useMemo(() => (regs.data ?? []).filter((r) => r.status === 'registered' || r.status === 'waitlisted').map((r) => r.participant_id), [regs.data]);
  const consented = useConsentedRecent(e.id, activeIds, group === 'consented' && !!regs.data);
  const payments = useQuery({
    // under ['messages_sent']: logging a message refreshes it
    queryKey: ['messages_sent', e.id, 'payment'],
    enabled: payment,
    queryFn: async () => must(await supabase.from('contact_log').select('participant_id, created_at').eq('event_id', e.id).eq('summary', PAYMENT_SUMMARY)
      .order('created_at', { ascending: false })) as { participant_id: string; created_at: string }[],
  });

  const inGroup = (r: RegRow, g: Group) =>
    // "רשומים" as everywhere: registered before the meeting (a walk-in is not a registration)
    g === 'registered' ? r.status === 'registered' && !r.is_walk_in
      : g === 'waitlisted' ? r.status === 'waitlisted'
        : g === 'unpaid' ? owes(r) || r.status === 'pending_payment'
          : g === 'attended' || g === 'aftercare' ? r.attendance === 'attended'
            : g === 'no_show' ? r.attendance === 'no_show' : false;
  const live = useMemo(() => (regs.data ?? []).filter((r) => r.participant && !r.participant.anonymized_at), [regs.data]);
  const groupCount = (g: Group) => (g === 'consented' ? undefined : live.filter((r) => inGroup(r, g)).length);

  const recipients: Person[] = useMemo(() => {
    if (group === 'consented') return (consented.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name, phone: p.phone, consent_updates: p.consent_updates }));
    return live
      .filter((r) => inGroup(r, group))
      .map((r) => ({
        id: r.participant!.id,
        full_name: r.participant!.full_name,
        phone: r.participant!.phone,
        consent_updates: r.participant!.consent_updates,
        membership: r.participant!.membership,
        registrationId: r.id,
        startedUnpaid: r.status === 'pending_payment',
        note: r.first_time && (group === 'attended' || group === 'aftercare') ? 'פעם ראשונה'
          : group === 'unpaid' && r.status === 'pending_payment' ? 'התחילו הרשמה' : undefined,
      }));
  }, [group, live, consented.data]);

  const sentAt = useMemo(() => {
    const m = new Map<string, string>();
    if (payment) {
      for (const row of payments.data ?? []) {
        if (Date.now() - new Date(row.created_at).getTime() < PAYMENT_FRESH_MS && !m.has(row.participant_id)) m.set(row.participant_id, row.created_at);
      }
      return m;
    }
    for (const row of sent.data ?? []) {
      const match = aftercare ? AFTERCARE_KEYS.includes(row.template_key ?? '') : row.template_key === key;
      if (match && !m.has(row.participant_id)) m.set(row.participant_id, row.created_at);
    }
    return m;
  }, [sent.data, payments.data, key, aftercare, payment]);
  const lastReminder = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of payments.data ?? []) if (!m.has(row.participant_id)) m.set(row.participant_id, row.created_at);
    return m;
  }, [payments.data]);

  const eligible = (p: Person) => !!p.phone && (aftercare || payment || allowedFor(tpl, p));
  const ordered = [...recipients].sort((a, b) => {
    const rank = (p: Person) => (sentAt.has(p.id) ? 2 : eligible(p) ? 0 : 1);
    return rank(a) - rank(b) || (a.full_name ?? '').localeCompare(b.full_name ?? '', 'he');
  });
  const eligibleCount = recipients.filter(eligible).length;
  const doneCount = recipients.filter((p) => eligible(p) && sentAt.has(p.id)).length;
  const pending = ordered.filter((p) => eligible(p) && !sentAt.has(p.id));
  const blocked = aftercare || payment ? 0 : recipients.filter((p) => p.phone && !allowedFor(tpl, p)).length;
  /** The queue from one person on: them, then everyone after them who still waits. */
  const queueFrom = (p: Person) => [p, ...pending.filter((x) => x.id !== p.id)];
  const planFor = (p: Person): Plan => (payment ? { payment: true } : aftercare ? { keys: AFTERCARE_KEYS, defaultKey: aftercareKey(p, list) } : { keys: [key], defaultKey: key });

  const copy = useCopy();
  const loading = templates.isLoading || regs.isLoading || (group === 'consented' && consented.isLoading) || (payment && payments.isLoading);
  const error = templates.error || regs.error || sent.error || (group === 'consented' ? consented.error : null) || (payment ? payments.error : null);

  if (templates.isLoading) return <Panel><Skeleton lines={6} /></Panel>;
  if (templates.isError && !templates.data) return <ErrorBox error={errorMessage(templates.error)} onRetry={() => templates.refetch()} />;
  if (!list.length) {
    return <Panel><EmptyState icon="message" title="אין תבניות הודעה">{can.admin(role) ? 'מוסיפים תבניות בהגדרות.' : 'את נוסח התבניות קובעים המנהלים.'}</EmptyState></Panel>;
  }

  const sample = { ...people.ctx, firstName: '‹שם פרטי›' };
  const preview = tpl ? renderTemplate(tpl.body, sample) : '';
  const previewOf = (k: string) => {
    const t = list.find((x) => x.key === k);
    return t ? renderTemplate(t.body, sample) : '';
  };
  const joinCount = aftercare ? recipients.filter((p) => p.phone && aftercareKey(p, list) === 'join_invite').length : 0;
  // S8: one generic text for a WhatsApp broadcast list or group (service templates only; marketing needs per-person consent)
  const broadcast = !payment && !aftercare && tpl && !tpl.is_marketing ? renderTemplate(tpl.body, { ...people.ctx, firstName: 'כולם' }) : '';
  const chips = GROUPS
    .filter((g) => g.value !== 'unpaid' || isPriced(e.price) || (groupCount('unpaid') ?? 0) > 0)
    .map((g) => ({ value: g.value, label: g.label, count: groupCount(g.value) }));
  const startedCount = payment ? recipients.filter((p) => p.startedUnpaid).length : 0;
  const owingCount = payment ? recipients.length - startedCount : 0;
  const nextName = pending[0]?.full_name?.split(' ')[0];

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="tide" icon="shield">
        שום הודעה לא נשלחת לבד: "שליחה" פותחת וואטסאפ עם הטקסט מוכן, ושם לוחצים "שליחה". כל פתיחה נרשמת בכרטיס.
      </Notice>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title="למי ומה שולחים">
          <div className="flex flex-col gap-5">
            <div>
              <div className="mb-1.5 text-small font-medium" aria-hidden="true">למי</div>
              <FilterChips label="למי" value={group} onChange={pickGroup} className="sm:mx-0 sm:flex-wrap" options={chips} />
              <p className="mt-2 text-small text-muted">{GROUP_HINT[group]}</p>
            </div>

            <div className="flex flex-col gap-4 border-t border-edge pt-4">
              <div className="text-small font-medium" aria-hidden="true">מה</div>
              {payment ? (
                <PaymentInfo e={e} owing={owingCount} startedCount={startedCount} ctx={sample} />
              ) : aftercare ? (
                <AftercareInfo readyAt={readyAt} joinCount={joinCount} thanks={previewOf('thanks')} join={previewOf('join_invite')} />
              ) : (<>
                <Select label="תבנית" value={key} onChange={(x) => setPickedKey(x.target.value)}>
                  {forGroup.map((t) => <option key={t.key} value={t.key}>{t.label}{t.is_marketing ? ' (דורש הסכמה)' : ''}</option>)}
                  {others.length > 0 && (
                    <optgroup label="תבניות אחרות">
                      {others.map((t) => <option key={t.key} value={t.key}>{t.label}{t.is_marketing ? ' (דורש הסכמה)' : ''}</option>)}
                    </optgroup>
                  )}
                </Select>
                {tpl?.is_marketing && (
                  <Notice tone="light" icon="alert">הודעה שיווקית: לפי חוק התקשורת נשלחת רק למי שאישר לקבל עדכונים והזמנות.</Notice>
                )}
                <div>
                  <div className="mb-1.5 text-small font-medium">כך זה ייראה</div>
                  <Bubble text={preview} />
                  <p className="mt-1.5 text-small text-muted">שורה עם פרט שחסר במפגש (למשל מרצה) יורדת מההודעה. אפשר לערוך את הטקסט לפני כל שליחה.</p>
                  {broadcast && (
                    <div className="mt-3 rounded-[var(--radius-control)] border border-edge p-3">
                      <p className="text-small text-ink-soft">יש רשימת תפוצה בוואטסאפ לנרשמים? אפשר לשלוח לכולם בבת אחת עם נוסח כללי:</p>
                      <Button size="sm" variant="secondary" icon="copy" className="mt-2" onClick={() => copy(broadcast, 'הנוסח הכללי הועתק')}>העתקת נוסח כללי לרשימת תפוצה</Button>
                    </div>
                  )}
                </div>
              </>)}
            </div>
          </div>
        </Panel>

        <Panel
          title={<span>נפתחו בוואטסאפ <span className="num">{doneCount}</span> מתוך <span className="num">{eligibleCount}</span></span>}
          actions={pending.length ? (
            <Button size="sm" icon="message" onClick={() => setQueue(queueFrom(pending[0]))}>
              {pending.length === 1 ? (nextName ? `שליחה ל${nextName}` : 'לשליחה') : `שליחה ברצף (${pending.length})`}
            </Button>
          ) : undefined}
          padded={false}
        >
          <div className="px-4 pt-3 sm:px-5">
            <div className="h-1.5 bg-ink/10" role="progressbar" aria-valuemin={0} aria-valuemax={eligibleCount} aria-valuenow={doneCount} aria-label="התקדמות השליחה">
              <div className="h-full bg-ink transition-[width]" style={{ width: eligibleCount ? `${(doneCount / eligibleCount) * 100}%` : '0%' }} />
            </div>
            {blocked > 0 && <p className="mt-2 flex items-start gap-1.5 text-small font-medium text-ink-soft"><Icon name="alert" size={15} className="mt-0.5" />{blocked === 1 ? 'הודעה אחת לא נשלחת' : `${blocked} הודעות לא נשלחות`}, כי אין הסכמה לקבל עדכונים.</p>}
          </div>
          {loading ? (
            <div className="p-5"><Skeleton lines={5} /></div>
          ) : error && !regs.data ? (
            <div className="p-4"><ErrorBox error={errorMessage(error)} onRetry={() => { void regs.refetch(); void sent.refetch(); }} /></div>
          ) : ordered.length === 0 ? (
            <EmptyState icon={payment ? 'checkCircle' : 'people'} title={payment ? 'כולם שילמו' : 'אין נמענים בקבוצה הזו'}>
              {payment ? 'אין רשומים שחייבים תשלום, ואין הרשמות שמחכות לתשלום.'
                : aftercare ? 'עוד לא סומנו הגעות למפגש הזה.' : group === 'no_show' && e.status !== 'completed' ? 'אי־הגעה מסומנת בסגירת המפגש.' : group === 'consented' ? 'אין כרגע מי שאישר עדכונים, הגיע לאחרונה ועוד לא נרשם.' : 'אפשר לבחור קבוצה אחרת.'}
            </EmptyState>
          ) : (
            <ul className="mt-2 divide-y divide-edge">
              {ordered.map((p) => {
                const at = sentAt.get(p.id);
                const ok = eligible(p);
                const earlier = payment && !at ? lastReminder.get(p.id) : undefined;
                return (
                  <li key={p.id} className={cx('flex items-center gap-3 px-4 py-2.5 sm:px-5', at && 'bg-mist/50')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                        {p.full_name}
                        {p.note && <Badge tone={payment && p.startedUnpaid ? 'warn' : 'light'}>{p.note}</Badge>}
                        {aftercare && p.membership === 'member' && <Badge tone="good">חברות בעמותה</Badge>}
                        {aftercare && p.phone && aftercareKey(p, list) === 'join_invite' && <Badge tone="light">+ הזמנה להצטרף</Badge>}
                      </div>
                      <div className="text-right text-small text-muted">
                        <span className="num">{formatPhone(p.phone)}</span>{!p.phone && 'אין טלפון'}
                        {earlier && <> · תזכורת קודמת <span className="tabular-nums">{fmtListDate(earlier)}</span></>}
                      </div>
                    </div>
                    {at ? (
                      <div className="flex items-center gap-1.5">
                        <Badge tone="good" icon="check" title='נפתח בוואטסאפ. המערכת לא יודעת אם נלחץ שם "שליחה".'>נפתח בוואטסאפ <span className="tabular-nums">{fmtListDate(at)}</span></Badge>
                        <Button size="sm" variant="ghost" onClick={() => setQueue([p])}>שוב</Button>
                      </div>
                    ) : !p.phone ? (
                      <Badge tone="neutral">אין טלפון</Badge>
                    ) : !ok ? (
                      <Badge tone="neutral" icon="alert" title="אין הסכמה לקבל עדכונים והזמנות">אין הסכמה</Badge>
                    ) : (
                      <Button size="sm" variant="secondary" icon="message" onClick={() => setQueue(queueFrom(p))}>שליחה</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-edge px-4 py-3 text-small text-muted sm:px-5">
            {can.admin(role)
              ? <>רוצים לשנות את נוסח התבניות? <ButtonLink to="/app/settings?tab=templates" variant="ghost" size="sm">הגדרות ← הודעות וואטסאפ</ButtonLink></>
              : 'את נוסח התבניות קובעים המנהלים. אפשר לערוך את הטקסט לפני כל שליחה.'}
          </div>
        </Panel>
      </div>

      {queue && queue.length > 0 && (
        <QueueComposer
          queue={queue}
          plan={planFor}
          event={e}
          templates={list}
          context={people.ctx}
          onClose={() => setQueue(null)}
        />
      )}
    </div>
  );
}

function Bubble({ text, empty = 'התבנית ריקה.' }: { text: string; empty?: string }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-[#e7f4ea] px-3.5 py-3 text-body leading-relaxed whitespace-pre-line text-ink">
      {text || <span className="text-muted">{empty}</span>}
    </div>
  );
}

/** The payment reminder: two texts, for who is registered and owes the fee, and for who started and did not pay. */
function PaymentInfo({ e, owing, startedCount, ctx }: { e: EventWithStats; owing: number; startedCount: number; ctx: TemplateContext }) {
  const sample = { ...ctx, personalLink: '‹קישור אישי להשלמת התשלום›' };
  return (
    <>
      <div>
        <div className="mb-1.5 text-small font-medium">
          תזכורת תשלום לרשומים {owing > 0 && <span className="font-normal text-muted">(<span className="num">{owing}</span> נמענים)</span>}
        </div>
        <Bubble text={renderTemplate(paymentBody(e, false), sample)} />
      </div>
      {(startedCount > 0 || !!e.payment_url) && (
        <div>
          <div className="mb-1.5 text-small font-medium">
            השלמת הרשמה למי שהתחיל ולא שילם {startedCount > 0 && <span className="font-normal text-muted">(<span className="num">{startedCount}</span> נמענים)</span>}
          </div>
          <Bubble text={renderTemplate(paymentBody(e, true), sample)} />
          <p className="mt-1.5 text-small text-muted">כל אחד מקבל קישור אישי משלו, שמוביל ישר לתשלום. אפשר לערוך את הטקסט לפני כל שליחה.</p>
        </div>
      )}
    </>
  );
}

/** What the after-meeting thank-you does, when it is ready, and the two texts. */
function AftercareInfo({ readyAt, joinCount, thanks, join }: { readyAt: Date; joinCount: number; thanks: string; join: string }) {
  const ready = readyAt.getTime() <= Date.now();
  return (
    <>
      {ready ? (
        <Notice tone="light" icon="checkCircle">עברו 24 שעות מסוף המפגש: זה הזמן לשלוח תודה. כל שליחה נרשמת, כך שרואים למי כבר נשלח.</Notice>
      ) : (
        <Notice tone="tide" icon="calendar">ההודעות יהיו מוכנות ב־<span className="num">{fmtDateTime(readyAt.toISOString())}</span>, 24 שעות אחרי סוף המפגש. אז המפגש יופיע גם במסך הסקירה. אפשר לשלוח כבר עכשיו.</Notice>
      )}
      <div>
        <div className="mb-1.5 text-small font-medium">תודה (לכל מי שהגיע)</div>
        <Bubble text={thanks} empty='אין תבנית "תודה". מנהלים יכולים להוסיף בהגדרות.' />
      </div>
      <div>
        <div className="mb-1.5 text-small font-medium">
          תודה + הזמנה להצטרף לעמותה {joinCount > 0 && <span className="font-normal text-muted">(<span className="num">{joinCount}</span> נמענים)</span>}
        </div>
        <Bubble text={join} empty='אין תבנית "הזמנה להצטרף". מנהלים יכולים להוסיף בהגדרות.' />
        <p className="mt-1.5 text-small text-muted">רק למי שאישר לקבל עדכונים והזמנות ועוד לא הצטרף לעמותה (חוק התקשורת). אפשר לערוך את הטקסט לפני כל שליחה.</p>
      </div>
    </>
  );
}

// ───────────── sending one after another ─────────────

/**
 * One person at a time: the text ready to edit, "פתיחה בוואטסאפ והבא בתור" opens WhatsApp with it, logs it, and shows
 * the next person straight away. Nothing is sent from here: the person presses "send" in WhatsApp.
 */
function QueueComposer({ queue, plan, event: e, templates, context, onClose }: {
  queue: Person[]; plan: (p: Person) => Plan; event: EventWithStats; templates: Template[]; context: TemplateContext; onClose: () => void;
}) {
  const log = useLogContact();
  const copy = useCopy();
  const [i, setI] = useState(0);
  const p = queue[i];
  const pl = plan(p);
  const isPayment = 'payment' in pl;
  const options = isPayment ? [] : templates.filter((t) => pl.keys.includes(t.key));
  const [key, setKey] = useState(isPayment ? '' : pl.defaultKey);
  const tpl = options.find((t) => t.key === key);
  const body = isPayment ? paymentBody(e, !!p.startedUnpaid) : tpl?.body ?? '';
  const firstName = p.full_name?.split(' ')[0] ?? '';
  const hasNext = i < queue.length - 1;

  // a personal link is made once per person, only when the text uses it (a new link replaces the registration's previous one)
  const wantsLink = !!p.registrationId && needsPersonalLink(body);
  const [link, setLink] = useState<{ for: string; url: string | null; error: string | null } | null>(null);
  // asked once per person shown: a new link replaces the registration's previous one, so a second call (React's
  // StrictMode runs effects twice in development; a quick re-render before the state lands) would void the link on
  // screen. The ref outlives both runs; the state still decides which person's link is shown.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!wantsLink || !p.registrationId || link?.for === p.registrationId || requested.current === p.registrationId) return;
    const id = p.registrationId;
    requested.current = id;
    setLink({ for: id, url: null, error: null });
    supabase.rpc('staff_personal_link', { p_registration_id: id }).then(({ data, error }) => {
      // a late answer for someone already skipped is dropped
      setLink((cur) => (cur?.for !== id ? cur : error || typeof data !== 'string'
        ? { for: id, url: null, error: errorMessage(error ?? new Error('link')) }
        : { for: id, url: manageUrl(data), error: null }));
    });
  }, [wantsLink, p.registrationId, link?.for]);
  const myLink = link?.for === p.registrationId ? link : null;
  const linkPending = wantsLink && !myLink?.url && !myLink?.error;

  // the text belongs to one person: an edit is kept only for the person (and template and link) it was made for, so the
  // dialog never shows or sends someone else's text, not even for one render after moving to the next person
  const sig = `${p.id}|${key}|${myLink?.url ?? ''}`;
  const rendered = body ? renderTemplate(body, { ...context, firstName, personalLink: myLink?.url ?? null }) : '';
  const [edit, setEdit] = useState<{ for: string; value: string } | null>(null);
  const text = edit?.for === sig ? edit.value : rendered;
  const setText = (value: string) => setEdit({ for: sig, value });

  const next = () => {
    if (!hasNext) { onClose(); return; }
    const n = queue[i + 1];
    const np = plan(n);
    if (!('payment' in np)) setKey(np.defaultKey);
    setI(i + 1);
  };
  const opened = (ev: MouseEvent<HTMLAnchorElement>) => {
    // open this person's chat from what is on screen now, before moving on: the link must never be re-rendered with the
    // next person's number between the tap and the browser following it
    ev.preventDefault();
    window.open(whatsappLink(p.phone!, text), '_blank', 'noopener,noreferrer');
    log.mutate({
      participant_id: p.id, channel: 'whatsapp', template_key: isPayment ? null : tpl?.key ?? null,
      summary: isPayment ? PAYMENT_SUMMARY : null, event_id: e.id,
    });
    next();
  };

  const allowed = isPayment || !tpl || allowedFor(tpl, p);
  const ready = !!p.phone && allowed && !linkPending && !!text;
  return (
    <Dialog open onClose={onClose} title={`הודעה ל${p.full_name ?? ''}`}>
      <div className="flex flex-col gap-4">
        {queue.length > 1 && (
          <p className="text-small text-muted">
            <span className="num">{i + 1}</span> מתוך <span className="num">{queue.length}</span>
            {hasNext && <> · הבא בתור: {queue[i + 1].full_name}</>}
          </p>
        )}
        {options.length > 1 && (
          <Select label="תבנית" value={key} onChange={(x) => setKey(x.target.value)}>
            {options.map((t) => <option key={t.key} value={t.key}>{t.label}{t.is_marketing ? ' (דורש הסכמה)' : ''}</option>)}
          </Select>
        )}
        {!allowed ? (
          <Notice tone="warn" icon="alert">
            בכרטיס של {p.full_name} אין הסכמה לקבל עדכונים והזמנות. לפי חוק התקשורת, הודעה כזו נשלחת רק למי שהסכימו. אפשר להתקשר.
          </Notice>
        ) : (
          <Textarea label="הטקסט (אפשר לערוך לפני השליחה)" value={text} onChange={(x) => setText(x.target.value)} rows={7} />
        )}
        {wantsLink && myLink?.error && <Notice tone="warn" icon="alert">לא הצלחנו ליצור קישור אישי: {myLink.error}</Notice>}
        {wantsLink && myLink?.url && (
          <p className="text-small text-muted">זה קישור אישי חדש. אם כבר נשלח קישור להרשמה הזו, הוא יוחלף בזה. הקישור מיועד רק ל{firstName || 'מי שמקבל את ההודעה'}.</p>
        )}
        {!p.phone && <Notice tone="warn" icon="alert">אין מספר טלפון בכרטיס.</Notice>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {p.phone && allowed && linkPending && <Button busy disabled>מכין קישור אישי…</Button>}
        {ready && (
          <a href={whatsappLink(p.phone!, text)} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'md', '', true)} onClick={opened}>
            <Icon name="message" size={18} />
            {hasNext ? 'פתיחה בוואטסאפ והבא בתור' : 'פתיחה בוואטסאפ'}
          </a>
        )}
        {p.phone && (
          <a href={`tel:${p.phone}`} className={buttonClass('secondary', 'md')}>
            <Icon name="phone" size={18} />
            <span>חיוג</span>
            <span className="num text-small text-muted">{formatPhone(p.phone)}</span>
          </a>
        )}
        {allowed && text && <Button variant="ghost" icon="copy" onClick={() => copy(text, 'הטקסט הועתק')}>העתקה</Button>}
        {hasNext && <Button variant="ghost" onClick={next}>דילוג</Button>}
      </div>
      <p className="mt-3 text-small text-muted">ההודעה נשלחת מהוואטסאפ שלך, רק כשלוחצים "שליחה" שם. הפתיחה נרשמת בהיסטוריית הקשר שבכרטיס.</p>
    </Dialog>
  );
}
