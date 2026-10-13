"use client";

// ============================================================================
// CALL TIME — o montador
//
// Boneco feito das mesmas formas geométricas que desenham o truss e os
// gabinetes: capacete amarelo, colete laranja com faixa refletiva, calça
// escura. Não tenta parecer gente de verdade — é maquete viva, e por isso não
// briga com o resto da cena nem pesa na TV do estande.
//
// Ele não decide nada. Quem decide é a cena de cada posto, que enfileira
// passos num roteiro ("vai até a pilha, pega um gabinete, leva até ali,
// trabalha um segundo"). O boneco só anda, sobe escada e faz a pose. Tudo em
// useFrame, mexendo em refs: andar não re-renderiza nada.
//
// E a regra mais importante: a animação nunca segura o jogo. O clique custa o
// minuto na hora; o boneco vai fazendo o trabalho em seguida.
// ============================================================================

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type Pose = 'parado' | 'trabalhando' | 'puxando' | 'escada';

export type Passo = {
  /** Onde ele tem que estar: chão é y = 0; na escada, y é a altura dos pés. */
  ate: [number, number, number];
  /** O que ele faz quando chega. */
  pose: Pose;
  /** Segundos fazendo a pose antes do próximo passo. */
  espera: number;
  /** Vai carregando um gabinete até chegar. */
  carrega?: boolean;
  /** Sobe numa escada até a altura de `ate`, em vez de andar no chão. */
  escada?: boolean;
  /** Para onde olha quando chega, no plano do chão (x, z). */
  olha?: [number, number];
};

export type Roteiro = {
  fila: Passo[];
  passo: Passo | null;
  /** Para onde volta quando a fila acaba. */
  base: Passo;
  pos: THREE.Vector3;
  rumo: number;
  chegouEm: number | null;
  /** Base da escada em uso — ela fica de pé até ele descer. */
  escadaEm: [number, number] | null;
  alturaEscada: number;
};

export function criarRoteiro(base: Passo): Roteiro {
  return {
    fila: [],
    passo: null,
    base,
    pos: new THREE.Vector3(...base.ate),
    rumo: base.olha ? Math.atan2(base.olha[0] - base.ate[0], base.olha[1] - base.ate[2]) : 0,
    chegouEm: null,
    escadaEm: null,
    alturaEscada: 0,
  };
}

/** Enfileira trabalho. Urgente (a talha, a vistoria) passa na frente de tudo. */
export function mandar(r: Roteiro, passos: Passo[], urgente = false) {
  if (urgente) {
    r.fila = [...passos];
    r.passo = null;
    r.chegouEm = null;
  } else {
    r.fila.push(...passos);
  }
}

/** Muda o lugar para onde ele volta quando não tem nada a fazer. */
export function mudarBase(r: Roteiro, base: Passo) {
  r.base = base;
}

/** Quantos passos ainda faltam — para a cena dar trabalho a quem está livre. */
export const ocupacao = (r: Roteiro) => r.fila.length + (r.passo ? 1 : 0);

// --- medidas do boneco, em metros: 1,75 m de altura ------------------------
const QUADRIL = 0.86;
const OMBRO = 1.42;
const VELOCIDADE = 2.6;   // m/s andando
const SUBIDA = 1.3;       // m/s na escada

const COR_COLETE = '#E0712F';
const COR_FAIXA = '#D9DEE8';
const COR_CALCA = '#1E2433';
const COR_PELE = '#C99A78';
const COR_CAPACETE = '#F2C230';
const COR_GABINETE = '#336699';

