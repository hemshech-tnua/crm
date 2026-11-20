import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { telLink } from '@/lib/phone';
import type { Volunteer } from '@/lib/types';
import { Badge, Button, EmptyState, Panel, SearchInput, Td, Th, cx } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { MoreMenu } from '@/ui/MoreMenu';
import { NoResults } from '@/ui/toolbar';
import { SEARCH_PLACEHOLDER, matchesSearch } from '@/ui/search';
import { PhoneText } from '@/features/participants/shared';
import { useVolunteerActions } from './actions';
import { ROLE_LABEL, dayAndDate, isUpcoming, roleLabel, type Shift } from './model';

type Row = { v: Volunteer; upcoming: Shift[]; past: number };

function useSetActive() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ v, active, cancel }: { v: Volunteer; active: boolean; cancel: string[] }) => {
      const { error } = await supabase.from('volunteers').update({ is_active: active }).eq('id', v.id);
      if (error) throw error;
      if (cancel.length) {
        const { error: e2 } = await supabase.from('volunteer_shifts').update({ status: 'cancelled' }).in('id', cancel);
        if (e2) throw e2;
      }
    },
    onSuccess: (_d, { v, active, cancel }) => {
      void qc.invalidateQueries({ queryKey: ['volunteers'] });
      void qc.invalidateQueries({ queryKey: ['volunteer_shifts'] });
      toast.success(active ? `${v.full_name} שוב ברשימה הפעילה` : `${v.full_name} ב"לא פעילים" עכשיו${cancel.length ? `, ${cancel.length} שיבוצים בוטלו` : ''}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** "רשימת מתנדבים": everyone who helps, with how many meetings each is booked for and the next one. */
export function PoolTab({ onEdit }: { onEdit: (v: Volunteer | 'new') => void }) {
  const { data, send } = useVolunteerActions();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const setActive = useSetActive();
  const confirm = useConfirm();

  const rows = useMemo(() => {
    const by = new Map<string, Row>(data.volunteers.map((v) => [v.id, { v, upcoming: [], past: 0 }]));
    for (const s of data.shifts) {
      const r = by.get(s.volunteer_id);
      if (!r) continue;
      if (isUpcoming(s.event)) {
        if (s.status === 'invited' || s.status === 'confirmed') r.upcoming.push(s);
      } else if (s.status === 'confirmed' && s.event.status !== 'cancelled') {
        r.past += 1;
      }
    }
    for (const r of by.values()) r.upcoming.sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
    return [...by.values()];
  }, [data.volunteers, data.shifts]);

  const term = q.trim().toLowerCase();
  const match = (r: Row) => matchesSearch(q, { name: r.v.full_name, phone: r.v.phone, also: r.v.roles.map((x) => ROLE_LABEL[x]) });
  const active = rows.filter((r) => r.v.is_active && match(r));
  const inactive = rows.filter((r) => !r.v.is_active && match(r));

  const deactivate = async (r: Row) => {
    const n = r.upcoming.length;
    const ok = await confirm({
      title: `להעביר את ${r.v.full_name} ל"לא פעילים"?`,
      body: n
        ? `יש ${n === 1 ? 'שיבוץ קרוב אחד' : `${n} שיבוצים קרובים`}. הם יבוטלו, והמקומות יסומנו "חסר". הקישור האישי יפסיק לעבוד.`
        : 'השם לא יופיע ברשימת השיבוץ, והקישור האישי יפסיק לעבוד. אפשר להחזיר בכל עת.',
      confirm: 'העברה ל"לא פעילים"',
      cancel: 'חזרה',
      danger: n > 0,
    });
    if (ok) setActive.mutate({ v: r.v, active: false, cancel: r.upcoming.map((s) => s.id) });
  };

  const actions = (r: Row) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.v.is_active ? (
        <>
          <Button size="sm" variant="secondary" icon="link" onClick={() => send(r.v.id)} aria-label={`שליחת קישור ל${r.v.full_name}`}>שליחת קישור</Button>
          <Button size="sm" variant="ghost" icon="edit" onClick={() => onEdit(r.v)} aria-label={`עריכה: ${r.v.full_name}`}>עריכה</Button>
          <MoreMenu
            variant="icon"
            size="sm"
            label={`פעולות נוספות ל${r.v.full_name}`}
            items={[{ label: 'העברה ל"לא פעילים"', icon: 'close', danger: true, disabled: setActive.isPending, onClick: () => { void deactivate(r); } }]}
          />
        </>
      ) : (
        <>
          <Button size="sm" variant="ghost" icon="undo" disabled={setActive.isPending} onClick={() => setActive.mutate({ v: r.v, active: true, cancel: [] })}>החזרה לרשימה הפעילה</Button>
          <Button size="sm" variant="ghost" icon="edit" onClick={() => onEdit(r.v)} aria-label={`עריכה: ${r.v.full_name}`}>עריכה</Button>
        </>
      )}
    </div>
  );

  const next = (r: Row) => {
    const s = r.upcoming[0];
    if (!s) return <span className="text-faint">—</span>;
    return (
      <Link to={`/app/events/${s.event_id}?tab=volunteers`} className="hover:underline">
        <span className="num">{dayAndDate(s.event.starts_at)}</span> · {roleLabel(s.event.type, s.role)}
        {s.status === 'invited' && <span className="text-muted"> (בהמתנה)</span>}
      </Link>
    );
  };
  const booked = (r: Row) => {
    const events = new Set(r.upcoming.map((s) => s.event_id)).size;
    return events ? <span className="num font-semibold">{events}</span> : <span className="text-faint">0</span>;
  };

  const list = (rs: Row[]) => (
    <>
      <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-edge bg-paper md:block">
        <table className="w-full border-collapse text-body" aria-label="רשימת המתנדבים">
          <thead>
            <tr>
              <Th>שם</Th>
              <Th>טלפון</Th>
              <Th>תפקידים מועדפים</Th>
              <Th numeric><span title="מפגשים קרובים עם שיבוץ (בהמתנה או הגעה אושרה)">שיבוצים</span></Th>
              <Th>המפגש הבא</Th>
              <Th numeric><span title="מפגשים בשנה האחרונה עם אישור הגעה">בשנה האחרונה</span></Th>
              <Th><span className="sr-only">פעולות</span></Th>
            </tr>
          </thead>
          <tbody>
            {rs.map((r) => (
              <tr key={r.v.id} className={cx(!r.v.is_active && 'text-muted')}>
                <Td className="font-semibold">
                  {r.v.full_name}
                  {r.v.notes && <p className="max-w-64 truncate text-small font-normal text-muted" title={r.v.notes}>{r.v.notes}</p>}
                </Td>
                <Td>{r.v.phone ? <a href={telLink(r.v.phone)} className="hover:underline"><PhoneText phone={r.v.phone} /></a> : <span className="text-faint">—</span>}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">{r.v.roles.length ? r.v.roles.map((x) => <Badge key={x}>{ROLE_LABEL[x]}</Badge>) : <span className="text-faint">—</span>}</span>
                </Td>
                <Td numeric>{booked(r)}</Td>
                <Td className="text-small">{next(r)}</Td>
                <Td numeric>{r.past || <span className="text-faint">0</span>}</Td>
                <Td>{actions(r)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden">
        {rs.map((r) => (
          <li key={r.v.id} className="rounded-[var(--radius-panel)] border border-edge bg-paper p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{r.v.full_name}</p>
                {r.v.phone && (
                  <a href={telLink(r.v.phone)} className="inline-flex min-h-11 items-center gap-1 text-small text-tide hover:underline">
                    <Icon name="phone" size={15} /><PhoneText phone={r.v.phone} />
                  </a>
                )}
              </div>
              <div className="text-center">
                <div className="num font-display text-section leading-none">{new Set(r.upcoming.map((s) => s.event_id)).size}</div>
                <div className="text-micro text-muted">שיבוצים</div>
              </div>
            </div>
            {r.v.roles.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.v.roles.map((x) => <Badge key={x}>{ROLE_LABEL[x]}</Badge>)}</div>}
            <p className="mt-2 text-small"><span className="text-muted">הבא: </span>{next(r)}</p>
            {r.v.notes && <p className="mt-1 text-small whitespace-pre-line text-ink-soft">{r.v.notes}</p>}
            <div className="mt-3 border-t border-edge pt-3">{actions(r)}</div>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <SearchInput value={q} onChange={setQ} label="חיפוש מתנדבים" placeholder={SEARCH_PLACEHOLDER} />
      {active.length ? list(active) : (
        <Panel>
          {term ? (
            <NoResults onClear={() => setQ('')}>
              {inactive.length ? <>יש <span className="num">{inactive.length}</span> תוצאות ברשימת הלא פעילים, למטה.</> : 'אפשר לחפש לפי חלק מהשם, מספר טלפון מלא או 4 הספרות האחרונות.'}
            </NoResults>
          ) : (
            <EmptyState icon="people" title="עוד אין מתנדבים ברשימה" action={<Button icon="userPlus" onClick={() => onEdit('new')}>מתנדב חדש</Button>}>
              מוסיפים כאן את מי שעוזר במפגשים: קבלת פנים, הקמה, פירוק, צילום. אחר כך משבצים אותם מראש בלשונית "שיבוץ למפגשים".
            </EmptyState>
          )}
        </Panel>
      )}
      {inactive.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowInactive((x) => !x)} aria-expanded={showInactive} className="flex min-h-11 items-center gap-1.5 font-semibold text-tide hover:underline">
            <Icon name="chevron" size={16} className={cx('transition-transform', showInactive && '-rotate-90')} />
            {showInactive ? 'הסתרת' : 'הצגת'} לא פעילים (<span className="num">{inactive.length}</span>)
          </button>
          {showInactive && <div className="mt-2">{list(inactive)}</div>}
        </div>
      )}
    </div>
  );
}
