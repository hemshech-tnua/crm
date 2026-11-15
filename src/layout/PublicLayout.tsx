import { Link, Outlet, useLocation } from 'react-router';
import { Logo } from '@/ui/Logo';
import { Stripes } from '@/ui/Shapes';
import { cx } from '@/ui/kit';
import { ContactLine } from '@/features/public/shared';

/** Pages that open into two columns on a wide screen (the home page's schedule, the forms beside their ticket). */
const WIDE = /^\/(?:$|r\/|member$|join$)/;

/**
 * Participant-facing pages: phone first, one hand, one column; on a wide screen the forms sit beside their ticket.
 * Brand book grid (p.51): the logo in the true top-right corner of a navy band, beige stripes entering from the
 * opposite corner and cut by the band's edges; content on the beige ground; the band of short stripes closes the page.
 * Every stripe on these pages runs the same way ("\", fall).
 */
export function PublicLayout() {
  const { pathname } = useLocation();
  const width = WIDE.test(pathname) ? 'max-w-xl lg:max-w-5xl' : 'max-w-xl';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative overflow-hidden bg-ink text-light">
        <Stripes width={260} height={112} unit={24} dir="fall" count={3} offset={0} className="absolute inset-y-0 left-0 h-full w-[200px] sm:w-[260px]" />
        <div className="relative flex items-center px-5 py-3 sm:px-10 sm:py-6">
          <Link to="/" aria-label="המשך תנועה: המפגשים הקרובים" className="[--logo-h:56px] sm:[--logo-h:72px]">
            <Logo variant="full" height="var(--logo-h)" />
          </Link>
        </div>
      </header>
      <main id="main" className={cx('mx-auto w-full flex-1 px-5 pt-6 pb-12 lg:pt-10 lg:pb-16', width)}>
        <Outlet />
      </main>
      <footer className={cx('mx-auto w-full px-5 pb-8 text-small text-muted', width)}>
        <div className="flex flex-col border-t border-edge pt-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <nav aria-label="קישורים נוספים" className="flex flex-wrap gap-x-5">
            <Link to="/member" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">הצטרפות לעמותה</Link>
            <Link to="/join" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">רוצים להרצות או להדריך?</Link>
            <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">מדיניות פרטיות</Link>
            <Link to="/login" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">כניסת צוות</Link>
          </nav>
          <ContactLine />
        </div>
      </footer>
      <div className="relative h-9 overflow-hidden bg-ink" aria-hidden="true">
        <Stripes width={200} height={36} unit={12} dir="fall" count={4} offset={6} className="absolute top-0 left-0 h-9 w-[200px] text-light" />
      </div>
    </div>
  );
}
