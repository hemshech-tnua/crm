import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Logo } from '@/ui/Logo';
import { Stripes } from '@/ui/Shapes';
import { cx } from '@/ui/kit';
import { whatsappLink } from '@/lib/phone';
import { ContactLine } from '@/features/public/shared';
import { useOrgInfo } from '@/features/public/api';

/** Pages that open into two columns on a wide screen (the home page's schedule, the forms beside their ticket). */
const WIDE = /^\/(?:$|r\/|e\/|member$|join$|friday$)/;

/** The volunteer's first message: neutral, so anyone can send it as it is. */
const VOLUNTEER_MESSAGE = 'היי, אני רוצה להתנדב בהמשך תנועה. אשמח לשמוע איך אפשר לעזור.';

/**
 * A new public page (not a new ?query on the same page): back to the top, and the page's H1 takes focus, so a screen
 * reader announces where it landed (WCAG 2.4.3). Pages that load wait for their H1; a page that already moved focus
 * itself (a result heading, a field with autofocus) keeps it.
 */
function useFocusOnNavigate(pathname: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    let frame = 0;
    let tries = 0;
    const tick = () => {
      const main = document.getElementById('main');
      const h1 = main?.querySelector<HTMLElement>('h1');
      const active = document.activeElement;
      // the page took focus on its own: leave it there
      if (main && active && active !== document.body && main.contains(active)) return;
      if (h1) {
        if (!h1.hasAttribute('tabindex')) {
          h1.tabIndex = -1;
          h1.classList.add('outline-none');
        }
        h1.focus({ preventScroll: true });
        return;
      }
      if (++tries < 180) frame = requestAnimationFrame(tick); // up to ~3s while the page loads
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
}

/**
 * Participant-facing pages: phone first, one hand, one column; on a wide screen the forms sit beside their ticket.
 * Brand book grid (p.51): the logo in the top-right corner of a navy band (on a wide screen at the content's edge),
 * beige stripes entering from the opposite corner and cut by the band's edges; content on the beige ground; the band
 * of short stripes closes the page. Every stripe on these pages runs the same way ("\", fall).
 */
export function PublicLayout() {
  const { pathname } = useLocation();
  const wide = WIDE.test(pathname);
  const width = wide ? 'max-w-xl lg:max-w-5xl' : 'max-w-xl';
  const org = useOrgInfo();
  const phone = org.data?.contact_phone;
  useFocusOnNavigate(pathname);
  const link = 'inline-flex min-h-11 items-center hover:text-ink hover:underline';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative overflow-hidden bg-ink text-light">
        <Stripes width={260} height={112} unit={24} dir="fall" count={3} offset={0} className="absolute inset-y-0 left-0 h-full w-[200px] sm:w-[260px]" />
        {/* the logo on the content's grid: its right edge lines up with the text under it */}
        <div className={cx('relative mx-auto flex w-full items-center px-5 py-2.5 sm:py-6', width)}>
          <Link to="/" aria-label="המשך תנועה: המפגשים הקרובים" className="[--logo-h:64px] sm:[--logo-h:76px]">
            <Logo variant="full" height="var(--logo-h)" />
          </Link>
        </div>
      </header>
      {/* at least a screen tall, so the footer never jumps up and back while a page loads (layout shift) */}
      <main id="main" className={cx('mx-auto min-h-[calc(100dvh-5.25rem)] w-full flex-1 px-5 pt-6 pb-12 sm:min-h-[calc(100dvh-7.75rem)] lg:pt-10 lg:pb-16', width)}>
        <Outlet />
      </main>
      <footer className={cx('mx-auto w-full px-5 pb-8 text-small text-muted', width)}>
        <div className={cx('flex flex-col items-start border-t border-edge pt-2 text-start', wide && 'lg:flex-row lg:items-center lg:justify-between lg:gap-6')}>
          <nav aria-label="קישורים נוספים" className="grid grid-cols-2 justify-items-start gap-x-6 sm:flex sm:flex-wrap sm:gap-x-5">
            <Link to="/member" className={link}>הצטרפות לעמותה</Link>
            {phone && (
              <a href={whatsappLink(phone, VOLUNTEER_MESSAGE)} target="_blank" rel="noopener noreferrer" className={link}>
                רוצים להתנדב?<span className="sr-only"> (וואטסאפ, נפתח בחלון חדש)</span>
              </a>
            )}
            <Link to="/join" className={link}>רוצים להרצות או להדריך?</Link>
            <Link to="/privacy" className={link}>מדיניות פרטיות</Link>
            <Link to="/login" className={link}>כניסת צוות</Link>
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
