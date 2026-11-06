import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import { functionsUrl, supabase } from './supabase';
import type { Role, Staff } from './types';
import { Skeleton } from '@/ui/kit';

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

/** Guards a staff route: signed in, active, password changed, and one of the allowed roles. */
export function RequireStaff({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { session, ready } = useAuth();
  const me = useMe();
  const location = useLocation();
  if (!ready || (session && me.isLoading)) {
    return <div className="mx-auto max-w-3xl p-8"><Skeleton lines={5} /></div>;
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!me.data || !me.data.is_active) return <Navigate to="/login?denied=1" replace />;
  if (me.data.must_change_password) return <Navigate to="/password" replace />;
  if (roles && !roles.includes(me.data.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
