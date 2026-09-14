"use client";

// ============================================================================
// CALL TIME — Fase 4: o PA em 3D
//
// Carregado via next/dynamic({ ssr: false }). O que esta cena precisa mostrar,
// e que nenhuma planta 2D mostra, é o ângulo: cada caixa aparece inclinada
// pela soma dos ângulos das caixas acima dela, e o leque de cobertura desenha
// no chão até onde aquele lado alcança. Quem angula errado vê o buraco.
// ============================================================================

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  FILAS,
  POSICOES_MAX,
  caixasDoLado,
  filaDe,
  posicaoDe,
  type EstadoSom,
  type TipoCaixa,
} from './motor';
import { COR_CABO, CORES_CIRCUITO, COR_SEM_CABO, COR_POSICAO_VAZIA } from '../cores';

export type CamadaSom = 'pa' | 'cobertura' | 'amplificacao';

// --- dimensões da cena, em metros -------------------------------------------

const ALTURA_PA = 7.5;          // bumper do line array no ar
const ALTURA_CHAO = 1.2;        // line array ainda empilhado no chão
const X_LADO = [-5.5, 5.5];     // esquerdo, direito
const Z_PA = 1.5;               // à frente do palco
const ALTURA_CAIXA = 0.38;
const DURACAO_ICAMENTO = 2.4;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const rad = (graus: number) => (graus * Math.PI) / 180;

const COR_CAIXA = '#2C3E63';
const COR_SUB = '#3E4E7A';

/** Onde cada posição está no mundo, já com o PA no ar ou no chão. */
export function posicaoMundo(e: EstadoSom, i: number): [number, number, number] {
  const fila = filaDe(i);
  const p = posicaoDe(i);
  if (FILAS[fila].id === 'subs') return [-2.8 + p * 1.1, 0.45, Z_PA + 1.6];
  const topo = e.icado ? ALTURA_PA : ALTURA_CHAO;
  return [X_LADO[fila], topo - p * ALTURA_CAIXA, Z_PA];
}

/** Inclinação de cada caixa: a soma dos ângulos das caixas acima dela. */
function inclinacoes(e: EstadoSom, fila: number): Map<number, number> {
  const lista = caixasDoLado(e, fila);
  const fora = new Map<number, number>();
  let acumulado = 0;
  for (const i of lista) {
    fora.set(i, acumulado);
    acumulado += e.celulas[i].angulo ?? 0;
  }
  return fora;
}

// ---------------------------------------------------------------------------
// As caixas
// ---------------------------------------------------------------------------

type CaixaProps = {
  tipo: TipoCaixa;
  cor: string;
  inclinacao: number;
  destacado: boolean;
  alerta: boolean;
  posicao: [number, number, number];
  paraTras: boolean;
  /** PA aprovado: o cone respira no compasso da passagem. */
  festa: boolean;
  fase: number;
  onClick: () => void;
};

const Caixa = memo(function Caixa({
  tipo, cor, inclinacao, destacado, alerta, posicao, paraTras, festa, fase, onClick,
}: CaixaProps) {
  const largura = tipo === 'caixa' ? 1.05 : 1.2;
  const altura = tipo === 'caixa' ? ALTURA_CAIXA * 0.86 : 0.85;
  const fundo = tipo === 'caixa' ? 0.7 : 1.0;
  const cone = useRef<THREE.Mesh>(null);
  const frente = useRef<THREE.MeshStandardMaterial>(null);

  // O sub bate no tempo forte e a caixa acompanha mais miúdo: é só o cone
  // andando para fora, que é o que se vê de perto num PA tocando.
  useFrame(({ clock }) => {
    const c = cone.current;
    if (!c) return;
    if (!festa) { c.position.z = fundo / 2 + 0.02; if (frente.current) frente.current.emissiveIntensity = 0; return; }
    const t = clock.elapsedTime;
    const compasso = tipo === 'sub' ? 2.2 : 4.4;
    const batida = Math.pow(Math.max(0, Math.sin(t * compasso + fase)), 4);
    c.position.z = fundo / 2 + 0.02 + batida * (tipo === 'sub' ? 0.07 : 0.03);
    if (frente.current) frente.current.emissiveIntensity = batida * (tipo === 'sub' ? 0.5 : 0.3);
  });

  return (
    <group
      position={posicao}
      rotation={[rad(inclinacao), paraTras ? Math.PI : 0, 0]}
    >
      <mesh
        castShadow
        onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      >
        <boxGeometry args={[largura, altura, fundo]} />
        <meshStandardMaterial
          color={cor}
          roughness={0.6}
          metalness={0.15}
          emissive={destacado ? '#FFFFFF' : alerta ? COR_SEM_CABO : '#000000'}
          emissiveIntensity={destacado ? 0.45 : alerta ? 0.35 : 0}
        />
      </mesh>
      {/* frente da caixa: é por onde o som sai, e marca para onde ela aponta */}
      <mesh ref={cone} position={[0, 0, fundo / 2 + 0.02]}>
        <boxGeometry args={[largura * 0.9, altura * 0.75, 0.04]} />
        <meshStandardMaterial ref={frente} color="#0A0F1A" roughness={0.95} emissive="#4E93D8" emissiveIntensity={0} />
      </mesh>
    </group>
  );
});

