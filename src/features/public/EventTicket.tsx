import type { CSSProperties, ReactNode } from 'react';
import type { PublicEvent } from '@/lib/types';
import { TZ, fmtDay, relativeDays } from '@/lib/dates';
import { Badge, cx } from '@/ui/kit';
import { Icon, type IconName } from '@/ui/Icon';
import { Glyph, type GlyphName } from './marks';
import { activityText, lectureText, timeRange } from './eventText';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthName = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'long' });

type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'tide';

/** Where registration stands, in words a visitor understands. */
export function availability(e: PublicEvent): { tone: Tone; text: ReactNode } {
  if (e.status === 'cancelled') return { tone: 'bad', text: 'המפגש בוטל' };
  if (!e.registration_open) return { tone: 'neutral', text: 'ההרשמה נסגרה' };
  if (e.is_full) return e.waitlist_enabled ? { tone: 'warn', text: 'מלא · יש רשימת המתנה' } : { tone: 'bad', text: 'המפגש מלא' };
  if (e.spots_left != null) {
    return {
      tone: e.spots_left <= 3 ? 'warn' : 'tide',
      text: e.spots_left === 1 ? 'נשאר מקום אחד' : <>נשארו <span className="num">{e.spots_left}</span> מקומות</>,
    };
  }
  return { tone: 'good', text: 'הרשמה פתוחה' };
}

// Two half-circle notches cut where the stub meets the ticket (RTL: the stub is on the right).
const notch = (y: string) => `radial-gradient(circle 11px at calc(100% - var(--stub)) ${y}, transparent 10px, #000 10.5px)`;
const TICKET_SHAPE: CSSProperties = {
  WebkitMaskImage: `${notch('0')}, ${notch('100%')}`,
  maskImage: `${notch('0')}, ${notch('100%')}`,
  WebkitMaskSize: '100% 51%',
  maskSize: '100% 51%',
  WebkitMaskPosition: 'top, bottom',
  maskPosition: 'top, bottom',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
};
// The outline follows the cut shape (a border would be clipped by the notches).
const TICKET_EDGE: CSSProperties = {
  filter: 'drop-shadow(0 0 0.6px rgba(18, 52, 59, 0.5)) drop-shadow(0 2px 4px rgba(18, 52, 59, 0.05))',
};

function Row({ icon, glyph, children }: { icon?: IconName; glyph?: GlyphName; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[3px] text-tide">{glyph ? <Glyph name={glyph} /> : <Icon name={icon ?? 'sun'} size={18} />}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** One event = one ticket: the date stub, then when, where and what. */
export function EventTicket({ event, highlight = false, level = 2, detailed = false, showStatus = true, children }: {
  event: PublicEvent;
  /** saffron date stub: only for the one event the page is about (the next Friday) */
  highlight?: boolean;
  level?: 2 | 3;
  /** speaker line and description (the registration page) */
  detailed?: boolean;
  showStatus?: boolean;
  children?: ReactNode;
}) {
  const H = level === 3 ? 'h3' : 'h2';
  const start = new Date(event.starts_at);
  const activity = activityText(event);
  const lecture = lectureText(event);
  const status = availability(event);
  return (
    <div style={TICKET_EDGE}>
      <article
        style={TICKET_SHAPE}
        className="flex overflow-hidden rounded-[var(--radius-panel)] bg-paper [--stub:6.25rem] sm:[--stub:7.5rem]"
      >
        <div
          className={cx(
            'flex w-[var(--stub)] shrink-0 flex-col items-center justify-center px-2 py-5 text-center text-ink',
            highlight ? 'bg-light' : 'bg-mist-deep',
          )}
        >
          <span className="text-[0.9rem] font-semibold">{fmtDay(start)}</span>
          <span className="num mt-1 font-display text-[3.25rem] leading-[0.95]">{dayNum.format(start)}</span>
          <span className="mt-1 text-[0.9rem] font-semibold">{monthName.format(start)}</span>
        </div>
        <div className="min-w-0 flex-1 border-s-2 border-dashed border-line px-4 py-4 sm:px-5 sm:py-5">
          <H className="text-[1.15rem] font-bold leading-snug">{event.title}</H>
          <ul className="mt-2 flex flex-col gap-1.5 text-[0.95rem] text-ink-soft">
            <Row glyph="clock">
              <span className="num">{timeRange(event)}</span>
              <span className="text-muted"> · {relativeDays(start)}</span>
            </Row>
            {event.location && <Row glyph="pin">{event.location}</Row>}
            {activity && <Row icon="sun">{activity}</Row>}
            {lecture && <Row icon="mic">{lecture}</Row>}
          </ul>
          {detailed && event.speaker_bio && <p className="mt-2 text-sm leading-relaxed text-muted">{event.speaker_bio}</p>}
          {detailed && event.description && (
            <p className="mt-3 whitespace-pre-line text-[0.95rem] leading-relaxed text-ink-soft">{event.description}</p>
          )}
          {showStatus && (
            <div className="mt-3">
              <Badge tone={status.tone}>{status.text}</Badge>
            </div>
          )}
          {children}
        </div>
      </article>
    </div>
  );
}
