import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial, OrbitControls, Html } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { LiveDebtConstellation } from './LiveDebtConstellation';
import { ErrorBoundary } from './ErrorBoundary';
import { useTrip, type Trip } from '../hooks/useTrips';

const PARTICLE_COUNT = 7500;

const SwirlingGalaxy = ({
  position, colorCoreStr, colorEdgeStr, onClick, name, isMicroView,
}: {
  position: THREE.Vector3; colorCoreStr: string; colorEdgeStr: string;
  onClick?: () => void; name?: string; isMicroView?: boolean;
}) => {
  const ref = useRef<THREE.Points>(null);
  const [hovered, setHovered] = useState(false);

  const { positions, colors } = useMemo(() => {
    const p = new Float32Array(PARTICLE_COUNT * 3);
    const c = new Float32Array(PARTICLE_COUNT * 3);
    const colorCore = new THREE.Color(colorCoreStr);
    const colorEdge = new THREE.Color(colorEdgeStr);
    const tempColor = new THREE.Color();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const radius = Math.random() * 15 + 1;
      const spinAngle = radius * 0.8;
      const branchAngle = ((i % 3) * Math.PI * 2) / 3;
      const rx = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 2;
      const ry = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 2;
      const rz = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 2;
      p[i * 3] = Math.cos(branchAngle + spinAngle) * radius + rx;
      p[i * 3 + 1] = ry;
      p[i * 3 + 2] = Math.sin(branchAngle + spinAngle) * radius + rz;
      const intensity = Math.max(0, 1 - radius / 18);
      tempColor.lerpColors(colorEdge, colorCore, Math.pow(intensity, 1.5));
      c[i * 3] = tempColor.r; c[i * 3 + 1] = tempColor.g; c[i * 3 + 2] = tempColor.b;
    }
    return { positions: p, colors: c };
  }, [colorCoreStr, colorEdgeStr]);

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y += hovered ? 0.003 : 0.001;
    }
  });

  return (
    <group position={position}>
      <Points
        ref={ref} positions={positions} colors={colors} stride={3} frustumCulled={false}
        onClick={(e) => { if (onClick) { e.stopPropagation(); onClick(); } }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <PointMaterial
          transparent vertexColors
          size={isMicroView ? 0.07 : (hovered ? 0.28 : 0.18)}
          sizeAttenuation depthWrite={false}
          opacity={isMicroView ? 0.4 : 1.0}
          blending={THREE.AdditiveBlending} toneMapped={false}
        />
      </Points>
      {name && (
        <Html center distanceFactor={15} style={{ pointerEvents: 'none' }}>
          <div style={{
            color: '#fff', fontWeight: 800, fontSize: '1.15rem',
            textShadow: '0 2px 10px rgba(0,0,0,1)', opacity: hovered ? 1 : 0.75,
            transition: 'opacity 0.2s', whiteSpace: 'nowrap', marginTop: '44px',
            letterSpacing: '-0.01em',
          }}>{name}</div>
        </Html>
      )}
    </group>
  );
};

const CameraAnimator = ({ activeTripId }: { activeTripId: string | null }) => {
  useFrame((state, delta) => {
    const controls = state.controls as any;
    const [tz, ty] = activeTripId ? [8, 4] : [40, 20];
    state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, tz, 4, delta);
    state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, ty, 4, delta);
    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, 0, 4, delta);
    if (controls && controls.target) {
      controls.target.x = THREE.MathUtils.damp(controls.target.x, 0, 4, delta);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, 0, 4, delta);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, 0, 4, delta);
    }
  });
  return null;
};

// DOM fallback shown only if the WebGL scene fails to mount/render. Keeps the
// app fully usable (create + open trips) even without 3D.
const CosmosFallback = ({
  trips, activeTripId, onSelectTrip,
}: {
  trips: Trip[]; activeTripId: string | null; onSelectTrip?: (t: Trip) => void;
}) => {
  if (activeTripId) return <div style={{ position: 'absolute', inset: 0, background: '#02050a' }} />;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#02050a', pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)',
        pointerEvents: 'all', display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '80vw',
      }}>
        {trips.map((t) => (
          <button key={t.id} onClick={() => onSelectTrip?.(t)} style={{
            background: 'radial-gradient(circle, rgba(156,174,169,0.25), rgba(156,174,169,0.05))',
            border: '1px solid rgba(156,174,169,0.35)', color: '#f8f9fa',
            borderRadius: '999px', padding: '12px 22px', fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 0 24px rgba(156,174,169,0.25)', fontFamily: 'inherit',
          }}>✦ {t.name}</button>
        ))}
      </div>
    </div>
  );
};

interface Props {
  activeTripId: string | null;
  onSelectTrip?: (trip: Trip) => void;
}

const PALETTE = [
  { core: '#b14bf4', edge: '#0a192f' },
  { core: '#ff8c00', edge: '#4a1500' },
  { core: '#22d3ee', edge: '#002244' },
  { core: '#39ff14', edge: '#003300' },
  { core: '#ff007f', edge: '#33001a' },
];

export const GalaxyBackground = ({ activeTripId, onSelectTrip }: Props) => {
  const trips = useTrip();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#02050a', pointerEvents: 'none' }}>
      <ErrorBoundary fallback={<CosmosFallback trips={trips} activeTripId={activeTripId} onSelectTrip={onSelectTrip} />}>
        <Canvas camera={{ position: [0, 20, 40], fov: 60 }} dpr={[1, 2]} style={{ pointerEvents: activeTripId ? 'none' : 'all' }}>
          <fog attach="fog" args={['#02050a', 10, 80]} />
          <ambientLight intensity={0.12} />
          <OrbitControls
            enablePan enableRotate enableZoom makeDefault
            enableDamping dampingFactor={0.08}
            autoRotate autoRotateSpeed={0.4}
            minDistance={4} maxDistance={120}
          />
          <CameraAnimator activeTripId={activeTripId} />

          {/* Scene contents isolated: a render throw here degrades to empty space,
              it does not crash the Canvas or the DOM overlay. */}
          <ErrorBoundary fallback={null}>
            {activeTripId ? (
              <SwirlingGalaxy
                position={new THREE.Vector3(0, -3, -12)}
                colorCoreStr="#b14bf4" colorEdgeStr="#0a192f" isMicroView
              />
            ) : trips.length > 0 ? (
              trips.map((trip, idx) => {
                const angle = (idx / trips.length) * Math.PI * 2;
                const x = Math.cos(angle) * 25;
                const z = Math.sin(angle) * 25;
                const cols = PALETTE[idx % PALETTE.length];
                return (
                  <SwirlingGalaxy
                    key={trip.id}
                    position={new THREE.Vector3(x, 0, z)}
                    colorCoreStr={cols.core} colorEdgeStr={cols.edge}
                    name={trip.name}
                    onClick={() => onSelectTrip?.(trip)}
                  />
                );
              })
            ) : (
              <SwirlingGalaxy
                position={new THREE.Vector3(0, 0, 0)}
                colorCoreStr="#3a3a44" colorEdgeStr="#0d0d14"
              />
            )}

            {activeTripId && <LiveDebtConstellation activeTripId={activeTripId} />}
          </ErrorBoundary>

          <EffectComposer>
            <Bloom luminanceThreshold={0.15} mipmapBlur luminanceSmoothing={0.9} intensity={1.4} />
          </EffectComposer>
        </Canvas>
      </ErrorBoundary>
    </div>
  );
};