export function Montador({
  roteiro, reduzirMovimento = false, capacete = COR_CAPACETE,
}: {
  roteiro: Roteiro;
  reduzirMovimento?: boolean;
  /** Branco para o encarregado, amarelo para montador — como na obra. */
  capacete?: string;
}) {
  const corpo = useRef<THREE.Group>(null);
  const tronco = useRef<THREE.Group>(null);
  const bracoE = useRef<THREE.Group>(null);
  const bracoD = useRef<THREE.Group>(null);
  const pernaE = useRef<THREE.Group>(null);
  const pernaD = useRef<THREE.Group>(null);
  const caixa = useRef<THREE.Mesh>(null);
  const escada = useRef<THREE.Group>(null);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const q = avancar(roteiro, t, dt, reduzirMovimento);

    const g = corpo.current;
    if (g) {
      g.position.copy(q.pos);
      g.rotation.y = q.rumo;
    }

    const e = escada.current;
    if (e) {
      e.visible = q.escadaEm !== null;
      if (q.escadaEm) {
        e.position.set(q.escadaEm[0], 0, q.escadaEm[1] - 0.32);
        e.scale.y = Math.max(1, q.alturaEscada);
      }
    }

    if (caixa.current) caixa.current.visible = q.carregando;

    const parado = reduzirMovimento;
    const onda = (f: number, fase = 0) => (parado ? 0 : Math.sin(t * f + fase));
    let be = 0, bd = 0, pe = 0, pd = 0, inclina = 0, baixa = 0;
    const pose = q.pose;

    if (pose === 'andando') {
      pe = onda(9) * 0.6;
      pd = -pe;
      if (q.carregando) { be = -1.25; bd = -1.25; }
      else { be = -pe * 0.8; bd = pe * 0.8; }
    } else if (pose === 'trabalhando') {
      inclina = 0.42;
      baixa = 0.16;
      be = -1.05 + onda(7) * 0.28;
      bd = -1.05 + onda(7, Math.PI) * 0.28;
      pe = -0.35; pd = 0.15;
    } else if (pose === 'puxando') {
      // as duas mãos na corrente da talha, uma descendo enquanto a outra sobe
      inclina = -0.12;
      baixa = 0.03 + onda(5) * 0.03;
      be = -2.75 + onda(5) * 0.4;
      bd = -2.75 + onda(5, Math.PI) * 0.4;
    } else if (pose === 'escada') {
      be = -2.35 + onda(6) * 0.3;
      bd = -2.35 + onda(6, Math.PI) * 0.3;
      pe = onda(6) * 0.45;
      pd = -pe;
    } else {
      baixa = onda(1.6) * 0.008;
    }

    if (tronco.current) {
      tronco.current.rotation.x = inclina;
      tronco.current.position.y = QUADRIL - baixa;
    }
    if (bracoE.current) bracoE.current.rotation.x = be;
    if (bracoD.current) bracoD.current.rotation.x = bd;
    if (pernaE.current) pernaE.current.rotation.x = pe;
    if (pernaD.current) pernaD.current.rotation.x = pd;
  });

  return (
    <>
      <group ref={corpo}>
        {/* pernas: o pivô é o quadril */}
        <group ref={pernaE} position={[-0.11, QUADRIL, 0]}>
          <mesh position={[0, -0.42, 0]}>
            <boxGeometry args={[0.15, 0.84, 0.17]} />
            <meshStandardMaterial color={COR_CALCA} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.82, 0.05]}>
            <boxGeometry args={[0.16, 0.08, 0.27]} />
            <meshStandardMaterial color="#111" roughness={0.9} />
          </mesh>
        </group>
        <group ref={pernaD} position={[0.11, QUADRIL, 0]}>
          <mesh position={[0, -0.42, 0]}>
            <boxGeometry args={[0.15, 0.84, 0.17]} />
            <meshStandardMaterial color={COR_CALCA} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.82, 0.05]}>
            <boxGeometry args={[0.16, 0.08, 0.27]} />
            <meshStandardMaterial color="#111" roughness={0.9} />
          </mesh>
        </group>

        {/* tronco: inclina para trabalhar, com braços e cabeça junto */}
        <group ref={tronco} position={[0, QUADRIL, 0]}>
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[0.44, 0.6, 0.26]} />
            <meshStandardMaterial color={COR_COLETE} roughness={0.6} />
          </mesh>
          {/* faixa refletiva do colete */}
          <mesh position={[0, 0.22, 0.135]}>
            <boxGeometry args={[0.45, 0.06, 0.01]} />
            <meshStandardMaterial color={COR_FAIXA} emissive={COR_FAIXA} emissiveIntensity={0.35} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.22, -0.135]}>
            <boxGeometry args={[0.45, 0.06, 0.01]} />
            <meshStandardMaterial color={COR_FAIXA} emissive={COR_FAIXA} emissiveIntensity={0.35} roughness={0.3} />
          </mesh>

          {/* cabeça e capacete */}
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.125, 16, 12]} />
            <meshStandardMaterial color={COR_PELE} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.84, 0]}>
            <sphereGeometry args={[0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={capacete} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.84, 0.04]}>
            <cylinderGeometry args={[0.17, 0.17, 0.02, 18]} />
            <meshStandardMaterial color={capacete} roughness={0.35} />
          </mesh>

          {/* braços: o pivô é o ombro */}
          <group ref={bracoE} position={[-0.29, OMBRO - QUADRIL, 0]}>
            <mesh position={[0, -0.29, 0]}>
              <boxGeometry args={[0.12, 0.58, 0.13]} />
              <meshStandardMaterial color={COR_COLETE} roughness={0.6} />
            </mesh>
            <mesh position={[0, -0.6, 0]}>
              <sphereGeometry args={[0.06, 10, 8]} />
              <meshStandardMaterial color={COR_PELE} roughness={0.7} />
            </mesh>
          </group>
          <group ref={bracoD} position={[0.29, OMBRO - QUADRIL, 0]}>
            <mesh position={[0, -0.29, 0]}>
              <boxGeometry args={[0.12, 0.58, 0.13]} />
              <meshStandardMaterial color={COR_COLETE} roughness={0.6} />
            </mesh>
            <mesh position={[0, -0.6, 0]}>
              <sphereGeometry args={[0.06, 10, 8]} />
              <meshStandardMaterial color={COR_PELE} roughness={0.7} />
            </mesh>
          </group>

          {/* o gabinete que ele leva, nas duas mãos, à frente do peito */}
          <mesh ref={caixa} position={[0, 0.2, 0.42]} visible={false}>
            <boxGeometry args={[0.5, 0.5, 0.09]} />
            <meshStandardMaterial color={COR_GABINETE} roughness={0.5} metalness={0.2} />
          </mesh>
        </group>
      </group>

      {/* a escada é dele: aparece onde ele vai subir */}
      <group ref={escada} visible={false}>
        <EscadaUnitaria />
      </group>
    </>
  );
}

