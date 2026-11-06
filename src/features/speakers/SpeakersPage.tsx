import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useSpeakers } from '@/lib/data';
import { fmtDate, fmtShortDate } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import { num } from '@/lib/metrics';
import { proposeUrl } from '@/lib/links';
import { telLink } from '@/lib/phone';
import type { Role, Speaker } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, Notice, PageHeader, Panel, Skeleton, Tabs, cx } from '@/ui/kit';
import { useConfirm, useCopy, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { PhoneText, ago } from '@/features/participants/shared';
import { SpeakerDialog } from './SpeakerDialog';

type Tab = 'speaker' | 'instructor' | 'proposed';
export type PresenterStats = {
  id: string; full_name: string; kind: Speaker['kind']; topic: string | null;
  events: number; avg_attendance: number | null; new_attendees: number | null; avg_rating: number | null; topics: string | null;
};
type Booking = { id: string; title: string; starts_at: string; status: string; speaker_id: string | null; instructor_id: string | null; lecture_topic: string | null; activity_name: string | null };

const KIND_LABEL: Record<Speaker['kind'], string> = { speaker: 'מרצה', instructor: 'מדריך/ה' };
const STATUS: Record<Speaker['status'], { label: string; tone: 'good' | 'warn' | 'neutral' | 'bad' }> = {
  approved: { label: 'מאושר/ת', tone: 'good' },
  proposed: { label: 'ממתין/ה לאישור', tone: 'warn' },
  declined: { label: 'נדחה/תה', tone: 'neutral' },
  archived: { label: 'בארכיון', tone: 'neutral' },
};

export function SpeakersPage() {
  const role = useRole();
  const speakers = useSpeakers();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab | null) ?? 'speaker';
  const setTab = (t: Tab) => setSp(t === 'speaker' ? {} : { tab: t }, { replace: true });
  const [editing, setEditing] = useState<Speaker | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const stats = useQuery({
    queryKey: ['report_presenters', 'all'],
    queryFn: async () => must(await supabase.rpc('report_presenters')) as PresenterStats[],
  });
  const bookings = useQuery({
    queryKey: ['events', 'presenter_bookings'],
    queryFn: async () => must(await supabase.from('events').select('id,title,starts_at,status,speaker_id,instructor_id,lecture_topic,activity_name')
      .gt('starts_at', new Date().toISOString()).neq('status', 'cancelled').or('speaker_id.not.is.null,instructor_id.not.is.null')
      .order('starts_at').limit(200)) as Booking[],
  });

  const all = speakers.data ?? [];
  const statsById = useMemo(() => new Map((stats.data ?? []).map((s) => [s.id, s])), [stats.data]);
  const bookingsBy = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings.data ?? []) {
      for (const id of [b.speaker_id, b.instructor_id]) if (id) m.set(id, [...(m.get(id) ?? []), b]);
    }
    return m;
  }, [bookings.data]);
  const proposed = all.filter((s) => s.status === 'proposed').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ofKind = (k: Speaker['kind']) => all.filter((s) => s.kind === k);
  const active = tab === 'proposed' ? [] : ofKind(tab).filter((s) => s.status === 'approved');
  const inactive = tab === 'proposed' ? [] : ofKind(tab).filter((s) => s.status === 'declined' || s.status === 'archived');

  return (
    <div>
      <PageHeader
        title="מרצים ומדריכים"
        subtitle="מי מעביר/ה את המפגשים, ומי מביא/ה הכי הרבה לוחמים"
        actions={<Button icon="plus" onClick={() => setEditing('new')}>הוספה</Button>}
      />
      <Tabs<Tab>
        label="סוג"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'speaker', label: 'מרצים', count: speakers.data ? ofKind('speaker').filter((s) => s.status === 'approved').length : undefined },
          { value: 'instructor', label: 'מדריכים', count: speakers.data ? ofKind('instructor').filter((s) => s.status === 'approved').length : undefined },
          { value: 'proposed', label: 'הצעות ממתינות', count: speakers.data ? proposed.length : undefined },
        ]}
      />

      {speakers.isError ? (
        <ErrorBox error={errorMessage(speakers.error)} onRetry={() => speakers.refetch()} />
      ) : speakers.isLoading ? (
        <Panel><Skeleton lines={6} /></Panel>
      ) : tab === 'proposed' ? (
        <div className="flex flex-col gap-4">
          <ProposeLink />
          {proposed.length ? (
            <ul className="flex flex-col gap-3">
              {proposed.map((s) => <SpeakerCard key={s.id} s={s} role={role} onEdit={() => setEditing(s)} bookings={bookingsBy.get(s.id)} />)}
            </ul>
          ) : (
            <Panel><EmptyState icon="mic" title="אין הצעות שמחכות">הצעות מהטופס הציבורי ומרצים שרכזים מוסיפים מחכים כאן לאישור של מנהל/ת.</EmptyState></Panel>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Ranking kind={tab} q={stats} />
          {active.length ? (
            <ul className="grid gap-3 xl:grid-cols-2">
              {active.map((s) => <SpeakerCard key={s.id} s={s} role={role} stats={statsById.get(s.id)} bookings={bookingsBy.get(s.id)} onEdit={() => setEditing(s)} />)}
            </ul>
          ) : (
            <Panel>
              <EmptyState icon="mic" title={tab === 'speaker' ? 'עוד אין מרצים מאושרים' : 'עוד אין מדריכים מאושרים'} action={<Button icon="plus" onClick={() => setEditing('new')}>הוספה</Button>}>
                {proposed.length ? <>יש <span className="num">{proposed.length}</span> הצעות שמחכות לאישור בלשונית "הצעות ממתינות".</> : 'אפשר להוסיף ידנית, או לשתף את הקישור לטופס ההצעה העצמית.'}
              </EmptyState>
            </Panel>
          )}
          {inactive.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowInactive((v) => !v)} aria-expanded={showInactive} className="flex min-h-11 items-center gap-1.5 font-semibold text-tide hover:underline">
                <Icon name="chevron" size={16} className={cx('transition-transform', showInactive && '-rotate-90')} />
                {showInactive ? 'הסתרת' : 'הצגת'} לא פעילים (<span className="num">{inactive.length}</span>)
              </button>
              {showInactive && (
                <ul className="mt-2 grid gap-3 xl:grid-cols-2">
                  {inactive.map((s) => <SpeakerCard key={s.id} s={s} role={role} stats={statsById.get(s.id)} onEdit={() => setEditing(s)} />)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {editing && <SpeakerDialog speaker={editing === 'new' ? null : editing} defaultKind={tab === 'instructor' ? 'instructor' : 'speaker'} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProposeLink() {
  const copy = useCopy();
  const url = proposeUrl();
  return (
    <Notice icon="link">
      <p className="font-semibold">קישור לטופס הצעה עצמית</p>
      <p>שולחים למי שרוצה להעביר הרצאה או להדריך. ההצעות מגיעות לכאן, ורק מנהל/ת מאשר/ת.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code dir="ltr" className="num max-w-full truncate rounded-md bg-paper px-2 py-1 text-[0.85rem] text-ink">{url}</code>
        <Button size="sm" variant="secondary" icon="copy" onClick={() => copy(url, 'הקישור הועתק')}>העתקה</Button>
      </div>
    </Notice>
  );
}

// ───────────── who brings the most fighters ─────────────

function Ranking({ kind, q }: { kind: Speaker['kind']; q: { data?: PresenterStats[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const rows = (q.data ?? []).filter((r) => r.kind === kind && r.events > 0)
    .sort((a, b) => (Number(b.avg_attendance) || 0) - (Number(a.avg_attendance) || 0));
  if (q.isError) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Panel><Skeleton lines={3} /></Panel>;
  if (!rows.length) return null;
  return (
    <Panel title={kind === 'speaker' ? 'אילו מרצים ונושאים מביאים הכי הרבה לוחמים' : 'אילו מדריכים מביאים הכי הרבה לוחמים'} padded={false}>
      <table className="hidden w-full text-[0.95rem] md:table">
        <thead className="border-b border-line-soft bg-mist/60 text-right text-sm text-muted">
          <tr>
            <th className="px-5 py-2.5 font-semibold">{KIND_LABEL[kind]}</th>
            <th className="px-3 py-2.5 font-semibold">{kind === 'speaker' ? 'נושאים' : 'פעילות'}</th>
            <th className="px-3 py-2.5 font-semibold">מפגשים</th>
            <th className="px-3 py-2.5 font-semibold" title="ממוצע המגיעים למפגשים שלו/ה">ממוצע משתתפים</th>
            <th className="px-3 py-2.5 font-semibold" title="כמה הגיעו בפעם הראשונה למפגשים שלו/ה">חדשים</th>
            <th className="px-5 py-2.5 font-semibold" title={kind === 'speaker' ? 'ממוצע דירוג ההרצאה במשוב' : 'ממוצע דירוג הפעילות במשוב'}>דירוג</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="px-5 py-2.5 font-semibold"><span className="flex items-center gap-2.5"><span className="num w-4 text-muted">{i + 1}</span>{r.full_name}</span></td>
              <td className="max-w-80 px-3 py-2.5 text-ink-soft">{r.topics || r.topic || '—'}</td>
              <td className="px-3 py-2.5"><span className="num">{r.events}</span></td>
              <td className="px-3 py-2.5"><span className="num font-display text-lg">{num(r.avg_attendance, 1)}</span></td>
              <td className="px-3 py-2.5"><span className="num">{num(r.new_attendees)}</span></td>
              <td className="px-5 py-2.5"><span className="num">{r.avg_rating == null ? '—' : `${num(r.avg_rating, 1)}/5`}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ol className="divide-y divide-line-soft md:hidden">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-3">
            <span className="num w-5 pt-0.5 text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.full_name}</p>
              {(r.topics || r.topic) && <p className="text-sm text-ink-soft">{r.topics || r.topic}</p>}
              <p className="mt-0.5 text-sm text-muted">
                <span className="num">{r.events}</span> מפגשים · <span className="num">{num(r.new_attendees)}</span> חדשים · דירוג <span className="num">{r.avg_rating == null ? '—' : num(r.avg_rating, 1)}</span>
              </p>
            </div>
            <div className="text-center">
              <div className="num font-display text-2xl leading-none">{num(r.avg_attendance, 1)}</div>
              <div className="text-xs text-muted">בממוצע</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-line-soft px-4 py-2.5 text-sm text-muted sm:px-5">לפי המפגשים שכבר התקיימו. ממוצע משתתפים = מי שסומן/ה "הגיע/ה".</p>
    </Panel>
  );
}

// ───────────── one presenter ─────────────

function useSetStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ s, status }: { s: Speaker; status: Speaker['status']; done: string; undo?: Speaker['status'] }) => {
      const { error } = await supabase.from('speakers').update({ status }).eq('id', s.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['speakers'] });
      qc.invalidateQueries({ queryKey: ['report_presenters'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      const undo = v.undo;
      toast.success(v.done, undo ? {
        label: 'ביטול',
        run: async () => {
          const { error } = await supabase.from('speakers').update({ status: undo }).eq('id', v.s.id);
          if (error) toast.error(errorMessage(error));
          qc.invalidateQueries({ queryKey: ['speakers'] });
          qc.invalidateQueries({ queryKey: ['attention'] });
        },
      } : undefined);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function SpeakerCard({ s, role, stats, bookings, onEdit }: { s: Speaker; role: Role | null; stats?: PresenterStats; bookings?: Booking[]; onEdit: () => void }) {
  const setStatus = useSetStatus();
  const confirm = useConfirm();
  const admin = can.admin(role);
  const busy = setStatus.isPending;

  const archive = async () => {
    if (!admin) {
      const ok = await confirm({
        title: `להעביר את ${s.full_name} לארכיון?`,
        body: 'לא יופיע/תופיע ברשימת הבחירה של מפגשים חדשים. רק מנהל/ת יוכל/תוכל להחזיר לפעילים.',
        confirm: 'העברה לארכיון',
        cancel: 'חזרה',
      });
      if (!ok) return;
    }
    setStatus.mutate({ s, status: 'archived', done: `${s.full_name} הועבר/ה לארכיון`, undo: admin ? 'approved' : undefined });
  };

  return (
    <li className="rounded-[var(--radius-panel)] border border-line-soft bg-paper p-4 sm:p-5">
      <div className="flex h-full flex-col gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[1.1rem] font-bold">{s.full_name}</h3>
            {s.status !== 'approved' && <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>}
            {s.status === 'proposed' && <Badge tone="tide">{KIND_LABEL[s.kind]}</Badge>}
            {s.source === 'public_form' && <Badge icon="link">מהטופס הציבורי</Badge>}
          </div>
          {s.topic && <p className="mt-0.5 font-medium text-ink">{s.topic}</p>}
          {s.bio_line && <p className="text-[0.95rem] text-ink-soft">{s.bio_line}</p>}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {s.phone && <a href={telLink(s.phone)} className="inline-flex min-h-8 items-center gap-1 text-tide hover:underline"><Icon name="phone" size={15} /><PhoneText phone={s.phone} /></a>}
            {s.social_url && (
              <a href={s.social_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 max-w-full items-center gap-1 text-tide hover:underline">
                <Icon name="external" size={15} /><span dir="ltr" className="truncate">{s.social_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</span>
              </a>
            )}
            {s.status === 'proposed' && <span className="text-muted">הוצע/ה {ago(s.created_at)}</span>}
          </p>
          {s.proposal_message && (
            <blockquote className="mt-2 rounded-[var(--radius-control)] bg-mist px-3 py-2 text-[0.95rem] text-ink-soft">
              <span className="text-sm font-semibold text-muted">מה כתב/ה בהצעה: </span>{s.proposal_message}
            </blockquote>
          )}
          {s.notes && <p className="mt-2 whitespace-pre-line text-sm text-ink-soft"><span className="font-semibold text-muted">הערות: </span>{s.notes}</p>}

          {stats && stats.events > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-soft">
              <span><span className="num font-semibold text-ink">{stats.events}</span> מפגשים</span>
              <span>ממוצע <span className="num font-semibold text-ink">{num(stats.avg_attendance, 1)}</span> משתתפים</span>
              <span><span className="num font-semibold text-ink">{num(stats.new_attendees)}</span> חדשים</span>
              <span>דירוג <span className="num font-semibold text-ink">{stats.avg_rating == null ? '—' : `${num(stats.avg_rating, 1)}/5`}</span></span>
            </p>
          )}
          {bookings && bookings.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">קבוע/ה ל:</span>
              {bookings.slice(0, 4).map((b) => (
                <Link key={b.id} to={`/app/events/${b.id}`} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-tide-wash px-2.5 font-medium text-tide-deep hover:underline">
                  <span className="num">{fmtShortDate(b.starts_at)}</span> {b.title}{b.status === 'draft' ? ' (טיוטה)' : ''}
                </Link>
              ))}
              {bookings.length > 4 && <span className="text-muted">ועוד <span className="num">{bookings.length - 4}</span></span>}
            </div>
          )}
          {s.status === 'approved' && s.approved_at && <p className="mt-1.5 text-xs text-faint">אושר/ה <span className="num">{fmtDate(s.approved_at)}</span></p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          {s.status === 'proposed' && (admin ? (
            <Button size="sm" icon="check" busy={busy} onClick={() => setStatus.mutate({ s, status: 'approved', done: `${s.full_name} אושר/ה`, undo: 'proposed' })} className="h-11 sm:h-9">אישור</Button>
          ) : (
            <span className="text-sm font-medium text-warn">ממתין לאישור של מנהל/ת</span>
          ))}
          <Button size="sm" variant="secondary" icon="edit" onClick={onEdit} className="h-11 sm:h-9">עריכה</Button>
          {s.status === 'proposed' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ s, status: 'declined', done: 'ההצעה נדחתה', undo: 'proposed' })} className="h-11 sm:h-9">דחייה</Button>
          )}
          {s.status === 'approved' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={archive} className="h-11 sm:h-9">לארכיון</Button>
          )}
          {(s.status === 'declined' || s.status === 'archived') && (
            <Button
              size="sm"
              variant="ghost"
              icon="undo"
              disabled={busy}
              className="h-11 sm:h-9"
              onClick={() => setStatus.mutate(admin
                ? { s, status: 'approved', done: `${s.full_name} חזר/ה לפעילים`, undo: s.status }
                : { s, status: 'proposed', done: `${s.full_name} הועבר/ה להצעות הממתינות לאישור`, undo: s.status })}
            >
              {admin ? 'החזרה לפעילים' : 'החזרה להצעות'}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
