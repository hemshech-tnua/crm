// The pay step of a meeting with a fee and a payment link (migration 20261106002700_pay_before_register.sql): nothing is
// held until the provider confirms the payment, so this screen never says "נרשמת!". It is shown right after the form and
// on the personal page while the payment is awaited; the page watches the registration and moves on by itself.
import { useEffect, useState } from 'react';
import type { PublicEvent } from '@/lib/types';
import { fmtMoney } from '@/lib/money';
import { manageUrl } from '@/lib/links';
import { Button, ButtonLink, ExternalButton, Notice, Spinner } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import { PAYMENT_POLL_FOR_MS } from './api';
import { EventTicket } from './EventTicket';
import { Icon } from '@/ui/Icon';
import { Block, BulletList, ResultTitle, SectionTitle, payUrl, type Payer } from './shared';
import { providerName } from './payUrl';

/** A meeting where registering means paying first: a fee and a payment link. */
export const paysFirst = (e: Pick<PublicEvent, 'price' | 'payment_url'>) => Number(e.price ?? 0) > 0 && !!e.payment_url;

/** True once the automatic checks have run for 30 minutes (then only "כבר שילמתי" checks again). */
export function useWatchExpired(since: number): boolean {
  const [expired, setExpired] = useState(() => Date.now() - since >= PAYMENT_POLL_FOR_MS);
  useEffect(() => {
    if (expired) return;
    const t = window.setTimeout(() => setExpired(true), Math.max(0, since + PAYMENT_POLL_FOR_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [since, expired]);
  return expired;
}

/** The mark of this step: the card, quiet like the waitlist mark (the navy check is kept for "נרשמת!"). */
function PayMark() {
  return (
    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[var(--radius-control)] border-2 border-ink bg-paper text-ink" aria-hidden="true">
      <Icon name="card" size={40} />
    </div>
  );
}

export function PayStep({ event: e, payer, token, firstName, expired, onCheck, showLink = true }: {
  event: PublicEvent;
  payer: Payer | null;
  token: string | null;
  firstName?: string | null;
  /** the 30 minutes of automatic checks are over */
  expired: boolean;
  /** check now ("כבר שילמתי"); resolves to true when the payment is still awaited */
  onCheck: () => Promise<boolean>;
  /** the personal link block (not on the personal page itself) */
  showLink?: boolean;
}) {
  const amount = fmtMoney(e.price);
  const url = payUrl(e.payment_url ?? '', payer);
  const prefilled = url !== e.payment_url;
  const provider = providerName(e.payment_url);
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const name = firstName ? `${firstName}, ` : '';

  const check = async () => {
    setChecking(true);
    try {
      setNotYet(await onCheck());
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5" data-testid="pay-step">
      <div className="pt-2 text-center">
        <PayMark />
        <ResultTitle className="mt-4">עוד צעד אחד: תשלום</ResultTitle>
        <p className="mx-auto mt-2 max-w-sm text-lg text-balance text-ink-soft">
          {name}המקום נשמר רק אחרי&nbsp;התשלום.
        </p>
      </div>

      {e.is_full && (
        <Notice tone="warn" icon="alert">
          המפגש התמלא בינתיים. תשלום עכשיו יכניס את ההרשמה לרשימת ההמתנה, והצוות יחזור&nbsp;אליך.
        </Notice>
      )}

      {/* before leaving for the provider's page: the way back here (an in-app browser may not return to this tab) */}
      {showLink && token && <PendingLink token={token} />}

      <section aria-label="תשלום" className="rounded-[var(--radius-panel)] border-2 border-ink bg-paper p-4 sm:p-5">
        <SectionTitle>תשלום בכרטיס אשראי</SectionTitle>
        <ExternalButton href={url} variant="primary" size="lg" cta className="mt-3 w-full">
          לתשלום <span className="num">{amount}</span>
        </ExternalButton>
        <BulletList
          className="mt-3 text-body-sm text-ink"
          items={[
            provider
              ? <>דף התשלום המאובטח של "{provider}" ייפתח בחלון&nbsp;חדש.</>
              : 'דף התשלום המאובטח ייפתח בחלון\u00a0חדש.',
            prefilled
              ? <span className="font-semibold">השם והטלפון כבר ממולאים שם. נשאר להוסיף אימייל לקבלה ולשלם בכרטיס&nbsp;אשראי.</span>
              : <span className="font-semibold">כותבים שם וטלפון כמו בהרשמה, כדי שנזהה את התשלום, ומשלמים בכרטיס&nbsp;אשראי.</span>,
            'פרטי האשראי מוזנים בדף המאובטח של חברת התשלום, לא\u00a0אצלנו.',
            'הקבלה נשלחת אוטומטית.',
          ]}
        />

        <div className="mt-4 border-t border-edge pt-3" aria-live="polite" data-testid="pay-status">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button size="sm" variant="secondary" busy={checking} onClick={check}>כבר שילמתי</Button>
            <span className="flex items-center gap-2 text-small text-ink-soft">
              {!expired && <span className="text-ink"><Spinner size={14} /></span>}
              {expired ? 'כבר שילמת? לוחצים "כבר שילמתי" ונבדוק\u00a0שוב.' : 'אחרי התשלום חוזרים לכאן. ההרשמה תאושר בעמוד הזה\u00a0מעצמה.'}
            </span>
          </div>
          {notYet && (
            <p className="mt-2 text-small text-ink">עוד לא קיבלנו אישור מחברת התשלום. בדרך כלל זה לוקח פחות מדקה, אז אפשר לנסות שוב עוד&nbsp;רגע.</p>
          )}
        </div>
      </section>

      {/* the amount is on the button above: the ticket says when and where */}
      <EventTicket event={e} showStatus={false} showPrice={false} />
    </div>
  );
}

/** The personal link while unpaid: a way back to the payment, worded so it promises no place. */
function PendingLink({ token }: { token: string }) {
  const copy = useCopy();
  const url = manageUrl(token);
  return (
    <Block title="לפני שעוברים לתשלום">
      <p className="text-body-sm text-ink-soft">
        כדאי לשמור את הקישור האישי. דרכו אפשר לחזור לכאן ולשלם, גם אחר כך, כל עוד יש&nbsp;מקום.
        <span className="mt-1 block font-semibold text-ink">הקישור אישי, לא&nbsp;לשתף.</span>
      </p>
      <p dir="ltr" className="num mt-3 truncate rounded-[var(--radius-control)] bg-mist px-3 py-2.5 text-left text-small text-ink-soft">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" icon="copy" onClick={() => copy(url, 'הקישור האישי הועתק. כדאי לשמור אותו.')}>העתקת הקישור האישי</Button>
        <ButtonLink to={`/m/${token}`} variant="ghost">לעמוד ההרשמה שלי</ButtonLink>
      </div>
    </Block>
  );
}
