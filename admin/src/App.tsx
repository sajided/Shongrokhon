// Investigation Assistant shell: staff sign-in, analyst check (INV-01), and
// hash routes (#/ queue, #/alert/<id>).
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { AlertDetail } from './AlertDetail';
import { AlertQueue } from './AlertQueue';
import { amIAnalyst, supabase } from './api';

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="signin" onSubmit={async (e) => {
      e.preventDefault();
      const { error: err } = await supabase().auth.signInWithPassword({ email, password });
      setError(err ? 'Wrong email or password.' : null);
    }}>
      <h1>Investigation Assistant</h1>
      <p className="muted">Compliance staff only.</p>
      <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" autoComplete="username" /></label>
      <label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="password" autoComplete="current-password" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" data-testid="sign-in">Sign in</button>
    </form>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [analyst, setAnalyst] = useState<boolean | null>(null);
  const hash = useHash();

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    amIAnalyst().then(setAnalyst, () => setAnalyst(false));
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <main><SignIn /></main>;
  if (analyst === null) return <main><p>Checking access…</p></main>;

  const signOut = () => supabase().auth.signOut();
  if (!analyst) {
    return (
      <main>
        <h1 data-testid="access-denied">Access denied</h1>
        <p>This dashboard is for compliance analysts only.</p>
        <button onClick={signOut}>Sign out</button>
      </main>
    );
  }

  const alertId = hash.match(/^#\/alert\/([0-9a-f-]{36})$/)?.[1];
  return (
    <main>
      <header className="top">
        <strong>Shongrokhon · Investigation Assistant</strong>
        <span>{session.user.email} <button className="link" onClick={signOut} data-testid="sign-out">Sign out</button></span>
      </header>
      {alertId
        ? <AlertDetail id={alertId} onBack={() => { window.location.hash = '#/'; }} />
        : <AlertQueue onOpen={(id) => { window.location.hash = `#/alert/${id}`; }} />}
    </main>
  );
}
