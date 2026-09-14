"use client";

// ============================================================================
// CALL TIME — Fase 4: o grid de luz em 3D
//
// Carregado via next/dynamic({ ssr: false }), então este módulo só roda no
// navegador. Mesma linguagem visual do palco do LED: galpão escuro, truss do
// simulador de boxtruss e a câmera que passeia pelos problemas na vistoria.
//
// A diferença é o que acende. Peça com energia E endereço joga feixe no chão;
// peça sem uma das duas fica apagada, que é exatamente o que o técnico vai
// ver na passagem se errar a conta.
// ============================================================================

import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { buildVaoGeometry3D, type Seg3D } from '../../simulador/boxtruss/geometry3d';
import {
  ESPACO_GARRA_M,
  POSICOES_MAX,
  VARAS,
  VARA_M,
  posicaoDe,
  varaDe,
  type EstadoLuz,
  type TipoPeca,
} from './motor';
import {
  COR_TRUSS, COR_CABO, COR_MOVING, COR_PAR, COR_PECA_AR, COR_SEM_CABO, COR_POSICAO_VAZIA,
  corCircuito, corUniverso,
} from '../cores';

export type CamadaLuz = 'grid' | 'dmx' | 'energia';

// --- dimensões da cena, em metros -------------------------------------------

const LADO_TRUSS = 0.3;                 // Q30
const ALTURA_GRID = 6;                  // altura de trabalho do grid içado
const Y_DEITADO = 0.35;                 // truss no chão, sobre os cavaletes
const Z_VARA = [1.6, -1.6];             // frontal à frente do palco, contra atrás
const DURACAO_ICAMENTO = 2.4;           // segundos
/** Cada movimento da cena dura isto antes de virar para o próximo. */
const DURACAO_MOVIMENTO = 5;

