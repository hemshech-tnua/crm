import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { PublicEvent } from '@/lib/types';
import { errorCode, errorMessage } from '@/lib/errors';
import { allEventsUrl, manageUrl, registerUrl } from '@/lib/links';
import { Button, ButtonLink, EmptyState, ErrorBox, Notice, Skeleton } from '@/ui/kit';
import { registerFor, usePublicEvent, usePublicSources, useRegistration, type PublicSource, type RegisterResult } from './api';
import { saveToken, savedRegistrations } from './device';
import { EventTicket } from './EventTicket';
import { DetailsButton, MeetingSheet, useDetailsSheet } from './MeetingDetails';
import { Glyph } from './marks';
import { trackingQuery } from './tracking';
import { ConsentFields, PersonFields, usePersonForm } from './PersonForm';
import { BeforeYouCome, CalendarButtons, ContactLine, InviteBlock, PayBlock, PersonalLink, type Payer, ResultTitle, SuccessMark, WaitMark, inviteMessage, usePageTitle } from './shared';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { isPriced } from '@/lib/money';
import { PayStep, paysFirst, useWatchExpired } from './PayStep';

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
  const [payer, setPayer] = useState<Payer | null>(null);
  // the payment of a pay-first registration arrived while this page was open
  const [paid, setPaid] = useState(false);
  const home = `/${trackingQuery(params)}`;
  const sheet = useDetailsSheet();
  usePageTitle(pageTitle(done, event.data));
  const shown = done?.event ?? event.data;
  // the details sheet sits over the form or the success screen, which keep their state underneath (?d=1)
  const details = shown ? <MeetingSheet event={shown} open={sheet.open} onClose={sheet.hide} /> : null;

  if (done && event.data) {
    const another = () => { setDone(null); setPayer(null); setPaid(false); window.scrollTo(0, 0); };
    return (
      <>
        {done.status === 'pending_payment' ? (
          <AwaitingPayment result={done} event={done.event ?? event.data} payer={payer} onPaid={(r) => { setPaid(true); setDone(r); }} />
        ) : (
          <Registered result={done} event={done.event ?? event.data} payer={payer} paid={paid} onAnother={another} onDetails={sheet.show} />
        )}
        {details}
      </>
    );
  }

  if (event.isPending) return <Skeleton lines={8} className="py-6" />;
  if (event.isError) {
    const code = errorCode(event.error);
    if (code === 'registration_not_open') {
      return (
        <EmptyState icon="calendar" title="ההרשמה עוד לא נפתחה" action={<ButtonLink to={home}>למפגשים הפתוחים עכשיו</ButtonLink>}>
          המפגש הזה עוד בהכנה. נסו שוב בקרוב, או עקבו אחרינו בקבוצות ובאינסטגרם.
        </EmptyState>
      );
    }
    return code === 'event_not_found' ? (
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
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div className="flex flex-col gap-5 lg:sticky lg:top-6">
        {e.invited_by && (
          <p className="flex items-center gap-2 self-start rounded-[var(--radius-control)] bg-ink px-3.5 py-1.5 font-semibold text-light">
            <Glyph name="heart" />
            הזמנה מ{e.invited_by}
          </p>
        )}
        <h1 className="font-display text-[2rem] leading-tight sm:text-title">{closed ? 'פרטי המפגש' : 'הרשמה למפגש'}</h1>
        <EventTicket event={e} highlight detailed showStatus="notable" />
        <DetailsButton event={e} onOpen={sheet.show} wide="always" className="-mt-3" />
      </div>
      <div className="lg:rounded-[var(--radius-panel)] lg:border lg:border-edge lg:bg-paper lg:p-8">
        {closed ? (
          <ClosedState event={e} home={home} />
        ) : sources.isError ? (
          <ErrorBox error={errorMessage(sources.error)} onRetry={() => sources.refetch()} />
        ) : sources.isPending ? (
          <Skeleton lines={6} />
        ) : (
          <RegisterForm event={e} sources={sources.data} refCode={ref} utm={utm} onDone={(r, who) => { setPayer(who); setDone(r); }} />
        )}
      </div>
      {details}
    </div>
  );
}

/** The browser tab's title: what this screen is, then the meeting ("הרשמה: מפגש שישי"). */
function pageTitle(done: RegisterResult | null, e: PublicEvent | undefined): string | null {
  if (!e) return null;
  if (done) {
    if (done.status === 'pending_payment') return `תשלום: ${e.title}`;
    if (done.status === 'waitlisted' || done.status === 'already_waitlisted') return `רשימת ההמתנה: ${e.title}`;
    return done.status === 'already_registered' ? `כבר נרשמת: ${e.title}` : `נרשמת: ${e.title}`;
  }
  const closed = e.status === 'cancelled' || !e.registration_open || (e.is_full && !e.waitlist_enabled);
  return closed ? e.title : `הרשמה: ${e.title}`;
}

