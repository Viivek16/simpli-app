import { useMemo } from 'react';
import { motion, useSpring } from 'framer-motion';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';

export const LiveDebtConstellation = () => {
  const users = useUser();
  const splits = useExpenseSplit();
  const expenses = useExpense();

  // Build a debt map: owes[debtorId][payerId] = amount
  const owes = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};

    users.forEach(u => {
      const uid = typeof u.id === 'object' && 'toHexString' in u.id
        ? (u.id as any).toHexString()
        : String(u.id);
      map[uid] = {};
    });

    splits.forEach(split => {
      const expense = expenses.find(e => e.id === split.expenseId);
      if (!expense) return;

      const debtorId = split.debtorId;
      const payeeId = expense.payerId;

      if (debtorId !== payeeId) {
        if (!map[debtorId]) map[debtorId] = {};
        map[debtorId][payeeId] = (map[debtorId][payeeId] || 0) + split.amountOwed;
      }
    });

    return map;
  }, [users, splits, expenses]);

  const radius = 110;
  const nodes = useMemo(() => {
    return users.map((user, index) => {
      const angle = (index / Math.max(users.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const uid = typeof user.id === 'object' && 'toHexString' in user.id
        ? (user.id as any).toHexString()
        : String(user.id);
      return {
        id: uid,
        name: user.name,
        baseX: Math.cos(angle) * radius,
        baseY: Math.sin(angle) * radius,
      };
    });
  }, [users]);

  const springConfig = { stiffness: 260, damping: 28 };

  const isEmpty = users.length === 0;

  return (
    <div
      className="card"
      style={{
        minHeight: '420px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        border: '1px solid rgba(155, 175, 164, 0.15)',
        background: 'radial-gradient(ellipse at center, rgba(40,48,44,0.6) 0%, var(--color-anthracite) 100%)',
        position: 'relative',
        overflow: 'hidden',
        padding: 'var(--space-24)',
        gap: 'var(--space-16)',
      }}
    >
      <h2 style={{ color: 'var(--color-sage)', fontSize: 'var(--font-size-h3)', zIndex: 10, margin: 0 }}>
        Live Debt Constellation
      </h2>
      <p style={{ textAlign: 'center', opacity: 0.6, maxWidth: '300px', zIndex: 10, margin: 0, fontSize: '0.85rem' }}>
        Dynamics are simulated using real-time debt pulls.
      </p>

      {isEmpty && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-8)',
            marginTop: 'var(--space-32)',
            opacity: 0.45,
          }}
        >
          {/* Placeholder dots */}
          <div style={{ display: 'flex', gap: '16px' }}>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'rgba(111, 186, 138, 0.2)',
                  border: '1px dashed rgba(111, 186, 138, 0.4)',
                }}
              />
            ))}
          </div>
          <span style={{ color: '#666', fontSize: '0.85rem' }}>Awaiting Data…</span>
          <span style={{ color: '#555', fontSize: '0.75rem' }}>Press "Create Test Users" to begin</span>
        </div>
      )}

      {/* Constellation canvas */}
      {!isEmpty && (
        <div style={{ position: 'relative', width: '320px', height: '280px', margin: '0 auto' }}>
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
            }}
          >
            <g transform="translate(160, 140)">
              {nodes.map(nodeA =>
                nodes.map(nodeB => {
                  if (nodeA.id === nodeB.id) return null;
                  const amountOwed = owes[nodeA.id]?.[nodeB.id] || 0;
                  if (amountOwed <= 0) return null;

                  const pullFactor = Math.min(amountOwed * 1.5, radius * 0.8);
                  const dx = nodeB.baseX - nodeA.baseX;
                  const dy = nodeB.baseY - nodeA.baseY;
                  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                  const targetAx = nodeA.baseX + (dx / distance) * pullFactor;
                  const targetAy = nodeA.baseY + (dy / distance) * pullFactor;

                  return (
                    <motion.line
                      key={`${nodeA.id}-${nodeB.id}`}
                      x1={targetAx}
                      y1={targetAy}
                      x2={nodeB.baseX}
                      y2={nodeB.baseY}
                      stroke="#c0715a"
                      strokeWidth={Math.min(amountOwed / 10, 5) + 1}
                      strokeDasharray="5 4"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.65 }}
                      transition={{ duration: 0.6 }}
                    />
                  );
                })
              )}
            </g>
          </svg>

          {nodes.map(node => {
            let targetX = node.baseX;
            let targetY = node.baseY;
            const debts = owes[node.id] || {};
            for (const payeeId in debts) {
              const amountOwed = debts[payeeId];
              const payeeNode = nodes.find(n => n.id === payeeId);
              if (payeeNode && amountOwed > 0) {
                const dx = payeeNode.baseX - node.baseX;
                const dy = payeeNode.baseY - node.baseY;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const pull = Math.min(amountOwed * 1.5, radius * 0.8);
                targetX += (dx / distance) * pull;
                targetY += (dy / distance) * pull;
              }
            }
            return (
              <ConstellationNode
                key={node.id}
                name={node.name}
                targetX={targetX + 160}
                targetY={targetY + 140}
                springConfig={springConfig}
              />
            );
          })}
        </div>
      )}

      {/* Expense list */}
      {expenses.length > 0 && (
        <div
          style={{
            width: '100%',
            maxWidth: '480px',
            marginTop: 'var(--space-16)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-8)',
          }}
        >
          <h3
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--color-sage)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              margin: 0,
            }}
          >
            Expenses
          </h3>
          {expenses.map(expense => {
            const expSplits = splits.filter(s => s.expenseId === expense.id);
            return (
              <motion.div
                key={expense.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{expense.description}</span>
                  <span style={{ color: '#666', fontSize: '0.75rem' }}>
                    Trip: {expense.tripId} · Splits: {expSplits.length}
                  </span>
                </div>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '1rem',
                    color: '#6fba8a',
                    flexShrink: 0,
                  }}
                >
                  ${expense.amount.toFixed(2)}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ConstellationNode = ({
  name,
  targetX,
  targetY,
  springConfig,
}: {
  name: string;
  targetX: number;
  targetY: number;
  springConfig: any;
}) => {
  const x = useSpring(targetX, springConfig);
  const y = useSpring(targetY, springConfig);

  x.set(targetX);
  y.set(targetY);

  return (
    <motion.div
      style={{
        position: 'absolute',
        x,
        y,
        width: '44px',
        height: '44px',
        marginLeft: '-22px',
        marginTop: '-22px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-sage)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-anthracite)',
        fontWeight: 700,
        fontSize: '0.75rem',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        cursor: 'pointer',
        zIndex: 20,
        letterSpacing: '0.02em',
      }}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.94 }}
      title={name}
    >
      {name.substring(0, 2).toUpperCase()}
    </motion.div>
  );
};
