import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { fmtDayLong, fmtTime, relativeDays } from '@/lib/dates';
import { errorCode, errorMessage } from '@/lib/errors';
import { Button, ButtonLink, EmptyState, ErrorBox, Input, Notice, Skeleton } from '@/ui/kit';
import { checkIn, checkInKnown, undoCheckin, usePublicSources, useCheckinInfo, useSavedStatuses, walkIn, type CheckinInfo, type CheckinResult, type PublicSource } from './api';
import { forgetPerson, forgetToken, knownPeople, rememberPerson, saveToken, savedRegistrations } from './device';
import { EventTicket } from './EventTicket';
import { timeRange } from './eventText';
import { ConsentFields, PersonFields, cleanText, nameError, phoneError, usePersonForm } from './PersonForm';
import { Honeypot, ResultTitle, SuccessMark } from './shared';

/** #/c/:checkinCode — scanned from the QR sign at the entrance, on the participant's own phone. */
export function CheckinPage() {
  const { code = '' } = useParams();
  return <Checkin key={code} code={code} />;
}

function Checkin({ code }: { code: string }) {
  const info = useCheckinInfo(code);
  const [welcome, setWelcome] = useState<CheckinResult | null>(null);
  const [undone, setUndone] = useState(false);

  if (welcome) {
    return (
      <Welcome
        result={welcome}
        fallback={info.data?.event ?? null}
        onUndone={() => { setWelcome(null); setUndone(true); }}
        onAnother={() => { setWelcome(null); setUndone(false); }}
      />
    );
  }
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
  return <CheckinFlow code={code} event={i.event} undone={undone} onWelcome={(r) => { setUndone(false); setWelcome(r); }} onWindowChanged={() => info.refetch()} />;
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

function CheckinFlow({ code, event, undone, onWelcome, onWindowChanged }: {
  code: string;
  event: PublicEvent;
  undone: boolean;
  onWelcome: (r: CheckinResult) => void;
  onWindowChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>(() => (!undone && onPhone(event.code).length ? 'token' : 'phone'));
  const [switched, setSwitched] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(undone ? 'הצ׳ק־אין בוטל. אפשר להקליד שוב את המספר הנכון.' : null);
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
        saveToken(res.event?.code ?? event.code, res.token, res.first_name);
        // the phone remembers the person: next meeting, "I'm here" is one tap even without registering
        rememberPerson(res.device, res.first_name);
        onWelcome(res);
        return;
      case 'not_registered':
        go('walkin');
        return;
      case 'token_invalid':
        if (last?.token) forgetToken(event.code, last.token);
        setNotice('לא הצלחנו לזהות את ההרשמה מהטלפון הזה. אפשר להיכנס עם מספר הטלפון.');
        go('phone');
        return;
      case 'device_invalid':
        forgetPerson(last?.device);
        setNotice('הטלפון כבר לא זוכר אותך (עבר הרבה זמן מאז הביקור האחרון). אפשר להיכנס עם מספר הטלפון.');
        go('phone');
        return;
      default:
        // window_not_open / window_closed / window_unavailable: show the current state of the event
        onWindowChanged();
    }
  };

  const [last, setLast] = useState<{ token?: string; device?: string } | null>(null);
  const run = async (p: { token?: string; device?: string; phone?: string }) => {
    setError(null);
    setLast(p);
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

  const saved = onPhone(event.code);
  if (mode === 'token' && saved.length) {
    return <SavedOnPhone event={event} saved={saved} busy={busy} error={error} onPick={(o) => run(o.kind === 'device' ? { device: o.value } : { token: o.value })} onOther={() => go('phone')} />;
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
  // first just the name: someone we already know is checked in with it; everyone else continues to the short form
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5 pt-1">
      <div>
        <h1 className="font-display text-[1.9rem] leading-tight">ברוך/ה הבא/ה!</h1>
        <p className="mt-1 text-lg text-ink-soft">
          {name == null
            ? 'לא מצאנו הרשמה למפגש הזה עם המספר הזה. אין בעיה: איך קוראים לך?'
            : 'עוד כמה פרטים ונכנסים. זה רק בפעם הראשונה.'}
        </p>
      </div>
      {name == null ? (
        <NameStep code={code} phone={phone} onResult={onResult} onNeedDetails={setName} />
      ) : sources.isPending ? (
        <Skeleton lines={6} />
      ) : sources.isError ? (
        <ErrorBox error={errorMessage(sources.error)} onRetry={() => sources.refetch()} />
      ) : (
        <WalkinForm code={code} phone={phone} name={name} sources={sources.data} onResult={onResult} />
      )}
      <button type="button" onClick={onBack} className="min-h-11 self-center px-3 font-semibold text-tide underline underline-offset-4">
        טעיתי במספר, חזרה
      </button>
    </div>
  );
}

/** Full name only. Known to us (phone + same name on the card): checked in. Anyone else: on to the short form. */
function NameStep({ code, phone, onResult, onNeedDetails }: {
  code: string;
  phone: string;
  onResult: (r: CheckinResult) => void;
  onNeedDetails: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const ne = nameError(name);
    setErr(ne);
    if (ne) {
      document.getElementById('walkin-name')?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await checkInKnown({ code, phone: phone.trim(), full_name: cleanText(name), website });
      if (r.result === 'need_details') onNeedDetails(cleanText(name));
      else onResult(r);
    } catch (x) {
      if (errorCode(x) === 'invalid_name') setErr(errorMessage(x));
      else setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label="השם שלך">
      <Input
        id="walkin-name"
        label={<span className="text-lg">שם מלא</span>}
        autoComplete="name"
        enterKeyHint="go"
        maxLength={80}
        autoFocus
        className="h-16! text-2xl"
        value={name}
        onChange={(e) => { setName(e.target.value); setErr(undefined); }}
        error={err}
        hint="אם כבר היית אצלנו, זה כל מה שצריך."
      />
      <Honeypot value={website} onChange={setWebsite} />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" busy={busy} className="h-16! w-full text-xl!">המשך</Button>
    </form>
  );
}

function WalkinForm({ code, phone, name, sources, onResult }: {
  code: string;
  phone: string;
  name: string;
  sources: PublicSource[];
  onResult: (r: CheckinResult) => void;
}) {
  const form = usePersonForm({ phone, full_name: name });
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

/**
 * Who this phone can check in with one tap: registrations made from it for this meeting, and people who checked in
 * from it before (remembered across meetings). A remembered person whose name already has a registration here is
 * shown once.
 */
type PhoneOption = { kind: 'token' | 'device'; value: string; name: string | null };
function onPhone(eventCode: string): PhoneOption[] {
  const regs: PhoneOption[] = savedRegistrations(eventCode).map((r) => ({ kind: 'token', value: r.token, name: r.name }));
  const names = new Set(regs.map((r) => r.name).filter(Boolean));
  const people: PhoneOption[] = knownPeople().filter((p) => !p.name || !names.has(p.name)).map((p) => ({ kind: 'device', value: p.device, name: p.name }));
  return [...regs, ...people];
}

/** One option: a single big button with the name. Several: "who arrived?". */
function SavedOnPhone({ event, saved, busy, error, onPick, onOther }: {
  event: PublicEvent; saved: PhoneOption[]; busy: boolean; error: string | null; onPick: (o: PhoneOption) => void; onOther: () => void;
}) {
  const status = useSavedStatuses(saved.filter((o) => o.kind === 'token').map((o) => o.value));
  const big = 'h-24! w-full rounded-[var(--radius-panel)]! font-display text-[2.2rem]! font-normal!';
  const one = saved.length === 1 ? saved[0] : null;
  return (
    <div className="flex flex-col gap-5 pt-1">
      <div>
        <h1 className="font-display text-[2.1rem] leading-tight">צ׳ק־אין</h1>
        <EventLine event={event} />
      </div>
      {one ? (
        <p className="text-lg">
          {one.kind === 'device'
            ? (one.name ? `${one.name}, הטלפון זוכר אותך מהביקור הקודם, אז מספיקה לחיצה אחת.` : 'הטלפון זוכר אותך מהביקור הקודם, אז מספיקה לחיצה אחת.')
            : (one.name ? `נרשמת מהטלפון הזה בשם ${one.name}, אז מספיקה לחיצה אחת.` : 'נרשמת מהטלפון הזה, אז מספיקה לחיצה אחת.')}
        </p>
      ) : (
        <p className="text-lg">{saved.every((o) => o.kind === 'token') ? 'מהטלפון הזה נרשמו כמה אנשים. מי הגיע/ה?' : 'מהטלפון הזה נכנסו או נרשמו כמה אנשים. מי הגיע/ה?'}</p>
      )}
      {error && <ErrorBox error={error} />}
      <div className="flex flex-col gap-3">
        {saved.map((o) => {
          const inside = o.kind === 'token' && status.data?.[o.value] === 'attended';
          return (
            <Button key={o.value} size="lg" busy={busy} variant={inside ? 'secondary' : 'primary'} onClick={() => onPick(o)}
              className={one ? big : 'h-16! w-full text-xl!'}>
              {inside ? `${o.name ?? 'את/ה'} כבר בפנים ✓` : one ? 'הגעתי' : `${o.name ?? 'הרשמה'} הגיע/ה`}
            </Button>
          );
        })}
      </div>
      <button type="button" onClick={onOther} className="min-h-11 self-center px-3 text-[1.05rem] font-semibold text-tide underline underline-offset-4">
        {one ? `לא ${one.name ?? 'את/ה'}? צ׳ק־אין עם מספר טלפון` : 'מישהו אחר? צ׳ק־אין עם מספר טלפון'}
      </button>
    </div>
  );
}

const MILESTONES: Record<number, string> = { 5: 'זה השישי החמישי שלך!', 10: 'זה השישי העשירי שלך!' };

function Welcome({ result: r, fallback, onUndone, onAnother }: { result: CheckinResult; fallback: PublicEvent | null; onUndone: () => void; onAnother: () => void }) {
  const event = r.event ?? fallback;
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const notMe = async () => {
    if (!r.token) return;
    setUndoing(true);
    setUndoError(null);
    try {
      await undoCheckin(r.token);
      if (event) forgetToken(event.code, r.token);
      forgetPerson(r.device);
      onUndone();
    } catch (err) {
      setUndoError(errorMessage(err));
    } finally {
      setUndoing(false);
    }
  };
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
      {r.membership === 'member' && <p className="rounded-full bg-sky-wash px-5 py-2 text-[1.05rem] font-semibold text-ink">חבר/ת עמותה. תודה שאת/ה איתנו!</p>}
      {r.can_undo && r.result === 'checked_in' && (
        <div className="mt-1 flex flex-col items-center gap-2">
          <button type="button" onClick={notMe} disabled={undoing} className="min-h-11 px-3 text-[1.05rem] font-semibold text-tide underline underline-offset-4">
            {undoing ? 'מבטל…' : r.first_name ? `זה לא אני, אני לא ${r.first_name}` : 'זה לא אני'}
          </button>
          {undoError && <ErrorBox error={undoError} />}
        </div>
      )}
      <button type="button" onClick={onAnother} className="min-h-11 px-3 text-[0.95rem] font-semibold text-muted underline underline-offset-4">
        צ׳ק־אין של מישהו נוסף מהטלפון הזה
      </button>
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
      <EventTicket event={e} showStatus={e.status === 'cancelled'} />
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
