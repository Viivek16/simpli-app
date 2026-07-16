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

/** Notification tag for a galaxy. Must match the tag /api/notify puts on its pushes:
 *  when the app is open but backgrounded BOTH fire for the same event, and a shared
 *  tag is what collapses them into one notification instead of two. */
export const tagForTrip = (tripId: string): string => `simpli-${tripId}`;

type AppNotifyOpts = {
  /** Galaxy name — the notification title. The shade prints the app name itself, so
   *  titling it 'SIMPLI' only says it twice. */
  title?: string;
  /** OS notification body. Defaults to `message`; pass this when the toast wants the
   *  galaxy inline but the notification carries it in the title instead. */
  body?: string;
  tag?: string;
  url?: string;
};

// Focused app: in-app toast. Hidden but alive + permission granted: OS notification via
// the service worker. Hidden with the app closed: Web Push handles it (see /api/notify).
export const showAppNotification = (message: string, opts: AppNotifyOpts = {}): void => {
  const focused = typeof document !== 'undefined' && document.visibilityState === 'visible';
  if (focused) {
    toast.info(message);
    return;
  }
  if (notificationsSupported() && Notification.permission === 'granted') {
    const title = opts.title || 'SIMPLI';
    const base = {
      body: opts.body ?? message,
      // Monochrome/alpha-only — Android stencils this and tints it to the system theme.
      badge: '/badge-96.png',
      icon: '/notif-192.png',
      tag: opts.tag || 'simpli',
      renotify: true,
      timestamp: Date.now(),
      data: { url: opts.url || '/' },
    };
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          // `actions` only exist on the service worker path; the constructor rejects them.
          .then((reg) => reg.showNotification(title, { ...base, actions: [{ action: 'open', title: 'View' }] } as any))
          .catch(() => { try { new Notification(title, base as any); } catch {} });
      } else {
        new Notification(title, base as any);
      }
    } catch {}
  }
};
