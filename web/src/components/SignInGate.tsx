import { useEffect, useState, type ReactNode } from 'react';
import { firebaseEnabled, signIn, signOut, startSync, watchUser, type SignedIn } from '../firebase';
import { Footer } from './Footer';

/** Hosted build: nothing shows until you've signed in with an allowed Google account. */
export function SignInGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SignedIn | null | 'loading'>(firebaseEnabled ? 'loading' : null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firebaseEnabled) return;
    let synced = false;
    let unsubscribe: (() => void) | undefined;
    watchUser((u) => {
      setUser(u);
      if (u?.allowed && !synced) {
        synced = true;
        void startSync(u.uid);
      }
    }).then((off) => (unsubscribe = off), (e) => setError(String(e.message ?? e)));
    return () => unsubscribe?.();
  }, []);

  if (!firebaseEnabled) return <>{children}</>;
  if (user !== 'loading' && user?.allowed) return <>{children}</>;

  return (
    <div className="signin">
      <div className="signin-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="brand-mark" style={{ width: 12, height: 26 }} />
          <h1 style={{ margin: 0 }}>Pit Wall</h1>
        </div>
        {user === 'loading' ? (
          <p className="muted">Checking your sign-in…</p>
        ) : user && !user.allowed ? (
          <>
            <p>
              <b>{user.email}</b> isn't on the list of people who can use this Pit Wall.
            </p>
            <button className="btn" onClick={() => signOut()}>Sign in with a different account</button>
          </>
        ) : (
          <>
            <p className="muted">Private pit wall. Sign in to continue.</p>
            <button className="btn primary big" onClick={() => signIn().catch((e) => setError(String(e.message ?? e)))}>
              Sign in with Google
            </button>
          </>
        )}
        {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
        <Footer />
      </div>
    </div>
  );
}

/** "Signed in as … · Sign out", for the home page. */
export function AccountLine() {
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (!firebaseEnabled) return;
    let off: (() => void) | undefined;
    watchUser((u) => setEmail(u?.email ?? '')).then((f) => (off = f));
    return () => off?.();
  }, []);
  if (!firebaseEnabled || !email) return null;
  return (
    <div className="muted" style={{ fontSize: 12 }}>
      Signed in as {email} ·{' '}
      <button className="icon-btn" onClick={() => signOut()}>Sign out</button>
    </div>
  );
}
