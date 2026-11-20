import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { errorCode, errorMessage } from '@/lib/errors';
import { allEventsUrl, registerUrl } from '@/lib/links';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, Notice, Skeleton, Textarea } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { cancelRegistration, useFeedbackContext, useRegistration, type RegistrationInfo } from './api';
import { forgetToken, saveToken } from './device';
import { EventTicket } from './EventTicket';
import { FeedbackForm } from './FeedbackForm';
import { Block, CalendarButtons, ContactLine, InviteBlock, PayBlock, inviteMessage, usePageTitle } from './shared';
import { isPriced } from '@/lib/money';
import { DetailsLink } from './MeetingDetails';
import { PayStep, useWatchExpired } from './PayStep';

/** #/m/:token — the participant's own registration, from the personal link they got when registering. */
export function ManagePage() {
  const { token = '' } = useParams();
  // a pending payment is watched: the page turns into the registration by itself once the payment arrives
  const [since] = useState(() => Date.now());
  const reg = useRegistration(token, since);
  const expired = useWatchExpired(since);
  // the payment arrived while this page was open: say so on the registration
  const [sawPending, setSawPending] = useState(false);
  if (reg.data?.status === 'pending_payment' && !sawPending) setSawPending(true);
  usePageTitle(reg.data?.status === 'pending_payment' ? 'תשלום ההרשמה' : 'ההרשמה שלי');

  // keep the token on this phone so check-in at the door is one tap (no name or phone is stored)
  const code = reg.data?.event.code;
  const status = reg.data?.status;
  const firstName = reg.data?.first_name ?? null;
  useEffect(() => {
    if (!code || !status) return;
    if (status === 'cancelled') {
      forgetToken(code, token);
    } else {
      saveToken(code, token, firstName);
    }
  }, [code, status, token, firstName]);

  if (reg.isPending) return <Skeleton lines={8} className="py-6" />;
  if (reg.isError) {
    return errorCode(reg.error) === 'token_invalid' ? (
      <EmptyState icon="link" title="הקישור האישי לא תקין" action={<ButtonLink to="/">למפגשים הקרובים</ButtonLink>}>
        ייתכן שהקישור הועתק חלקית, או שנרשמת מחדש ונוצר קישור חדש. אם צריך עזרה: <ContactLine inline />
      </EmptyState>
    ) : (
      <ErrorBox error={errorMessage(reg.error)} onRetry={() => reg.refetch()} />
    );
  }

  const r = reg.data;
  const e = r.event;
  if (r.status === 'pending_payment' && e.status !== 'cancelled' && e.payment_url && Number(e.price ?? 0) > 0
      && new Date(e.starts_at).getTime() > Date.now()) {
    return (
      <PayStep
        event={e}
        payer={r.full_name && r.phone ? { name: r.full_name, phone: r.phone } : null}
        token={token}
        firstName={r.first_name}
        expired={expired}
        showLink={false}
        onCheck={async () => (await reg.refetch()).data?.status === 'pending_payment'}
      />
    );
  }
  return <Manage key={token} info={r} token={token} justPaid={sawPending && r.payment_status === 'paid'} />;
}

