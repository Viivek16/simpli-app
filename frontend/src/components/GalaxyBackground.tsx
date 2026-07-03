import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial, OrbitControls, Html } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { LiveDebtConstellation } from './LiveDebtConstellation';
import { useTrip } from '../App';
import type { Trip } from '../App';

const PARTICLE_COUNT = 2500; // reduced per galaxy to maintain performance with multiple galaxies

const SwirlingGalaxy = ({ position, colorCoreStr, colorEdgeStr, onClick, name, isMicroView }: { position: THREE.Vector3, colorCoreStr: string, colorEdgeStr: string, onClick?: () => void, name?: string, isMicroView?: boolean }) => {
  const ref = useRef<THREE.Points>(null);
  const [hovered, setHovered] = useState(false);

  const { positions, colors } = useMemo(() => {
    const p = new Float32Array(PARTICLE_COUNT * 3);
    const c = new Float32Array(PARTICLE_COUNT * 3);

    const colorCore = new THREE.Color(colorCoreStr);
    const colorEdge = new THREE.Color(colorEdgeStr);
    const tempColor = new THREE.Color();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Create a tighter cluster for individual trip galaxies
      const radius = Math.random() * 15 + 1;
      const spinAngle = radius * 0.8;
      const branchAngle = ((i % 3) * Math.PI * 2) / 3;
      
      const randomX = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 2;
      const randomY = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 2;
      const randomZ = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 2;

      p[i * 3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
      p[i * 3 + 1] = randomY; 
      p[i * 3 + 2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

      const intensity = Math.max(0, 1 - radius / 18);
      tempColor.lerpColors(colorEdge, colorCore, Math.pow(intensity, 1.5));
      c[i * 3] = tempColor.r;
      c[i * 3 + 1] = tempColor.g;
      c[i * 3 + 2] = tempColor.b;
    }
    return { positions: p, colors: c };
  }, [colorCoreStr, colorEdgeStr]);

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y += 0.001; 
      if (hovered) {
        ref.current.rotation.y += 0.002; // spin faster on hover
      }
    }
  });

  return (
    <group position={position}>
      <Points 
        ref={ref} positions={positions} colors={colors} stride={3} frustumCulled={false}
        onClick={(e) => {
          if (onClick) {
            e.stopPropagation();
            onClick();
          }
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <PointMaterial 
          transparent 
          vertexColors 
          size={isMicroView ? 0.05 : (hovered ? 0.2 : 0.12)} 
          sizeAttenuation={true} 
          depthWrite={false} 
          opacity={isMicroView ? 0.35 : 0.8} 
          blending={THREE.AdditiveBlending} 
          toneMapped={false}
        />
      </Points>
      
      {name && (
        <Html center distanceFactor={15} style={{ pointerEvents: 'none' }}>
          <div style={{
            color: '#fff',
            fontWeight: 800,
            fontSize: '1.2rem',
            textShadow: '0 2px 10px rgba(0,0,0,1)',
            opacity: hovered ? 1 : 0.7,
            transition: 'opacity 0.2s',
            whiteSpace: 'nowrap',
            marginTop: '40px'
          }}>
            {name}
          </div>
        </Html>
      )}
    </group>
  );
};

const CameraAnimator = ({ activeTripId }: { activeTripId: string | null }) => {
  useFrame((state, delta) => {
    const controls = state.controls as any;
    if (activeTripId) {
      // Zoom in to Micro View
      state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, 8, 4, delta);
      state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, 4, 4, delta);
      state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, 0, 4, delta);
      if (controls && controls.target) {
        controls.target.x = THREE.MathUtils.damp(controls.target.x, 0, 4, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, 0, 4, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, 0, 4, delta);
      }
    } else {
      // Zoom out to Macro View
      state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, 40, 4, delta);
      state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, 20, 4, delta);
      state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, 0, 4, delta);
      if (controls && controls.target) {
        controls.target.x = THREE.MathUtils.damp(controls.target.x, 0, 4, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, 0, 4, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, 0, 4, delta);
      }
    }
    // Do not call lookAt when OrbitControls is active, it causes fighting
  });

  return null;
};

interface Props {
  activeTripId: string | null;
  onSelectTrip?: (trip: Trip) => void;
}

export const GalaxyBackground = ({ activeTripId, onSelectTrip }: Props) => {
  const trips = useTrip();

  // Distinct colors for different galaxies in Macro View
  const palette = [
    { core: '#b14bf4', edge: '#0a192f' }, // Purple / Blue
    { core: '#ff8c00', edge: '#4a1500' }, // Orange / Dark Red
    { core: '#00ffff', edge: '#002244' }, // Cyan / Dark Blue
    { core: '#39ff14', edge: '#003300' }, // Neon Green / Dark Green
    { core: '#ff007f', edge: '#33001a' }, // Pink / Dark Red
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#02050a' }}>
      <Canvas camera={{ position: [0, 20, 40], fov: 60 }}>
        <fog attach="fog" args={['#02050a', 10, 80]} />
        
        <OrbitControls enablePan={true} enableRotate={true} enableZoom={true} makeDefault autoRotate autoRotateSpeed={0.5} />

        <CameraAnimator activeTripId={activeTripId} />

        {activeTripId ? (
          // MICRO VIEW: Render only the active trip's galaxy at the center
          <SwirlingGalaxy 
            position={new THREE.Vector3(0, -3, -10)} 
            colorCoreStr="#b14bf4" 
            colorEdgeStr="#0a192f"
            isMicroView={true}
          />
        ) : (
          // MACRO VIEW: Render all trips as distinct galaxies
          trips.length > 0 ? (
            trips.map((trip, idx) => {
              // Position them in a circle or spiral
              const radius = 25;
              const angle = (idx / trips.length) * Math.PI * 2;
              const x = Math.cos(angle) * radius;
              const z = Math.sin(angle) * radius;
              const colors = palette[idx % palette.length];

              return (
                <SwirlingGalaxy 
                  key={trip.id}
                  position={new THREE.Vector3(x, 0, z)}
                  colorCoreStr={colors.core}
                  colorEdgeStr={colors.edge}
                  name={trip.name}
                  onClick={() => onSelectTrip?.(trip)}
                />
              );
            })
          ) : (
            // Empty state fallback (no trips)
            <SwirlingGalaxy 
              position={new THREE.Vector3(0, 0, 0)} 
              colorCoreStr="#555555" 
              colorEdgeStr="#111111" 
            />
          )
        )}

        {/* Constellations only visible in Micro View */}
        {activeTripId && <LiveDebtConstellation activeTripId={activeTripId} />}

        <EffectComposer>
          <Bloom luminanceThreshold={0.7} mipmapBlur luminanceSmoothing={0.9} intensity={1.1} />
          <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={new THREE.Vector2(0.0005, 0.0005)} radialModulation={false} modulationOffset={0} />
          <Vignette eskil={false} offset={0.1} darkness={1.1} />
        </EffectComposer>
      </Canvas>
    </div>
  );
};
