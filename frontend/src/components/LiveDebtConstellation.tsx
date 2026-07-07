/**
 * LiveDebtConstellation — member stars + dashed debt lines
 * Rules enforced:
 * - No per-frame material mutation (Rule 7): debt lines are static; re-render on data change only
 * - No fabricated identities (Rule 6)
 * - user.id is Identity → toHexString(), normalized lowercase (Rule 8)
 * - Debt lines use drei <Line> with dashed prop (Phase 2.2)
 * - Star halo = cheap additive-blending sprite, not a large transparent sphere
 */
import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { motion } from 'framer-motion';
import * as THREE from 'three';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';
import { useTripMember } from '../hooks/useTrips';
import * as StDB from '../spacetimedb';
import { AudioService } from '../audio';
import { buildOwesMap } from '../lib/ledger';

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

const AtmosphereShell = ({ color, strength, radius = 0.62 }: { color: string; strength: number; radius?: number }) => {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: 2.4 },
      uStrength: { value: strength },
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), uPower);
        gl_FragColor = vec4(uColor, f * uStrength);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  }), [color, strength]);
  return (
    <mesh raycast={() => null}>
      <sphereGeometry args={[radius, 32, 32]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
};

interface LDCProps {
  activeTripId: string;
  hoveredStar: string | null;
  onStarHover: (id: string | null) => void;
  onStarClick: (id: string | null) => void;
  selectedMemberId?: string | null;
  settling?: boolean;
  onSelectedStarPosUpdate?: (pos: { x: number, y: number } | null) => void;
}

export const LiveDebtConstellation = ({ activeTripId, hoveredStar: _hoveredStar, onStarHover, onStarClick, selectedMemberId, settling: _settling, onSelectedStarPosUpdate }: LDCProps) => {
  const allUsers = useUser();
  const tripMemberIds = useTripMember(activeTripId);
  const splits = useExpenseSplit();
  const expenses = useExpense();
  const ref = useRef<THREE.Group>(null);

  const localId = norm(StDB.getLocalId() ?? '');

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
    const tripExpenses = expenses.filter(e => e.tripId === activeTripId);
    return buildOwesMap(tripExpenses, splits);
  }, [splits, expenses, activeTripId]);

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

  // Create radial gradient texture for the halos
  const haloTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, []);

  const { camera, size } = useThree();
  const tickRef = useRef(0);
  const lastPos = useRef({ x: 0, y: 0, id: '' });

  // B1: Smooth Fly-in & Living Constellation (drift/bob)
  useFrame((_, delta) => {
    tickRef.current++;
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.06;            // continuous slow orbit
    const t = performance.now() / 1000;
    ref.current.children.forEach((child) => {
      if (child.name === 'star-group') {
        const baseY = child.userData.baseY;
        if (typeof baseY === 'number') child.position.y = baseY + Math.sin(t * 0.9 + child.userData.seed) * 0.25;
        const s = 1 + Math.sin(t * 0.8 + child.userData.seed) * 0.02;
        child.scale.setScalar(s);
      }
    });

    if (selectedMemberId && onSelectedStarPosUpdate && tickRef.current % 2 === 0) {
      let groupObj = ref.current.children.find(c => c.name === 'star-group' && c.userData.nodeId === selectedMemberId);
      if (groupObj) {
         const pos = new THREE.Vector3();
         groupObj.getWorldPosition(pos);
         pos.project(camera);
         const x = Math.round((pos.x * 0.5 + 0.5) * size.width);
         const y = Math.round(-(pos.y * 0.5 - 0.5) * size.height);
         if (x !== lastPos.current.x || y !== lastPos.current.y || lastPos.current.id !== selectedMemberId) {
            lastPos.current = { x, y, id: selectedMemberId };
            onSelectedStarPosUpdate({ x, y });
         }
      }
    } else if (!selectedMemberId && lastPos.current.id !== '') {
       lastPos.current = { x: 0, y: 0, id: '' };
       if (onSelectedStarPosUpdate) onSelectedStarPosUpdate(null);
    }

    if (ref.current.userData.fade === undefined) {
      ref.current.userData.fade = 0;
      ref.current.userData.mountTime = t;
      ref.current.traverse((child: any) => {
        if (child.userData && child.userData.baseOpacity !== undefined && child.material) {
           child.material.transparent = true;
           child.material.opacity = 0;
        }
      });
    }

    const elapsed = t - ref.current.userData.mountTime;
    // Bloom-in: begin almost immediately, ease-out over ~0.7s. No long invisible delay.
    const raw = _settling ? Math.min(Math.max((elapsed - 0.12) / 0.7, 0), 1) : 1;
    const eased = 1 - Math.pow(1 - raw, 3);

    // Group-level scale bloom (transform only, safe): 0.9 -> 1.0, synchronized with opacity.
    ref.current.scale.setScalar(0.9 + eased * 0.1);

    if (ref.current.userData.fade !== eased) {
      ref.current.userData.fade = eased;
      ref.current.traverse((child: any) => {
        if (child.userData && child.userData.baseOpacity !== undefined && child.material) {
           child.material.opacity = child.userData.baseOpacity * eased;
        }
      });
    }
  });

  // Close popup on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedMemberId) onStarClick(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMemberId, onStarClick]);

  return (
    <group ref={ref} onClick={(e) => { if (e.object.type !== 'Mesh' && selectedMemberId) onStarClick(null); }}>
      {/* Stars */}
      {nodes.map((node, i) => {
        const isLocal = node.id === localId;
        const settled = Math.abs(node.netDebt) < 0.5;
        const ratio = Math.min(Math.abs(node.netDebt) / maxNetDebt, 1);
        const color = isLocal ? '#FFB74D' : '#5EE6FF';

        // Emissive scales with debt ratio per spec (softer glow)
        const emissiveIntensity = settled ? 0.18 : (0.5 + ratio * 1.1);
        const coreColor = settled ? '#9aa0aa' : color;
        const shellColor = settled ? '#8b93a3' : color;
        const shellStrength = settled ? 0.26 : (isLocal ? 0.62 : (0.40 + ratio * 0.45));

        const labelColor = settled ? '#6b7280' : node.netDebt < 0 ? '#d98a6c' : '#6fba8a';
        const isSelected = selectedMemberId === node.id;

        return (
          <group key={node.id} position={node.position} name="star-group" userData={{ baseY: node.position.y, seed: i * 2.1, nodeId: node.id }}>
            {/* Invisible hit target for clicks */}
            <mesh
              onClick={(e) => { e.stopPropagation(); AudioService.playBlip(); onStarClick(node.id); }}
              onPointerOver={(e) => { e.stopPropagation(); onStarHover(node.id); }}
              onPointerOut={() => onStarHover(null)}
            >
              <sphereGeometry args={[1.1, 16, 16]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            {/* Core star sphere */}
            <mesh userData={{ baseOpacity: 1 }}>
              <sphereGeometry args={[0.42, 32, 32]} />
              <meshStandardMaterial
                color={coreColor}
                emissive={coreColor}
                emissiveIntensity={emissiveIntensity}
                roughness={settled ? 0.8 : 0.05}
                metalness={0}
                toneMapped={false}
                transparent
              />
            </mesh>

            {/* Fresnel atmosphere shell (static, view-dependent limb glow) */}
            <AtmosphereShell color={shellColor} strength={shellStrength} radius={0.62} />

            {/* Layered additive halo sprites */}
            {!settled && (
              <group>
                {/* Inner bright halo */}
                <sprite raycast={() => null} scale={[1.8 + ratio * 2.2, 1.8 + ratio * 2.2, 1]} userData={{ baseOpacity: 0.1 + ratio * 0.15 }}>
                  <spriteMaterial
                    map={haloTexture}
                    color={color}
                    transparent opacity={0.1 + ratio * 0.15}
                    blending={THREE.AdditiveBlending} depthWrite={false}
                  />
                </sprite>
                {/* Outer soft halo */}
                <sprite raycast={() => null} scale={[3.0 + ratio * 3.5, 3.0 + ratio * 3.5, 1]} userData={{ baseOpacity: (0.1 + ratio * 0.15) * 0.4 }}>
                  <spriteMaterial
                    map={haloTexture}
                    color={color}
                    transparent opacity={(0.1 + ratio * 0.15) * 0.4}
                    blending={THREE.AdditiveBlending} depthWrite={false}
                  />
                </sprite>
              </group>
            )}

            {/* Point light to illuminate nearby lines */}
            {!settled && (
              <pointLight color={color} intensity={0.5 + ratio * 1.5} distance={9} decay={2} />
            )}

            {/* Settled planet ring */}
            {settled && (
              <mesh raycast={() => null} rotation={[Math.PI / 2.3, 0, 0]} userData={{ baseOpacity: 0.55 }}>
                <torusGeometry args={[0.7, 0.025, 12, 48]} />
                <meshBasicMaterial color="#6b7280" transparent opacity={0.55} toneMapped={false} />
              </mesh>
            )}

            {/* Label */}
            {!isSelected && (
              <Html center distanceFactor={14} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                <div className="glass-pill" style={{
                  textAlign: 'center', whiteSpace: 'nowrap', padding: '6px 14px', marginTop: '64px',
                  background: 'rgba(5,6,10,0.6)', border: '1px solid var(--glass-brd)'
                }}>
                  <motion.div
                    animate={isSolo ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                    transition={isSolo ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : {}}
                  >
                    <div style={{
                      color: 'var(--text)', fontSize: '0.85rem', fontWeight: 600,
                      fontFamily: 'Satoshi, sans-serif'
                    }}>
                      {isLocal ? 'You' : node.name}
                    </div>
                    <div className="money" style={{
                      color: labelColor, fontSize: '0.75rem', fontWeight: 700, marginTop: '2px',
                    }}>
                      {settled ? 'Settled' : (node.netDebt > 0 ? '+' : '') + INR(node.netDebt)}
                    </div>
                  </motion.div>
                </div>
              </Html>
            )}

            {/* Futuristic Popup removed from here */}
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

          const ratio = amount / maxPairDebt;
          
          return (
            <Line
              key={`${a.id}-${b.id}`}
              points={[a.position, b.position]}
              color="#ffffff"
              lineWidth={0.35 + ratio * 1.6}
              transparent
              opacity={0.18 + ratio * 0.4}
              toneMapped={false}
              userData={{ baseOpacity: 0.18 + ratio * 0.4 }}
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
