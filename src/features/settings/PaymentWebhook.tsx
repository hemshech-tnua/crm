// Settings → general (admin): the "יש חשבונית" webhook. The address to paste in the provider's settings is shown WITHOUT
// the secret key: the key lives only in the Edge Function's secrets (YESH_WEBHOOK_KEY) and is handed over once by the
// lead. What the page can tell is whether documents arrive (staff_payment_webhook_status). Setup: docs/08-payments-webhook.md.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase, functionsUrl } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { fmtListDate } from '@/lib/dates';
import { Badge, Button, ErrorBox, Panel, Skeleton } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';

type Status = {
  last_received_at: string | null;
  last_outcome: 'received' | 'registered' | 'waitlisted' | 'paid' | 'unmatched' | 'ignored' | null;
  received_30d: number;
  matched_30d: number;
  unmatched_open: number;
};

const OUTCOME: Record<NonNullable<Status['last_outcome']>, string> = {
  received: 'התקבל',
  registered: 'הותאם להרשמה, וההרשמה הושלמה',
  waitlisted: 'הותאם להרשמה, שנכנסה לרשימת ההמתנה',
  paid: 'הותאם להרשמה שחיכתה לתשלום',
  unmatched: 'לא זוהה, מחכה להתאמה להרשמה',
  ignored: 'לא קשור למפגש, לא נשמר',
};

export const webhookUrl = () => `${functionsUrl}/yesh-webhook?key=`;

export function PaymentWebhookPanel() {
  const copy = useCopy();
  const q = useQuery({
    queryKey: ['payment-webhook-status'],
    queryFn: async () => must(await supabase.rpc('staff_payment_webhook_status')) as Status,
  });
  const base = webhookUrl();
  const s = q.data;
  return (
    <Panel title='חיבור ל"יש חשבונית"' description="כשתשלום עובר בדף התשלום, ההרשמה מאושרת כאן מעצמה. כאן רואים אם החיבור עובד.">
      <div className="flex flex-col gap-4" data-testid="payment-webhook">
        <div>
          <p className="text-small font-medium text-muted">הכתובת להדבקה ב"יש חשבונית" (Webhook מסוג "מסמך נוצר")</p>
          <p dir="ltr" className="num mt-1 rounded-[var(--radius-control)] bg-mist px-3 py-2.5 text-left text-sm break-all text-ink">
            {base}<span className="font-bold text-tide">{'<המפתח>'}</span>
          </p>
          <p className="mt-2 text-small text-ink-soft">
            במקום {'<המפתח>'} מדביקים את המפתח הסודי שקיבלתם מהאחראי על המערכת. המפתח לא נשמר באתר ולא מוצג כאן.
          </p>
          <Button size="sm" variant="secondary" icon="copy" className="mt-2" onClick={() => copy(base, 'הכתובת הועתקה, בלי המפתח')}>העתקת הכתובת בלי המפתח</Button>
        </div>
        <div className="border-t border-edge pt-3">
          {q.isLoading ? (
            <Skeleton lines={2} />
          ) : q.isError ? (
            <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : s?.last_received_at ? (
            <div className="flex flex-col gap-1.5 text-body">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone="good" icon="check">מחובר</Badge>
                <span>הודעה אחרונה: <span className="tabular-nums">{fmtListDate(s.last_received_at)}</span>{s.last_outcome && <> · {OUTCOME[s.last_outcome]}</>}</span>
              </p>
              <p className="text-small text-ink-soft">
                ב-30 הימים האחרונים: <span className="num">{s.received_30d}</span> מסמכים, מהם <span className="num">{s.matched_30d}</span> הותאמו להרשמות.
              </p>
              {s.unmatched_open > 0 && (
                <p className="text-small">
                  <span className="num font-bold">{s.unmatched_open}</span> תשלומים מחכים להתאמה להרשמה.{' '}
                  <Link to="/app/reports?tab=finance" className="font-semibold text-tide underline underline-offset-2">להתאמה ◀</Link>
                </p>
              )}
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-body">
              <Badge tone="warn" icon="alert">עוד לא התקבלה הודעה</Badge>
              <span className="text-small text-ink-soft">אחרי ההדבקה ב"יש חשבונית", התשלום הבא יופיע כאן.</span>
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
