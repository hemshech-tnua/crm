import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { age, fmtDate, fmtLongDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { FOLLOWUP_TYPE_LABEL } from '@/lib/labels';
import { telLink } from '@/lib/phone';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, KeyValue, Notice, PageHeader, Panel, Skeleton, buttonClass, cx } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import {
  CompleteTaskDialog, EditTaskDialog, NewTaskDialog, TaskComposer, useAssignees, type TaskRow,
} from '@/features/followups/shared';
import { useCard, useCardFeedback, useCardRegistrations, useCardStats, useCardTasks, useContactLog, type Card, type CardRegistration } from './cardData';
import { EditParticipantDialog, LogContactDialog, MessageChooser, ReferrerDialog } from './cardDialogs';
import { History } from './History';
import { CREATED_VIA_LABEL, EngagementBadge, PersonLink, PhoneText, ago, daysUntil, useNextOpenEvent } from './shared';

type Open = 'edit' | 'log' | 'task' | 'message' | 'referrer' | null;

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
          הפרטים נמחקו ב-<span className="num">{fmtDate(card.anonymized_at!)}</span> לבקשת הלוחם/ת או לפי מדיניות שמירת המידע.
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

  return (
    <div>
      <PageHeader
        back={back}
        title={card.full_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <EngagementBadge status={s?.engagement_status} />
            {card.photo_opt_out && <Badge icon="noCamera" tone="warn">לא להצטלם</Badge>}
            <span>במערכת מאז <span className="num">{fmtDate(card.created_at)}</span></span>
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-6 gap-2 sm:flex sm:flex-wrap">
        <Button icon="message" className="col-span-3" onClick={() => setOpen('message')}>וואטסאפ</Button>
        <a href={telLink(card.phone!)} className={buttonClass('secondary', 'md', 'col-span-3')}>
          <Icon name="phone" size={18} />
          חיוג
        </a>
        <Button variant="secondary" icon="task" className="col-span-2 px-2 sm:px-4" onClick={() => setOpen('task')}>משימה</Button>
        <Button variant="secondary" icon="phone" className="col-span-2 px-2 sm:px-4" onClick={() => setOpen('log')}>תיעוד שיחה</Button>
        <Button variant="secondary" icon="edit" className="col-span-2 px-2 sm:px-4" onClick={() => setOpen('edit')}>עריכה</Button>
      </div>

      <StatStrip loading={stats.isLoading} items={[
        ['מפגשי שישי', s?.friday_count ?? null, 'מפגשי שישי שהגיע/ה אליהם'],
        ['כל הפעילויות', s?.attended_count ?? null, 'כולל ערבי מדורה'],
        ['ביקור אחרון', s?.last_attended_at ? ago(s.last_attended_at) : null, s?.last_attended_at ? fmtDate(s.last_attended_at) : undefined],
        ['ביקור ראשון', s?.first_attended_at ? fmtDate(s.first_attended_at) : null],
        ['לא הגיע/ה', s?.no_show_count ?? null, 'נרשם/ה ולא הגיע/ה'],
        ['חברים שהביא/ה', s?.friends_brought ?? null],
      ]} />

      {openTasks.length > 0 && (
        <OpenTasks tasks={openTasks} staffName={staffName} nextEvent={next.data} onNew={() => setOpen('task')} name={card.full_name} />
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="מאיפה הגיע/ה">
            <KeyValue items={[
              ['מקור היכרות', card.first_source ? <>{card.first_source.label}{card.first_source_detail && <span className="text-ink-soft">: {card.first_source_detail}</span>}</> : null],
              ['מי הביא/ה', <Referrer key="r" card={card} onLink={() => setOpen('referrer')} />],
              ['ערוץ ההרשמה הראשונה', firstReg ? channelText(firstReg) : null],
            ]} />
            <div className="mt-4 border-t border-line-soft pt-3">
              <p className="mb-1.5 text-sm font-semibold text-muted">חברים שהביא/ה</p>
              {card.friends.length ? (
                <ul className="flex flex-col gap-1">
                  {card.friends.map((fr) => (
                    <li key={fr.id} className="flex items-center justify-between gap-2">
                      <PersonLink id={fr.id} name={fr.anonymized_at ? null : fr.full_name} />
                      <span className="text-sm text-muted">הצטרף/ה <span className="num">{fmtDate(fr.created_at)}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-faint">עוד לא הביא/ה חברים</p>}
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
                ? <span className="text-good">מסכים/ה{card.consent_updates_at && <span className="text-muted"> מ-<span className="num">{fmtDate(card.consent_updates_at)}</span></span>}</span>
                : <span className="text-ink-soft">לא אישר/ה (אפשר להתקשר)</span>],
              ['צילום', card.photo_opt_out ? <span className="text-warn">לא מעוניין/ת להופיע בתמונות</span> : 'אין הגבלה'],
              ['הצטרפות', <span key="j"><span className="num">{fmtDate(card.created_at)}</span> · {CREATED_VIA_LABEL[card.created_via] ?? card.created_via}</span>],
            ]} />
            {card.notes && (
              <div className="mt-4 border-t border-line-soft pt-3">
                <p className="mb-1 text-sm font-semibold text-muted">הערות לצוות</p>
                <p className="whitespace-pre-line text-[0.95rem]">{card.notes}</p>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="היסטוריה" actions={<Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen('log')}>תיעוד שיחה</Button>}>
          {historyError ? (
            <ErrorBox error={errorMessage(historyError)} onRetry={() => { regs.refetch(); feedback.refetch(); contacts.refetch(); tasks.refetch(); }} />
          ) : regs.isLoading || feedback.isLoading || contacts.isLoading || tasks.isLoading ? (
            <Skeleton lines={6} />
          ) : (
            <History regs={regs.data ?? []} feedback={feedback.data ?? []} contacts={contacts.data ?? []} tasks={tasks.data ?? []} staffName={staffName} />
          )}
        </Panel>
      </div>

      {can.admin(role) && <DangerZone card={card} />}

      {open === 'edit' && <EditParticipantDialog card={card} onClose={close} />}
      {open === 'log' && <LogContactDialog participantId={id} name={card.full_name} onClose={close} />}
      {open === 'referrer' && <ReferrerDialog card={card} onClose={close} />}
      {open === 'task' && <NewTaskDialog participant={{ id, full_name: card.full_name }} onClose={close} />}
      {open === 'message' && <MessageChooser recipient={recipient} regs={regs.data ?? []} nextEvent={next.data} onClose={close} />}
    </div>
  );
}

function channelText(r: CardRegistration): ReactNode {
  const utm = [r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(' / ');
  if (r.link) return <>{r.link.label} <span className="num text-sm text-muted">({r.link.code})</span></>;
  if (utm) return <span className="num">{utm}</span>;
  if (r.created_via === 'staff') return <span className="text-ink-soft">נרשם/ה על ידי הצוות</span>;
  if (r.is_walk_in || r.created_via === 'walk_in_staff' || r.created_via === 'checkin') return <span className="text-ink-soft">הגיע/ה בלי הרשמה</span>;
  return <span className="text-ink-soft">טופס ההרשמה, בלי קישור ערוץ</span>;
}

function Referrer({ card, onLink }: { card: Card; onLink: () => void }) {
  if (card.referrer) {
    return (
      <span className="flex flex-wrap items-center gap-x-2">
        <PersonLink id={card.referrer.id} name={card.referrer.full_name} />
        <button type="button" onClick={onLink} className="text-sm font-medium text-muted hover:text-tide hover:underline">שינוי</button>
      </span>
    );
  }
  if (card.referred_by_name) {
    return (
      <span className="flex flex-wrap items-center gap-x-2">
        <span>{card.referred_by_name}</span>
        <button type="button" onClick={onLink} className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-tide hover:underline">
          <Icon name="link" size={15} />
          קישור לכרטיס
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={onLink} className="text-sm font-medium text-tide hover:underline">הוספה</button>
  );
}

function AgeText({ card }: { card: Card }) {
  const a = age(card.birth_year, card.birth_date);
  if (a == null) return <span className="text-faint">—</span>;
  if (card.birth_date) return <span className="num">{a}</span>;
  return <span title="שנת לידה משוערת, לפי הגיל שנמסר בהרשמה">כ-<span className="num">{a}</span> <span className="text-sm text-muted">(משוער)</span></span>;
}

function StatStrip({ items, loading }: { items: [string, ReactNode, string?][]; loading: boolean }) {
  return (
    <dl className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-panel)] border border-line-soft bg-paper lg:grid-cols-6">
      {items.map(([label, value, hint], i) => (
        <div
          key={label}
          title={hint}
          className={cx(
            'flex flex-col-reverse justify-end gap-0.5 px-3 py-3 sm:px-4',
            i % 3 !== 2 && 'border-l border-line-soft lg:border-l',
            i < 3 && 'border-b border-line-soft lg:border-b-0',
            i === 5 && 'lg:border-l-0',
          )}
        >
          <dt className="text-[0.8rem] font-medium text-muted sm:text-sm">{label}</dt>
          <dd className={cx('font-display leading-tight text-ink', typeof value === 'number' ? 'num text-[1.75rem]' : 'text-lg sm:text-xl')}>
            {loading ? <span className="skeleton inline-block h-7 w-10" /> : value ?? <span className="text-faint">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OpenTasks({ tasks, staffName, nextEvent, onNew, name }: {
  tasks: TaskRow[]; staffName: Map<string, string>; nextEvent: Parameters<typeof TaskComposer>[0]['nextEvent']; onNew: () => void; name: string | null;
}) {
  const [doing, setDoing] = useState<{ kind: 'done' | 'edit' | 'msg'; task: TaskRow } | null>(null);
  return (
    <Panel className="mt-5" title={<>משימות פתוחות <span className="num text-muted">({tasks.length})</span></>} actions={<Button size="sm" variant="ghost" icon="plus" onClick={onNew}>משימה חדשה</Button>} padded={false}>
      <ul className="divide-y divide-line-soft">
        {tasks.map((t) => {
          const d = t.due_date ? daysUntil(t.due_date) : null;
          return (
            <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <p className="font-semibold">{t.title}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  <span>{FOLLOWUP_TYPE_LABEL[t.type]}</span>
                  {t.due_date && <><span aria-hidden="true">·</span><span className={cx(d! < 0 && 'font-semibold text-bad')}>{d! < 0 ? `באיחור (יעד ${fmtDate(t.due_date)})` : `יעד ${fmtDate(t.due_date)}`}</span></>}
                  <span aria-hidden="true">·</span>
                  <span>{t.assignee_id ? staffName.get(t.assignee_id) ?? 'איש/אשת צוות' : 'ללא אחראי/ת'}</span>
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

function DangerZone({ card }: { card: Card }) {
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
            <p>שם, טלפון, עיר, גיל ותאריך לידה, עיסוק, הערות, מי הביא/ה, ההערות שכתב/ה במשוב, יומן השיחות ומשימות המעקב.</p>
          </div>
          <div>
            <p className="font-semibold text-ink">מה יישאר, בלי זיהוי:</p>
            <p>ההגעות למפגשים והדירוגים, כדי שמספרי המשתתפים והדוחות יישארו נכונים.</p>
          </div>
          <Notice tone="warn" icon="alert">אי אפשר לבטל את הפעולה. אם הלוחם/ת יירשם/תירשם שוב, ייפתח כרטיס חדש.</Notice>
        </div>
      ),
    });
    if (ok) anonymize.mutate();
  };
  return (
    <section className="mt-8 rounded-[var(--radius-panel)] border border-bad/25 bg-paper p-4 sm:p-5">
      <h2 className="font-bold">מחיקת פרטים אישיים (התממה)</h2>
      <p className="mt-1 max-w-2xl text-[0.95rem] text-ink-soft">
        לבקשת הלוחם/ת או לפי מדיניות שמירת המידע. הפרטים המזהים נמחקים, ונתוני ההשתתפות נשארים בלי שם לסטטיסטיקה. רק מנהלים רואים את האפשרות הזו.
      </p>
      <Button variant="danger" className="mt-3" icon="shield" busy={anonymize.isPending} onClick={ask}>מחיקת פרטים אישיים</Button>
    </section>
  );
}

