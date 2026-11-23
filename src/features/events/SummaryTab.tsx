import { Link } from 'react-router';
import type { EventWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtDayLong } from '@/lib/dates';
import { num, pct, ratio } from '@/lib/metrics';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, Panel, Skeleton } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { useEventFeedback } from './queries';
import { BigStat, hasEnded, hasStarted } from './shared';
import { useMeetingActions } from './OverviewTab';
import type { EventTab } from './EventPage';

export function SummaryTab({ event: e, onTab }: { event: EventWithStats; onTab: (t: EventTab, extra?: Record<string, string>) => void }) {
  // held here, not in the close card: the card goes away once the meeting is closed, the "המפגש נסגר" dialog stays
  const actions = useMeetingActions(e, onTab);
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
      {actions.dialogs}
      {e.status !== 'completed' ? <CloseCard e={e} a={actions} /> : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-edge bg-paper px-4 py-3">
          <p className="flex items-center gap-2 text-body"><Icon name="checkCircle" size={18} />המפגש נסגר. מי שלא הגיעו סומנו, והמשימות שנפתחו מחכות במעקב.</p>
          <ButtonLink to={`/app/followups?event=${e.id}`} variant="secondary" icon="task" cta>למשימות המעקב של המפגש</ButtonLink>
        </div>
      )}
      <section aria-label="נוכחות" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <BigStat highlight label="הגיעו" value={attended} sub={s?.walk_in_count ? `מתוכם ${s.walk_in_count} בלי הרשמה` : 'כולם נרשמו מראש'} />
        <BigStat label="חדשים (פעם ראשונה)" value={attended ? <span className="num">{s?.new_count ?? 0}</span> : '—'} sub={attended ? `${pct(ratio(s?.new_count ?? 0, attended))} מהמגיעים` : undefined} />
        <BigStat label="חוזרים" value={attended ? <span className="num">{s?.returning_count ?? 0}</span> : '—'} sub={attended ? 'היו כבר במפגש קודם' : undefined} />
        <BigStat
          label="שיעור הגעה"
          value={pct(showRate)}
          sub={s?.registered_count ? <span><span className="num">{s.attended_registered_count}</span> מתוך <span className="num">{s.registered_count}</span> שנרשמו מראש ולא ביטלו</span> : 'לא היו נרשמים מראש'}
        />
        <BigStat label="לא הגיעו" value={s?.no_show_count ?? 0} />
        <BigStat label="הגיעו בלי הרשמה" value={s?.walk_in_count ?? 0} />
        <BigStat label="צ׳ק־אין עצמי" value={pct(selfShare)} sub={attended ? <span><span className="num">{s?.self_checkin_count ?? 0}</span> סרקו את קוד ה־QR</span> : undefined} />
        <BigStat label="ביטלו" value={s?.cancelled_count ?? 0} />
        <BigStat label="משובים" value={s?.feedback_count ?? 0} sub={attended ? `${pct(ratio(s?.feedback_count ?? 0, attended))} מהמגיעים` : undefined} />
      </section>

      <Panel title="דירוגים" actions={<Button size="sm" variant="ghost" icon="copy" onClick={() => copy(teamText, 'הסיכום הועתק')}>העתקת סיכום לצוות</Button>}>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <RatingStat label="דירוג כללי" value={s?.avg_overall} />
          <RatingStat label={e.activity_name ? `פעילות (${e.activity_name})` : 'פעילות'} value={s?.avg_activity} />
          <RatingStat label="הרצאה" value={s?.avg_lecture} />
        </div>
        <p className="mt-3 text-small text-muted">ממוצע מתוך 5. "—" כשעוד אין משובים.</p>
      </Panel>

      <Panel title={<span>הערות מהמשוב {comments.length > 0 && <span className="num text-muted">({comments.length})</span>}</span>} padded={false}>
        {fb.isLoading ? (
          <div className="p-5"><Skeleton lines={4} /></div>
        ) : fb.isError ? (
          <div className="p-4"><ErrorBox error={errorMessage(fb.error)} onRetry={() => fb.refetch()} /></div>
        ) : comments.length === 0 ? (
          <EmptyState icon="message" title="עוד אין הערות">אחרי המפגש שולחים למי שהגיע הודעת תודה עם קישור למשוב (לשונית "הודעות").</EmptyState>
        ) : (
          <ul className="divide-y divide-edge">
            {comments.map((f) => (
              <li key={f.id} className="px-4 py-3.5 sm:px-5">
                <p className="leading-relaxed whitespace-pre-line">{f.comment}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-small text-muted">
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

/** The meeting is over (or running) and not closed: closing is this tab's first thing. */
function CloseCard({ e, a }: { e: EventWithStats; a: ReturnType<typeof useMeetingActions> }) {
  const s = e.stats;
  const none = (s?.attended_count ?? 0) === 0 && (s?.registered_count ?? 0) > 0;
  return (
    <section aria-label="סגירת המפגש" className="rounded-[var(--radius-panel)] border border-ink bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-heading font-semibold">{hasEnded(e) ? 'המפגש הסתיים ועוד לא נסגר' : 'המפגש מתקיים עכשיו'}</h2>
          <p className="mt-1 text-small text-ink-soft">
            בסגירה מסומנים מי שלא הגיעו ונפתחות משימות מעקב. עד אז "לא הגיעו" ושיעור ההגעה עוד לא סופיים, והמפגש לא נכלל ביעדים.
          </p>
        </div>
        <Button icon="checkCircle" cta size="lg" busy={a.completing} onClick={a.askComplete}>סגירת המפגש</Button>
      </div>
      {none && (
        <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-warn-wash px-3 py-2.5 text-small font-medium text-warn">
          <Icon name="alert" size={16} className="mt-0.5" />
          <span>
            עוד לא סומנה אף הגעה. אם המפגש התקיים, כדאי לסמן קודם מי הגיעו, אחרת כל <span className="num">{s?.registered_count}</span> הרשומים יסומנו כאי־הגעה.{' '}
            <Link to={`/app/events/${e.id}/door`} className="font-bold underline">לסימון הגעה</Link>
          </span>
        </p>
      )}
    </section>
  );
}

function RatingStat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-edge px-3 py-3">
      <div className="line-clamp-2 min-h-[2lh] text-small leading-snug font-medium text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="num font-display text-title-sm leading-none sm:text-stat">{value == null ? '—' : num(value, 1)}</span>
        {value != null && <span className="text-small text-muted">/ 5</span>}
      </div>
    </div>
  );
}
