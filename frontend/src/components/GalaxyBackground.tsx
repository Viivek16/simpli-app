/**
 * GalaxyBackground — always-mounted WebGL Canvas
 *
 * Phase 1B fixes:
 * - uiPaused pauses the render loop (frameloop='never') AND stops canvas pointer events
 * - Camera does a fixed 1.2s transition then releases to OrbitControls (no perpetual damping)
 * - Canvas pointer-events: in Macro, canvas receives events for galaxy click; in Micro, canvas
 *   always receives events so you can orbit the constellation
 * - dpr capped at [1, 1.5]
 *
 * Phase 1C: micro view has no SwirlingGalaxy or fog — only the constellation + static starfield
 *
 * Phase 2.1: camera flies to galaxy world position, galaxy color stable via trip.id hash
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Points, PointMaterial, OrbitControls, Html, Preload } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { LiveDebtConstellation } from './LiveDebtConstellation';
import { ErrorBoundary } from './ErrorBoundary';
import type { Trip } from '../hooks/useTrips';
import { useExpense, useExpenseSplit, useUser } from '../module_bindings/hooks';
import * as StDB from '../spacetimedb';
import { AudioService } from '../audio';
import { buildOwesMap, pairNet } from '../lib/ledger';
import { useUserDevice } from '../hooks/useUserDevice';
import { resolveNames } from '../lib/names';

const norm = (s: any) => String(s ?? '').toLowerCase().trim();

// Glow texture helper
const createGlowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
};

let sharedStarTex: THREE.CanvasTexture | null = null;
const createStarTexture = () => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
};

// Stable color palette hashed from trip id (Phase 2.1)
const PALETTE = [
  { core: '#FFC46B', edge: '#FF7A1A' }, // amber-gold
  { core: '#FF6FD8', edge: '#B4149E' }, // rose-magenta
  { core: '#7BF7A6', edge: '#129E5E' }, // emerald
  { core: '#B79CFF', edge: '#6D3BE6' }, // violet
  { core: '#6FE9E0', edge: '#0E9E9E' }, // teal
];

const hashId = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const tripColor = (id: string) => PALETTE[hashId(id) % PALETTE.length];

// ─── Macro galaxy particle cloud ──────────────────────────────────────────────
let sharedGlowTex: THREE.CanvasTexture | null = null;

const SwirlingGalaxy = ({
  position, colorCoreStr, colorEdgeStr, onClick, name, hovered, selected, hidden, index, settled, netBalances
}: {
  position: THREE.Vector3; colorCoreStr: string; colorEdgeStr: string;
  onClick?: () => void; name?: string; hovered?: boolean; selected?: boolean; hidden?: boolean; index: number;
  settled: boolean; netBalances: { owes: string; owed: string; amtOwes: number; amtOwed: number } | null;
}) => {
  const ref = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const spriteRef1 = useRef<THREE.Sprite>(null);
  const spriteRef2 = useRef<THREE.Sprite>(null);
  const mountTime = useRef<number | null>(null);

  if (!sharedGlowTex) sharedGlowTex = createGlowTexture();
  if (!sharedStarTex) sharedStarTex = createStarTexture();

  const { positions, colors, coreColor, edgeColor } = useMemo(() => {
    const isPhone = typeof window !== 'undefined' && window.innerWidth <= 768;
    const PARTICLE_COUNT = isPhone ? 2500 : 4500;
    const p = new Float32Array(PARTICLE_COUNT * 3);
    const c = new Float32Array(PARTICLE_COUNT * 3);
    const cCore = new THREE.Color(colorCoreStr);
    const cEdge = new THREE.Color(colorEdgeStr);
    if (settled) {
      cCore.lerp(new THREE.Color('#888888'), 0.85);
      cEdge.lerp(new THREE.Color('#555555'), 0.85);
    }
    const white = new THREE.Color('#FFFFFF');
    const temp = new THREE.Color();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const arm = i % 3;
      const branchAngle = (arm * Math.PI * 2) / 3;
      const t = Math.pow(Math.random(), 1.4) * Math.PI * 3.5; 
      const radius = 0.45 * Math.exp(0.15 * t);
      const angle = branchAngle + t;

      const scatter = Math.random() * (radius * 0.22);
      const sx = (Math.random() - 0.5) * scatter;
      const sy = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * (0.8 + radius * 0.1);
      const sz = (Math.random() - 0.5) * scatter;

      p[i * 3]     = Math.cos(angle) * radius + sx;
      p[i * 3 + 1] = sy;
      p[i * 3 + 2] = Math.sin(angle) * radius + sz;
      
      const intensity = Math.max(0, 1 - Math.pow(radius / 9, 1.2));
      temp.lerpColors(cEdge, cCore, intensity);
      if (radius < 1.4) temp.lerp(white, (1 - radius / 1.4) * 0.22);
      
      c[i * 3] = temp.r; c[i * 3 + 1] = temp.g; c[i * 3 + 2] = temp.b;
    }
    return { positions: p, colors: c, coreColor: cCore, edgeColor: cEdge };
  }, [colorCoreStr, colorEdgeStr, settled]);

  // Slow self-rotation + streak effect + stagger intro
  useFrame(({ clock }) => {
    if (!ref.current || !pointsRef.current) return;
    const mat = pointsRef.current.material as THREE.PointsMaterial;
    
    if (mountTime.current === null) {
      mountTime.current = clock.getElapsedTime() + 0.016; 
      mat.opacity = 0;
      if (spriteRef1.current) spriteRef1.current.material.opacity = 0;
      if (spriteRef2.current) spriteRef2.current.material.opacity = 0;
      ref.current.scale.set(0.96, 0.96, 0.96);
      return;
    }

    const elapsed = clock.getElapsedTime() - mountTime.current;
    const delay = index * 0.090; // 90ms stagger
    
    let e = 1;
    if (elapsed < delay) e = 0;
    else if (elapsed - delay < 0.520) {
      const t = (elapsed - delay) / 0.520;
      e = 1 - Math.pow(1 - t, 4); // cubic-bezier(0.22, 1, 0.36, 1) approx
    }
    
    ref.current.rotation.y += hovered || selected ? 0.002 : 0.0004;
    // settled groups are smaller
    const targetScale = selected ? 1.4 : (hovered ? 1.06 : (settled ? 0.8 : 1.0));
    const targetOpacity = hidden ? 0 : (selected ? 0.0 : (settled ? 0.30 : 0.48));
    
    if (e < 1) {
      const s = 0.96 + e * (targetScale - 0.96);
      ref.current.scale.set(s, s, s);
      mat.opacity = e * targetOpacity;
      if (spriteRef1.current) spriteRef1.current.material.opacity = mat.opacity * (0.10 / Math.max(targetOpacity, 0.001));
      if (spriteRef2.current) spriteRef2.current.material.opacity = mat.opacity * (0.035 / Math.max(targetOpacity, 0.001));
    } else {
      ref.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.04);
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, 0.05);
      if (spriteRef1.current) spriteRef1.current.material.opacity = mat.opacity * (0.10 / Math.max(targetOpacity, 0.001));
      if (spriteRef2.current) spriteRef2.current.material.opacity = mat.opacity * (0.035 / Math.max(targetOpacity, 0.001));
    }
  });

  return (
    <group position={position}>
      <group ref={ref} rotation={[0.1, 0, -0.1]}>
        <Points
          ref={pointsRef} positions={positions} colors={colors} stride={3} frustumCulled={false}
          onClick={(e) => { if (onClick) { e.stopPropagation(); onClick(); } }}
          onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = 'auto'; }}
        >
          <PointMaterial
            transparent vertexColors
            map={sharedStarTex}
            size={0.11}
            sizeAttenuation depthWrite={false}
            opacity={0}
            blending={THREE.AdditiveBlending} toneMapped={false}
          />
        </Points>
        {/* Core Glow */}
        <sprite ref={spriteRef1} scale={[2.4, 2.4, 1]} position={[0, 0, 0]}>
          <spriteMaterial map={sharedGlowTex} color={coreColor} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </sprite>
        {/* Nebula Haze */}
        <sprite ref={spriteRef2} scale={[6.5, 6.5, 1]} position={[0, -0.5, 0]}>
          <spriteMaterial map={sharedGlowTex} color={edgeColor} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </sprite>
      </group>
      {name && !selected && (
        <Html center distanceFactor={22} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div className="font-clash" style={{
            color: hovered ? '#ffffff' : 'var(--text)',
            background: 'rgba(5,6,10,0.5)',
            padding: '4px 12px',
            borderRadius: '12px',
            backdropFilter: 'blur(6px)',
            border: '1px solid var(--glass-brd)',
            fontWeight: 600, fontSize: '1rem',
            transition: 'color 200ms ease, background 200ms ease, opacity 200ms ease',
            opacity: hidden ? 0 : 1,
            whiteSpace: 'nowrap', marginTop: '-60px'
          }}>{name}</div>
          
          {/* A4: Hover Tooltips */}
          {hovered && !hidden && (
            <div style={{
              marginTop: '8px', background: 'rgba(5,6,10,0.85)', backdropFilter: 'blur(12px)',
              border: '1px solid var(--glass-brd)', borderRadius: '12px', padding: '10px 14px',
              color: 'var(--text)', fontSize: '0.8rem', whiteSpace: 'nowrap',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
              animation: 'bloomFadeIn 160ms cubic-bezier(0.22,1,0.36,1) forwards'
            }}>
              {settled ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-dim)' }}>
                  <span style={{ color: 'var(--owed)' }}>✓</span> Settled up
                </div>
              ) : netBalances ? (
                <>
                  {netBalances.amtOwed > 0 && <div style={{ color: 'var(--owed)' }}><span style={{ color: 'var(--text-dim)' }}>{netBalances.owed} owes</span> +₹{Math.round(netBalances.amtOwed)}</div>}
                  {netBalances.amtOwes > 0 && <div style={{ color: 'var(--owe)' }}><span style={{ color: 'var(--text-dim)' }}>You owe {netBalances.owes}</span> -₹{Math.round(netBalances.amtOwes)}</div>}
                  {netBalances.amtOwed === 0 && netBalances.amtOwes === 0 && <div style={{ color: 'var(--text-dim)' }}>You are settled up</div>}
                </>
              ) : null}
            </div>
          )}
        </Html>
      )}
    </group>
  );
};

