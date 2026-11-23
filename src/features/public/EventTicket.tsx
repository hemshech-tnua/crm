import { Children, type ReactNode } from 'react';
import type { PublicEvent } from '@/lib/types';
import { TZ, fmtDay, fmtDayLong, relativeDays } from '@/lib/dates';
import { Badge, cx } from '@/ui/kit';
import { fmtMoney, isPriced } from '@/lib/money';
import { Icon, type IconName } from '@/ui/Icon';
import { activityText, keepName, lectureText, timeRange } from './eventText';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthName = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'long' });

type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'tide';

/** Where registration stands, in words a visitor understands. */
export function availability(e: PublicEvent): { tone: Tone; text: ReactNode; plain?: boolean } {
  if (e.status === 'cancelled') return { tone: 'bad', text: 'המפגש בוטל' };
  if (!e.registration_open) return { tone: 'neutral', text: 'ההרשמה נסגרה' };
  if (e.is_full) return e.waitlist_enabled ? { tone: 'warn', text: 'מלא · יש רשימת המתנה' } : { tone: 'bad', text: 'המפגש מלא' };
  if (e.spots_left != null) {
    return {
      tone: e.spots_left <= 3 ? 'warn' : 'tide',
      text: e.spots_left === 1 ? 'נשאר מקום אחד' : <>נשארו <span className="num">{e.spots_left}</span> מקומות</>,
    };
  }
  return { tone: 'good', text: 'הרשמה פתוחה', plain: true };
}

function Row({ icon, mark, className, children }: { icon?: IconName; mark?: string; className?: string; children: ReactNode }) {
  return (
    <li className={cx('flex items-start gap-2', className)}>
      <span className="mt-[3px] text-tide">
        {mark ? <span aria-hidden="true" className="flex h-[18px] w-[18px] items-center justify-center font-display text-body leading-none">{mark}</span>
          : <Icon name={icon ?? 'sun'} size={18} />}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * One event = one ticket: the date stub, then when, where and what. On the registration page (`detailed`) the speaker's
 * bio and the description run under both, across the ticket's full width, rather than in the narrow column beside the stub.
 */
export function EventTicket({ event, highlight = false, level = 2, detailed = false, agenda = true, showStatus = true, showPrice = true, compact = false, kind, className, children }: {
  event: PublicEvent;
  /** navy date block: only for the one event the page is about (the next Friday) */
  highlight?: boolean;
  level?: 2 | 3;
  /** speaker line and description (the registration page) */
  detailed?: boolean;
  /** the activity and lecture rows; off where the page shows the program next to the ticket (#/friday) */
  agenda?: boolean;
  /** 'notable': only when it says something beyond "open" (few spots, waitlist, full) */
  showStatus?: boolean | 'notable';
  /** false where the same screen already says the amount (a pay block, the pay step): the price once per screen */
  showPrice?: boolean;
  /**
   * Under lg, no date column: the day goes into the time row and every row runs the ticket's full width, so the ticket
   * is a few lines shorter (#/r on a phone, where the form's first field should be high on the screen).
   */
  compact?: boolean;
  /** the kind of meeting, over the title, where the page could suggest another kind ("ערב מדורה" on the home page) */
  kind?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const H = level === 3 ? 'h3' : 'h2';
  const start = new Date(event.starts_at);
  const activity = agenda ? activityText(event) : null;
  const lecture = agenda ? lectureText(event) : null;
  // the speaker's line lives on their card in «כל הפרטים על המפגש»; under the ticket only the meeting's own description
  const more = detailed && event.description;
  const status = availability(event);
  const actions = Children.toArray(children).length > 0;
  return (
    // a grid, so that on a phone the actions (the call to action, the calendar buttons) run under the date block across
    // the ticket's full width: beside a 92px date block on a 320px screen a 200px button does not fit. From sm up they
    // sit in the text column, under the details.
    <article className={cx('grid grid-cols-[5.75rem_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper sm:grid-cols-[7.5rem_minmax(0,1fr)]', compact && 'max-lg:grid-cols-[minmax(0,1fr)]', className)}>
      {/* the date block: navy with beige type for the event the page is about, beige with navy type otherwise */}
      <div
        className={cx(
          'flex flex-col items-center justify-center px-2 py-4 text-center sm:py-5',
          compact && 'max-lg:hidden',
          actions && 'sm:row-span-2',
          highlight ? 'bg-ink text-light' : 'border-e border-edge bg-sky text-ink',
        )}
      >
        <span className="text-small font-semibold">{fmtDay(start)}</span>
        <span className="num mt-1 font-display text-stat-lg">{dayNum.format(start)}</span>
        <span className="mt-1 text-small font-semibold">{monthName.format(start)}</span>
      </div>
      <div className={cx('min-w-0 px-4 py-4 sm:p-5', compact && 'max-lg:py-3')}>
        {kind && <p className="text-small font-semibold text-ink-soft">{kind}</p>}
        <H className="text-heading font-semibold">{keepName(event.title)}</H>
        <ul className="mt-2 flex flex-col gap-1.5 text-body-sm text-ink-soft">
          <Row icon="clock">
            {compact && <span className="lg:hidden">{fmtDayLong(start)} · </span>}
            <span className="num">{timeRange(event)}</span>
            <span className={cx('text-muted', compact && 'max-lg:hidden')}> · {relativeDays(start)}</span>
          </Row>
          {event.location && <Row icon="pin">{event.location}</Row>}
          {/* Friday mornings end with breakfast together: say so up front */}
          {/* compact: not on a phone, where the visitor just read it on the ticket they tapped (#/friday, the home page) */}
          {event.type === 'friday' && <Row icon="coffee" className={compact ? 'max-lg:hidden' : undefined}>קפה ונשנושים</Row>}
          {activity && <Row icon="sun">{keepName(activity)}</Row>}
          {lecture && <Row icon="mic">{keepName(lecture)}</Row>}
          {showPrice && isPriced(event.price) && (
            <Row mark="₪">
              <span className="font-semibold text-ink">מחיר: <span className="num">{fmtMoney(event.price)}</span></span>
              {detailed && event.payment_note && <span className="block text-small text-muted">{event.payment_note}</span>}
            </Row>
          )}
        </ul>
        {(showStatus === true || (showStatus === 'notable' && !status.plain)) && (
          <div className="mt-3">
            <Badge tone={status.tone}>{status.text}</Badge>
          </div>
        )}
      </div>
      {actions && (
        // phone: a footer across the ticket, under a hairline; sm+: under the details, in the text column
        <div className="col-span-2 min-w-0 border-t border-edge px-4 pt-4 pb-4 empty:hidden sm:col-span-1 sm:col-start-2 sm:border-t-0 sm:px-5 sm:pt-0 sm:pb-5 [&>:first-child]:mt-0">
          {children}
        </div>
      )}
      {more && (
        <div className="col-span-2 border-t border-edge px-4 py-3 sm:px-5 sm:py-4">
          <p className="whitespace-pre-line text-body-sm leading-relaxed text-ink-soft">{keepName(event.description ?? '')}</p>
        </div>
      )}
    </article>
  );
}
