// Hosted build only: Google sign-in (restricted to allowed emails) and syncing the shared
// clock across your devices through Firebase Realtime Database. Loaded on demand, so the
// local (Mac) build never pulls in Firebase.
import config from './hosting.config.json';
import { HOSTED } from './env';
import { attachRemote, receiveRemote, setLinkStatus, setServerOffset, type SyncedState } from './sync/clock';

type FirebaseOptions = Record<string, string>;
const firebaseConfig = config.firebase as FirebaseOptions | null;
const allowed = (config.allowedEmails as string[]).map((e) => e.toLowerCase());

// VITE_TEST_NO_SIGNIN only works on the development server (for automated testing), never in a build.
export const firebaseEnabled = HOSTED && !!firebaseConfig && !(import.meta.env.DEV && import.meta.env.VITE_TEST_NO_SIGNIN);

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
    // A home-screen app signs in by redirect, which Safari only allows from the site's own
    // domain, so use the hosting domain for sign-in there (it serves the same sign-in pages).
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
    const ownDomain = /\.(web\.app|firebaseapp\.com)$/.test(location.hostname) && location.hostname.startsWith(firebaseConfig!.projectId);
    const app = initializeApp(standalone && ownDomain ? { ...firebaseConfig!, authDomain: location.hostname } : firebaseConfig!);
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

/** Read a small piece of personal data (e.g. predictions) stored under this account. */
export async function readUserData<T>(key: string): Promise<T | null> {
  const { auth, db, dbMod } = await load();
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const snap = await dbMod.get(dbMod.ref(db, `rooms/${uid}/data/${key}`));
  const v = snap.val();
  return v == null ? null : (JSON.parse(v) as T);
}

/** Save personal data under this account (stored as one JSON string to keep empty arrays). */
export async function writeUserData(key: string, value: unknown) {
  const { auth, db, dbMod } = await load();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await dbMod.set(dbMod.ref(db, `rooms/${uid}/data/${key}`), JSON.stringify(value));
}

// ---- notifications (web push; sent by the GitHub Action in server/notify.ts) ----

/** The public key pushes are signed with (made by the Action on its first run). */
export async function pushPublicKey(): Promise<string | null> {
  const { db, dbMod } = await load();
  return (await dbMod.get(dbMod.ref(db, 'notify/public/vapidKey'))).val();
}

/** Save (or update) this device's push subscription and what it wants to hear about. */
export async function savePushDevice(id: string, device: unknown) {
  const { auth, db, dbMod } = await load();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in first.');
  await dbMod.set(dbMod.ref(db, `rooms/${uid}/push/${id}`), device);
}

export async function removePushDevice(id: string) {
  const { auth, db, dbMod } = await load();
  const uid = auth.currentUser?.uid;
  if (uid) await dbMod.remove(dbMod.ref(db, `rooms/${uid}/push/${id}`));
}
