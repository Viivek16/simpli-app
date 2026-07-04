/**
 * SIMPLI — App.tsx
 * Phases 1–5 integrated
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { motion, AnimatePresence } from 'framer-motion';
import { initSpacetimeDB, onSpacetimeConnect, onSpacetimeDisconnect, onSubscriptionApplied } from './spacetimedb';
import * as StDB from './spacetimedb';
import { useExpense, useExpenseSplit, useUser } from './module_bindings/hooks';
import type { Expense, ExpenseSplit } from './module_bindings/types';
import { useTrip, type Trip } from './hooks/useTrips';
import { useTripMember } from './hooks/useTrips';
import { KarmaBar } from './components/KarmaBar';
import { ExpenseModal } from './components/ExpenseModal';
import { GalaxyBackground } from './components/GalaxyBackground';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster, toast } from './components/Toast';

const EO = [0.23, 1, 0.32, 1] as const;
const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const norm = (s: any) => String(s ?? '').toLowerCase().trim();

interface GoogleProfile { name: string; email: string; picture: string; sub: string; }

function useIsConnected() {
  const [v, setV] = useState(!!StDB.conn);
  useEffect(() => {
    const u1 = onSpacetimeConnect(() => setV(true));
    const u2 = onSpacetimeDisconnect(() => setV(false));
    return () => { u1(); u2(); };
  }, []);
  return v;
}

const BTN_GHOST: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#8e8e93', borderRadius: '10px',
  padding: '10px 18px', fontWeight: 600, fontSize: '0.88rem',
  cursor: 'pointer', flexShrink: 0,
  transition: 'background 160ms ease',
  fontFamily: 'inherit',
};

// ─── Relative time ────────────────────────────────────────────────────────────
const relTime = (ts: any): string => {
  try {
    let ms = 0;
    if (typeof ts === 'object' && ts && 'microsSinceEpoch' in ts) {
      ms = Number(ts.microsSinceEpoch) / 1000;
    } else if (typeof ts === 'bigint') {
      ms = Number(ts) / 1000;
    } else if (typeof ts === 'number') {
      ms = ts > 2000000000000 ? ts / 1000 : ts;
    } else {
      ms = Date.parse(ts);
    }
    if (isNaN(ms) || ms === 0) return '';
    const diffMs = Date.now() - ms;
    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  } catch { return ''; }
};

// ─── Trip Room ─────────────────────────────────────────────────────────────────
interface EditPayload {
  expense: Expense;
  splits: ExpenseSplit[];
}

const TripRoom = ({
  trip, profile, isConnected, onBack, onOverlayChange, selectedMemberId, onSelectMember
}: {
  trip: Trip; profile: GoogleProfile; isConnected: boolean; onBack: () => void;
  onOverlayChange: (v: boolean) => void; selectedMemberId: string | null; onSelectMember: (id: string | null) => void;
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editPayload, setEditPayload] = useState<EditPayload | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);
  const [deleteTripName, setDeleteTripName] = useState('');
  const [deleteExpenseLoading, setDeleteExpenseLoading] = useState<string | null>(null);

  const expenses = useExpense();
  const splits = useExpenseSplit();
  const allUsers = useUser();
  const tripMemberIds = useTripMember(trip.id);

  const localId = norm(StDB.localIdentity ?? '');

  // Build user map for name lookups
  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    allUsers.forEach(u => {
      const id = (typeof u.id === 'object' && u.id && 'toHexString' in u.id)
        ? norm(u.id.toHexString()) : norm(u.id);
      if (!m.has(id)) m.set(id, u.name || 'Member');
    });
    return m;
  }, [allUsers]);

  // Trip members with names for modal
  const tripMembers = useMemo(() => {
    return tripMemberIds.map(id => ({ id: norm(id), name: userMap.get(norm(id)) || 'Member' }));
  }, [tripMemberIds, userMap]);

  const tripExpenses = expenses.filter(e => e.tripId === trip.id);

  const shareLink = `${window.location.origin}/t/${trip.id}`;
  const [copied, setCopied] = useState(false);
  const copyInvite = () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.info('Invite link copied!');
    });
  };

  // Detect if trip was deleted while viewing
  useEffect(() => {
    const c = StDB.conn as any;
    if (!c) return;
    const onDel = (row: any) => {
      if (row?.id === trip.id) {
        toast.info(`"${trip.name}" was deleted`);
        onBack();
      }
    };
    c.db.trip.onDelete(onDel);
    return () => c.db.trip.removeOnDelete(onDel);
  }, [trip.id, trip.name, onBack]);

  // Sync overlay status with App to pause background
  useEffect(() => {
    onOverlayChange(showModal || showDeleteTrip || selectedMemberId !== null);
  }, [showModal, showDeleteTrip, selectedMemberId, onOverlayChange]);

  const handleDeleteExpense = async (expId: string, desc: string) => {
    if (deleteConfirm !== expId) {
      setDeleteConfirm(expId);
      setTimeout(() => setDeleteConfirm(prev => prev === expId ? null : prev), 4000);
      return;
    }
    setDeleteConfirm(null);
    setDeleteExpenseLoading(expId);
    const c = StDB.conn as any;
    try {
      const isSettlement = desc === 'Debt settlement';
      await c.reducers.deleteExpense({ expenseId: expId });
      toast.success(isSettlement ? 'Settlement undone' : 'Expense deleted');
    } catch (e: any) {
      toast.error(e?.message ?? 'Delete failed');
    } finally {
      setDeleteExpenseLoading(null);
    }
  };

  const handleDeleteTrip = async () => {
    if (deleteTripName !== trip.name) return;
    const c = StDB.conn as any;
    try {
      await c.reducers.deleteTrip({ tripId: trip.id });
      toast.success(`"${trip.name}" deleted`);
      onBack();
    } catch (e: any) {
      toast.error(e?.message ?? 'Delete failed');
    }
  };

  // Group expenses by day
  const grouped = useMemo(() => {
    const groups: { label: string; items: typeof tripExpenses }[] = [];
    const dayOf = (ts: any) => {
      try {
        const ms = typeof ts === 'object' && ts && 'microsSinceEpoch' in ts
          ? Number(ts.microsSinceEpoch) / 1000 : Number(ts);
        return new Date(ms).toDateString();
      } catch { return 'Unknown'; }
    };
    const dayLabel = (d: string) => {
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (d === today) return 'Today';
      if (d === yesterday) return 'Yesterday';
      return d;
    };
    const dayMap = new Map<string, typeof tripExpenses>();
    [...tripExpenses].reverse().forEach(e => {
      const d = dayOf(e.timestamp);
      if (!dayMap.has(d)) dayMap.set(d, []);
      dayMap.get(d)!.push(e);
    });
    dayMap.forEach((items, d) => groups.push({ label: dayLabel(d), items }));
    return groups;
  }, [tripExpenses]);

  const memberBalances = useMemo(() => {
    if (!selectedMemberId) return null;
    const balances = new Map<string, number>();
    tripMembers.forEach(m => {
       if (m.id !== selectedMemberId) balances.set(m.id, 0);
    });

    tripExpenses.forEach(exp => {
      const payer = norm(exp.payerId);
      const expSplits = splits.filter(s => s.expenseId === exp.id);
      
      expSplits.forEach(s => {
        const debtor = norm(s.debtorId);
        if (payer === debtor) return;
        
        if (payer === selectedMemberId && debtor !== selectedMemberId) {
          const current = balances.get(debtor) || 0;
          balances.set(debtor, current + s.amountOwed);
        } else if (debtor === selectedMemberId && payer !== selectedMemberId) {
          const current = balances.get(payer) || 0;
          balances.set(payer, current - s.amountOwed);
        }
      });
    });

    const result: { otherId: string; amount: number }[] = [];
    let net = 0;
    balances.forEach((amt, otherId) => {
      net += amt;
      if (Math.abs(amt) > 0.01) result.push({ otherId, amount: amt });
    });
    return { net, details: result.sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount)) };
  }, [selectedMemberId, tripExpenses, splits, tripMembers]);

  const handleSettle = async (otherId: string, amount: number) => {
    const payerId = amount > 0 ? otherId : selectedMemberId!;
    const payeeId = amount > 0 ? selectedMemberId! : otherId;
    const settleAmt = Math.abs(amount);

    const c = StDB.conn as any;
    if (!c) return;
    try {
      await c.reducers.settleDebt({ tripId: trip.id, debtorId: payerId, payeeId, amount: settleAmt });
      toast.success('Settled up!');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to settle debt');
    }
  };

  return (
    <motion.div
      key="trip-room"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ delay: 0.2, duration: 0.5, ease: EO }}
      style={{ position: 'fixed', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}
    >
      {/* Top bar */}
      <div style={{
        pointerEvents: 'all', display: 'flex', alignItems: 'center', gap: '12px',
        padding: '16px 24px',
        background: 'linear-gradient(to bottom, rgba(2,5,8,0.92) 0%, rgba(2,5,8,0) 100%)',
      }}>
        <button onClick={onBack} style={{ ...BTN_GHOST, background: 'rgba(255,255,255,0.08)', color: '#e0e8e5' }}>
          ← Cosmos
        </button>
        <div style={{ flex: 1, paddingLeft: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555' }}>Galaxy</span>
            <span style={{ fontWeight: 800, fontSize: '1.15rem', color: '#f8f9fa', letterSpacing: '-0.02em' }}>{trip.name}</span>
          </div>
        </div>

        <div style={{ width: '200px', flexShrink: 0 }}>
          <KarmaBar tripId={trip.id} />
        </div>

        {/* Galaxy settings */}
        <button
          onClick={() => setShowDeleteTrip(true)}
          style={{ ...BTN_GHOST, padding: '8px 12px', color: '#555', fontSize: '1rem' }}
          title="Galaxy settings"
        >⋯</button>

        <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: isConnected ? '#6fba8a' : '#555', boxShadow: isConnected ? '0 0 8px #6fba8a' : 'none' }} />
        <img src={profile.picture} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(156,174,169,0.3)' }} />
      </div>

      {/* Bottom Dock */}
      <div style={{
        position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'all',
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(16,20,18,0.65)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: '32px', padding: '6px',
        boxShadow: '0 16px 40px rgba(0,0,0,0.6)', zIndex: 20
      }}>
        <button onClick={copyInvite} style={{ ...BTN_GHOST, background: 'transparent', border: 'none', color: '#9bafa4', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '6px' }} title="Invite">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
           {copied ? 'Copied' : 'Invite'}
        </button>
        <button
          onClick={() => { setEditPayload(null); setShowModal(true); }}
          style={{ ...BTN_GHOST, background: '#9bafa4', color: '#050a08', border: 'none', borderRadius: '24px', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Add expense
        </button>
      </div>

      {/* Right panel — Ledger */}
      <div className="glass-panel" style={{
        pointerEvents: 'all', position: 'absolute', top: 72, right: 20, bottom: 24,
        width: '340px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'rgba(5, 6, 10, 0.65)'
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--glass-brd)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              Trip Ledger {tripExpenses.length > 0 && `· ${tripExpenses.length}`}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {tripExpenses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#3a3a3a', fontSize: '0.88rem' }}>
              No expenses yet.<br/>Add the first one.
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.label}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444', padding: '10px 4px 6px' }}>
                  {group.label}
                </div>
                {group.items.map((exp, i) => {
                  const expSplits = splits.filter(s => s.expenseId === exp.id);
                  const isSettlement = exp.description === 'Debt settlement';
                  const payerName = userMap.get(norm(exp.payerId)) || 'Member';
                  const isMe = norm(exp.payerId) === localId;
                  const splitSummary = expSplits.length === 0
                    ? 'Personal'
                    : isSettlement ? 'Settlement'
                    : `${isMe ? 'You' : payerName} paid · split ${expSplits.length} ways`;
                  const isConfirming = deleteConfirm === exp.id;

                  return (
                    <motion.div
                      key={exp.id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: i * 0.03, duration: 0.25, ease: EO }}
                      style={{
                        padding: '11px 13px', marginBottom: '6px', position: 'relative',
                        borderBottom: '1px solid var(--glass-brd)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: 600, fontSize: '0.95rem', color: isSettlement ? 'var(--owed)' : 'var(--text)',
                            display: 'flex', alignItems: 'center', gap: '6px',
                          }}>
                            {isSettlement && <span style={{ fontSize: '0.75rem' }}>✓</span>}
                            {exp.description}
                          </div>
                          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '3px' }}>{splitSummary}</div>
                          <div style={{ color: 'var(--text-dim)', opacity: 0.6, fontSize: '0.7rem', marginTop: '1px' }}>{relTime(exp.timestamp)}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0, marginLeft: '10px' }}>
                          <span className="money" style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>
                            {INR(exp.amount)}
                          </span>
                          {/* Action buttons */}
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {!isSettlement && (
                              <button
                                onClick={() => { setEditPayload({ expense: exp, splits: expSplits }); setShowModal(true); }}
                                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '3px 8px', color: '#555', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit', transition: 'color 120ms' }}
                                title="Edit"
                              >Edit</button>
                            )}
                            <button
                              onClick={() => handleDeleteExpense(exp.id, exp.description)}
                              disabled={deleteExpenseLoading === exp.id}
                              style={{
                                background: isConfirming ? 'rgba(217,138,108,0.15)' : 'none',
                                border: `1px solid ${isConfirming ? '#d98a6c' : 'rgba(255,255,255,0.08)'}`,
                                borderRadius: '6px', padding: '3px 8px',
                                color: isConfirming ? '#d98a6c' : '#555',
                                cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit',
                                transition: 'all 120ms',
                              }}
                              title={isSettlement ? 'Undo settlement' : 'Delete expense'}
                            >
                              {isConfirming ? 'Confirm?' : isSettlement ? 'Undo' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Selected Member Panel */}
      <AnimatePresence>
        {selectedMemberId && memberBalances && (
          <motion.div
            initial={{ x: '100%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.35, ease: EO }}
            className="glass-panel"
            style={{
              pointerEvents: 'all', position: 'absolute', top: 72, right: 20, bottom: 24,
              width: '340px', zIndex: 15, display: 'flex', flexDirection: 'column', overflow: 'hidden',
              background: 'rgba(5, 6, 10, 0.65)'
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--glass-brd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>
                {selectedMemberId === localId ? 'You' : (userMap.get(selectedMemberId) || 'Member')}
              </span>
              <button onClick={() => onSelectMember(null)} className="btn-ghost" style={{ fontSize: '1.2rem', padding: '0 4px', width: 32, height: 32 }}>×</button>
            </div>
            
            <div style={{ padding: '24px 18px', borderBottom: '1px solid var(--glass-brd)', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 600 }}>Net Balance</div>
              <div className="money" style={{ fontSize: '2rem', fontWeight: 700, color: memberBalances.net === 0 ? 'var(--text-dim)' : memberBalances.net > 0 ? 'var(--owed)' : 'var(--owe)', letterSpacing: '-0.02em' }}>
                {INR(Math.abs(memberBalances.net))}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                {memberBalances.net === 0 ? 'Settled up' : memberBalances.net > 0 ? 'gets back in total' : 'owes in total'}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
              {memberBalances.details.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>No outstanding balances.</div>
              ) : (
                memberBalances.details.map(({ otherId, amount }) => {
                  const otherName = otherId === localId ? 'You' : (userMap.get(otherId) || 'Member');
                  const isOwedToSelected = amount > 0;
                  const owesText = isOwedToSelected ? `${otherName} owe${otherId === localId ? '' : 's'}` : `Owe${selectedMemberId === localId ? '' : 's'} ${otherName}`;
                  return (
                    <div key={otherId} style={{
                      borderBottom: '1px solid var(--glass-brd)',
                      padding: '12px 14px', marginBottom: '4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: 500, marginBottom: '2px' }}>
                          {owesText}
                        </div>
                        <div className="money" style={{ fontSize: '1rem', fontWeight: 700, color: isOwedToSelected ? 'var(--owed)' : 'var(--owe)' }}>
                          {INR(Math.abs(amount))}
                        </div>
                      </div>
                      <button
                        onClick={() => handleSettle(otherId, amount)}
                        className="btn-secondary"
                        style={{ padding: '6px 12px', height: 'auto', borderRadius: '8px', fontSize: '0.8rem', color: isOwedToSelected ? 'var(--owed)' : 'var(--owe)' }}
                      >
                        Settle
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showModal && (
          <ExpenseModal
            tripId={trip.id}
            tripMembers={tripMembers}
            onClose={() => { setShowModal(false); setEditPayload(null); }}
            editExpense={editPayload ? { ...editPayload.expense, splits: editPayload.splits } : undefined}
          />
        )}
      </AnimatePresence>

      {/* Delete Trip Sheet */}
      <AnimatePresence>
        {showDeleteTrip && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '24px', pointerEvents: 'all' }}>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowDeleteTrip(false)}
              style={{ position: 'absolute', inset: 0, background: 'rgba(255,100,100,0.1)', backdropFilter: 'blur(12px)' }}
            />
            <motion.div
              initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              className="glass-panel"
              style={{
                position: 'relative', zIndex: 1, width: '100%', maxWidth: '440px',
                background: 'rgba(12,10,10,0.98)', border: '1px solid rgba(255,138,107,0.3)',
                borderRadius: '26px', padding: '28px',
                display: 'flex', flexDirection: 'column', gap: '20px',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div>
                <h2 className="font-clash" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--owe)' }}>Delete galaxy</h2>
                <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  This deletes <strong style={{ color: 'var(--text)' }}>{trip.name}</strong>, its members, and every expense for everyone in it. This cannot be undone.
                </p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 600 }}>
                  Type <strong>{trip.name}</strong> to confirm
                </label>
                <input
                  value={deleteTripName}
                  onChange={e => setDeleteTripName(e.target.value)}
                  placeholder={trip.name}
                  style={{
                    width: '100%', boxSizing: 'border-box', background: 'var(--glass)',
                    border: '1px solid var(--glass-brd)', borderRadius: '14px', padding: '12px 16px',
                    color: 'white', fontSize: '1rem', outline: 'none', fontFamily: 'inherit',
                    transition: 'border-color var(--dur-micro) ease',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setShowDeleteTrip(false)} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
                <button
                  onClick={handleDeleteTrip}
                  disabled={deleteTripName !== trip.name}
                  className="btn-destructive"
                  style={{ flex: 1, opacity: deleteTripName === trip.name ? 1 : 0.4 }}
                >
                  Delete galaxy
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard = ({
  profile, isConnected, onLogout, onSelectTrip, subReady, trips,
}: {
  profile: GoogleProfile; isConnected: boolean; onLogout: () => void;
  onSelectTrip: (t: Trip) => void; subReady: boolean; trips: Trip[];
}) => {
  const [newTripName, setNewTripName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newTripName.trim();
    if (!name || creating) return;
    const c = StDB.conn as any;
    if (!c) { toast.error('Not connected — try again in a moment.'); return; }
    setCreating(true);
    try {
      const tripId = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await c.reducers.createTrip({ tripId, name });
      setNewTripName('');
      onSelectTrip({ id: tripId, name });
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not create galaxy.');
    } finally {
      setCreating(false);
    }
  }, [newTripName, creating, onSelectTrip]);

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.5, ease: EO }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'all',
        display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 28px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span className="font-clash" style={{ fontWeight: 700, fontSize: '1.35rem', color: 'var(--text)' }}>SIMPLI</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {profile.name.split(' ')[0]}'s cosmos
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <div className="glass-pill" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 11px' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? 'var(--owed)' : '#555', boxShadow: isConnected ? '0 0 8px var(--owed)' : 'none' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isConnected ? 'var(--owed)' : 'var(--text-dim)' }}>{isConnected ? 'Live' : 'Offline'}</span>
        </div>
        <img src={profile.picture} alt="" style={{ width: 34, height: 34, borderRadius: '50%', border: '2px solid var(--glass-brd)' }} />
        <button onClick={onLogout} className="btn-secondary" style={{ height: '34px', borderRadius: '999px', fontSize: '0.82rem' }}>Logout</button>
      </div>

      {/* Empty State */}
      {subReady && trips.length === 0 && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', opacity: 0.6
        }}>
          <div className="font-clash" style={{ fontSize: '1.25rem', color: 'var(--text-dim)', fontWeight: 500 }}>Forge your first galaxy</div>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#6a7a76' }}>
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <polyline points="19 12 12 19 5 12"></polyline>
          </svg>
        </div>
      )}

      {/* Bottom Create Bar */}
      <div style={{
        position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
        pointerEvents: 'all', width: '100%', maxWidth: '520px', padding: '0 16px', boxSizing: 'border-box'
      }}>
        <form onSubmit={handleCreate} className="glass-pill" style={{ 
          display: 'flex', gap: '8px', padding: '8px'
        }}>
          <input
            value={newTripName} onChange={e => setNewTripName(e.target.value)}
            placeholder="Name a new galaxy…"
            style={{
              flex: 1, background: 'transparent', border: 'none', padding: '12px 18px', color: 'var(--text)',
              fontSize: '1rem', outline: 'none', fontFamily: 'inherit'
            }}
          />
          <button type="submit" disabled={!newTripName.trim() || creating || !isConnected} className="btn-primary" style={{
            borderRadius: '999px',
            padding: '0 24px', fontWeight: 700,
            opacity: newTripName.trim() && !creating && isConnected ? 1 : 0.4,
          }}>
            {creating ? '…' : 'Forge'}
          </button>
        </form>
      </div>
    </motion.div>
  );
};

// ─── Login View ────────────────────────────────────────────────────────────────
const LoginView = ({ onLogin }: { onLogin: (p: GoogleProfile) => void }) => {
  const [dbReady, setDbReady] = useState(!!StDB.conn);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onSpacetimeConnect(() => setDbReady(true));
    const u2 = StDB.onSpacetimeConnectError(e => setDbError(e.message));
    if (StDB.conn) setDbReady(true);
    return () => { u1(); u2(); };
  }, []);

  const handleSuccess = (res: any) => {
    try {
      const profile = jwtDecode<GoogleProfile>(res.credential);
      const c = StDB.conn as any;
      if (c) {
        try { c.reducers.createUser({ name: profile.name }); } catch { /* already exists */ }
      }
      onLogin(profile);
    } catch (e) { console.error('[SIMPLI] JWT decode failed', e); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-grad)', zIndex: -2 }}></div>
      <div style={{
        position: 'absolute', top: '50%', left: '50%', width: 300, height: 300,
        transform: 'translate(-50%, -50%)',
        background: 'radial-gradient(circle, rgba(167, 139, 250, 0.15) 0%, rgba(94, 230, 255, 0.15) 40%, transparent 70%)',
        zIndex: -1, animation: 'bloomFadeIn 2s ease-out forwards', filter: 'blur(40px)'
      }}></div>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="glass-panel"
        style={{
          width: '100%', maxWidth: '380px',
          padding: '48px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 className="font-clash" style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--text)' }}>SIMPLI</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', fontSize: '0.95rem', fontWeight: 500 }}>
            Split expenses in a living cosmos.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: 'var(--glass)', borderRadius: '999px', width: '100%', justifyContent: 'center' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dbError ? 'var(--owe)' : dbReady ? 'var(--owed)' : '#444', boxShadow: dbReady ? '0 0 8px var(--owed)' : 'none' }} />
          <span style={{ fontSize: '0.75rem', color: dbError ? 'var(--owe)' : dbReady ? 'var(--owed)' : 'var(--text-dim)', fontWeight: 500 }}>
            {dbError ? `Error: ${dbError}` : dbReady ? 'Database connected' : 'Connecting…'}
          </span>
        </div>

        <GoogleLogin
          onSuccess={handleSuccess}
          onError={() => toast.error('Google login failed')}
          theme="filled_black" shape="pill" size="large" width="296" text="continue_with" useOneTap={false}
        />
      </motion.div>
    </div>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────
function App() {
  const [profile, setProfile] = useState<GoogleProfile | null>(() => {
    try { const s = localStorage.getItem('simpli_user'); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });

  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(() => {
    try { const s = sessionStorage.getItem('simpli_selected_trip'); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });

  const [subReady, setSubReady] = useState(StDB.subscriptionApplied);
  const [hoveredStar, setHoveredStar] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const isConnected = useIsConnected();
  const trips = useTrip();

  const selectTrip = useCallback((t: Trip | null) => {
    if (t) {
      sessionStorage.setItem('simpli_selected_trip', JSON.stringify(t));
      // Update URL without breaking back button
      window.history.pushState({ tripId: t.id }, '', `/t/${t.id}`);
    } else {
      sessionStorage.removeItem('simpli_selected_trip');
      window.history.pushState({}, '', '/');
    }
    setSelectedTrip(t);
  }, []);

  // Browser back button support
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (e.state?.tripId) {
        const saved = sessionStorage.getItem('simpli_selected_trip');
        if (saved) try { setSelectedTrip(JSON.parse(saved)); return; } catch {}
      }
      setSelectedTrip(null);
      sessionStorage.removeItem('simpli_selected_trip');
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // Init SpacetimeDB once; subscription wired inside spacetimedb.ts onConnect
  useEffect(() => {
    initSpacetimeDB();
    const u = onSubscriptionApplied(() => setSubReady(true));
    return () => { u(); };
  }, []);

  // Handle /t/:tripId invite links
  useEffect(() => {
    const match = window.location.pathname.match(/^\/t\/([^/]+)/);
    if (match) {
      const tripId = match[1];
      const fn = () => {
        const c = StDB.conn as any;
        if (c) {
          try { c.reducers.joinTrip({ tripId }); } catch { /* already member */ }
          // Try to resolve trip name from cache
          try {
            const row = [...c.db.trip.iter()].find((t: any) => t.id === tripId);
            selectTrip({ id: tripId, name: row?.name || tripId });
          } catch { selectTrip({ id: tripId, name: tripId }); }
        }
      };
      if (StDB.conn) fn();
      else {
        const u = onSpacetimeConnect(fn);
        return () => u();
      }
    }
  }, []);

  // Pending trip from pre-auth invite
  useEffect(() => {
    if (!profile) return;
    const pending = sessionStorage.getItem('simpli_pending_trip');
    if (pending) {
      sessionStorage.removeItem('simpli_pending_trip');
      const fn = () => {
        const c = StDB.conn as any;
        if (c) {
          try { c.reducers.joinTrip({ tripId: pending }); } catch {}
          try {
            const row = [...c.db.trip.iter()].find((t: any) => t.id === pending);
            selectTrip({ id: pending, name: row?.name || pending });
          } catch { selectTrip({ id: pending, name: pending }); }
        }
      };
      if (StDB.conn) fn();
      else { const u = onSpacetimeConnect(fn); return () => u(); }
    }
  }, [profile]);

  const handleLogin = (p: GoogleProfile) => {
    localStorage.setItem('simpli_user', JSON.stringify(p));
    setProfile(p);
    const c = StDB.conn as any;
    if (c) { try { c.reducers.createUser({ name: p.name }); } catch {} }
    if (!StDB.conn) sessionStorage.setItem('simpli_pending_login', 'true');
  };

  const handleLogout = () => {
    localStorage.removeItem('simpli_user');
    googleLogout();
    setProfile(null);
    selectTrip(null);
  };

  // No local uiPaused var, using overlayOpen directly
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', background: '#020508', overflow: 'hidden' }}>
      <Toaster />

      <ErrorBoundary fallback={<div style={{ position: 'fixed', inset: 0, background: '#020508' }} />}>
        <GalaxyBackground
          trips={trips}
          activeTripId={selectedTrip?.id ?? null}
          onSelectTrip={selectTrip}
          uiPaused={overlayOpen}
          hoveredStar={hoveredStar}
          onStarHover={setHoveredStar}
          onStarClick={setSelectedMemberId}
        />
      </ErrorBoundary>

      <AnimatePresence mode="wait">
        {!profile ? (
          <LoginView key="login" onLogin={handleLogin} />
        ) : (
          <div key="authed">
            <AnimatePresence mode="wait">
              {selectedTrip ? (
                <TripRoom
                  key={`room-${selectedTrip.id}`}
                  trip={selectedTrip}
                  profile={profile}
                  isConnected={isConnected}
                  onBack={() => { selectTrip(null); setSelectedMemberId(null); setOverlayOpen(false); }}
                  onOverlayChange={setOverlayOpen}
                  selectedMemberId={selectedMemberId}
                  onSelectMember={setSelectedMemberId}
                />
              ) : (
                <Dashboard
                  key="dashboard"
                  profile={profile}
                  isConnected={isConnected}
                  onLogout={handleLogout}
                  onSelectTrip={selectTrip}
                  subReady={subReady}
                  trips={trips}
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