function ClosedState({ event: e, home }: { event: PublicEvent; home: string }) {
  const [title, body] =
    e.status === 'cancelled'
      ? ['המפגש הזה בוטל', 'מצטערים על השינוי. נשמח לראות אתכם באחד המפגשים הבאים.']
      : e.registration_open && e.is_full
        ? ['כל המקומות נתפסו', 'למפגש הזה אין רשימת המתנה. נשמח לראות אתכם במפגש הבא.']
        : ['ההרשמה למפגש הזה נסגרה', 'אפשר להירשם לאחד המפגשים הבאים.'];
  return (
    <section className="rounded-[var(--radius-panel)] border border-edge bg-paper px-5 py-6 text-center lg:border-0 lg:p-0">
      <h2 className="text-heading font-bold">{title}</h2>
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
  onDone: (r: RegisterResult, payer: Payer) => void;
}) {
  // arriving through a friend's personal link: "a friend brought me" is already chosen
  const friendKey = refCode?.startsWith('f-') ? (sources.find((s) => s.is_friend)?.key ?? '') : '';
  // a channel link (e.g. ?ref=ig-bio) already says where they heard about us
  const linkKey = event.ref_source && sources.some((s) => s.key === event.ref_source) ? event.ref_source : '';
  const form = usePersonForm({ source: friendKey || linkKey });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const qc = useQueryClient();
  const waitlist = event.is_full && event.waitlist_enabled;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (busy || !form.check()) return;
    setBusy(true);
    try {
      const person = form.payload(sources);
      const res = await registerFor({
        event: event.code,
        ...person,
        // asking again from this phone while it is unpaid keeps the same personal link
        token: paysFirst(event) ? ownSaved(event.code, person.full_name.trim().split(/\s+/)[0] ?? null) : null,
        ref: refCode,
        utm: Object.keys(utm).length ? utm : undefined,
      });
      if (res.status === 'phone_in_use') {
        setBusy(false);
        setError(<>מספר הטלפון הזה כבר רשום למפגש בשם אחר. אם הטלפון משותף, אפשר להירשם עם מספר נייד אחר או לכתוב לנו: <ContactLine inline /></>);
        return;
      }
      saveToken(res.event?.code ?? event.code, res.token, res.first_name);
      void qc.invalidateQueries({ queryKey: ['pub', 'events'] });
      onDone(res, { name: person.full_name, phone: person.phone });
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
          המפגש מלא כרגע. אפשר להצטרף לרשימת ההמתנה, ואם יתפנה מקום נחזור אליכם. ההצטרפות לרשימה עוד לא מבטיחה מקום.
        </Notice>
      )}
      {isPriced(event.price) && (
        <p className="flex flex-wrap items-baseline gap-x-2 rounded-[var(--radius-control)] border-s-[3px] border-ink bg-mist px-3.5 py-2.5">
          {/* the ticket above already shows the price and the team's note: here only how paying works */}
          <span className="font-bold">תשלום</span>
          <span className="text-small text-ink-soft">
            {waitlist ? 'משלמים רק אם מתפנה מקום.' : event.payment_url ? 'משלמים בכרטיס אשראי, מיד אחרי מילוי הפרטים.' : 'משלמים בכניסה למפגש.'}
          </span>
        </p>
      )}
      <p className="-mb-1 text-body text-ink-soft">רק ארבעה פרטים ושאלה אחת.</p>
      <PersonFields form={form} sources={sources} invitedBy={event.invited_by} />
      <ConsentFields form={form} />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" cta busy={busy} className="w-full">
        {waitlist ? 'להרשמה לרשימת ההמתנה' : paysFirst(event) ? 'להרשמה ולתשלום' : 'להרשמה'}
      </Button>
      {!waitlist && (
        <p className="-mt-2 text-center text-small text-balance text-muted">
          {paysFirst(event)
            ? 'המקום נשמר רק אחרי התשלום.'
            : 'אחרי ההרשמה יופיע כאן קישור אישי. דרכו אפשר לבטל אם משהו משתנה.'}
        </p>
      )}
    </form>
  );
}

function ownSaved(code: string, firstName: string | null | undefined): string | null {
  const saved = savedRegistrations(code);
  if (firstName) return saved.find((x) => x.name === firstName)?.token ?? null;
  return saved.length === 1 ? saved[0].token : null;
}

/**
 * A pay-first registration while the payment is awaited: the pay step, checked every few seconds. When the payment
 * arrives it hands the new status up, and the page shows "נרשמת!" (or the waitlist, when the places ran out meanwhile).
 */
