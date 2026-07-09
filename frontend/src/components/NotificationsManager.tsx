import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as StDB from '../spacetimedb';
import { showAppNotification, requestNotificationPermission, notificationsSupported, selfDeletedTrips } from '../notifications';
import { enablePush } from '../push';

const norm = (s: any) => String(s ?? '').toLowerCase().trim();
const first = (name: string) => (name || 'Someone').split(' ')[0];
const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const BANNER_KEY = 'simpli_notif_decided';

const eTrip = (r: any) => r.tripId ?? r.trip_id;
const ePayer = (r: any) => norm(r.payerId ?? r.payer_id);
const mUser = (r: any) => norm(r.userId ?? r.user_id);
const mTrip = (r: any) => r.tripId ?? r.trip_id;
const sExp = (r: any) => r.expenseId ?? r.expense_id;
const sDebtor = (r: any) => norm(r.debtorId ?? r.debtor_id);

export const NotificationsManager = () => {
  const readyRef = useRef(false);
  const seenExpense = useRef<Set<string>>(new Set());
  const seenMember = useRef<Set<string>>(new Set());
  const tripNames = useRef<Map<string, string>>(new Map());
  const myTripIds = useRef<Set<string>>(new Set());
  const attachedRef = useRef(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    let disposed = false;

    const nameOf = (c: any, id: string): string => {
      const target = norm(id);
      const identityToName = new Map<string, string>();
      for (const u of c.db.user.iter()) {
        const uid = (u.id && typeof u.id === 'object' && 'toHexString' in u.id) ? norm(u.id.toHexString()) : norm(u.id);
        if (uid && !identityToName.has(uid)) identityToName.set(uid, u.name || 'Someone');
      }
      // Legacy identity-keyed rows resolve directly.
      if (identityToName.has(target)) return identityToName.get(target) as string;
      // Otherwise the id is a Google sub: hop sub -> device identity -> name.
      try {
        for (const d of c.db.user_device.iter()) {
          const sub = norm(d.googleSub ?? d.google_sub);
          if (sub === target) {
            const nm = identityToName.get(norm(d.deviceIdentity ?? d.device_identity));
            if (nm) return nm;
          }
        }
      } catch {}
      return 'Someone';
    };
    const tripNameOf = (c: any, id: string): string => {
      for (const t of c.db.trip.iter()) if (t.id === id) return t.name || 'your trip';
      return 'your trip';
    };
    const iAmMember = (c: any, tripId: string): boolean => {
      const me = norm(StDB.getLocalId());
      for (const m of c.db.trip_member.iter()) if (mTrip(m) === tripId && mUser(m) === me) return true;
      return false;
    };

    const seed = (c: any) => {
      seenExpense.current = new Set([...c.db.expense.iter()].map((e: any) => e.id));
      seenMember.current = new Set([...c.db.trip_member.iter()].map((m: any) => `${mTrip(m)}::${mUser(m)}`));
      tripNames.current = new Map([...c.db.trip.iter()].map((t: any) => [t.id, t.name || 'a group']));
      const meSeed = norm(StDB.getLocalId());
      myTripIds.current = new Set([...c.db.trip_member.iter()].filter((m: any) => mUser(m) === meSeed).map((m: any) => mTrip(m)));
    };

    const onMemberInsert = (_ctx: any, row: any) => {
      if (!readyRef.current) return;
      const c = StDB.conn as any; if (!c) return;
      const tripId = mTrip(row);
      const uid = mUser(row);
      const key = `${tripId}::${uid}`;
      if (seenMember.current.has(key)) return;
      seenMember.current.add(key);
      const me = norm(StDB.getLocalId());
      if (uid === me) {
        myTripIds.current.add(tripId);
        // Someone added me to an existing group (2+ members). Creating my own group (only me) stays silent.
        const memberCount = [...c.db.trip_member.iter()].filter((m: any) => mTrip(m) === tripId).length;
        if (memberCount >= 2) showAppNotification(`You've been added to ${tripNameOf(c, tripId)}`);
        return;
      }
      if (!iAmMember(c, tripId)) return;
      showAppNotification(`${first(nameOf(c, uid))} joined ${tripNameOf(c, tripId)}`);
    };

    const onExpenseInsert = (_ctx: any, row: any) => {
      if (!readyRef.current) return;
      const c = StDB.conn as any; if (!c) return;
      if (seenExpense.current.has(row.id)) return;
      seenExpense.current.add(row.id);
      const me = norm(StDB.getLocalId());
      const payer = ePayer(row);
      const tripId = eTrip(row);
      if (payer === me) return;
      if (!iAmMember(c, tripId)) return;
      const tName = tripNameOf(c, tripId);
      if ((row.description || '') === 'Debt settlement') {
        let other = '';
        for (const s of c.db.expense_split.iter()) { if (sExp(s) === row.id) { other = sDebtor(s); break; } }
        if (other === me) showAppNotification(`${first(nameOf(c, payer))} settled ${INR(row.amount)} with you in ${tName}. All settled up.`);
        else if (other) showAppNotification(`${first(nameOf(c, payer))} settled ${INR(row.amount)} with ${first(nameOf(c, other))} in ${tName}`);
        else showAppNotification(`${first(nameOf(c, payer))} settled up in ${tName}`);
      } else {
        showAppNotification(`${first(nameOf(c, payer))} added ${row.description || 'an expense'} \u00b7 ${INR(row.amount)}`);
      }
    };

    const onExpenseDelete = (_ctx: any, row: any) => {
      if (!readyRef.current) return;
      const me = norm(StDB.getLocalId());
      const payer = ePayer(row);
      const tripId = eTrip(row);
      seenExpense.current.delete(row.id);
      if (payer === me) return;
      if ((row.description || '') === 'Debt settlement') return;
      // Suppress trip-deletion cascade: only notify if the trip still exists a moment later.
      setTimeout(() => {
        const cc = StDB.conn as any; if (!cc) return;
        const stillExists = [...cc.db.trip.iter()].some((t: any) => t.id === tripId);
        if (!stillExists) return;
        if (!iAmMember(cc, tripId)) return;
        showAppNotification(`${first(nameOf(cc, payer))} removed ${row.description || 'an expense'}`);
      }, 180);
    };

    const onTripInsert = (_ctx: any, row: any) => {
      tripNames.current.set(row.id, row.name || 'a group');
    };
    const onTripDelete = (_ctx: any, row: any) => {
      const name = tripNames.current.get(row.id) || row.name || 'A group';
      const wasMember = myTripIds.current.has(row.id);
      tripNames.current.delete(row.id);
      myTripIds.current.delete(row.id);
      if (!readyRef.current) return;
      if (selfDeletedTrips.has(row.id)) { selfDeletedTrips.delete(row.id); return; }
      if (!wasMember) return;
      showAppNotification(`${name} was removed`);
    };

    const attach = (c: any) => {
      if (!c || attachedRef.current) return;
      attachedRef.current = true;
      c.db.trip_member.onInsert(onMemberInsert);
      c.db.expense.onInsert(onExpenseInsert);
      c.db.expense.onDelete(onExpenseDelete);
      c.db.trip.onInsert(onTripInsert);
      c.db.trip.onDelete(onTripDelete);
    };

    const markReady = () => {
      const c = StDB.conn as any; if (!c) return;
      seed(c);
      setTimeout(() => { if (!disposed) readyRef.current = true; }, 600);
    };

    if (StDB.conn) { attach(StDB.conn as any); if (StDB.subscriptionApplied) markReady(); }
    const u1 = StDB.onSpacetimeConnect(() => attach(StDB.conn as any));
    const u2 = StDB.onSubscriptionApplied(() => { attach(StDB.conn as any); markReady(); });

    // Already-granted returning users: (re)register the push subscription on load.
    if (notificationsSupported() && Notification.permission === 'granted') { void enablePush(); }

    let bannerTimer: any;
    if (notificationsSupported() && Notification.permission === 'default' && !localStorage.getItem(BANNER_KEY)) {
      bannerTimer = setTimeout(() => { if (!disposed) setShowBanner(true); }, 6000);
    }

    return () => {
      disposed = true;
      u1(); u2();
      if (bannerTimer) clearTimeout(bannerTimer);
      const c = StDB.conn as any;
      if (c && attachedRef.current) {
        try {
          c.db.trip_member.removeOnInsert(onMemberInsert);
          c.db.expense.removeOnInsert(onExpenseInsert);
          c.db.expense.removeOnDelete(onExpenseDelete);
          c.db.trip.removeOnInsert(onTripInsert);
          c.db.trip.removeOnDelete(onTripDelete);
        } catch {}
        attachedRef.current = false;
      }
    };
  }, []);

  // Ask for permission with the NATIVE dialog on the user's first tap after login.
  // A tap is the user gesture browsers require for a full-strength prompt.
  // If granted here, the custom banner never needs to appear.
  useEffect(() => {
    if (!notificationsSupported()) return;
    if (Notification.permission !== 'default') return;
    const once = () => {
      window.removeEventListener('pointerdown', once);
      requestNotificationPermission().then((granted) => {
        if (granted) {
          localStorage.setItem(BANNER_KEY, '1');
          setShowBanner(false);
          void enablePush();
        }
      });
    };
    window.addEventListener('pointerdown', once, { once: true });
    return () => window.removeEventListener('pointerdown', once);
  }, []);

  const enable = async () => { localStorage.setItem(BANNER_KEY, '1'); setShowBanner(false); const granted = await requestNotificationPermission(); if (granted) void enablePush(); };
  const dismiss = () => { localStorage.setItem(BANNER_KEY, '1'); setShowBanner(false); };

  return (
    <AnimatePresence>
      {showBanner && (
        <div style={{ position: 'fixed', top: 76, left: 16, right: 16, zIndex: 9000, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
        <motion.div
          initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          style={{
            width: '100%', maxWidth: 420, pointerEvents: 'all',
            background: 'rgba(5,6,10,0.92)', border: '1px solid var(--glass-brd)', borderRadius: 14,
            boxShadow: '0 16px 44px rgba(0,0,0,0.5)', padding: '14px 16px',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>Turn on notifications</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>Know when friends join, add expenses, or settle up.</div>
          </div>
          <button onClick={dismiss} style={{
            height: 34, padding: '0 12px', borderRadius: 10, background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--glass-brd)', color: 'var(--text-dim)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
          }}>Not now</button>
          <button onClick={enable} style={{
            height: 34, padding: '0 14px', borderRadius: 10, background: 'linear-gradient(180deg, #FFC46B, #E8963A)',
            border: 'none', color: '#ffffff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
          }}>Enable</button>
        </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
