import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { personPhotoUrl, supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { useSpeakers } from '@/lib/data';
import { fmtDate, fmtShortDate } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import { num } from '@/lib/metrics';
import { proposeUrl } from '@/lib/links';
import { telLink } from '@/lib/phone';
import type { Role, Speaker } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, Notice, PageHeader, Panel, SearchInput, Skeleton, Tabs, Td, Th, cx } from '@/ui/kit';
import { useConfirm, useCopy, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { PhoneText, ago } from '@/features/participants/shared';
import { SpeakerDialog } from './SpeakerDialog';
import { NoResults } from '@/ui/toolbar';
import { matchesSearch } from '@/ui/search';

type Tab = 'speaker' | 'instructor' | 'proposed';
export type PresenterStats = {
  id: string; full_name: string; kind: Speaker['kind']; topic: string | null;
  events: number; avg_attendance: number | null; new_attendees: number | null; avg_rating: number | null; topics: string | null;
};
type Booking = { id: string; title: string; starts_at: string; status: string; speaker_id: string | null; instructor_id: string | null; lecture_topic: string | null; activity_name: string | null };

const KIND_LABEL: Record<Speaker['kind'], string> = { speaker: 'מרצה', instructor: 'הדרכה' };
const STATUS: Record<Speaker['status'], { label: string; tone: 'good' | 'warn' | 'neutral' | 'bad' }> = {
  approved: { label: 'מאושר', tone: 'good' },
  proposed: { label: 'מחכה לאישור', tone: 'warn' },
  declined: { label: 'ההצעה נדחתה', tone: 'neutral' },
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
  const [term, setTerm] = useState('');
  const needle = term.trim();
  const hit = (s: Speaker) => matchesSearch(needle, { name: s.full_name, phone: s.phone, also: [s.topic, s.bio_line] });
  const newLabel = tab === 'instructor' ? 'מדריך חדש' : 'מרצה חדש';

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
  const proposedAll = all.filter((s) => s.status === 'proposed').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const proposed = proposedAll.filter(hit);
  const ofKind = (k: Speaker['kind']) => all.filter((s) => s.kind === k);
  // most meetings first, then by name: the people the team books most are on top
  const byUse = (a: Speaker, b: Speaker) => (statsById.get(b.id)?.events ?? 0) - (statsById.get(a.id)?.events ?? 0) || a.full_name.localeCompare(b.full_name, 'he');
  const active = tab === 'proposed' ? [] : ofKind(tab).filter((s) => s.status === 'approved' && hit(s)).sort(byUse);
  const inactive = tab === 'proposed' ? [] : ofKind(tab).filter((s) => (s.status === 'declined' || s.status === 'archived') && hit(s));
  const activeAll = tab === 'proposed' ? 0 : ofKind(tab).filter((s) => s.status === 'approved').length;

  return (
    <div>
      <PageHeader
        title="מרצים ומדריכים"
        subtitle="מי מעבירים את המפגשים, ומי מביאים הכי הרבה לוחמים"
        actions={<Button icon="plus" onClick={() => setEditing('new')}>{newLabel}</Button>}
      />
      <Tabs<Tab>
        label="סוג"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'speaker', label: 'מרצים', count: speakers.data ? ofKind('speaker').filter((s) => s.status === 'approved').length : undefined },
          { value: 'instructor', label: 'מדריכים', count: speakers.data ? ofKind('instructor').filter((s) => s.status === 'approved').length : undefined },
          { value: 'proposed', label: 'מחכים לאישור', count: speakers.data ? proposedAll.length : undefined },
        ]}
      />
      {all.length > 0 && (
        <div className="mb-4 sm:max-w-md">
          <SearchInput value={term} onChange={setTerm} label="חיפוש מרצים ומדריכים" placeholder="חיפוש לפי שם, נושא או טלפון" />
        </div>
      )}

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
          ) : needle && proposedAll.length ? (
            <NoHits onClear={() => setTerm('')} />
          ) : (
            <Panel><EmptyState icon="mic" title="אין הצעות שמחכות">הצעות מהטופס הציבורי ומרצים שרכזים מוסיפים מחכים כאן לאישור מנהלים.</EmptyState></Panel>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {!needle && <Ranking kind={tab} q={stats} />}
          {active.length ? (
            <ul className="grid gap-3 xl:grid-cols-2">
              {active.map((s) => <SpeakerCard key={s.id} s={s} role={role} stats={statsById.get(s.id)} bookings={bookingsBy.get(s.id)} onEdit={() => setEditing(s)} />)}
            </ul>
          ) : needle && activeAll ? (
            <NoHits onClear={() => setTerm('')} />
          ) : (
            <Panel>
              <EmptyState icon="mic" title={tab === 'speaker' ? 'עוד אין מרצים מאושרים' : 'עוד אין מדריכים מאושרים'} action={<Button icon="plus" onClick={() => setEditing('new')}>{newLabel}</Button>}>
                {proposedAll.length ? <>יש <span className="num">{proposedAll.length}</span> הצעות בלשונית "מחכים לאישור".</> : 'אפשר להוסיף ידנית, או לשתף את הקישור לטופס ההצעה העצמית.'}
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

function NoHits({ onClear }: { onClear: () => void }) {
  return <Panel><NoResults onClear={onClear} /></Panel>;
}

/** The photo from the meeting page (4:5), or a quiet placeholder: easier to tell people apart at a glance. */
function Thumb({ s }: { s: Speaker }) {
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <div className="flex h-[70px] w-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-edge bg-mist text-muted">
      {s.photo_path && broken !== s.photo_path
        ? <img src={personPhotoUrl(s.photo_path)} alt="" width={56} height={70} loading="lazy" onError={() => setBroken(s.photo_path)} className="h-full w-full object-cover" />
        : <Icon name={s.kind === 'instructor' ? 'sun' : 'mic'} size={22} />}
    </div>
  );
}

function ProposeLink() {
  const copy = useCopy();
  const url = proposeUrl();
  return (
    <Notice icon="link">
      <p className="font-semibold">קישור לטופס הצעה עצמית</p>
      <p>שולחים למי שרוצה להעביר הרצאה או להדריך. ההצעות מגיעות לכאן, ורק מנהלים מאשרים.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code dir="ltr" className="num max-w-full truncate rounded-[var(--radius-control)] bg-paper px-2 py-1 text-small text-ink">{url}</code>
        <Button size="sm" variant="secondary" icon="copy" onClick={() => copy(url, 'הקישור הועתק')}>העתקה</Button>
      </div>
    </Notice>
  );
}

// ───────────── who brings the most fighters ─────────────

const TOP = 5;
const meetings = (n: number) => (n === 1 ? 'מפגש אחד' : <><span className="num">{n}</span> מפגשים</>);

function Ranking({ kind, q }: { kind: Speaker['kind']; q: { data?: PresenterStats[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const [all, setAll] = useState(false);
  const ranked = (q.data ?? []).filter((r) => r.kind === kind && r.events > 0)
    .sort((a, b) => (Number(b.avg_attendance) || 0) - (Number(a.avg_attendance) || 0));
  const rows = all ? ranked : ranked.slice(0, TOP);
  if (q.isError) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Panel><Skeleton lines={3} /></Panel>;
  if (!rows.length) return null;
  return (
    <Panel title={kind === 'speaker' ? 'אילו מרצים ונושאים מביאים הכי הרבה לוחמים' : 'אילו מדריכים מביאים הכי הרבה לוחמים'} padded={false}>
      <table className="hidden w-full border-collapse text-body md:table" aria-label={kind === 'speaker' ? 'דירוג מרצים' : 'דירוג מדריכים'}>
        <thead>
          <tr>
            <Th>{KIND_LABEL[kind]}</Th>
            <Th>{kind === 'speaker' ? 'נושאים' : 'פעילות'}</Th>
            <Th numeric>מפגשים</Th>
            <Th numeric><span title="ממוצע המגיעים למפגש">ממוצע הגעה</span></Th>
            <Th numeric><span title="כמה הגיעו בפעם הראשונה, בכל המפגשים יחד">חדשים</span></Th>
            <Th numeric><span title={kind === 'speaker' ? 'ממוצע דירוג ההרצאה במשוב' : 'ממוצע דירוג הפעילות במשוב'}>דירוג</span></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <Td className="font-semibold"><span className="flex items-center gap-2.5"><span className="num w-4 text-muted">{i + 1}</span>{r.full_name}</span></Td>
              <Td className="max-w-80 text-ink-soft">{r.topics || r.topic || '—'}</Td>
              <Td numeric>{r.events}</Td>
              <Td numeric className="font-bold">{num(r.avg_attendance, 1)}</Td>
              <Td numeric>{num(r.new_attendees)}</Td>
              <Td numeric>{r.avg_rating == null ? '—' : `${num(r.avg_rating, 1)}/5`}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <ol className="divide-y divide-edge md:hidden">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-3">
            <span className="num w-5 pt-0.5 text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.full_name}</p>
              {(r.topics || r.topic) && <p className="text-small text-ink-soft">{r.topics || r.topic}</p>}
              <p className="mt-0.5 text-small text-muted">
                {meetings(r.events)} · <span className="num">{num(r.new_attendees)}</span> חדשים · דירוג <span className="num">{r.avg_rating == null ? '—' : num(r.avg_rating, 1)}</span>
              </p>
            </div>
            <div className="text-center">
              <div className="num text-section font-bold leading-none">{num(r.avg_attendance, 1)}</div>
              <div className="text-micro text-muted">בממוצע</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge px-4 py-2 sm:px-5">
        <p className="text-small text-muted">לפי המפגשים שכבר התקיימו. ממוצע הגעה = סימוני "הגעה" למפגש.</p>
        {ranked.length > TOP && (
          <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? 'רק 5 הראשונים' : <>כל ה-{ranked.length}</>}</Button>
        )}
      </div>
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
      if (!undo) return toast.success(v.done);
      toast.undo(v.done, async () => {
        const { error } = await supabase.from('speakers').update({ status: undo }).eq('id', v.s.id);
        if (error) toast.error(errorMessage(error));
        qc.invalidateQueries({ queryKey: ['speakers'] });
        qc.invalidateQueries({ queryKey: ['attention'] });
      });
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
        body: 'השם לא יופיע ברשימת הבחירה של מפגשים חדשים. רק מנהלים יוכלו להחזיר לפעילים.',
        confirm: 'העברה לארכיון',
        cancel: 'חזרה',
      });
      if (!ok) return;
    }
    setStatus.mutate({ s, status: 'archived', done: `${s.full_name} בארכיון עכשיו`, undo: admin ? 'approved' : undefined });
  };

  return (
    <li className="rounded-[var(--radius-panel)] border border-edge bg-paper p-4 sm:p-5">
      <div className="flex h-full flex-col gap-3">
        <div className="flex min-w-0 flex-1 gap-3.5">
        <Thumb s={s} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-heading font-bold">{s.full_name}</h3>
            {s.status !== 'approved' && <Badge tone={STATUS[s.status].tone} icon={STATUS[s.status].tone === 'warn' ? 'alert' : undefined}>{STATUS[s.status].label}</Badge>}
            {s.status === 'proposed' && <Badge tone="tide">{KIND_LABEL[s.kind]}</Badge>}
            {s.source === 'public_form' && <Badge icon="link">מהטופס הציבורי</Badge>}
          </div>
          {s.topic && <p className="mt-0.5 font-medium text-ink">{s.topic}</p>}
          {s.status !== 'proposed' && (
            <p className="mt-0.5 text-small text-ink-soft" data-testid="presenter-stats">
              {stats && stats.events > 0 ? (
                <>
                  <span className="font-semibold text-ink">{meetings(stats.events)}</span>
                  {' · '}ממוצע <span className="num font-semibold text-ink">{num(stats.avg_attendance, 1)}</span> בכל מפגש
                  {' · '}<span className="num">{num(stats.new_attendees)}</span> חדשים
                  {stats.avg_rating != null && <>{' · '}דירוג <span className="num">{num(stats.avg_rating, 1)}/5</span></>}
                </>
              ) : <span className="text-muted">עוד אין מפגשים שהתקיימו</span>}
            </p>
          )}
          {s.bio_line && <p className="text-body text-ink-soft">{s.bio_line}</p>}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
            {s.phone && <a href={telLink(s.phone)} className="inline-flex min-h-8 items-center gap-1 text-tide hover:underline pointer-coarse:min-h-11"><Icon name="phone" size={15} /><PhoneText phone={s.phone} /></a>}
            {s.social_url && (
              <a href={s.social_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 max-w-full items-center gap-1 text-tide hover:underline pointer-coarse:min-h-11">
                <Icon name="external" size={15} /><span dir="ltr" className="truncate">{s.social_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</span>
              </a>
            )}
            {s.status === 'proposed' && <span className="text-muted">ההצעה הגיעה {ago(s.created_at)}</span>}
          </p>
          {s.proposal_message && (
            <blockquote className="mt-2 rounded-[var(--radius-control)] bg-mist px-3 py-2 text-body text-ink-soft">
              <span className="text-small font-semibold text-muted">מה נכתב בהצעה: </span>{s.proposal_message}
            </blockquote>
          )}
          {s.notes && <p className="mt-2 whitespace-pre-line text-small text-ink-soft"><span className="font-semibold text-muted">הערות: </span>{s.notes}</p>}

          {bookings && bookings.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-small">
              <span className="text-muted">שיבוצים:</span>
              {bookings.slice(0, 4).map((b) => (
                <Link key={b.id} to={`/app/events/${b.id}`} className="inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-control)] border border-ink/25 px-2.5 font-medium text-ink hover:border-ink pointer-coarse:min-h-11">
                  <span className="num">{fmtShortDate(b.starts_at)}</span> {b.title}{b.status === 'draft' ? ' (טיוטה)' : ''}
                </Link>
              ))}
              {bookings.length > 4 && <span className="text-muted">ועוד <span className="num">{bookings.length - 4}</span></span>}
            </div>
          )}
          {s.status === 'approved' && s.approved_at && <p className="mt-1.5 text-micro text-faint">אישור: <span className="num">{fmtDate(s.approved_at)}</span></p>}
        </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
          {s.status === 'proposed' && (admin ? (
            <Button size="sm" icon="check" busy={busy} onClick={() => setStatus.mutate({ s, status: 'approved', done: `${s.full_name}: ההצעה אושרה`, undo: 'proposed' })}>אישור</Button>
          ) : (
            <span className="text-small font-medium text-warn">מחכה לאישור מנהלים</span>
          ))}
          <Button size="sm" variant="secondary" icon="edit" onClick={onEdit}>עריכה</Button>
          {s.status === 'proposed' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ s, status: 'declined', done: 'ההצעה נדחתה', undo: 'proposed' })}>דחייה</Button>
          )}
          {s.status === 'approved' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={archive}>לארכיון</Button>
          )}
          {(s.status === 'declined' || s.status === 'archived') && (
            <Button
              size="sm"
              variant="ghost"
              icon="undo"
              disabled={busy}
             
              onClick={() => setStatus.mutate(admin
                ? { s, status: 'approved', done: `${s.full_name} שוב ברשימת הפעילים`, undo: s.status }
                : { s, status: 'proposed', done: `${s.full_name} שוב ב"מחכים לאישור"`, undo: s.status })}
            >
              {admin ? 'החזרה לפעילים' : 'החזרה להצעות'}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
