import { motion, useSpring, useTransform } from 'framer-motion';
import { useExpense, useExpenseSplit } from '../module_bindings/hooks';
import { localIdentity } from '../spacetimedb';

export const KarmaBar = () => {
  const splits = useExpenseSplit();
  const expenses = useExpense();

  // Find local user
  // (In our simulated environment where we create "Alice" and "Bob", the local user might be Alice if she's the sender. 
  // For the sake of the exercise, if there are users, we'll pick the local identity. If no local user exists yet in the table, we'll just show 0 or default.)
  let netBalance = 0;

  if (localIdentity) {
    splits.forEach(split => {
      // Find the parent expense
      const expense = expenses.find(e => e.id === split.expenseId);
      if (expense) {
        if (expense.payerId === localIdentity && split.debtorId !== localIdentity) {
          // Local user paid for someone else
          netBalance += split.amountOwed;
        } else if (split.debtorId === localIdentity && expense.payerId !== localIdentity) {
          // Local user owes someone else
          netBalance -= split.amountOwed;
        }
      }
    });
  }

  // Define max threshold for the visual bar (e.g. $100)
  const maxThreshold = 100;
  
  // Cap between -maxThreshold and +maxThreshold
  const cappedBalance = Math.max(-maxThreshold, Math.min(maxThreshold, netBalance));
  
  // Convert to 0% to 100% scale where 50% is 0 balance
  const targetPercentage = 50 + (cappedBalance / maxThreshold) * 50;

  // Spring animation for the percentage
  const springConfig = { stiffness: 300, damping: 30 };
  const animatedPercentage = useSpring(50, springConfig);

  // Animate to new target
  animatedPercentage.set(targetPercentage);

  // Transform color based on the value
  const backgroundColor = useTransform(
    animatedPercentage,
    [0, 50, 100],
    ['var(--color-terracotta)', 'var(--color-anthracite)', 'var(--color-sage)']
  );

  return (
    <div style={{ marginBottom: 'var(--space-24)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-8)' }}>
        <h3 style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--color-sage)' }}>KARMA BALANCE</h3>
        <motion.span style={{ fontSize: 'var(--font-size-small)', color: 'var(--color-white)', fontWeight: 'bold' }}>
          ${netBalance.toFixed(2)}
        </motion.span>
      </div>
      <div 
        style={{ 
          height: '16px', 
          backgroundColor: 'var(--color-anthracite)', 
          borderRadius: '8px', 
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.8)'
        }}
      >
        <motion.div 
          style={{ 
            height: '100%', 
            width: useTransform(animatedPercentage, p => `${p}%`), 
            backgroundColor,
            borderRadius: '8px'
          }} 
        />
      </div>
    </div>
  );
};
