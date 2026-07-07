import { useEffect, useMemo } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { useExpense, useExpenseSplit } from '../module_bindings/hooks';
import * as StDB from '../spacetimedb';

const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const norm = (s: any) => String(s ?? '').toLowerCase().trim();

interface Props { tripId: string; }

export const KarmaBar = ({ tripId }: Props) => {
  const splits = useExpenseSplit();
  const expenses = useExpense();
  const me = norm(StDB.getLocalId() ?? '');

  const netBalance = useMemo(() => {
    if (!me) return 0;
    let bal = 0;
    const tripExpenses = expenses.filter(e => e.tripId === tripId);
    tripExpenses.forEach(expense => {
      const expSplits = splits.filter(s => s.expenseId === expense.id);
      expSplits.forEach(split => {
        const payer = norm(expense.payerId);
        const debtor = norm(split.debtorId);
        if (payer === me && debtor !== me) bal += split.amountOwed; // others owe me
        else if (debtor === me && payer !== me) bal -= split.amountOwed; // I owe others
      });
    });
    return bal;
  }, [me, tripId, expenses, splits]);

  // Dynamic max: largest |balance| in trip, floor ₹100
  const maxThreshold = useMemo(() => {
    if (!me) return 100;
    const allBalances: number[] = [];
    const memberMap = new Map<string, number>();
    expenses.filter(e => e.tripId === tripId).forEach(expense => {
      splits.filter(s => s.expenseId === expense.id).forEach(split => {
        const p = norm(expense.payerId);
        const d = norm(split.debtorId);
        memberMap.set(p, (memberMap.get(p) || 0) + split.amountOwed);
        memberMap.set(d, (memberMap.get(d) || 0) - split.amountOwed);
      });
    });
    memberMap.forEach(v => allBalances.push(Math.abs(v)));
    return Math.max(100, ...allBalances);
  }, [me, tripId, expenses, splits]);

  // Fill from center: 50 = neutral, >50 = owed (green right), <50 = owe (terracotta left)
  const pct = 50 + (Math.max(-maxThreshold, Math.min(maxThreshold, netBalance)) / maxThreshold) * 50;
  const springConfig = { stiffness: 300, damping: 30 };
  const animatedPct = useSpring(50, springConfig);

  // RULE: animatedPercentage.set() lives in useEffect, NOT in render (Phase 5.4)
  useEffect(() => { animatedPct.set(pct); }, [pct, animatedPct]);

  const barColor = useTransform(animatedPct, [0, 50, 100], ['#d98a6c', '#2a2e2c', '#6fba8a']);
  const barLeft = useTransform(animatedPct, p => p >= 50 ? '50%' : `${p}%`);
  const barWidth = useTransform(animatedPct, p => `${Math.abs(p - 50)}%`);

  const isPos = netBalance > 0.5;
  const isNeg = netBalance < -0.5;
  const amtStr = INR(Math.abs(netBalance));
  const label = isPos ? `+${amtStr}` : isNeg ? `-${amtStr}` : '₹0';

  return (
    <div style={{ width: '100%', padding: '0 4px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '14px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '8px' }}>
          Karma Balance
        </span>
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="money"
          style={{
            fontSize: '1.45rem', fontWeight: 700,
            color: isPos ? 'var(--owed)' : isNeg ? 'var(--owe)' : 'var(--text-dim)',
            lineHeight: 1, letterSpacing: '-0.02em'
          }}
        >{label}</motion.span>
      </div>
      <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.1)' }} />
        <motion.div style={{
          position: 'absolute', height: '100%', borderRadius: '99px',
          left: barLeft, width: barWidth, backgroundColor: barColor,
        }} />
      </div>
    </div>
  );
};