function statusLine(r: RegistrationInfo): { badge: ReactNode; text: string } {
  const e = r.event;
  if (e.status === 'cancelled') return { badge: <Badge tone="bad">המפגש בוטל</Badge>, text: 'מצטערים על השינוי. נשמח לראות אותך באחד המפגשים הבאים.' };
  if (r.status === 'cancelled') {
    return {
      badge: <Badge>ההרשמה בוטלה</Badge>,
      text: e.registration_open ? 'התחרטת? אפשר להירשם שוב כל עוד יש מקום.' : 'תודה שעדכנת. נשמח לראות אותך במפגש הבא.',
    };
  }
  if (r.status === 'pending_payment') {
    return { badge: <Badge>ההרשמה לא הושלמה</Badge>, text: 'התשלום לא התקבל, ולכן ההרשמה לא הושלמה.' };
  }
  if (r.status === 'waitlisted' && r.payment_status === 'paid') {
    return {
      badge: <Badge tone="warn">ברשימת ההמתנה{r.waitlist_position != null && <> · מקום <span className="num">{r.waitlist_position}</span></>}</Badge>,
      text: 'התשלום התקבל, אבל בינתיים כל המקומות נתפסו. הצוות יחזור אליך בהקדם, כדי למצוא מקום או להחזיר את התשלום.',
    };
  }
  if (r.status === 'waitlisted') {
    return {
      badge: <Badge tone="warn">ברשימת ההמתנה{r.waitlist_position != null && <> · מקום <span className="num">{r.waitlist_position}</span></>}</Badge>,
      text: 'אם יתפנה מקום, נחזור אליך בוואטסאפ או בטלפון. עד אז ההרשמה עוד לא סופית.',
    };
  }
  if (r.attendance === 'attended') return { badge: <Badge tone="good" icon="check">הגעת</Badge>, text: 'תודה שבאת! היה כיף לראות אותך.' };
  if (r.attendance === 'no_show') return { badge: <Badge>לא הגעת הפעם</Badge>, text: 'נשמח לראות אותך במפגש הבא.' };
  if (new Date(e.starts_at).getTime() <= Date.now()) return { badge: <Badge tone="good">נרשמת</Badge>, text: 'המפגש כבר התחיל.' };
  return { badge: <Badge tone="good" icon="check">נרשמת</Badge>, text: 'ההרשמה שלך בתוקף. נתראה במפגש.' };
}

function Manage({ info: r, token, justPaid = false }: { info: RegistrationInfo; token: string; justPaid?: boolean }) {
  const e = r.event;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const reason = useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const line = statusLine(r);
  const upcoming = new Date(e.starts_at).getTime() > Date.now();
  // a place, or a place in the queue (a registration that was never paid holds neither)
  const active = (r.status === 'registered' || r.status === 'waitlisted') && e.status !== 'cancelled';
  const waitlisted = r.status === 'waitlisted';
  // the fee is asked only of a registered place (a waitlisted one pays if a place opens up)
  const priced = isPriced(e.price) && active && r.status === 'registered';
  const unpaid = priced && r.payment_status === 'pending' && r.attendance !== 'no_show';
  const paid = priced && r.payment_status === 'paid';

  const cancel = async () => {
    setError(null);
    reason.current = '';
    const ok = await confirm({
      title: waitlisted ? 'לצאת מרשימת ההמתנה?' : 'לבטל את ההרשמה?',
      body: (
        <div className="flex flex-col gap-4">
          <p>{waitlisted ? 'המקום שלך בתור יעבור לבאים אחריך.' : 'המקום שלך יתפנה למי שמחכה. אם בכל זאת יסתדר, אפשר להירשם שוב כל עוד יש מקום.'}</p>
          <Textarea
            label="רוצה לספר לנו למה? (לא חובה)"
            maxLength={300}
            rows={2}
            defaultValue=""
            onChange={(x) => { reason.current = x.target.value; }}
          />
        </div>
      ),
      confirm: waitlisted ? 'כן, לצאת מהרשימה' : 'כן, לבטל את ההרשמה',
      cancel: 'השארת ההרשמה',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await cancelRegistration(token, reason.current.trim() || null);
      forgetToken(e.code, token);
      toast.success(waitlisted ? 'יצאת מרשימת ההמתנה. תודה שעדכנת!' : 'ההרשמה בוטלה. תודה שעדכנת!');
      await qc.invalidateQueries({ queryKey: ['pub'] });
    } catch (err) {
      setError(errorMessage(err));
      void qc.invalidateQueries({ queryKey: ['pub', 'registration', token] });
    } finally {
      setBusy(false);
    }
  };

  const invite = r.invite_code && active
    ? e.registration_open
      ? { url: registerUrl(e.code, r.invite_code), message: inviteMessage(e) }
      : { url: allEventsUrl(r.invite_code), message: inviteMessage(null) }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        {r.first_name && <p className="text-small font-semibold text-muted">העמוד האישי שלך למפגש</p>}
        <h1 className="font-display text-title">{r.first_name ? `היי ${r.first_name}` : 'ההרשמה שלך'}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {line.badge}
          {unpaid && <Badge tone="warn" icon="alert">עוד לא שולם</Badge>}
          {paid && <Badge tone="good" icon="check">שולם, תודה</Badge>}
        </div>
        <p className="mt-2 text-[1.05rem] text-ink-soft">{line.text}</p>
        {justPaid && r.status === 'registered' && (
          <div className="mt-3"><Notice icon="check">התשלום התקבל. נרשמת!</Notice></div>
        )}
        {r.status === 'cancelled' && e.registration_open && e.status !== 'cancelled' && (
          <ButtonLink to={`/r/${e.code}`} className="mt-3">להירשם שוב</ButtonLink>
        )}
      </div>

      {unpaid && <PayBlock event={e} />}

      <EventTicket event={e} highlight={active && upcoming} showStatus={false}>
        {active && upcoming && r.status === 'registered' && (
          <div className="mt-4"><CalendarButtons event={e} /></div>
        )}
        {e.status !== 'cancelled' && upcoming && <DetailsLink event={e} className="mt-2" />}
      </EventTicket>

      {active && upcoming && r.status === 'registered' && (
        <Block title="בכניסה למפגש">
          <p className="text-[0.9375rem] text-ink-soft">
            בכניסה סורקים את הברקוד ולוחצים ״הגעתי״. לא צריך להקליד כלום: הטלפון הזה כבר זוכר את ההרשמה&nbsp;שלך.
          </p>
        </Block>
      )}

      {r.feedback_open && <ManageFeedback token={token} given={r.feedback_given} />}

      {invite && <InviteBlock url={invite.url} message={invite.message} />}

      {r.can_cancel && active && (
        <Block title={waitlisted ? 'כבר לא צריך את המקום בתור?' : 'לא מסתדר לך להגיע?'}>
          <p className="text-[0.9375rem] text-ink-soft">
            {waitlisted ? 'אפשר לצאת מרשימת ההמתנה בכל רגע.' : 'ביטול מראש מפנה את המקום שלך למי שמחכה.'}
          </p>
          {error && <div className="mt-3"><ErrorBox error={error} /></div>}
          <Button variant="danger" className="mt-3" busy={busy} onClick={cancel}>
            {waitlisted ? 'יציאה מרשימת ההמתנה' : 'ביטול ההרשמה'}
          </Button>
        </Block>
      )}
    </div>
  );
}

