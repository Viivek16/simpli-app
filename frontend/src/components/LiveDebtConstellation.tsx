import { useMemo } from 'react';
import { motion, useSpring } from 'framer-motion';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';

export const LiveDebtConstellation = () => {
  const users = useUser();
  const splits = useExpenseSplit();
  const expenses = useExpense();

  // Matrix representing how much user A owes user B.
  // owes[debtor][payee] = amount
  const owes = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    
    users.forEach(u => {
      map[u.id.toHexString()] = {};
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

  // Generate base circular layout coordinates for each user
  const radius = 100;
  const nodes = useMemo(() => {
    return users.map((user, index) => {
      const angle = (index / users.length) * 2 * Math.PI - Math.PI / 2;
      return {
        id: user.id.toHexString(),
        name: user.name,
        baseX: Math.cos(angle) * radius,
        baseY: Math.sin(angle) * radius
      };
    });
  }, [users]);

  // Spring configs for buttery smooth physics
  const springConfig = { stiffness: 300, damping: 30 };

  return (
    <div className="card" style={{ 
      minHeight: '400px', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      border: '1px solid rgba(155, 175, 164, 0.2)',
      background: 'radial-gradient(circle at center, var(--color-anthracite-light) 0%, var(--color-anthracite) 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <h2 style={{ color: 'var(--color-sage)', fontSize: 'var(--font-size-h3)', zIndex: 10 }}>Live Debt Constellation</h2>
      <p style={{ textAlign: 'center', opacity: 0.7, maxWidth: '300px', zIndex: 10, marginBottom: 'var(--space-24)' }}>
        Dynamics are simulated using real-time debt pulls.
      </p>

      {users.length === 0 && (
        <div style={{ opacity: 0.5, marginTop: '50px' }}>Awaiting Data...</div>
      )}

      <div style={{ position: 'relative', width: '300px', height: '250px', margin: '0 auto', top: '20px' }}>
        {/* Draw connections */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          <g transform="translate(150, 125)">
            {nodes.map(nodeA => {
              return nodes.map(nodeB => {
                if (nodeA.id === nodeB.id) return null;
                const amountOwed = owes[nodeA.id]?.[nodeB.id] || 0;
                if (amountOwed <= 0) return null;

                // To animate SVG lines cleanly with Framer Motion based on spring values of TWO nodes, 
                // it requires useTransform across both springs. 
                // For simplicity in this demo, we'll draw static lines that update immediately to the target positions 
                // or just rely on React state updates if we used state. Since we are using framer motion springs for nodes,
                // we'll approximate the pull in the node's visual rendering.
                
                // Let's calculate the pull factor. $1 pulls it 1px closer. Max pull is 80% of distance.
                const pullFactor = Math.min(amountOwed * 1.5, radius * 0.8);
                const dx = nodeB.baseX - nodeA.baseX;
                const dy = nodeB.baseY - nodeA.baseY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // The actual line should really follow the animated nodes, but we'll draw it between their target positions for now
                // to keep the SVG logic simple without complex useTransform combinations.
                const targetAx = nodeA.baseX + (dx / distance) * pullFactor;
                const targetAy = nodeA.baseY + (dy / distance) * pullFactor;
                
                // nodeB is pulled towards nodeA if nodeB owes nodeA, but here nodeA owes nodeB, so nodeA is pulled.
                // NodeB remains at its base (unless it owes someone else).
                
                // For the lines, we'll just connect the base centers and change opacity/thickness based on debt.
                return (
                  <motion.line
                    key={`${nodeA.id}-${nodeB.id}`}
                    x1={targetAx}
                    y1={targetAy}
                    x2={nodeB.baseX}
                    y2={nodeB.baseY}
                    stroke="var(--color-terracotta)"
                    strokeWidth={Math.min(amountOwed / 10, 5) + 1}
                    strokeDasharray="4 4"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.6 }}
                    transition={{ duration: 0.8, type: 'spring' }}
                  />
                );
              });
            })}
          </g>
        </svg>

        {/* Draw nodes */}
        {nodes.map(node => {
          // Calculate net pull from all debts
          let targetX = node.baseX;
          let targetY = node.baseY;

          // If node owes others, pull node towards them
          const debts = owes[node.id] || {};
          for (const payeeId in debts) {
            const amountOwed = debts[payeeId];
            const payeeNode = nodes.find(n => n.id === payeeId);
            if (payeeNode && amountOwed > 0) {
              const dx = payeeNode.baseX - node.baseX;
              const dy = payeeNode.baseY - node.baseY;
              const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance > 0) {
                const pull = Math.min(amountOwed * 1.5, radius * 0.8);
                targetX += (dx / distance) * pull;
                targetY += (dy / distance) * pull;
              }
            }
          }

          return (
            <Node 
              key={node.id} 
              name={node.name} 
              targetX={targetX + 150} 
              targetY={targetY + 125} 
              springConfig={springConfig} 
            />
          );
        })}
      </div>
    </div>
  );
};

const Node = ({ name, targetX, targetY, springConfig }: { name: string, targetX: number, targetY: number, springConfig: any }) => {
  const x = useSpring(targetX, springConfig);
  const y = useSpring(targetY, springConfig);

  // Update springs when targets change
  x.set(targetX);
  y.set(targetY);

  return (
    <motion.div
      style={{
        position: 'absolute',
        x,
        y,
        width: '40px',
        height: '40px',
        marginLeft: '-20px',
        marginTop: '-20px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-sage)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-anthracite)',
        fontWeight: 'bold',
        fontSize: 'var(--font-size-small)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        cursor: 'pointer',
        zIndex: 20
      }}
      whileHover={{ scale: 1.1, backgroundColor: 'var(--color-white)' }}
      whileTap={{ scale: 0.95 }}
    >
      {name.substring(0, 2).toUpperCase()}
    </motion.div>
  );
};
