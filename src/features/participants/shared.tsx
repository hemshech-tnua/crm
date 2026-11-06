// Helpers shared by the participant screens (and the follow-up / speaker screens of the same team).
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { must } from '@/lib/errors';
import { ENGAGEMENT_HINT, ENGAGEMENT_LABEL } from '@/lib/labels';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { allEventsUrl, feedbackUrl, registerUrl } from '@/lib/links';
import { todayIl, ilParts } from '@/lib/dates';
import type { TemplateContext } from '@/lib/templates';
import type { Engagement } from '@/lib/types';
import { Badge, SearchInput, Spinner, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';

/** Questionnaire Q27: shown next to every free-text field about a person. */
export const NOTES_GUIDANCE = 'לא רושמים כאן מידע רפואי, יחידה צבאית או הערות על אופי ואישיות.';

export const CREATED_VIA_LABEL: Record<string, string> = {
  registration: 'נרשם/ה בטופס ההרשמה',
  checkin: 'נרשם/ה בכניסה למפגש',
  staff: 'נוסף/ה על ידי הצוות',
  import: 'יובא/ה מרשימה',
};

// Saffron (`light`) stays reserved for "today / the next meeting" (docs/02); statuses use the semantic tones.
const ENGAGEMENT_TONE: Record<Engagement, 'neutral' | 'tide' | 'good' | 'warn'> = {
  registered: 'neutral',
  first_timer: 'tide',
  returning: 'tide',
  regular: 'good',
  lapsed: 'warn',
};

export const ENGAGEMENT_ORDER: Engagement[] = ['regular', 'returning', 'first_timer', 'registered', 'lapsed'];

export function EngagementBadge({ status }: { status: Engagement | null | undefined }) {
  if (!status) return null;
  return <Badge tone={ENGAGEMENT_TONE[status]} title={ENGAGEMENT_HINT[status]}>{ENGAGEMENT_LABEL[status]}</Badge>;
}

/** Value that follows `value` after `ms` of quiet (for search-as-you-type against the server). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * PostgREST `or` filter for a free-text search over name, city and phone.
 * Phone digits match in any format: "050-123", "0501234567", "+972 50…" and "4567" all find +972501234567.
 */
export function searchOrFilter(term: string): string | null {
  const text = term.replace(/[,()"\\*%:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const parts = [`full_name.ilike."*${text}*"`, `city.ilike."*${text}*"`];
  let digits = term.replace(/\D/g, '');
  if (digits.length >= 3) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('972')) digits = digits.slice(3);
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits) parts.push(`phone.like."*${digits}*"`);
  }
  return parts.join(',');
}

/** "לפני 3 שבועות": coarse, friendly distance from a past moment (Israel calendar days). */
export function ago(v: string | null | undefined): string | null {
  if (!v) return null;
  const days = Math.round((new Date(`${todayIl()}T12:00:00Z`).getTime() - new Date(`${ilParts(v).date}T12:00:00Z`).getTime()) / 864e5);
  if (days < 0) return days === -1 ? 'מחר' : `בעוד ${-days} ימים`;
  if (days === 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 14) return `לפני ${days} ימים`;
  if (days < 60) return `לפני ${Math.round(days / 7)} שבועות`;
  if (days < 365) return `לפני ${Math.round(days / 30)} חודשים`;
  const years = Math.floor(days / 365);
  return years === 1 ? 'לפני שנה' : `לפני ${years} שנים`;
}

