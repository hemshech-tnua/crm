import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { fmtDayLong, fmtTime, relativeDays } from '@/lib/dates';
import { errorCode, errorMessage } from '@/lib/errors';
import { Button, ButtonLink, EmptyState, ErrorBox, Input, Notice, Skeleton } from '@/ui/kit';
import { checkIn, usePublicSources, useCheckinInfo, walkIn, type CheckinInfo, type CheckinResult, type PublicSource } from './api';
import { forgetToken, saveToken, savedToken } from './device';
import { EventTicket } from './EventTicket';
import { timeRange } from './eventText';
import { ConsentFields, PersonFields, phoneError, usePersonForm } from './PersonForm';
import { ResultTitle, SuccessMark } from './shared';

/** #/c/:checkinCode — scanned from the QR sign at the entrance, on the participant's own phone. */
export function CheckinPage() {
  const { code = '' } = useParams();
  return <Checkin key={code} code={code} />;
}

function Checkin({ code }: { code: string }) {
  const info = useCheckinInfo(code);
  const [welcome, setWelcome] = useState<CheckinResult | null>(null);

  if (welcome) return <Welcome result={welcome} fallback={info.data?.event ?? null} />;
  if (info.isPending) return <Skeleton lines={6} className="py-6" />;
  if (info.isError) {
    return errorCode(info.error) === 'checkin_not_found' ? (
      <EmptyState icon="qr" title="קוד הכניסה לא תקין" action={<ButtonLink to="/" variant="secondary">למפגשים הקרובים</ButtonLink>}>
        סרקו שוב את הברקוד שבכניסה, או גשו לצוות בכניסה ונסמן אתכם שם.
      </EmptyState>
    ) : (
      <ErrorBox error={errorMessage(info.error)} onRetry={() => info.refetch()} />
    );
  }

  const i = info.data;
  if (i.window === 'not_open') return <NotOpen info={i} onRefresh={() => info.refetch()} refreshing={info.isFetching} />;
  if (i.window !== 'open') return <NoCheckin info={i} />;
  return <CheckinFlow code={code} event={i.event} onWelcome={setWelcome} onWindowChanged={() => info.refetch()} />;
}

function EventLine({ event }: { event: PublicEvent }) {
  return (
    <p className="text-[1.05rem] text-ink-soft">
      {event.title} · <span className="num">{timeRange(event)}</span>
      {event.location && <> · {event.location}</>}
    </p>
  );
}

type Mode = 'token' | 'phone' | 'walkin';

