import type { EventWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtDayLong } from '@/lib/dates';
import { num, pct, ratio } from '@/lib/metrics';
import { Badge, Button, EmptyState, ErrorBox, Panel, Skeleton } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { useEventFeedback } from './queries';
import { BigStat, hasStarted } from './shared';

export function SummaryTab({ event: e }: { event: EventWithStats }) {
  const started = hasStarted(e);
  const fb = useEventFeedback(e.id, started);
  const copy = useCopy();
  const s = e.stats;

  if (!started || e.status === 'cancelled') {
    return (
      <Panel>
        <EmptyState icon="chart" title={e.status === 'cancelled' ? 'המפגש בוטל' : 'הסיכום יופיע אחרי המפגש'}>
          {e.status === 'cancelled' ? 'אין נתוני נוכחות למפגש שבוטל.' : 'כאן יופיעו הנוכחות, החדשים והחוזרים, שיעור ההגעה, הדירוגים וההערות מהמשוב.'}
        </EmptyState>
      </Panel>
    );
  }

  const attended = s?.attended_count ?? 0;
  const showRate = ratio(s?.attended_registered_count ?? 0, s?.registered_count ?? 0);
  const selfShare = ratio(s?.self_checkin_count ?? 0, attended);
  const comments = (fb.data ?? []).filter((f) => f.comment?.trim());
  const rating = (v: number | null | undefined) => (v == null ? '—' : num(v, 1));

  const teamText = [
    `סיכום ${e.title}, ${fmtDayLong(e.starts_at)}`,
    `הגיעו: ${attended}${s?.walk_in_count ? ` (מתוכם ${s.walk_in_count} בלי הרשמה)` : ''}`,
    `חדשים: ${s?.new_count ?? 0} · חוזרים: ${s?.returning_count ?? 0}`,
    `שיעור הגעה של הנרשמים: ${pct(showRate)} (${s?.attended_registered_count ?? 0} מתוך ${s?.registered_count ?? 0})`,
    `לא הגיעו: ${s?.no_show_count ?? 0}`,
    `צ׳ק־אין עצמי: ${pct(selfShare)}`,
    `דירוג כללי: ${rating(s?.avg_overall)} (${s?.feedback_count ?? 0} משובים)`,
  ].join('\n');

  return (
    <div className="flex flex-col gap-5">
      {e.status !== 'completed' && (
        <p className="text-sm text-muted">המפגש עוד לא נסגר: "לא הגיעו" ושיעור ההגעה יהיו סופיים אחרי "סגירת המפגש".</p>
      )}
      <section aria-label="נוכחות" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <BigStat highlight label="הגיעו" value={attended} sub={s?.walk_in_count ? `מתוכם ${s.walk_in_count} בלי הרשמה` : 'כולם נרשמו מראש'} />
        <BigStat label="חדשים (פעם ראשונה)" value={attended ? <span className="num">{s?.new_count ?? 0}</span> : '—'} sub={attended ? `${pct(ratio(s?.new_count ?? 0, attended))} מהמגיעים` : undefined} />
        <BigStat label="חוזרים" value={attended ? <span className="num">{s?.returning_count ?? 0}</span> : '—'} sub={attended ? 'היו כבר בפעילות קודמת' : undefined} />
        <BigStat
          label="שיעור הגעה"
          value={pct(showRate)}
          sub={s?.registered_count ? <span><span className="num">{s.attended_registered_count}</span> מתוך <span className="num">{s.registered_count}</span> שנרשמו מראש ולא ביטלו</span> : 'לא היו נרשמים מראש'}
        />
        <BigStat label="לא הגיעו" value={s?.no_show_count ?? 0} />
        <BigStat label="הגיעו בלי הרשמה" value={s?.walk_in_count ?? 0} />
        <BigStat label="צ׳ק־אין עצמי" value={pct(selfShare)} sub={attended ? <span><span className="num">{s?.self_checkin_count ?? 0}</span> סרקו QR בכניסה</span> : undefined} />
        <BigStat label="ביטלו" value={s?.cancelled_count ?? 0} />
        <BigStat label="משובים" value={s?.feedback_count ?? 0} sub={attended ? `${pct(ratio(s?.feedback_count ?? 0, attended))} מהמגיעים` : undefined} />
      </section>

      <Panel title="דירוגים" actions={<Button size="sm" variant="ghost" icon="copy" onClick={() => copy(teamText, 'הסיכום הועתק')}>העתקת סיכום לצוות</Button>}>
        <div className="grid grid-cols-3 gap-3">
          <RatingStat label="דירוג כללי" value={s?.avg_overall} />
          <RatingStat label={e.activity_name ? `פעילות (${e.activity_name})` : 'פעילות'} value={s?.avg_activity} />
          <RatingStat label="הרצאה" value={s?.avg_lecture} />
        </div>
        <p className="mt-3 text-sm text-muted">ממוצע מתוך 5. "—" כשעוד אין משובים.</p>
      </Panel>

      <Panel title={<span>הערות מהמשוב {comments.length > 0 && <span className="num text-muted">({comments.length})</span>}</span>} padded={false}>
        {fb.isLoading ? (
          <div className="p-5"><Skeleton lines={4} /></div>
        ) : fb.isError ? (
          <div className="p-4"><ErrorBox error={errorMessage(fb.error)} onRetry={() => fb.refetch()} /></div>
        ) : comments.length === 0 ? (
          <EmptyState icon="message" title="עוד אין הערות">אחרי המפגש שולחים למי שהגיע הודעת תודה עם קישור למשוב (לשונית "הודעות").</EmptyState>
        ) : (
          <ul className="divide-y divide-line-soft">
            {comments.map((f) => (
              <li key={f.id} className="px-4 py-3.5 sm:px-5">
                <p className="leading-relaxed whitespace-pre-line">{f.comment}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                  <Badge tone="neutral" icon="star">כללי <span className="num">{f.overall_rating}</span></Badge>
                  {f.activity_rating != null && <Badge tone="neutral">פעילות <span className="num">{f.activity_rating}</span></Badge>}
                  {f.lecture_rating != null && <Badge tone="neutral">הרצאה <span className="num">{f.lecture_rating}</span></Badge>}
                  <span className="num">{fmtDate(f.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RatingStat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-mist px-3 py-3">
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="num font-display text-[1.8rem] leading-tight">{value == null ? '—' : num(value, 1)}</span>
        {value != null && <Icon name="star" size={18} className="text-light-deep" />}
      </div>
    </div>
  );
}
