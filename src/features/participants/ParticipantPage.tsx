import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { age, fmtDate, fmtLongDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { FOLLOWUP_TYPE_LABEL, MEMBERSHIP_LABEL, taskTitle } from '@/lib/labels';
import { telLink } from '@/lib/phone';
import { Link } from 'react-router';
import { fmtMoney } from '@/lib/money';
import { MoreMenu, type MoreMenuItem } from '@/ui/MoreMenu';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, KeyValue, Notice, PageHeader, Panel, Skeleton, buttonClass, cx } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import {
  CompleteTaskDialog, EditTaskDialog, NewTaskDialog, TaskComposer, useAssignees, type TaskRow,
} from '@/features/followups/shared';
import { useCard, useCardFeedback, useCardRegistrations, useCardStats, useCardTasks, useContactLog, type Card, type CardRegistration } from './cardData';
import { EditParticipantDialog, LogContactDialog, MergeDialog, MessageChooser, ReferrerDialog } from './cardDialogs';
import { History } from './History';
import { CREATED_VIA_LABEL, EngagementBadge, PersonLink, PhoneText, ago, daysUntil, useNextOpenEvent } from './shared';

type Open = 'edit' | 'log' | 'task' | 'message' | 'referrer' | 'merge' | null;

export function ParticipantPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '';
  const back = { to: `/app/participants${from}`, label: 'לכל הלוחמים' };
  const card = useCard(id);
  const live = !!card.data && !card.data.anonymized_at;

  if (card.isLoading) return <div><Skeleton lines={2} className="mb-6 max-w-sm" /><Skeleton lines={8} /></div>;
  if (card.isError) return <><PageHeader title="כרטיס לוחם" back={back} /><ErrorBox error={errorMessage(card.error)} onRetry={() => card.refetch()} /></>;
  if (!card.data) {
    return (
      <>
        <PageHeader title="הכרטיס לא נמצא" back={back} />
        <Panel>
          <EmptyState icon="search" title="אין כרטיס בכתובת הזו" action={<ButtonLink to="/app/participants" variant="secondary">לרשימת הלוחמים</ButtonLink>}>
            ייתכן שהכרטיס מוזג לכרטיס אחר של אותו אדם.
          </EmptyState>
        </Panel>
      </>
    );
  }
  if (!live) return <Anonymized card={card.data} back={back} />;
  return <LiveCard card={card.data} back={back} />;
}

function Anonymized({ card, back }: { card: Card; back: { to: string; label: string } }) {
  return (
    <>
      <PageHeader title="פרטים נמחקו" back={back} />
      <Panel>
        <EmptyState icon="shield" title="הפרטים האישיים של הכרטיס הזה נמחקו">
          הפרטים נמחקו ב-<span className="num">{fmtDate(card.anonymized_at!)}</span> לפי בקשה אישית או לפי מדיניות שמירת המידע.
          נשארו רק נתוני השתתפות בלי זיהוי, כדי שהסטטיסטיקה של המפגשים תישאר נכונה.
        </EmptyState>
      </Panel>
    </>
  );
}