/** Escada de 1 m de altura; a cena escala na vertical até onde ele precisa. */
function EscadaUnitaria() {
  return (
    <group>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.5, 0]}>
          <boxGeometry args={[0.05, 1, 0.05]} />
          <meshStandardMaterial color="#A9B4C6" roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
      {Array.from({ length: 4 }, (_, k) => (
        <mesh key={k} position={[0, 0.15 + k * 0.24, 0]}>
          <boxGeometry args={[0.44, 0.03, 0.04]} />
          <meshStandardMaterial color="#A9B4C6" roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/** A pilha de cases de onde saem os gabinetes. */
export function PilhaDeCases({ posicao }: { posicao: [number, number, number] }) {
  const cases: [number, number, number][] = [
    [0, 0.35, 0], [0.78, 0.35, 0.05], [0.05, 1.05, 0.02], [0.4, 0.35, 0.82],
  ];
  return (
    <group position={posicao}>
      {cases.map((p, k) => (
        <group key={k} position={p}>
          <mesh>
            <boxGeometry args={[0.72, 0.7, 0.72]} />
            <meshStandardMaterial color="#141B2A" roughness={0.75} />
          </mesh>
          {/* cantoneiras de alumínio, que é o que faz um case parecer case */}
          {[-0.36, 0.36].map((x) => [-0.36, 0.36].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0, z]}>
              <boxGeometry args={[0.04, 0.72, 0.04]} />
              <meshStandardMaterial color="#8C97AB" roughness={0.35} metalness={0.7} />
            </mesh>
          )))}
        </group>
      ))}
    </group>
  );
}

