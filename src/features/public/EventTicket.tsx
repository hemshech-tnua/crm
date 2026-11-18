import type { ReactNode } from 'react';
import type { PublicEvent } from '@/lib/types';
import { TZ, fmtDay, relativeDays } from '@/lib/dates';
import { Badge, cx } from '@/ui/kit';
import { fmtMoney, isPriced } from '@/lib/money';
import { Icon, type IconName } from '@/ui/Icon';
import { Glyph, type GlyphName } from './marks';
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

function Row({ icon, glyph, mark, children }: { icon?: IconName; glyph?: GlyphName; mark?: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[3px] text-tide">
        {mark ? <span aria-hidden="true" className="flex h-[18px] w-[18px] items-center justify-center font-display text-[1.05rem] leading-none">{mark}</span>
          : glyph ? <Glyph name={glyph} /> : <Icon name={icon ?? 'sun'} size={18} />}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * One event = one ticket: the date stub, then when, where and what. On the registration page (`detailed`) the speaker's
 * bio and the description run under both, across the ticket's full width, rather than in the narrow column beside the stub.
 */
export function EventTicket({ event, highlight = false, level = 2, detailed = false, agenda = true, showStatus = true, className, children }: {
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
  className?: string;
  children?: ReactNode;
}) {
  const H = level === 3 ? 'h3' : 'h2';
  const start = new Date(event.starts_at);
  const activity = agenda ? activityText(event) : null;
  const lecture = agenda ? lectureText(event) : null;
  const more = detailed && (event.speaker_bio || event.description);
  const status = availability(event);
  return (
    <article className={cx('flex flex-wrap overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper', className)}>
      {/* the date block: navy with beige type for the event the page is about, beige with navy type otherwise */}
      <div
        className={cx(
          'flex w-[5.75rem] shrink-0 flex-col items-center justify-center px-2 py-4 text-center sm:w-[7.5rem] sm:py-5',
          highlight ? 'bg-ink text-light' : 'border-e border-edge bg-sky text-ink',
        )}
      >
        <span className="text-small font-semibold">{fmtDay(start)}</span>
        <span className="num mt-1 font-display text-stat-lg">{dayNum.format(start)}</span>
        <span className="mt-1 text-small font-semibold">{monthName.format(start)}</span>
      </div>
      <div className="min-w-0 flex-1 px-4 py-4 sm:px-5 sm:py-5">
          <H className="text-heading font-bold">{keepName(event.title)}</H>
          <ul className="mt-2 flex flex-col gap-1.5 text-[0.9375rem] text-ink-soft">
            <Row glyph="clock">
              <span className="num">{timeRange(event)}</span>
              <span className="text-muted"> · {relativeDays(start)}</span>
            </Row>
            {event.location && <Row glyph="pin">{event.location}</Row>}
            {/* Friday mornings end with breakfast together: say so up front */}
            {event.type === 'friday' && <Row glyph="coffee">קפה ונשנושים</Row>}
            {activity && <Row icon="sun">{keepName(activity)}</Row>}
            {lecture && <Row icon="mic">{keepName(lecture)}</Row>}
            {isPriced(event.price) && (
              <Row mark="₪">
                <span className="font-semibold text-ink">השתתפות: <span className="num">{fmtMoney(event.price)}</span></span>
                {detailed && event.payment_note && <span className="block text-sm text-muted">{event.payment_note}</span>}
              </Row>
            )}
          </ul>
          {(showStatus === true || (showStatus === 'notable' && !status.plain)) && (
            <div className="mt-3">
              <Badge tone={status.tone}>{status.text}</Badge>
            </div>
          )}
          {children}
      </div>
      {more && (
        <div className="basis-full border-t border-edge px-4 py-3 sm:px-5 sm:py-4">
          {event.speaker_bio && <p className="text-sm leading-relaxed text-muted">{keepName(event.speaker_bio)}</p>}
          {event.description && (
            <p className={cx('whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-soft', event.speaker_bio && 'mt-2')}>{keepName(event.description)}</p>
          )}
        </div>
      )}
    </article>
  );
}
