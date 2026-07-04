/**
 * Global toast system — call toast.success() / toast.error() / toast.info() from anywhere.
 * One <Toaster /> instance in App root is all that's needed.
 */
import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

// Singleton store
let listeners: Array<(items: ToastItem[]) => void> = [];
let items: ToastItem[] = [];

const notify = (message: string, variant: ToastVariant) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  items = [...items, { id, message, variant }];
  listeners.forEach(l => l(items));
  setTimeout(() => {
    items = items.filter(t => t.id !== id);
    listeners.forEach(l => l(items));
  }, 3200);
};

export const toast = {
  success: (msg: string) => notify(msg, 'success'),
  error: (msg: string) => notify(msg, 'error'),
  info: (msg: string) => notify(msg, 'info'),
};

const VARIANT_COLORS = {
  success: { bg: 'rgba(111,186,138,0.12)', border: '#6fba8a', color: '#6fba8a' },
  error:   { bg: 'rgba(217,138,108,0.12)', border: '#d98a6c', color: '#d98a6c' },
  info:    { bg: 'rgba(156,174,169,0.10)', border: '#9bafa4', color: '#9bafa4' },
};

const VARIANT_ICONS = {
  success: '✓',
  error:   '⚠',
  info:    '●',
};

export const Toaster = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (newItems: ToastItem[]) => setToasts([...newItems]);
    listeners.push(handler);
    return () => { listeners = listeners.filter(l => l !== handler); };
  }, []);

  return (
    <div style={{
      position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, display: 'flex', flexDirection: 'column', gap: '8px',
      alignItems: 'center', pointerEvents: 'none',
    }}>
      <AnimatePresence>
        {toasts.map(t => {
          const c = VARIANT_COLORS[t.variant];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              style={{
                pointerEvents: 'all',
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: '14px',
                padding: '10px 18px',
                color: c.color,
                fontWeight: 600,
                fontSize: '0.875rem',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ fontWeight: 700 }}>{VARIANT_ICONS[t.variant]}</span>
              {t.message}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
