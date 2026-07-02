import { useEffect, useState, useId, useCallback } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { motion, AnimatePresence } from 'framer-motion';
import { initSpacetimeDB } from './spacetimedb';
import * as SpacetimeDB from './spacetimedb';
import { useExpense, useExpenseSplit } from './module_bindings/hooks';
import { LiveDebtConstellation } from './components/LiveDebtConstellation';
import { KarmaBar } from './components/KarmaBar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoogleProfile {
  name: string;
  email: string;
  picture: string;
  sub: string;
}

interface Trip {
  id: string;
  name: string;
}

// ─── Easing presets (Emil Kowalski) ──────────────────────────────────────────
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// ─── useTrip — reads trips from SpacetimeDB conn.db ──────────────────────────
function useTrip(): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    const trySubscribe = () => {
      const conn = SpacetimeDB.conn as any;
      if (!conn) return false;
      const loadData = () => {
        try {
          const rows = [...conn.db.trip.iter()] as any[];
          setTrips(rows.map(r => ({ id: r.id, name: r.name })));
        } catch {
          setTrips([]);
        }
      };
      try {
        conn.db.trip.onInsert(loadData);
        conn.db.trip.onUpdate(loadData);
        conn.db.trip.onDelete(loadData);
        loadData();
        return () => {
          conn.db.trip.removeOnInsert(loadData);
          conn.db.trip.removeOnUpdate(loadData);
          conn.db.trip.removeOnDelete(loadData);
        };
      } catch {
        return false;
      }
    };
    const cleanup = trySubscribe();
    if (cleanup) return cleanup;
    let inner: (() => void) | undefined;
    const unsub = SpacetimeDB.onSpacetimeConnect(() => { inner = trySubscribe() || undefined; });
    return () => { unsub(); inner?.(); };
  }, []);

  return trips;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
const Spinner = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
    <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
    <path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </svg>
);

// ─── Add Expense Modal ────────────────────────────────────────────────────────
interface AddExpenseModalProps {
  tripId: string;
  tripName: string;
  onClose: () => void;
}