function CheckinFlow({ code, event, onWelcome, onWindowChanged }: {
  code: string;
  event: PublicEvent;
  onWelcome: (r: CheckinResult) => void;
  onWindowChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>(() => (savedToken(event.code) ? 'token' : 'phone'));
  const [switched, setSwitched] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (m: Mode) => {
    setError(null);
    setSwitched(true);
    setMode(m);
  };

  const handle = (res: CheckinResult) => {
    switch (res.result) {
      case 'checked_in':
      case 'already_checked_in':
        saveToken(res.event?.code ?? event.code, res.token);
        onWelcome(res);
        return;
      case 'not_registered':
        go('walkin');
        return;
      case 'token_invalid':
        forgetToken(event.code);
        setNotice('לא הצלחנו לזהות את ההרשמה מהטלפון הזה. אפשר להיכנס עם מספר הטלפון.');
        go('phone');
        return;
      default:
        // window_not_open / window_closed / window_unavailable: show the current state of the event
        onWindowChanged();
    }
  };

  const run = async (p: { token?: string; phone?: string }) => {
    setError(null);
    setBusy(true);
    try {
      handle(await checkIn({ code, ...p }));
    } catch (err) {
      const c = errorCode(err);
      if (c === 'invalid_phone') setPhoneErr(errorMessage(err));
      else if (c === 'checkin_not_found') onWindowChanged();
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const byPhone = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const err = phoneError(phone);
    setPhoneErr(err);
    if (err) {
      document.getElementById('checkin-phone')?.focus();
      return;
    }
    void run({ phone: phone.trim() });
  };

  if (mode === 'walkin') {
    return (
      <Walkin code={code} phone={phone} onBack={() => go('phone')} onResult={handle} />
    );
  }

  const token = savedToken(event.code);
  if (mode === 'token' && token) {
    return (
      <div className="flex flex-col gap-5 pt-1">
        <div>
          <h1 className="font-display text-[2.1rem] leading-tight">צ׳ק־אין</h1>
          <EventLine event={event} />
        </div>
        <p className="text-lg">נרשמת מהטלפון הזה, אז מספיקה לחיצה אחת.</p>
        {error && <ErrorBox error={error} />}
        <Button
          size="lg"
          busy={busy}
          onClick={() => run({ token })}
          className="h-24! w-full rounded-[var(--radius-panel)]! font-display text-[2.2rem]! font-normal!"
        >
          הגעתי
        </Button>
        <button type="button" onClick={() => go('phone')} className="min-h-11 self-center px-3 text-[1.05rem] font-semibold text-tide underline underline-offset-4">
          זה לא הטלפון שלי? צ׳ק־אין עם מספר טלפון
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={byPhone} noValidate className="flex flex-col gap-5 pt-1" aria-label="צ׳ק־אין עם מספר טלפון">
      <div>
        <h1 className="font-display text-[2.1rem] leading-tight">צ׳ק־אין</h1>
        <EventLine event={event} />
      </div>
      {notice && <Notice tone="warn" icon="alert">{notice}</Notice>}
      <Input
        id="checkin-phone"
        label={<span className="text-lg">מספר הטלפון שלך</span>}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="go"
        ltr
        maxLength={20}
        placeholder="050-1234567"
        autoFocus={switched}
        className="num h-16! text-2xl tracking-wide"
        value={phone}
        onChange={(e) => { setPhone(e.target.value); setPhoneErr(undefined); }}
        error={phoneErr}
      />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" busy={busy} className="h-16! w-full text-xl!">צ׳ק־אין</Button>
      <p className="text-center text-[0.95rem] text-muted">לא נרשמת מראש? גם בסדר. מקלידים טלפון וממשיכים משם.</p>
    </form>
  );
}

function Walkin({ code, phone, onBack, onResult }: {
  code: string;
  phone: string;
  onBack: () => void;
  onResult: (r: CheckinResult) => void;
}) {
  const sources = usePublicSources();
  return (
    <div className="flex flex-col gap-5 pt-1">
      <div>
        <h1 className="font-display text-[1.9rem] leading-tight">ברוכים הבאים!</h1>
        <p className="mt-1 text-lg text-ink-soft">לא מצאנו הרשמה עם המספר הזה. אין בעיה: ממלאים כמה פרטים ונכנסים.</p>
      </div>
      {sources.isPending ? (
        <Skeleton lines={6} />
      ) : sources.isError ? (
        <ErrorBox error={errorMessage(sources.error)} onRetry={() => sources.refetch()} />
      ) : (
        <WalkinForm code={code} phone={phone} sources={sources.data} onResult={onResult} />
      )}
      <button type="button" onClick={onBack} className="min-h-11 self-center px-3 font-semibold text-tide underline underline-offset-4">
        טעיתי במספר, חזרה
      </button>
    </div>
  );
}

function WalkinForm({ code, phone, sources, onResult }: {
  code: string;
  phone: string;
  sources: PublicSource[];
  onResult: (r: CheckinResult) => void;
}) {
  const form = usePersonForm({ phone });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (busy || !form.check()) return;
    setBusy(true);
    try {
      onResult(await walkIn({ code, ...form.payload(sources) }));
    } catch (err) {
      if (!form.serverError(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label="הרשמה במקום">
      <PersonFields form={form} sources={sources} big />
      <ConsentFields form={form} />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" busy={busy} className="h-16! w-full text-xl!">נרשמים ונכנסים</Button>
    </form>
  );
}

const MILESTONES: Record<number, string> = { 5: 'זה השישי החמישי שלך!', 10: 'זה השישי העשירי שלך!' };

function Welcome({ result: r, fallback }: { result: CheckinResult; fallback: PublicEvent | null }) {
  const event = r.event ?? fallback;
  const milestone = event?.type === 'friday' ? MILESTONES[r.friday_count ?? 0] : undefined;
  const firstTime = r.result === 'checked_in' && r.attended_count === 1;
  return (
    <div className="flex flex-col items-center gap-4 pt-6 text-center">
      <SuccessMark size="lg" />
      <ResultTitle size="xl" className="mt-2">
        {r.first_name ? (
          <>
            <span className="block text-[2rem] sm:text-[2.25rem]">ברוך/ה הבא/ה,</span>{' '}
            <span className="block text-[3.25rem] leading-none sm:text-[3.75rem]">{r.first_name}!</span>
          </>
        ) : (
          'ברוך/ה הבא/ה!'
        )}
      </ResultTitle>
      <p className="text-xl text-ink-soft">
        {r.result === 'already_checked_in' ? 'כבר עשית צ׳ק־אין. הכול מסודר.' : 'הצ׳ק־אין נקלט. שיהיה מפגש מעולה!'}
      </p>
      {milestone && (
        <p className="rounded-full bg-light-wash px-5 py-2.5 font-display text-[1.4rem] text-ink">{milestone}</p>
      )}
      {!milestone && firstTime && <p className="text-lg font-semibold">פעם ראשונה איתנו? כיף שבאת!</p>}
      {r.photo_opt_out && (
        <div className="mt-2 w-full text-start">
          <Notice icon="noCamera">רשמנו שאת/ה מעדיף/ה לא להופיע בתמונות. הצוות בכניסה רואה את זה.</Notice>
        </div>
      )}
    </div>
  );
}

function NotOpen({ info, onRefresh, refreshing }: { info: CheckinInfo; onRefresh: () => void; refreshing: boolean }) {
  const rel = relativeDays(info.opens_at);
  const when = rel === 'היום' || rel === 'מחר' ? rel : `ב${fmtDayLong(info.opens_at)}`;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-[1.9rem] leading-tight">הצ׳ק־אין עוד לא נפתח</h1>
      <EventTicket event={info.event} showStatus={false} />
      <section className="rounded-[var(--radius-panel)] bg-paper px-5 py-6 text-center">
        <p className="text-lg">
          הצ׳ק־אין ייפתח {when} בשעה <span className="num font-bold">{fmtTime(info.opens_at)}</span>.
        </p>
        <p className="mt-1 text-muted">העמוד יתעדכן לבד כשייפתח.</p>
        <Button variant="secondary" className="mt-4" busy={refreshing} onClick={onRefresh}>רענון</Button>
      </section>
    </div>
  );
}

function NoCheckin({ info }: { info: CheckinInfo }) {
  const e = info.event;
  const cancelled = info.window === 'unavailable';
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-[1.9rem] leading-tight">{cancelled ? 'אין צ׳ק־אין למפגש הזה' : 'הצ׳ק־אין נסגר'}</h1>
      <EventTicket event={e} showStatus={cancelled} />
      <section className="rounded-[var(--radius-panel)] bg-paper px-5 py-6 text-center">
        {cancelled ? (
          <>
            <p className="text-lg">{e.status === 'cancelled' ? 'המפגש הזה בוטל.' : 'המפגש הזה לא פעיל כרגע.'}</p>
            <ButtonLink to="/" variant="secondary" className="mt-4">למפגשים הקרובים</ButtonLink>
          </>
        ) : (
          <>
            <p className="text-lg">המפגש הזה כבר הסתיים.</p>
            <p className="mt-1 text-muted">היית במפגש? נשמח לשמוע איך היה.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <ButtonLink to={`/f/${e.code}`}>למשוב על המפגש</ButtonLink>
              <ButtonLink to="/" variant="secondary">למפגשים הקרובים</ButtonLink>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