const juntas = (comprimentoM: number) => {
  const pecas: number[] = [];
  let resta = comprimentoM;
  while (resta > 3.001) { pecas.push(3); resta -= 3; }
  if (resta > 0.01) pecas.push(Math.round(resta * 2) / 2);
  return pecas.length ? pecas : [comprimentoM];
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Posição de uma garra na vara, no eixo X. */
const garraX = (posicao: number) =>
  -VARA_M / 2 + ESPACO_GARRA_M / 2 + posicao * ESPACO_GARRA_M;

export function posicaoMundo(e: EstadoLuz, i: number): [number, number, number] {
  const y = (e.icado ? ALTURA_GRID : Y_DEITADO) - 0.45;
  return [garraX(posicaoDe(i)), y, Z_VARA[varaDe(i)]];
}

// ---------------------------------------------------------------------------
// Truss: as barras das duas varas num InstancedMesh só.
// ---------------------------------------------------------------------------

function Barras({ segs, espessura, cor }: { segs: Seg3D[]; espessura: number; cor: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const molde = new THREE.Object3D();
    const eixoZ = new THREE.Vector3(0, 0, 1);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();

    segs.forEach((s, i) => {
      a.set(...s.a);
      b.set(...s.b);
      dir.subVectors(b, a);
      const comprimento = Math.max(dir.length(), 0.001);
      molde.position.copy(a).add(b).multiplyScalar(0.5);
      molde.quaternion.setFromUnitVectors(eixoZ, dir.normalize());
      molde.scale.set(espessura, espessura, comprimento);
      molde.updateMatrix();
      mesh.setMatrixAt(i, molde.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [segs, espessura]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, segs.length]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={cor} roughness={0.5} metalness={0.25} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// As peças
// ---------------------------------------------------------------------------

/** Cor da peça conforme a camada em que o técnico está trabalhando. */
function corDaPeca(
  camada: CamadaLuz,
  peca: TipoPeca,
  celula: { noAr: boolean; caboAco: boolean; universo: number | null; circuito: number | null },
): string {
  if (camada === 'dmx') return celula.universo === null ? COR_POSICAO_VAZIA : corUniverso(celula.universo);
  if (camada === 'energia') return celula.circuito === null ? COR_POSICAO_VAZIA : corCircuito(celula.circuito);
  if (!celula.caboAco) return COR_SEM_CABO;
  if (celula.noAr) return COR_PECA_AR;
  return peca === 'moving' ? COR_MOVING : COR_PAR;
}

type PecaProps = {
  tipo: TipoPeca;
  cor: string;
  acesa: boolean;
  destacado: boolean;
  alerta: boolean;
  posicao: [number, number, number];
  /** Grid aprovado: o moving varre, o par pulsa, e a cena vira show. */
  festa: boolean;
  /** Posição da peça na vara e quantas há nela: é o que faz a corrida correr. */
  ordem: number;
  total: number;
  onClick: () => void;
  onEnter: () => void;
};

const Peca = memo(function Peca({ tipo, cor, acesa, destacado, alerta, posicao, festa, ordem, total, onClick, onEnter }: PecaProps) {
  const alturaCorpo = tipo === 'moving' ? 0.42 : 0.24;
  const raio = tipo === 'moving' ? 0.12 : 0.14;
  const cabeca = useRef<THREE.Group>(null);
  const feixe = useRef<THREE.MeshBasicMaterial>(null);
  const lente = useRef<THREE.MeshStandardMaterial>(null);

  // A cena é uma sequência, não um balanço só: quatro movimentos de 5 s que
  // se revezam, do jeito que um operador programa cena de show. O tempo vem
  // do relógio da cena, então as peças entram juntas sem combinar nada.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = cabeca.current;

    if (!festa) {
      if (g) { g.rotation.z = 0; g.rotation.x = 0; }
      if (feixe.current) {
        feixe.current.opacity = tipo === 'moving' ? 0.14 : 0.09;
        feixe.current.color.set(tipo === 'moving' ? '#BFD8FF' : '#FFE2A8');
      }
      if (lente.current) lente.current.emissiveIntensity = 1.4;
      return;
    }

    const movimento = Math.floor(t / DURACAO_MOVIMENTO) % 4;
    const dentro = (t % DURACAO_MOVIMENTO) / DURACAO_MOVIMENTO;   // 0 a 1
    const lado = ordem % 2 === 0 ? 1 : -1;

    let pan = 0, tilt = 0, brilho = 0.5, matiz = (t * 0.05) % 1, satura = 0.6;

    if (movimento === 0) {
      // leque: as peças abrem para fora, uma atrás da outra
      pan = Math.sin(t * 1.0 + ordem * 0.45) * 0.55;
      tilt = Math.sin(t * 0.6 + ordem * 0.3) * 0.22 - 0.1;
      brilho = 0.55 + 0.45 * Math.abs(Math.sin(t * 1.6 + ordem * 0.4));
      matiz = (0.55 + ordem * 0.015 + t * 0.02) % 1;
    } else if (movimento === 1) {
      // corrida: acende uma de cada vez, ida e volta pela vara
      const cabeçote = (dentro * 2 % 1) * total;
      const distancia = Math.abs(ordem - (dentro < 0.5 ? cabeçote : total - cabeçote));
      brilho = Math.max(0.06, 1 - distancia * 0.8);
      pan = lado * 0.35;
      tilt = -0.12;
      matiz = (0.08 + ordem * 0.02) % 1;
      satura = 0.75;
    } else if (movimento === 2) {
      // cruzada: metade das peças vai para um lado, metade para o outro
      pan = lado * (0.2 + 0.45 * Math.sin(t * 1.4));
      tilt = Math.sin(t * 1.1) * 0.2 - 0.05;
      brilho = 0.5 + 0.5 * Math.pow(Math.max(0, Math.sin(t * 3.0)), 2);
      matiz = (0.75 + Math.sin(t * 0.4) * 0.12) % 1;
      satura = 0.7;
    } else {
      // batida cheia: todo mundo junto, no tempo forte, virando a cor
      const pulso = Math.pow(Math.max(0, Math.sin(t * 3.2)), 6);
      pan = Math.sin(t * 0.5 + ordem * 0.2) * 0.18;
      tilt = -0.16;
      brilho = 0.25 + 0.95 * pulso;
      matiz = (Math.floor(t * 1.6) * 0.17) % 1;
      satura = 0.8;
    }

    if (g) {
      // o par não tem cabeça móvel: fica firme e só muda de cor e brilho
      g.rotation.z = tipo === 'moving' ? pan : 0;
      g.rotation.x = tipo === 'moving' ? tilt : 0;
    }
    if (feixe.current) {
      feixe.current.opacity = (tipo === 'moving' ? 0.26 : 0.16) * brilho;
      feixe.current.color.setHSL(matiz, tipo === 'moving' ? satura : satura * 0.55, 0.72);
    }
    if (lente.current) lente.current.emissiveIntensity = 0.8 + brilho * 2.2;
  });

  return (
    <group position={posicao}>
      {/* garra e pescoço */}
      <mesh position={[0, alturaCorpo / 2 + 0.16, 0]}>
        <boxGeometry args={[0.08, 0.32, 0.08]} />
        <meshStandardMaterial color={COR_CABO} roughness={0.7} />
      </mesh>

      <mesh
        castShadow
        onClick={(ev) => { ev.stopPropagation(); onClick(); }}
        onPointerEnter={(ev) => { ev.stopPropagation(); onEnter(); }}
      >
        {tipo === 'moving'
          ? <boxGeometry args={[0.26, alturaCorpo, 0.26]} />
          : <cylinderGeometry args={[raio, raio, alturaCorpo, 12]} />}
        <meshStandardMaterial
          color={cor}
          roughness={0.45}
          metalness={0.3}
          emissive={destacado ? '#FFFFFF' : alerta ? COR_SEM_CABO : '#000000'}
          emissiveIntensity={destacado ? 0.5 : alerta ? 0.35 : 0}
        />
      </mesh>

      {/* lente e feixe: giram juntos, que é como a cabeça móvel trabalha */}
      <group ref={cabeca}>
        <mesh position={[0, -alturaCorpo / 2 - 0.02, 0]}>
          <cylinderGeometry args={[raio * 0.8, raio * 0.8, 0.05, 12]} />
          <meshStandardMaterial
            ref={lente}
            color={acesa ? '#FFF3D6' : '#0A0F1A'}
            emissive={acesa ? '#FFE2A8' : '#000000'}
            emissiveIntensity={acesa ? 1.4 : 0}
          />
        </mesh>

        {acesa && (
          <mesh position={[0, -2.6, 0]}>
            <coneGeometry args={[tipo === 'moving' ? 0.5 : 0.8, 5, 16, 1, true]} />
            <meshBasicMaterial
              ref={feixe}
              color={tipo === 'moving' ? '#BFD8FF' : '#FFE2A8'}
              transparent
              opacity={tipo === 'moving' ? 0.14 : 0.09}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
    </group>
  );
});

/** Garra vazia: marca onde ainda cabe peça. */
const Vaga = memo(function Vaga({ posicao, onClick, onEnter, destacado }: {
  posicao: [number, number, number];
  onClick: () => void;
  onEnter: () => void;
  destacado: boolean;
}) {
  return (
    <mesh
      position={posicao}
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      onPointerEnter={(ev) => { ev.stopPropagation(); onEnter(); }}
    >
      <boxGeometry args={[0.2, 0.06, 0.2]} />
      <meshStandardMaterial
        color={destacado ? '#2C3E63' : COR_POSICAO_VAZIA}
        roughness={0.9}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
});

// ---------------------------------------------------------------------------
// O grid inteiro, com a animação de içamento
// ---------------------------------------------------------------------------

function GridDeLuz({
  estado, camada, selecionadas, foco, festa, onPintar, onEntrar,
}: {
  estado: EstadoLuz;
  camada: CamadaLuz;
  selecionadas: Set<number>;
  foco: Foco | null;
  festa: boolean;
  onPintar: (i: number) => void;
  onEntrar: (i: number) => void;
}) {
  const grupo = useRef<THREE.Group>(null);
  const inicio = useRef<number | null>(null);
  const jaIcado = useRef(estado.icado);

  // As duas varas viram um InstancedMesh só: 2 x ~120 barras em uma chamada
  // de desenho, que é o que faz a TV do estande aguentar o arrasto.
  const segs = useMemo<Seg3D[]>(() => {
    const vara = buildVaoGeometry3D(VARA_M, LADO_TRUSS, juntas(VARA_M));
    const barras = [...vara.chords, ...vara.frames, ...vara.diagonals];
    return VARAS.flatMap((_, k) =>
      barras.map((s) => ({
        a: [s.a[0], s.a[1], s.a[2] + Z_VARA[k]] as [number, number, number],
        b: [s.b[0], s.b[1], s.b[2] + Z_VARA[k]] as [number, number, number],
      })),
    );
  }, []);

  // A subida acontece uma vez, quando o estado vira içado.
  useEffect(() => {
    if (estado.icado && !jaIcado.current) inicio.current = null;
    jaIcado.current = estado.icado;
  }, [estado.icado]);

  useFrame(({ clock }) => {
    const g = grupo.current;
    if (!g) return;
    const alvo = estado.icado ? ALTURA_GRID : Y_DEITADO;
    if (!estado.icado) { g.position.y = Y_DEITADO; return; }
    if (inicio.current === null) inicio.current = clock.elapsedTime;
    const t = clamp01((clock.elapsedTime - inicio.current) / DURACAO_ICAMENTO);
    g.position.y = Y_DEITADO + (alvo - Y_DEITADO) * ease(t);
  });

  const emFoco = foco ? new Set(foco.celulas) : null;

  return (
    <group ref={grupo} position={[0, Y_DEITADO, 0]}>
      <Barras segs={segs} espessura={0.055} cor={COR_TRUSS} />

      {estado.celulas.map((c, i) => {
        const pos: [number, number, number] = [garraX(posicaoDe(i)), -0.45, Z_VARA[varaDe(i)]];
        if (!c.peca) {
          return (
            <Vaga
              key={i}
              posicao={pos}
              destacado={selecionadas.has(i)}
              onClick={() => onPintar(i)}
              onEnter={() => onEntrar(i)}
            />
          );
        }
        return (
          <Peca
            key={i}
            tipo={c.peca}
            cor={corDaPeca(camada, c.peca, c)}
            acesa={estado.icado && c.universo !== null && c.circuito !== null}
            destacado={selecionadas.has(i)}
            alerta={emFoco ? emFoco.has(i) : false}
            posicao={pos}
            festa={festa}
            ordem={posicaoDe(i)}
            total={POSICOES_MAX}
            onClick={() => onPintar(i)}
            onEnter={() => onEntrar(i)}
          />
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Câmera: plano aberto durante a montagem, passeio na vistoria
// ---------------------------------------------------------------------------

export type Foco = {
  /** Peças apontadas. Vazio = problema do grid inteiro, então é plano aberto. */
  celulas: number[];
  curto: string;
  tipo: 'reprovacao' | 'tempo' | 'qualidade';
};

function centroide(e: EstadoLuz, celulas: number[]): [number, number, number] {
  if (celulas.length === 0) return [0, e.icado ? ALTURA_GRID : Y_DEITADO, 0];
  const soma = celulas.reduce(
    (acc, i) => {
      const p = posicaoMundo(e, i);
      return [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]] as [number, number, number];
    },
    [0, 0, 0] as [number, number, number],
  );
  return [soma[0] / celulas.length, soma[1] / celulas.length, soma[2] / celulas.length];
}

function CameraVistoria({ estado, foco, orbitar }: { estado: EstadoLuz; foco: Foco | null; orbitar: boolean }) {
  const { camera } = useThree();
  const alvo = useRef(new THREE.Vector3(0, 3, 0));
  const destino = useRef(new THREE.Vector3(9, 6, 12));

  useEffect(() => {
    if (orbitar) return;
    if (!foco) {
      alvo.current.set(0, estado.icado ? ALTURA_GRID - 1.5 : 1, 0);
      destino.current.set(2.5, estado.icado ? ALTURA_GRID + 1 : 3.5, 13);
      return;
    }
    const c = centroide(estado, foco.celulas);
    alvo.current.set(...c);
    destino.current.set(c[0] + 1.2, c[1] + 1.4, c[2] + 5.5);
  }, [estado, foco, orbitar]);

  useFrame((_, delta) => {
    if (orbitar) return;
    const passo = Math.min(1, delta * 1.8);
    camera.position.lerp(destino.current, passo);
    camera.lookAt(alvo.current);
  });

  return null;
}

function EtiquetaProblema({ estado, foco }: { estado: EstadoLuz; foco: Foco }) {
  const p = centroide(estado, foco.celulas);
  const cor = foco.tipo === 'reprovacao' ? 'border-red-500 bg-red-950/90 text-red-100'
    : foco.tipo === 'tempo' ? 'border-amber-500 bg-amber-950/90 text-amber-100'
    : 'border-[#4E93D8] bg-[#0C1D4D]/90 text-white';

  return (
    <Html position={[p[0], p[1] + 1.1, p[2]]} center distanceFactor={12} zIndexRange={[10, 0]}>
      <div className={`px-3 py-1.5 rounded-lg border text-[11px] font-black uppercase tracking-wider whitespace-nowrap ${cor}`}>
        {foco.curto}
      </div>
    </Html>
  );
}

// ---------------------------------------------------------------------------

const VAZIO: Set<number> = new Set();
const CONSULTA_MOVIMENTO = '(prefers-reduced-motion: reduce)';
const assinarMovimento = (avisar: () => void) => {
  const mq = window.matchMedia(CONSULTA_MOVIMENTO);
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
};
const lerMovimento = () => window.matchMedia(CONSULTA_MOVIMENTO).matches;
const semMovimento = () => false;

export default function Grid3D({
  estado,
  camada,
  onPintar,
  onEntrar,
  selecionadas = VAZIO,
  foco = null,
  orbitar = false,
  vistoriando = false,
  festa = false,
}: {
  estado: EstadoLuz;
  camada: CamadaLuz;
  onPintar: (i: number) => void;
  onEntrar?: (i: number) => void;
  selecionadas?: Set<number>;
  foco?: Foco | null;
  orbitar?: boolean;
  vistoriando?: boolean;
  /** Passagem limpa: o grid roda uma cena em vez de ficar parado. */
  festa?: boolean;
}) {
  const semAnimacao = useSyncExternalStore(assinarMovimento, lerMovimento, semMovimento);
  const [pronto, setPronto] = useState(false);
  const entrar = useCallback((i: number) => onEntrar?.(i), [onEntrar]);

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{ position: [2.5, 4, 13], fov: 42 }}
        onCreated={() => setPronto(true)}
        frameloop={semAnimacao && !vistoriando && !festa ? 'demand' : 'always'}
      >
        <color attach="background" args={['#06080C']} />
        <fog attach="fog" args={['#06080C', 18, 46]} />

        <ambientLight intensity={0.35} />
        <directionalLight position={[6, 12, 8]} intensity={0.8} castShadow />
        <directionalLight position={[-8, 6, -6]} intensity={0.25} color="#4E93D8" />

        <Grid
          position={[0, 0, 0]}
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#131C31"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#1C2740"
          fadeDistance={38}
          infiniteGrid
        />

        <GridDeLuz
          estado={estado}
          camada={camada}
          selecionadas={selecionadas}
          foco={foco}
          festa={festa}
          onPintar={onPintar}
          onEntrar={entrar}
        />

        {foco && <EtiquetaProblema estado={estado} foco={foco} />}
        <CameraVistoria estado={estado} foco={foco} orbitar={orbitar} />
        {orbitar && <OrbitControls makeDefault target={[0, estado.icado ? 4 : 1, 0]} enablePan={false} />}
      </Canvas>

      {!pronto && (
        <div className="absolute inset-0 grid place-items-center text-[10px] font-black uppercase tracking-widest text-white/30">
          Montando o galpão…
        </div>
      )}
    </div>
  );
}
