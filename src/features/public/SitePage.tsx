import { Navigate, useParams } from 'react-router';
import { fmtDayLong, fmtTime, relativeDays } from '@/lib/dates';
import { errorCode, errorMessage } from '@/lib/errors';
import { ButtonLink, EmptyState, ErrorBox, Skeleton } from '@/ui/kit';
import { useSiteCheckin } from './api';
import { EventTicket } from './EventTicket';

/**
 * #/s/:siteCode — the permanent sign at a site's entrance (one QR for every meeting there).
 * One meeting open for check-in: straight to its check-in. Two at once: "which one?". None: when the next opens.
 */
export function SitePage() {
  const { code = '' } = useParams();
  const site = useSiteCheckin(code);

  if (site.isPending) return <Skeleton lines={6} className="py-6" />;
  if (site.isError) {
    return errorCode(site.error) === 'site_not_found' ? (
      <EmptyState icon="qr" title="הקוד הזה לא פעיל" action={<ButtonLink to="/" variant="secondary">למפגשים הקרובים</ButtonLink>}>
        אפשר לגשת לצוות בכניסה, ונסמן אתכם שם.
      </EmptyState>
    ) : (
      <ErrorBox error={errorMessage(site.error)} onRetry={() => site.refetch()} />
    );
  }

  const s = site.data;
  if (s.open.length === 1) return <Navigate to={`/c/${s.open[0].checkin_code}`} replace />;
  if (s.open.length > 1) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-[2rem] leading-tight">לאיזה מפגש הגעת?</h1>
        <div className="flex flex-col gap-3">
          {s.open.map((o) => (
            <ButtonLink key={o.checkin_code} to={`/c/${o.checkin_code}`} replace size="lg" className="h-auto! w-full flex-col py-4">
              <span className="text-xl">{o.event.title}</span>
              <span className="num text-base font-normal opacity-80">{fmtTime(o.event.starts_at)}</span>
            </ButtonLink>
          ))}
        </div>
      </div>
    );
  }
  if (s.next) {
    const rel = relativeDays(s.next.opens_at);
    const when = rel === 'היום' || rel === 'מחר' ? rel : `ב${fmtDayLong(s.next.opens_at)}`;
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-[1.9rem] leading-tight">כרגע אין מפגש פתוח לצ׳ק־אין</h1>
        <EventTicket event={s.next.event} showStatus={false} />
        <section className="rounded-[var(--radius-panel)] bg-paper px-5 py-6 text-center">
          <p className="text-lg">
            הצ׳ק־אין למפגש הבא ב{s.site} ייפתח {when} בשעה <span className="num font-bold">{fmtTime(s.next.opens_at)}</span>.
          </p>
          <p className="mt-1 text-muted">אם הגעת ממש לפני, העמוד יתעדכן לבד כשייפתח.</p>
          <ButtonLink to={`/r/${s.next.event.code}`} className="mt-4">להרשמה למפגש</ButtonLink>
        </section>
      </div>
    );
  }
  return (
    <EmptyState icon="calendar" title="אין כרגע מפגש מתוכנן כאן" action={<ButtonLink to="/" variant="secondary">למפגשים הקרובים</ButtonLink>}>
      מפגשים חדשים מתפרסמים בעמוד המפגשים.
    </EmptyState>
  );
}
