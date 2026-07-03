import { useMemo } from 'react';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';
import { useTripMember } from '../hooks/useTrips';
import * as SpacetimeDB from '../spacetimedb';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
  activeTripId: string | null;
}

const uidOf = (u: any): string =>
  typeof u?.id === 'object' && u.id && 'toHexString' in u.id ? u.id.toHexString() : String(u?.id);

export const LiveDebtConstellation = ({ activeTripId }: Props) => {
  const allUsers = useUser();
  const tripMemberIds = useTripMember(activeTripId || '');
  const splits = useExpenseSplit();
  const expenses = useExpense();

  // Members of this trip, deduped, mapped to their user row (for the name).
  const users = useMemo(() => {
    const byId = new Map<string, any>();
    allUsers.forEach((u) => {
      const uid = uidOf(u);
      if (tripMemberIds.includes(uid) && !byId.has(uid)) byId.set(uid, { ...u, uid });
    });
    // Include members that have no user row yet (e.g. invited-but-not-loaded) so
    // the graph still shows a node instead of silently dropping them.
    tripMemberIds.forEach((uid) => {
      if (!byId.has(uid)) byId.set(uid, { uid, name: 'Member' });
    });
    return Array.from(byId.values());
  }, [allUsers, tripMemberIds]);

  const netDebts = useMemo(() => {
    const debts: Record<string, number> = {};
    users.forEach((u) => (debts[u.uid] = 0));
    const tripExpenses = expenses.filter((e) => e.tripId === activeTripId);
    tripExpenses.forEach((expense) => {
      splits
        .filter((s) => s.expenseId === expense.id)
        .forEach((split) => {
          if (debts[expense.payerId] !== undefined) debts[expense.payerId] += split.amountOwed;
          if (debts[split.debtorId] !== undefined) debts[split.debtorId] -= split.amountOwed;
        });
    });
    return debts;
  }, [users, splits, expenses, activeTripId]);

  const owes = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    users.forEach((u) => (map[u.uid] = {}));
    splits.forEach((split) => {
      const expense = expenses.find((e) => e.id === split.expenseId && e.tripId === activeTripId);
      if (!expense) return;
      const debtor = split.debtorId;
      const payee = expense.payerId;
      if (debtor !== payee && map[debtor]) {
        map[debtor][payee] = (map[debtor][payee] || 0) + split.amountOwed;
      }
    });
    return map;
  }, [users, splits, expenses, activeTripId]);

  const maxNetDebt = useMemo(() => {
    let max = 0;
    Object.values(netDebts).forEach((v) => (max = Math.max(max, Math.abs(v))));
    return max || 1;
  }, [netDebts]);

  const maxSpecificDebt = useMemo(() => {
    let max = 0;
    Object.values(owes).forEach((p) => Object.values(p).forEach((v) => (max = Math.max(max, v))));
    return max || 1;
  }, [owes]);

  const nodes = useMemo(() => {
    const radius = 6;
    const n = Math.max(users.length, 1);
    return users.map((user, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      return {
        id: user.uid,
        name: user.name,
        position: new THREE.Vector3(
          radius * Math.cos(theta) * Math.sin(phi),
          radius * Math.cos(phi),
          radius * Math.sin(theta) * Math.sin(phi)
        ),
        netDebt: netDebts[user.uid] || 0,
      };
    });
  }, [users, netDebts]);

  const localIdentity = SpacetimeDB.localIdentity ?? 'unknown';

  if (!activeTripId) return null;

  return (
    <group>
      {nodes.map((node) => {
        const isLocal = node.id === localIdentity;
        const color = isLocal ? '#FF7A1A' : '#22D3EE';
        const settled = Math.abs(node.netDebt) < 0.01;
        const ratio = Math.min(Math.abs(node.netDebt) / maxNetDebt, 1);
        const emissive = settled ? 0 : 1.0 + ratio * 4.0;
        const core = 0.4;
        const halo = core * (1.5 + ratio * 2.0);

        return (
          <group key={node.id} position={node.position}>
            <mesh>
              <sphereGeometry args={[core, 32, 32]} />
              <meshStandardMaterial
                color={settled ? '#9aa0aa' : color}
                emissive={settled ? '#000000' : color}
                emissiveIntensity={emissive}
                roughness={settled ? 0.85 : 0.15}
                metalness={settled ? 0.3 : 0}
                toneMapped={false}
              />
            </mesh>

            {!settled && (
              <mesh>
                <sphereGeometry args={[halo, 24, 24]} />
                <meshBasicMaterial
                  color={color} transparent opacity={0.12 + ratio * 0.22}
                  blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}
                />
              </mesh>
            )}

            {!settled && <pointLight color={color} intensity={1 + ratio * 2} distance={10} decay={2} />}

            {settled && (
              // subtle ring = a resolved "planet"
              <mesh rotation={[Math.PI / 2.2, 0, 0]}>
                <torusGeometry args={[core * 1.6, 0.02, 12, 48]} />
                <meshBasicMaterial color="#6b7280" transparent opacity={0.5} toneMapped={false} />
              </mesh>
            )}

            <Html center distanceFactor={15} style={{ pointerEvents: 'none' }}>
              <div style={{
                marginTop: '46px', textAlign: 'center', whiteSpace: 'nowrap',
                color: 'rgba(255,255,255,0.92)', fontSize: '0.85rem', fontWeight: 600,
                textShadow: '0 2px 4px rgba(0,0,0,1)',
              }}>
                {node.name}
                {settled ? (
                  <div style={{ color: '#8e8e93', fontSize: '0.7rem', marginTop: '2px', fontWeight: 600 }}>Settled</div>
                ) : (
                  <div style={{ color, fontSize: '0.75rem', marginTop: '2px', fontWeight: 800 }}>
                    {node.netDebt < 0 ? '-' : '+'}${Math.abs(node.netDebt).toFixed(2)}
                  </div>
                )}
              </div>
            </Html>
          </group>
        );
      })}

      {/* Debt lines: thickness + opacity + colour scale with the pairwise debt.
          Static (no per-frame dashOffset mutation) so a frame callback can never
          throw and freeze the app. */}
      {nodes.map((a) =>
        nodes.map((b) => {
          if (a.id === b.id) return null;
          const amount = owes[a.id]?.[b.id] || 0;
          if (amount <= 0.01) return null;
          const r = maxSpecificDebt > 0 ? amount / maxSpecificDebt : 0;
          const col = new THREE.Color('#22D3EE').lerp(new THREE.Color('#FF3D81'), r);
          return (
            <Line
              key={`line-${a.id}-${b.id}`}
              points={[a.position, b.position]}
              color={col}
              lineWidth={1 + r * 6}
              transparent
              opacity={0.25 + r * 0.6}
              toneMapped={false}
            />
          );
        })
      )}
    </group>
  );
};