// ─── Background Starfield ───────────────────────────────────────────────────
const BackgroundStarfield = ({ activeTripId, settled }: { activeTripId: string | null; settled: boolean }) => {
  const ref = useRef<THREE.Points>(null);
  
  const { positions, colors } = useMemo(() => {
    const TOTAL = 3500;
    const p = new Float32Array(TOTAL * 3);
    const c = new Float32Array(TOTAL * 3);
    for (let i = 0; i < TOTAL; i++) {
      const layer = i % 3;
      const r = 55 + layer * 35 + Math.random() * 25;
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);
      p[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      p[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      p[i * 3 + 2] = r * Math.cos(phi);
      
      const v = 0.5 + Math.random() * 0.5 + (layer === 0 ? 0.3 : 0);
      c[i * 3] = v; c[i * 3 + 1] = v; 
      c[i * 3 + 2] = v + (Math.random() < 0.2 ? 0.2 : 0);
    }
    return { positions: p, colors: c };
  }, []);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.PointsMaterial;
    const targetOpacity = activeTripId ? 0 : 0.22;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, 0.05);
    ref.current.rotation.y += delta * 0.018; // slow global drift
    ref.current.rotation.x += delta * 0.004;

  });

  if (activeTripId && settled) return null;

  return (
    <Points ref={ref} positions={positions} colors={colors} stride={3} frustumCulled={false}>
      <PointMaterial transparent vertexColors size={0.3} sizeAttenuation depthWrite={false} opacity={0} blending={THREE.AdditiveBlending} toneMapped={false} />
    </Points>
  );
};

