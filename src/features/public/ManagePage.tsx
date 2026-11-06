import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { errorCode, errorMessage } from '@/lib/errors';
import { allEventsUrl, registerUrl } from '@/lib/links';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, Skeleton, Textarea } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { cancelRegistration, useFeedbackContext, useRegistration, type RegistrationInfo } from './api';
import { forgetToken, saveToken, savedToken } from './device';
import { EventTicket } from './EventTicket';
import { FeedbackForm } from './FeedbackForm';
import { Block, CalendarButtons, InviteBlock, inviteMessage } from './shared';

/** #/m/:token — the participant's own registration, from the personal link they got when registering. */
export function ManagePage() {
  const { token = '' } = useParams();
  const reg = useRegistration(token);

  // keep the token on this phone so check-in at the door is one tap (no name or phone is stored)
  const code = reg.data?.event.code;
  const status = reg.data?.status;
  useEffect(() => {
    if (!code || !status) return;
    if (status === 'cancelled') {
      if (savedToken(code) === token) forgetToken(code);
    } else {
      saveToken(code, token);
    }
  }, [code, status, token]);

  if (reg.isPending) return <Skeleton lines={8} className="py-6" />;
  if (reg.isError) {
    return errorCode(reg.error) === 'token_invalid' ? (
      <EmptyState icon="link" title="הקישור האישי לא תקין" action={<ButtonLink to="/">למפגשים הקרובים</ButtonLink>}>
        ייתכן שהקישור הועתק חלקית, או שנרשמת מחדש ונוצר קישור חדש. אם צריך עזרה, אפשר לפנות לצוות העמותה.
      </EmptyState>
    ) : (
      <ErrorBox error={errorMessage(reg.error)} onRetry={() => reg.refetch()} />
    );
  }

  return <Manage info={reg.data} token={token} />;
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
  if (r.status === 'waitlisted') {
    return {
      badge: <Badge tone="warn">ברשימת ההמתנה{r.waitlist_position != null && <> · מקום <span className="num">{r.waitlist_position}</span></>}</Badge>,
      text: 'אם יתפנה מקום, נחזור אליך בוואטסאפ או בטלפון. עד אז ההרשמה עוד לא סופית.',
    };
  }
  if (r.attendance === 'attended') return { badge: <Badge tone="good" icon="check">הגעת</Badge>, text: 'תודה שבאת! היה כיף לראות אותך.' };
  if (r.attendance === 'no_show') return { badge: <Badge>לא הגעת הפעם</Badge>, text: 'נשמח לראות אותך במפגש הבא.' };
  if (new Date(e.starts_at).getTime() <= Date.now()) return { badge: <Badge tone="good">רשום/ה</Badge>, text: 'המפגש כבר התחיל.' };
  return { badge: <Badge tone="good" icon="check">רשום/ה</Badge>, text: 'ההרשמה שלך בתוקף. מחכים לך!' };
}

function Manage({ info: r, token }: { info: RegistrationInfo; token: string }) {
  const e = r.event;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const reason = useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const line = statusLine(r);
  const upcoming = new Date(e.starts_at).getTime() > Date.now();
  const active = r.status !== 'cancelled' && e.status !== 'cancelled';
  const waitlisted = r.status === 'waitlisted';

  const cancel = async () => {
    setError(null);
    reason.current = '';
    const ok = await confirm({
      title: waitlisted ? 'לצאת מרשימת ההמתנה?' : 'לבטל את ההרשמה?',
      body: (
        <div className="flex flex-col gap-4">
          <p>{waitlisted ? 'המקום שלך בתור יעבור לבאים אחריך.' : 'המקום יתפנה למי שמחכה. אם תתחרט/י, אפשר להירשם שוב כל עוד יש מקום.'}</p>
          <Textarea
            label="רוצה לספר לנו למה? (לא חובה)"
            maxLength={300}
            rows={2}
            defaultValue=""
            onChange={(x) => { reason.current = x.target.value; }}
          />
        </div>
      ),
      confirm: waitlisted ? 'כן, לצאת מהרשימה' : 'כן, לבטל',
      cancel: 'השארת ההרשמה',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await cancelRegistration(token, reason.current.trim() || null);
      if (savedToken(e.code) === token) forgetToken(e.code);
      toast.success(waitlisted ? 'יצאת מרשימת ההמתנה. תודה שעדכנת!' : 'ההרשמה בוטלה. תודה שעדכנת!');
      await qc.invalidateQueries({ queryKey: ['pub'] });
    } catch (err) {
      setError(errorMessage(err));
      void qc.invalidateQueries({ queryKey: ['pub', 'registration', token] });
    } finally {
      setBusy(false);
    }
  };

  const invite = r.invite_code && e.status !== 'cancelled'
    ? e.registration_open
      ? { url: registerUrl(e.code, r.invite_code), message: inviteMessage(e) }
      : { url: allEventsUrl(r.invite_code), message: inviteMessage(null) }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[1.9rem] leading-tight">{r.first_name ? `היי ${r.first_name}` : 'ההרשמה שלך'}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">{line.badge}</div>
        <p className="mt-2 text-[1.05rem] text-ink-soft">{line.text}</p>
        {r.status === 'cancelled' && e.registration_open && e.status !== 'cancelled' && (
          <ButtonLink to={`/r/${e.code}`} className="mt-3">להירשם שוב</ButtonLink>
        )}
      </div>

      <EventTicket event={e} highlight={active && upcoming} showStatus={false}>
        {active && upcoming && r.status === 'registered' && (
          <div className="mt-4"><CalendarButtons event={e} /></div>
        )}
      </EventTicket>

      {r.feedback_open && <ManageFeedback token={token} given={r.feedback_given} />}

      {invite && <InviteBlock url={invite.url} message={invite.message} />}

      {r.can_cancel && r.status !== 'cancelled' && (
        <Block title={waitlisted ? 'כבר לא צריך את המקום בתור?' : 'לא מסתדר לך להגיע?'}>
          <p className="text-[0.95rem] text-ink-soft">
            {waitlisted ? 'אפשר לצאת מרשימת ההמתנה בלחיצה.' : 'עדכון מראש מפנה את המקום למי שמחכה. זה עוזר לכולם.'}
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
        <p className="text-[0.95rem] text-ink-soft">{sent ? 'תודה! המשוב התקבל.' : 'כבר שלחת משוב על המפגש הזה. תודה!'}</p>
        <Button variant="ghost" className="mt-2 -ms-3" icon="edit" onClick={() => setEditing(true)}>עדכון המשוב</Button>
      </Block>
    );
  }

  return (
    <Block title="איך היה המפגש?">
      <p className="mb-4 text-[0.95rem] text-ink-soft">דקה אחת של משוב עוזרת לנו לבנות את המפגש הבא.</p>
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
