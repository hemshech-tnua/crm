import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useMe, useRole, signOut } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/labels';
import type { Role } from '@/lib/types';
import { Icon, Logo, type IconName } from '@/ui/Icon';
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

  const out = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2">
        דילוג לתוכן
      </a>

      {/* desktop rail (right side in RTL) */}
      <nav aria-label="ניווט ראשי" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-ink px-3 py-5 text-mist md:flex">
        <Link to="/app" className="mb-7 flex items-center gap-2.5 px-2">
          <Logo size={38} tone="light" />
          <span className="font-display text-xl leading-none">המשך תנועה</span>
        </Link>
        <ul className="flex flex-1 flex-col gap-1">
          {items.map((i) => (
            <li key={i.to}>
              <NavLink
                to={i.to}
                className={({ isActive }) => cx(
                  'flex h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 font-medium transition-colors',
                  isActive ? 'bg-mist text-ink' : 'text-mist hover:bg-white/10',
                )}
              >
                <Icon name={i.icon} />
                {i.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="border-t border-white/15 pt-4">
          <div className="px-2 text-sm">
            <div className="font-semibold">{me.data?.full_name}</div>
            <div className="text-mist/60">{role ? ROLE_LABEL[role] : ''}</div>
          </div>
          <button type="button" onClick={out} className="mt-2 flex h-10 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-mist/80 hover:bg-white/10 hover:text-mist">
            <Icon name="logout" />
            יציאה
          </button>
        </div>
      </nav>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line-soft bg-mist/95 px-4 backdrop-blur md:hidden">
        <Link to="/app" className="flex items-center gap-2">
          <Logo size={30} />
          <span className="font-display text-lg leading-none">המשך תנועה</span>
        </Link>
        {role === 'volunteer' && (
          <button type="button" onClick={out} className="flex items-center gap-1.5 text-sm font-medium text-muted"><Icon name="logout" size={18} />יציאה</button>
        )}
      </header>

      <main id="main" className="min-w-0 flex-1 px-4 pt-5 pb-28 sm:px-6 md:px-10 md:pt-9 md:pb-12">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* mobile tab bar */}
      {role && role !== 'volunteer' && (
        <nav aria-label="ניווט ראשי" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper md:hidden">
          <ul className="grid grid-cols-5">
            {mobileItems.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} className={({ isActive }) => cx('flex h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold', isActive ? 'text-tide' : 'text-muted')}>
                  {({ isActive }) => (
                    <>
                      <span className={cx('flex h-7 w-12 items-center justify-center rounded-full', isActive && 'bg-tide-wash')}><Icon name={i.icon} size={21} /></span>
                      {i.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setMore(true)} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold text-muted">
                <span className="flex h-7 w-12 items-center justify-center"><Icon name="more" size={22} /></span>
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
              <Link to={i.to} onClick={() => setMore(false)} className="flex h-12 items-center gap-3 rounded-[var(--radius-control)] px-3 font-medium hover:bg-mist">
                <Icon name={i.icon} className="text-tide" />
                {i.label}
              </Link>
            </li>
          ))}
          <li className="mt-2 border-t border-line-soft pt-2">
            <div className="px-3 py-1 text-sm text-muted">{me.data?.full_name} · {role ? ROLE_LABEL[role] : ''}</div>
            <button type="button" onClick={out} className="flex h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 font-medium hover:bg-mist">
              <Icon name="logout" className="text-tide" />
              יציאה
            </button>
          </li>
        </ul>
      </Dialog>
    </div>
  );
}
