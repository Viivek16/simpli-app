import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Mode = 'android' | 'ios' | null;
const DISMISS_KEY = 'simpli_install_dismissed_at';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true;

const recentlyDismissed = () => {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const at = Number(raw);
  return Number.isFinite(at) && (Date.now() - at) < COOLDOWN_MS;
};

export const InstallPrompt = () => {
  const [mode, setMode] = useState<Mode>(null);
  const [deferred, setDeferred] = useState<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile || isStandalone() || recentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setMode('android');
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    };
    window.addEventListener('appinstalled', onInstalled);

    const ua = window.navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    let iosTimer: number | undefined;
    if (isIOS && isSafari) {
      iosTimer = window.setTimeout(() => {
        if (!isStandalone() && !recentlyDismissed()) {
          setMode('ios');
          setVisible(true);
        }
      }, 3500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (iosTimer) window.clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: 'fixed',
            left: 16,
            right: 16,
            bottom: 'calc(16px + env(safe-area-inset-bottom))',
            zIndex: 60,
            pointerEvents: 'all',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: 16,
            borderRadius: 18,
            background: 'rgba(5, 6, 10, 0.82)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            maxWidth: 460,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          <img src="/icon-192.png" alt="SIMPLI" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="font-clash" style={{ color: '#f8f9fa', fontWeight: 700, fontSize: '0.98rem', lineHeight: 1.2 }}>
              Install SIMPLI
            </div>
            {mode === 'android' ? (
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', marginTop: 2 }}>
                Add it to your home screen for the full app experience.
              </div>
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                Tap
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5EE6FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                then Add to Home Screen.
              </div>
            )}
          </div>
          {mode === 'android' && (
            <button
              onClick={install}
              style={{
                flexShrink: 0,
                padding: '10px 18px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(180deg, #FFC46B, #E8963A)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 6px 18px rgba(232,150,58,0.35)',
              }}
            >
              Install
            </button>
          )}
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: '1.4rem',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            &times;
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
