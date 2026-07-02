import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';


const PARTICLE_COUNT = 5000;

const SwirlingGalaxy = () => {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const p = new Float32Array(PARTICLE_COUNT * 3);
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
    }
    return p;
  }, []);

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y += 0.001; // Slow continuous spin
    }
  });

  return (
    <Points ref={ref} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial transparent color="#9caca9" size={0.08} sizeAttenuation={true} depthWrite={false} opacity={0.6} blending={THREE.AdditiveBlending} />
    </Points>
  );
};

const CameraAnimator = ({ isZoomed }: { isZoomed: boolean }) => {
  // We'll animate a Three.js camera position based on isZoomed using Framer Motion 3D logic manually,
  // or use @react-three/fiber's useFrame with standard easing.
  // Using useFrame and standard lerp is usually more robust in R3F.
  
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#050505' }}>
      <Canvas camera={{ position: [0, 15, 30], fov: 60 }}>
        <fog attach="fog" args={['#050505', 10, 40]} />
        <SwirlingGalaxy />
        <CameraAnimator isZoomed={!!activeTripId} />
      </Canvas>
    </div>
  );
};