const AddExpenseModal = ({ tripId, tripName, onClose }: AddExpenseModalProps) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [isPersonal, setIsPersonal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const uid = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const conn = SpacetimeDB.conn as any;
    if (!conn) { setErr('Not connected.'); return; }
    const amt = parseFloat(amount);
    if (!description.trim() || isNaN(amt) || amt <= 0) {
      setErr('Enter a valid description and amount.');
      return;
    }
    setLoading(true);
    try {
      const identity = SpacetimeDB.localIdentity ?? 'unknown';
      const expenseId = `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const splits = isPersonal
        ? []
        : JSON.stringify([{ debtor_id: identity, amount_owed: amt }]);

      conn.reducers.addExpense({
        expenseId,
        tripId,
        amount: amt,
        description: description.trim(),
        isPersonal,
        splits: isPersonal ? '[]' : splits,
      });
      onClose();
    } catch (error: any) {
      setErr(error?.message ?? 'Failed to add expense.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          width: '100%', maxWidth: '440px',
          background: 'rgba(22, 26, 24, 0.96)',
          border: '1px solid rgba(111, 186, 138, 0.15)',
          borderRadius: '20px',
          padding: '32px',
          display: 'flex', flexDirection: 'column', gap: '20px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Add Expense</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: '0.85rem' }}>{tripName}</p>
        </div>

        {/* Type toggle */}
        <div style={{
          display: 'flex', background: 'rgba(255,255,255,0.05)',
          borderRadius: '12px', padding: '4px', gap: '4px',
        }}>
          {[
            { label: 'Group Split', value: false },
            { label: 'Personal', value: true },
          ].map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setIsPersonal(opt.value)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '9px',
                border: 'none', cursor: 'pointer', fontWeight: 600,
                fontSize: '0.85rem', transition: 'background 180ms ease, color 180ms ease',
                background: isPersonal === opt.value
                  ? 'rgba(111,186,138,0.18)'
                  : 'transparent',
                color: isPersonal === opt.value ? '#6fba8a' : '#666',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label htmlFor={`${uid}-desc`} style={{ fontSize: '0.8rem', color: '#888', marginBottom: '6px', display: 'block' }}>
              Description
            </label>
            <input
              id={`${uid}-desc`}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Dinner, hotel, taxi…"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-amt`} style={{ fontSize: '0.8rem', color: '#888', marginBottom: '6px', display: 'block' }}>
              Amount ($)
            </label>
            <input
              id={`${uid}-amt`}
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>
        </div>

        {!isPersonal && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#6fba8a', background: 'rgba(111,186,138,0.08)', padding: '10px 14px', borderRadius: '10px' }}>
            The full amount will be split among trip members.
          </p>
        )}

        {err && (
          <p style={{ margin: 0, color: '#e07070', fontSize: '0.85rem', fontWeight: 600 }}>⚠ {err}</p>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button type="button" onClick={onClose} style={ghostBtnStyle}>Cancel</button>
          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? <Spinner /> : 'Add Expense'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
};

// ─── Trip View ────────────────────────────────────────────────────────────────
interface TripViewProps {
  trip: Trip;
  onBack: () => void;
}

const TripView = ({ trip, onBack }: TripViewProps) => {
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const expenses = useExpense();
  const splits = useExpenseSplit();

  const tripExpenses = expenses.filter(e => e.tripId === trip.id);

  return (
    <motion.div
      key="trip-view"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
    >
      {/* Trip header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <button onClick={onBack} style={ghostBtnStyle}>
          ← Back
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>{trip.name}</h2>
          <p style={{ margin: '2px 0 0', color: '#555', fontSize: '0.8rem', fontFamily: 'monospace' }}>{trip.id}</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={() => setShowExpenseModal(true)}
            style={primaryBtnStyle}
          >
            + Add Expense
          </button>
        </div>
      </div>

      <KarmaBar />

      <div style={{ marginTop: '24px' }}>
        <LiveDebtConstellation />
      </div>

      {/* Expense list */}
      {tripExpenses.length > 0 && (
        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.75rem', fontWeight: 700, color: '#6fba8a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Expenses ({tripExpenses.length})
          </h3>
          {tripExpenses.map((exp, i) => {
            const expSplits = splits.filter(s => s.expenseId === exp.id);
            return (
              <motion.div
                key={exp.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.2, ease: EASE_OUT }}
                style={cardStyle}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{exp.description}</span>
                    <div style={{ color: '#555', fontSize: '0.75rem', marginTop: '3px' }}>
                      {expSplits.length > 0 ? `${expSplits.length} split${expSplits.length !== 1 ? 's' : ''}` : 'Personal'}
                    </div>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#6fba8a', flexShrink: 0 }}>
                    ${exp.amount.toFixed(2)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {showExpenseModal && (
          <AddExpenseModal
            tripId={trip.id}
            tripName={trip.name}
            onClose={() => setShowExpenseModal(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
interface DashboardProps {
  profile: GoogleProfile;
  onLogout: () => void;
}

const Dashboard = ({ profile, onLogout }: DashboardProps) => {
  const trips = useTrip();
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [newTripName, setNewTripName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [uiError, setUiError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    setIsConnected(!!SpacetimeDB.conn);
    const unsub = SpacetimeDB.onSpacetimeConnect(() => setIsConnected(true));
    const unsub2 = SpacetimeDB.onSpacetimeDisconnect(() => setIsConnected(false));
    return () => { unsub(); unsub2(); };
  }, []);

  const flash = (msg: string, isError = false) => {
    if (isError) { setUiError(msg); setSuccessMsg(null); }
    else { setSuccessMsg(msg); setUiError(null); }
    setTimeout(() => { setUiError(null); setSuccessMsg(null); }, 3500);
  };

  const handleCreateTrip = useCallback(() => {
    const name = newTripName.trim();
    if (!name) return;
    const conn = SpacetimeDB.conn as any;
    if (!conn) { flash('Not connected.', true); return; }
    try {
      const tripId = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      conn.reducers.createTrip({ tripId, name });
      setNewTripName('');
      flash(`✓ Trip "${name}" created`);
    } catch (e: any) { flash(e?.message ?? 'Failed to create trip.', true); }
  }, [newTripName]);

  const handleJoinTrip = useCallback(() => {
    const id = joinId.trim();
    if (!id) return;
    const conn = SpacetimeDB.conn as any;
    if (!conn) { flash('Not connected.', true); return; }
    try {
      // join_trip reducer — may not exist in old bindings, use as any
      conn.reducers.joinTrip({ tripId: id });
      setJoinId('');
      flash(`✓ Joined trip ${id}`);
    } catch (e: any) { flash(e?.message ?? 'Failed to join trip.', true); }
  }, [joinId]);

  if (selectedTrip) {
    return (
      <div className="container" style={{ paddingBottom: '40px' }}>
        <NavBar profile={profile} isConnected={isConnected} onLogout={onLogout} />
        <AnimatePresence mode="wait">
          <TripView key={selectedTrip.id} trip={selectedTrip} onBack={() => setSelectedTrip(null)} />
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingBottom: '64px' }}>
      <NavBar profile={profile} isConnected={isConnected} onLogout={onLogout} />

      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
        style={{ marginBottom: '40px' }}
      >
        <h1 style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>
          Hey, {profile.name.split(' ')[0]} 👋
        </h1>
        <p style={{ margin: '6px 0 0', color: '#555', fontSize: '1rem' }}>
          Your trips and balances, at a glance.
        </p>
      </motion.div>

      {/* Feedback messages */}
      <AnimatePresence>
        {(uiError || successMsg) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            style={{
              marginBottom: '16px', padding: '12px 16px', borderRadius: '12px',
              background: uiError ? 'rgba(192,113,90,0.12)' : 'rgba(111,186,138,0.12)',
              border: `1px solid ${uiError ? 'rgba(192,113,90,0.3)' : 'rgba(111,186,138,0.3)'}`,
              color: uiError ? '#e07070' : '#6fba8a', fontWeight: 600, fontSize: '0.9rem',
            }}
          >
            {uiError ?? successMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Trip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.05, ease: EASE_OUT }}
        style={{ ...cardStyle, marginBottom: '16px' }}
      >
        <h3 style={{ margin: '0 0 14px', fontSize: '0.75rem', fontWeight: 700, color: '#6fba8a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          New Trip
        </h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            value={newTripName}
            onChange={e => setNewTripName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateTrip()}
            placeholder="Vegas Trip, Bali 2026…"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={handleCreateTrip} disabled={!newTripName.trim()} style={primaryBtnStyle}>
            Create
          </button>
        </div>
      </motion.div>

      {/* Join Trip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.1, ease: EASE_OUT }}
        style={{ ...cardStyle, marginBottom: '32px' }}
      >
        <h3 style={{ margin: '0 0 14px', fontSize: '0.75rem', fontWeight: 700, color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Join via Invite ID
        </h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            value={joinId}
            onChange={e => setJoinId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoinTrip()}
            placeholder="Paste trip ID…"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={handleJoinTrip} disabled={!joinId.trim()} style={ghostBtnStyle}>
            Join
          </button>
        </div>
      </motion.div>

      {/* Trip List */}
      <div>
        <h3 style={{ margin: '0 0 14px', fontSize: '0.75rem', fontWeight: 700, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Your Trips {trips.length > 0 && `(${trips.length})`}
        </h3>

        {trips.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              ...cardStyle, textAlign: 'center', padding: '48px 24px',
              color: '#444', fontSize: '0.9rem',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>✈</div>
            No trips yet. Create one above to get started.
          </motion.div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {trips.map((trip, i) => (
              <motion.button
                key={trip.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.22, ease: EASE_OUT }}
                onClick={() => setSelectedTrip(trip)}
                whileHover={{ scale: 1.005 }}
                whileTap={{ scale: 0.98 }}
                style={{
                  ...cardStyle,
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: '1px solid rgba(255,255,255,0.07)',
                  transition: 'border-color 200ms ease, background 200ms ease',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(111,186,138,0.25)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: '1rem', display: 'block' }}>{trip.name}</span>
                  <span style={{ color: '#444', fontSize: '0.72rem', fontFamily: 'monospace', marginTop: '2px', display: 'block' }}>
                    {trip.id}
                  </span>
                </div>
                <span style={{ color: '#444', fontSize: '1rem' }}>→</span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── NavBar ───────────────────────────────────────────────────────────────────
interface NavBarProps {
  profile: GoogleProfile;
  isConnected: boolean;
  onLogout: () => void;
}

const NavBar = ({ profile, isConnected, onLogout }: NavBarProps) => (
  <motion.nav
    initial={{ opacity: 0, y: -8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.22, ease: EASE_OUT }}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 0', marginBottom: '32px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>SIMPLI</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'rgba(111,186,138,0.08)', borderRadius: '20px', border: '1px solid rgba(111,186,138,0.15)' }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: isConnected ? '#6fba8a' : '#666',
          boxShadow: isConnected ? '0 0 8px #6fba8a' : 'none',
          animation: isConnected ? 'pulse 2s infinite' : 'none',
        }} />
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isConnected ? '#6fba8a' : '#555' }}>
          {isConnected ? 'Live' : 'Offline'}
        </span>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <img
        src={profile.picture}
        alt={profile.name}
        style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(111,186,138,0.3)' }}
      />
      <span style={{ fontSize: '0.85rem', color: '#888', display: 'none' }}>{profile.name}</span>
      <button onClick={onLogout} style={{ ...ghostBtnStyle, padding: '6px 14px', fontSize: '0.8rem' }}>
        Logout
      </button>
    </div>
  </motion.nav>
);

// ─── Login View ───────────────────────────────────────────────────────────────
const LoginView = ({ onLogin }: { onLogin: (profile: GoogleProfile) => void }) => {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initSpacetimeDB();
    const unsub = SpacetimeDB.onSpacetimeConnect(() => setDbReady(true));
    const unsub2 = SpacetimeDB.onSpacetimeConnectError((err) => setDbError(err.message));
    const activeConn = SpacetimeDB.conn;
    if (activeConn) {
      setDbReady(true);
      activeConn.subscriptionBuilder().onApplied(() => {}).subscribe([
        'SELECT * FROM user', 'SELECT * FROM trip',
        'SELECT * FROM expense', 'SELECT * FROM expense_split',
      ]);
    }
    return () => { unsub(); unsub2(); };
  }, []);

  const handleSuccess = (credentialResponse: any) => {
    try {
      const profile = jwtDecode<GoogleProfile>(credentialResponse.credential);
      // Register user in SpacetimeDB
      const conn = SpacetimeDB.conn as any;
      if (conn) {
        try { conn.reducers.createUser({ name: profile.name }); } catch { /* already exists */ }
        conn.subscriptionBuilder().onApplied(() => {}).subscribe([
          'SELECT * FROM user', 'SELECT * FROM trip',
          'SELECT * FROM expense', 'SELECT * FROM expense_split',
        ]);
      }
      onLogin(profile);
    } catch (e) {
      console.error('[SIMPLI] Failed to decode Google JWT', e);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh', background: '#0A0A0A',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      backgroundImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(111,186,138,0.07) 0%, transparent 70%)',
    }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        style={{
          width: '100%', maxWidth: '400px',
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px',
          padding: '48px 40px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '24px',
          boxShadow: '0 32px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Logo mark */}
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
          style={{ textAlign: 'center' }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: '18px', margin: '0 auto 16px',
            background: 'linear-gradient(135deg, rgba(111,186,138,0.2) 0%, rgba(111,186,138,0.05) 100%)',
            border: '1px solid rgba(111,186,138,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', fontWeight: 800, color: '#6fba8a',
            letterSpacing: '-0.04em',
            boxShadow: '0 0 32px rgba(111,186,138,0.12)',
          }}>
            S
          </div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.04em' }}>
            SIMPLI
          </h1>
          <p style={{ margin: '6px 0 0', color: '#555', fontSize: '0.9rem' }}>
            Fair, transparent, effortless.
          </p>
        </motion.div>

        {/* DB status */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', width: '100%', justifyContent: 'center' }}
        >
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: dbError ? '#e07070' : dbReady ? '#6fba8a' : '#888',
            boxShadow: dbReady ? '0 0 8px #6fba8a' : 'none',
          }} />
          <span style={{ fontSize: '0.78rem', color: dbError ? '#e07070' : dbReady ? '#6fba8a' : '#555' }}>
            {dbError ? `DB Error: ${dbError}` : dbReady ? 'Database connected' : 'Connecting to database…'}
          </span>
        </motion.div>

        {/* Google Login */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3, ease: EASE_OUT }}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => console.error('[SIMPLI] Google login failed')}
            useOneTap={false}
            theme="filled_black"
            shape="pill"
            size="large"
            width="320"
            text="continue_with"
          />
        </motion.div>

        <p style={{ margin: 0, color: '#333', fontSize: '0.72rem', textAlign: 'center', lineHeight: 1.5 }}>
          By continuing, you agree to Simpli's Terms of Service.
        </p>
      </motion.div>

      {/* Bottom wordmark */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        style={{ marginTop: '32px', color: '#2a2a2a', fontSize: '0.8rem' }}
      >
        Split smarter. Live freer.
      </motion.p>
    </div>
  );
};

// ─── Shared Styles ────────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: '16px',
  padding: '20px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px',
  padding: '10px 14px',
  color: 'white',
  fontSize: '0.9rem',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 180ms ease',
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #6fba8a 0%, #5aa374 100%)',
  color: '#0d1f15',
  border: 'none',
  borderRadius: '10px',
  padding: '10px 20px',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
  transition: 'transform 160ms ease, opacity 160ms ease',
  display: 'flex', alignItems: 'center', gap: '8px',
  flexShrink: 0,
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: '#aaa',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px',
  padding: '10px 18px',
  fontWeight: 600,
  fontSize: '0.9rem',
  cursor: 'pointer',
  transition: 'background 160ms ease, color 160ms ease',
  flexShrink: 0,
};

// ─── Root App ─────────────────────────────────────────────────────────────────
function App() {
  const [profile, setProfile] = useState<GoogleProfile | null>(null);

  const handleLogout = () => {
    googleLogout();
    setProfile(null);
  };

  return (
    <AnimatePresence mode="wait">
      {profile ? (
        <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <Dashboard profile={profile} onLogout={handleLogout} />
        </motion.div>
      ) : (
        <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <LoginView onLogin={setProfile} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;