// ─── Camera Animator ────────────────────────────────────────────────────────
const CameraAnimator = ({
  targetPos, settling,
}: { targetPos: THREE.Vector3; settling: boolean }) => {
  const { camera } = useThree();
  const startTime = useRef<number | null>(null);
  const startPos = useRef(camera.position.clone());
  const startFov = useRef((camera as THREE.PerspectiveCamera).fov);

  useEffect(() => {
    startTime.current = null;
    startPos.current = camera.position.clone();
    startFov.current = (camera as THREE.PerspectiveCamera).fov;
  }, [targetPos]);

  useFrame(({ clock }) => {
    if (!settling) return;
    if (startTime.current === null) startTime.current = clock.getElapsedTime();
    const t = Math.min((clock.getElapsedTime() - startTime.current) / 1.4, 1.0);
    // Emil Kowalski easing: cubic-bezier(0.22, 1, 0.36, 1)
    const e = 1 - Math.pow(1 - t, 4); 
    
    // Position
    camera.position.lerpVectors(startPos.current, targetPos, e);
    camera.lookAt(targetPos.x, targetPos.y, targetPos.z - 12);
    
    // Gentle FOV settle: no punch, no wobble. Camera does a single clean dolly.
    const pCam = camera as THREE.PerspectiveCamera;
    const fovTarget = (typeof window !== 'undefined' && window.innerWidth <= 768) ? 70 : 50;
    pCam.fov = THREE.MathUtils.lerp(startFov.current, fovTarget, e);
    pCam.updateProjectionMatrix();
  });

  return null;
};

