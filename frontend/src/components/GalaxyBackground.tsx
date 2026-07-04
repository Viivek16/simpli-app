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
import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Points, PointMaterial, OrbitControls, Html } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { LiveDebtConstellation } from './LiveDebtConstellation';
import { ErrorBoundary } from './ErrorBoundary';
import { useTrip, type Trip } from '../hooks/useTrips';

// Stable color palette hashed from trip id (Phase 2.1)
const PALETTE = [
  { core: '#b14bf4', edge: '#150028' },
  { core: '#ff8c00', edge: '#2a1400' },
  { core: '#22d3ee', edge: '#001a26' },
  { core: '#39ff14', edge: '#001a00' },
  { core: '#ff007f', edge: '#1a0010' },
  { core: '#ffd700', edge: '#1a1600' },
];

const hashId = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const tripColor = (id: string) => PALETTE[hashId(id) % PALETTE.length];

// ─── Macro galaxy particle cloud ──────────────────────────────────────────────
const PARTICLE_COUNT = 7500;

const SwirlingGalaxy = ({
  position, colorCoreStr, colorEdgeStr, onClick, name, hovered,
}: {
  position: THREE.Vector3; colorCoreStr: string; colorEdgeStr: string;
  onClick?: () => void; name?: string; hovered?: boolean;
}) => {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const p = new Float32Array(PARTICLE_COUNT * 3);
    const c = new Float32Array(PARTICLE_COUNT * 3);
    const colorCore = new THREE.Color(colorCoreStr);
    const colorEdge = new THREE.Color(colorEdgeStr);
    const temp = new THREE.Color();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const radius = Math.random() * 15 + 0.5;
      const spinAngle = radius * 0.9;
      const branchAngle = ((i % 3) * Math.PI * 2) / 3;
      const rx = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 1.5;
      const ry = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 0.8;
      const rz = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 1.5;
      p[i * 3]     = Math.cos(branchAngle + spinAngle) * radius + rx;
      p[i * 3 + 1] = ry;
      p[i * 3 + 2] = Math.sin(branchAngle + spinAngle) * radius + rz;
      const intensity = Math.max(0, 1 - radius / 16);
      temp.lerpColors(colorEdge, colorCore, Math.pow(intensity, 1.5));
      c[i * 3] = temp.r; c[i * 3 + 1] = temp.g; c[i * 3 + 2] = temp.b;
    }
    return { positions: p, colors: c };
  }, [colorCoreStr, colorEdgeStr]);

  // Slow self-rotation — only permitted useFrame work per Rule 7
  useFrame(() => {
    if (ref.current) ref.current.rotation.y += hovered ? 0.004 : 0.0008;
  });

  return (
    <group position={position}>
      <Points
        ref={ref} positions={positions} colors={colors} stride={3} frustumCulled={false}
        onClick={(e) => { if (onClick) { e.stopPropagation(); onClick(); } }}
      >
        <PointMaterial
          transparent vertexColors
          size={hovered ? 0.24 : 0.16}
          sizeAttenuation depthWrite={false}
          opacity={1.0}
          blending={THREE.AdditiveBlending} toneMapped={false}
        />
      </Points>
      {name && (
        <Html center distanceFactor={18} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div style={{
            color: hovered ? '#ffffff' : 'rgba(255,255,255,0.7)',
            fontWeight: 800, fontSize: '1rem',
            textShadow: '0 2px 12px rgba(0,0,0,1)',
            transition: 'color 200ms ease',
            whiteSpace: 'nowrap', marginTop: '40px',
            fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '-0.02em',
          }}>{name}</div>
        </Html>
      )}
    </group>
  );
};

// ─── Camera: fixed 1.2s fly-in, then hands off to OrbitControls ───────────────
const CameraAnimator = ({
  targetPos, settling,
}: { targetPos: THREE.Vector3; settling: boolean }) => {
  const { camera } = useThree();
  const startTime = useRef<number | null>(null);
  const startPos = useRef(camera.position.clone());

  useEffect(() => {
    startTime.current = null;
    startPos.current = camera.position.clone();
  }, [targetPos]);

  useFrame(({ clock }) => {
    if (!settling) return;
    if (startTime.current === null) startTime.current = clock.getElapsedTime();
    const t = Math.min((clock.getElapsedTime() - startTime.current) / 1.2, 1.0);
    // Ease out cubic
    const e = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(startPos.current, targetPos, e);
    camera.lookAt(0, 0, 0);
  });

  return null;
};

interface HoveredGalaxy { id: string; pos: THREE.Vector3 }

