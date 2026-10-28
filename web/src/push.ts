// Notifications on this device (hosted site only): sign the device up for web push and keep
// its choices in the Firebase database, where the GitHub Action that sends them looks.
import { pushPublicKey, removePushDevice, savePushDevice } from './firebase';

export interface PushPrefs {
  reminders: 'off' | 'main' | 'all';
  incidents: boolean;
  results: boolean;
  /** Follows spoiler-free mode: no results, and alerts don't say who's leading. */
  spoilerFree?: boolean;
}
export const DEFAULT_PREFS: PushPrefs = { reminders: 'main', incidents: true, results: true };
const PREFS_KEY = 'pitwall.push.prefs';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || !!(navigator as { standalone?: boolean }).standalone;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

export function savedPrefs(): PushPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** This device's subscription, if it has one. */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** A short stable id for a subscription (its endpoint is too long and has characters the database won't take). */
async function deviceId(sub: PushSubscription) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
  return [...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  return 'Computer';
}

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Ask permission (must follow a tap), subscribe, and save the choices. */
export async function enablePush(prefs: PushPrefs) {
  if (!pushSupported()) throw new Error("This browser can't receive notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser or device settings, then try again.');
  const key = await pushPublicKey();
  if (!key) throw new Error('Notifications are still being set up on the server side. Try again in 10 minutes.');
  registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Signed with different keys (shouldn't happen, but would silently drop every push): start again.
  const current = sub?.options.applicationServerKey;
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))) !== btoa(String.fromCharCode(...keyBytes(key)))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await savePushDevice(await deviceId(sub), { sub: sub.toJSON(), prefs, device: deviceName(), at: Date.now() });
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await removePushDevice(await deviceId(sub)).catch(() => undefined);
  await sub.unsubscribe();
}

/** Show a notification straight away, to check this device displays them. */
export async function localTest() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Pit Wall', { body: 'This is how alerts will look on this device.', icon: '/icon-192.png', tag: 'local-test' });
}
