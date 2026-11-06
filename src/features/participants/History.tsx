// "היסטוריה": meetings (with the feedback given), conversations and finished tasks, newest first.
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTemplates } from '@/lib/data';
import { fmtDate, fmtDateTime, fmtDayLong, fmtTime } from '@/lib/dates';
import { CHANNEL_LABEL, EVENT_TYPE_LABEL, FOLLOWUP_TYPE_LABEL } from '@/lib/labels';
import type { ContactLog } from '@/lib/types';
import { Badge, EmptyState, cx } from '@/ui/kit';
import { Icon, type IconName } from '@/ui/Icon';
import type { TaskRow } from '@/features/followups/shared';
import type { CardFeedback, CardRegistration } from './cardData';
import { PersonLink } from './shared';

type Item = { key: string; at: string; dot: 'attended' | 'missed' | 'next' | 'plain' | 'contact'; icon: IconName; node: ReactNode };

const CHANNEL_ICON: Record<ContactLog['channel'], IconName> = { whatsapp: 'message', phone: 'phone', in_person: 'people', other: 'more' };

export function History({ regs, feedback, contacts, tasks, staffName }: {
  regs: CardRegistration[]; feedback: CardFeedback[]; contacts: ContactLog[]; tasks: TaskRow[]; staffName: Map<string, string>;
}) {
  const templates = useTemplates();
  const items = useMemo(() => {
    const tplLabel = new Map((templates.data ?? []).map((t) => [t.key, t.label]));
    const fbByReg = new Map<string, CardFeedback>();
    const fbByEvent = new Map<string, CardFeedback>();
    for (const f of feedback) {
      if (f.registration_id) fbByReg.set(f.registration_id, f);
      fbByEvent.set(f.event_id, f);
    }
    const used = new Set<string>();
    const now = Date.now();
    const out: Item[] = [];

    for (const r of regs) {
      if (!r.event) continue;
      const fb = fbByReg.get(r.id) ?? fbByEvent.get(r.event.id);
      if (fb) used.add(fb.id);
      const future = new Date(r.event.starts_at).getTime() > now;
      out.push({
        key: `r-${r.id}`,
        at: r.event.starts_at,
        dot: r.attendance === 'attended' ? 'attended' : r.attendance === 'no_show' ? 'missed' : future && r.status !== 'cancelled' ? 'next' : 'plain',
        icon: r.event.type === 'bonfire' ? 'flame' : 'calendar',
        node: <RegItem r={r} fb={fb} future={future} />,
      });
    }
    for (const f of feedback) {
      if (used.has(f.id)) continue;
      out.push({ key: `f-${f.id}`, at: f.created_at, dot: 'plain', icon: 'star', node: <FeedbackItem f={f} standalone /> });
    }
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const loggedTasks = new Set<string>();
    for (const c of contacts) {
      if (c.follow_up_id) loggedTasks.add(c.follow_up_id);
      const task = c.follow_up_id ? taskById.get(c.follow_up_id) : undefined;
      out.push({
        key: `c-${c.id}`,
        at: c.created_at,
        dot: 'contact',
        icon: CHANNEL_ICON[c.channel],
        node: (
          <div>
            <p className="font-semibold">
              {CHANNEL_LABEL[c.channel]}
              {c.template_key && <span className="font-normal text-ink-soft">: {tplLabel.get(c.template_key) ?? 'הודעה מתבנית'}</span>}
            </p>
            {c.summary && <p className="mt-0.5 whitespace-pre-line text-ink-soft">{c.summary}</p>}
            {task && <p className="mt-0.5 text-sm text-muted">במסגרת משימה: {task.title}</p>}
            <Meta>{[c.created_by ? staffName.get(c.created_by) ?? 'איש/אשת צוות' : null, fmtDateTime(c.created_at)]}</Meta>
          </div>
        ),
      });
    }
    for (const t of tasks) {
      if (t.status === 'open' || loggedTasks.has(t.id)) continue;
      out.push({
        key: `t-${t.id}`,
        at: t.completed_at ?? t.created_at,
        dot: 'plain',
        icon: 'task',
        node: (
          <div>
            <p className="font-semibold">{t.status === 'done' ? 'משימה הושלמה' : 'משימה בוטלה'}: <span className="font-normal">{t.title}</span></p>
            <p className="text-sm text-muted">{FOLLOWUP_TYPE_LABEL[t.type]}</p>
            {t.outcome && <p className="mt-0.5 whitespace-pre-line text-ink-soft">{t.outcome}</p>}
            <Meta>{[t.completed_by ? staffName.get(t.completed_by) : null, t.completed_at ? fmtDate(t.completed_at) : null]}</Meta>
          </div>
        ),
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [regs, feedback, contacts, tasks, staffName, templates.data]);

  if (!items.length) {
    return <EmptyState icon="calendar" title="עוד אין היסטוריה">כשהלוחם/ת יירשם/תירשם למפגש, יגיע/תגיע או ידבר/תדבר עם הצוות, זה יופיע כאן.</EmptyState>;
  }
  return (
    <ol className="relative">
      {items.map((it, i) => (
        <li key={it.key} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 && <span className="absolute top-9 bottom-0 right-[17px] w-px bg-line" aria-hidden="true" />}
          <span
            className={cx(
              'relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2',
              it.dot === 'attended' && 'border-tide bg-tide text-white',
              it.dot === 'missed' && 'border-bad/50 bg-paper text-bad',
              it.dot === 'next' && 'border-light bg-light-wash text-light-deep',
              it.dot === 'contact' && 'border-line bg-mist text-ink-soft',
              it.dot === 'plain' && 'border-line bg-paper text-muted',
            )}
            aria-hidden="true"
          >
            <Icon name={it.icon} size={17} />
          </span>
          <div className="min-w-0 flex-1 pt-1.5 text-[0.95rem]">{it.node}</div>
        </li>
      ))}
    </ol>
  );
}

function Meta({ children }: { children: (string | null | undefined)[] }) {
  const parts = children.filter(Boolean);
  if (!parts.length) return null;
  return <p className="mt-1 text-sm text-muted">{parts.join(' · ')}</p>;
}

function RegItem({ r, fb, future }: { r: CardRegistration; fb?: CardFeedback; future: boolean }) {
  const ev = r.event!;
  const badges: ReactNode[] = [];
  if (r.status === 'cancelled') badges.push(<Badge key="s">{r.cancelled_by === 'staff' ? 'בוטל ע״י הצוות' : 'ביטל/ה'}</Badge>);
  else if (r.status === 'waitlisted') badges.push(<Badge key="s" tone="warn">ברשימת המתנה</Badge>);
  else if (r.attendance === 'attended') badges.push(<Badge key="s" tone="good" icon="check">הגיע/ה</Badge>);
  else if (r.attendance === 'no_show') badges.push(<Badge key="s" tone="bad">לא הגיע/ה</Badge>);
  else badges.push(<Badge key="s" tone={future ? 'light' : 'neutral'}>{future ? 'רשום/ה' : 'טרם סומן'}</Badge>);
  if (r.is_walk_in) badges.push(<Badge key="w">הגיע/ה בלי הרשמה</Badge>);

  const checkin = r.attendance === 'attended' && r.checked_in_at
    ? `${r.checkin_method === 'self_qr' ? 'צ׳ק־אין עצמי ב-QR' : 'סומן/ה בכניסה'} ב-${fmtTime(r.checked_in_at)}`
    : null;
  const utm = [r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(' / ');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link to={`/app/events/${ev.id}`} className="font-semibold text-ink hover:text-tide hover:underline">
          {ev.title}{ev.type !== 'friday' && ev.title !== EVENT_TYPE_LABEL[ev.type] ? ` (${EVENT_TYPE_LABEL[ev.type]})` : ''}
        </Link>
        {badges}
      </div>
      <p className="text-sm text-ink-soft">{fmtDayLong(ev.starts_at)}</p>
      <dl className="mt-1 flex flex-col gap-0.5 text-sm text-muted">
        {checkin && <div>{checkin}</div>}
        {!r.is_walk_in && <div>נרשם/ה ב-<span className="num">{fmtDate(r.registered_at)}</span>{r.created_via === 'staff' ? ' (ע״י הצוות)' : ''}</div>}
        {(r.how_heard || r.how_heard_detail) && <div>איך שמע/ה: {[r.how_heard?.label, r.how_heard_detail].filter(Boolean).join(': ')}</div>}
        {(r.referrer || r.referrer_name) && (
          <div>הופנה/תה ע״י: {r.referrer ? <PersonLink id={r.referrer.id} name={r.referrer.full_name} className="font-medium" /> : r.referrer_name}</div>
        )}
        {r.link && <div>קישור הרשמה: {r.link.label} <span className="num">({r.link.code})</span></div>}
        {utm && <div>UTM: <span className="num">{utm}</span></div>}
      </dl>
      {fb && <FeedbackItem f={fb} />}
    </div>
  );
}

function FeedbackItem({ f, standalone }: { f: CardFeedback; standalone?: boolean }) {
  const parts: [string, number | null][] = [['כללי', f.overall_rating], ['יוגה/פילאטיס', f.activity_rating], ['הרצאה', f.lecture_rating]];
  return (
    <div className={cx(!standalone && 'mt-2 rounded-[var(--radius-control)] bg-mist px-3 py-2')}>
      {standalone && <p className="font-semibold">משוב{f.event ? ` על ${f.event.title}, ${fmtDate(f.event.starts_at)}` : ''}</p>}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {!standalone && <span className="font-semibold">המשוב שנתן/ה:</span>}
        {parts.filter(([, v]) => v != null).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <Icon name="star" size={14} className="text-light-deep" />
            {k} <span className="num font-semibold">{v}/5</span>
          </span>
        ))}
      </p>
      {f.comment && <p className="mt-1 text-[0.95rem] text-ink-soft">"{f.comment}"</p>}
    </div>
  );
}
