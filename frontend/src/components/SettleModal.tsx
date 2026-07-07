import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as StDB from '../spacetimedb';
import { toast } from './Toast';
import { AudioService } from '../audio';

const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

interface Props {
  payload: { payerId: string; payeeId: string; amount: number } | null;
  onClose: () => void;
  tripId: string;
  userMap: Map<string, string>;
  localId: string;
}

export const SettleModal = ({ payload, onClose, tripId, userMap, localId }: Props) => {
  const [amountStr, setAmountStr] = useState('');
  const [phase, setPhase] = useState<'form' | 'busy' | 'done'>('form');

  useEffect(() => {
    if (payload) {
      setAmountStr(String(Math.round(payload.amount)));
      setPhase('form');
    }
  }, [payload]);

  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase === 'form') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [payload, phase, onClose]);

  if (!payload) return null;

  const nameOf = (id: string) => (id === localId ? 'You' : (userMap.get(id) || 'Member').split(' ')[0]);
  const payerName = nameOf(payload.payerId);
  const payeeName = nameOf(payload.payeeId);
  const parsed = parseFloat(amountStr);
  const valid = !isNaN(parsed) && parsed > 0;

  const submit = async () => {
    if (!valid || phase !== 'form') return;
    setPhase('busy');
    try {
      await (StDB.conn as any).reducers.settleDebt({
        tripId,
        debtorId: payload.payerId,
        payeeId: payload.payeeId,
        amount: Math.round(parsed * 100) / 100,
      });
      AudioService.playBlip();
      setPhase('done');
      setTimeout(() => {
        toast.success(`Settled ${INR(parsed)} with ${payerName === 'You' ? payeeName : payerName}`);
        onClose();
      }, 950);
    } catch (e: any) {
      setPhase('form');
      toast.error(e?.message || 'Settlement failed. Try again.');
    }
  };

  const pill = (label: string, accent: boolean) => (
    <div style={{
      padding: '10px 16px', borderRadius: 999, fontWeight: 700, fontSize: '0.95rem',
      background: accent ? 'linear-gradient(180deg, rgba(255,196,107,0.20), rgba(232,150,58,0.12))' : 'rgba(94,230,255,0.10)',
      border: accent ? '1px solid rgba(255,183,77,0.45)' : '1px solid rgba(94,230,255,0.35)',
      color: accent ? '#FFC46B' : '#5EE6FF', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{label}</div>
  );

  return (
    <AnimatePresence>
      <motion.div
        key="settle-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={() => { if (phase === 'form') onClose(); }}
        style={{
          position: 'fixed', inset: 0, zIndex: 420,
          background: 'rgba(2,4,8,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, pointerEvents: 'all',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 380, borderRadius: 18,
            background: 'rgba(5,6,10,0.94)', border: '1px solid var(--glass-brd)',
            boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
            padding: '28px 24px 22px', position: 'relative',
            backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, minHeight: 300, justifyContent: 'center',
          }}
        >
          {phase !== 'done' ? (
            <>
              <div className="font-clash" style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)' }}>Settle up</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {pill(payerName, payload.payerId === localId)}
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="12" x2="20" y2="12" /><polyline points="13 5 20 12 13 19" />
                </svg>
                {pill(payeeName, payload.payeeId === localId)}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginTop: -8 }}>
                {payerName === 'You' ? `You pay ${payeeName}` : `${payerName} pays ${payeeName === 'You' ? 'you' : payeeName}`}
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)',
                borderRadius: 14, padding: '0 16px', height: 56,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
              }}>
                <span style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-dim)' }}>&#8377;</span>
                <input
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  autoFocus
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: 'var(--text)', fontSize: '1.5rem', fontWeight: 700, fontFamily: 'inherit',
                    fontVariantNumeric: 'tabular-nums', minWidth: 0,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                <button onClick={onClose} disabled={phase === 'busy'} style={{
                  flex: 1, height: 48, borderRadius: 12, background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--glass-brd)', color: 'var(--text)', fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer',
                }}>Cancel</button>
                <button onClick={submit} disabled={!valid || phase === 'busy'} style={{
                  flex: 1, height: 48, borderRadius: 12,
                  background: 'linear-gradient(180deg, #FFC46B, #E8963A)',
                  border: 'none', color: '#ffffff', fontWeight: 700, fontSize: '0.92rem',
                  cursor: valid && phase === 'form' ? 'pointer' : 'default',
                  opacity: valid ? 1 : 0.55,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 8px 22px rgba(232,150,58,0.4)',
                }}>{phase === 'busy' ? 'Settling...' : 'Settle up'}</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '10px 0' }}>
              <div style={{ position: 'relative', width: 88, height: 88, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <motion.div
                  initial={{ scale: 0.4, opacity: 0.8 }}
                  animate={{ scale: 2.1, opacity: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle, rgba(111,186,138,0.5) 0%, transparent 70%)' }}
                />
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 300 }}
                  style={{
                    width: 72, height: 72, borderRadius: '50%',
                    background: 'rgba(111,186,138,0.14)', border: '2px solid #6fba8a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 32px rgba(111,186,138,0.4)',
                  }}
                >
                  <motion.svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#6fba8a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <motion.path d="M4 12.5 10 18.5 20 6.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.1 }} />
                  </motion.svg>
                </motion.div>
              </div>
              <div className="font-clash" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#6fba8a' }}>Settled!</div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
