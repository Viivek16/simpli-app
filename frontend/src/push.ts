/**
 * Web Push subscription (client side).
 *
 * This is a strict enhancement over the in-app / foreground notifications in
 * notifications.ts. It only does anything when:
 *   1. VITE_VAPID_PUBLIC_KEY is set at build time, and
 *   2. the browser supports the Push API, and
 *   3. the user has granted notification permission.
 *
 * When those hold, we subscribe via the service worker's PushManager and hand the
 * subscription to the module (savePushSubscription reducer). The external
 * push-sender service reads those rows and delivers pushes when the app is closed.
 *
 * If VITE_VAPID_PUBLIC_KEY is absent (default), every function here is a safe no-op,
 * so shipping this file changes nothing until push infrastructure is configured.
 */
import * as StDB from './spacetimedb';

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || '';

export const pushConfigured = (): boolean => !!VAPID_PUBLIC_KEY;

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

const keyToB64 = (buf: ArrayBuffer | null): string => {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // base64url (no padding) — what web-push expects.
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const supported = (): boolean =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
  typeof window !== 'undefined' && 'PushManager' in window &&
  typeof Notification !== 'undefined';

/**
 * Ensure a push subscription exists for this device and register it with the module.
 * Idempotent — safe to call on every load and after permission is granted.
 */
export const enablePush = async (): Promise<void> => {
  try {
    if (!VAPID_PUBLIC_KEY || !supported()) return;
    if (Notification.permission !== 'granted') return;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    const json = sub.toJSON();
    const endpoint = sub.endpoint;
    const p256dh = json.keys?.p256dh || keyToB64(sub.getKey('p256dh'));
    const auth = json.keys?.auth || keyToB64(sub.getKey('auth'));
    if (!endpoint || !p256dh || !auth) return;

    const c = StDB.conn as any;
    // The reducer only exists once the module is republished + bindings regenerated.
    if (c?.reducers?.savePushSubscription) {
      c.reducers.savePushSubscription({ endpoint, p256dh, auth });
    }
  } catch (e) {
    // Non-fatal: this is an enhancement layer over in-app notifications.
    console.warn('[push] enable failed', e);
  }
};

/** Remove this device's push subscription (used on logout). */
export const disablePush = async (): Promise<void> => {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    const c = StDB.conn as any;
    if (c?.reducers?.deletePushSubscription) c.reducers.deletePushSubscription({ endpoint });
  } catch { /* ignore */ }
};
