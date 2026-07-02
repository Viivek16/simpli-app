import { useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Star {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  opacity: number;
}

interface Props {
  activeTripId: string | null;
}

// ─── Ambient Canvas (idle star drift) ────────────────────────────────────────
const AmbientCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = () => canvas.width = window.innerWidth;
    const H = () => canvas.height = window.innerHeight;
    W(); H();

    const onResize = () => { W(); H(); init(); };
    window.addEventListener('resize', onResize);

    const init = () => {
      const count = Math.min(Math.floor(window.innerWidth / 15), 80);
      starsRef.current = Array.from({ length: count }, (_, i) => ({
        id: String(i),
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: 1.0 + Math.random() * 2.0,
        opacity: 0.1 + Math.random() * 0.3,
      }));
    };
    init();

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const stars = starsRef.current;

      for (const s of stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(156,174,169,${s.opacity})`;
        ctx.fill();

        s.x += s.vx;
        s.y += s.vy;

        if (s.x < -s.r) s.x = canvas.width + s.r;
        else if (s.x > canvas.width + s.r) s.x = -s.r;
        if (s.y < -s.r) s.y = canvas.height + s.r;
        else if (s.y > canvas.height + s.r) s.y = -s.r;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
};

// ─── Active Trip Graph ────────────────────────────────────────────────────────
const TripGraph = ({ tripId }: { tripId: string }) => {
  const users = useUser();
  const splits = useExpenseSplit();
  const expenses = useExpense();

  // Calculate net debt for each user
  const netDebts = useMemo(() => {
    const debts: Record<string, number> = {};
    users.forEach(u => {
      const uid = typeof u.id === 'object' && 'toHexString' in u.id
        ? (u.id as any).toHexString() : String(u.id);
      debts[uid] = 0;
    });

    const tripExpenses = expenses.filter(e => e.tripId === tripId);
    
    tripExpenses.forEach(expense => {
      const expSplits = splits.filter(s => s.expenseId === expense.id);
      expSplits.forEach(split => {
        if (debts[expense.payerId] !== undefined) debts[expense.payerId] += split.amountOwed; // Payer is owed money (+)
        if (debts[split.debtorId] !== undefined) debts[split.debtorId] -= split.amountOwed; // Debtor owes money (-)
      });
    });
    
    return debts;
  }, [users, splits, expenses, tripId]);

  // Debt lines logic
  const owes = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    users.forEach(u => {
      const uid = typeof u.id === 'object' && 'toHexString' in u.id
        ? (u.id as any).toHexString() : String(u.id);
      map[uid] = {};
    });
    splits.forEach(split => {
      const expense = expenses.find(e => e.id === split.expenseId && e.tripId === tripId);
      if (!expense) return;
      const debtorId = split.debtorId;
      const payeeId = expense.payerId;
      if (debtorId !== payeeId) {
        if (!map[debtorId]) map[debtorId] = {};
        map[debtorId][payeeId] = (map[debtorId][payeeId] || 0) + split.amountOwed;
      }
    });
    return map;
  }, [users, splits, expenses, tripId]);

  const nodes = useMemo(() => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const rx = Math.min(window.innerWidth * 0.35, 320);
    const ry = Math.min(window.innerHeight * 0.3, 240);
    return users.map((user, i) => {
      const angle = (i / Math.max(users.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const uid = typeof user.id === 'object' && 'toHexString' in user.id
        ? (user.id as any).toHexString() : String(user.id);
      return {
        id: uid,
        name: user.name,
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
        netDebt: netDebts[uid] || 0,
      };
    });
  }, [users, netDebts]);

  const maxDebtLine = useMemo(() => {
    let max = 0;
    Object.values(owes).forEach(payees =>
      Object.values(payees).forEach(v => { if (v > max) max = v; })
    );
    return max || 1;
  }, [owes]);

  const maxNetDebtMagnitude = useMemo(() => {
    let max = 0;
    Object.values(netDebts).forEach(v => {
      if (Math.abs(v) > max) max = Math.abs(v);
    });
    return max || 1;
  }, [netDebts]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        {/* Debt lines */}
        {nodes.map(nodeA =>
          nodes.map(nodeB => {
            if (nodeA.id === nodeB.id) return null;
            const amount = owes[nodeA.id]?.[nodeB.id] || 0;
            if (amount <= 0) return null;
            const intensity = amount / maxDebtLine;
            return (
              <motion.line
                key={`${nodeA.id}-${nodeB.id}`}
                x1={nodeA.x} y1={nodeA.y}
                x2={nodeB.x} y2={nodeB.y}
                stroke={`rgba(156,174,169,${0.1 + intensity * 0.4})`}
                strokeWidth={0.8 + intensity * 3}
                strokeDasharray="4 6"
                initial={{ opacity: 0, pathLength: 0 }}
                animate={{ opacity: 1, pathLength: 1 }}
                transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
              />
            );
          })
        )}
      </svg>
      
      {/* HTML Nodes for better box-shadow support */}
      {nodes.map((node, i) => {
        // Heatmap logic
        // If netDebt < -0.5 (owes money) -> warm terracotta
        // If netDebt > 0.5 (is owed money) -> frosted sage
        // Near 0 -> neutral/dim
        const isDebt = node.netDebt < -0.5;
        const isCredit = node.netDebt > 0.5;
        
        const intensity = Math.min(Math.abs(node.netDebt) / maxNetDebtMagnitude, 1);
        
        // Base sizes
        const size = 32 + (intensity * 12); // Slightly larger for higher balances
        
        // Colors
        const baseColor = isDebt ? 'rgba(217, 138, 108, 1)' : (isCredit ? 'rgba(156, 174, 169, 1)' : 'rgba(255,255,255,0.7)');
        const glowColor = isDebt ? `rgba(217, 138, 108, ${0.4 + intensity * 0.4})` : `rgba(156, 174, 169, ${0.2 + intensity * 0.3})`;
        
        const glowSpread = 10 + (intensity * 25);

        return (
          <motion.div
            key={node.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            style={{
              position: 'absolute',
              left: node.x - size / 2,
              top: node.y - size / 2,
              width: size,
              height: size,
              borderRadius: '50%',
              background: '#0a0a0a',
              border: `2px solid ${baseColor}`,
              boxShadow: `0 0 ${glowSpread}px ${glowColor}, inset 0 0 ${glowSpread/2}px ${glowColor}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: baseColor,
              fontWeight: 700,
              fontSize: '0.8rem',
              fontFamily: 'Inter, sans-serif'
            }}
          >
            {node.name.substring(0, 2).toUpperCase()}
            
            <div style={{
              position: 'absolute',
              top: '100%',
              marginTop: '12px',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '0.75rem',
              fontWeight: 500,
              textShadow: '0 2px 4px rgba(0,0,0,0.8)'
            }}>
              {node.name}
              {Math.abs(node.netDebt) > 0.01 && (
                <div style={{ color: isDebt ? '#d98a6c' : '#9bafa4', fontSize: '0.65rem', marginTop: '2px', fontWeight: 600 }}>
                  {isDebt ? '-' : '+'}${Math.abs(node.netDebt).toFixed(2)}
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

// ─── Public Component ─────────────────────────────────────────────────────────
export const LiveDebtConstellation = ({ activeTripId }: Props) => {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden', background: '#050505' }}>
      <motion.div
        animate={activeTripId ? { opacity: 0, scale: 5 } : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
        style={{ position: 'absolute', inset: 0, transformOrigin: 'center center' }}
      >
        <AmbientCanvas />
      </motion.div>
      
      {/* Trip graph — fades in when a trip is selected */}
      <motion.div
        animate={{ opacity: activeTripId ? 1 : 0 }}
        transition={{ duration: 0.8 }}
        style={{ position: 'absolute', inset: 0 }}
      >
        {activeTripId && <TripGraph tripId={activeTripId} />}
      </motion.div>
    </div>
  );
};