function ManageFeedback({ token, given }: { token: string; given: boolean }) {
  const ctx = useFeedbackContext({ token });
  const qc = useQueryClient();
  const [sent, setSent] = useState(false);
  const [editing, setEditing] = useState(false);

  if (ctx.isPending) return <Skeleton lines={4} />;
  if (ctx.isError) return <ErrorBox error={errorMessage(ctx.error)} onRetry={() => ctx.refetch()} />;
  if (ctx.data.state !== 'open') return null;

  if ((sent || given) && !editing) {
    return (
      <Block title="המשוב שלך">
        <p className="text-[0.9375rem] text-ink-soft">{sent ? 'המשוב התקבל. תודה!' : 'כבר שלחת משוב על המפגש הזה. תודה!'}</p>
        <Button variant="ghost" className="mt-2 -ms-3" icon="edit" onClick={() => setEditing(true)}>עדכון המשוב</Button>
      </Block>
    );
  }

  return (
    <Block title="משוב על המפגש">
      <p className="mb-4 text-[0.9375rem] text-ink-soft">דקה אחת של משוב עוזרת לנו לבנות את המפגש הבא.</p>
      <FeedbackForm
        ctx={ctx.data}
        token={token}
        submitLabel={ctx.data.existing ? 'עדכון המשוב' : 'שליחת המשוב'}
        onDone={() => {
          setSent(true);
          setEditing(false);
          void qc.invalidateQueries({ queryKey: ['pub', 'feedback'] });
          void qc.invalidateQueries({ queryKey: ['pub', 'registration', token] });
        }}
      />
    </Block>
  );
}