/** Posição vazia: onde ainda cabe caixa. */
const Vaga = memo(function Vaga({ posicao, destacado, onClick }: {
  posicao: [number, number, number];
  destacado: boolean;
  onClick: () => void;
}) {
  return (
    <mesh position={posicao} onClick={(ev) => { ev.stopPropagation(); onClick(); }}>
      <boxGeometry args={[0.9, 0.06, 0.6]} />
      <meshStandardMaterial color={destacado ? '#2C3E63' : COR_POSICAO_VAZIA} roughness={0.9} transparent opacity={0.8} />
    </mesh>
  );
});

/** O leque de cobertura de um lado, desenhado no ar até o chão. */
function Leque({ x, topo, graus, ok }: { x: number; topo: number; graus: number; ok: boolean }) {
  if (graus <= 0) return null;
  const comprimento = 26;

  return (
    <mesh position={[x, topo - 0.2, Z_PA + comprimento / 2]} rotation={[rad(graus / 2 + 6), 0, 0]}>
      <coneGeometry args={[Math.max(0.6, comprimento * Math.tan(rad(graus)) / 2), comprimento, 20, 1, true]} />
      <meshBasicMaterial
        color={ok ? '#4E93D8' : '#E0912F'}
        transparent
        opacity={0.07}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// O PA inteiro, com a subida
// ---------------------------------------------------------------------------

function Sistema({
  estado, camada, selecionadas, foco, festa, onPintar,
}: {
  estado: EstadoSom;
  camada: CamadaSom;
  selecionadas: Set<number>;
  foco: Foco | null;
  festa: boolean;
  onPintar: (i: number) => void;
}) {
  const lados = useRef<THREE.Group>(null);
  const inicio = useRef<number | null>(null);
  const jaIcado = useRef(estado.icado);

  useEffect(() => {
    if (estado.icado && !jaIcado.current) inicio.current = null;
    jaIcado.current = estado.icado;
  }, [estado.icado]);

  useFrame(({ clock }) => {
    const g = lados.current;
    if (!g) return;
    if (!estado.icado) { g.position.y = 0; return; }
    if (inicio.current === null) inicio.current = clock.elapsedTime;
    const t = clamp01((clock.elapsedTime - inicio.current) / DURACAO_ICAMENTO);
    g.position.y = (ALTURA_PA - ALTURA_CHAO) * ease(t) - (ALTURA_PA - ALTURA_CHAO);
  });

  const emFoco = foco ? new Set(foco.celulas) : null;
  const inclinacao = [inclinacoes(estado, 0), inclinacoes(estado, 1)];

  const cor = (i: number): string => {
    const c = estado.celulas[i];
    if (camada === 'amplificacao') {
      return c.canal === null ? COR_POSICAO_VAZIA : CORES_CIRCUITO[(c.canal - 1) % CORES_CIRCUITO.length];
    }
    if (camada === 'cobertura' && c.caixa === 'caixa') {
      return c.angulo === null ? COR_POSICAO_VAZIA : `hsl(${210 - (c.angulo ?? 0) * 22}, 60%, ${38 + (c.angulo ?? 0) * 4}%)`;
    }
    if (c.caixa === 'caixa' && !c.caboAco) return COR_SEM_CABO;
    if (c.noAr) return '#8A5A22';
    return c.caixa === 'sub' ? COR_SUB : COR_CAIXA;
  };

  const posicaoLocal = (i: number): [number, number, number] => {
    const fila = filaDe(i);
    const p = posicaoDe(i);
    if (FILAS[fila].id === 'subs') return [-2.8 + p * 1.1, 0.45, Z_PA + 1.6];
    return [X_LADO[fila], ALTURA_PA - p * ALTURA_CAIXA, Z_PA];
  };

  const somaLado = (fila: number) =>
    caixasDoLado(estado, fila).reduce((n, i) => n + (estado.celulas[i].angulo ?? 0), 0);

  return (
    <>
      {/* palco */}
      <mesh position={[0, 0.5, -1.6]} receiveShadow>
        <boxGeometry args={[14, 1, 6]} />
        <meshStandardMaterial color="#0B1120" roughness={0.95} />
      </mesh>

      {/* subs ficam no chão, então não sobem com o PA */}
      {estado.celulas.map((c, i) => {
        if (FILAS[filaDe(i)].id !== 'subs') return null;
        const pos = posicaoLocal(i);
        if (!c.caixa) {
          return <Vaga key={i} posicao={pos} destacado={selecionadas.has(i)} onClick={() => onPintar(i)} />;
        }
        return (
          <Caixa
            key={i}
            tipo={c.caixa}
            cor={cor(i)}
            inclinacao={0}
            paraTras={estado.arranjo === 'cardioide' && posicaoDe(i) % 3 === 1}
            destacado={selecionadas.has(i)}
            alerta={emFoco ? emFoco.has(i) : false}
            posicao={pos}
            festa={festa}
            fase={posicaoDe(i) * 0.35}
            onClick={() => onPintar(i)}
          />
        );
      })}

      <group ref={lados} position={[0, -(ALTURA_PA - ALTURA_CHAO), 0]}>
        {[0, 1].map((fila) => (
          <group key={fila}>
            {/* bumper: de onde o array pendura */}
            <mesh position={[X_LADO[fila], ALTURA_PA + 0.35, Z_PA]}>
              <boxGeometry args={[1.2, 0.18, 0.8]} />
              <meshStandardMaterial color={COR_CABO} roughness={0.6} metalness={0.3} />
            </mesh>

            {Array.from({ length: POSICOES_MAX }, (_, p) => {
              const i = fila * POSICOES_MAX + p;
              const c = estado.celulas[i];
              const pos = posicaoLocal(i);
              if (!c.caixa) {
                return <Vaga key={i} posicao={pos} destacado={selecionadas.has(i)} onClick={() => onPintar(i)} />;
              }
              return (
                <Caixa
                  key={i}
                  tipo={c.caixa}
                  cor={cor(i)}
                  inclinacao={inclinacao[fila].get(i) ?? 0}
                  paraTras={false}
                  destacado={selecionadas.has(i)}
                  alerta={emFoco ? emFoco.has(i) : false}
                  posicao={pos}
                  festa={festa}
                  fase={p * 0.5 + fila * 1.3}
                  onClick={() => onPintar(i)}
                />
              );
            })}

            {estado.icado && (
              <Leque
                x={X_LADO[fila]}
                topo={ALTURA_PA}
                graus={somaLado(fila)}
                ok={Math.abs(somaLado(fila) - estado.briefing.coberturaGraus) <= 2}
              />
            )}
          </group>
        ))}
      </group>

      {/* torre de delay, lá no fundo da plateia */}
      <group position={[0, 0, Z_PA + estado.briefing.torreM]}>
        <mesh position={[0, 1.6, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 3.2, 8]} />
          <meshStandardMaterial color={COR_CABO} roughness={0.8} />
        </mesh>
        <mesh position={[0, 3.4, 0]} rotation={[0, Math.PI, 0]}>
          <boxGeometry args={[0.9, 0.8, 0.6]} />
          <meshStandardMaterial
            color={estado.delayMs === null ? COR_POSICAO_VAZIA : COR_CAIXA}
            roughness={0.7}
          />
        </mesh>
        <Html position={[0, 4.3, 0]} center distanceFactor={26} zIndexRange={[5, 0]}>
          <div className="px-2 py-0.5 rounded border border-[#284B8C]/60 bg-black/80 text-[10px] font-black uppercase tracking-wider text-white/70 whitespace-nowrap">
            Torre · {estado.briefing.torreM} m
            {estado.delayMs !== null && ` · ${estado.delayMs} ms`}
          </div>
        </Html>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Câmera
// ---------------------------------------------------------------------------

export type Foco = {
  celulas: number[];
  curto: string;
  tipo: 'reprovacao' | 'tempo' | 'qualidade';
};

function centroide(e: EstadoSom, celulas: number[]): [number, number, number] {
  if (celulas.length === 0) return [0, e.icado ? 5 : 2, Z_PA + 2];
  const soma = celulas.reduce(
    (acc, i) => {
      const p = posicaoMundo(e, i);
      return [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]] as [number, number, number];
    },
    [0, 0, 0] as [number, number, number],
  );
  return [soma[0] / celulas.length, soma[1] / celulas.length, soma[2] / celulas.length];
}

function CameraVistoria({ estado, foco, orbitar }: { estado: EstadoSom; foco: Foco | null; orbitar: boolean }) {
  const { camera } = useThree();
  const alvo = useRef(new THREE.Vector3(0, 4, 0));
  const destino = useRef(new THREE.Vector3(0, 6, 20));

  useEffect(() => {
    if (orbitar) return;
    if (!foco) {
      alvo.current.set(0, estado.icado ? 5 : 2, Z_PA);
      destino.current.set(1.5, estado.icado ? 6.5 : 4, Z_PA + 19);
      return;
    }
    const c = centroide(estado, foco.celulas);
    alvo.current.set(...c);
    destino.current.set(c[0] * 0.5, c[1] + 1.2, c[2] + 8);
  }, [estado, foco, orbitar]);

  useFrame((_, delta) => {
    if (orbitar) return;
    const passo = Math.min(1, delta * 1.8);
    camera.position.lerp(destino.current, passo);
    camera.lookAt(alvo.current);
  });

  return null;
}

function EtiquetaProblema({ estado, foco }: { estado: EstadoSom; foco: Foco }) {
  const p = centroide(estado, foco.celulas);
  const cor = foco.tipo === 'reprovacao' ? 'border-red-500 bg-red-950/90 text-red-100'
    : foco.tipo === 'tempo' ? 'border-amber-500 bg-amber-950/90 text-amber-100'
    : 'border-[#4E93D8] bg-[#0C1D4D]/90 text-white';

  return (
    <Html position={[p[0], p[1] + 1.2, p[2]]} center distanceFactor={16} zIndexRange={[10, 0]}>
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

export default function Som3D({
  estado,
  camada,
  onPintar,
  selecionadas = VAZIO,
  foco = null,
  orbitar = false,
  vistoriando = false,
  festa = false,
}: {
  estado: EstadoSom;
  camada: CamadaSom;
  onPintar: (i: number) => void;
  selecionadas?: Set<number>;
  foco?: Foco | null;
  orbitar?: boolean;
  vistoriando?: boolean;
  /** Passagem limpa: o PA toca em vez de ficar parado. */
  festa?: boolean;
}) {
  const semAnimacao = useSyncExternalStore(assinarMovimento, lerMovimento, semMovimento);
  const [pronto, setPronto] = useState(false);
  const pintar = useCallback((i: number) => onPintar(i), [onPintar]);

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{ position: [1.5, 6, 22], fov: 42 }}
        onCreated={() => setPronto(true)}
        frameloop={semAnimacao && !vistoriando && !festa ? 'demand' : 'always'}
      >
        <color attach="background" args={['#06080C']} />
        <fog attach="fog" args={['#06080C', 24, 70]} />

        <ambientLight intensity={0.35} />
        <directionalLight position={[6, 14, 10]} intensity={0.8} castShadow />
        <directionalLight position={[-8, 6, -4]} intensity={0.25} color="#4E93D8" />

        <Grid
          position={[0, 0, 0]}
          args={[80, 80]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#131C31"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#1C2740"
          fadeDistance={70}
          infiniteGrid
        />

        <Sistema
          estado={estado}
          camada={camada}
          selecionadas={selecionadas}
          foco={foco}
          festa={festa}
          onPintar={pintar}
        />

        {foco && <EtiquetaProblema estado={estado} foco={foco} />}
        <CameraVistoria estado={estado} foco={foco} orbitar={orbitar} />
        {orbitar && <OrbitControls makeDefault target={[0, 4, Z_PA + 4]} enablePan={false} />}
      </Canvas>

      {!pronto && (
        <div className="absolute inset-0 grid place-items-center text-[10px] font-black uppercase tracking-widest text-white/30">
          Montando o galpão…
        </div>
      )}
    </div>
  );
}