function AwaitingPayment({ result, event, payer, onPaid }: { result: RegisterResult; event: PublicEvent; payer: Payer | null; onPaid: (r: RegisterResult) => void }) {
  const [since] = useState(() => Date.now());
  const reg = useRegistration(result.token ?? null, since);
  const expired = useWatchExpired(since);
  const info = reg.data;
  useEffect(() => {
    if (info?.status === 'registered' || info?.status === 'waitlisted') {
      onPaid({ ...result, status: info.status, waitlist_position: info.waitlist_position, event: info.event });
    }
  }, [info, result, onPaid]);
  return (
    <PayStep
      event={info?.event ?? event}
      payer={payer ?? (info?.full_name && info.phone ? { name: info.full_name, phone: info.phone } : null)}
      token={result.token ?? null}
      firstName={result.first_name}
      expired={expired}
      onCheck={async () => (await reg.refetch()).data?.status === 'pending_payment'}
    />
  );
}

function Registered({ result: r, event, payer, paid = false, onAnother, onDetails }: {
  result: RegisterResult; event: PublicEvent; payer: Payer | null;
  /** the payment of a pay-first registration was just confirmed */
  paid?: boolean;
  onAnother: () => void; onDetails: () => void;
}) {
  const another = (
    <button type="button" onClick={onAnother} className="min-h-11 self-center px-3 font-semibold text-balance text-tide underline underline-offset-4">
      הרשמה של עוד מישהו מהטלפון הזה
    </button>
  );
  const name = r.first_name ? `${r.first_name}, ` : '';
  // while registration is open the invite points at this event; otherwise at the list of upcoming ones
  const invite = r.invite_code
    ? event.registration_open
      ? { url: registerUrl(event.code, r.invite_code), message: inviteMessage(event) }
      : { url: allEventsUrl(r.invite_code), message: inviteMessage(null) }
    : null;

  if (r.status === 'waitlisted' || r.status === 'already_waitlisted') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
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
        {paid && (
          <Notice icon="check">
            התשלום התקבל, אבל בינתיים כל המקומות נתפסו. הצוות יחזור אליך בהקדם, כדי למצוא מקום או להחזיר את&nbsp;התשלום.
          </Notice>
        )}
        <EventTicket event={event} highlight showStatus={false} />
        {r.token && <PersonalLink url={manageUrl(r.token)} token={r.token} waitlist />}
        {another}
      </div>
    );
  }

  const again = r.status === 'already_registered';
  // registered before from this phone: their own page is one tap away (the server does not send the link again).
  // A shared phone may hold several people's registrations, so only the one with this first name is offered.
  const mine = again && !r.token ? ownSaved(event.code, r.first_name) : null;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <div className="pt-2 text-center">
        <SuccessMark />
        <ResultTitle className="mt-4">{again ? 'כבר נרשמת למפגש הזה' : 'נרשמת!'}</ResultTitle>
        <p className="mx-auto mt-2 max-w-sm text-lg text-balance text-ink-soft">
          {again ? `${name}ההרשמה שלך בתוקף. לא צריך להירשם שוב.` : (
            <>
              {name}שמרנו לך מקום.{' '}
              <span className="block">
                נתראה ב<span className="whitespace-nowrap">{fmtDayLong(event.starts_at)}</span> ב־<span className="num whitespace-nowrap">{fmtTime(event.starts_at)}</span>.
              </span>
            </>
          )}
        </p>
        {again && !r.token && (
          mine ? (
            <ButtonLink to={`/m/${mine}`} variant="secondary" className="mt-4">לעמוד ההרשמה שלי</ButtonLink>
          ) : (
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">צריך לבטל? אפשר בקישור האישי שקיבלת בהרשמה. אין לך אותו? <ContactLine inline /></p>
          )
        )}
      </div>
      {paid ? (
        <Notice icon="check">התשלום התקבל. תודה!</Notice>
      ) : (
        !again && <PayBlock event={event} payer={payer} />
      )}
      <EventTicket event={event} highlight showStatus={false}>
        <p className="mt-4 text-[0.9375rem] font-medium text-pretty text-ink">
          כדאי להכניס ליומן עכשיו, כדי ש{event.type === 'friday' ? 'השישי הזה' : 'המפגש'} לא ייבלע&nbsp;בשבוע.
        </p>
        <div className="mt-3">
          <CalendarButtons event={event} />
        </div>
        <DetailsButton event={event} onOpen={onDetails} className="mt-2" />
      </EventTicket>
      <BeforeYouCome event={event} />
      {r.token && <PersonalLink url={manageUrl(r.token)} token={r.token} />}
      {invite && (
        <InviteBlock
          url={invite.url}
          message={invite.message}
          title="באים ביחד?"
          lead={<>
            קל יותר להגיע בפעם הראשונה עם מישהו&nbsp;מוכר.
            <span className="block">שלחו את קישור ההזמנה שלכם לחבר או חברה&nbsp;מהשירות.</span>
          </>}
        />
      )}
      {another}
    </div>
  );
}
