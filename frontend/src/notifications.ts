import { toast } from './components/Toast';

export const notificationsSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

// Trip ids the local user is deleting, so the notifier can skip a duplicate message for the actor.
export const selfDeletedTrips = new Set<string>();

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!notificationsSupported()) return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch { return false; }
};

// Focused app: in-app toast. Hidden but alive + permission granted: OS notification via the service worker.
// Hidden without permission: nothing (a push server would be required, which is out of scope).
export const showAppNotification = (message: string): void => {
  const focused = typeof document !== 'undefined' && document.visibilityState === 'visible';
  if (focused) {
    toast.info(message);
    return;
  }
  if (notificationsSupported() && Notification.permission === 'granted') {
    const title = 'SIMPLI';
    const opts: any = { body: message, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'simpli-activity', renotify: true };
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(title, opts))
          .catch(() => { try { new Notification(title, opts); } catch {} });
      } else {
        new Notification(title, opts);
      }
    } catch {}
  }
};