interface HoveredGalaxy { id: string; pos: THREE.Vector3 }

// Wrapper to share state between the canvas and the DOM
const GalaxyScene = ({ activeTripId, trips, onSelectTrip, uiPaused, hoveredStar, onStarHover, onStarClick, tripBalances, selectedMemberId, onSelectedStarPosUpdate }: {
  activeTripId: string | null;
  trips: Trip[];
  onSelectTrip: (t: Trip) => void;
  uiPaused: boolean;
  hoveredStar: string | null;
  onStarHover: (id: string | null) => void;
  onStarClick: (id: string | null) => void;
  tripBalances: Record<string, { settled: boolean, netBalances: { owes: string, owed: string, amtOwes: number, amtOwed: number } | null }>;
  selectedMemberId?: string | null;
  onSelectedStarPosUpdate?: (pos: { x: number, y: number } | null) => void;
}) => {
  const hoveredGalaxy = null as HoveredGalaxy | null; // phase 2: hover state
  const [settling, setSettling] = useState(false);
  const [settled, setSettled] = useState(false);
  const targetPos = useRef(new THREE.Vector3(0, 16, 36));

  // Determine camera target
  useEffect(() => {
    if (activeTripId) {
      const activeTripIndex = trips.findIndex(t => t.id === activeTripId);
      const angle = (activeTripIndex / Math.max(trips.length, 1)) * Math.PI * 2;
      const isPhone = typeof window !== 'undefined' && window.innerWidth <= 768;
      const r = isPhone ? Math.max(5, 3.4 + trips.length * 0.75) : Math.max(6.5, 5 + trips.length * 1.0);
      const pos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      // Phones use a wider field of view (set in CameraAnimator and on the Canvas), so a gentle
      // pull-back frames the whole constellation without the user pinch-zooming out.
      targetPos.current = isPhone
        ? new THREE.Vector3(pos.x, pos.y + 4, pos.z + 14)
        : new THREE.Vector3(pos.x, pos.y + 4, pos.z + 12);
      setSettling(true); setSettled(false);
      const t = setTimeout(() => { setSettling(false); setSettled(true); }, 1400);
      return () => clearTimeout(t);
    } else {
      const isPhone = typeof window !== 'undefined' && window.innerWidth <= 768;
      // Phones frame all galaxies inside the smaller viewport (wider fov + gentle pull-back).
      targetPos.current = isPhone ? new THREE.Vector3(0, 7, 26) : new THREE.Vector3(0, 6, 16);
      setSettling(true); setSettled(false);
      const t = setTimeout(() => { setSettling(false); setSettled(true); }, 1400);
      return () => clearTimeout(t);
    }
  }, [activeTripId, trips]);

  // Trip positions on a ring
  const tripPositions = useMemo(() => {
    return trips.map((trip, idx) => {
      const angle = (idx / Math.max(trips.length, 1)) * Math.PI * 2;
      const isPhone = typeof window !== 'undefined' && window.innerWidth <= 768;
      const r = isPhone ? Math.max(5, 3.4 + trips.length * 0.75) : Math.max(6.5, 5 + trips.length * 1.0);
      return {
        trip,
        pos: new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r),
        cols: tripColor(trip.id),
      };
    });
  }, [trips]);

  return (
    <>
      {!activeTripId && <fog attach="fog" args={['#02050a', 60, 140]} />}
      <ambientLight intensity={activeTripId ? 0.04 : 0.08} />

      <OrbitControls
        makeDefault
        enablePan={false} enableRotate enableZoom
        enableDamping dampingFactor={0.06}
        autoRotate={!activeTripId && !uiPaused} autoRotateSpeed={0.3}
        minDistance={4} maxDistance={typeof window !== 'undefined' && window.innerWidth <= 768 ? 70 : 140}
      />

      {/* Camera fly-in: only runs during settle window */}
      <CameraAnimator targetPos={targetPos.current} settling={settling && !settled} />

      <BackgroundStarfield activeTripId={activeTripId} settled={settled} />

      <ErrorBoundary fallback={null}>
        {activeTripId && (
          /* ── Micro View: constellation fades in ── */
          <LiveDebtConstellation
            activeTripId={activeTripId}
            hoveredStar={hoveredStar}
            onStarHover={onStarHover}
            onStarClick={onStarClick}
            selectedMemberId={selectedMemberId}
            onSelectedStarPosUpdate={onSelectedStarPosUpdate}
            settling={settling && !settled}
          />
        )}
        
        {/* ── Macro View: galaxy ring fades out when activeTripId is set ── */}
        {!(activeTripId && settled) && tripPositions.map(({ trip, pos, cols }, idx) => {
          const bal = tripBalances[trip.id] || { settled: false, netBalances: null };
          return (
            <SwirlingGalaxy
              key={trip.id}
              index={idx}
              position={pos}
              colorCoreStr={cols.core}
              colorEdgeStr={cols.edge}
              name={trip.name}
              hovered={hoveredGalaxy?.id === trip.id}
              selected={activeTripId === trip.id}
              hidden={activeTripId !== null}
              onClick={() => { AudioService.playBlip(); onSelectTrip(trip); }}
              settled={bal.settled}
              netBalances={bal.netBalances}
            />
          );
        })}
      </ErrorBoundary>

      <EffectComposer>
        <Bloom 
          luminanceThreshold={0.34} 
          mipmapBlur 
          luminanceSmoothing={0.9} 
          intensity={(typeof window !== 'undefined' && window.innerWidth <= 768) ? 0.28 : 0.40} 
        />
      </EffectComposer>
    </>
  );
};