/** Days from today (Israel) to a date string "YYYY-MM-DD"; negative = past. */
export function daysUntil(date: string): number {
  return Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${todayIl()}T12:00:00Z`).getTime()) / 864e5);
}

// ───────────── the next open meeting (for invitations) ─────────────

export type EventForMessage = {
  id: string;
  title: string;
  starts_at: string;
  public_code: string;
  location: string | null;
  lecture_topic: string | null;
  activity_name: string | null;
  speaker: { full_name: string; topic: string | null } | null;
};
export const EVENT_FOR_MESSAGE =
  'id,title,starts_at,public_code,location,lecture_topic,activity_name,speaker:speakers!speaker_id(full_name,topic)';

export function useNextOpenEvent() {
  return useQuery({
    queryKey: ['events', 'next_open'],
    staleTime: 60_000,
    queryFn: async () =>
      (must(
        await supabase.from('events').select(EVENT_FOR_MESSAGE).eq('status', 'open').gt('starts_at', new Date().toISOString())
          .order('starts_at').limit(1).maybeSingle(),
      ) as unknown as EventForMessage | null),
  });
}

/** Message placeholders for one meeting. Without a meeting, the registration link points to the list of open meetings. */
export function eventContext(ev: EventForMessage | null | undefined): TemplateContext {
  if (!ev) return { registerLink: allEventsUrl() };
  return {
    eventTitle: ev.title,
    startsAt: ev.starts_at,
    location: ev.location,
    activity: ev.activity_name,
    speaker: ev.speaker?.full_name ?? null,
    topic: ev.lecture_topic ?? ev.speaker?.topic ?? null,
    registerLink: registerUrl(ev.public_code),
    feedbackLink: feedbackUrl(ev.public_code),
  };
}

// ───────────── participant search & pick ─────────────

export type PickedParticipant = { id: string; full_name: string | null; phone: string | null; city: string | null };

export function useParticipantSearch(term: string, opts: { excludeId?: string; limit?: number } = {}) {
  const q = useDebounced(term.trim(), 250);
  return useQuery({
    queryKey: ['participants', 'pick', q, opts.excludeId, opts.limit],
    enabled: q.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const filter = searchOrFilter(q);
      let query = supabase.from('participants').select('id,full_name,phone,city').is('anonymized_at', null)
        .order('full_name').limit(opts.limit ?? 8);
      if (filter) query = query.or(filter);
      if (opts.excludeId) query = query.neq('id', opts.excludeId);
      return must(await query) as PickedParticipant[];
    },
  });
}

/** Search box + tappable results. Used to link a referrer, open a task for someone, etc. */
export function ParticipantPicker({ onPick, excludeId, label = 'חיפוש לוחם/ת', placeholder = 'שם, טלפון או עיר' }: {
  onPick: (p: PickedParticipant) => void; excludeId?: string; label?: string; placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const res = useParticipantSearch(term, { excludeId });
  const typing = term.trim().length >= 2;
  return (
    <div className="flex flex-col gap-2">
      <SearchInput value={term} onChange={setTerm} label={label} placeholder={placeholder} />
      {!typing && <p className="text-sm text-muted">כותבים לפחות 2 תווים מהשם או 3 ספרות מהטלפון.</p>}
      {typing && res.isFetching && !res.data && <div className="flex items-center gap-2 py-2 text-sm text-muted"><Spinner size={16} />מחפשים…</div>}
      {typing && res.isError && <p className="text-sm text-bad">החיפוש נכשל. נסו שוב.</p>}
      {typing && res.data && res.data.length === 0 && <p className="py-2 text-sm text-muted">לא נמצאו לוחמים מתאימים.</p>}
      {typing && res.data && res.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-soft rounded-[var(--radius-control)] border border-line-soft">
          {res.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-3.5 py-2 text-right hover:bg-tide-wash focus-visible:bg-tide-wash"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.full_name}</span>
                  {p.city && <span className="block text-sm text-muted">{p.city}</span>}
                </span>
                <span className="num shrink-0 text-sm text-muted">{formatPhone(p.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A participant's name as a link to their card (or a neutral label when the details were erased). */
export function PersonLink({ id, name, className = '' }: { id: string; name: string | null; className?: string }) {
  if (!name) return <span className={cx('text-muted', className)}>פרטים נמחקו</span>;
  return (
    <Link to={`/app/participants/${id}`} className={cx('font-semibold text-tide hover:underline', className)}>
      {name}
    </Link>
  );
}

export function PhoneText({ phone }: { phone: string | null | undefined }) {
  if (!phone) return <span className="text-faint">—</span>;
  return <span className="num whitespace-nowrap">{formatPhone(phone)}</span>;
}

export function FieldGuidance() {
  return (
    <p className="flex items-start gap-1.5 text-sm text-warn">
      <Icon name="shield" size={16} className="mt-0.5" />
      <span>{NOTES_GUIDANCE}</span>
    </p>
  );
}

// ───────────── validation (mirrors the server; the server stays the source of truth) ─────────────

export function nameError(v: string): string | null {
  const t = v.trim();
  if (t.length < 2) return 'צריך לכתוב שם מלא.';
  if (t.length > 80) return 'השם ארוך מדי (עד 80 תווים).';
  if (/[0-9<>@/\\{}=;]/.test(t)) return 'שם יכול לכלול אותיות בלבד.';
  return null;
}

export function phoneError(v: string): string | null {
  if (!v.trim()) return 'צריך מספר טלפון.';
  return normalizePhone(v) ? null : 'מספר הטלפון לא נראה תקין. כותבים כמו 050-1234567.';
}

export function birthDateError(v: string): string | null {
  if (!v) return null;
  return v >= '1920-01-01' && v <= '2015-12-31' ? null : 'תאריך הלידה לא נראה תקין.';
}

export function cityError(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  return t.length >= 2 && t.length <= 60 && !/[0-9<>@/\\{}=;]/.test(t) ? null : 'שם העיר לא נראה תקין.';
}
