import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as StDB from '../spacetimedb';
import { useExpense } from '../module_bindings/hooks';

const norm = (s: any) => String(s ?? '').toLowerCase().trim();

interface Props {
  open: boolean;
  onClose: () => void;
  profile: { name: string; email: string; picture: string };
  onLogout: () => void;
  tripsCount: number;
}

type Stats = { created: number; added: number; settled: number; joined: number };

// Tiers are resolved by behavior, highest priority first. All signals are client-side.
const resolveTier = (s: Stats): { prefix: string; title: string; description: string } => {
  if (s.created >= 3 && s.added >= 10 && s.settled >= 3) return { prefix: 'Congrats, you are a', title: 'Cosmic Legend', description: 'A legendary master of the cosmos, managing vast groups and flawless settlements.' };
  if (s.created >= 3) return { prefix: 'Congrats, you are an', title: 'Initiator', description: 'You love bringing people together and sparking new journeys across the universe.' };
  if (s.added >= 8) return { prefix: 'Congrats, you are a', title: 'Controller', description: 'A Controller is someone who likes to manage groups, stay on top of all expenses, and settles them up ASAP.' };
  if (s.settled >= 3) return { prefix: 'Congrats, you are a', title: 'Peacemaker', description: 'You restore balance to the cosmos by swiftly settling debts and maintaining harmony.' };
  if (s.joined >= 2 || s.added >= 1) return { prefix: 'Nice, you are an', title: 'Explorer', description: 'You are charting new territories and participating in group adventures.' };
  return { prefix: 'Welcome, you are a', title: 'Newbie', description: 'Go explore the trenches of SIMPLI. Join groups and start adding expenses.' };
};

export const ProfileModal = ({ open, onClose, profile, onLogout, tripsCount }: Props) => {
  const expenses = useExpense();
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (!open) { setConfirmLogout(false); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setConfirmLogout(false); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const stats: Stats = useMemo(() => {
    const me = norm(StDB.getLocalId());
    let added = 0, settled = 0;
    for (const e of expenses) {
      const payer = norm((e as any).payerId ?? (e as any).payer_id);
      if (payer !== me) continue;
      if (((e as any).description || '') === 'Debt settlement') settled++;
      else added++;
    }
    let created = 0;
    try { created = Number(localStorage.getItem('simpli_trips_created')) || 0; } catch {}
    return { created, added, settled, joined: tripsCount };
  }, [expenses, tripsCount, open]);

  const tier = useMemo(() => resolveTier(stats), [stats]);

  const memberSince = useMemo(() => {
    let iso = '';
    try { iso = localStorage.getItem('simpli_member_since') || ''; } catch {}
    const d = iso ? new Date(iso) : new Date();
    const monthYear = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    return { monthYear, days };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'rgba(2,4,8,0.6)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440, borderRadius: 24, overflow: 'hidden',
              background: 'rgba(5,6,10,0.92)', border: '1px solid var(--glass-brd)',
              boxShadow: '0 32px 90px rgba(0,0,0,0.7)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '40px 32px 32px', position: 'relative',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            <button onClick={onClose} aria-label="Close" style={{
              position: 'absolute', top: 12, right: 16, background: 'transparent', border: 'none',
              color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1,
            }}>&times;</button>

            <img src={profile.picture} alt="" style={{
              width: 84, height: 84, borderRadius: '50%',
              border: '2px solid rgba(255,183,77,0.5)', boxShadow: '0 0 24px rgba(255,183,77,0.25)',
            }} />

            <div className="font-clash" style={{ marginTop: 16, fontSize: '1.3rem', fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>
              {profile.name}
            </div>
            <div style={{ marginTop: 2, fontSize: '0.85rem', color: 'var(--text-dim)', textAlign: 'center', wordBreak: 'break-word' }}>
              {profile.email}
            </div>

            {/* Gamified Tier Section */}
            <div style={{
              marginTop: 24, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '24px 20px', borderRadius: 16,
              background: 'linear-gradient(180deg, rgba(255,196,107,0.08), rgba(232,150,58,0.03))',
              border: '1px solid rgba(255,183,77,0.2)',
              position: 'relative', overflow: 'hidden'
            }}>
              {/* Decorative glow */}
              <div style={{ position: 'absolute', top: -30, left: '50%', transform: 'translateX(-50%)', width: 120, height: 60, background: 'rgba(255,196,107,0.2)', filter: 'blur(30px)', borderRadius: '50%' }} />
              
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                {tier.prefix}
              </div>
              
              <div className="font-clash" style={{ 
                fontSize: '2.5rem', fontWeight: 800, 
                background: 'linear-gradient(180deg, #FFFFFF, #FFC46B)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                textShadow: '0 4px 20px rgba(255,196,107,0.3)',
                margin: '8px 0', textAlign: 'center', lineHeight: 1.1
              }}>
                {tier.title}
              </div>
              
              <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.4, maxWidth: 300 }}>
                {tier.description}
              </div>
            </div>

            <div style={{
              marginTop: 18, width: '100%', display: 'flex', justifyContent: 'center', gap: 28,
              paddingTop: 16, borderTop: '1px solid var(--glass-brd)',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{memberSince.monthYear}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2 }}>Member since</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{memberSince.days}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2 }}>Days simplifying</div>
              </div>
            </div>

            {!confirmLogout ? (
              <button onClick={() => setConfirmLogout(true)} style={{
                marginTop: 28, padding: '0 32px', height: 44, borderRadius: 12,
                background: 'rgba(217,138,108,0.10)', border: '1px solid rgba(217,138,108,0.4)',
                color: '#d98a6c', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                transition: 'all 0.2s',
              }}>Log out</button>
            ) : (
              <div style={{ marginTop: 24, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ textAlign: 'center', fontSize: '0.9rem', color: 'var(--text)' }}>Are you sure you want to log out?</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setConfirmLogout(false)} style={{
                    flex: 1, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.06)',
                    border: '1px solid var(--glass-brd)', color: 'var(--text)', fontWeight: 600, cursor: 'pointer',
                  }}>No</button>
                  <button onClick={() => { setConfirmLogout(false); onClose(); onLogout(); }} style={{
                    flex: 1, height: 44, borderRadius: 12, background: '#d98a6c',
                    border: 'none', color: '#0a0d1f', fontWeight: 700, cursor: 'pointer',
                  }}>Yes, log out</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
