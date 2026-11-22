import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { TZ, fmtDay, fmtTime, relativeDays } from '@/lib/dates';
import type { PublicVolunteer } from '@/lib/types';
import { Badge, EmptyState, ErrorBox, Skeleton, Spinner, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { Tri } from '@/ui/Shapes';
import { roleLabel } from '@/features/volunteers/model';
import { Glyph } from './marks';
import { ContactLine, usePageTitle } from './shared';

type VShift = PublicVolunteer['shifts'][number];
type Answer = 'confirmed' | 'declined';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthName = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'long' });

/** Retry only when the network failed; a known server answer (not_found, rate_limited) is final. */
const retry = (count: number, err: unknown) => errorCode(err) === 'network' && count < 2;

const useVolunteer = (token: string) =>
  useQuery({
    queryKey: ['pub', 'volunteer', token],
    retry,
    queryFn: async () => must(await supabase.rpc('public_volunteer', { p_token: token })) as PublicVolunteer,
  });

const respond = async (token: string, shiftId: string, answer: Answer) =>
  must(await supabase.rpc('public_volunteer_respond', { p_token: token, p_shift_id: shiftId, p_answer: answer })) as Answer;

/** #/v/:token — a volunteer's personal link: their upcoming shifts, confirm or decline each one (and change it). */
export function VolunteerPage() {
  const { token = '' } = useParams();
  const q = useVolunteer(token);
  usePageTitle('ההתנדבות שלי');

  if (q.isPending) return <Skeleton lines={8} className="py-6" />;
  if (q.isError) {
    const code = errorCode(q.error);
    return code === 'not_found' || code === 'invalid_input' ? (
      <EmptyState icon="link" title="הקישור לא בתוקף">
        אפשר לבקש מהצוות קישור חדש: <ContactLine inline />
      </EmptyState>
    ) : (
      <ErrorBox error={errorMessage(q.error)} onRetry={code === 'rate_limited' ? undefined : () => q.refetch()} />
    );
  }

  const { first_name, shifts } = q.data;
  const waiting = shifts.filter((s) => s.status === 'invited').length;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-title">היי {first_name}</h1>
        <p className="mt-2 text-[1.05rem] text-ink-soft">
          {shifts.length ? 'אלה המפגשים שביקשנו בהם את עזרתך. בכל מפגש בוחרים אם מגיעים.' : 'תודה שהצטרפת לצוות המתנדבים של המשך\u00a0תנועה.'}
        </p>
        {waiting > 0 && (
          <p className="mt-2 text-body-sm font-semibold text-ink">
            {waiting === 1 ? 'מפגש אחד מחכה לתשובה שלך.' : <><span className="num">{waiting}</span> מפגשים מחכים לתשובה שלך.</>}
          </p>
        )}
      </div>
      {shifts.length === 0 ? (
        <EmptyState icon="calendar" title="אין כרגע משמרות פתוחות">כשנבקש עזרה במפגש הבא, הוא יופיע כאן באותו קישור.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {shifts.map((s, i) => <li key={s.id}><ShiftCard shift={s} token={token} highlight={i === 0} /></li>)}
        </ul>
      )}
    </div>
  );
}

const STATUS: Record<VShift['status'], { badge: ReactNode; text: string }> = {
  invited: { badge: <Badge tone="warn" icon="alert">מחכים לתשובה שלך</Badge>, text: 'אפשר לבחור, ואפשר לשנות אחר כך.' },
  confirmed: { badge: <Badge tone="good" icon="check">אישרת הגעה</Badge>, text: 'תודה! נשלח תזכורת לפני המפגש.' },
  declined: { badge: <Badge>עדכנת שלא מסתדר</Badge>, text: 'תודה שעדכנת. אם בכל זאת יסתדר, אפשר לשנות כאן.' },
};

function ShiftCard({ shift: s, token, highlight }: { shift: VShift; token: string; highlight: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = new Date(s.starts_at);
  const titleId = `shift-${s.id}`;

  const answer = async (a: Answer) => {
    if (busy || a === s.status) return;
    setBusy(a);
    setError(null);
    try {
      const status = await respond(token, s.id, a);
      qc.setQueryData<PublicVolunteer>(['pub', 'volunteer', token], (d) => d && { ...d, shifts: d.shifts.map((x) => (x.id === s.id ? { ...x, status } : x)) });
    } catch (err) {
      const code = errorCode(err);
      setError(code === 'not_found' ? 'המשמרת הזו כבר לא פתוחה. מרעננים את הרשימה.' : errorMessage(err));
      if (code === 'not_found') void qc.invalidateQueries({ queryKey: ['pub', 'volunteer', token] });
    } finally {
      setBusy(null);
    }
  };

  const st = STATUS[s.status];
  return (
    <article aria-labelledby={titleId} className="overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper">
      <div className="flex">
        <div className={cx(
          'flex w-[5.75rem] shrink-0 flex-col items-center justify-center px-2 py-4 text-center',
          highlight ? 'bg-ink text-light' : 'border-e border-edge bg-sky text-ink',
        )}>
          <span className="text-small font-semibold">{fmtDay(start)}</span>
          <span className="num mt-1 font-display text-stat-lg">{dayNum.format(start)}</span>
          <span className="mt-1 text-small font-semibold">{monthName.format(start)}</span>
        </div>
        <div className="min-w-0 flex-1 px-4 py-4">
          <h2 id={titleId} className="text-heading font-bold">{s.title}</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-body-sm text-ink-soft">
            <li className="flex items-start gap-2">
              <span className="mt-[3px] text-tide"><Glyph name="clock" /></span>
              <span><span className="num">{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span><span className="text-muted"> · {relativeDays(start)}</span></span>
            </li>
            {s.location && (
              <li className="flex items-start gap-2">
                <span className="mt-[3px] text-tide"><Glyph name="pin" /></span>
                <span>{s.location}</span>
              </li>
            )}
            <li className="flex items-start gap-2 font-semibold text-ink">
              <Tri className="mt-[0.45em] shrink-0" />
              <span>התפקיד: {roleLabel(s.type, s.role)}</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-edge px-4 py-4">
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {st.badge}
          <span className="text-small text-muted">{st.text}</span>
        </div>
        <div role="group" aria-label={`התשובה שלך ל${s.title}`} className="mt-3 grid grid-cols-2 gap-2">
          <AnswerButton on={s.status === 'confirmed'} busy={busy === 'confirmed'} disabled={!!busy} onClick={() => answer('confirmed')} icon="check">
            כן, אגיע
          </AnswerButton>
          <AnswerButton on={s.status === 'declined'} busy={busy === 'declined'} disabled={!!busy} onClick={() => answer('declined')} icon="close">
            לא מסתדר לי
          </AnswerButton>
        </div>
        {error && <div className="mt-3"><ErrorBox error={error} /></div>}
      </div>
    </article>
  );
}

function AnswerButton({ on, busy, disabled, onClick, icon, children }: {
  on: boolean; busy: boolean; disabled: boolean; onClick: () => void; icon: 'check' | 'close'; children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-busy={busy || undefined}
      disabled={disabled && !on}
      onClick={onClick}
      className={cx(
        'inline-flex h-14 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-[1.0625rem] font-semibold transition-colors',
        on ? 'bg-ink text-light' : 'border border-control-line bg-paper text-ink hover:border-ink hover:bg-ink/[0.04]',
        disabled && !on && 'opacity-70',
      )}
    >
      {busy ? <Spinner size={20} /> : <Icon name={icon} size={20} />}
      {children}
    </button>
  );
}
