import { Link, useParams, useSearchParams } from 'react-router';
import { useEvent } from '@/lib/data';
import { errorCode, errorMessage } from '@/lib/errors';
import { fmtDayLong, relativeDays } from '@/lib/dates';
import { useTitle } from '@/lib/title';
import { EmptyState, ErrorBox, ButtonLink, Notice, Panel, Skeleton, Tabs } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { MoreMenu } from '@/ui/MoreMenu';
import { useEventPeople } from './context';
import { StatusBadge, TypeBadge, endsNextDay, isUnclosed, timeRange } from './shared';
import { EventStatusStrip, OverviewTab, useEventHeaderActions } from './OverviewTab';
import { RegistrationsTab } from './RegistrationsTab';
import { MessagesTab } from './MessagesTab';
import { MarketingTab } from './MarketingTab';
import { EventPrepTab } from '@/features/prep/EventPrepTab';
import { EventVolunteersTab } from '@/features/volunteers/EventVolunteersTab';
import { SummaryTab } from './SummaryTab';
import type { EventWithStats } from '@/lib/data';

export type EventTab = 'overview' | 'prep' | 'volunteers' | 'registrations' | 'messages' | 'marketing' | 'summary';
const TABS: EventTab[] = ['overview', 'prep', 'volunteers', 'registrations', 'messages', 'marketing', 'summary'];

const BACK = { to: '/app/events', label: 'כל המפגשים' };

export function EventPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useEvent(id);
  const e = q.data;
  const people = useEventPeople(e);
  useTitle(e && [e.title, 'מפגשים']);
  const raw = params.get('tab') as EventTab | null;
  const tab: EventTab = raw && TABS.includes(raw) ? raw : 'overview';
  const go = (t: EventTab, extra: Record<string, string> = {}) => setParams(t === 'overview' ? extra : { tab: t, ...extra }, { replace: true });

  if (q.isLoading) {
    return (
      <>
        <BackLink />
        <div className="skeleton mb-2 h-9 w-2/3 rounded-[var(--radius-control)]" />
        <div className="skeleton mb-6 h-5 w-1/2 rounded-[var(--radius-control)]" />
        <Skeleton shape="block" height={44} className="mb-5" />
        <Panel><Skeleton lines={8} /></Panel>
      </>
    );
  }
  if (!e) {
    // a meeting that is not there (deleted, or a broken link) says so, with the way back; anything else can be retried
    const missing = errorCode(q.error) === 'not_found' || (q.error as { code?: string } | null)?.code === '22P02';
    return (
      <>
        <BackLink />
        {missing ? (
          <Panel>
            <EmptyState icon="calendar" titleAs="h1" title="המפגש לא נמצא" action={<ButtonLink to="/app/events">לכל המפגשים</ButtonLink>}>
              ייתכן שהמפגש נמחק, או שהקישור לא שלם.
            </EmptyState>
          </Panel>
        ) : (
          <>
            <h1 className="mb-4 font-display text-title-sm leading-tight sm:text-title">מפגש</h1>
            <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
          </>
        )}
      </>
    );
  }

  return <EventScreen e={e} people={people} tab={tab} go={go} filter={params.get('filter')} group={params.get('group')} />;
}

function EventScreen({ e, people, tab, go, filter, group }: {
  e: EventWithStats; people: ReturnType<typeof useEventPeople>; tab: EventTab; go: (t: EventTab, extra?: Record<string, string>) => void;
  filter: string | null; group: string | null;
}) {
  const a = useEventHeaderActions(e, go);
  return (
    <>
      <EventHeader e={e} a={a} />

      {e.status === 'cancelled' && (
        <div className="mb-5">
          <Notice tone="warn" icon="alert">המפגש בוטל.{e.cancel_reason ? ` הסיבה: ${e.cancel_reason}` : ''}</Notice>
        </div>
      )}

      <EventStatusStrip e={e} people={people} onTab={go} close={tab !== 'summary' && isUnclosed(e) ? { ask: a.askComplete, busy: a.completing } : null} />

      {/* the tabs stay at hand while scrolling a long tab (the phone's top bar does not stick, so this is the one
          sticky element at the top, G1; under the offline bar when that shows) */}
      <div className="sticky top-[var(--appbar-h)] z-10 -mx-4 bg-sky px-4 sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        <Tabs<EventTab>
          label="לשוניות המפגש"
          value={tab}
          onChange={(t) => go(t)}
          tabs={[
            { value: 'overview', label: 'סקירה' },
            { value: 'prep', label: 'הכנות' },
            { value: 'volunteers', label: 'מתנדבים' },
            { value: 'registrations', label: 'נרשמים' },
            { value: 'messages', label: 'הודעות' },
            { value: 'marketing', label: 'שיווק' },
            { value: 'summary', label: 'סיכום' },
          ]}
        />
      </div>

      {tab === 'overview' && <OverviewTab event={e} people={people} onTab={go} />}
      {tab === 'registrations' && <RegistrationsTab event={e} people={people} initialFilter={filter} />}
      {tab === 'messages' && <MessagesTab event={e} people={people} initialGroup={group} />}
      {tab === 'marketing' && <MarketingTab event={e} people={people} />}
      {tab === 'summary' && <SummaryTab event={e} onTab={go} />}
      {tab === 'prep' && <EventPrepTab event={e} />}
      {tab === 'volunteers' && <EventVolunteersTab event={e} />}
    </>
  );
}

function BackLink() {
  return (
    <Link to={BACK.to} className="mb-1 inline-flex min-h-11 items-center gap-1 text-small font-medium text-tide hover:underline">
      <Icon name="back" size={16} />
      {BACK.label}
    </Link>
  );
}

/**
 * The meeting's header. On a phone the "⋯" menu sits on the title row as an icon, so the stage's one primary step
 * and "עריכה" fit on one row under the date; from sm the menu is the usual "⋯ עוד" button next to them.
 * Only an unusual status is a tag (a draft, a cancelled meeting); the kind of meeting is plain text.
 */
function EventHeader({ e, a }: { e: EventWithStats; a: ReturnType<typeof useEventHeaderActions> }) {
  return (
    <header className="mb-4 sm:mb-6">
      <BackLink />
      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 font-display text-title-sm leading-tight text-ink sm:text-title">{e.title}</h1>
        <MoreMenu items={a.menu} variant="icon" label="עוד פעולות למפגש" className="-me-2 sm:hidden" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted">
        {/* the date already says "יום שישי": the kind is named only for the other kinds */}
        {e.type !== 'friday' && <TypeBadge type={e.type} />}
        <StatusBadge status={e.status} quiet />
        <span className="font-medium text-ink-soft">{fmtDayLong(e.starts_at)}</span>
        <span className="num">{timeRange(e)}</span>
        {endsNextDay(e) && <span>(מסתיים למחרת)</span>}
        {e.status !== 'completed' && e.status !== 'cancelled' && <span>· {relativeDays(e.starts_at)}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.primary}
        {a.secondary}
        <span className="max-sm:hidden"><MoreMenu items={a.menu} /></span>
      </div>
      {a.dialogs}
    </header>
  );
}
