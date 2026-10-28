// Personal data that should follow you between devices (predictions): saved on the Pit Wall
// server on the Mac (so the iPad sees it too), or in your Firebase account on the hosted site.
// A copy is always kept in this browser as a fallback.
import { HOSTED } from '../env';

const local = (key: string) => 'pitwall.user.' + key;

function readLocal<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(local(key)) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

export async function loadUserData<T>(key: string): Promise<T | null> {
  try {
    if (!HOSTED) {
      const r = await fetch(`/api/user/${key}`);
      if (r.ok) {
        const v = (await r.json()) as T | null;
        if (v != null) return v;
      }
    } else {
      const fb = await import('../firebase');
      if (fb.firebaseEnabled) {
        const v = await fb.readUserData<T>(key);
        if (v != null) return v;
      }
    }
  } catch {
    // offline or not signed in: use this browser's copy
  }
  return readLocal<T>(key);
}

export async function saveUserData(key: string, value: unknown) {
  try {
    localStorage.setItem(local(key), JSON.stringify(value));
  } catch {
    // ignore
  }
  try {
    if (!HOSTED) {
      await fetch(`/api/user/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    } else {
      const fb = await import('../firebase');
      if (fb.firebaseEnabled) await fb.writeUserData(key, value);
    }
  } catch {
    // kept locally; will sync next time
  }
}
