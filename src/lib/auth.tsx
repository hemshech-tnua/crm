import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import { functionsUrl, supabase } from './supabase';
import type { Role, Staff } from './types';
import { Button, RETRY_LABEL, Skeleton } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { errorCode, errorMessage } from './errors';

const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000; // a shared phone at the door should not stay signed in for days
const ACTIVITY_KEY = 'hemshech-last-active';

type AuthState = { session: Session | null; ready: boolean };
const AuthCtx = createContext<AuthState>({ session: null, ready: false });

function touch() {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* storage blocked: idle sign-out simply does not apply */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, ready: false });
  const qc = useQueryClient();

  useEffect(() => {
    let alive = true;
    (async () => {
      let last = 0;
      try {
        last = Number(localStorage.getItem(ACTIVITY_KEY) ?? 0);
      } catch { /* ignore */ }
      const { data } = await supabase.auth.getSession();
      if (data.session && last && Date.now() - last > IDLE_LIMIT_MS) {
        await supabase.auth.signOut();
        if (alive) setState({ session: null, ready: true });
        return;
      }
      if (alive) setState({ session: data.session, ready: true });
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, ready: true });
      if (event === 'SIGNED_OUT') qc.clear();
      if (event === 'SIGNED_IN') touch();
    });
    const onActivity = () => touch();
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [qc]);

  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function useMe() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['me', session?.user.id],
    enabled: !!session,
    staleTime: 60_000,
    queryFn: async (): Promise<Staff | null> => {
      const { data, error } = await supabase.rpc('staff_me');
      if (error) throw error;
      return (data as Staff) ?? null;
    },
  });
}

/** The signed-in staff member's role (null while loading or when not staff). */
export function useRole(): Role | null {
  const me = useMe();
  return me.data?.is_active && !me.data.must_change_password ? me.data.role : null;
}

export const can = {
  manage: (r: Role | null) => r === 'admin' || r === 'coordinator',
  admin: (r: Role | null) => r === 'admin',
};

export async function signOut() {
  await supabase.auth.signOut();
}

/** Calls the staff-admin Edge Function with the current session. */
export async function staffAdmin<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/staff-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw { message: 'network' };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw { message: json.error ?? 'unknown', status: res.status };
  return json as T;
}

/** Sign-in with phone + password: the server finds the staff account by phone and returns a session. */
export async function signInWithPhonePassword(phone: string, password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/staff-admin?login=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    });
  } catch {
    throw { message: 'network' };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw { message: json.error ?? 'invalid_login', status: res.status };
  const { error } = await supabase.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token });
  if (error) throw { message: 'invalid_login' };
}

/** First entry by a personal link: sets the person's own email and signs them in (no email is sent). */
export async function claimInvite(token: string, email: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/staff-admin?claim=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email }),
    });
  } catch {
    throw { message: 'network' };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw { message: json.error ?? 'unknown', status: res.status };
  const { error } = await supabase.auth.verifyOtp({ token_hash: json.token_hash, type: 'magiclink' });
  if (error) throw { message: 'invite_invalid' };
}

/**
 * The staff account could not be loaded (no connection, or the server failed): an in-app page with one retry, never the
 * login page's "this account is not active" (that is only for an account that really is missing or blocked).
 */
function AccountUnavailable({ error, onRetry, busy }: { error: unknown; onRetry: () => void; busy: boolean }) {
  const offline = errorCode(error) === 'network' || error == null;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-panel)] bg-ink text-light">
        <Icon name="alert" size={26} />
      </div>
      <h1 className="font-display text-title-sm">{offline ? 'אין חיבור' : 'לא הצלחנו לטעון את החשבון'}</h1>
      <p className="mt-2 text-body text-ink-soft">
        {offline ? 'אין חיבור לשרת כרגע. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.' : errorMessage(error)}
      </p>
      <Button className="mt-5" onClick={onRetry} busy={busy}>{RETRY_LABEL}</Button>
    </main>
  );
}

/** Guards a staff route: signed in, active, password changed, and one of the allowed roles. */
export function RequireStaff({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { session, ready } = useAuth();
  const me = useMe();
  const location = useLocation();
  // offline on (re)load: React Query pauses the query (pending, not loading) — that is "no connection", not "denied"
  if (session && me.isPending && me.fetchStatus === 'paused') {
    return <AccountUnavailable error={null} onRetry={() => void me.refetch()} busy={false} />;
  }
  if (!ready || (session && me.isPending)) {
    return <div className="mx-auto max-w-3xl p-8"><Skeleton lines={5} /></div>;
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // the account could not be loaded (network or server error, nothing cached): retry, don't send to the login page
  if (me.isError && me.data === undefined) {
    return <AccountUnavailable error={me.error} onRetry={() => void me.refetch()} busy={me.isFetching} />;
  }
  if (!me.data || !me.data.is_active) return <Navigate to="/login?denied=1" replace />;
  // two-step sign-in turned on: the database gives this session no role until the code is entered
  if (me.data.mfa_enrolled && me.data.aal !== 'aal2') return <Navigate to="/mfa" replace state={{ from: location.pathname + location.search }} />;
  if (me.data.must_change_password) return <Navigate to="/password" replace />;
  if (roles && !roles.includes(me.data.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
