import { motion, useSpring, useTransform } from 'framer-motion';
import { useExpense, useExpenseSplit } from '../module_bindings/hooks';
import { localIdentity } from '../spacetimedb';

interface Props {
  tripId: string;
}

export const KarmaBar = ({ tripId }: Props) => {
  const splits = useExpenseSplit();
  const expenses = useExpense();

  // Scope to the active trip and compute the local user's net balance.
  let netBalance = 0;
  if (localIdentity) {
    const tripExpenses = expenses.filter(e => e.tripId === tripId);
    tripExpenses.forEach(expense => {
      const expSplits = splits.filter(s => s.expenseId === expense.id);
      expSplits.forEach(split => {
        if (expense.payerId === localIdentity && split.debtorId !== localIdentity) {
          netBalance += split.amountOwed; // others owe me
        } else if (split.debtorId === localIdentity && expense.payerId !== localIdentity) {
          netBalance -= split.amountOwed; // I owe others
        }
      });
    });
  }

  const maxThreshold = 100;
  const cappedBalance = Math.max(-maxThreshold, Math.min(maxThreshold, netBalance));
  const targetPercentage = 50 + (cappedBalance / maxThreshold) * 50;

  const springConfig = { stiffness: 280, damping: 28 };
  const animatedPercentage = useSpring(50, springConfig);
  animatedPercentage.set(targetPercentage);

  const barColor = useTransform(
    animatedPercentage,
    [0, 50, 100],
    ['#c0715a', '#3a3a3c', '#6fba8a']
  );

  const isPositive = netBalance > 0.005;
  const isNegative = netBalance < -0.005;
  const label = isPositive
    ? `You're owed $${netBalance.toFixed(2)}`
    : isNegative
    ? `You owe $${Math.abs(netBalance).toFixed(2)}`
    : 'All settled up';

  return (
    <div style={{ width: '100%' }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'rgba(111,186,138,0.6)',
        }}>
          Karma Balance
        </span>
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          style={{
            fontSize: '0.82rem', fontWeight: 700,
            color: isPositive ? '#6fba8a' : isNegative ? '#c0715a' : 'rgba(255,255,255,0.35)',
          }}
        >
          {label}
        </motion.span>
      </div>

      {/* Track */}
      <div style={{
        height: '3px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '99px',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Centre marker */}
        <div style={{
          position: 'absolute', left: '50%', top: 0, bottom: 0,
          width: '1px', background: 'rgba(255,255,255,0.12)',
        }} />
        <motion.div style={{
          position: 'absolute',
          height: '100%',
          borderRadius: '99px',
          width: useTransform(animatedPercentage, p => `${p}%`),
          backgroundColor: barColor,
        }} />
      </div>
    </div>
  );
};
