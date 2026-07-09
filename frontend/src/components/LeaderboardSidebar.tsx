import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';
import { useUserDevice } from '../hooks/useUserDevice';
import { useTrip } from '../hooks/useTrips';
import { resolveNames } from '../lib/names';
import * as StDB from '../spacetimedb';

interface Props {
  open: boolean;
  onClose: () => void;
  myName: string;
}

const norm = (s: any): string => String(s ?? '').toLowerCase().trim();

// Append an alpha byte to a 6-digit hex color (e.g. '#FFC46B' + 0.4 → '#FFC46B66')
const hexA = (hex: string, a: number): string =>
  hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

type Tier = { name: string; color: string };

// Activity-based tiers, ranked. added = non-settlement expenses this person paid,
// settled = settlement payments they made, trips = distinct trips they appear in.
const resolveTier = (added: number, settled: number, trips: number): Tier => {
  if (added >= 10 && settled >= 3) return { name: 'Cosmic Legend', color: '#FFC46B' };
  if (added >= 6 || trips >= 3) return { name: 'Initiator', color: '#B79CFF' };
  if (added >= 3) return { name: 'Controller', color: '#5EE6FF' };
  if (settled >= 2) return { name: 'Peacemaker', color: '#6FE29B' };
  if (added >= 1 || trips >= 1) return { name: 'Explorer', color: '#FFB74D' };
  return { name: 'Newbie', color: '#9AA3B2' };
};

export const LeaderboardSidebar = ({ open, onClose, myName }: Props) => {
  const expenses = useExpense();
  const splits = useExpenseSplit();
  const allUsers = useUser();
  const userDevices = useUserDevice();
  const myTrips = useTrip();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const me = norm(StDB.getLocalId() ?? '');
    const nameMap = resolveNames(allUsers, userDevices);
    const tripIds = new Set(myTrips.map(t => t.id));
    const mine = expenses.filter(e => tripIds.has(e.tripId));

    type Stat = { id: string; added: number; settled: number; trips: Set<string> };
    const stats = new Map<string, Stat>();
    const ensure = (id: string): Stat => {
      let s = stats.get(id);
      if (!s) { s = { id, added: 0, settled: 0, trips: new Set() }; stats.set(id, s); }
      return s;
    };

    // Always include me so I always appear on the board.
    ensure(me);

    mine.forEach(exp => {
      const payer = norm(exp.payerId);
      const isSettle = (exp.description || '') === 'Debt settlement';
      const ps = ensure(payer);
      ps.trips.add(exp.tripId);
      if (isSettle) ps.settled += 1; else ps.added += 1;
      splits.filter(s => s.expenseId === exp.id).forEach(s => {
        const d = ensure(norm(s.debtorId));
        d.trips.add(exp.tripId);
      });
    });

    const list = [...stats.values()].map(s => {
      const trips = s.trips.size;
      const score = 100 + s.added * 150 + s.settled * 250 + trips * 200;
      const tier = resolveTier(s.added, s.settled, trips);
      const isMe = s.id === me;
      const baseName = isMe ? (myName || 'You') : (nameMap.get(s.id) || 'Member');
      return { id: s.id, name: isMe ? `${baseName} (You)` : baseName, score, tier, isMe };
    });

    list.sort((a, b) => b.score - a.score || (a.isMe ? -1 : 1));
    return list;
  }, [expenses, splits, allUsers, userDevices, myTrips, myName]);

  const solo = rows.length <= 1;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 90,
              background: 'rgba(2,4,8,0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
            }}
          />
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 24, stiffness: 200 }}
            style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, width: '100%', maxWidth: 400,
              background: 'rgba(5,6,10,0.95)', borderRight: '1px solid var(--glass-brd)',
              zIndex: 91, display: 'flex', flexDirection: 'column',
              boxShadow: '20px 0 80px rgba(0,0,0,0.6)',
              backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
            }}
          >
            <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid var(--glass-brd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 className="font-clash" style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: 'var(--text)' }}>Leaderboard</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: 4 }}>Your universe, ranked</div>
              </div>
              <button onClick={onClose} aria-label="Close leaderboard" style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-brd)',
                color: 'var(--text)', width: 40, height: 40, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                fontSize: '1.2rem', paddingBottom: 2
              }}>&times;</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {solo ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-dim)', padding: '40px 16px', lineHeight: 1.6 }}>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Your board is just getting started</div>
                  Invite friends to a galaxy and start splitting expenses. As people add and settle, they climb the ranks here.
                </div>
              ) : rows.map((u, i) => {
                // Hierarchy glow: brightest at the top, fading to none by rank ~5.
                const strength = Math.max(0, 1 - i * 0.24);
                const glowLo = strength > 0
                  ? `inset 0 1px 0 var(--glass-hi), 0 0 ${Math.round(7 * strength)}px ${hexA(u.tier.color, 0.10 * strength)}`
                  : 'none';
                const glowHi = strength > 0
                  ? `inset 0 1px 0 var(--glass-hi), 0 0 ${Math.round(22 * strength)}px ${hexA(u.tier.color, 0.42 * strength)}`
                  : 'none';
                return (
                <div key={u.id} className="leader-row" style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 16,
                  background: u.isMe ? `linear-gradient(90deg, ${u.tier.color}15, rgba(5,6,10,0))` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${u.isMe ? u.tier.color + '40' : 'var(--glass-brd)'}`,
                  ['--row-shadow-lo' as string]: glowLo,
                  ['--row-shadow-hi' as string]: glowHi,
                  ['--row-delay' as string]: `${(i * 0.18).toFixed(2)}s`,
                }}>
                  <div style={{
                    width: 32, fontSize: '1.2rem', fontWeight: 700, color: i < 3 ? '#FFC46B' : 'var(--text-dim)',
                    textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                    textShadow: i < 3 ? `0 0 ${Math.round(12 * strength)}px ${hexA('#FFC46B', 0.6 * strength)}` : 'none',
                  }}>
                    #{i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: u.isMe ? 700 : 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                    <div style={{ fontSize: '0.8rem', color: u.tier.color, marginTop: 4, fontWeight: 600, textShadow: strength > 0 ? `0 0 ${Math.round(14 * strength)}px ${hexA(u.tier.color, 0.5 * strength)}` : 'none' }}>{u.tier.name}</div>
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                    {u.score.toLocaleString('en-IN')}
                  </div>
                </div>
                );
              })}
            </div>

            <div style={{ padding: 24, borderTop: '1px solid var(--glass-brd)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
                Settle more expenses to climb the ladder and unlock new tiers.
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
