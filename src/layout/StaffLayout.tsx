import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useMe, useRole, signOut } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/labels';
import type { Role } from '@/lib/types';
import { Icon, type IconName } from '@/ui/Icon';
import { Logo } from '@/ui/Logo';
import { Stripes, Tri } from '@/ui/Shapes';
import { cx } from '@/ui/kit';
import { Dialog } from '@/ui/feedback';

type Item = { to: string; label: string; icon: IconName; roles: Role[]; mobile?: boolean };

const ITEMS: Item[] = [
  { to: '/app/dashboard', label: 'סקירה', icon: 'overview', roles: ['admin', 'coordinator'], mobile: true },
  { to: '/app/door', label: 'כניסה', icon: 'door', roles: ['volunteer'], mobile: true },
  { to: '/app/events', label: 'מפגשים', icon: 'calendar', roles: ['admin', 'coordinator'], mobile: true },
  { to: '/app/participants', label: 'לוחמים', icon: 'people', roles: ['admin', 'coordinator'], mobile: true },
  { to: '/app/followups', label: 'מעקב', icon: 'task', roles: ['admin', 'coordinator'], mobile: true },
  { to: '/app/speakers', label: 'מרצים ומדריכים', icon: 'mic', roles: ['admin', 'coordinator'] },
  { to: '/app/reports', label: 'דוחות', icon: 'chart', roles: ['admin', 'coordinator'] },
  { to: '/app/settings', label: 'הגדרות', icon: 'settings', roles: ['admin', 'coordinator'] },
];

export function StaffLayout() {
  const me = useMe();
  const role = useRole();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const items = ITEMS.filter((i) => role && i.roles.includes(role));
  const mobileItems = items.filter((i) => i.mobile);
  const extra = items.filter((i) => !i.mobile);
  const { pathname } = useLocation();
  // "עוד" reads as the current section when one of its routes is open
  const extraActive = extra.some((i) => pathname.startsWith(i.to));
  // door mode on a phone needs every pixel for names: no bottom tab bar there
  const door = useMatch('/app/events/:id/door');

  const out = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:z-50 focus:rounded-[var(--radius-panel)] focus:bg-paper focus:px-4 focus:py-2">
        דילוג לתוכן
      </a>

      {/* desktop rail (right side in RTL) */}
      {/* navy rail, beige type and logo; the brand's stripes enter from the bottom corner (brand book: two colours,
          one the ground, the other the shapes and the text) */}
      <nav aria-label="ניווט ראשי" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-hidden bg-ink px-3 py-6 text-light md:flex">
        {/* two whole stripes enter from the rail's bottom edge, cut by a horizontal line, clear of the logo's space
            (book p.15) and of the text */}
        <Stripes width={100} height={48} unit={12} dir="fall" count={2} offset={48} className="pointer-events-none absolute bottom-0 left-0 h-12 w-[100px] text-light" />
        <Link to="/app" className="relative mb-9 flex items-center px-2" aria-label="המשך תנועה: סקירה">
          <Logo variant="full" height={68} />
        </Link>
        <ul className="relative flex flex-1 flex-col gap-1">
          {items.map((i) => (
            <li key={i.to}>
              <NavLink
                to={i.to}
                className={({ isActive }) => cx(
                  'relative flex h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 transition-colors',
                  isActive ? 'bg-light font-bold text-ink' : 'font-medium text-light/80 hover:bg-light/10 hover:text-light',
                )}
              >
                {({ isActive }) => (
                  // as in the book's own navigation: the current section is bold, marked by the triangle ◀
                  <>
                    <Icon name={i.icon} />
                    <span className="flex-1">{i.label}</span>
                    {isActive && <Tri size="0.7em" />}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="relative border-t border-light/20 pt-4">
          <div className="px-2 text-small">
            <div className="font-semibold">{me.data?.full_name}</div>
            <div className="text-light/75">{role ? ROLE_LABEL[role] : ''}</div>
          </div>
          <button type="button" onClick={out} className="mt-2 flex h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-light/85 hover:bg-light/10 hover:text-light">
            <Icon name="logout" />
            יציאה
          </button>
        </div>
      </nav>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between overflow-hidden bg-ink px-4 text-light md:hidden">
        {/* two whole stripes across the bar, cut by its top and bottom edges */}
        {role !== 'volunteer' && <Stripes width={116} height={64} unit={12} dir="fall" count={2} offset={64} className="pointer-events-none absolute top-0 left-0 h-16 w-[116px] text-light" />}
        <Link to="/app" className="relative flex items-center" aria-label="המשך תנועה: ראשי">
          {/* the full logo at the book's minimum size; the "lockup" cut is not a sanctioned variant (book p.26) */}
          <Logo variant="symbol" height={40} label="המשך תנועה" />
        </Link>
        {role === 'volunteer' && (
          <button type="button" onClick={out} className="relative flex items-center gap-1.5 text-small font-medium text-light/85"><Icon name="logout" size={18} />יציאה</button>
        )}
      </header>

      <main id="main" className={cx('min-w-0 flex-1 px-4 pt-5 sm:px-6 md:px-10 md:pt-9 md:pb-12', door ? 'pb-8' : 'pb-28')}>
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* mobile tab bar */}
      {role && role !== 'volunteer' && !door && (
        <nav aria-label="ניווט ראשי" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-paper md:hidden">
          <ul className="grid grid-cols-5">
            {mobileItems.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} className={({ isActive }) => cx('flex h-16 flex-col items-center justify-center gap-1 text-[0.8rem] leading-none', isActive ? 'font-bold text-ink' : 'font-medium text-muted')}>
                  {({ isActive }) => (
                    <>
                      <span className={cx('flex h-7 w-12 items-center justify-center rounded-[var(--radius-control)]', isActive && 'bg-ink text-light')}><Icon name={i.icon} size={21} /></span>
                      {i.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setMore(true)} aria-current={extraActive ? 'page' : undefined}
                className={cx('flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.8rem] leading-none', extraActive ? 'font-bold text-ink' : 'font-medium text-muted')}>
                <span className={cx('flex h-7 w-12 items-center justify-center rounded-[var(--radius-control)]', extraActive && 'bg-ink text-light')}><Icon name="more" size={21} /></span>
                עוד
              </button>
            </li>
          </ul>
        </nav>
      )}

      <Dialog open={more} onClose={() => setMore(false)} title="עוד" size="sm">
        <ul className="flex flex-col gap-1">
          {extra.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} onClick={() => setMore(false)} className={({ isActive }) => cx('flex h-12 items-center gap-3 rounded-[var(--radius-control)] px-3 hover:bg-ink/[0.06]', isActive ? 'bg-ink/[0.06] font-bold' : 'font-medium')}>
                <Icon name={i.icon} className="text-tide" />
                {i.label}
              </NavLink>
            </li>
          ))}
          <li className="mt-2 border-t border-edge pt-2">
            <div className="px-3 py-1 text-small text-muted">{me.data?.full_name} · {role ? ROLE_LABEL[role] : ''}</div>
            <button type="button" onClick={out} className="flex h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 font-medium hover:bg-ink/[0.06]">
              <Icon name="logout" className="text-tide" />
              יציאה
            </button>
          </li>
        </ul>
      </Dialog>
    </div>
  );
}
