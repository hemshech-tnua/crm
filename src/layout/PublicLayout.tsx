import { Link, Outlet } from 'react-router';
import { Logo } from '@/ui/Logo';
import { EllipsePattern } from '@/ui/Ellipse';
import { ContactLine } from '@/features/public/shared';

/** Participant-facing pages: one calm column, works one-handed on a phone. Brand book: sky band, cream page, brown type. */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative overflow-hidden bg-sky text-ink">
        {/* the elliptical pattern from the brand book, in cream, off to one side so the logo stays clear */}
        <EllipsePattern className="absolute -top-24 -left-28 h-80 w-80 text-mist/80 sm:-left-10" rings={4} />
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
          <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">מדיניות פרטיות</Link>
          <Link to="/join" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">רוצים להרצות או להדריך?</Link>
          <Link to="/login" className="inline-flex min-h-11 items-center hover:text-ink hover:underline">כניסת צוות</Link>
        </div>
        <div className="pt-1"><ContactLine /></div>
      </footer>
    </div>
  );
}
