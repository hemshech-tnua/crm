import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { errorCode, errorMessage } from '@/lib/errors';
import { allEventsUrl } from '@/lib/links';
import { ButtonLink, EmptyState, ErrorBox, Skeleton } from '@/ui/kit';
import { useFeedbackContext, useRegistration } from './api';
import { EventTicket } from './EventTicket';
import { FeedbackForm } from './FeedbackForm';
import { InviteBlock, ResultTitle, SuccessMark, inviteMessage } from './shared';

/** #/f/:code (the event link, sent to everyone) or #/f/:code?t=token (personal: linked to the registration). */
export function FeedbackPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t')?.trim() || null;
  return <Feedback key={`${code}|${token ?? ''}`} code={code} token={token} />;
}

// an anonymous event-link feedback cannot be looked up later, so this phone remembers it was sent (convenience only)
const SENT_KEY = 'hemshech-feedback-sent';
function sentHere(code: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[]).includes(code);
  } catch {
    return false;
  }
}
function markSent(code: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[]).filter((c) => c !== code).slice(-30);
    localStorage.setItem(SENT_KEY, JSON.stringify([...list, code]));
  } catch {
    /* storage blocked */
  }
}

function Feedback({ code, token }: { code: string; token: string | null }) {
  const qc = useQueryClient();
  const ctx = useFeedbackContext(token ? { token } : { event: code });
  const [done, setDone] = useState(false);
  const [again, setAgain] = useState(false);

  if (done) return <Thanks token={ctx.data?.personal ? token : null} />;
  if (ctx.isPending) return <Skeleton lines={8} className="py-6" />;
  if (ctx.isError) {
    const c = errorCode(ctx.error);
    if (c === 'token_invalid') {
      return (
        <EmptyState icon="link" title="הקישור האישי לא תקין" action={<ButtonLink to={`/f/${code}`}>למשוב בלי הקישור האישי</ButtonLink>}>
          ייתכן שהקישור ישן. אפשר עדיין לתת משוב על המפגש.
        </EmptyState>
      );
    }
    if (c === 'event_not_found') {
      return (
        <EmptyState icon="calendar" title="לא מצאנו את המפגש" action={<ButtonLink to="/">למפגשים הקרובים</ButtonLink>}>
          ייתכן שהקישור ישן או שהוקלד לא נכון.
        </EmptyState>
      );
    }
    return <ErrorBox error={errorMessage(ctx.error)} onRetry={() => ctx.refetch()} />;
  }

  const c = ctx.data;
  if (c.state === 'open' && !c.personal && !again && sentHere(code)) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-[1.9rem] leading-tight">משוב על המפגש</h1>
        <EventTicket event={c.event} showStatus={false} />
        <section className="rounded-[var(--radius-panel)] bg-paper px-5 py-6 text-center">
          <h2 className="text-lg font-bold">כבר שלחת מהטלפון הזה משוב על המפגש. תודה!</h2>
          <button type="button" onClick={() => setAgain(true)} className="mt-3 min-h-11 px-3 font-semibold text-tide underline underline-offset-4">
            משוב של מישהו אחר מאותו טלפון
          </button>
        </section>
      </div>
    );
  }
  if (c.state !== 'open') {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-[1.9rem] leading-tight">משוב על המפגש</h1>
        <EventTicket event={c.event} showStatus={false} />
        <section className="rounded-[var(--radius-panel)] bg-paper px-5 py-6 text-center">
          <h2 className="text-lg font-bold">{c.state === 'not_yet' ? 'המשוב ייפתח כשהמפגש יתחיל' : 'תקופת המשוב למפגש הזה הסתיימה'}</h2>
          <p className="mt-1 text-muted">
            {c.state === 'not_yet' ? 'נשמח לשמוע ממך אחרי המפגש.' : 'תודה! נשמח לשמוע ממך אחרי המפגש הבא.'}
          </p>
          <ButtonLink to="/" variant="secondary" className="mt-4">למפגשים הקרובים</ButtonLink>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[1.9rem] leading-tight">{c.first_name ? `${c.first_name}, איך היה?` : 'איך היה במפגש?'}</h1>
        <p className="mt-1 text-ink-soft">דקה אחת של משוב עוזרת לנו לבנות את המפגש הבא.</p>
      </div>
      <EventTicket event={c.event} showStatus={false} />
      {c.existing && <p className="text-sm text-muted">כבר שלחת משוב על המפגש הזה. אפשר לעדכן אותו כאן.</p>}
      <FeedbackForm
        ctx={c}
        token={c.personal ? token : null}
        submitLabel={c.existing ? 'עדכון המשוב' : 'שליחת המשוב'}
        onDone={() => {
          if (!c.personal) markSent(code);
          setDone(true);
          void qc.invalidateQueries({ queryKey: ['pub', 'feedback'] });
          void qc.invalidateQueries({ queryKey: ['pub', 'registration'] });
        }}
      />
    </div>
  );
}

function Thanks({ token }: { token: string | null }) {
  // the personal invite link comes with the registration (only when the feedback came through a personal link)
  const reg = useRegistration(token);
  const invite = reg.data?.invite_code;
  return (
    <div className="flex flex-col gap-5">
      <div className="pt-2 text-center">
        <SuccessMark />
        <ResultTitle className="mt-4">תודה!</ResultTitle>
        <p className="mx-auto mt-2 max-w-sm text-lg text-ink-soft">המשוב התקבל. הוא עוזר לנו לבנות את המפגשים הבאים.</p>
      </div>
      {invite && <InviteBlock url={allEventsUrl(invite)} message={inviteMessage(null)} />}
      <ButtonLink to="/" variant="secondary" className="self-center">למפגשים הקרובים</ButtonLink>
    </div>
  );
}
