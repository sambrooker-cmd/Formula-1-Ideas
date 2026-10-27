// Hosted build only: Google sign-in (restricted to allowed emails) and syncing the shared
// clock across your devices through Firebase Realtime Database. Loaded on demand, so the
// local (Mac) build never pulls in Firebase.
import config from './hosting.config.json';
import { HOSTED } from './env';
import { attachRemote, receiveRemote, setLinkStatus, setServerOffset, type SyncedState } from './sync/clock';

type FirebaseOptions = Record<string, string>;
const firebaseConfig = config.firebase as FirebaseOptions | null;
const allowed = (config.allowedEmails as string[]).map((e) => e.toLowerCase());

export const firebaseEnabled = HOSTED && !!firebaseConfig;

export interface SignedIn {
  email: string;
  uid: string;
  allowed: boolean;
}

let services: Promise<{
  auth: import('firebase/auth').Auth;
  db: import('firebase/database').Database;
  authMod: typeof import('firebase/auth');
  dbMod: typeof import('firebase/database');
}> | null = null;

function load() {
  services ??= (async () => {
    const [{ initializeApp }, authMod, dbMod] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/database')]);
    const app = initializeApp(firebaseConfig!);
    return { auth: authMod.getAuth(app), db: dbMod.getDatabase(app), authMod, dbMod };
  })();
  return services;
}

/** Calls back with the signed-in user (or null) now and whenever it changes. */
export async function watchUser(cb: (user: SignedIn | null) => void) {
  const { auth, authMod } = await load();
  await authMod.getRedirectResult(auth).catch(() => null); // finishes a redirect sign-in, if one happened
  return authMod.onAuthStateChanged(auth, (u) => {
    if (!u) return cb(null);
    const email = (u.email ?? '').toLowerCase();
    cb({ email, uid: u.uid, allowed: u.emailVerified && allowed.includes(email) });
  });
}

export async function signIn() {
  const { auth, authMod } = await load();
  const provider = new authMod.GoogleAuthProvider();
  // A home-screen app on iPhone/iPad can't open pop-ups; use a full-page redirect there.
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  if (standalone) return authMod.signInWithRedirect(auth, provider);
  try {
    await authMod.signInWithPopup(auth, provider);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/popup-blocked') await authMod.signInWithRedirect(auth, provider);
    else throw err;
  }
}

export async function signOut() {
  const { auth, authMod } = await load();
  await authMod.signOut(auth);
}

// Realtime Database can't store NaN or empty arrays; restore them on the way back in.
const toDb = (s: SyncedState) => JSON.parse(JSON.stringify(s, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? null : v)));
const fromDb = (v: Record<string, unknown>): SyncedState =>
  ({
    ...v,
    anchorT: v.anchorT ?? NaN,
    liveT0: v.liveT0 ?? NaN,
    selected: (v.selected as number[] | undefined) ?? [],
  }) as SyncedState;

/** Keep this window's clock in step with every other device signed in to the same account. */
export async function startSync(uid: string) {
  const { db, dbMod } = await load();
  const { ref, set, onValue, push, onDisconnect, serverTimestamp } = dbMod;
  const room = `rooms/${uid}`;
  const clockRef = ref(db, `${room}/clock`);

  onValue(ref(db, '.info/serverTimeOffset'), (snap) => setServerOffset(Number(snap.val()) || 0));
  onValue(clockRef, (snap) => {
    const v = snap.val();
    if (v) receiveRemote(fromDb(v));
  });
  attachRemote({ send: (state) => void set(clockRef, toDb(state)).catch(() => undefined) });

  // Presence: each open window registers itself, so the playback bar can say how many are linked.
  const presence = ref(db, `${room}/presence`);
  let connected = false;
  let peers = 0;
  onValue(ref(db, '.info/connected'), (snap) => {
    connected = snap.val() === true;
    if (connected) {
      const me = push(presence);
      void onDisconnect(me).remove();
      void set(me, serverTimestamp());
    }
    setLinkStatus({ connected, peers });
  });
  onValue(presence, (snap) => {
    peers = snap.size;
    setLinkStatus({ connected, peers });
  });
}
