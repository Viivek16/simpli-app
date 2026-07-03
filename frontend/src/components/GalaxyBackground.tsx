import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';


const PARTICLE_COUNT = 5000;

const SwirlingGalaxy = () => {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const p = new Float32Array(PARTICLE_COUNT * 3);
    const c = new Float32Array(PARTICLE_COUNT * 3);

    const colorCore = new THREE.Color('#b14bf4');
    const colorEdge = new THREE.Color('#0a192f');
    const tempColor = new THREE.Color();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const radius = Math.random() * 25 + 2;
      const spinAngle = radius * 0.5;
      const branchAngle = ((i % 3) * Math.PI * 2) / 3;
      
      const randomX = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 3;
      const randomY = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 3;
      const randomZ = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 3;

      p[i * 3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
      p[i * 3 + 1] = randomY; // flattened spiral
      p[i * 3 + 2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

      // Color mapping: Core is purple, edges are dark blue
      const intensity = Math.max(0, 1 - radius / 27);
      tempColor.lerpColors(colorEdge, colorCore, Math.pow(intensity, 1.5));
      c[i * 3] = tempColor.r;
      c[i * 3 + 1] = tempColor.g;
      c[i * 3 + 2] = tempColor.b;
    }
    return { positions: p, colors: c };
  }, []);

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y += 0.001; // Slow continuous spin
    }
  });

  return (
    <Points ref={ref} positions={positions} colors={colors} stride={3} frustumCulled={false}>
      <PointMaterial 
        transparent 
        vertexColors 
        size={0.12} 
        sizeAttenuation={true} 
        depthWrite={false} 
        opacity={0.8} 
        blending={THREE.AdditiveBlending} 
        toneMapped={false}
      />
    </Points>
  );
};

const CameraAnimator = ({ isZoomed }: { isZoomed: boolean }) => {
  const targetZ = isZoomed ? 2 : 30;
  const targetY = isZoomed ? 1 : 15;
  const targetX = isZoomed ? 0 : 0;
  const lookAtTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  useFrame((state, delta) => {
    state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, targetZ, 4, delta);
    state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, targetY, 4, delta);
    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, targetX, 4, delta);
    state.camera.lookAt(lookAtTarget);
  });

  return null;
};

interface Props {
  activeTripId: string | null;
}

export const GalaxyBackground = ({ activeTripId }: Props) => {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#02050a' }}>
      <Canvas camera={{ position: [0, 15, 30], fov: 60 }}>
        <fog attach="fog" args={['#02050a', 10, 40]} />
        <SwirlingGalaxy />
        <CameraAnimator isZoomed={!!activeTripId} />
        <EffectComposer>
          <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} height={300} intensity={1.5} />
        </EffectComposer>
      </Canvas>
    </div>
  );
};
