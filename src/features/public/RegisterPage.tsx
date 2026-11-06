import { useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { PublicEvent } from '@/lib/types';
import { errorCode, errorMessage } from '@/lib/errors';
import { allEventsUrl, manageUrl, registerUrl } from '@/lib/links';
import { Button, ButtonLink, EmptyState, ErrorBox, Notice, Skeleton } from '@/ui/kit';
import { registerFor, usePublicEvent, usePublicSources, type PublicSource, type RegisterResult } from './api';
import { saveToken } from './device';
import { EventTicket } from './EventTicket';
import { Glyph } from './marks';
import { trackingQuery } from './tracking';
import { ConsentFields, PersonFields, usePersonForm } from './PersonForm';
import { CalendarButtons, InviteBlock, PersonalLink, ResultTitle, SuccessMark, WaitMark, inviteMessage } from './shared';

const UTM_KEYS = ['source', 'medium', 'campaign'] as const;

export function RegisterPage() {
  const { code = '' } = useParams();
  // a new event (or invite) is a new page: never carry the previous form or success screen over
  const [params] = useSearchParams();
  return <Register key={`${code}|${params.get('ref') ?? ''}`} code={code} params={params} />;
}

function Register({ code, params }: { code: string; params: URLSearchParams }) {
  const ref = params.get('ref')?.trim().toLowerCase() || null;
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params.get(`utm_${k}`)?.trim();
    if (v) utm[k] = v.slice(0, 100);
  }
  const event = usePublicEvent(code, ref);
  const sources = usePublicSources();
  const [done, setDone] = useState<RegisterResult | null>(null);
  const home = `/${trackingQuery(params)}`;

  if (done && event.data) return <Registered result={done} event={done.event ?? event.data} />;

  if (event.isPending) return <Skeleton lines={8} className="py-6" />;
  if (event.isError) {
    return errorCode(event.error) === 'event_not_found' ? (
      <EmptyState icon="calendar" title="לא מצאנו את המפגש" action={<ButtonLink to={home}>למפגשים הקרובים</ButtonLink>}>
        ייתכן שהקישור ישן או שהוקלד לא נכון.
      </EmptyState>
    ) : (
      <ErrorBox error={errorMessage(event.error)} onRetry={() => event.refetch()} />
    );
  }

  const e = event.data;
  const closed = e.status === 'cancelled' || !e.registration_open || (e.is_full && !e.waitlist_enabled);

  return (
    <div className="flex flex-col gap-5">
      {e.invited_by && (
        <p className="flex items-center gap-2 self-start rounded-full bg-tide-wash px-3.5 py-1.5 font-semibold text-tide-deep">
          <Glyph name="heart" />
          {e.invited_by} הזמין/ה אותך
        </p>
      )}
      <h1 className="font-display text-[1.9rem] leading-tight">{closed ? 'המפגש' : 'הרשמה למפגש'}</h1>
      <EventTicket event={e} highlight detailed />
      {closed ? (
        <ClosedState event={e} home={home} />
      ) : sources.isError ? (
        <ErrorBox error={errorMessage(sources.error)} onRetry={() => sources.refetch()} />
      ) : sources.isPending ? (
        <Skeleton lines={6} />
      ) : (
        <RegisterForm event={e} sources={sources.data} refCode={ref} utm={utm} onDone={setDone} />
      )}
    </div>
  );
}

function ClosedState({ event: e, home }: { event: PublicEvent; home: string }) {
  const [title, body] =
    e.status === 'cancelled'
      ? ['המפגש הזה בוטל', 'מצטערים על השינוי. נשמח לראות אותך באחד המפגשים הבאים.']
      : e.registration_open && e.is_full
        ? ['כל המקומות נתפסו', 'למפגש הזה אין רשימת המתנה. נשמח לראות אותך במפגש הבא.']
        : ['ההרשמה למפגש הזה נסגרה', 'אפשר להירשם לאחד המפגשים הבאים.'];
  return (
    <section className="rounded-[var(--radius-panel)] bg-paper px-5 py-6 text-center">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-muted">{body}</p>
      <ButtonLink to={home} className="mt-4">למפגשים הקרובים</ButtonLink>
    </section>
  );
}

