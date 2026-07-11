/**
 * SIMPLI — App.tsx
 * Phases 1–5 integrated
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { motion, AnimatePresence, useMotionValue, animate, useReducedMotion } from 'framer-motion';
import { initSpacetimeDB, onSpacetimeConnect, onSpacetimeDisconnect, onSubscriptionApplied } from './spacetimedb';
import * as StDB from './spacetimedb';
import { useExpense, useExpenseSplit, useUser } from './module_bindings/hooks';
import type { Expense, ExpenseSplit } from './module_bindings/types';
import { useTrip, type Trip } from './hooks/useTrips';
import { useTripMember } from './hooks/useTrips';
import { useUserDevice } from './hooks/useUserDevice';
import { useIsMobile } from './hooks/useIsMobile';
import { resolveNames } from './lib/names';
import { buildOwesMap, pairNet } from './lib/ledger';
import { ExpenseModal } from './components/ExpenseModal';
import { GalaxyBackground, type HomeView } from './components/GalaxyBackground';
import { LeaderboardSidebar } from './components/LeaderboardSidebar';
import { ProfileModal } from './components/ProfileModal';
import { SettleModal } from './components/SettleModal';
import { NotificationsManager } from './components/NotificationsManager';
import { selfDeletedTrips } from './notifications';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster, toast } from './components/Toast';
import { AudioService } from './audio';

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

// ─── Brand wordmark ─────────────────────────────────────────────────────────────
// "SIMPLI" tracked out to span exactly the width of the "BUILT ON SPACETIMEDB"
// subtitle beneath it, so the two stacked lines are flush on both edges. The
// subtitle (nowrap) defines the width; the letters distribute across it via
// space-between — self-correcting across fonts and viewports, no magic numbers.
const SIMPLI_LETTERS = ['S', 'I', 'M', 'P', 'L', 'I'];
const SimpliWordmark = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '2px' }}>
    <span
      className="font-clash"
      aria-label="SIMPLI"
      style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.35rem', color: 'var(--text)', lineHeight: 1 }}
    >
      {SIMPLI_LETTERS.map((c, i) => <span key={i} aria-hidden="true">{c}</span>)}
    </span>
    <span style={{ fontSize: '0.52rem', fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.06em', fontFamily: 'Satoshi, sans-serif', whiteSpace: 'nowrap' }}>
      BUILT ON SPACETIMEDB
    </span>
  </div>
);

// ─── Relative time ────────────────────────────────────────────────────────────
const toDate = (ts: any): Date | null => {
  try {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();            // SDK Timestamp
    const micros = ts.microsSinceUnixEpoch ?? ts.__timestamp_micros_since_unix_epoch__ ?? ts.microsSinceEpoch;
    if (micros != null) return new Date(Number(micros) / 1000);
    if (typeof ts === 'bigint') return new Date(Number(ts) / 1000);
    if (typeof ts === 'number') return new Date(ts > 2e12 ? ts / 1000 : ts);
    const p = Date.parse(ts); return isNaN(p) ? null : new Date(p);
  } catch { return null; }
};

const relTime = (ts: any): string => {
  const d = toDate(ts);
  if (!d) return 'just now';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
};

// ─── Mobile ledger bottom-sheet ─────────────────────────────────────────────────
// A draggable bottom sheet (mobile only). Opens to a half snap, can be dragged up to
// fill the screen, and dragged / flicked down to dismiss back to the galaxy. Its
// height is animated directly (not translated) so the inner scroll area always matches
// the visible area — nothing is ever stranded below the fold at the half snap.
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const MobileLedgerSheet = ({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: React.ReactNode;
}) => {
  const h = useMotionValue(0);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const vel = useRef(0);

  const snaps = () => {
    const H = typeof window !== 'undefined' ? window.innerHeight : 800;
    return { HALF: Math.round(H * 0.62), FULL: Math.round(H - 40) };
  };

  // Slide to the half snap when opened, back to nothing when closed.
  useEffect(() => {
    const controls = animate(h, open ? snaps().HALF : 0, { type: 'spring', stiffness: 420, damping: 44 });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onMove = (e: PointerEvent) => {
    if (!dragging.current) return;
    const { FULL } = snaps();
    const dy = e.clientY - startY.current;
    h.set(clampN(startH.current - dy, 0, FULL));
    const now = performance.now();
    const dt = now - lastT.current;
    if (dt > 0) vel.current = (e.clientY - lastY.current) / dt; // +ve = moving down
    lastY.current = e.clientY;
    lastT.current = now;
  };

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
    const { HALF, FULL } = snaps();
    const cur = h.get();
    const v = vel.current;
    const MID = (HALF + FULL) / 2;
    const CLOSE_LINE = HALF * 0.62;
    let target: number;
    if (v > 0.6) target = cur > MID ? HALF : 0;   // flick down → step down / dismiss
    else if (v < -0.6) target = FULL;             // flick up → fill screen
    else if (cur < CLOSE_LINE) target = 0;        // dragged low → dismiss
    else if (cur > MID) target = FULL;            // dragged high → fill screen
    else target = HALF;                           // settle back to half
    if (target === 0) { onClose(); return; }      // open→false effect animates h→0
    animate(h, target, { type: 'spring', stiffness: 420, damping: 44 });
  };

  const onHandleDown = (e: React.PointerEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = h.get();
    lastY.current = e.clientY;
    lastT.current = performance.now();
    vel.current = 0;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
  };

  return (
    <motion.div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, height: h,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'all',
        background: 'rgba(8, 10, 16, 0.86)',
        backdropFilter: 'blur(30px) saturate(1.3)', WebkitBackdropFilter: 'blur(30px) saturate(1.3)',
        borderTop: '1px solid var(--glass-brd)', borderRadius: '24px 24px 0 0',
        boxShadow: '0 -12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {/* Drag handle — the only surface that starts a drag, so the list still scrolls freely */}
      <div
        onPointerDown={onHandleDown}
        style={{ flexShrink: 0, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', touchAction: 'none' }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.25)' }} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </div>
    </motion.div>
  );
};

// Ledger container that adapts by form factor: a fixed right panel on desktop, a
// draggable bottom sheet on mobile. Same ledger content is rendered in both.
const LedgerShell = ({ isMobile, open, onClose, children }: {
  isMobile: boolean; open: boolean; onClose: () => void; children: React.ReactNode;
}) => {
  if (isMobile) {
    return <MobileLedgerSheet open={open} onClose={onClose}>{children}</MobileLedgerSheet>;
  }
  return (
    <div className="glass-panel right-panel-glass" style={{
      pointerEvents: 'all', position: 'absolute', top: 72, right: 20, bottom: 24,
      width: '340px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'rgba(5, 6, 10, 0.65)', borderRadius: '18px'
    }}>
      {children}
    </div>
  );
};

// ─── Trip Room ─────────────────────────────────────────────────────────────────
interface EditPayload {
  expense: Expense;
  splits: ExpenseSplit[];
}

