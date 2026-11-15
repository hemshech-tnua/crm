import { Link, Outlet } from 'react-router';
import { Logo } from '@/ui/Logo';
import { Stripes } from '@/ui/Shapes';
import { ContactLine } from '@/features/public/shared';

/**
 * Participant-facing pages: one calm column, works one-handed on a phone.
 * Brand book grid: the logo in the top-right corner of a navy band, beige stripes entering from the opposite corner and
 * cut by the format's edges; content on beige below; the band of short stripes closes the page, as on the posters.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative overflow-hidden bg-ink text-light">
        <Stripes width={260} height={112} unit={24} dir="fall" corner={{ at: 'top-left', size: 200 }} className="absolute top-0 left-0 h-28 w-[260px]" />
        <div className="relative mx-auto flex max-w-xl items-center px-5 pt-6 pb-7">
          <Link to="/" aria-label="המשך תנועה: המפגשים הקרובים">
            <Logo variant="full" height={64} />
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 pt-6 pb-12">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-xl px-5 pb-8 text-sm text-muted">
        <div className="flex flex-wrap gap-x-5 border-t border-line pt-2">
          <Link to="/member" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">הצטרפות לעמותה</Link>
          <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">מדיניות פרטיות</Link>
          <Link to="/join" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">רוצים להרצות או להדריך?</Link>
          <Link to="/login" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">כניסת צוות</Link>
        </div>
        <div className="pt-1"><ContactLine /></div>
      </footer>
      <div className="relative h-9 overflow-hidden bg-ink" aria-hidden="true">
        <Stripes width={180} height={36} unit={11} dir="fall" count={4} offset={6} className="absolute top-0 left-0 h-9 w-[180px] text-light" />
      </div>
    </div>
  );
}