function RegisterForm({ event, sources, refCode, utm, onDone }: {
  event: PublicEvent;
  sources: PublicSource[];
  refCode: string | null;
  utm: Record<string, string>;
  onDone: (r: RegisterResult) => void;
}) {
  // arriving through a friend's personal link: "a friend brought me" is already chosen
  const friendKey = refCode?.startsWith('f-') ? (sources.find((s) => s.is_friend)?.key ?? '') : '';
  const form = usePersonForm({ source: friendKey });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const waitlist = event.is_full && event.waitlist_enabled;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (busy || !form.check()) return;
    setBusy(true);
    try {
      const res = await registerFor({
        event: event.code,
        ...form.payload(sources),
        ref: refCode,
        utm: Object.keys(utm).length ? utm : undefined,
      });
      saveToken(res.event?.code ?? event.code, res.token);
      void qc.invalidateQueries({ queryKey: ['pub', 'events'] });
      onDone(res);
    } catch (err) {
      setBusy(false);
      if (form.serverError(err)) return;
      if (['registration_closed', 'event_cancelled', 'event_full'].includes(errorCode(err))) {
        void qc.invalidateQueries({ queryKey: ['pub', 'event', event.code] });
      }
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label="טופס הרשמה">
      {waitlist && (
        <Notice tone="warn" icon="alert">
          המפגש מלא כרגע. אפשר להצטרף לרשימת ההמתנה: אם יתפנה מקום, נחזור אליך. ההצטרפות לרשימה עוד לא מבטיחה מקום.
        </Notice>
      )}
      <p className="-mb-1 text-[0.95rem] text-muted">ארבעה פרטים ושאלה אחת, וזהו.</p>
      <PersonFields form={form} sources={sources} invitedBy={event.invited_by} />
      <ConsentFields form={form} />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" busy={busy} className="w-full">
        {waitlist ? 'הצטרפות לרשימת ההמתנה' : 'הרשמה'}
      </Button>
    </form>
  );
}

function Registered({ result: r, event }: { result: RegisterResult; event: PublicEvent }) {
  const name = r.first_name ? `${r.first_name}, ` : '';
  // while registration is open the invite points at this event; otherwise at the list of upcoming ones
  const invite = r.invite_code
    ? event.registration_open
      ? { url: registerUrl(event.code, r.invite_code), message: inviteMessage(event) }
      : { url: allEventsUrl(r.invite_code), message: inviteMessage(null) }
    : null;

  if (r.status === 'waitlisted' || r.status === 'already_waitlisted') {
    return (
      <div className="flex flex-col gap-5">
        <div className="pt-2 text-center">
          <WaitMark />
          <ResultTitle className="mt-4">{r.status === 'waitlisted' ? 'נכנסת לרשימת ההמתנה' : 'כבר ברשימת ההמתנה'}</ResultTitle>
          {r.waitlist_position != null && (
            <p className="mt-2 text-lg">
              המקום שלך בתור: <span className="num font-display text-2xl">{r.waitlist_position}</span>
            </p>
          )}
          <p className="mx-auto mt-2 max-w-sm text-ink-soft">
            {name}אם יתפנה מקום, נחזור אליך בוואטסאפ או בטלפון. עד אז ההרשמה עוד לא סופית.
          </p>
        </div>
        <EventTicket event={event} showStatus={false} />
        {r.token && <PersonalLink url={manageUrl(r.token)} token={r.token} waitlist />}
      </div>
    );
  }

  const again = r.status === 'already_registered';
  return (
    <div className="flex flex-col gap-5">
      <div className="pt-2 text-center">
        <SuccessMark />
        <ResultTitle className="mt-4">{again ? 'כבר נרשמת למפגש הזה' : 'נרשמת!'}</ResultTitle>
        <p className="mx-auto mt-2 max-w-sm text-lg text-ink-soft">
          {again ? `${name}ההרשמה שלך בתוקף, אין צורך להירשם שוב.` : `${name}שמרנו לך מקום. מחכים לך!`}
        </p>
        {again && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">צריך לבטל? אפשר דרך הקישור האישי שקיבלת כשנרשמת.</p>
        )}
      </div>
      <EventTicket event={event} showStatus={false}>
        <div className="mt-4">
          <CalendarButtons event={event} />
        </div>
      </EventTicket>
      {invite && <InviteBlock url={invite.url} message={invite.message} />}
      {r.token && <PersonalLink url={manageUrl(r.token)} token={r.token} />}
    </div>
  );
}
