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
  /** When null → ambient idle star field. When set → shows real trip debt graph. */
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
      const count = Math.min(Math.floor(window.innerWidth / 18), 60);
      starsRef.current = Array.from({ length: count }, (_, i) => ({
        id: String(i),
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: 1.5 + Math.random() * 2.5,
        opacity: 0.08 + Math.random() * 0.18,
      }));
    };
    init();

    const LINK_DIST = 160;

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const stars = starsRef.current;

      // Draw links
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const dx = stars[i].x - stars[j].x;
          const dy = stars[i].y - stars[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK_DIST) {
            const alpha = (1 - d / LINK_DIST) * 0.06;
            ctx.beginPath();
            ctx.moveTo(stars[i].x, stars[i].y);
            ctx.lineTo(stars[j].x, stars[j].y);
            ctx.strokeStyle = `rgba(111,186,138,${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw & update stars
      for (const s of stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(111,186,138,${s.opacity})`;
        ctx.fill();

        s.x += s.vx;
        s.y += s.vy;

        // Wrap edges
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
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
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

  // Debt map: owes[debtorId][payerId] = amount
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

  // Node layout — evenly distributed on a big ellipse across the screen
  const nodes = useMemo(() => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const rx = Math.min(window.innerWidth * 0.3, 260);
    const ry = Math.min(window.innerHeight * 0.28, 200);
    return users.map((user, i) => {
      const angle = (i / Math.max(users.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const uid = typeof user.id === 'object' && 'toHexString' in user.id
        ? (user.id as any).toHexString() : String(user.id);
      return {
        id: uid,
        name: user.name,
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      };
    });
  }, [users]);

  const maxDebt = useMemo(() => {
    let max = 0;
    Object.values(owes).forEach(payees =>
      Object.values(payees).forEach(v => { if (v > max) max = v; })
    );
    return max || 1;
  }, [owes]);

  return (
    <svg
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      {/* Debt lines */}
      {nodes.map(nodeA =>
        nodes.map(nodeB => {
          if (nodeA.id === nodeB.id) return null;
          const amount = owes[nodeA.id]?.[nodeB.id] || 0;
          if (amount <= 0) return null;
          const intensity = amount / maxDebt;
          return (
            <motion.line
              key={`${nodeA.id}-${nodeB.id}`}
              x1={nodeA.x} y1={nodeA.y}
              x2={nodeB.x} y2={nodeB.y}
              stroke={`rgba(192,113,90,${0.2 + intensity * 0.55})`}
              strokeWidth={0.8 + intensity * 3.5}
              strokeDasharray="5 6"
              initial={{ opacity: 0, pathLength: 0 }}
              animate={{ opacity: 1, pathLength: 1 }}
              transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
            />
          );
        })
      )}

      {/* Nodes */}
      {nodes.map((node, i) => (
        <motion.g
          key={node.id}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.07, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: `${node.x}px ${node.y}px` }}
        >
          {/* Glow ring */}
          <circle
            cx={node.x} cy={node.y} r={28}
            fill="rgba(111,186,138,0.05)"
            stroke="rgba(111,186,138,0.15)"
            strokeWidth={1}
          />
          {/* Core dot */}
          <circle
            cx={node.x} cy={node.y} r={16}
            fill="rgba(10,10,10,0.85)"
            stroke="rgba(111,186,138,0.5)"
            strokeWidth={1.5}
          />
          {/* Initials */}
          <text
            x={node.x} y={node.y}
            textAnchor="middle" dominantBaseline="central"
            fill="#6fba8a"
            fontSize="10"
            fontWeight="700"
            fontFamily="Inter, -apple-system, sans-serif"
            letterSpacing="0.04em"
          >
            {node.name.substring(0, 2).toUpperCase()}
          </text>
          {/* Name label below */}
          <text
            x={node.x} y={node.y + 32}
            textAnchor="middle"
            fill="rgba(255,255,255,0.45)"
            fontSize="9"
            fontWeight="500"
            fontFamily="Inter, -apple-system, sans-serif"
          >
            {node.name}
          </text>
        </motion.g>
      ))}
    </svg>
  );
};

// ─── Public Component ─────────────────────────────────────────────────────────
export const LiveDebtConstellation = ({ activeTripId }: Props) => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Ambient idle field — always visible, fades when trip is active */}
      <motion.div
        animate={{ opacity: activeTripId ? 0.35 : 1 }}
        transition={{ duration: 0.8 }}
        style={{ position: 'absolute', inset: 0 }}
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
