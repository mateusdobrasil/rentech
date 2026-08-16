"use client";

// ============================================================================
// VISUALIZAÇÃO 3D — desenho leve (sem texturas/HDR) da estrutura montada,
// usando react-three-fiber. Carregado via next/dynamic({ ssr: false }) a
// partir de page.tsx, então este módulo só roda no navegador.
// ============================================================================
import { useMemo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import type { TrussGeometry3D, LivreGeometry3D, Vec3 } from './geometry3d';
import { NODE_META, AUTO_CONEXAO_META, type NoAcessorio } from './livre-meta';

function computeBounds(points: Vec3[]): { center: Vec3; radius: number } {
  if (points.length === 0) return { center: [0, 0, 0], radius: 3 };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(0.6, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  return { center, radius };
}

function Bar({ a, b, thickness, color, opacity = 1 }: { a: Vec3; b: Vec3; thickness: number; color: string; opacity?: number }) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = Math.max(dir.length(), 0.001);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    return { position: mid, quaternion, length: len };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a[0], a[1], a[2], b[0], b[1], b[2]]);

  return (
    <mesh position={position} quaternion={quaternion}>
      <boxGeometry args={[thickness, thickness, length]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Scene({ center, radius, children }: { center: Vec3; radius: number; children: ReactNode }) {
  const dist = radius * 2.0 + 1.2;
  return (
    <Canvas
      camera={{ position: [center[0] + dist * 0.75, center[1] + dist * 0.6, center[2] + dist * 0.75], fov: 40, near: 0.05, far: dist * 30 }}
      dpr={[1, 1.75]}
    >
      <color attach="background" args={['#F1F5F9']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[center[0] + radius * 3, center[1] + radius * 4, center[2] + radius * 2]} intensity={1.1} />
      <directionalLight position={[center[0] - radius * 3, center[1] + radius * 1.5, center[2] - radius * 3]} intensity={0.35} />
      <Grid
        position={[center[0], Math.min(0, center[1] - radius) - 0.01, center[2]]}
        args={[radius * 8, radius * 8]}
        cellColor="#CBD5E1"
        sectionColor="#94A3B8"
        sectionThickness={1}
        cellThickness={0.5}
        fadeDistance={radius * 10}
        infiniteGrid
      />
      {children}
      <OrbitControls target={center} minDistance={radius * 0.5} maxDistance={radius * 8} makeDefault />
    </Canvas>
  );
}

export function MontadorTruss3D({ geometry, ladoM }: { geometry: TrussGeometry3D; ladoM: number }) {
  const { center, radius } = useMemo(
    () => computeBounds([...geometry.chords.flatMap(s => [s.a, s.b]), ...geometry.frames.flatMap(s => [s.a, s.b])]),
    [geometry]
  );
  const chordThickness = ladoM * 0.22;
  const diagThickness = ladoM * 0.1;
  const jointSize = ladoM * 0.34;

  return (
    <Scene center={center} radius={radius}>
      {geometry.chords.map((s, i) => <Bar key={`c${i}`} a={s.a} b={s.b} thickness={chordThickness} color="#0C1D4D" />)}
      {geometry.frames.map((s, i) => <Bar key={`f${i}`} a={s.a} b={s.b} thickness={chordThickness} color="#0C1D4D" />)}
      {geometry.diagonals.map((s, i) => <Bar key={`d${i}`} a={s.a} b={s.b} thickness={diagThickness} color="#336699" opacity={0.85} />)}
      {geometry.joints.map((p, i) => (
        <mesh key={`j${i}`} position={p}>
          <boxGeometry args={[jointSize, jointSize, jointSize]} />
          <meshStandardMaterial color="#0C1D4D" roughness={0.4} metalness={0.2} />
        </mesh>
      ))}
    </Scene>
  );
}

export function LivreTruss3D({ geometry, ladoM }: { geometry: LivreGeometry3D; ladoM: number }) {
  const { center, radius } = useMemo(
    () => computeBounds([
      ...geometry.bars.flatMap(s => [s.a, s.b]),
      ...geometry.diagonals.flatMap(s => [s.a, s.b]),
      ...geometry.cubos,
      ...geometry.sleeves,
      ...geometry.acessorios.map(a => a.pos),
    ]),
    [geometry]
  );
  const barThickness = ladoM * 0.9;
  const diagThickness = ladoM * 0.35;

  return (
    <Scene center={center} radius={radius}>
      {geometry.bars.map((s, i) => <Bar key={`b${i}`} a={s.a} b={s.b} thickness={barThickness} color="#0C1D4D" />)}
      {geometry.diagonals.map((s, i) => <Bar key={`d${i}`} a={s.a} b={s.b} thickness={diagThickness} color="#336699" opacity={0.85} />)}
      {geometry.cubos.map((p, i) => (
        <mesh key={`cu${i}`} position={p}>
          <boxGeometry args={[ladoM * 1.1, ladoM * 1.1, ladoM * 1.1]} />
          <meshStandardMaterial color={AUTO_CONEXAO_META.cubo.cor} roughness={0.4} metalness={0.2} />
        </mesh>
      ))}
      {geometry.sleeves.map((p, i) => (
        <mesh key={`sl${i}`} position={p}>
          <boxGeometry args={[ladoM * 0.8, ladoM * 0.8, ladoM * 0.8]} />
          <meshStandardMaterial color={AUTO_CONEXAO_META.sleeve.cor} roughness={0.4} metalness={0.2} />
        </mesh>
      ))}
      {geometry.acessorios.map((a, i) => (
        <mesh key={`ac${i}`} position={a.pos}>
          <sphereGeometry args={[ladoM * 0.7, 16, 16]} />
          <meshStandardMaterial color={NODE_META[a.tipo as NoAcessorio]?.cor ?? '#94A3B8'} roughness={0.4} metalness={0.1} />
        </mesh>
      ))}
    </Scene>
  );
}
