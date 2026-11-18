import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { errorMessage } from '@/lib/errors';
import type { Volunteer } from '@/lib/types';
import { Button, ErrorBox, PageHeader, Panel, Skeleton, Tabs } from '@/ui/kit';
import { VolunteerActions } from './actions';
import { PlannerTab } from './PlannerTab';
import { PoolTab } from './PoolTab';
import { VolunteerDialog } from './VolunteerDialog';
import { usePlanEvents, useShifts, useVolunteers } from './queries';

type Tab = 'plan' | 'pool';

/** #/app/volunteers — booking volunteers months ahead ("שיבוץ") and the pool ("מאגר"). */
export function VolunteersPage() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get('tab') === 'pool' ? 'pool' : 'plan';
  const setTab = (t: Tab) => setSp(t === 'plan' ? {} : { tab: t }, { replace: true });
  const [editing, setEditing] = useState<Volunteer | 'new' | null>(null);

  const volunteers = useVolunteers();
  const events = usePlanEvents();
  const shifts = useShifts();
  const failed = volunteers.error ?? events.error ?? shifts.error;
  const ready = volunteers.data && events.data && shifts.data;

  return (
    <div>
      <PageHeader
        title="מתנדבים"
        subtitle="משבצים מראש לחודשים הקרובים, ושולחים קישור אישי לאישור"
        actions={<Button icon="userPlus" onClick={() => setEditing('new')}>הוספה למאגר</Button>}
      />
      <Tabs<Tab>
        label="מתנדבים"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'plan', label: 'שיבוץ' },
          { value: 'pool', label: 'מאגר', count: volunteers.data?.filter((v) => v.is_active).length },
        ]}
      />
      {failed ? (
        <ErrorBox error={errorMessage(failed)} onRetry={() => { void volunteers.refetch(); void events.refetch(); void shifts.refetch(); }} />
      ) : !ready ? (
        <Panel><Skeleton lines={8} /></Panel>
      ) : (
        <VolunteerActions data={{ volunteers: volunteers.data, events: events.data, shifts: shifts.data }}>
          {tab === 'plan' ? <PlannerTab /> : <PoolTab onEdit={setEditing} />}
        </VolunteerActions>
      )}
      {editing && <VolunteerDialog volunteer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
