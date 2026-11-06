import { Link, Outlet } from 'react-router';
import { Logo } from '@/ui/Icon';
import { ContactLine } from '@/features/public/shared';

/** Participant-facing pages: one calm column, works one-handed on a phone. */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative overflow-hidden bg-ink text-mist">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-5 pt-5 pb-9">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={40} tone="light" />
            <span>
              <span className="block font-display text-[1.4rem] leading-none">המשך תנועה</span>
              <span className="mt-1 block text-sm text-mist/70">חוזרים לשגרה, ממשיכים לנוע. ביחד.</span>
            </span>
          </Link>
        </div>
        {/* the continuing line */}
        <svg className="absolute inset-x-0 bottom-0 h-6 w-full" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
          <path d="M400 18 C 330 18, 300 6, 230 6 S 120 20, 60 14 S 10 8, 0 10 L0 24 L400 24 Z" fill="var(--color-mist)" />
          <path d="M400 18 C 330 18, 300 6, 230 6 S 120 20, 60 14 S 10 8, 0 10" fill="none" stroke="var(--color-light)" strokeWidth="2.5" />
        </svg>
      </header>
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 pt-5 pb-12">
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