// ─── DOM fallback ─────────────────────────────────────────────────────────────
const CosmosFallback = ({ trips, onSelectTrip }: { trips: Trip[]; onSelectTrip?: (t: Trip) => void }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
    {trips.map(t => (
      <button key={t.id} onClick={() => onSelectTrip?.(t)} style={{
        background: 'rgba(156,174,169,0.1)', border: '1px solid rgba(156,174,169,0.25)',
        color: '#f8f9fa', borderRadius: '12px', padding: '12px 24px',
        fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
      }}>✦ {t.name}</button>
    ))}
  </div>
);

interface GBProps {
  trips: Trip[];
  activeTripId: string | null;
  onSelectTrip: (t: Trip) => void;
  uiPaused: boolean;
  hoveredStar: string | null;
  onStarHover: (id: string | null) => void;
  onStarClick: (id: string | null) => void;
  selectedMemberId?: string | null;
  onSelectedStarPosUpdate?: (pos: { x: number, y: number } | null) => void;
}

export const GalaxyBackground = ({ trips, activeTripId, onSelectTrip, uiPaused, hoveredStar, onStarHover, onStarClick, selectedMemberId, onSelectedStarPosUpdate }: GBProps) => {
  const expenses = useExpense();
  const splits = useExpenseSplit();
  const allUsers = useUser();
  const userDevices = useUserDevice();
  const localId = norm(StDB.getLocalId() ?? '');

  // Calculate net balances per trip
  const tripBalances = useMemo(() => {
    const m = resolveNames(allUsers, userDevices);

    const res: Record<string, { settled: boolean, netBalances: { owes: string, owed: string, amtOwes: number, amtOwed: number } | null }> = {};
    trips.forEach(trip => {
      const tripExp = expenses.filter(e => e.tripId === trip.id);
      const owes = buildOwesMap(tripExp, splits);
      const netUser: Record<string, number> = {};

      tripExp.forEach(exp => {
        const payer = norm(exp.payerId);
        splits.filter(s => s.expenseId === exp.id).forEach(s => {
          const debtor = norm(s.debtorId);
          netUser[payer] = (netUser[payer] || 0) + s.amountOwed;
          netUser[debtor] = (netUser[debtor] || 0) - s.amountOwed;
        });
      });

      let settled = true;
      for (const val of Object.values(netUser)) {
        if (Math.abs(val) > 0.5) settled = false;
      }

      if (settled) {
        res[trip.id] = { settled: true, netBalances: null };
      } else {
        // Find biggest pairwise balance for local user
        let amtOwed = 0; let owedBy = '';
        let amtOwes = 0; let owesTo = '';
        
        Object.keys(netUser).forEach(otherId => {
          if (otherId === localId) return;
          const amt = pairNet(owes, localId, otherId);
          if (amt > 0.5 && amt > amtOwed) { amtOwed = amt; owedBy = m.get(otherId) || 'Member'; }
          if (amt < -0.5 && Math.abs(amt) > amtOwes) { amtOwes = Math.abs(amt); owesTo = m.get(otherId) || 'Member'; }
        });
        
        res[trip.id] = { settled: false, netBalances: (amtOwed > 0 || amtOwes > 0) ? { owes: owesTo, owed: owedBy, amtOwes, amtOwed } : null };
      }
    });
    return res;
  }, [trips, expenses, splits, allUsers, userDevices, localId]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0, background: '#020508',
      // Never block pointer events at the wrapper level; let Canvas handle them
    }}>
      <ErrorBoundary fallback={<CosmosFallback trips={trips} onSelectTrip={onSelectTrip} />}>
        <Canvas
          camera={{ position: (typeof window !== 'undefined' && window.innerWidth <= 768) ? [0, 11, 36] : [0, 11, 27], fov: (typeof window !== 'undefined' && window.innerWidth <= 768) ? 70 : 50 }}
          dpr={[1, 1.5]}
          frameloop={uiPaused ? 'never' : 'always'}
          style={{ pointerEvents: uiPaused ? 'none' : 'all' }}
        >
          <Preload all />
          <GalaxyScene
            activeTripId={activeTripId}
            trips={trips}
            onSelectTrip={onSelectTrip}
            uiPaused={uiPaused}
            hoveredStar={hoveredStar}
            onStarHover={onStarHover}
            onStarClick={onStarClick}
            selectedMemberId={selectedMemberId}
            onSelectedStarPosUpdate={onSelectedStarPosUpdate}
            tripBalances={tripBalances}
          />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
};
