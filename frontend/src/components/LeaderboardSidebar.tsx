import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: { name: string; picture: string };
  tripsCount: number;
}

type LeaderboardUser = { name: string; tier: string; score: number; color: string; isMe?: boolean };

const mockUsers: LeaderboardUser[] = [
  { name: 'Alex M.', tier: 'Cosmic Legend', score: 9800, color: '#FFC46B' },
  { name: 'Sarah J.', tier: 'Cosmic Legend', score: 9200, color: '#FFC46B' },
  { name: 'Chris T.', tier: 'Initiator', score: 7500, color: '#9d8cdb' },
  { name: 'Elena R.', tier: 'Controller', score: 6200, color: '#6bc7ff' },
  { name: 'Mike L.', tier: 'Peacemaker', score: 4100, color: '#76e5b1' },
];

export const LeaderboardSidebar = ({ open, onClose, profile, tripsCount }: Props) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Derive my score
  let created = 0;
  try { created = Number(localStorage.getItem('simpli_trips_created')) || 0; } catch {}
  let myScore = (created * 1000) + (tripsCount * 500) + 1200; // Base score + bonuses
  
  // Resolve my tier
  let myTier = 'Newbie';
  let myColor = '#a3b1c6';
  if (myScore >= 9000) { myTier = 'Cosmic Legend'; myColor = '#FFC46B'; }
  else if (myScore >= 7000) { myTier = 'Initiator'; myColor = '#9d8cdb'; }
  else if (myScore >= 5000) { myTier = 'Controller'; myColor = '#6bc7ff'; }
  else if (myScore >= 3000) { myTier = 'Peacemaker'; myColor = '#76e5b1'; }
  else if (myScore >= 1000) { myTier = 'Explorer'; myColor = '#d98a6c'; }

  const allUsers = [...mockUsers, { name: profile.name + ' (You)', tier: myTier, score: myScore, color: myColor, isMe: true }].sort((a, b) => b.score - a.score);

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
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 24, stiffness: 200 }}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 400,
              background: 'rgba(5,6,10,0.95)', borderLeft: '1px solid var(--glass-brd)',
              zIndex: 91, display: 'flex', flexDirection: 'column',
              boxShadow: '-20px 0 80px rgba(0,0,0,0.6)',
              backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
            }}
          >
            <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid var(--glass-brd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 className="font-clash" style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: 'var(--text)' }}>Leaderboard</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: 4 }}>See how you rank in the universe</div>
              </div>
              <button onClick={onClose} style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-brd)',
                color: 'var(--text)', width: 40, height: 40, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                fontSize: '1.2rem', paddingBottom: 2
              }}>&times;</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {allUsers.map((u, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 16,
                  background: u.isMe ? `linear-gradient(90deg, ${u.color}15, rgba(5,6,10,0))` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${u.isMe ? u.color + '40' : 'var(--glass-brd)'}`,
                }}>
                  <div style={{
                    width: 32, fontSize: '1.2rem', fontWeight: 700, color: i < 3 ? '#FFC46B' : 'var(--text-dim)',
                    textAlign: 'center', fontVariantNumeric: 'tabular-nums'
                  }}>
                    #{i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: u.isMe ? 700 : 500, color: 'var(--text)' }}>{u.name}</div>
                    <div style={{ fontSize: '0.8rem', color: u.color, marginTop: 4, fontWeight: 600 }}>{u.tier}</div>
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                    {u.score.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
            
            <div style={{ padding: 24, borderTop: '1px solid var(--glass-brd)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
                Scores are determined by trips created, joined, and expenses settled. Keep exploring to climb the ranks!
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
