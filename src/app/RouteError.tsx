import { useRouteError } from 'react-router';
import { FALLBACK_ERROR } from '@/lib/errors';
import { useTitle } from '@/lib/title';
import { Icon } from '@/ui/Icon';
import { Button, RETRY_LABEL } from '@/ui/kit';

/** A screen's code could not be loaded (no connection while moving to a screen not opened before), or a screen broke. */
const isLoadFailure = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|NetworkError/i.test(String((e as Error)?.message ?? e));

/** The router's error screen: plain words and one retry, never a raw error. */
export function RouteError() {
  const error = useRouteError();
  const load = isLoadFailure(error);
  useTitle(load ? 'אין חיבור' : 'משהו השתבש');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-panel)] bg-ink text-light">
        <Icon name="alert" size={26} />
      </div>
      <h1 className="font-display text-title-sm">{load ? 'אין חיבור' : 'משהו השתבש'}</h1>
      <p className="mt-2 text-body text-ink-soft">
        {load ? 'המסך הזה לא נטען. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.' : FALLBACK_ERROR}
      </p>
      <Button className="mt-5" onClick={() => window.location.reload()}>{RETRY_LABEL}</Button>
    </main>
  );
}
