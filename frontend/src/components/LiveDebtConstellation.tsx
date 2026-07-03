import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';
import { useTripMember } from '../App';
import * as SpacetimeDB from '../spacetimedb';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
  activeTripId: string | null;
}

const AnimatedLine = ({ start, end, amount, maxDebt }: { start: THREE.Vector3, end: THREE.Vector3, amount: number, maxDebt: number }) => {
  const lineRef = useRef<any>(null);
  const debtRatio = maxDebt > 0 ? amount / maxDebt : 0;
  
  const color = useMemo(() => new THREE.Color('#22D3EE').lerp(new THREE.Color('#FF3D81'), debtRatio), [debtRatio]);
  const lineWidth = 1 + debtRatio * 8;
  const opacity = 0.3 + debtRatio * 0.7;

  useFrame((_, delta) => {
    if (lineRef.current && lineRef.current.material) {
      lineRef.current.material.dashOffset -= delta * 3; // flowing debtor -> creditor
    }
  });

  return (
    <Line
      ref={lineRef}
      points={[start, end]}
      color={color}
      lineWidth={lineWidth}
      transparent
      opacity={opacity}
      toneMapped={false}
      dashed={true}
      dashScale={1}
      dashSize={0.5}
      dashOffset={0}
    />
  );
};

export const LiveDebtConstellation = ({ activeTripId }: Props) => {
  const allUsers = useUser();
  const tripMemberIds = useTripMember(activeTripId || '');
  
  // Dedupe users by ID
  const users = useMemo(() => {
    const map = new Map();
    allUsers.forEach(u => {
      const uid = typeof u.id === 'object' && 'toHexString' in u.id ? (u.id as any).toHexString() : String(u.id);
      if (tripMemberIds.includes(uid) && !map.has(uid)) {
        map.set(uid, { ...u, uid });
      }
    });
    return Array.from(map.values());
  }, [allUsers, tripMemberIds]);

  const splits = useExpenseSplit();
  const expenses = useExpense();

  // Calculate net debt for each user
  const netDebts = useMemo(() => {
    const debts: Record<string, number> = {};
    users.forEach(u => debts[u.uid] = 0);

    const tripExpenses = expenses.filter(e => e.tripId === activeTripId);
    
    tripExpenses.forEach(expense => {
      const expSplits = splits.filter(s => s.expenseId === expense.id);
      expSplits.forEach(split => {
        if (debts[expense.payerId] !== undefined) debts[expense.payerId] += split.amountOwed; // Payer is owed money (+)
        if (debts[split.debtorId] !== undefined) debts[split.debtorId] -= split.amountOwed; // Debtor owes money (-)
      });
    });
    
    return debts;
  }, [users, splits, expenses, activeTripId]);

  // Specific debt between users
  const owes = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    users.forEach(u => map[u.uid] = {});
    
    splits.forEach(split => {
      const expense = expenses.find(e => e.id === split.expenseId && e.tripId === activeTripId);
      if (!expense) return;
      const debtorId = split.debtorId;
      const payeeId = expense.payerId;
      if (debtorId !== payeeId) {
        if (!map[debtorId]) map[debtorId] = {};
        map[debtorId][payeeId] = (map[debtorId][payeeId] || 0) + split.amountOwed;
      }
    });
    return map;
  }, [users, splits, expenses, activeTripId]);

  const maxNetDebtMagnitude = useMemo(() => {
    let max = 0;
    Object.values(netDebts).forEach(v => { if (Math.abs(v) > max) max = Math.abs(v); });
    return max || 1;
  }, [netDebts]);

  const maxSpecificDebt = useMemo(() => {
    let max = 0;
    Object.values(owes).forEach(payees => Object.values(payees).forEach(v => { if (v > max) max = v; }));
    return max || 1;
  }, [owes]);

  // Generate 3D coordinates for each user node
  const nodes = useMemo(() => {
    const radius = 6;
    return users.map((user, i) => {
      const phi = Math.acos(1 - 2 * (i + 0.5) / users.length);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const x = radius * Math.cos(theta) * Math.sin(phi);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(theta) * Math.sin(phi);
      return {
        id: user.uid,
        name: user.name,
        position: new THREE.Vector3(x, y, z),
        netDebt: netDebts[user.uid] || 0,
      };
    });
  }, [users, netDebts]);

  const localIdentity = SpacetimeDB.localIdentity ?? 'unknown';

  if (!activeTripId) return null;

  return (
    <group>
      {/* 3D Nodes (Stars) */}
      {nodes.map(node => {
        const isLocalUser = node.id === localIdentity;
        const color = isLocalUser ? '#FF7A1A' : '#22D3EE';
        const isSettled = Math.abs(node.netDebt) < 0.01;
        
        const debtRatio = Math.min(Math.abs(node.netDebt) / maxNetDebtMagnitude, 1);
        const emissiveIntensity = isSettled ? 0 : 1.0 + (debtRatio * 4.0); 
        const coreSize = 0.4;
        const haloSize = coreSize * (1.5 + debtRatio * 2.0);

        return (
          <group key={node.id} position={node.position}>
            {/* Core */}
            <mesh>
              <sphereGeometry args={[coreSize, 32, 32]} />
              <meshStandardMaterial 
                color={isSettled ? '#8e8e93' : color} 
                emissive={isSettled ? '#000000' : color}
                emissiveIntensity={emissiveIntensity}
                roughness={isSettled ? 0.8 : 0.1}
                toneMapped={false}
              />
            </mesh>
            
            {/* Volumetric Halo */}
            {!isSettled && (
              <mesh>
                <sphereGeometry args={[haloSize, 32, 32]} />
                <meshBasicMaterial 
                  color={color} 
                  transparent 
                  opacity={0.15 + debtRatio * 0.25} 
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            )}

            {/* Point Light for surrounding glow */}
            {!isSettled && (
              <pointLight color={color} intensity={1 + debtRatio * 2} distance={10} decay={2} />
            )}
            
            {/* HTML label */}
            <Html center distanceFactor={15} style={{ pointerEvents: 'none' }}>
              <div style={{
                marginTop: '45px', textAlign: 'center', whiteSpace: 'nowrap',
                color: 'rgba(255,255,255,0.9)', fontSize: '0.85rem', fontWeight: 600,
                textShadow: '0 2px 4px rgba(0,0,0,1)'
              }}>
                {node.name}
                {Math.abs(node.netDebt) > 0.01 ? (
                  <div style={{ color, fontSize: '0.75rem', marginTop: '2px', fontWeight: 800 }}>
                    {node.netDebt < 0 ? '-' : '+'}${Math.abs(node.netDebt).toFixed(2)}
                  </div>
                ) : (
                  <div style={{ color: '#8e8e93', fontSize: '0.7rem', marginTop: '2px', fontWeight: 600 }}>
                    Settled
                  </div>
                )}
              </div>
            </Html>
          </group>
        );
      })}

      {/* 3D Debt Lines connecting the stars */}
      {nodes.map(nodeA =>
        nodes.map(nodeB => {
          if (nodeA.id === nodeB.id) return null;
          const amount = owes[nodeA.id]?.[nodeB.id] || 0;
          if (amount <= 0.01) return null; // no line if fully settled
          
          return (
            <AnimatedLine 
              key={`line-${nodeA.id}-${nodeB.id}`}
              start={nodeA.position}
              end={nodeB.position}
              amount={amount}
              maxDebt={maxSpecificDebt}
            />
          );
        })
      )}
    </group>
  );
};
