import { useParams, useSearchParams } from 'react-router';
import { useEvent } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { fmtDayLong, relativeDays } from '@/lib/dates';
import { EmptyState, ErrorBox, ButtonLink, Notice, PageHeader, Panel, Skeleton, Tabs } from '@/ui/kit';
import { useEventPeople } from './context';
import { StatusBadge, TypeBadge, isUnclosed, timeRange } from './shared';
import { OverviewTab } from './OverviewTab';
import { RegistrationsTab } from './RegistrationsTab';
import { MessagesTab } from './MessagesTab';
import { MarketingTab } from './MarketingTab';
import { SummaryTab } from './SummaryTab';

export type EventTab = 'overview' | 'registrations' | 'messages' | 'marketing' | 'summary';
const TABS: EventTab[] = ['overview', 'registrations', 'messages', 'marketing', 'summary'];

export function EventPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useEvent(id);
  const e = q.data;
  const people = useEventPeople(e);
  const raw = params.get('tab') as EventTab | null;
  const tab: EventTab = raw && TABS.includes(raw) ? raw : 'overview';
  const go = (t: EventTab, extra: Record<string, string> = {}) => setParams(t === 'overview' ? extra : { tab: t, ...extra }, { replace: true });

  if (q.isLoading) return <Panel><Skeleton lines={8} /></Panel>;
  if (q.isError || !e) {
    const missing = q.error && (q.error as { code?: string }).code === 'PGRST116';
    return missing ? (
      <Panel>
        <EmptyState icon="calendar" title="המפגש לא נמצא" action={<ButtonLink to="/app/events">לכל המפגשים</ButtonLink>}>ייתכן שנמחק.</EmptyState>
      </Panel>
    ) : (
      <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
    );
  }

  const s = e.stats;

  return (
    <>
      <PageHeader
        back={{ to: '/app/events', label: 'כל המפגשים' }}
        title={e.title}
        subtitle={
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <TypeBadge type={e.type} />
            <StatusBadge status={e.status} endsAt={e.ends_at} />
            <span className="font-medium text-ink-soft">{fmtDayLong(e.starts_at)}</span>
            <span className="num">{timeRange(e)}</span>
            {e.status !== 'completed' && e.status !== 'cancelled' && <span>· {relativeDays(e.starts_at)}</span>}
          </div>
        }
      />

      {e.status === 'cancelled' && (
        <div className="mb-5">
          <Notice tone="warn" icon="alert">המפגש בוטל.{e.cancel_reason ? ` הסיבה: ${e.cancel_reason}` : ''}</Notice>
        </div>
      )}
      {isUnclosed(e) && tab !== 'overview' && (
        <div className="mb-5">
          <Notice tone="warn" icon="alert">
            המפגש הסתיים ועדיין לא נסגר. <button type="button" className="font-bold underline" onClick={() => go('overview')}>לסגירת המפגש</button>
          </Notice>
        </div>
      )}

      <Tabs<EventTab>
        label="לשוניות המפגש"
        value={tab}
        onChange={(t) => go(t)}
        tabs={[
          { value: 'overview', label: 'סקירה' },
          { value: 'registrations', label: 'נרשמים', count: s ? s.registered_count + s.walk_in_count + s.waitlisted_count : undefined },
          { value: 'messages', label: 'הודעות' },
          { value: 'marketing', label: 'שיווק' },
          { value: 'summary', label: 'סיכום' },
        ]}
      />

      {tab === 'overview' && <OverviewTab event={e} people={people} onTab={go} />}
      {tab === 'registrations' && <RegistrationsTab event={e} people={people} initialFilter={params.get('filter')} />}
      {tab === 'messages' && <MessagesTab event={e} people={people} initialGroup={params.get('group')} />}
      {tab === 'marketing' && <MarketingTab event={e} people={people} />}
      {tab === 'summary' && <SummaryTab event={e} />}
    </>
  );
}
