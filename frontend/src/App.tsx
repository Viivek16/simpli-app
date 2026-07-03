import { useEffect, useState, useCallback, useRef } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { motion, AnimatePresence } from 'framer-motion';
import { initSpacetimeDB } from './spacetimedb';
import * as SpacetimeDB from './spacetimedb';
import { useExpense, useExpenseSplit } from './module_bindings/hooks';
import { KarmaBar } from './components/KarmaBar';
import { ExpenseModal } from './components/ExpenseModal';
import { GalaxyBackground } from './components/GalaxyBackground';

const EO = [0.23, 1, 0.32, 1] as const;

interface GoogleProfile { name: string; email: string; picture: string; sub: string; }
export interface Trip { id: string; name: string; }

// ─── Hooks ────────────────────────────────────────────────────────────────────
export function useTrip(): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);
  useEffect(() => {
    const sub = () => {
      const c = SpacetimeDB.conn as any;
      if (!c) return false;
      const load = () => {
        try {
          const allTrips = [...c.db.trip.iter()];
          const memberTripIds = new Set([...c.db.trip_member.iter()].filter((m: any) => m.userId === SpacetimeDB.localIdentity || m.user_id === SpacetimeDB.localIdentity).map((m: any) => m.tripId || m.trip_id));
          setTrips(allTrips.filter(t => memberTripIds.has(t.id)).map((r: any) => ({ id: r.id, name: r.name })));
        }
        catch { setTrips([]); }
      };
      try {
        c.db.trip.onInsert(load); c.db.trip.onUpdate(load); c.db.trip.onDelete(load);
        if (c.db.trip_member) { c.db.trip_member.onInsert(load); c.db.trip_member.onUpdate(load); c.db.trip_member.onDelete(load); }
        load();
        return () => {
          c.db.trip.removeOnInsert(load); c.db.trip.removeOnUpdate(load); c.db.trip.removeOnDelete(load);
          if (c.db.trip_member) { c.db.trip_member.removeOnInsert(load); c.db.trip_member.removeOnUpdate(load); c.db.trip_member.removeOnDelete(load); }
        };
      } catch { return false; }
    };
    const cleanup = sub(); if (cleanup) return cleanup;
    let inner: (() => void) | undefined;
    const u = SpacetimeDB.onSpacetimeConnect(() => { inner = sub() || undefined; });
    return () => { u(); inner?.(); };
  }, []);
  return trips;
}

export function useTripMember(tripId: string): string[] {
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    const sub = () => {
      const c = SpacetimeDB.conn as any;
      if (!c) return false;
      const load = () => {
        try { 
          const iter = c.db.tripMember ? c.db.tripMember.iter() : c.db.trip_member.iter();
          const tripMembers = [...iter].filter((r: any) => r.tripId === tripId || r.trip_id === tripId).map((r: any) => r.userId || r.user_id);
          setMembers([...new Set(tripMembers)] as string[]); // Ensure uniqueness!
        }
        catch { setMembers([]); }
      };
      try {
        const table = c.db.tripMember || c.db.trip_member;
        if (!table) return false;
        table.onInsert(load); table.onUpdate(load); table.onDelete(load);
        load();
        return () => { table.removeOnInsert(load); table.removeOnUpdate(load); table.removeOnDelete(load); };
      } catch { return false; }
    };
    const cleanup = sub(); if (cleanup) return cleanup;
    let inner: (() => void) | undefined;
    const u = SpacetimeDB.onSpacetimeConnect(() => { inner = sub() || undefined; });
    return () => { u(); inner?.(); };
  }, [tripId]);
  return members;
}

function useIsConnected() {
  const [v, setV] = useState(!!SpacetimeDB.conn);
  useEffect(() => {
    const u1 = SpacetimeDB.onSpacetimeConnect(() => setV(true));
    const u2 = SpacetimeDB.onSpacetimeDisconnect(() => setV(false));
    return () => { u1(); u2(); };
  }, []);
  return v;
}

