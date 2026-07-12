/**
 * InviteSheet: branded SIMPLI share sheet.
 *
 * Replaces the copy-only invite with a real share flow. First-class tiles deep-link the
 * channels that genuinely support pre-filled text (WhatsApp, Telegram, Email, SMS, Copy);
 * a "More apps" tile hands off to the native OS sheet via navigator.share for everything
 * else (Instagram, LinkedIn, Signal, Messenger, AirDrop). Contact selection always happens
 * in the target app. We request no contacts and no new permissions, and write nothing to
 * the database. 100 percent client side.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion, type PanInfo } from 'framer-motion';
import { toast } from './Toast';
import { AudioService } from '../audio';
import { BrandMark } from './BrandMark';

interface InviteSheetProps {
  open: boolean;
  onClose: () => void;
  tripName: string;
  shareLink: string;
  inviterName: string; // pass profile.name; the first name is derived inside
  isMobile: boolean;
}

// Stroke icons drawn in the app's line style (no icon library, no hotlinked logos).
const ICONS: Record<string, ReactElement> = {
  whatsapp: (
    <>
      <path d="M12 3.2a8.8 8.8 0 0 0-7.48 13.43L3 21l4.5-1.46A8.8 8.8 0 1 0 12 3.2Z" />
      <path d="M9.2 8.3c.16-.36.33-.37.5-.38h.42c.14 0 .33-.05.51.4.19.46.64 1.6.7 1.72.06.11.1.25.02.4-.08.16-.12.25-.24.39-.12.14-.25.31-.36.42-.12.11-.24.24-.1.47.14.23.62 1.02 1.33 1.65.92.82 1.69 1.07 1.93 1.19.24.12.38.1.52-.06.14-.16.6-.7.76-.94.16-.24.32-.2.53-.12.22.08 1.37.64 1.6.76.24.12.4.18.46.28.06.1.06.58-.14 1.14-.2.56-1.16 1.07-1.62 1.14-.41.06-.94.09-1.51-.1-.35-.11-.8-.26-1.37-.51-2.42-1.04-4-3.47-4.12-3.63-.12-.16-.99-1.32-.99-2.51 0-1.2.62-1.78.85-2.03Z" />
    </>
  ),
  telegram: (
    <>
      <path d="M22 3 2 11l6 2.2" />
      <path d="M22 3 15 21l-4-6.8" />
      <path d="M8 13.2 15 8" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="m3.5 7.2 8.5 5.6 8.5-5.6" />
    </>
  ),
  sms: (
    <>
      <path d="M21 14.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />
      <path d="M8.5 10.2h7M8.5 13h4.5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12.5" height="12.5" rx="2.4" />
      <path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  more: (
    <>
      <circle cx="18" cy="5.5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="18.5" r="2.6" />
      <path d="m8.4 10.8 7.2-4M8.4 13.2l7.2 4" />
    </>
  ),
};

const isIOS = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

export const InviteSheet = ({ open, onClose, tripName, shareLink, inviterName, isMobile }: InviteSheetProps) => {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Build the message once. Always encodeURIComponent before any value enters a URL.
  const { title, body, fullText } = useMemo(() => {
    const firstName = inviterName.split(' ')[0].trim() || 'A friend';
    const t = `Join ${tripName} on SIMPLI - Split Expenses in Cosmos`;
    const b = `${firstName} is inviting you to their trip to ${tripName} on SIMPLI - Split Expenses in Cosmos.`;
    return { title: t, body: b, fullText: `${b}\n\n${shareLink}` };
  }, [inviterName, tripName, shareLink]);

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // Escape to close (mirrors SettleModal). TripRoom's own back handler ignores Escape while
  // the sheet is open, so this never navigates out of the trip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus into the sheet on open, return it to the invite button on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => panelRef.current?.focus());
    return () => { cancelAnimationFrame(id); prev?.focus?.(); };
  }, [open]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const openUrl = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const handleCopy = async () => {
    AudioService.playBlip();
    const confirm = () => {
      setCopied(true);
      toast.success('Invite link copied!');
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareLink);
        confirm();
        return;
      }
      throw new Error('clipboard unavailable');
    } catch {
      // Fallback: select a throwaway textarea and use execCommand. Never let this reject.
      try {
        const ta = document.createElement('textarea');
        ta.value = shareLink;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) { confirm(); return; }
        throw new Error('execCommand failed');
      } catch {
        toast.error('Could not copy. Long-press the link to copy it.');
      }
    }
  };

  const handleNativeShare = async () => {
    AudioService.playBlip();
    try {
      await navigator.share({ title, text: body, url: shareLink });
      onClose();
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user dismissed the native sheet, not an error
      toast.error('Could not open the share sheet.');
    }
  };

  // Tile definitions in order. Copy stays open; every other deep link closes the sheet.
  // color is the channel accent; the tile derives its icon well and hover glow from it.
  const tiles = useMemo(() => {
    const list: { key: string; label: string; icon: ReactElement; color: string; onPress: () => void }[] = [
      {
        key: 'whatsapp', label: 'WhatsApp', icon: ICONS.whatsapp, color: '#4FD07E',
        onPress: () => { AudioService.playBlip(); openUrl(`https://wa.me/?text=${encodeURIComponent(fullText)}`); onClose(); },
      },
      {
        key: 'telegram', label: 'Telegram', icon: ICONS.telegram, color: '#5EE6FF',
        onPress: () => { AudioService.playBlip(); openUrl(`https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(body)}`); onClose(); },
      },
      {
        key: 'email', label: 'Email', icon: ICONS.email, color: '#FFB74D',
        onPress: () => { AudioService.playBlip(); window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(fullText)}`; onClose(); },
      },
    ];

    if (isMobile) {
      list.push({
        key: 'sms', label: 'Message', icon: ICONS.sms, color: '#9DB4FF',
        onPress: () => {
          AudioService.playBlip();
          // iOS wants sms:&body=, everything else sms:?body=. Getting this wrong silently breaks it.
          const url = isIOS() ? `sms:&body=${encodeURIComponent(fullText)}` : `sms:?body=${encodeURIComponent(fullText)}`;
          window.location.href = url;
          onClose();
        },
      });
    }

    list.push({
      key: 'copy', label: copied ? 'Copied' : 'Copy link', icon: copied ? ICONS.check : ICONS.copy,
      color: copied ? '#6FE29B' : '#C7CEDB', onPress: handleCopy,
    });

    if (canNativeShare) {
      list.push({ key: 'more', label: 'More apps', icon: ICONS.more, color: '#A78BFA', onPress: handleNativeShare });
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullText, body, title, shareLink, isMobile, copied, canNativeShare]);

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 650) onClose();
  };

  const backdropStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 430,
    background: 'rgba(2,4,8,0.62)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
    padding: isMobile ? 0 : 20, pointerEvents: 'all',
  };

  // Shared premium glass. Position/size differs by form factor; overflow hidden clips the glow.
  const panelBase: React.CSSProperties = {
    position: 'relative', overflow: 'hidden',
    backdropFilter: 'blur(30px) saturate(1.35)', WebkitBackdropFilter: 'blur(30px) saturate(1.35)',
    display: 'flex', flexDirection: 'column',
  };
  const panelStyle: React.CSSProperties = isMobile
    ? {
        ...panelBase, width: '100%', maxWidth: 540,
        background: 'linear-gradient(180deg, rgba(16,19,28,0.94), rgba(8,10,16,0.94))',
        borderTop: '1px solid var(--glass-hi)', borderRadius: '26px 26px 0 0',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.6), inset 0 1px 0 var(--glass-hi)',
        padding: '10px 20px calc(24px + env(safe-area-inset-bottom))', gap: 18,
      }
    : {
        ...panelBase, width: '100%', maxWidth: 428, borderRadius: 24,
        background: 'linear-gradient(180deg, rgba(16,19,28,0.96), rgba(7,9,14,0.97))',
        border: '1px solid var(--glass-hi)',
        boxShadow: '0 34px 90px rgba(0,0,0,0.66), inset 0 1px 0 var(--glass-hi)',
        padding: '26px 24px 22px', gap: 20,
      };

  // Reduced motion: a plain fade, no spring, no translate. Otherwise mobile springs up from
  // the bottom (Emil restraint, damped, not bouncy); desktop settles in with the app easing.
  const panelMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2 } }
    : isMobile
      ? {
          initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
          transition: { type: 'spring' as const, damping: 36, stiffness: 360 },
        }
      : {
          initial: { opacity: 0, scale: 0.965, y: 14 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.975, y: 10 },
          transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="invite-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          style={backdropStyle}
        >
          <motion.div
            key="invite-panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`Invite people to ${tripName}`}
            onClick={(e) => e.stopPropagation()}
            {...panelMotion}
            {...(isMobile && !reduce
              ? { drag: 'y' as const, dragConstraints: { top: 0, bottom: 0 }, dragElastic: { top: 0, bottom: 0.6 }, onDragEnd }
              : {})}
            style={{ ...panelStyle, outline: 'none' }}
          >
            {/* Warm cosmos glow bleeding down from the top edge. */}
            <div className="invite-sheet-glow" aria-hidden="true" />

            {isMobile && (
              <div className="invite-sheet-handle" aria-hidden="true"><span /></div>
            )}

            {/* Header: brand chip, title + subline, close. */}
            <div className="invite-sheet-head">
              <span className="invite-sheet-brand" aria-hidden="true"><BrandMark size={26} /></span>
              <div className="invite-sheet-titles">
                <div className="font-clash invite-sheet-title">Invite to {tripName}</div>
                <div className="invite-sheet-sub">Anyone with this link can join this galaxy.</div>
              </div>
              <button className="invite-sheet-close" onClick={onClose} aria-label="Close invite">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6 18 18M18 6 6 18" /></svg>
              </button>
            </div>

            {/* Channel tiles */}
            <div className="invite-sheet-grid">
              {tiles.map((tile, i) => (
                <motion.button
                  key={tile.key}
                  type="button"
                  className="invite-tile"
                  style={{ ['--tint' as string]: tile.color } as React.CSSProperties}
                  onClick={tile.onPress}
                  aria-label={tile.key === 'copy' ? 'Copy invite link' : tile.key === 'more' ? 'More sharing apps' : `Share via ${tile.label}`}
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.06 + i * 0.03 }}
                >
                  <span className="invite-tile-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {tile.icon}
                    </svg>
                  </span>
                  <span className="invite-tile-label">{tile.label}</span>
                </motion.button>
              ))}
            </div>

            {/* Selectable link capsule with an inline copy affordance. */}
            <div className="invite-sheet-link">
              <svg className="invite-sheet-link-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              <span className="invite-sheet-link-url" title={shareLink}>{shareLink.replace(/^https?:\/\//, '')}</span>
              <button className="invite-sheet-link-btn" onClick={handleCopy} aria-label="Copy link" data-copied={copied ? 'true' : undefined}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  {copied ? ICONS.check : ICONS.copy}
                </svg>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
