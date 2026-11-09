import { useMemo, useState } from 'react';
import { useTemplates, type EventWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { fmtDateTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { renderTemplate } from '@/lib/templates';
import type { Membership, Template } from '@/lib/types';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, Notice, Panel, Select, Skeleton, cx } from '@/ui/kit';
import { MessageComposer, allowedFor, type Recipient } from '@/ui/MessageComposer';
import type { EventPeople } from './context';
import { useConsentedRecent, useEventRegistrations, useSentForEvent } from './queries';
import { hasStarted } from './shared';
import { useCopy } from '@/ui/feedback';

type Group = 'aftercare' | 'registered' | 'waitlisted' | 'attended' | 'no_show' | 'consented';
const GROUPS: { value: Group; label: string }[] = [
  { value: 'aftercare', label: 'תודה אחרי המפגש' },
  { value: 'registered', label: 'רשומים' },
  { value: 'waitlisted', label: 'בהמתנה' },
  { value: 'attended', label: 'הגיעו' },
  { value: 'no_show', label: 'לא הגיעו' },
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
  aftercare: 'כל מי שהגיע/ה, עם הנוסח המתאים לכל אחד/ת: מי שעוד לא חבר/ת עמותה ואישר/ה עדכונים מקבל/ת תודה עם הזמנה להצטרף לעמותה. כל השאר מקבלים תודה ובקשה למשוב.',
  registered: 'כל מי שרשום/ה למפגש (לא כולל בהמתנה ומבטלים).',
  waitlisted: 'מי שממתין/ה למקום.',
  attended: 'מי שסומן/ה כהגעה.',
  no_show: 'רשומים שלא הגיעו. מסומנים בסגירת המפגש.',
  consented: 'אישרו לקבל עדכונים בוואטסאפ, הגיעו לפעילות כלשהי ב-90 הימים האחרונים, ועדיין לא רשומים למפגש הזה.',
};

type Person = Recipient & { note?: string; membership?: Membership };

// The thank-you 24 hours after the meeting: the invitation to join is a marketing message (Communications Law
// §30A), so it goes only to non-members who agreed to updates; everyone else gets the plain thank-you.
const AFTERCARE_KEYS = ['thanks', 'join_invite'];
const AFTERCARE_DELAY_MS = 24 * 3600_000;
const aftercareKey = (p: Person, templates: Template[]) =>
  p.membership === 'none' && p.consent_updates && templates.some((t) => t.key === 'join_invite') ? 'join_invite' : 'thanks';

export function MessagesTab({ event: e, people, initialGroup }: { event: EventWithStats; people: EventPeople; initialGroup: string | null }) {
  const templates = useTemplates();
  const regs = useEventRegistrations(e);
  const sent = useSentForEvent(e.id);
  const started = hasStarted(e);
  const list = useMemo(() => templates.data ?? [], [templates.data]);

  const firstKey = useMemo(() => {
    if (!list.length) return '';
    const want = initialGroup ?? (e.status === 'completed' ? 'attended' : 'registered');
    const preferred = e.status === 'completed' ? 'thanks' : started ? 'thanks' : 'reminder';
    return (list.find((t) => t.key === preferred && AUDIENCE_GROUP[t.audience] === want) ?? list.find((t) => AUDIENCE_GROUP[t.audience] === want) ?? list[0]).key;
  }, [list, initialGroup, e.status, started]);

  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const key = pickedKey ?? firstKey;
  const tpl = list.find((t) => t.key === key);
  const ended = new Date(e.ends_at).getTime() < Date.now();
  const [pickedGroup, setPickedGroup] = useState<Group | null>(
    initialGroup && GROUPS.some((g) => g.value === initialGroup) ? (initialGroup as Group) : ended && e.status !== 'cancelled' ? 'aftercare' : null,
  );
  const group: Group = pickedGroup ?? (tpl ? AUDIENCE_GROUP[tpl.audience] : 'registered');
  const aftercare = group === 'aftercare';
  const readyAt = new Date(new Date(e.ends_at).getTime() + AFTERCARE_DELAY_MS);
  const [composer, setComposer] = useState<Person | null>(null);

  const activeIds = useMemo(() => (regs.data ?? []).filter((r) => r.status !== 'cancelled').map((r) => r.participant_id), [regs.data]);
  const consented = useConsentedRecent(e.id, activeIds, group === 'consented' && !!regs.data);

  const recipients: Person[] = useMemo(() => {
    if (group === 'consented') return (consented.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name, phone: p.phone, consent_updates: p.consent_updates }));
    return (regs.data ?? [])
      .filter((r) => r.participant && !r.participant.anonymized_at)
      .filter((r) =>
        group === 'registered' ? r.status === 'registered'
          : group === 'waitlisted' ? r.status === 'waitlisted'
            : group === 'attended' || group === 'aftercare' ? r.attendance === 'attended'
              : r.attendance === 'no_show',
      )
      .map((r) => ({
        id: r.participant!.id,
        full_name: r.participant!.full_name,
        phone: r.participant!.phone,
        consent_updates: r.participant!.consent_updates,
        membership: r.participant!.membership,
        note: r.first_time && (group === 'attended' || group === 'aftercare') ? 'פעם ראשונה' : undefined,
      }));
  }, [group, regs.data, consented.data]);

  const sentAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of sent.data ?? []) {
      const match = aftercare ? AFTERCARE_KEYS.includes(row.template_key ?? '') : row.template_key === key;
      if (match && !m.has(row.participant_id)) m.set(row.participant_id, row.created_at);
    }
    return m;
  }, [sent.data, key, aftercare]);

  const eligible = (p: Person) => !!p.phone && (aftercare || allowedFor(tpl, p));
  const ordered = [...recipients].sort((a, b) => {
    const rank = (p: Person) => (sentAt.has(p.id) ? 2 : eligible(p) ? 0 : 1);
    return rank(a) - rank(b) || (a.full_name ?? '').localeCompare(b.full_name ?? '', 'he');
  });
  const eligibleCount = recipients.filter(eligible).length;
  const doneCount = recipients.filter((p) => eligible(p) && sentAt.has(p.id)).length;
  const next = ordered.find((p) => eligible(p) && !sentAt.has(p.id));
  const blocked = aftercare ? 0 : recipients.filter((p) => p.phone && !allowedFor(tpl, p)).length;

  const copy = useCopy();
  const loading = templates.isLoading || regs.isLoading || (group === 'consented' && consented.isLoading);
  const error = templates.error || regs.error || sent.error || (group === 'consented' ? consented.error : null);

  if (templates.isLoading) return <Panel><Skeleton lines={6} /></Panel>;
  if (templates.isError) return <ErrorBox error={errorMessage(templates.error)} onRetry={() => templates.refetch()} />;
  if (!list.length) {
    return <Panel><EmptyState icon="message" title="אין תבניות הודעה">מנהל/ת יכול/ה להוסיף תבניות במסך ההגדרות.</EmptyState></Panel>;
  }

  const preview = tpl ? renderTemplate(tpl.body, { ...people.ctx, firstName: '‹שם פרטי›' }) : '';
  const previewOf = (k: string) => {
    const t = list.find((x) => x.key === k);
    return t ? renderTemplate(t.body, { ...people.ctx, firstName: '‹שם פרטי›' }) : '';
  };
  const joinCount = aftercare ? recipients.filter((p) => p.phone && aftercareKey(p, list) === 'join_invite').length : 0;
  // S8: one generic text for a WhatsApp broadcast list or group (service templates only; marketing needs per-person consent)
  const broadcast = tpl && !tpl.is_marketing ? renderTemplate(tpl.body, { ...people.ctx, firstName: 'כולם' }) : '';

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="tide" icon="shield">
        שום הודעה לא נשלחת לבד. "שליחה" פותחת וואטסאפ בטלפון או במחשב שלך עם הטקסט מוכן, ואת/ה לוחץ/ת "שלח" בוואטסאפ. כל פתיחה נרשמת בהיסטוריית הקשר של הלוחם/ת.
      </Notice>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title="מה שולחים">
          <div className="flex flex-col gap-4">
            {aftercare ? (
              <AftercareInfo
                readyAt={readyAt}
                joinCount={joinCount}
                thanks={previewOf('thanks')}
                join={previewOf('join_invite')}
              />
            ) : (<>
            <Select label="תבנית" value={key} onChange={(x) => { setPickedKey(x.target.value); setPickedGroup(null); }}>
              {list.map((t) => <option key={t.key} value={t.key}>{t.label}{t.is_marketing ? ' (דורש הסכמה)' : ''}</option>)}
            </Select>
            {tpl?.is_marketing && (
              <Notice tone="light" icon="alert">הודעה שיווקית: לפי חוק התקשורת נשלחת רק למי שאישר/ה לקבל עדכונים והזמנות.</Notice>
            )}
            <div>
              <div className="mb-1.5 text-sm font-semibold">כך זה ייראה</div>
              <div className="rounded-[var(--radius-control)] bg-[#e7f4ea] px-3.5 py-3 text-[0.95rem] leading-relaxed whitespace-pre-line text-ink">{preview || <span className="text-muted">התבנית ריקה.</span>}</div>
              <p className="mt-1.5 text-sm text-muted">שורה עם פרט שחסר במפגש (למשל מרצה) יורדת מההודעה. אפשר לערוך את הטקסט לפני כל שליחה.</p>
              {broadcast && (
                <div className="mt-3 rounded-[var(--radius-control)] border border-line-soft p-3">
                  <p className="text-sm text-ink-soft">יש רשימת תפוצה בוואטסאפ לנרשמים? אפשר לשלוח לכולם בבת אחת עם נוסח כללי:</p>
                  <Button size="sm" variant="secondary" icon="copy" className="mt-2" onClick={() => copy(broadcast, 'הנוסח הכללי הועתק')}>העתקת נוסח כללי לרשימת תפוצה</Button>
                </div>
              )}
            </div>
            </>)}
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">למי</legend>
              <div className="flex flex-wrap gap-1.5">
                {GROUPS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    aria-pressed={group === g.value}
                    onClick={() => setPickedGroup(g.value)}
                    className={cx(
                      'h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors',
                      group === g.value ? 'border-tide bg-tide text-white' : 'border-line bg-paper text-ink-soft hover:border-tide',
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted">{GROUP_HINT[group]}</p>
            </fieldset>
          </div>
        </Panel>

        <Panel
          title={<span>נפתחו בוואטסאפ <span className="num">{doneCount}</span> מתוך <span className="num">{eligibleCount}</span></span>}
          actions={next ? <Button size="sm" icon="message" onClick={() => setComposer(next)}>שליחה ל{next.full_name?.split(' ')[0] ?? 'הבא/ה'}</Button> : undefined}
          padded={false}
        >
          <div className="px-4 pt-3 sm:px-5">
            <div className="h-2 overflow-hidden rounded-full bg-mist-deep" role="progressbar" aria-valuemin={0} aria-valuemax={eligibleCount} aria-valuenow={doneCount} aria-label="התקדמות השליחה">
              <div className="h-full rounded-full bg-tide transition-[width]" style={{ width: eligibleCount ? `${(doneCount / eligibleCount) * 100}%` : '0%' }} />
            </div>
            {blocked > 0 && <p className="mt-2 text-sm text-warn">{blocked === 1 ? 'נמען/ת אחד/ת לא אישר/ה' : `${blocked} נמענים לא אישרו`} לקבל עדכונים, ולכן ההודעה הזו לא נשלחת {blocked === 1 ? 'אליו/ה' : 'אליהם'}.</p>}
          </div>
          {loading ? (
            <div className="p-5"><Skeleton lines={5} /></div>
          ) : error ? (
            <div className="p-4"><ErrorBox error={errorMessage(error)} /></div>
          ) : ordered.length === 0 ? (
            <EmptyState icon="people" title="אין נמענים בקבוצה הזו">
              {aftercare ? 'עוד אין מי שסומן/ה כהגעה למפגש הזה.' : group === 'no_show' && e.status !== 'completed' ? 'מי שלא הגיע/ה מסומן/ת בסגירת המפגש.' : group === 'consented' ? 'אין כרגע מי שאישר/ה עדכונים, הגיע/ה לאחרונה ולא רשום/ה.' : 'אפשר לבחור קבוצה אחרת.'}
            </EmptyState>
          ) : (
            <ul className="mt-2 divide-y divide-line-soft">
              {ordered.map((p) => {
                const at = sentAt.get(p.id);
                const ok = eligible(p);
                return (
                  <li key={p.id} className={cx('flex items-center gap-3 px-4 py-2.5 sm:px-5', at && 'bg-mist/50')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                        {p.full_name}
                        {p.note && <Badge tone="tide">{p.note}</Badge>}
                        {aftercare && p.membership === 'member' && <Badge tone="good">חבר/ת עמותה</Badge>}
                        {aftercare && p.phone && aftercareKey(p, list) === 'join_invite' && <Badge tone="light">+ הזמנה להצטרף</Badge>}
                      </div>
                      <div className="num text-right text-sm text-muted">{formatPhone(p.phone) || 'אין טלפון'}</div>
                    </div>
                    {at ? (
                      <div className="flex items-center gap-1.5">
                        <Badge tone="good" icon="check" title="נפתח בוואטסאפ. המערכת לא יודעת אם נלחץ שם 'שלח'.">נפתח בוואטסאפ <span className="num">{fmtDateTime(at)}</span></Badge>
                        <Button size="sm" variant="ghost" onClick={() => setComposer(p)}>שוב</Button>
                      </div>
                    ) : !p.phone ? (
                      <Badge tone="neutral">אין טלפון</Badge>
                    ) : !ok ? (
                      <Badge tone="warn" title="לא אישר/ה לקבל עדכונים והזמנות">אין הסכמה</Badge>
                    ) : (
                      <Button size="sm" variant="secondary" icon="message" onClick={() => setComposer(p)}>שליחה</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-line-soft px-4 py-3 text-sm text-muted sm:px-5">
            רוצים לשנות את נוסח התבניות? <ButtonLink to="/app/settings" variant="ghost" size="sm">הגדרות</ButtonLink>
          </div>
        </Panel>
      </div>

      {composer && aftercare && (
        <MessageComposer
          key={`${composer.id}-aftercare`}
          open
          onClose={() => setComposer(null)}
          recipient={composer}
          context={people.ctx}
          templateKeys={AFTERCARE_KEYS}
          defaultKey={aftercareKey(composer, list)}
          eventId={e.id}
        />
      )}
      {composer && !aftercare && tpl && (
        <MessageComposer
          key={`${composer.id}-${tpl.key}`}
          open
          onClose={() => setComposer(null)}
          recipient={composer}
          context={people.ctx}
          templateKeys={[tpl.key]}
          defaultKey={tpl.key}
          eventId={e.id}
        />
      )}
    </div>
  );
}

/** What the after-meeting thank-you does, when it is ready, and the two texts. */
function AftercareInfo({ readyAt, joinCount, thanks, join }: { readyAt: Date; joinCount: number; thanks: string; join: string }) {
  const ready = readyAt.getTime() <= Date.now();
  const bubble = 'rounded-[var(--radius-control)] bg-[#e7f4ea] px-3.5 py-3 text-[0.95rem] leading-relaxed whitespace-pre-line text-ink';
  return (
    <>
      {ready ? (
        <Notice tone="light" icon="checkCircle">עברו 24 שעות מסוף המפגש: זה הזמן לשלוח תודה. כל שליחה נרשמת, כך שרואים מי כבר קיבל/ה.</Notice>
      ) : (
        <Notice tone="tide" icon="calendar">ההודעות יהיו מוכנות ב-<span className="num">{fmtDateTime(readyAt.toISOString())}</span>, 24 שעות אחרי סוף המפגש. אז המפגש יופיע גם בלוח הבקרה. אפשר לשלוח כבר עכשיו.</Notice>
      )}
      <div>
        <div className="mb-1.5 text-sm font-semibold">תודה (לכל מי שהגיע/ה)</div>
        <div className={bubble}>{thanks || <span className="text-muted">אין תבנית "תודה". אפשר להוסיף בהגדרות.</span>}</div>
      </div>
      <div>
        <div className="mb-1.5 text-sm font-semibold">
          תודה + הזמנה להצטרף לעמותה {joinCount > 0 && <span className="font-normal text-muted">(<span className="num">{joinCount}</span> נמענים)</span>}
        </div>
        <div className={bubble}>{join || <span className="text-muted">אין תבנית "הזמנה להצטרף". אפשר להוסיף בהגדרות.</span>}</div>
        <p className="mt-1.5 text-sm text-muted">רק למי שעוד לא חבר/ת עמותה ואישר/ה לקבל עדכונים והזמנות (חוק התקשורת). אפשר לערוך את הטקסט לפני כל שליחה.</p>
      </div>
    </>
  );
}
