import { useMemo, useState } from 'react';
import { ButtonLink, EmptyState, FilterChips, Panel } from '@/ui/kit';
import { BigStat } from '@/features/events/shared';
import { PendingLinks, Reminders, useVolunteerActions } from './actions';
import { MeetingCard, PlannerTable, gridRoles } from './slots';
import { groupByEvent, isNear, slotsFor, tally, type Tally } from './model';

type Filter = 'all' | 'missing' | 'waiting';

function TallyStat({ label, t, highlight }: { label: string; t: Tally; highlight?: boolean }) {
  return (
    <BigStat
      highlight={highlight}
      label={<>{label} · <span className="num">{t.meetings}</span> {t.meetings === 1 ? 'מפגש' : 'מפגשים'}</>}
      value={<>{t.filled}<span className="text-section text-muted">/{t.slots}</span></>}
      sub={
        <span className="flex flex-wrap gap-x-3">
          <span>משובצים</span>
          <span><span className="num font-semibold text-ink">{t.confirmed}</span> אישרו</span>
          <span className={t.missing ? 'font-semibold text-warn' : ''}><span className="num">{t.missing}</span> חסרים</span>
        </span>
      }
    />
  );
}

/** "שיבוץ": the meetings of the next ~3 months with their slots; the gaps say "חסר" and are filled in two taps. */
export function PlannerTab() {
  const { data } = useVolunteerActions();
  const [filter, setFilter] = useState<Filter>('all');
  const byEvent = useMemo(() => groupByEvent(data.shifts), [data.shifts]);

  const state = useMemo(() => new Map(data.events.map((e) => {
    const slots = slotsFor(e, byEvent.get(e.id) ?? []);
    return [e.id, {
      missing: slots.some((s) => s.missing > 0),
      waiting: slots.some((s) => s.filled > s.confirmed),
    }];
  })), [data.events, byEvent]);
  const near = data.events.filter((e) => isNear(e));
  const counts = {
    missing: data.events.filter((e) => state.get(e.id)?.missing).length,
    waiting: data.events.filter((e) => state.get(e.id)?.waiting).length,
  };
  const shown = filter === 'all' ? data.events : data.events.filter((e) => state.get(e.id)?.[filter]);
  const planShifts = useMemo(() => {
    const ids = new Set(data.events.map((e) => e.id));
    return data.shifts.filter((s) => ids.has(s.event_id));
  }, [data.events, data.shifts]);

  const roles = gridRoles(planShifts);

  if (!data.events.length) {
    return (
      <Panel>
        <EmptyState icon="calendar" title="אין מפגשים בשלושת החודשים הקרובים" action={<ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}>
          ברגע שייפתחו מפגשים (גם כטיוטה), אפשר יהיה לשבץ אליהם מתנדבים כאן.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <TallyStat label="4 השבועות הקרובים" t={tally(near, byEvent)} highlight />
        <TallyStat label="3 החודשים הקרובים" t={tally(data.events, byEvent)} />
      </div>

      {/* on a phone each meeting's card carries its own reminders */}
      <Reminders shifts={planShifts} className="hidden md:flex" />
      <PendingLinks shifts={planShifts} />

      <FilterChips<Filter>
        label="אילו מפגשים להציג"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'הכול', count: data.events.length },
          { value: 'missing', label: 'חסרים מתנדבים', count: counts.missing },
          { value: 'waiting', label: 'מחכים לתשובה', count: counts.waiting },
        ]}
      />

      {shown.length === 0 ? (
        <Panel>
          <EmptyState icon="checkCircle" title={filter === 'missing' ? 'אין חורים. כל המקומות משובצים' : 'אין מי שמחכים לתשובה ממנו'} />
        </Panel>
      ) : (
        <>
          <PlannerTable events={shown} shiftsByEvent={byEvent} roles={roles} />
          <div className="flex flex-col gap-3 md:hidden">
            {shown.map((e) => <MeetingCard key={e.id} event={e} shifts={byEvent.get(e.id) ?? []} />)}
          </div>
        </>
      )}
    </div>
  );
}