interface GalaxyCameraControllerProps {
  activeTripId: string | null;
  trips: Trip[];
  onSelectTrip: (t: Trip) => void;
}

// Wrapper to share state between the canvas and the DOM
const GalaxyScene = ({
  activeTripId, trips, onSelectTrip, uiPaused,
  hoveredStar, onStarHover, onStarClick,
}: GalaxyCameraControllerProps & {
  uiPaused: boolean;
  hoveredStar: string | null;
  onStarHover: (id: string | null) => void;
  onStarClick: (id: string | null) => void;
}) => {
  const hoveredGalaxy = null as HoveredGalaxy | null; // phase 2: hover state
  const [settling, setSettling] = useState(false);
  const [settled, setSettled] = useState(false);
  const targetPos = useRef(new THREE.Vector3(0, 16, 36));

  // Determine camera target
  useEffect(() => {
    if (activeTripId) {
      targetPos.current = new THREE.Vector3(0, 4, 12);
      setSettling(true); setSettled(false);
      const t = setTimeout(() => { setSettling(false); setSettled(true); }, 1300);
      return () => clearTimeout(t);
    } else {
      targetPos.current = new THREE.Vector3(0, 16, 36);
      setSettling(true); setSettled(false);
      const t = setTimeout(() => { setSettling(false); setSettled(true); }, 1300);
      return () => clearTimeout(t);
    }
  }, [activeTripId]);

  // Trip positions on a ring
  const tripPositions = useMemo(() => {
    return trips.map((trip, idx) => {
      const angle = (idx / Math.max(trips.length, 1)) * Math.PI * 2;
      const r = Math.max(22, 16 + trips.length * 2);
      return {
        trip,
        pos: new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r),
        cols: tripColor(trip.id),
      };
    });
  }, [trips]);

  return (
    <>
      <fog attach="fog" args={activeTripId ? ['#02050a', 40, 120] : ['#02050a', 60, 140]} />
      <ambientLight intensity={activeTripId ? 0.04 : 0.08} />

      <OrbitControls
        makeDefault
        enablePan={false} enableRotate enableZoom
        enableDamping dampingFactor={0.06}
        autoRotate={!activeTripId && !uiPaused} autoRotateSpeed={0.3}
        minDistance={3} maxDistance={140}
      />

      {/* Camera fly-in: only runs during settle window */}
      <CameraAnimator targetPos={targetPos.current} settling={settling && !settled} />

      <ErrorBoundary fallback={null}>
        {activeTripId ? (
          /* ── Micro View: no SwirlingGalaxy, no fog close in ── */
          <LiveDebtConstellation
            activeTripId={activeTripId}
            hoveredStar={hoveredStar}
            onStarHover={onStarHover}
            onStarClick={onStarClick}
          />
        ) : (
          /* ── Macro View: galaxy ring ── */
          tripPositions.map(({ trip, pos, cols }) => (
            <SwirlingGalaxy
              key={trip.id}
              position={pos}
              colorCoreStr={cols.core}
              colorEdgeStr={cols.edge}
              name={trip.name}
              hovered={hoveredGalaxy?.id === trip.id}
              onClick={() => onSelectTrip(trip)}
            />
          ))
        )}
      </ErrorBoundary>

      <EffectComposer>
        <Bloom luminanceThreshold={0.08} mipmapBlur luminanceSmoothing={0.9} intensity={activeTripId ? 1.6 : 1.2} />
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
  activeTripId: string | null;
  onSelectTrip: (t: Trip) => void;
  uiPaused: boolean;
  hoveredStar: string | null;
  onStarHover: (id: string | null) => void;
  onStarClick: (id: string | null) => void;
}

export const GalaxyBackground = ({ activeTripId, onSelectTrip, uiPaused, hoveredStar, onStarHover, onStarClick }: GBProps) => {
  const trips = useTrip();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0, background: '#020508',
      // Never block pointer events at the wrapper level; let Canvas handle them
    }}>
      <ErrorBoundary fallback={<CosmosFallback trips={trips} onSelectTrip={onSelectTrip} />}>
        <Canvas
          camera={{ position: [0, 16, 36], fov: 58 }}
          dpr={[1, 1.5]}
          frameloop={uiPaused ? 'never' : 'always'}
          style={{ pointerEvents: uiPaused ? 'none' : 'all' }}
        >
          <GalaxyScene
            activeTripId={activeTripId}
            trips={trips}
            onSelectTrip={onSelectTrip}
            uiPaused={uiPaused}
            hoveredStar={hoveredStar}
            onStarHover={onStarHover}
            onStarClick={onStarClick}
          />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
};
