import { useMemo } from 'react';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';
import * as SpacetimeDB from '../spacetimedb';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
  activeTripId: string | null;
}

export const LiveDebtConstellation = ({ activeTripId }: Props) => {
  const users = useUser();
  const splits = useExpenseSplit();
  const expenses = useExpense();

  if (!activeTripId) return null;

  // Calculate net debt for each user
  const netDebts = useMemo(() => {
    const debts: Record<string, number> = {};
    users.forEach(u => {
      const uid = typeof u.id === 'object' && 'toHexString' in u.id
        ? (u.id as any).toHexString() : String(u.id);
      debts[uid] = 0;
    });

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
    users.forEach(u => {
      const uid = typeof u.id === 'object' && 'toHexString' in u.id
        ? (u.id as any).toHexString() : String(u.id);
      map[uid] = {};
    });
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
    Object.values(netDebts).forEach(v => {
      if (Math.abs(v) > max) max = Math.abs(v);
    });
    return max || 1;
  }, [netDebts]);

  const maxSpecificDebt = useMemo(() => {
    let max = 0;
    Object.values(owes).forEach(payees =>
      Object.values(payees).forEach(v => { if (v > max) max = v; })
    );
    return max || 1;
  }, [owes]);

  // Generate 3D coordinates for each user node
  const nodes = useMemo(() => {
    // 3D positioning logic
    const radius = 6; // Spread them out in 3D space
    return users.map((user, i) => {
      // Golden spiral distribution on a sphere
      const phi = Math.acos(1 - 2 * (i + 0.5) / users.length);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      
      const x = radius * Math.cos(theta) * Math.sin(phi);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(theta) * Math.sin(phi);
      
      const uid = typeof user.id === 'object' && 'toHexString' in user.id
        ? (user.id as any).toHexString() : String(user.id);
      
      return {
        id: uid,
        name: user.name,
        position: new THREE.Vector3(x, y, z),
        netDebt: netDebts[uid] || 0,
      };
    });
  }, [users, netDebts]);

  const localIdentity = SpacetimeDB.localIdentity ?? 'unknown';

  return (
    <group>
      {/* 3D Nodes (Stars) */}
      {nodes.map(node => {
        const isLocalUser = node.id === localIdentity;
        const color = isLocalUser ? '#ff8c00' : '#00ffff'; // Vibrant Orange for self, Cyan for others
        
        // Emissive intensity: 0 debt = 0.5, max debt = 5.0
        const debtRatio = Math.min(Math.abs(node.netDebt) / maxNetDebtMagnitude, 1);
        const emissiveIntensity = 0.5 + (debtRatio * 4.5); 
        
        const size = 0.4 + (debtRatio * 0.4); // slightly larger if high debt

        return (
          <group key={node.id} position={node.position}>
            <mesh>
              <sphereGeometry args={[size, 32, 32]} />
              <meshStandardMaterial 
                color={color} 
                emissive={color}
                emissiveIntensity={emissiveIntensity}
                toneMapped={false}
              />
            </mesh>
            
            {/* HTML label anchored to the 3D position */}
            <Html center distanceFactor={15} style={{ pointerEvents: 'none' }}>
              <div style={{
                marginTop: '30px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.85rem',
                fontWeight: 600,
                textShadow: '0 2px 4px rgba(0,0,0,1)'
              }}>
                {node.name}
                {Math.abs(node.netDebt) > 0.01 && (
                  <div style={{ color: node.netDebt < 0 ? '#ff8c00' : '#00ffff', fontSize: '0.75rem', marginTop: '2px', fontWeight: 800 }}>
                    {node.netDebt < 0 ? '-' : '+'}${Math.abs(node.netDebt).toFixed(2)}
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
          if (amount <= 0) return null;
          
          const debtRatio = amount / maxSpecificDebt;
          const lineWidth = 1 + debtRatio * 8; // Line width maps directly to debt
          const opacity = 0.2 + debtRatio * 0.8;

          return (
            <Line
              key={`line-${nodeA.id}-${nodeB.id}`}
              points={[nodeA.position, nodeB.position]}
              color="#ffffff"
              lineWidth={lineWidth}
              transparent
              opacity={opacity}
              toneMapped={false}
            />
          );
        })
      )}
    </group>
  );
};
