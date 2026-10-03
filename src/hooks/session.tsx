import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { getProfile, type Profile } from '@/lib/api';
import { completeLinkSignIn } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

interface SessionState {
  session: Session | null;
  profile: Profile | null;
  /** True until the stored session (and its profile) has been loaded. */
  loading: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // Keyed by user so a previous user's profile or error is never shown after a switch.
  const [profileState, setProfileState] = useState<{ userId: string; profile: Profile | null; error: string | null } | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    // An email sign-in link brings its session in the URL; store it first.
    completeLinkSignIn()
      .catch(() => undefined)
      .then(() => supabase.auth.getSession())
      .then(({ data }) => {
        setSession(data.session);
        setSessionLoaded(true);
      });
    // Fires on sign-in, token refresh, sign-out, and failed refresh of a revoked session.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // SessionExpiredError signs out, which clears `session` and routes to sign-in.
  const fetchProfile = useCallback(
    (forUser: string) =>
      getProfile().then(
        (profile) => ({ userId: forUser, profile, error: null }),
        (e: unknown) => ({ userId: forUser, profile: null, error: e instanceof Error ? e.message : 'INTERNAL_ERROR' }),
      ),
    [],
  );

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId).then((next) => active && setProfileState(next));
    return () => {
      active = false;
    };
  }, [userId, fetchProfile]);

  const current = profileState && profileState.userId === userId ? profileState : null;
  const profile = current?.profile ?? null;
  const profileError = current?.error ?? null;

  const refreshProfile = useCallback(async () => {
    if (userId) setProfileState(await fetchProfile(userId));
  }, [userId, fetchProfile]);

  const loading = !sessionLoaded || (!!userId && !profile && !profileError);

  return (
    <SessionContext.Provider value={{ session, profile, loading, profileError, refreshProfile }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