const TripRoom = ({
  trip, onBack, profile, onOpenProfile, onOpenLeaderboard, onOverlayChange, selectedMemberId, onStarClick, selectedStarPos
}: {
  trip: Trip; onBack: () => void; profile: GoogleProfile; onOpenProfile: () => void;
  onOpenLeaderboard: () => void;
  onOverlayChange: (v: boolean) => void; selectedMemberId: string | null; onStarClick: (id: string | null) => void;
  selectedStarPos: { x: number, y: number } | null;
}) => {
  const [showModal, setShowModal] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [editPayload, setEditPayload] = useState<EditPayload | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);
  const [deleteExpenseLoading, setDeleteExpenseLoading] = useState<string | null>(null);
  const [mobileLedgerOpen, setMobileLedgerOpen] = useState(false);
  const isMobile = useIsMobile();
  // On mobile, the Invite / Add-expense actions step aside while the ledger sheet is open.
  const actionsHidden = isMobile && mobileLedgerOpen;
  const [settlePayload, setSettlePayload] = useState<{ payerId: string; payeeId: string; amount: number } | null>(null);
  const starPopupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mobileLedgerOpen) document.body.classList.add('bottom-sheet-open');
    else document.body.classList.remove('bottom-sheet-open');
    return () => document.body.classList.remove('bottom-sheet-open');
  }, [mobileLedgerOpen]);

  // Dismiss the star popup when clicking/tapping anywhere outside it (cosmos or free space).
  useEffect(() => {
    if (!selectedMemberId) return;
    const onDown = (e: PointerEvent) => {
      const el = starPopupRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onStarClick(null);
    };
    // Defer so the click that opened the popup doesn't immediately close it.
    const id = window.setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    return () => { window.clearTimeout(id); document.removeEventListener('pointerdown', onDown, true); };
  }, [selectedMemberId, onStarClick]);

  const expenses = useExpense();
  const splits = useExpenseSplit();
  const allUsers = useUser();
  const tripMemberIds = useTripMember(trip.id);

  const localId = norm(StDB.getLocalId() ?? '');

  // Build user map for name lookups (resolves both identity hex and Google sub -> name)
  const userDevices = useUserDevice();
  const userMap = useMemo(() => resolveNames(allUsers, userDevices), [allUsers, userDevices]);

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
        onBack();
      }
    };
    c.db.trip.onDelete(onDel);
    return () => c.db.trip.removeOnDelete(onDel);
  }, [trip.id, trip.name, onBack]);

  // Sync overlay status with App to pause background
  useEffect(() => {
    onOverlayChange(showModal || showDeleteTrip || settlePayload !== null);
  }, [showModal, showDeleteTrip, settlePayload, onOverlayChange]);

  // Handle Escape / Backspace for back navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        if (showModal || showDeleteTrip || settlePayload) return;
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack, showModal, showDeleteTrip, settlePayload]);

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
      AudioService.playBlip();
      toast.success(isSettlement ? 'Settlement undone' : 'Expense deleted');
    } catch (e: any) {
      toast.error(e?.message ?? 'Delete failed');
    } finally {
      setDeleteExpenseLoading(null);
    }
  };

  const handleDeleteTrip = async () => {
    const c = StDB.conn as any;
    try {
      selfDeletedTrips.add(trip.id);
      await c.reducers.deleteTrip({ tripId: trip.id });
      AudioService.playBlip();
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
      const d = toDate(ts);
      return d ? d.toDateString() : 'Recent';
    };
    const dayLabel = (d: string) => {
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (d === today) return 'Today';
      if (d === yesterday) return 'Yesterday';
      // "Mon Jul 04 2026" -> "Jul 04"
      const parts = d.split(' ');
      if (parts.length >= 3) return `${parts[1]} ${parts[2]}`;
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

  const owes = useMemo(() => buildOwesMap(tripExpenses, splits), [tripExpenses, splits]);

  // Balances are ALWAYS from the local user's perspective.
  // amount > 0 means that member owes the local user.
  const myBalances = useMemo(() => {
    const result: { otherId: string; amount: number }[] = [];
    let net = 0;
    tripMembers.forEach(m => {
      if (m.id === localId) return;
      const amount = pairNet(owes, localId, m.id);
      net += amount;
      if (Math.abs(amount) > 0.01) {
        result.push({ otherId: m.id, amount });
      }
    });
    return { net, details: result.sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount)) };
  }, [owes, tripMembers, localId]);

  // Insights Data
  const insightsData = useMemo(() => {
    const nonSettlement = tripExpenses.filter(e => e.description !== 'Debt settlement');
    
    let totalGroupSpend = 0;
    const memberPaid = new Map<string, number>();
    tripMembers.forEach(m => memberPaid.set(m.id, 0));
    
    let youSpent = 0;
    let youOwedBack = 0;
    const yourExpenses: { id: string, desc: string, amount: number, owedBack: number }[] = [];

    nonSettlement.forEach(exp => {
      totalGroupSpend += exp.amount;
      const payer = norm(exp.payerId);
      memberPaid.set(payer, (memberPaid.get(payer) || 0) + exp.amount);
      
      if (payer === localId) {
        const expSplits = splits.filter(s => s.expenseId === exp.id);
        let owedBack = 0;
        expSplits.forEach(s => {
           if (norm(s.debtorId) !== localId) owedBack += s.amountOwed;
        });
        yourExpenses.push({
          id: exp.id, desc: exp.description, amount: exp.amount, owedBack
        });
        youSpent += exp.amount;
        youOwedBack += owedBack;
      }
    });

    const groupBreakdown = tripMembers.map(m => ({
      name: m.id === localId ? 'You' : (m.name.split(' ')[0]),
      paid: memberPaid.get(m.id) || 0
    })).filter(x => x.paid > 0).sort((a, b) => b.paid - a.paid);

    return { totalGroupSpend, groupBreakdown, yourExpenses, youSpent, youOwedBack };
  }, [tripExpenses, splits, tripMembers, localId]);

  // Minimum cash flow debt simplification.
  // Net position per member, then greedily match largest debtor to largest creditor.
  const simplified = useMemo(() => {
    const net = new Map<string, number>();
    tripMembers.forEach(m => net.set(m.id, 0));
    Object.entries(owes).forEach(([debtor, row]) => {
      Object.entries(row).forEach(([payee, amt]) => {
        if (net.has(debtor)) net.set(debtor, (net.get(debtor) || 0) - amt);
        if (net.has(payee)) net.set(payee, (net.get(payee) || 0) + amt);
      });
    });

    const creditors = [...net.entries()].filter(([, v]) => v > 0.01).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
    const debtors = [...net.entries()].filter(([, v]) => v < -0.01).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);

    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].v, creditors[j].v);
      if (pay > 0.01) transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
      debtors[i].v -= pay;
      creditors[j].v -= pay;
      if (debtors[i].v <= 0.01) i++;
      if (creditors[j].v <= 0.01) j++;
    }

    // Raw pairwise debt count, for the reduction stat
    let rawCount = 0;
    for (let a = 0; a < tripMembers.length; a++) {
      for (let b = a + 1; b < tripMembers.length; b++) {
        if (Math.abs(pairNet(owes, tripMembers[a].id, tripMembers[b].id)) > 0.01) rawCount++;
      }
    }

    return { transfers, rawCount };
  }, [owes, tripMembers]);

  // Contextual balance header, always from the local user's perspective.
  const headerContext = useMemo(() => {
    if (!selectedMemberId || selectedMemberId === localId) {
      return { type: 'overall', amount: myBalances.net, name: '' };
    }
    const otherName = userMap.get(selectedMemberId) || 'Member';
    const firstName = otherName.split(' ')[0];
    const amount = pairNet(owes, localId, selectedMemberId);
    return { type: 'pair', amount: Math.abs(amount) > 0.01 ? amount : 0, name: firstName };
  }, [selectedMemberId, localId, myBalances, owes, userMap]);

  // What to show on a member's star popup. First their balance WITH ME; if settled with me,
  // their single biggest debt with anyone else. isDebt=true means the selected member is the
  // one who OWES (so it renders red); false means they are the one owed (renders green).
  const starDebt = useMemo(() => {
    if (!selectedMemberId || selectedMemberId === localId) return null;
    const memberName = (userMap.get(selectedMemberId) || 'Member').split(' ')[0];
    const withMe = pairNet(owes, localId, selectedMemberId); // >0 they owe me, <0 I owe them
    if (Math.abs(withMe) > 0.5) {
      if (withMe > 0) return { text: `${memberName} owes you`, amount: withMe, isDebt: true, withMe: true, dir: 'theyOweMe' as const, payerId: selectedMemberId, payeeId: localId };
      return { text: `You owe ${memberName}`, amount: -withMe, isDebt: false, withMe: true, dir: 'iOweThem' as const, payerId: localId, payeeId: selectedMemberId };
    }
    let best: { otherId: string; amount: number; selectedOwes: boolean } | null = null;
    let bestAbs = 0.5;
    tripMembers.forEach(m => {
      if (m.id === selectedMemberId || m.id === localId) return;
      const a = pairNet(owes, selectedMemberId, m.id); // >0 m owes selected, <0 selected owes m
      if (Math.abs(a) > bestAbs) { bestAbs = Math.abs(a); best = { otherId: m.id, amount: Math.abs(a), selectedOwes: a < 0 }; }
    });
    const chosen = best as { otherId: string; amount: number; selectedOwes: boolean } | null;
    if (!chosen) return { text: 'Settled up with you', amount: 0, isDebt: false, withMe: false, dir: 'settled' as const, payerId: '', payeeId: '' };
    const otherName = (userMap.get(chosen.otherId) || 'Member').split(' ')[0];
    if (chosen.selectedOwes) return { text: `${memberName} owes ${otherName}`, amount: chosen.amount, isDebt: true, withMe: false, dir: 'thirdParty' as const, payerId: selectedMemberId, payeeId: chosen.otherId };
    return { text: `${otherName} owes ${memberName}`, amount: chosen.amount, isDebt: false, withMe: false, dir: 'thirdParty' as const, payerId: chosen.otherId, payeeId: selectedMemberId };
  }, [selectedMemberId, localId, owes, tripMembers, userMap]);

  return (
    <motion.div
      key="trip-room"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ delay: 0.2, duration: 0.5, ease: EO }}
      style={{ position: 'fixed', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}
    >
      {/* Top bar */}
      <div style={{
        pointerEvents: 'all', display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px',
        padding: isMobile ? '14px 14px' : '16px 24px',
        background: 'linear-gradient(to bottom, rgba(2,5,8,0.92) 0%, rgba(2,5,8,0) 100%)',
      }}>
        {isMobile ? (
          <>
            {/* Left: brand bolt + group name — the whole cluster is the back affordance.
                Fills remaining width and truncates gracefully so nothing crops. */}
            <button
              onClick={onBack}
              className="btn-ghost"
              title="Back to cosmos"
              aria-label={`Back to cosmos, currently in ${trip.name}`}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, padding: '4px 4px', justifyContent: 'flex-start' }}
            >
              <svg width="22" height="21" viewBox="0 0 48 46" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
                <defs><linearGradient id="simpliBoltRoom" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFC46B" /><stop offset="100%" stopColor="#E8963A" /></linearGradient></defs>
                <path d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z" fill="url(#simpliBoltRoom)" />
              </svg>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
              <span className="font-clash" style={{ fontWeight: 700, fontSize: '1.12rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.01em' }}>{trip.name}</span>
            </button>

            {/* Right: compact action cluster */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <button
                onClick={() => setShowDeleteTrip(true)}
                style={{ ...BTN_GHOST, width: 30, height: 30, padding: 0, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Delete galaxy" aria-label="Delete galaxy"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
              <button onClick={onOpenLeaderboard} title="Leaderboard" aria-label="Leaderboard" className="trophy-btn" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, padding: 0, borderRadius: '50%', cursor: 'pointer',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,196,107,0.25)',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs><linearGradient id="trophyGradRoom" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse"><stop stopColor="#FFD79A" /><stop offset="1" stopColor="#E8963A" /></linearGradient></defs>
                  <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" stroke="url(#trophyGradRoom)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M17 5h2.5a1.5 1.5 0 0 1 0 5H17M7 5H4.5a1.5 1.5 0 0 0 0 5H7" stroke="url(#trophyGradRoom)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <img src={profile.picture} alt="Profile" onClick={onOpenProfile} title="Profile" className="profile-avatar" style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid rgba(156,174,169,0.3)', cursor: 'pointer' }} />
            </div>
          </>
        ) : (
          <>
            <div onClick={onBack} title="Back to cosmos" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', transition: 'opacity 0.2s' }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}>
              <svg width="26" height="25" viewBox="0 0 48 46" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
                <defs><linearGradient id="simpliBoltRoom" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFC46B" /><stop offset="100%" stopColor="#E8963A" /></linearGradient></defs>
                <path d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z" fill="url(#simpliBoltRoom)" />
              </svg>
              <SimpliWordmark />
            </div>

            <div style={{ flex: 1 }} />

            {/* Galaxy Chip (Back to Cosmos) */}
            <button onClick={onBack} className="btn-ghost" style={{
              padding: '8px 16px 8px 12px', fontWeight: 600, color: 'var(--text)',
              background: 'var(--glass)', border: '1px solid var(--glass-brd)', borderRadius: '12px',
              display: 'flex', alignItems: 'center', gap: '8px',
              transition: 'background 0.2s', fontSize: '0.9rem'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--glass)'}
            >
              <span style={{ color: 'var(--text-dim)' }}>←</span> {trip.name}
            </button>

            <div style={{ flex: 1 }} />

            {/* Galaxy settings (Trash) */}
            <button
              onClick={() => setShowDeleteTrip(true)}
              style={{ ...BTN_GHOST, padding: '8px', color: 'var(--text-dim)', transition: 'color 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--owe)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
              title="Delete galaxy"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>

            <button onClick={onOpenLeaderboard} title="Leaderboard" aria-label="Leaderboard" className="trophy-btn" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, marginLeft: '12px', padding: 0,
              borderRadius: '50%', cursor: 'pointer',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,196,107,0.25)',
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="trophyGradRoom" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#FFD79A" /><stop offset="1" stopColor="#E8963A" />
                  </linearGradient>
                </defs>
                <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" stroke="url(#trophyGradRoom)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M17 5h2.5a1.5 1.5 0 0 1 0 5H17M7 5H4.5a1.5 1.5 0 0 0 0 5H7" stroke="url(#trophyGradRoom)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <img src={profile.picture} alt="Profile" onClick={onOpenProfile} title="Profile" className="profile-avatar" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(156,174,169,0.3)', marginLeft: '8px', cursor: 'pointer' }} />
          </>
        )}
      </div>

      {/* Mobile balance status bar: always-visible trip balance, tap to open the ledger sheet */}
      {isMobile && (
        <button
          onClick={() => setMobileLedgerOpen(true)}
          style={{
            pointerEvents: 'all', margin: '2px 16px 0', textAlign: 'left', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
            padding: '12px 16px', borderRadius: '14px',
            background: 'rgba(5,6,10,0.72)', border: '1px solid var(--glass-brd)',
            backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Your balance</span>
            <span className="money" style={{ fontSize: '1.05rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: Math.abs(myBalances.net) < 0.5 ? 'var(--text-dim)' : (myBalances.net > 0 ? 'var(--owed)' : 'var(--owe)') }}>
              {Math.abs(myBalances.net) < 0.5 ? 'All settled up' : myBalances.net > 0 ? `You're owed ${INR(Math.abs(myBalances.net))}` : `You owe ${INR(Math.abs(myBalances.net))}`}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)' }}>
            Ledger
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </span>
        </button>
      )}

      {/* Tap-to-dismiss backdrop behind the mobile ledger sheet */}
      {isMobile && mobileLedgerOpen && (
        <div
          onClick={() => setMobileLedgerOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 19, pointerEvents: 'all',
            background: 'rgba(2,4,8,0.45)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Bottom Actions */}
      <div style={isMobile ? {
        position: 'absolute', left: 0, right: 0, pointerEvents: 'none',
        bottom: 'calc(20px + env(safe-area-inset-bottom))',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', zIndex: 20,
        opacity: actionsHidden ? 0 : 1,
        transform: actionsHidden ? 'translateY(24px)' : 'translateY(0)',
        transition: 'opacity 0.28s ease, transform 0.4s cubic-bezier(0.32,0.72,0,1)',
      } : {
        position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'all',
        display: 'flex', alignItems: 'center', gap: '12px', zIndex: 20
      }}>
        {/* On mobile: compact icon-only Invite; on desktop: full labeled button */}
        <button onClick={copyInvite} className="btn-secondary lift" style={{
          padding: 0, height: isMobile ? '46px' : '48px', borderRadius: isMobile ? '14px' : '12px',
          width: isMobile ? '46px' : 'auto', minWidth: isMobile ? '46px' : '160px', flex: 'none',
          background: 'rgba(5,6,10,0.72)', border: '1px solid rgba(255,255,255,0.14)',
          backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 0 : '8px',
          color: '#ffffff', fontSize: '0.95rem', fontWeight: 600, pointerEvents: actionsHidden ? 'none' : 'all',
          paddingLeft: isMobile ? 0 : undefined, paddingRight: isMobile ? 0 : undefined,
        }}
        aria-label="Invite" title="Invite">
           <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--self)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
           {!isMobile && (copied ? 'Copied' : 'Invite')}
        </button>

        <button onClick={() => { AudioService.playBlip(); setEditPayload(null); setShowModal(true); }} className="btn-primary lift" style={{
          padding: isMobile ? '0 22px' : '0', height: isMobile ? '46px' : '48px', borderRadius: isMobile ? '14px' : '12px',
          minWidth: isMobile ? 0 : '160px', flex: 'none',
          background: 'linear-gradient(180deg, #FFC46B, #E8963A)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          color: '#ffffff', fontSize: isMobile ? '0.9rem' : '0.95rem', fontWeight: 600,
          boxShadow: '0 6px 18px rgba(232,150,58,0.35)', pointerEvents: actionsHidden ? 'none' : 'all',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Add expense
        </button>
      </div>

      {/* Mobile ledger access is on the balance status bar under the header now. */}

      {/* Ledger — fixed right panel on desktop, draggable bottom sheet on mobile */}
      <LedgerShell isMobile={isMobile} open={mobileLedgerOpen} onClose={() => setMobileLedgerOpen(false)}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--glass-brd)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {headerContext.type === 'overall' ? 'Your Balance' : `${headerContext.name}'s Balance with you`}
              <button className="mobile-ledger-close" onClick={() => setMobileLedgerOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px' }}>&times;</button>
            </div>
            <button
              onClick={() => setShowInsights(!showInsights)}
              className="btn-ghost"
              style={{
                padding: '6px', color: showInsights ? 'var(--text)' : 'var(--text-dim)',
                borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: showInsights ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid', borderColor: showInsights ? 'rgba(255,255,255,0.1)' : 'transparent'
              }}
              title="Insights"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            </button>
          </div>
          <div className="money" style={{ fontSize: '1.2rem', fontWeight: 600, color: headerContext.amount === 0 ? 'var(--text-dim)' : (headerContext.type === 'overall' ? (headerContext.amount > 0 ? 'var(--owed)' : 'var(--owe)') : 'var(--owe)') }}>
            {headerContext.amount === 0 ? (headerContext.type === 'overall' ? 'Settled up' : `Settled with ${headerContext.name}`) : (headerContext.amount > 0 ? (headerContext.type === 'overall' ? `You're owed ${INR(Math.abs(headerContext.amount))}` : `${headerContext.name} owes you ${INR(Math.abs(headerContext.amount))}`) : (headerContext.type === 'overall' ? `You owe ${INR(Math.abs(headerContext.amount))}` : `You owe ${headerContext.name} ${INR(Math.abs(headerContext.amount))}`))}
          </div>
        </div>

        {/* B2: Settle up rows */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--glass-brd)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Balances</div>
          {myBalances.details.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>All settled ✓</div>
          ) : (
            myBalances.details.map(d => {
              const otherName = userMap.get(d.otherId) || 'Member';
              const firstName = otherName.split(' ')[0];
              const isPositive = d.amount > 0;
              return (
                <div key={d.otherId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--owe)' }}>
                    {isPositive ? `${firstName} owes you ${INR(Math.abs(d.amount))}` : `You owe ${firstName} ${INR(Math.abs(d.amount))}`}
                  </div>
                  <button onClick={() => {
                    const payerId = isPositive ? d.otherId : localId;
                    const payeeId = isPositive ? localId : d.otherId;
                    setSettlePayload({ payerId, payeeId, amount: Math.round(Math.abs(d.amount)) });
                  }} style={{ background: 'transparent', border: '1px solid var(--self)', color: '#ffffff', borderRadius: '12px', height: '34px', padding: '0 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Settle</button>
                </div>
              );
            })
          )}
        </div>

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
                    : (expSplits.length === 1 && norm(expSplits[0].debtorId) === norm(exp.payerId))
                      ? 'Personal'
                      : `${isMe ? 'You' : payerName} paid · split ${expSplits.length} way${expSplits.length === 1 ? '' : 's'}`;
                  const isConfirming = deleteConfirm === exp.id;

                  return (
                    <motion.div
                      key={exp.id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: i * 0.03, duration: 0.25, ease: EO }}
                      className="expense-row"
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
                        </div>
                      </div>
                      
                      {/* Action buttons (icon row below on hover) */}
                      <div className="expense-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                        {!isSettlement && (
                          <button
                            onClick={() => { setEditPayload({ expense: exp, splits: expSplits }); setShowModal(true); }}
                            className="btn-ghost"
                            style={{ padding: '6px', color: 'var(--text-dim)', transition: 'color 0.2s', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text)'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                            title="Edit"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteExpense(exp.id, exp.description)}
                          disabled={deleteExpenseLoading === exp.id}
                          className="btn-ghost"
                          style={{
                            padding: '6px', color: isConfirming ? 'var(--owe)' : 'var(--text-dim)', 
                            transition: 'color 0.2s', display: 'flex', alignItems: 'center'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--owe)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = isConfirming ? 'var(--owe)' : 'var(--text-dim)'}
                          title={isSettlement ? 'Undo settlement' : 'Delete expense'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                          {isConfirming && <span style={{ marginLeft: '4px', fontSize: '0.7rem' }}>Confirm?</span>}
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </LedgerShell>

      {/* Insights panel */}
      <AnimatePresence>
        {showInsights && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            className="glass-panel insights-panel"
            style={{
              pointerEvents: 'all', position: 'absolute', top: 72, bottom: 24,
              right: 376, width: 340,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              background: 'rgba(5, 6, 10, 0.65)', borderRadius: '18px', zIndex: 19
            }}
          >
            <div style={{ padding: '20px', borderBottom: '1px solid var(--glass-brd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="font-clash" style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>Insights</span>
              <button onClick={() => setShowInsights(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}>&times;</button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Simplify Debts</div>
                  {simplified.transfers.length > 0 && simplified.rawCount > simplified.transfers.length && (
                    <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--self)' }}>
                      {simplified.rawCount} payments to {simplified.transfers.length}
                    </div>
                  )}
                </div>
                {simplified.transfers.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Nothing to simplify. Everyone is settled.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--glass-brd)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.45 }}>
                      The fewest transfers that clear every debt in this galaxy.
                    </div>
                    {simplified.transfers.map((t, i) => {
                      const fromName = t.from === localId ? 'You' : (userMap.get(t.from) || 'Member').split(' ')[0];
                      const toName = t.to === localId ? 'You' : (userMap.get(t.to) || 'Member').split(' ')[0];
                      return (
                        <div key={`${t.from}-${t.to}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--owe)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fromName}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <line x1="4" y1="12" x2="20" y2="12" /><polyline points="13 5 20 12 13 19" />
                            </svg>
                            <span style={{ color: 'var(--owed)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toName}</span>
                            <span className="money" style={{ color: 'var(--text)', fontWeight: 700, marginLeft: '4px', flexShrink: 0 }}>{INR(Math.round(t.amount))}</span>
                          </div>
                          <button onClick={() => setSettlePayload({ payerId: t.from, payeeId: t.to, amount: Math.round(t.amount) })}
                            style={{ background: 'transparent', border: '1px solid var(--self)', color: '#ffffff', borderRadius: '12px', height: '30px', padding: '0 10px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                            Settle
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Your Spend</div>
                {insightsData.yourExpenses.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>You haven't paid for anything yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {insightsData.yourExpenses.map(exp => (
                      <div key={exp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.9rem', color: 'var(--text)', fontWeight: 500 }}>{exp.desc}</div>
                          <div style={{ fontSize: '0.75rem', color: exp.owedBack > 0 ? 'var(--owed)' : 'var(--text-dim)' }}>
                            {exp.owedBack > 0 ? `${INR(exp.owedBack)} owed back to you` : 'Personal'}
                          </div>
                        </div>
                        <div className="money" style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>
                          {INR(exp.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div style={{ marginTop: '4px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                    <span>You spent</span>
                    <span className="money" style={{ color: 'var(--text)', fontWeight: 600 }}>{INR(insightsData.youSpent)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                    <span>Owed back to you</span>
                    <span className="money" style={{ color: 'var(--owed)', fontWeight: 600 }}>{INR(insightsData.youOwedBack)}</span>
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Group Spend</div>
                <div style={{ padding: '16px', background: 'var(--glass)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', borderBottom: '1px solid var(--glass-brd)', paddingBottom: '12px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Total group expenditure</span>
                    <span className="money" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)' }}>{INR(insightsData.totalGroupSpend)}</span>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {insightsData.groupBreakdown.map(m => (
                      <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--text-dim)' }}>{m.name} paid</span>
                        <span className="money" style={{ fontWeight: 600, color: 'var(--text)' }}>{INR(m.paid)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
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
                borderRadius: '18px', padding: '28px',
                display: 'flex', flexDirection: 'column', gap: '20px',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div>
                <h2 className="font-clash" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--owe)' }}>Delete galaxy?</h2>
                <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  This deletes <strong style={{ color: 'var(--text)' }}>{trip.name}</strong>, its members, and every expense for everyone in it. This cannot be undone.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setShowDeleteTrip(false)} className="btn-secondary" style={{ flex: 1 }}>No, cancel</button>
                <button
                  onClick={handleDeleteTrip}
                  className="btn-destructive"
                  style={{ flex: 1 }}
                >
                  Yes, delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SettleModal
        payload={settlePayload}
        onClose={() => setSettlePayload(null)}
        tripId={trip.id}
        userMap={userMap}
        localId={localId}
      />

      {/* B3: DOM Popup for selected star */}
      <AnimatePresence>
        {selectedMemberId && selectedStarPos && (
          <motion.div
            ref={starPopupRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', damping: 24, stiffness: 350 }}
            style={{
              position: 'fixed',
              top: Math.max(20, Math.min(window.innerHeight - 250, selectedStarPos.y - 100)),
              left: selectedStarPos.x > window.innerWidth * 0.66
                ? Math.max(20, selectedStarPos.x - 244)
                : Math.min(window.innerWidth - 240, selectedStarPos.x + 24),
              background: 'rgba(10, 12, 16, 0.85)', backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px',
              padding: '20px', width: '220px', zIndex: 30,
              boxShadow: '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', pointerEvents: 'all'
            }}
          >
            <div style={{
              position: 'absolute',
              top: Math.max(12, Math.min(188, selectedStarPos.y - Math.max(20, Math.min(window.innerHeight - 250, selectedStarPos.y - 100)) - 6)),
              left: selectedStarPos.x > window.innerWidth * 0.66 ? 'auto' : '-6px',
              right: selectedStarPos.x > window.innerWidth * 0.66 ? '-6px' : 'auto',
              transform: 'rotate(45deg)', width: '12px', height: '12px',
              background: 'rgba(10, 12, 16, 0.85)',
              borderBottom: selectedStarPos.x > window.innerWidth * 0.66 ? 'none' : '1px solid rgba(255,255,255,0.15)',
              borderLeft: selectedStarPos.x > window.innerWidth * 0.66 ? 'none' : '1px solid rgba(255,255,255,0.15)',
              borderTop: selectedStarPos.x > window.innerWidth * 0.66 ? '1px solid rgba(255,255,255,0.15)' : 'none',
              borderRight: selectedStarPos.x > window.innerWidth * 0.66 ? '1px solid rgba(255,255,255,0.15)' : 'none',
              backdropFilter: 'blur(20px)'
            }} />
            <button onClick={() => onStarClick(null)} style={{ position: 'absolute', top: '8px', right: '8px', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>&times;</button>
            <div style={{ width: '100%', textAlign: 'center', marginTop: '8px' }}>
              <div style={{ color: 'var(--text)', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'Satoshi, sans-serif' }}>
                {selectedMemberId === localId ? 'You' : userMap.get(selectedMemberId) || 'Member'}
              </div>
              {selectedMemberId !== localId && starDebt && (
                <>
                  <div style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                    {starDebt.text}
                  </div>
                  {starDebt.amount > 0.5 && (
                    <div className="money" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--owe)' }}>
                      {INR(starDebt.amount)}
                    </div>
                  )}
                </>
              )}
              {selectedMemberId === localId && (
                <>
                  <div style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--text-dim)' }}>Total Net Balance</div>
                  <div className="money" style={{ fontSize: '1.4rem', fontWeight: 700, color: headerContext.amount === 0 ? 'var(--text-dim)' : (headerContext.amount > 0 ? 'var(--owed)' : 'var(--owe)') }}>
                    {headerContext.amount === 0 ? INR(0) : (headerContext.amount > 0 ? `You're owed ${INR(Math.abs(headerContext.amount))}` : `You owe ${INR(Math.abs(headerContext.amount))}`)}
                  </div>
                </>
              )}
            </div>
            {selectedMemberId !== localId && starDebt && starDebt.dir !== 'settled' && starDebt.amount > 0.5 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSettlePayload({ payerId: starDebt.payerId, payeeId: starDebt.payeeId, amount: Math.round(starDebt.amount) });
                  onStarClick(null);
                }}
                className="btn-primary"
                style={{
                  width: '100%', padding: '10px 0', borderRadius: '12px', fontSize: '0.9rem', fontWeight: 700,
                  background: 'rgba(255,255,255,0.95)', color: '#000', boxShadow: '0 4px 12px rgba(255,255,255,0.15)'
                }}
              >
                Settle up
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
};

// ─── Settled-sector control ─────────────────────────────────────────────────
// A left-edge tab that zoops between active and settled galaxies. It introduces itself
// fully (icon + label) on mount / view change, then slides back to a compact icon so it
// never dominates the viewport. On desktop it re-expands on hover.
const SettledSectorControl = ({
  homeView, onSetHomeView, settledCount,
}: { homeView: HomeView; onSetHomeView: (v: HomeView) => void; settledCount: number }) => {
  const [expanded, setExpanded] = useState(true);
  const isMobile = useIsMobile();
  const active = homeView === 'active';

  // Show full, then collapse to the compact tab after a brief beat (~1.5s) — replays on
  // view change. Kept short so it introduces itself without lingering over the cosmos.
  useEffect(() => {
    setExpanded(true);
    const t = window.setTimeout(() => setExpanded(false), 1500);
    return () => window.clearTimeout(t);
  }, [homeView]);

  const label = active
    ? { kicker: 'Settled', main: `${settledCount} ${settledCount === 1 ? 'group' : 'groups'}` }
    : { kicker: 'Back to', main: 'Active groups' };

  return (
    <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 12 }}>
      <motion.button
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: EO }}
        onClick={() => { AudioService.playBlip(); onSetHomeView(active ? 'settled' : 'active'); }}
        onHoverStart={() => { if (!isMobile) setExpanded(true); }}
        onHoverEnd={() => { if (!isMobile) setExpanded(false); }}
        aria-label={active ? 'View settled groups' : 'Back to active groups'}
        title={active ? 'View settled groups' : 'Back to active groups'}
        style={{
          pointerEvents: 'all', cursor: 'pointer', overflow: 'hidden',
          display: 'flex', alignItems: 'center',
          padding: '8px 11px 8px 9px',
          background: 'rgba(5,6,10,0.72)', border: '1px solid var(--glass-brd)', borderLeft: 'none',
          borderRadius: '0 16px 16px 0',
          backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)', color: 'var(--text)',
        }}
      >
        {/* Uniform affordance on both sectors: a single left-arrow chevron. */}
        <span style={{ display: 'flex', width: 28, height: 28, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--self)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </span>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.span
              key="lbl"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: EO }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 10, overflow: 'hidden', whiteSpace: 'nowrap' }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{label.kicker}</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>{label.main}</span>
              </span>
              {active && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard = ({
  profile, isConnected, onOpenProfile, onOpenLeaderboard, onSelectTrip, subReady, trips,
  homeView, onSetHomeView, sectorCounts,
}: {
  profile: GoogleProfile; isConnected: boolean; onOpenProfile: () => void; onOpenLeaderboard: () => void;
  onSelectTrip: (t: Trip) => void; subReady: boolean; trips: Trip[];
  homeView: HomeView; onSetHomeView: (v: HomeView) => void; sectorCounts: { active: number; settled: number };
}) => {
  const [newTripName, setNewTripName] = useState('');
  const [creating, setCreating] = useState(false);
  const isMobile = useIsMobile();

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newTripName.trim();
    if (!name || creating) return;
    const c = StDB.conn as any;
    if (!c) { toast.error('Not connected. Try again in a moment.'); return; }
    setCreating(true);
    try {
      const tripId = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await c.reducers.createTrip({ tripId, name });
      try { localStorage.setItem('simpli_trips_created', String((Number(localStorage.getItem('simpli_trips_created')) || 0) + 1)); } catch {}
      setNewTripName('');
      AudioService.playBlip();
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
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'all',
        display: 'flex', alignItems: 'center', gap: '24px', padding: '20px 28px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="26" height="25" viewBox="0 0 48 46" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
            <defs><linearGradient id="simpliBoltHome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFC46B" /><stop offset="100%" stopColor="#E8963A" /></linearGradient></defs>
            <path d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z" fill="url(#simpliBoltHome)" />
          </svg>
          <SimpliWordmark />
        </div>
        <div style={{ flex: 1 }} />
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onOpenLeaderboard} title="Leaderboard" aria-label="Leaderboard" className="trophy-btn" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, padding: 0,
            borderRadius: '50%', cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,196,107,0.25)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="trophyGradHome" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#FFD79A" /><stop offset="1" stopColor="#E8963A" />
                </linearGradient>
              </defs>
              <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" stroke="url(#trophyGradHome)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M17 5h2.5a1.5 1.5 0 0 1 0 5H17M7 5H4.5a1.5 1.5 0 0 0 0 5H7" stroke="url(#trophyGradHome)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <img src={profile.picture} alt="Profile" onClick={onOpenProfile} title="Profile" className="profile-avatar" style={{ width: 34, height: 34, borderRadius: '50%', border: '2px solid var(--glass-brd)', cursor: 'pointer' }} />
        </div>
      </div>

      {/* Settled-sector control: animated left-edge tab */}
      {subReady && sectorCounts.settled > 0 && (
        <SettledSectorControl homeView={homeView} onSetHomeView={onSetHomeView} settledCount={sectorCounts.settled} />
      )}

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

      {/* Active sector empty, but settled groups exist → gently point to the settled sector */}
      {subReady && trips.length > 0 && homeView === 'active' && sectorCounts.active === 0 && sectorCounts.settled > 0 && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', opacity: 0.6, textAlign: 'center', padding: '0 24px'
        }}>
          <div className="font-clash" style={{ fontSize: '1.15rem', color: 'var(--text-dim)', fontWeight: 500 }}>Everything's settled up ✦</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Your settled groups are parked in their own sector — open it from the left.</div>
        </div>
      )}

      {/* Settled sector caption */}
      {subReady && homeView === 'settled' && (
        <div style={{
          position: 'absolute', top: 'calc(20px + 64px)', left: '50%', transform: 'translateX(-50%)',
          pointerEvents: 'none', textAlign: 'center', opacity: 0.75
        }}>
          <div className="font-clash" style={{ fontSize: '1rem', color: 'var(--text)', fontWeight: 600 }}>Settled groups</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>All squared away — nothing owed here</div>
        </div>
      )}

      {/* Bottom Create Bar */}
      <div style={{
        position: 'absolute', bottom: isMobile ? 'calc(20px + env(safe-area-inset-bottom))' : '32px', left: '50%', transform: 'translateX(-50%)',
        pointerEvents: 'all', width: '100%', maxWidth: isMobile ? '460px' : '520px', padding: '0 16px', boxSizing: 'border-box'
      }}>
        {/* Soft outer glow */}
        <div style={{
          position: 'absolute', inset: '0 16px', borderRadius: '12px',
          background: 'radial-gradient(circle at 50% 50%, rgba(255,183,77,0.12) 0%, rgba(94,230,255,0.06) 50%, transparent 100%)',
          filter: isMobile ? 'blur(18px)' : 'blur(22px)', zIndex: -1, pointerEvents: 'none'
        }} />
        <form onSubmit={handleCreate} style={{
          display: 'flex', gap: isMobile ? '8px' : '10px'
        }}>
          <div style={{
            flex: 1, position: 'relative', display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '10px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.16)', borderRadius: isMobile ? '12px' : '14px',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.35), 0 0 26px rgba(255,183,77,0.10)',
            paddingLeft: isMobile ? '14px' : '16px',
            transition: 'border-color 0.2s, box-shadow 0.2s'
          }}>
            <svg width={isMobile ? 16 : 18} height={isMobile ? 16 : 18} viewBox="0 0 24 24" fill="none" stroke="var(--self)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.9 }}>
              <path d="M12 3v18M3 12h18" />
            </svg>
            <input
              value={newTripName} onChange={e => setNewTripName(e.target.value)}
              placeholder="Create a new group / galaxy..."
              style={{
                width: '100%', background: 'transparent', border: 'none', padding: isMobile ? '0 14px 0 0' : '0 18px 0 0', color: 'var(--text)',
                fontSize: isMobile ? '0.9rem' : '0.95rem', outline: 'none', fontFamily: 'inherit', height: isMobile ? '44px' : '50px', borderRadius: isMobile ? '12px' : '14px'
              }}
              onFocus={(e) => e.target.parentElement!.style.borderColor = 'rgba(255,183,77,0.5)'}
              onBlur={(e) => e.target.parentElement!.style.borderColor = 'rgba(255,255,255,0.14)'}
            />
          </div>
          <button type="submit" disabled={!newTripName.trim() || creating || !isConnected} className="btn-primary" style={{
            borderRadius: isMobile ? '12px' : '14px', height: isMobile ? '44px' : '50px', padding: isMobile ? '0 20px' : '0 30px',
            fontWeight: 700, fontSize: isMobile ? '0.9rem' : '0.95rem', letterSpacing: '0.01em', flexShrink: 0,
            opacity: newTripName.trim() && !creating && isConnected ? 1 : 0.9,
            background: 'linear-gradient(180deg, #FFC46B, #E8963A)',
            color: '#ffffff', border: 'none',
            cursor: newTripName.trim() && !creating && isConnected ? 'pointer' : 'default',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 8px 22px rgba(232,150,58,0.4)',
            transform: 'translateY(0)'
          }}
          onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(232,150,58,0.45)'; } }}
          onMouseLeave={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(232,150,58,0.35)'; } }}
          >
            {creating ? '...' : 'Create'}
          </button>
        </form>
      </div>
    </motion.div>
  );
};

// ─── Login View ────────────────────────────────────────────────────────────────
// Twinkling starfield for the login backdrop (DOM/SVG only, no WebGL). Positions live
// in a 0..100 space rendered with preserveAspectRatio="none".
const LOGIN_STARS = [
  { cx: 8,  cy: 14, r: 0.32, d: 0.2, t: 4.5 },
  { cx: 18, cy: 62, r: 0.24, d: 1.4, t: 5.5 },
  { cx: 26, cy: 28, r: 0.40, d: 0.8, t: 4.0 },
  { cx: 33, cy: 82, r: 0.22, d: 2.1, t: 6.0 },
  { cx: 42, cy: 18, r: 0.30, d: 1.1, t: 5.0 },
  { cx: 48, cy: 70, r: 0.26, d: 0.4, t: 4.8 },
  { cx: 57, cy: 12, r: 0.36, d: 1.8, t: 5.2 },
  { cx: 63, cy: 46, r: 0.20, d: 2.6, t: 6.2 },
  { cx: 71, cy: 24, r: 0.30, d: 0.6, t: 4.4 },
  { cx: 78, cy: 66, r: 0.34, d: 1.5, t: 5.6 },
  { cx: 86, cy: 34, r: 0.24, d: 2.3, t: 5.0 },
  { cx: 92, cy: 74, r: 0.28, d: 0.9, t: 4.6 },
  { cx: 14, cy: 88, r: 0.26, d: 1.9, t: 5.8 },
  { cx: 5,  cy: 42, r: 0.22, d: 2.8, t: 6.0 },
  { cx: 37, cy: 52, r: 0.18, d: 1.2, t: 4.2 },
  { cx: 52, cy: 90, r: 0.30, d: 0.3, t: 5.4 },
  { cx: 68, cy: 84, r: 0.22, d: 2.0, t: 5.0 },
  { cx: 82, cy: 8,  r: 0.28, d: 1.0, t: 4.8 },
  { cx: 95, cy: 52, r: 0.20, d: 1.6, t: 6.1 },
  { cx: 22, cy: 40, r: 0.24, d: 0.7, t: 5.2 },
  { cx: 60, cy: 60, r: 0.18, d: 2.4, t: 4.6 },
  { cx: 45, cy: 36, r: 0.22, d: 1.3, t: 5.6 },
];

const LoginView = ({ onLogin }: { onLogin: (p: GoogleProfile) => void }) => {
  const reduce = useReducedMotion();

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

  // Card eases in; wordmark, tagline, then button rise in sequence (Emil Kowalski timing).
  // Object-form transitions (matching the rest of the app) so frequent parent re-renders
  // never stall the entrance. Reduced motion collapses it into a single calm fade.
  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3 } }
      : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, ease: EO, delay } };

  return (
    <div className="login-root" style={{
      position: 'fixed', inset: 0, zIndex: 50, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
    }}>
      {/* Cosmos backdrop: aurora, twinkle, and one slow drifting glow (CSS + SVG only) */}
      <div className="login-cosmos" aria-hidden="true">
        <div className="login-aurora a1" />
        <div className="login-aurora a2" />
        <div className="login-aurora a3" />
        <div className="login-glow" />
        <svg className="login-stars" viewBox="0 0 100 100" preserveAspectRatio="none">
          {LOGIN_STARS.map((s, i) => (
            <circle key={i} className="login-star" cx={s.cx} cy={s.cy} r={s.r}
              style={{ animationDelay: `${s.d}s`, animationDuration: `${s.t}s` }} />
          ))}
        </svg>
      </div>

      <motion.div
        className="glass-panel login-card"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.965, y: 8 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        transition={reduce ? { duration: 0.3 } : { duration: 0.6, ease: EO }}
        style={{
          position: 'relative', width: 'min(340px, 100%)',
          padding: '44px 28px 34px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '22px',
        }}
      >
        {/* Wordmark: gradient bolt above SIMPLI, matching the in-app headers */}
        <motion.div {...rise(0.18)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <svg width="42" height="40" viewBox="0 0 48 46" fill="none" aria-hidden="true">
            <defs><linearGradient id="simpliBoltLogin" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFC46B" /><stop offset="100%" stopColor="#E8963A" /></linearGradient></defs>
            <path d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z" fill="url(#simpliBoltLogin)" />
          </svg>
          <h1 className="font-clash" style={{ margin: 0, fontSize: 'clamp(1.9rem, 7vw, 2.15rem)', fontWeight: 700, letterSpacing: '0.16em', paddingLeft: '0.16em', color: 'var(--text)' }}>SIMPLI</h1>
        </motion.div>

        {/* Tagline */}
        <motion.p {...rise(0.27)} style={{ margin: '-6px 0 0', color: 'var(--text-dim)', fontSize: '0.95rem', fontWeight: 500, textAlign: 'center', lineHeight: 1.45 }}>
          Split expenses in a living cosmos.
        </motion.p>

        {/* Google auth: official component, sized to the card so it reads as designed */}
        <motion.div {...rise(0.4)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%' }}>
          <div style={{ minHeight: 44, display: 'flex', justifyContent: 'center', width: '100%' }}>
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => toast.error('Google login failed')}
              theme="filled_black" shape="pill" size="large" width="300" text="continue_with" useOneTap={false}
            />
          </div>
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-dim)', opacity: 0.75, textAlign: 'center', lineHeight: 1.4, maxWidth: '260px' }}>
            No password. We only use this to save your cosmos.
          </p>
        </motion.div>
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
  const [selectedStarPos, setSelectedStarPos] = useState<{ x: number, y: number } | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [homeView, setHomeView] = useState<HomeView>('active');
  const [sectorCounts, setSectorCounts] = useState<{ active: number; settled: number }>({ active: 0, settled: 0 });
  // If nothing is settled anymore, fall back to the active sector automatically.
  useEffect(() => {
    if (homeView === 'settled' && sectorCounts.settled === 0) setHomeView('active');
  }, [homeView, sectorCounts.settled]);
  const isConnected = useIsConnected();
  const trips = useTrip();
  const [cachedTrips] = useState<Trip[]>(() => {
    try { const raw = localStorage.getItem('simpli_trips_cache'); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  useEffect(() => {
    if (subReady) {
      try { localStorage.setItem('simpli_trips_cache', JSON.stringify(trips.map(t => ({ id: t.id, name: t.name })))); } catch {}
    }
  }, [subReady, trips]);
  const displayTrips = (subReady ? trips : (cachedTrips.length ? cachedTrips : trips)) as Trip[];

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

  // Keep the open trip's name in sync with the live trip table. When a user opens a
  // group via an invite link, the trip row may not have replicated yet, so the header
  // briefly falls back to a placeholder — this resolves it to the real name once it lands.
  useEffect(() => {
    if (!selectedTrip) return;
    const live = trips.find(t => t.id === selectedTrip.id);
    if (live && live.name && live.name !== selectedTrip.name && live.name !== live.id) {
      setSelectedTrip(prev => (prev && prev.id === live.id) ? { ...prev, name: live.name } : prev);
      try { sessionStorage.setItem('simpli_selected_trip', JSON.stringify({ id: live.id, name: live.name })); } catch {}
    }
  }, [trips, selectedTrip]);

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
          // Resolve trip name from the live cache; if it hasn't replicated yet, use a
          // neutral placeholder (never the raw id) — the sync effect fills in the real name.
          try {
            const row = [...c.db.trip.iter()].find((t: any) => t.id === tripId);
            selectTrip({ id: tripId, name: row?.name || 'Opening group…' });
          } catch { selectTrip({ id: tripId, name: 'Opening group…' }); }
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
            selectTrip({ id: pending, name: row?.name || 'Opening group…' });
          } catch { selectTrip({ id: pending, name: 'Opening group…' }); }
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
    if (c) { 
      try { c.reducers.createUser({ name: p.name }); } catch {} 
      try { c.reducers.linkDevice({ googleSub: p.sub }); } catch (e) { console.error('linkDevice failed:', e) }
    }
    if (!StDB.conn) sessionStorage.setItem('simpli_pending_login', 'true');
  };

  useEffect(() => {
    if (isConnected && profile) {
      const c = StDB.conn as any;
      if (c) {
        try { c.reducers.createUser({ name: profile.name }); } catch {}
        try { c.reducers.linkDevice({ googleSub: profile.sub }); } catch (e) { console.error('linkDevice failed:', e) }
      }
      
      const pending = sessionStorage.getItem('simpli_pending_login');
      if (pending) {
        sessionStorage.removeItem('simpli_pending_login');
      }
    }
  }, [isConnected, profile]);

  useEffect(() => {
    if (profile) {
      try { if (!localStorage.getItem('simpli_member_since')) localStorage.setItem('simpli_member_since', new Date().toISOString()); } catch {}
    }
  }, [profile]);

  const handleLogout = () => {
    void import('./push').then(m => m.disablePush()).catch(() => {});
    localStorage.removeItem('simpli_user');
    googleLogout();
    setProfile(null);
    selectTrip(null);
  };

  // No local uiPaused var, using overlayOpen directly
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', background: '#020508', overflow: 'hidden' }}>
      <Toaster />
      {profile && <NotificationsManager />}

      <ErrorBoundary fallback={<div style={{ position: 'fixed', inset: 0, background: '#020508' }} />}>
        <GalaxyBackground
          trips={displayTrips}
          activeTripId={selectedTrip?.id ?? null}
          onSelectTrip={selectTrip}
          uiPaused={overlayOpen}
          hoveredStar={hoveredStar}
          onStarHover={setHoveredStar}
          onStarClick={setSelectedMemberId}
          selectedMemberId={selectedMemberId}
          onSelectedStarPosUpdate={setSelectedStarPos}
          homeView={homeView}
          onSectorCounts={setSectorCounts}
          ready={subReady}
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
                  onBack={() => { selectTrip(null); setSelectedMemberId(null); setOverlayOpen(false); }}
                  onOverlayChange={setOverlayOpen}
                  onOpenProfile={() => setProfileOpen(true)}
                  onOpenLeaderboard={() => setLeaderboardOpen(true)}
                  selectedMemberId={selectedMemberId}
                  onStarClick={setSelectedMemberId}
                  selectedStarPos={selectedStarPos}
                />
              ) : (
                <Dashboard
                  key="dashboard"
                  profile={profile}
                  isConnected={isConnected}
                  onOpenProfile={() => setProfileOpen(true)}
                  onOpenLeaderboard={() => setLeaderboardOpen(true)}
                  onSelectTrip={selectTrip}
                  subReady={subReady}
                  trips={trips}
                  homeView={homeView}
                  onSetHomeView={setHomeView}
                  sectorCounts={sectorCounts}
                />
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>

      {profile && (
        <AnimatePresence>
          <ProfileModal
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
            profile={profile}
            onLogout={handleLogout}
            tripsCount={trips.length}
          />
          
          <LeaderboardSidebar
            open={leaderboardOpen}
            onClose={() => setLeaderboardOpen(false)}
            myName={profile.name}
          />
        </AnimatePresence>
      )}
    </div>
  );
}

export default App;