// ─── Shared Styles ────────────────────────────────────────────────────────────
const BTN_GHOST: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#8e8e93', borderRadius: '10px',
  padding: '10px 18px', fontWeight: 600,
  fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0,
  transition: 'background 160ms ease, color 160ms ease',
  fontFamily: 'inherit',
};

// ─── Trip Room (Micro UI) ───────────────────────────────────────────────────
const TripRoom = ({
  trip, profile, isConnected, onBack,
}: {
  trip: Trip; profile: GoogleProfile; isConnected: boolean; onBack: () => void;
}) => {
  const [showModal, setShowModal] = useState(false);
  const expenses = useExpense();
  const splits = useExpenseSplit();
  const tripExpenses = expenses.filter(e => e.tripId === trip.id);

  const shareLink = `${window.location.origin}/t/${trip.id}`;
  const [copied, setCopied] = useState(false);
  const copyInvite = () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <motion.div
      key="trip-room"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: 0.2, duration: 0.6, ease: EO }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10,
        display: 'flex', flexDirection: 'column',
        pointerEvents: 'none',
      }}
    >
      {/* Top bar */}
      <div style={{
        pointerEvents: 'all',
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '16px 24px',
        background: 'linear-gradient(to bottom, rgba(5,5,5,0.9) 0%, rgba(5,5,5,0) 100%)',
      }}>
        <button onClick={onBack} style={{...BTN_GHOST, background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)', color: '#fff' }}>
          ← Back to Cosmos
        </button>
        <div style={{ flex: 1, minWidth: 0, paddingLeft: '12px' }}>
          <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#f8f9fa', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            {trip.name}
          </div>
        </div>

        <div style={{ width: '220px', flexShrink: 0 }}>
          <KarmaBar tripId={trip.id} />
        </div>

        <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: isConnected ? '#9bafa4' : '#555', boxShadow: isConnected ? '0 0 8px #9bafa4' : 'none' }} />
        <img src={profile.picture} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(156,174,169,0.35)' }} />
      </div>

      {/* Floating Manage Expenses Button */}
      <div style={{
        position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
        pointerEvents: 'all', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px'
      }}>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowModal(true)}
          style={{
            background: 'rgba(156,174,169,0.15)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(156,174,169,0.3)',
            borderRadius: '32px',
            padding: '16px 32px',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '1.1rem',
            cursor: 'pointer',
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', gap: '10px'
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>+</span> Manage Expenses
        </motion.button>
      </div>

      {/* Legend / HUD */}
      <div style={{
        position: 'absolute', bottom: '32px', left: '32px',
        pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: '8px',
        background: 'rgba(10,12,11,0.6)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px',
        padding: '16px', color: '#9caca9', fontSize: '0.75rem', fontWeight: 600
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF7A1A' }} /> You
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22D3EE' }} /> Others
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ opacity: 0.7 }}>Glow</span> <span>Bright = High Debt</span> <span>•</span> <span>Planet = Settled</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ opacity: 0.7 }}>Lines</span> <span>Thickness = Debt Amount</span> <span>•</span> <span>Flow = Debtor → Creditor</span>
        </div>
      </div>

      {/* Expense List Panel (Right) */}
      <div style={{
        pointerEvents: 'all',
        position: 'absolute',
        top: 80, right: 24, bottom: 24,
        width: '340px',
        background: 'rgba(10,12,11,0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '24px',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)'
      }}>
        <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8e8e93' }}>
            Trip Ledger {tripExpenses.length > 0 && `(${tripExpenses.length})`}
          </h3>
          
          <button onClick={copyInvite} style={{
            width: '100%', background: 'rgba(156,174,169,0.08)',
            border: '1px solid rgba(156,174,169,0.15)', borderRadius: '12px',
            padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            transition: 'background 180ms ease', fontFamily: 'inherit',
          }}>
            <span style={{ fontSize: '0.75rem', color: '#8e8e93', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shareLink}
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: copied ? '#9bafa4' : '#f8f9fa', flexShrink: 0, marginLeft: '8px' }}>
              {copied ? 'Copied!' : 'Copy Invite'}
            </span>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tripExpenses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#555', fontSize: '0.9rem' }}>
              No expenses recorded in this galaxy yet.
            </div>
          ) : (
            tripExpenses.map((exp, i) => {
              const expSplits = splits.filter(s => s.expenseId === exp.id);
              return (
                <motion.div
                  key={exp.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.3, ease: EO }}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '16px', padding: '14px 16px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f8f9fa' }}>{exp.description}</div>
                    <div style={{ color: '#8e8e93', fontSize: '0.75rem', marginTop: '4px' }}>
                      {expSplits.length > 0 ? `${expSplits.length} splits` : 'Personal'}
                    </div>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#9bafa4', flexShrink: 0 }}>
                    ${exp.amount.toFixed(2)}
                  </span>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      <AnimatePresence>
        {showModal && <ExpenseModal tripId={trip.id} tripName={trip.name} onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Dashboard (Macro UI) ─────────────────────────────────────────────────────
const Dashboard = ({
  profile, isConnected, onLogout, onSelectTrip,
}: {
  profile: GoogleProfile; isConnected: boolean; onLogout: () => void; onSelectTrip: (trip: Trip) => void;
}) => {
  const [newTripName, setNewTripName] = useState('');
  const [uiMsg, setUiMsg] = useState<{ text: string; err: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = (text: string, err = false) => {
    clearTimeout(timerRef.current);
    setUiMsg({ text, err });
    timerRef.current = setTimeout(() => setUiMsg(null), 3200);
  };

  const handleCreate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const name = newTripName.trim();
    if (!name) return;
    const c = SpacetimeDB.conn as any;
    if (!c) { flash('Not connected — try again in a moment.', true); return; }
    try {
      const tripId = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      c.reducers.createTrip({ tripId, name });
      setNewTripName('');
      onSelectTrip({ id: tripId, name });
    } catch (e: any) {
      const msg = e?.message ?? 'Could not create trip.';
      console.error('create_trip failed:', e);
      alert(msg);
      flash(msg, true);
    }
  }, [newTripName, onSelectTrip]);

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.6, ease: EO }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        pointerEvents: 'all', display: 'flex', alignItems: 'center', gap: '12px',
        padding: '24px 32px', background: 'transparent'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'linear-gradient(135deg, rgba(156,174,169,0.3) 0%, rgba(156,174,169,0.05) 100%)', border: '1px solid rgba(156,174,169,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 800, color: '#9bafa4' }}>S</div>
          <span style={{ fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.03em', color: '#f8f9fa' }}>SIMPLI</span>
        </div>
        
        <div style={{ flex: 1 }} />
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? '#9bafa4' : '#555', boxShadow: isConnected ? '0 0 8px #9bafa4' : 'none' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isConnected ? '#9bafa4' : '#8e8e93' }}>{isConnected ? 'Live' : 'Offline'}</span>
        </div>
        
        <img src={profile.picture} alt="" style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid rgba(156,174,169,0.3)' }} />
        <button onClick={onLogout} style={{ ...BTN_GHOST, padding: '8px 16px', fontSize: '0.85rem' }}>Logout</button>
      </div>

      {/* Floating Center Island */}
      <div style={{
        pointerEvents: 'all',
        width: '100%', maxWidth: '640px',
        background: 'rgba(20, 20, 25, 0.4)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '32px',
        padding: '40px',
        display: 'flex', flexDirection: 'column', gap: '32px',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', color: '#f8f9fa' }}>
            Welcome back, {profile.name.split(' ')[0]}
          </h1>
          <p style={{ margin: '8px 0 0', color: '#9caca9', fontSize: '1.1rem' }}>
            Select a galaxy or forge a new one.
          </p>
        </div>

        {/* Trips List inside Island is removed in Macro View */}

        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <input
            value={newTripName} onChange={e => setNewTripName(e.target.value)}
            placeholder="Name your new galaxy..."
            style={{
              flex: 1, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '16px 20px',
              color: 'white', fontSize: '1rem', outline: 'none'
            }}
          />
          <button type="submit" disabled={!newTripName.trim()} style={{ 
            background: '#9bafa4', color: '#000', border: 'none', borderRadius: '16px', 
            padding: '0 24px', fontWeight: 700, cursor: 'pointer', opacity: newTripName.trim() ? 1 : 0.5,
            transition: 'opacity 200ms ease'
          }}>
            Create
          </button>
        </form>
      </div>

      <AnimatePresence>
        {uiMsg && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'absolute', top: '90px', left: '50%',
              background: uiMsg.err ? 'rgba(217, 138, 108, 0.15)' : 'rgba(156, 174, 169, 0.15)',
              border: `1px solid ${uiMsg.err ? '#d98a6c' : '#9bafa4'}`,
              color: uiMsg.err ? '#d98a6c' : '#9bafa4',
              padding: '12px 24px', borderRadius: '16px', fontWeight: 600, fontSize: '0.9rem',
              backdropFilter: 'blur(12px)'
            }}
          >
            {uiMsg.text}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Login View ───────────────────────────────────────────────────────────────
const LoginView = ({ onLogin }: { onLogin: (p: GoogleProfile) => void }) => {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    const u1 = SpacetimeDB.onSpacetimeConnect(() => setDbReady(true));
    const u2 = SpacetimeDB.onSpacetimeConnectError((e) => setDbError(e.message));
    const c = SpacetimeDB.conn;
    if (c) {
      setDbReady(true);
    }
    return () => { u1(); u2(); };
  }, []);

  const handleSuccess = (res: any) => {
    try {
      const profile = jwtDecode<GoogleProfile>(res.credential);
      const c = SpacetimeDB.conn as any;
      if (c) {
        try { c.reducers.createUser({ name: profile.name }); } catch { /* already exists */ }
      }
      onLogin(profile);
    } catch (e) { console.error('[SIMPLI] JWT decode failed', e); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: EO }}
        style={{
          width: '100%', maxWidth: '380px',
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px', padding: '48px 36px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '32px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4, ease: EO }}
          style={{ textAlign: 'center' }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: '20px',
            background: 'linear-gradient(135deg, rgba(156,174,169,0.2) 0%, rgba(156,174,169,0.05) 100%)',
            border: '1px solid rgba(156,174,169,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.6rem', fontWeight: 800, color: '#9bafa4',
            margin: '0 auto 16px', boxShadow: '0 0 32px rgba(156,174,169,0.15)',
          }}>S</div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.04em', color: '#f8f9fa' }}>SIMPLI</h1>
          <p style={{ margin: '6px 0 0', color: '#8e8e93', fontSize: '0.9rem' }}>
            Fair, transparent, effortless.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 16px', background: 'rgba(255,255,255,0.05)',
            borderRadius: '12px', width: '100%', justifyContent: 'center',
          }}
        >
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: dbError ? '#d98a6c' : dbReady ? '#9bafa4' : '#555',
            boxShadow: dbReady ? '0 0 8px #9bafa4' : 'none',
          }} />
          <span style={{ fontSize: '0.8rem', color: dbError ? '#d98a6c' : dbReady ? '#9bafa4' : '#8e8e93', fontWeight: 500 }}>
            {dbError ? `Error: ${dbError}` : dbReady ? 'Database Connected' : 'Connecting to SpacetimeDB...'}
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4, ease: EO }}
          style={{ width: '100%' }}
        >
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => console.error('[SIMPLI] Google login failed')}
            theme="filled_black" shape="pill" size="large" width="308" text="continue_with" useOneTap={false}
          />
        </motion.div>
      </motion.div>
    </div>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────