export type Quadro = {
  pos: THREE.Vector3;
  rumo: number;
  pose: Pose | 'andando';
  carregando: boolean;
  escadaEm: [number, number] | null;
  alturaEscada: number;
};

/**
 * Um quadro na vida do montador: anda, sobe, espera, passa ao próximo passo.
 * Fica fora do componente porque é aqui que o roteiro muda — e o componente
 * não pode mexer no que recebe por prop. De quebra, roda em node para teste.
 */
export function avancar(r: Roteiro, t: number, dt: number, instantaneo = false): Quadro {
  const passo = (r.passo ??= r.fila.shift() ?? null);
  const meta = passo ?? r.base;
  const [ax, ay, az] = meta.ate;

  const dx = ax - r.pos.x;
  const dz = az - r.pos.z;
  const plano = Math.hypot(dx, dz);
  let movimento: 'andando' | 'subindo' | 'chegou' = 'chegou';
  const passoAndar = instantaneo ? Infinity : VELOCIDADE * dt;
  const passoSubir = instantaneo ? Infinity : SUBIDA * dt;

  if (instantaneo) {
    // quem pediu menos movimento vê o montador já no lugar, fazendo o trabalho
    r.pos.set(ax, meta.escada ? ay : 0, az);
  } else if (!meta.escada && r.pos.y > 0.01) {
    // está na escada e o próximo trabalho é no chão: desce primeiro
    r.pos.y = Math.max(0, r.pos.y - passoSubir);
    movimento = 'subindo';
  } else if (plano > 0.04) {
    const k = Math.min(1, passoAndar / plano);
    r.pos.x += dx * k;
    r.pos.z += dz * k;
    r.rumo = suavizarAngulo(r.rumo, Math.atan2(dx, dz), instantaneo ? 1 : Math.min(1, dt * 10));
    movimento = 'andando';
  } else if (meta.escada && Math.abs(ay - r.pos.y) > 0.02) {
    r.pos.y += Math.sign(ay - r.pos.y) * Math.min(Math.abs(ay - r.pos.y), passoSubir);
    movimento = 'subindo';
  }

  // a escada aparece quando ele vai subir e some depois que desceu
  if (meta.escada && plano <= 0.04) {
    r.escadaEm = [ax, az];
    r.alturaEscada = Math.max(r.alturaEscada, ay + 1.3);
  } else if (r.pos.y <= 0.01 && !meta.escada) {
    r.escadaEm = null;
    r.alturaEscada = 0;
  }

  if (movimento === 'chegou') {
    if (meta.olha) {
      const alvoRumo = Math.atan2(meta.olha[0] - r.pos.x, meta.olha[1] - r.pos.z);
      r.rumo = suavizarAngulo(r.rumo, alvoRumo, instantaneo ? 1 : Math.min(1, dt * 6));
    }
    if (passo) {
      if (r.chegouEm === null) r.chegouEm = t;
      if (t - r.chegouEm >= passo.espera) {
        r.passo = null;
        r.chegouEm = null;
      }
    }
  } else {
    r.chegouEm = null;
  }

  return {
    pos: r.pos,
    rumo: r.rumo,
    pose: movimento === 'andando' ? 'andando' : movimento === 'subindo' ? 'escada' : meta.pose,
    carregando: !!passo?.carrega && movimento !== 'chegou',
    escadaEm: r.escadaEm,
    alturaEscada: r.alturaEscada,
  };
}

function suavizarAngulo(atual: number, alvo: number, k: number) {
  let d = alvo - atual;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return atual + d * k;
}
