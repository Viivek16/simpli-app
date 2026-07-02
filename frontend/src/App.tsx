import { useEffect, useState, useId, useCallback, useRef } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { motion, AnimatePresence } from 'framer-motion';
import { initSpacetimeDB } from './spacetimedb';
import * as SpacetimeDB from './spacetimedb';
import { useExpense, useExpenseSplit } from './module_bindings/hooks';
import { LiveDebtConstellation } from './components/LiveDebtConstellation';
import { KarmaBar } from './components/KarmaBar';

// ─── Easing (Emil Kowalski strong ease-out) ───────────────────────────────────
const EO = [0.23, 1, 0.32, 1] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface GoogleProfile { name: string; email: string; picture: string; sub: string; }
interface Trip { id: string; name: string; }

// ─── Hooks ────────────────────────────────────────────────────────────────────
function useTrip(): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);
  useEffect(() => {
    const sub = () => {
      const c = SpacetimeDB.conn as any;
      if (!c) return false;
      const load = () => {
        try { setTrips([...c.db.trip.iter()].map((r: any) => ({ id: r.id, name: r.name }))); }
        catch { setTrips([]); }
      };
      try {
        c.db.trip.onInsert(load); c.db.trip.onUpdate(load); c.db.trip.onDelete(load);
        load();
        return () => { c.db.trip.removeOnInsert(load); c.db.trip.removeOnUpdate(load); c.db.trip.removeOnDelete(load); };
      } catch { return false; }
    };
    const cleanup = sub(); if (cleanup) return cleanup;
    let inner: (() => void) | undefined;
    const u = SpacetimeDB.onSpacetimeConnect(() => { inner = sub() || undefined; });
    return () => { u(); inner?.(); };
  }, []);
  return trips;
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

// ─── Shared primitives ────────────────────────────────────────────────────────
const INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px', padding: '10px 14px',
  color: 'white', fontSize: '0.9rem', outline: 'none',
  transition: 'border-color 180ms ease',
  fontFamily: 'inherit',
};
const BTN_PRIMARY: React.CSSProperties = {
  background: 'linear-gradient(135deg, #6fba8a 0%, #4d9e6a 100%)',
  color: '#071a0f', border: 'none', borderRadius: '10px',
  padding: '10px 20px', fontWeight: 700, fontSize: '0.9rem',
  cursor: 'pointer', flexShrink: 0, display: 'flex',
  alignItems: 'center', gap: '8px', whiteSpace: 'nowrap',
  transition: 'opacity 160ms ease, transform 160ms ease',
  fontFamily: 'inherit',
};
const BTN_GHOST: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#999', borderRadius: '10px',
  padding: '10px 18px', fontWeight: 600,
  fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0,
  transition: 'background 160ms ease, color 160ms ease',
  fontFamily: 'inherit',
};

// ─── Spinner ──────────────────────────────────────────────────────────────────
const Spinner = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
    style={{ animation: 'simpli-spin 0.7s linear infinite' }}>
    <style>{`@keyframes simpli-spin { to { transform:rotate(360deg) } }`}</style>
    <circle cx="9" cy="9" r="7" stroke="rgba(7,26,15,0.3)" strokeWidth="2" />
    <path d="M9 2a7 7 0 0 1 7 7" stroke="#071a0f" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// ─── Add Expense Modal ────────────────────────────────────────────────────────