function LiveCard({ card, back }: { card: Card; back: { to: string; label: string } }) {
  const role = useRole();
  const id = card.id;
  const stats = useCardStats(id, true);
  const regs = useCardRegistrations(id, true);
  const feedback = useCardFeedback(id, true);
  const tasks = useCardTasks(id, true);
  const contacts = useContactLog(id, true);
  const next = useNextOpenEvent();
  const { name: staffName } = useAssignees();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  const openTasks = (tasks.data ?? []).filter((t) => t.status === 'open');
  const recipient = { id, full_name: card.full_name, phone: card.phone, consent_updates: card.consent_updates };
  const s = stats.data;
  const firstReg = useMemo(
    () => [...(regs.data ?? [])].sort((a, b) => a.registered_at.localeCompare(b.registered_at))[0],
    [regs.data],
  );
  const historyError = regs.error ?? feedback.error ?? contacts.error ?? tasks.error;
  const anonymize = useAnonymize(card);
  const more: MoreMenuItem[] = [
    { label: 'מיזוג עם כרטיס אחר', icon: 'merge', onClick: () => setOpen('merge') },
    ...(can.admin(role) ? [{ label: 'מחיקת פרטים אישיים', icon: 'shield' as const, danger: true, onClick: anonymize.ask }] : []),
  ];

  return (
    <div>
      <PageHeader
        back={back}
        title={card.full_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <EngagementBadge status={s?.engagement_status} />
            {card.membership === 'member' && <Badge tone="good" icon="star">חברות בעמותה</Badge>}
            {card.membership === 'requested' && <Badge tone="warn" icon="alert">בקשת הצטרפות לעמותה</Badge>}
            {card.photo_opt_out && <Badge icon="noCamera" tone="warn">לא להצטלם</Badge>}
            <span>במערכת מאז <span className="num">{fmtDate(card.created_at)}</span></span>
          </span>
        }
      />

      {/* each action lives in one place: talk and record here, edit on the details panel, merge and erase in ⋯ */}
      <div className="mb-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button icon="message" className="min-w-0" onClick={() => setOpen('message')}>וואטסאפ</Button>
        <a href={telLink(card.phone!)} className={buttonClass('secondary', 'md', 'min-w-0')}>
          <Icon name="phone" size={18} />
          חיוג
        </a>
        <div className="flex items-center justify-center sm:order-last"><MoreMenu items={more} label="עוד פעולות לכרטיס">עוד</MoreMenu></div>
        <div className="col-span-3 grid grid-cols-2 gap-2 sm:contents">
          <Button variant="secondary" icon="task" className="min-w-0 px-2 sm:px-4" onClick={() => setOpen('task')}>משימה חדשה</Button>
          <Button variant="secondary" icon="edit" className="min-w-0 px-2 sm:px-4" onClick={() => setOpen('log')}>תיעוד שיחה</Button>
        </div>
      </div>

      <OpenDebt regs={regs.data ?? []} />

      <StatStrip loading={stats.isLoading} items={[
        ['מפגשי שישי', s?.friday_count ?? null, 'הגעות למפגשי שישי'],
        ['כל הפעילויות', s?.attended_count ?? null, 'כולל ערבי מדורה'],
        ['הגעה אחרונה', s?.last_attended_at ? ago(s.last_attended_at) : null, s?.last_attended_at ? fmtDate(s.last_attended_at) : undefined],
        ['הגעה ראשונה', s?.first_attended_at ? fmtDate(s.first_attended_at) : null],
        ['הרשמות בלי הגעה', s?.no_show_count ?? null, 'פעמים שהייתה הרשמה ולא הייתה הגעה'],
        ['חברים שהופנו', s?.friends_brought ?? null],
      ]} />

      {openTasks.length > 0 && (
        <OpenTasks tasks={openTasks} staffName={staffName} nextEvent={next.data} name={card.full_name} />
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="מקור הגעה">
            <KeyValue items={[
              ['מקור הגעה', card.first_source ? <>{card.first_source.label}{card.first_source_detail && <span className="text-ink-soft">: {card.first_source_detail}</span>}</> : null],
              ['מי הביא', <Referrer key="r" card={card} onLink={() => setOpen('referrer')} />],
              ['ערוץ ההרשמה הראשונה', firstReg ? channelText(firstReg) : null],
            ]} />
            <div className="mt-4 border-t border-edge pt-3">
              <p className="mb-1.5 text-small font-semibold text-muted">חברים שהופנו</p>
              {card.friends.length ? (
                <ul className="flex flex-col gap-1">
                  {card.friends.map((fr) => (
                    <li key={fr.id} className="flex items-center justify-between gap-2">
                      <PersonLink id={fr.id} name={fr.anonymized_at ? null : fr.full_name} />
                      <span className="text-small text-muted">הצטרפות <span className="num">{fmtDate(fr.created_at)}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-small text-faint">עוד אין חברים שהופנו</p>}
            </div>
          </Panel>

          <Panel title="פרטים" actions={<Button size="sm" variant="ghost" icon="edit" onClick={() => setOpen('edit')}>עריכה</Button>}>
            <KeyValue items={[
              ['טלפון', <a key="p" href={telLink(card.phone!)} className="text-tide hover:underline"><PhoneText phone={card.phone} /></a>],
              ['עיר', card.city],
              ['גיל', <AgeText key="a" card={card} />],
              ['יום הולדת', card.birth_date ? fmtLongDate(card.birth_date) : null],
              ['עיסוק', card.occupation],
              ['עדכונים בוואטסאפ', card.consent_updates
                ? <span className="font-semibold text-ink">יש הסכמה{card.consent_updates_at && <span className="text-muted"> מ-<span className="num">{fmtDate(card.consent_updates_at)}</span></span>}</span>
                : <span className="text-ink-soft">אין הסכמה (אפשר להתקשר)</span>],
              ['עמותה', <MembershipText key="m" card={card} />],
              ['צילום', card.photo_opt_out ? <span className="text-warn">בקשה לא להופיע בתמונות</span> : 'אין הגבלה'],
              ['הצטרפות', <span key="j"><span className="num">{fmtDate(card.created_at)}</span> · {CREATED_VIA_LABEL[card.created_via] ?? card.created_via}</span>],
            ]} />
            {card.notes && (
              <div className="mt-4 border-t border-edge pt-3">
                <p className="mb-1 text-small font-semibold text-muted">הערות לצוות</p>
                <p className="whitespace-pre-line text-body">{card.notes}</p>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="היסטוריה">
          {historyError ? (
            <ErrorBox error={errorMessage(historyError)} onRetry={() => { regs.refetch(); feedback.refetch(); contacts.refetch(); tasks.refetch(); }} />
          ) : regs.isLoading || feedback.isLoading || contacts.isLoading || tasks.isLoading ? (
            <Skeleton lines={6} />
          ) : (
            <History regs={regs.data ?? []} feedback={feedback.data ?? []} contacts={contacts.data ?? []} tasks={tasks.data ?? []} staffName={staffName} />
          )}
        </Panel>
      </div>


      {open === 'edit' && <EditParticipantDialog card={card} onClose={close} />}
      {open === 'log' && <LogContactDialog participantId={id} name={card.full_name} onClose={close} />}
      {open === 'referrer' && <ReferrerDialog card={card} onClose={close} />}
      {open === 'task' && <NewTaskDialog participant={{ id, full_name: card.full_name }} onClose={close} />}
      {open === 'merge' && <MergeDialog card={card} onClose={close} />}
      {open === 'message' && <MessageChooser recipient={recipient} regs={regs.data ?? []} nextEvent={next.data} onClose={close} />}
    </div>
  );
}

function channelText(r: CardRegistration): ReactNode {
  const utm = [r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(' / ');
  if (r.link) return <>{r.link.label} <span className="num text-small text-muted">({r.link.code})</span></>;
  if (utm) return <span className="num">{utm}</span>;
  if (r.created_via === 'staff') return <span className="text-ink-soft">הרשמה על ידי הצוות</span>;
  if (r.is_walk_in || r.created_via === 'walk_in_staff' || r.created_via === 'checkin') return <span className="text-ink-soft">הגעה בלי הרשמה</span>;
  return <span className="text-ink-soft">טופס ההרשמה, בלי קישור ערוץ</span>;
}

function Referrer({ card, onLink }: { card: Card; onLink: () => void }) {
  if (card.referrer) {
    return (
      <span className="flex flex-wrap items-center gap-x-2">
        <PersonLink id={card.referrer.id} name={card.referrer.full_name} />
        <button type="button" onClick={onLink} className="text-small font-medium text-muted hover:text-tide hover:underline">שינוי</button>
      </span>
    );
  }
  if (card.referred_by_name) {
    return (
      <span className="flex flex-wrap items-center gap-x-2">
        <span>{card.referred_by_name}</span>
        <button type="button" onClick={onLink} className="inline-flex min-h-8 items-center gap-1 text-small font-semibold text-tide hover:underline">
          <Icon name="link" size={15} />
          קישור לכרטיס
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={onLink} className="text-small font-medium text-tide hover:underline">הוספה</button>
  );
}

function MembershipText({ card }: { card: Card }) {
  if (card.membership === 'member') {
    return <span className="font-semibold text-ink">{MEMBERSHIP_LABEL.member}{card.member_since && <span className="text-muted"> מ-<span className="num">{fmtDate(card.member_since)}</span></span>}</span>;
  }
  if (card.membership === 'requested') {
    return <span className="text-warn">{MEMBERSHIP_LABEL.requested}{card.membership_requested_at && <span className="text-muted"> ב-<span className="num">{fmtDate(card.membership_requested_at)}</span></span>}</span>;
  }
  return <span className="text-ink-soft">{MEMBERSHIP_LABEL.none}</span>;
}

function AgeText({ card }: { card: Card }) {
  const a = age(card.birth_year, card.birth_date);
  if (a == null) return <span className="text-faint">—</span>;
  if (card.birth_date) return <span className="num">{a}</span>;
  return <span title="שנת לידה משוערת, לפי הגיל שנמסר בהרשמה">כ-<span className="num">{a}</span> <span className="text-small text-muted">(משוער)</span></span>;
}

/** "חוב פתוח": registrations that still owe the meeting's fee (the same rule as the registrations tab's "לא שילמו"). */
function OpenDebt({ regs }: { regs: CardRegistration[] }) {
  const owing = regs.filter((r) =>
    r.event && r.event.status !== 'cancelled' && Number(r.event.price ?? 0) > 0
    && r.status === 'registered' && r.payment_status === 'pending' && r.attendance !== 'no_show')
    .sort((a, b) => a.event!.starts_at.localeCompare(b.event!.starts_at));
  if (!owing.length) return null;
  const total = owing.reduce((sum, r) => sum + Number(r.event!.price ?? 0), 0);
  return (
    <section aria-label="חוב פתוח" className="mb-5 flex flex-col gap-2 rounded-[var(--radius-panel)] border border-edge bg-paper px-4 py-3 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
      <div className="flex items-baseline gap-2.5">
        <span className="whitespace-nowrap text-small font-semibold text-muted">חוב פתוח</span>
        <span className="num font-display text-[1.75rem] font-bold leading-none text-ink">{fmtMoney(total)}</span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small">
        {owing.map((r) => (
          <li key={r.id}>
            <Link to={`/app/events/${r.event!.id}?tab=registrations`} className="inline-flex min-h-8 items-center font-semibold text-tide hover:underline pointer-coarse:min-h-11">
              {r.event!.title} · <span className="num ms-1">{fmtDate(r.event!.starts_at)}</span> · <span className="num ms-1">{fmtMoney(r.event!.price)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatStrip({ items, loading }: { items: [string, ReactNode, string?][]; loading: boolean }) {
  return (
    <dl className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper lg:grid-cols-6">
      {items.map(([label, value, hint], i) => (
        <div
          key={label}
          title={hint}
          className={cx(
            'flex flex-col-reverse justify-end gap-0.5 px-3 py-3 sm:px-4',
            i % 3 !== 2 && 'border-l border-edge lg:border-l',
            i < 3 && 'border-b border-edge lg:border-b-0',
            i === 5 && 'lg:border-l-0',
          )}
        >
          <dt className="text-micro font-medium text-muted sm:text-small">{label}</dt>
          <dd className={cx('font-bold text-ink', typeof value === 'number' ? 'num font-display text-[1.75rem] leading-none sm:text-stat' : 'text-heading sm:text-section')}>
            {loading ? <span className="skeleton inline-block h-7 w-10" /> : value ?? <span className="text-faint">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OpenTasks({ tasks, staffName, nextEvent, name }: {
  tasks: TaskRow[]; staffName: Map<string, string>; nextEvent: Parameters<typeof TaskComposer>[0]['nextEvent']; name: string | null;
}) {
  const [doing, setDoing] = useState<{ kind: 'done' | 'edit' | 'msg'; task: TaskRow } | null>(null);
  return (
    <Panel className="mt-5" title={<>משימות פתוחות <span className="num text-muted">({tasks.length})</span></>} padded={false}>
      <ul className="divide-y divide-edge">
        {tasks.map((t) => {
          const d = t.due_date ? daysUntil(t.due_date) : null;
          return (
            <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <p className="font-semibold">{taskTitle(t.title)}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-small text-muted">
                  <span>{FOLLOWUP_TYPE_LABEL[t.type]}</span>
                  {t.due_date && <><span aria-hidden="true">·</span><span className={cx(d! < 0 && 'font-semibold text-bad')}>{d! < 0 ? `באיחור (יעד ${fmtDate(t.due_date)})` : `יעד ${fmtDate(t.due_date)}`}</span></>}
                  <span aria-hidden="true">·</span>
                  {t.assignee_id ? <span>{staffName.get(t.assignee_id) ?? 'הצוות'}</span> : <span className="text-muted">בלי אחראי</span>}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" icon="check" onClick={() => setDoing({ kind: 'done', task: t })}>בוצע</Button>
                <Button size="sm" variant="secondary" icon="message" onClick={() => setDoing({ kind: 'msg', task: t })}>וואטסאפ</Button>
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setDoing({ kind: 'edit', task: t })} aria-label="עריכת משימה">עריכה</Button>
              </div>
            </li>
          );
        })}
      </ul>
      {doing?.kind === 'done' && <CompleteTaskDialog task={{ ...doing.task, participantName: name }} onClose={() => setDoing(null)} />}
      {doing?.kind === 'edit' && <EditTaskDialog task={doing.task} onClose={() => setDoing(null)} />}
      {doing?.kind === 'msg' && <TaskComposer task={doing.task} nextEvent={nextEvent} onClose={() => setDoing(null)} />}
    </Panel>
  );
}

/** Erase the personal details (admins only; the server checks the role). Opened from the card's ⋯ menu. */
function useAnonymize(card: Card) {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const anonymize = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_anonymize_participant', { p_id: card.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participants'] });
      qc.invalidateQueries({ queryKey: ['participant', card.id] });
      qc.invalidateQueries({ queryKey: ['followups'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      toast.success('הפרטים האישיים נמחקו');
      navigate('/app/participants', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ask = async () => {
    const ok = await confirm({
      title: `למחוק את הפרטים של ${card.full_name}?`,
      danger: true,
      confirm: 'מחיקת הפרטים',
      cancel: 'חזרה',
      body: (
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-semibold text-ink">מה יימחק:</p>
            <p>שם, טלפון, עיר, גיל ותאריך לידה, עיסוק, הערות, מי הביא, ההערות שנכתבו במשוב, יומן השיחות ומשימות המעקב.</p>
          </div>
          <div>
            <p className="font-semibold text-ink">מה יישאר, בלי זיהוי:</p>
            <p>ההגעות למפגשים והדירוגים, כדי שמספרי המשתתפים והדוחות יישארו נכונים.</p>
          </div>
          <Notice tone="warn" icon="alert">אי אפשר לבטל את הפעולה. אם תהיה הרשמה חדשה, ייפתח כרטיס חדש.</Notice>
        </div>
      ),
    });
    if (ok) anonymize.mutate();
  };
  return { ask, busy: anonymize.isPending };
}