function App() {
  const [profile, setProfile] = useState<GoogleProfile | null>(() => {
    try {
      const saved = localStorage.getItem('simpli_user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const isConnected = useIsConnected();

const ENABLE_DEMO_SEED = true;

  // Initialize SpacetimeDB globally exactly once
  useEffect(() => {
    initSpacetimeDB();
    const u1 = SpacetimeDB.onSpacetimeConnect(() => {
      const c = SpacetimeDB.conn as any;
      if (c) {
        c.subscriptionBuilder().onApplied(() => {
          if (ENABLE_DEMO_SEED && SpacetimeDB.localIdentity) {
            const hasTrips = [...c.db.trip_member.iter()].some((m: any) => m.userId === SpacetimeDB.localIdentity || m.user_id === SpacetimeDB.localIdentity);
            const seeded = localStorage.getItem('simpli_demo_seeded');
            if (!hasTrips && !seeded) {
              localStorage.setItem('simpli_demo_seeded', 'true');
              const demoTripId = `demo-${Date.now()}`;
              try {
                c.reducers.createTrip({ tripId: demoTripId, name: "Goa Trip 🌊" });
                setTimeout(() => {
                  c.reducers.seedDemo({ tripId: demoTripId });
                }, 1000); // Small delay to let createTrip sync
              } catch (e) {
                console.error('Demo seed failed', e);
              }
            }
          }
        }).subscribe([
          'SELECT * FROM user', 'SELECT * FROM trip',
          'SELECT * FROM expense', 'SELECT * FROM expense_split',
          'SELECT * FROM trip_member',
        ]);
      }
    });
    return () => { u1(); };
  }, []);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/t\/([^/]+)/);
    if (match) {
      const tripId = match[1];
      window.history.replaceState(null, '', '/');
      if (profile) {
        const c = SpacetimeDB.conn as any;
        if (c) {
          try { c.reducers.joinTrip({ tripId }); } catch { /* ignore if already member */ }
          setSelectedTrip({ id: tripId, name: tripId });
        }
      }
      if (!profile) {
        sessionStorage.setItem('simpli_pending_trip', tripId);
      }
    }
  }, [profile]);

  const handleLogin = (p: GoogleProfile) => {
    localStorage.setItem('simpli_user', JSON.stringify(p));
    setProfile(p);
    
    const pending = sessionStorage.getItem('simpli_pending_trip');
    if (pending) {
      sessionStorage.removeItem('simpli_pending_trip');
      const c = SpacetimeDB.conn as any;
      if (c) {
        try { c.reducers.joinTrip({ tripId: pending }); } catch { /* ignore */ }
        setSelectedTrip({ id: pending, name: pending });
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('simpli_user');
    googleLogout();
    setProfile(null);
    setSelectedTrip(null);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', background: '#050505', overflow: 'hidden' }}>
      
      {/* 3D Galaxy WebGL Background */}
      <GalaxyBackground activeTripId={selectedTrip?.id ?? null} onSelectTrip={setSelectedTrip} />

      <AnimatePresence mode="wait">
        {!profile ? (
          <LoginView key="login" onLogin={handleLogin} />
        ) : (
          <div key="app-content">
            <AnimatePresence mode="wait">
              {selectedTrip ? (
                <TripRoom
                  key={`room-${selectedTrip.id}`}
                  trip={selectedTrip}
                  profile={profile}
                  isConnected={isConnected}
                  onBack={() => setSelectedTrip(null)}
                />
              ) : (
                <Dashboard
                  key="dashboard"
                  profile={profile}
                  isConnected={isConnected}
                  onLogout={handleLogout}
                  onSelectTrip={setSelectedTrip}
                />
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