const AddExpenseModal = ({ tripId, tripName, onClose }: { tripId: string; tripName: string; onClose: () => void }) => {
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [personal, setPersonal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const uid = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const c = SpacetimeDB.conn as any;
    if (!c) { setErr('Not connected.'); return; }
    const amount = parseFloat(amt);
    if (!desc.trim() || isNaN(amount) || amount <= 0) {
      setErr('Enter a valid description and amount.'); return;
    }
    setLoading(true);
    try {
      const identity = SpacetimeDB.localIdentity ?? 'unknown';
      c.reducers.addExpense({
        expenseId: `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        tripId, amount,
        description: desc.trim(),
        isPersonal: personal,
        splits: personal ? '[]' : JSON.stringify([{ debtor_id: identity, amount_owed: amount }]),
      });
      onClose();
    } catch (e: any) { setErr(e?.message ?? 'Failed to add expense.'); }
    finally { setLoading(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }} onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.22, ease: EO }}
        onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{
          width: '100%', maxWidth: '440px',
          background: 'rgba(14,18,16,0.97)',
          border: '1px solid rgba(111,186,138,0.18)',
          borderRadius: '20px', padding: '32px',
          display: 'flex', flexDirection: 'column', gap: '20px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(111,186,138,0.05)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Add Expense</h2>
          <p style={{ margin: '4px 0 0', color: '#555', fontSize: '0.82rem' }}>{tripName}</p>
        </div>

        {/* Personal / Group toggle */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '11px', padding: '3px', gap: '3px' }}>
          {[{ label: 'Group Split', v: false }, { label: 'Personal', v: true }].map(opt => (
            <button key={String(opt.v)} type="button" onClick={() => setPersonal(opt.v)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '9px', border: 'none',
                cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem',
                fontFamily: 'inherit',
                transition: 'background 180ms ease, color 180ms ease',
                background: personal === opt.v ? 'rgba(111,186,138,0.15)' : 'transparent',
                color: personal === opt.v ? '#6fba8a' : '#555',
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label htmlFor={`${uid}-d`} style={{ display: 'block', fontSize: '0.77rem', color: '#666', marginBottom: '6px' }}>Description</label>
            <input id={`${uid}-d`} value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Dinner, Airbnb, taxi…" style={INPUT} />
          </div>
          <div>
            <label htmlFor={`${uid}-a`} style={{ display: 'block', fontSize: '0.77rem', color: '#666', marginBottom: '6px' }}>Amount ($)</label>
            <input id={`${uid}-a`} type="number" min="0.01" step="0.01" value={amt}
              onChange={e => setAmt(e.target.value)} placeholder="0.00" style={INPUT} />
          </div>
        </div>

        {!personal && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#6fba8a', background: 'rgba(111,186,138,0.07)', padding: '10px 13px', borderRadius: '9px' }}>
            Amount will be split equally among trip members.
          </p>
        )}

        {err && <p style={{ margin: 0, color: '#e07070', fontSize: '0.83rem', fontWeight: 600 }}>⚠ {err}</p>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onClose} style={BTN_GHOST}>Cancel</button>
          <button type="submit" disabled={loading} style={{ ...BTN_PRIMARY, flex: 1, justifyContent: 'center' }}>
            {loading ? <Spinner /> : 'Add Expense'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
};

// ─── Trip Room (active trip overlay) ─────────────────────────────────────────
const TripRoom = ({
  trip, profile, isConnected, onBack, onLogout,
}: {
  trip: Trip;
  profile: GoogleProfile;
  isConnected: boolean;
  onBack: () => void;
  onLogout: () => void;
}) => {
  const [showModal, setShowModal] = useState(false);
  const expenses = useExpense();
  const splits = useExpenseSplit();
  const tripExpenses = expenses.filter(e => e.tripId === trip.id);

  // Share link for viral invites
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
      initial={{ opacity: 0, x: '100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '100%' }}
      transition={{ duration: 0.38, ease: EO }}
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
        background: 'rgba(10,10,10,0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button onClick={onBack} style={BTN_GHOST}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</div>
          <div style={{ fontSize: '0.7rem', color: '#444', fontFamily: 'monospace', marginTop: '1px' }}>{trip.id}</div>
        </div>

        {/* KarmaBar inline in top bar */}
        <div style={{ width: '180px', flexShrink: 0 }}>
          <KarmaBar tripId={trip.id} />
        </div>

        {/* Connection dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: isConnected ? '#6fba8a' : '#555',
          boxShadow: isConnected ? '0 0 8px #6fba8a' : 'none',
        }} />

        <img src={profile.picture} alt={profile.name}
          style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid rgba(111,186,138,0.35)', flexShrink: 0 }} />
        <button onClick={onLogout} style={{ ...BTN_GHOST, padding: '6px 12px', fontSize: '0.78rem' }}>Logout</button>
      </div>

      {/* Right panel — scrollable expense list */}
      <div style={{
        pointerEvents: 'all',
        position: 'absolute',
        top: 73, right: 0, bottom: 0,
        width: 'min(360px, 100vw)',
        background: 'rgba(8,12,10,0.85)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Panel header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444' }}>
              Expenses {tripExpenses.length > 0 && `(${tripExpenses.length})`}
            </span>
            <button onClick={() => setShowModal(true)} style={{ ...BTN_PRIMARY, padding: '7px 14px', fontSize: '0.8rem' }}>
              + Add
            </button>
          </div>

          {/* Invite link */}
          <button onClick={copyInvite} style={{
            width: '100%', background: 'rgba(111,186,138,0.06)',
            border: '1px solid rgba(111,186,138,0.15)', borderRadius: '9px',
            padding: '9px 12px', cursor: 'pointer', textAlign: 'left',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            transition: 'background 180ms ease', fontFamily: 'inherit',
          }}>
            <span style={{ fontSize: '0.72rem', color: '#555', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
              {shareLink}
            </span>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: copied ? '#6fba8a' : '#444', flexShrink: 0, marginLeft: '8px' }}>
              {copied ? 'Copied!' : 'Copy invite'}
            </span>
          </button>
        </div>

        {/* Expense list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {tripExpenses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: '#333', fontSize: '0.85rem' }}>
              No expenses yet. Add one to get started.
            </div>
          ) : (
            tripExpenses.map((exp, i) => {
              const expSplits = splits.filter(s => s.expenseId === exp.id);
              return (
                <motion.div
                  key={exp.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.2, ease: EO }}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '12px', padding: '12px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{exp.description}</div>
                    <div style={{ color: '#444', fontSize: '0.72rem', marginTop: '3px' }}>
                      {expSplits.length > 0 ? `${expSplits.length} split${expSplits.length !== 1 ? 's' : ''}` : 'Personal'}
                    </div>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#6fba8a', flexShrink: 0 }}>
                    ${exp.amount.toFixed(2)}
                  </span>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      <AnimatePresence>
        {showModal && <AddExpenseModal tripId={trip.id} tripName={trip.name} onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Dashboard Overlay ────────────────────────────────────────────────────────
const Dashboard = ({
  profile, isConnected, onLogout, onSelectTrip,
}: {
  profile: GoogleProfile;
  isConnected: boolean;
  onLogout: () => void;
  onSelectTrip: (trip: Trip) => void;
}) => {
  const trips = useTrip();
  const [newTripName, setNewTripName] = useState('');
  const [uiMsg, setUiMsg] = useState<{ text: string; err: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = (text: string, err = false) => {
    clearTimeout(timerRef.current);
    setUiMsg({ text, err });
    timerRef.current = setTimeout(() => setUiMsg(null), 3200);
  };

  const handleCreate = useCallback(() => {
    const name = newTripName.trim();
    if (!name) return;
    const c = SpacetimeDB.conn as any;
    if (!c) { flash('Not connected — try again in a moment.', true); return; }
    try {
      const tripId = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      c.reducers.createTrip({ tripId, name });
      setNewTripName('');
      // optimistically navigate; the real row will arrive via subscription
      onSelectTrip({ id: tripId, name });
    } catch (e: any) { flash(e?.message ?? 'Could not create trip.', true); }
  }, [newTripName, onSelectTrip]);

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, x: '-100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '-100%' }}
      transition={{ duration: 0.38, ease: EO }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10,
        display: 'flex', flexDirection: 'column',
        pointerEvents: 'none',
      }}
    >
      {/* Top bar */}
      <div style={{
        pointerEvents: 'all',
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '16px 24px',
        background: 'rgba(10,10,10,0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.03em', marginRight: '4px' }}>SIMPLI</span>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '3px 9px', borderRadius: '20px',
          background: 'rgba(111,186,138,0.07)',
          border: '1px solid rgba(111,186,138,0.14)',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: isConnected ? '#6fba8a' : '#444',
            boxShadow: isConnected ? '0 0 7px #6fba8a' : 'none',
          }} />
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: isConnected ? '#6fba8a' : '#444' }}>
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <img src={profile.picture} alt=""
          style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(111,186,138,0.3)' }} />
        <button onClick={onLogout} style={{ ...BTN_GHOST, padding: '6px 12px', fontSize: '0.78rem' }}>Logout</button>
      </div>

      {/* Left panel */}
      <div style={{
        pointerEvents: 'all',
        position: 'absolute',
        top: 65, left: 0, bottom: 0,
        width: 'min(380px, 100vw)',
        background: 'rgba(8,12,10,0.85)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Greeting */}
        <div style={{ padding: '24px 20px 20px' }}>
          <h1 style={{
            margin: 0, fontSize: '1.5rem', fontWeight: 800,
            letterSpacing: '-0.03em', lineHeight: 1.15,
          }}>
            {profile.name.split(' ')[0]}'s trips
          </h1>
          <p style={{ margin: '5px 0 0', color: '#444', fontSize: '0.82rem', maxWidth: 'none' }}>
            Select a trip or create one to start.
          </p>
        </div>

        {/* Create Trip */}
        <div style={{ padding: '0 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={newTripName}
              onChange={e => setNewTripName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Name your trip…"
              style={{ ...INPUT, flex: 1 }}
            />
            <button onClick={handleCreate} disabled={!newTripName.trim()} style={BTN_PRIMARY}>
              Create
            </button>
          </div>
          <AnimatePresence>
            {uiMsg && (
              <motion.p
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
                style={{
                  margin: '10px 0 0', fontSize: '0.8rem', fontWeight: 600,
                  color: uiMsg.err ? '#e07070' : '#6fba8a', maxWidth: 'none',
                }}
              >
                {uiMsg.text}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Trip list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {trips.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#2e2e2e', fontSize: '0.85rem' }}>
              No trips yet.<br />Create one above.
            </div>
          ) : (
            trips.map((trip, i) => (
              <motion.button
                key={trip.id}
                onClick={() => onSelectTrip(trip)}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.22, ease: EO }}
                whileTap={{ scale: 0.98 }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '12px', padding: '13px 14px',
                  transition: 'border-color 200ms ease, background 200ms ease',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(111,186,138,0.22)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</div>
                  <div style={{ color: '#333', fontSize: '0.68rem', fontFamily: 'monospace', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.id}</div>
                </div>
                <span style={{ color: '#333', fontSize: '0.9rem', marginLeft: '8px', flexShrink: 0 }}>→</span>
              </motion.button>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ─── Login View ───────────────────────────────────────────────────────────────
const LoginView = ({ onLogin }: { onLogin: (p: GoogleProfile) => void }) => {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initSpacetimeDB();
    const u1 = SpacetimeDB.onSpacetimeConnect(() => setDbReady(true));
    const u2 = SpacetimeDB.onSpacetimeConnectError((e) => setDbError(e.message));
    const c = SpacetimeDB.conn;
    if (c) {
      setDbReady(true);
      c.subscriptionBuilder().onApplied(() => {}).subscribe([
        'SELECT * FROM user', 'SELECT * FROM trip',
        'SELECT * FROM expense', 'SELECT * FROM expense_split',
      ]);
    }
    return () => { u1(); u2(); };
  }, []);

  const handleSuccess = (res: any) => {
    try {
      const profile = jwtDecode<GoogleProfile>(res.credential);
      const c = SpacetimeDB.conn as any;
      if (c) {
        try { c.reducers.createUser({ name: profile.name }); } catch { /* already exists */ }
        c.subscriptionBuilder().onApplied(() => {}).subscribe([
          'SELECT * FROM user', 'SELECT * FROM trip',
          'SELECT * FROM expense', 'SELECT * FROM expense_split',
        ]);
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
        transition={{ duration: 0.5, ease: EO }}
        style={{
          width: '100%', maxWidth: '380px',
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px', padding: '48px 36px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '24px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.35, ease: EO }}
          style={{ textAlign: 'center' }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: '16px',
            background: 'linear-gradient(140deg, rgba(111,186,138,0.18) 0%, rgba(111,186,138,0.04) 100%)',
            border: '1px solid rgba(111,186,138,0.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.35rem', fontWeight: 800, color: '#6fba8a',
            letterSpacing: '-0.04em', margin: '0 auto 14px',
            boxShadow: '0 0 28px rgba(111,186,138,0.1)',
          }}>S</div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.04em' }}>SIMPLI</h1>
          <p style={{ margin: '5px 0 0', color: '#444', fontSize: '0.87rem', maxWidth: 'none' }}>
            Fair, transparent, effortless.
          </p>
        </motion.div>

        {/* DB status pill */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '7px 13px', background: 'rgba(255,255,255,0.04)',
            borderRadius: '10px', width: '100%', justifyContent: 'center',
          }}
        >
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: dbError ? '#e07070' : dbReady ? '#6fba8a' : '#555',
            boxShadow: dbReady ? '0 0 7px #6fba8a' : 'none',
          }} />
          <span style={{ fontSize: '0.75rem', color: dbError ? '#e07070' : dbReady ? '#6fba8a' : '#444' }}>
            {dbError ? `Error: ${dbError}` : dbReady ? 'Database connected' : 'Connecting…'}
          </span>
        </motion.div>

        {/* Google button */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3, ease: EO }}
          style={{ width: '100%' }}
        >
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => console.error('[SIMPLI] Google login failed')}
            theme="filled_black" shape="pill" size="large"
            width="308" text="continue_with" useOneTap={false}
          />
        </motion.div>

        <p style={{ margin: 0, color: '#222', fontSize: '0.7rem', textAlign: 'center', maxWidth: 'none', lineHeight: 1.5 }}>
          By continuing, you agree to Simpli's Terms of Service.
        </p>
      </motion.div>
    </div>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────
function App() {
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const isConnected = useIsConnected();

  // URL-based viral invite routing — check on mount
  useEffect(() => {
    const match = window.location.pathname.match(/^\/t\/([^/]+)/);
    if (match) {
      const tripId = match[1];
      window.history.replaceState(null, '', '/');
      // If already authenticated, attempt join immediately
      if (profile) {
        const c = SpacetimeDB.conn as any;
        if (c) {
          try { c.reducers.joinTrip({ tripId }); } catch { /* ignore if already member */ }
          setSelectedTrip({ id: tripId, name: tripId }); // name will update from subscription
        }
      }
      // If not authenticated, we stash the tripId and handle it after login
      if (!profile) {
        sessionStorage.setItem('simpli_pending_trip', tripId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (p: GoogleProfile) => {
    setProfile(p);
    // Handle pending invite
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
    googleLogout();
    setProfile(null);
    setSelectedTrip(null);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', background: '#080c0a', overflow: 'hidden' }}>
      {/* Layer 0: Ambient constellation — always rendered */}
      <LiveDebtConstellation activeTripId={selectedTrip?.id ?? null} />

      {/* Layer 1: UI — login or app */}
      <AnimatePresence mode="wait">
        {!profile ? (
          <LoginView key="login" onLogin={handleLogin} />
        ) : (
          <>
            <AnimatePresence mode="wait">
              {selectedTrip ? (
                <TripRoom
                  key={`room-${selectedTrip.id}`}
                  trip={selectedTrip}
                  profile={profile}
                  isConnected={isConnected}
                  onBack={() => setSelectedTrip(null)}
                  onLogout={handleLogout}
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
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
