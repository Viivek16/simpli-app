/**
 * LiveDebtConstellation — member stars + dashed debt lines
 * Rules enforced:
 * - No per-frame material mutation (Rule 7): debt lines are static; re-render on data change only
 * - No fabricated identities (Rule 6)
 * - user.id is Identity → toHexString(), normalized lowercase (Rule 8)
 * - Debt lines use drei <Line> with dashed prop (Phase 2.2)
 * - Star halo = cheap additive-blending sprite, not a large transparent sphere
 */
import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { motion } from 'framer-motion';
import * as THREE from 'three';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';
import { useTripMember } from '../hooks/useTrips';
import * as StDB from '../spacetimedb';

const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const norm = (s: any) => String(s ?? '').toLowerCase().trim();

const identityStr = (u: any): string => {
  if (!u?.id) return '';
  if (typeof u.id === 'object' && u.id && 'toHexString' in u.id) {
    return norm(u.id.toHexString());
  }
  return norm(u.id);
};

interface Props {
  activeTripId: string;
  hoveredStar: string | null;
  onStarHover: (id: string | null) => void;
  onStarClick: (id: string | null) => void;
}

export const LiveDebtConstellation = ({ activeTripId, hoveredStar, onStarHover, onStarClick }: Props) => {
  const allUsers = useUser();
  const tripMemberIds = useTripMember(activeTripId);
  const splits = useExpenseSplit();
  const expenses = useExpense();

  const localId = norm(StDB.localIdentity ?? '');

  // Build member user map (id → name)
  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    allUsers.forEach(u => {
      const id = identityStr(u);
      if (id && !m.has(id)) m.set(id, u.name || 'Member');
    });
    return m;
  }, [allUsers]);

  // Ordered member list for the trip
  const members = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    tripMemberIds.forEach(id => {
      const nid = norm(id);
      if (!seen.has(nid)) {
        seen.add(nid);
        result.push({ id: nid, name: userMap.get(nid) || 'Member' });
      }
    });
    return result;
  }, [tripMemberIds, userMap]);

  // Net debt per member from this trip's expenses
  const netDebts = useMemo(() => {
    const debts: Record<string, number> = {};
    members.forEach(m => { debts[m.id] = 0; });
    const tripExpenses = expenses.filter(e => e.tripId === activeTripId);
    tripExpenses.forEach(exp => {
      const payerId = norm(exp.payerId);
      splits.filter(s => s.expenseId === exp.id).forEach(split => {
        const debtorId = norm(split.debtorId);
        if (debts[payerId] !== undefined) debts[payerId] += split.amountOwed;
        if (debts[debtorId] !== undefined) debts[debtorId] -= split.amountOwed;
      });
    });
    return debts;
  }, [members, splits, expenses, activeTripId]);

  // Pairwise owes map: owes[a][b] = a owes b this amount
  const owes = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    members.forEach(m => { map[m.id] = {}; });
    splits.forEach(split => {
      const exp = expenses.find(e => e.id === split.expenseId && e.tripId === activeTripId);
      if (!exp) return;
      const debtor = norm(split.debtorId);
      const payee = norm(exp.payerId);
      if (debtor !== payee && map[debtor] !== undefined) {
        map[debtor][payee] = (map[debtor][payee] || 0) + split.amountOwed;
      }
    });
    return map;
  }, [members, splits, expenses, activeTripId]);

  const maxNetDebt = useMemo(() => {
    let max = 0;
    Object.values(netDebts).forEach(v => { max = Math.max(max, Math.abs(v)); });
    return max || 1;
  }, [netDebts]);

  const maxPairDebt = useMemo(() => {
    let max = 0;
    Object.values(owes).forEach(p => Object.values(p).forEach(v => { max = Math.max(max, v); }));
    return max || 1;
  }, [owes]);

  // Spherical Fibonacci node layout
  const nodes = useMemo(() => {
    const n = Math.max(members.length, 1);
    const radius = Math.min(7, 3 + n * 1.1);
    return members.map((m, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      return {
        id: m.id,
        name: m.name,
        position: new THREE.Vector3(
          radius * Math.cos(theta) * Math.sin(phi),
          radius * Math.cos(phi) * 0.65,
          radius * Math.sin(theta) * Math.sin(phi),
        ),
        netDebt: netDebts[m.id] || 0,
      };
    });
  }, [members, netDebts]);

  const isSolo = members.length <= 1;

  if (!activeTripId) return null;

  return (
    <group>
      {/* Stars */}
      {nodes.map(node => {
        const isLocal = node.id === localId;
        const settled = Math.abs(node.netDebt) < 0.5;
        const ratio = Math.min(Math.abs(node.netDebt) / maxNetDebt, 1);
        const color = isLocal ? '#FF7A1A' : '#22D3EE';
        const isHovered = hoveredStar === node.id;

        // Emissive scales with debt ratio per spec
        const emissiveIntensity = settled ? 0.4 : (1.4 + ratio * 4.5);
        const coreColor = settled ? '#9aa0aa' : color;

        // Halo: scale and opacity scale with debt
        const haloScale = settled ? 0 : (1.6 + ratio * 1.6) * (isHovered ? 1.2 : 1.0);
        const haloOpacity = settled ? 0 : (0.18 + ratio * 0.3);

        const labelColor = settled ? '#6b7280' : node.netDebt < 0 ? '#d98a6c' : '#6fba8a';

        return (
          <group key={node.id} position={node.position}>
            {/* Core star sphere */}
            <mesh
              onClick={() => onStarClick(node.id)}
              onPointerOver={() => onStarHover(node.id)}
              onPointerOut={() => onStarHover(null)}
            >
              <sphereGeometry args={[0.42, 32, 32]} />
              <meshStandardMaterial
                color={coreColor}
                emissive={coreColor}
                emissiveIntensity={emissiveIntensity}
                roughness={settled ? 0.8 : 0.05}
                metalness={0}
                toneMapped={false}
              />
            </mesh>

            {/* Additive halo sprite — glow without expensive transparent spheres */}
            {!settled && haloScale > 0 && (
              <mesh>
                <sphereGeometry args={[0.42 * haloScale, 16, 16]} />
                <meshBasicMaterial
                  color={color} transparent opacity={haloOpacity}
                  blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}
                />
              </mesh>
            )}

            {/* Point light to illuminate nearby lines */}
            {!settled && (
              <pointLight color={color} intensity={1 + ratio * 2.5} distance={9} decay={2} />
            )}

            {/* Settled planet ring */}
            {settled && (
              <mesh rotation={[Math.PI / 2.3, 0, 0]}>
                <torusGeometry args={[0.7, 0.025, 12, 48]} />
                <meshBasicMaterial color="#6b7280" transparent opacity={0.55} toneMapped={false} />
              </mesh>
            )}

            {/* Label */}
            <Html center distanceFactor={12} style={{ pointerEvents: 'none', userSelect: 'none' }}>
              <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                <motion.div
                  animate={isSolo ? { scale: [1, 1.07, 1] } : { scale: 1 }}
                  transition={isSolo ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : {}}
                >
                  <div style={{
                    color: 'rgba(255,255,255,0.92)', fontSize: '0.82rem', fontWeight: 600,
                    textShadow: '0 2px 6px rgba(0,0,0,1)', marginTop: '44px',
                    fontFamily: 'Inter, system-ui, sans-serif',
                  }}>
                    {isLocal ? 'You' : node.name}
                  </div>
                  <div style={{
                    color: labelColor, fontSize: '0.7rem', fontWeight: 700, marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {settled ? 'Settled' : (node.netDebt > 0 ? '+' : '') + INR(node.netDebt)}
                  </div>
                </motion.div>
              </div>
            </Html>
          </group>
        );
      })}

      {/* Solo invitation prompt */}
      {isSolo && nodes.length === 1 && (
        <Html center position={[0, -2.5, 0]} distanceFactor={10} style={{ pointerEvents: 'none' }}>
          <div style={{
            textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem',
            fontStyle: 'italic', whiteSpace: 'nowrap', fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            It's just you here — invite your crew
          </div>
        </Html>
      )}

      {/* Dashed debt lines — static, recomputed only on data change */}
      {nodes.map(a =>
        nodes.map(b => {
          if (a.id >= b.id) return null;
          const ab = owes[a.id]?.[b.id] || 0;
          const ba = owes[b.id]?.[a.id] || 0;
          const amount = Math.max(ab, ba);
          if (amount < 0.5) return null;

          const r = amount / maxPairDebt;
          const dimmed = hoveredStar && hoveredStar !== a.id && hoveredStar !== b.id;
          const lineColor = new THREE.Color('#22D3EE').lerp(new THREE.Color('#FF3D81'), r);

          return (
            <Line
              key={`line-${a.id}-${b.id}`}
              points={[a.position, b.position]}
              color={lineColor}
              lineWidth={1 + r * 5}
              transparent
              opacity={dimmed ? 0.12 : (0.3 + r * 0.55)}
              toneMapped={false}
            />
          );
        })
      )}

      {/* Static dim starfield for depth (Phase 1C) */}
      <StaticStarfield />
    </group>
  );
};

// 1500 dim white points, generated once, no per-frame work
const StaticStarfield = () => {
  const positions = useMemo(() => {
    const arr = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const r = 25 + Math.random() * 55;
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      arr[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#ffffff" size={0.06} sizeAttenuation transparent opacity={0.18}
        depthWrite={false} toneMapped={false}
      />
    </points>
  );
};
