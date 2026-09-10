"use client";

// ============================================================================
// CALL TIME — Fase 2: o palco em 3D
//
// Carregado via next/dynamic({ ssr: false }) a partir da página, então este
// módulo só roda no navegador.
//
// Reaproveita buildPortalGeometry3D() do simulador de boxtruss — o mesmo
// módulo puro que desenha o portal na aba 3D de /simulador/boxtruss. O que
// muda aqui é a cena: fundo de galpão escuro em vez do fundo claro do
// simulador, gabinetes interativos e a animação de içamento.
// ============================================================================

import { useMemo, useRef, useState, useCallback, useLayoutEffect, useEffect, useSyncExternalStore, memo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { buildPortalGeometry3D, type Seg3D } from '../../simulador/boxtruss/geometry3d';
import {
  COLUNAS_MAX,
  LINHAS_MAX,
  MODULO_M,
  celulaAtiva,
  colunaDe,
  linhaDe,
  gabinetesPedidos,
  medidasM,
  type Estado,
} from './motor';
import {
  COR_GABINETE,
  COR_GABINETE_AR,
  COR_SEM_ATRIBUICAO,
  COR_VAZIO,
  COR_TRUSS,
  COR_DIAGONAL,
  COR_CABO,
  corCircuito,
  corPorta,
} from './cores';

export type Camada = 'estrutura' | 'energia' | 'sinal';

// --- dimensões do palco, em metros -----------------------------------------
const LADO_TRUSS = 0.30;              // Q30
const JOINTS_ALTURA = [2.5, 2.5];     // duas retas de 2,5 m por torre

/** O portal acompanha a obra: sobra 1 m de vão e 1,2 m de pé-direito. */
const vaoDoPainel = (larguraM: number) => Math.round((larguraM + 1) * 2) / 2;
const alturaDoPortal = (alturaM: number) => Math.max(4, Math.round((alturaM + 1.2) * 2) / 2);

/** Quebra o comprimento em retas de 2,5 / 2 / 1,5 / 1 / 0,5 m, como o catálogo. */
function retasPara(comprimentoM: number): number[] {
  const pecas: number[] = [];
  let resta = Math.round(comprimentoM * 2) / 2;
  for (const tam of [2.5, 2, 1.5, 1, 0.5]) {
    while (resta >= tam - 1e-6) { pecas.push(tam); resta = Math.round((resta - tam) * 2) / 2; }
  }
  return pecas.length ? pecas : [comprimentoM];
}

/** Onde o topo do painel pendura, logo abaixo da travessa. */
const yPendurado = (alturaPortal: number) => alturaPortal - 0.35;
/** Onde a borda de cima do painel fica enquanto ele está deitado no chão. */
const Z_DEITADO = 1.0;
const Y_DEITADO = 0.04;

const DURACAO_ICAMENTO = 2.4; // segundos

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------------------
// Barras do truss — uma única InstancedMesh no lugar de ~130 meshes soltas,
// que é o que faria a TV do estande engasgar.
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
// A tela viva: um único plano com shader, que só acende nos gabinetes que
// têm energia E sinal. A máscara é uma textura de 12 x 7 texels, um por
// gabinete — assim o painel inteiro custa uma chamada de desenho, e ligar ou
// apagar um gabinete é trocar um byte.
// ---------------------------------------------------------------------------

export type TelaModo = 'teste' | 'show';

const TELA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TELA_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uMask;
  uniform float uCols;
  uniform float uRows;
  uniform float uColsMax;
  uniform float uRowsMax;
  uniform float uTime;
  uniform float uModo;

  void main() {
    float col = floor(vUv.x * uCols);
    float linha = floor((1.0 - vUv.y) * uRows);
    float ligado = texture2D(uMask, vec2((col + 0.5) / uColsMax, (linha + 0.5) / uRowsMax)).r;
    if (ligado < 0.5) discard;

    // malha de LEDs: 16 pixels por gabinete, com o vão escuro entre eles
    vec2 celula = vec2(vUv.x * uCols, (1.0 - vUv.y) * uRows);
    vec2 px = fract(celula * 16.0);
    float miolo = smoothstep(0.10, 0.30, px.x) * smoothstep(0.10, 0.30, 1.0 - px.x)
                * smoothstep(0.10, 0.30, px.y) * smoothstep(0.10, 0.30, 1.0 - px.y);
    float led = 0.22 + 0.78 * miolo;

    vec3 cor;
    if (uModo < 0.5) {
      // teste em branco pleno, com uma varredura azul cruzando o painel
      float x0 = fract(uTime * 0.16) * 1.5 - 0.25;
      float varre = 1.0 - smoothstep(0.0, 0.14, abs(vUv.x - x0));
      cor = mix(vec3(0.90, 0.92, 0.96), vec3(0.32, 0.62, 0.98), varre * 0.85);
    } else {
      // conteúdo: ondas nos azuis da Rentech e um facho de luz atravessando
      float d = vUv.x * 0.9 + (1.0 - vUv.y) * 0.5;
      float onda = 0.5 + 0.5 * sin(d * 7.0 - uTime * 1.4);
      float brilho = 0.5 + 0.5 * sin(d * 3.0 + uTime * 0.7 + 1.3);
      vec3 navy = vec3(0.05, 0.11, 0.30);
      vec3 aco = vec3(0.20, 0.40, 0.60);
      vec3 claro = vec3(0.58, 0.80, 1.0);
      cor = mix(navy, aco, onda);
      cor = mix(cor, claro, pow(brilho, 6.0) * 0.9);
      float f0 = fract(uTime * 0.11) * 2.4 - 0.7;
      float facho = 1.0 - smoothstep(0.0, 0.10, abs((vUv.x - vUv.y * 0.35) - f0));
      cor += vec3(0.25, 0.45, 0.70) * facho * 0.9;
    }
    gl_FragColor = vec4(cor * led, 1.0);
  }
`;

function criarUniformsTela() {
  const dados = new Uint8Array(COLUNAS_MAX * LINHAS_MAX);
  const mascara = new THREE.DataTexture(dados, COLUNAS_MAX, LINHAS_MAX, THREE.RedFormat, THREE.UnsignedByteType);
  mascara.magFilter = THREE.NearestFilter;
  mascara.minFilter = THREE.NearestFilter;
  mascara.needsUpdate = true;
  return {
    uMask: { value: mascara },
    uCols: { value: COLUNAS_MAX },
    uRows: { value: LINHAS_MAX },
    uColsMax: { value: COLUNAS_MAX },
    uRowsMax: { value: LINHAS_MAX },
    uTime: { value: 0 },
    uModo: { value: 0 },
  };
}

function TelaViva({ estado, modo, visivel }: { estado: Estado; modo: TelaModo; visivel: boolean }) {
  // O objeto de uniforms nasce uma vez e vira propriedade do material. Daí em
  // diante, quem muta é sempre via ref do material, dentro de efeitos e do
  // useFrame — nunca no render. É o que o compilador do React exige.
  const [uniformsIniciais] = useState(criarUniformsTela);
  const material = useRef<THREE.ShaderMaterial>(null);
  const texturaParaDescartar = useRef<THREE.DataTexture | null>(null);

  useEffect(() => {
    texturaParaDescartar.current = uniformsIniciais.uMask.value;
    return () => {
      texturaParaDescartar.current?.dispose();
      texturaParaDescartar.current = null;
    };
  }, [uniformsIniciais]);

  // Um byte por gabinete: 255 se está instalado, energizado e com sinal.
  // Depende de `visivel` porque, escondida, a tela não tem material para
  // atualizar — e ao voltar precisa refletir o estado atual, não o de antes.
  useEffect(() => {
    const m = material.current;
    if (!m) return;
    const mascara = m.uniforms.uMask.value as THREE.DataTexture;
    const dados = mascara.image.data as Uint8Array;
    estado.celulas.forEach((c, i) => {
      dados[i] = celulaAtiva(estado, i) && c.instalado && c.circuito !== null && c.porta !== null ? 255 : 0;
    });
    mascara.needsUpdate = true;
  }, [estado, visivel]);

  useFrame((_, dt) => {
    const m = material.current;
    if (!m) return;
    m.uniforms.uTime.value += dt;
    m.uniforms.uRows.value = estado.linhas;
    m.uniforms.uCols.value = estado.colunas;
    m.uniforms.uModo.value = modo === 'show' ? 1 : 0;
  });

  if (!visivel) return null;
  const { largura, altura } = medidasM(estado);

  return (
    <mesh position={[0, -altura / 2, 0.052]} raycast={() => null}>
      <planeGeometry args={[largura, altura]} />
      <shaderMaterial
        ref={material}
        vertexShader={TELA_VERT}
        fragmentShader={TELA_FRAG}
        uniforms={uniformsIniciais}
        toneMapped={false}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Um gabinete de LED
// ---------------------------------------------------------------------------

type GabineteProps = {
  indice: number;
  x: number;
  y: number;
  cor: string;
  vazio: boolean;
  aceso: boolean;
  destacado: boolean;
  /** Apontado pela vistoria como problema. */
  alerta: boolean;
  onApontar: (i: number) => void;
  onArrastar: (i: number) => void;
  onSair: (i: number) => void;
};

// memo + props primitivas: pintar um gabinete cria um estado novo, e sem isso
// os 84 gabinetes re-renderizariam a cada célula pintada durante um arrasto.
const Gabinete = memo(function Gabinete({
  indice, x, y, cor, vazio, aceso, destacado, alerta, onApontar, onArrastar, onSair,
}: GabineteProps) {
  return (
    <mesh
      position={[x, y, 0]}
      onPointerDown={(e) => { e.stopPropagation(); onApontar(indice); }}
      onPointerMove={(e) => { e.stopPropagation(); onArrastar(indice); }}
      onPointerOut={() => onSair(indice)}
    >
      <boxGeometry args={[MODULO_M * 0.94, MODULO_M * 0.94, vazio ? 0.03 : 0.09]} />
      <meshStandardMaterial
        color={cor}
        roughness={vazio ? 0.9 : 0.35}
        metalness={vazio ? 0 : 0.4}
        transparent={vazio}
        opacity={vazio ? 0.32 : 1}
        emissive={aceso ? cor : '#000000'}
        emissiveIntensity={aceso ? 0.22 : 0}
      />
      {alerta && (
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[MODULO_M * 1.02, MODULO_M * 1.02, 0.01]} />
          <meshBasicMaterial color="#E0574F" transparent opacity={0.55} />
        </mesh>
      )}
      {destacado && !alerta && (
        <mesh position={[0, 0, 0.06]}>
          <boxGeometry args={[MODULO_M * 0.99, MODULO_M * 0.99, 0.01]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.18} />
        </mesh>
      )}
    </mesh>
  );
});

// ---------------------------------------------------------------------------
// O painel: grupo que gira e sobe. A origem do grupo é a borda DE CIMA do
// painel — que é justamente onde a talha engata. Assim o içamento sai de
// graça: basta subir e rotacionar a origem, e o painel pendura certo.
// ---------------------------------------------------------------------------

function Painel({
  estado, camada, onPintar, aoIniciarPintura, reduzirMovimento, alertas, telaModo,
}: {
  estado: Estado;
  camada: Camada;
  onPintar: (i: number) => void;
  aoIniciarPintura: () => void;
  reduzirMovimento: boolean;
  alertas: Set<number>;
  telaModo: TelaModo;
}) {
  const grupo = useRef<THREE.Group>(null);
  const t = useRef(estado.icado ? 1 : 0);
  /** Instante em que o painel terminou de subir — a partir daí ele balança. */
  const chegadaEm = useRef<number | null>(estado.icado ? 0 : null);
  const arrastando = useRef(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const soltar = () => { arrastando.current = false; };
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    return () => {
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
  }, []);

  const { largura, altura } = medidasM(estado);

  useFrame((estadoR3F, dt) => {
    const g = grupo.current;
    if (!g) return;

    const alvo = estado.icado ? 1 : 0;
    const antes = t.current;
    if (reduzirMovimento) {
      t.current = alvo;
    } else {
      const passo = dt / DURACAO_ICAMENTO;
      t.current = t.current < alvo
        ? Math.min(alvo, t.current + passo)
        : Math.max(alvo, t.current - passo);
    }

    // Pêndulo amortecido quando a talha termina de subir: o painel chega,
    // balança um pouco e assenta. Sem isso o içamento parava seco demais.
    const agora = estadoR3F.clock.elapsedTime;
    if (antes < 1 && t.current >= 1) chegadaEm.current = agora;
    if (alvo === 0) chegadaEm.current = null;
    if (chegadaEm.current !== null && !reduzirMovimento) {
      const desde = agora - chegadaEm.current;
      g.rotation.z = Math.sin(desde * 2.6) * 0.03 * Math.exp(-desde * 0.6);
    } else {
      g.rotation.z = 0;
    }

    // A subida lidera e a rotação vem atrás — é assim que uma talha levanta um
    // painel deitado, e é o que impede a borda de baixo de varrer o chão.
    const subida = ease(clamp01(t.current * 1.4));
    const giro = ease(clamp01((t.current - 0.25) / 0.75));

    g.position.set(
      0,
      THREE.MathUtils.lerp(Y_DEITADO, yPendurado(alturaDoPortal(altura)), subida),
      THREE.MathUtils.lerp(Z_DEITADO, 0, subida),
    );
    g.rotation.x = THREE.MathUtils.lerp(-Math.PI / 2, 0, giro);
  });

  const gabinetes = useMemo(() => {
    const lista: { i: number; x: number; y: number }[] = [];
    const meiaLargura = (estado.colunas * MODULO_M) / 2;
    for (let i = 0; i < estado.celulas.length; i++) {
      if (!celulaAtiva(estado, i)) continue;
      lista.push({
        i,
        x: -meiaLargura + MODULO_M / 2 + colunaDe(i) * MODULO_M,
        y: -(linhaDe(i) + 0.5) * MODULO_M, // cresce para baixo a partir da talha
      });
    }
    return lista;
  }, [estado]);

  const apontar = useCallback((i: number) => {
    arrastando.current = true;
    aoIniciarPintura();
    onPintar(i);
  }, [aoIniciarPintura, onPintar]);

  const arrastar = useCallback((i: number) => {
    setHover(i);
    if (arrastando.current) onPintar(i);
  }, [onPintar]);

  const sair = useCallback((i: number) => {
    setHover((h) => (h === i ? null : h));
  }, []);

  // Quanto do painel já está aceso — manda na luz que ele joga no chão.
  const fracaoAcesa = useMemo(() => {
    const pedidos = gabinetesPedidos(estado);
    if (pedidos === 0) return 0;
    let acesos = 0;
    estado.celulas.forEach((c, i) => {
      if (celulaAtiva(estado, i) && c.instalado && c.circuito !== null && c.porta !== null) acesos++;
    });
    return acesos / pedidos;
  }, [estado]);

  // Estável entre renders: sem isso o useLayoutEffect das barras recalcularia
  // as matrizes dos cabos a cada gabinete pintado.
  const cabos = useMemo<Seg3D[]>(() => [
    { a: [-largura / 2 + 0.4, 0.02, 0], b: [-0.05, 0.6, 0] },
    { a: [largura / 2 - 0.4, 0.02, 0], b: [0.05, 0.6, 0] },
  ], [largura]);

  const corDe = (i: number): { cor: string; vazio: boolean; aceso: boolean } => {
    const c = estado.celulas[i];
    if (!c.instalado) return { cor: COR_VAZIO, vazio: true, aceso: false };

    if (camada === 'energia') {
      return {
        cor: c.circuito === null ? COR_SEM_ATRIBUICAO : corCircuito(c.circuito),
        vazio: false,
        aceso: false,
      };
    }
    if (camada === 'sinal') {
      return {
        cor: c.porta === null ? COR_SEM_ATRIBUICAO : corPorta(c.porta),
        vazio: false,
        aceso: false,
      };
    }
    // Na camada de estrutura, o gabinete só acende quando tem energia E sinal.
    // É o retorno visual mais honesto do jogo: painel mal fechado fica escuro.
    return {
      cor: c.instaladoNoAr ? COR_GABINETE_AR : COR_GABINETE,
      vazio: false,
      aceso: c.circuito !== null && c.porta !== null,
    };
  };

  return (
    <group ref={grupo}>
      {gabinetes.map(({ i, x, y }) => {
        const { cor, vazio, aceso } = corDe(i);
        return (
          <Gabinete
            key={i}
            indice={i}
            x={x}
            y={y}
            cor={cor}
            vazio={vazio}
            aceso={aceso}
            destacado={hover === i}
            alerta={alertas.has(i)}
            onApontar={apontar}
            onArrastar={arrastar}
            onSair={sair}
          />
        );
      })}

      {/* a tela só aparece na camada de estrutura: nas outras, a cor é a informação */}
      <TelaViva estado={estado} modo={telaModo} visivel={camada === 'estrutura'} />

      {/* o painel aceso ilumina o chão e o truss à volta */}
      {fracaoAcesa > 0 && camada === 'estrutura' && (
        <pointLight
          position={[0, -altura / 2, 1.1]}
          intensity={fracaoAcesa * (telaModo === 'show' ? 26 : 18)}
          color={telaModo === 'show' ? '#6FA8FF' : '#D9E6FF'}
          distance={11}
          decay={2}
        />
      )}

      {/* cabos de aço da talha até os cantos de cima do painel */}
      <Barras segs={cabos} espessura={0.035} cor={COR_CABO} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Vistoria: a câmera larga o jogador e passeia pelo que ficou errado
// ---------------------------------------------------------------------------

export type Foco = {
  /** Células apontadas. Vazio = problema do salão, então é plano aberto. */
  celulas: number[];
  curto: string;
  tipo: 'reprovacao' | 'tempo' | 'qualidade';
};

/** Onde uma célula está no mundo, com o painel já pendurado. */
export function posicaoMundo(e: Estado, i: number): [number, number, number] {
  const { largura } = medidasM(e);
  const yTopo = yPendurado(alturaDoPortal(medidasM(e).altura));
  return [
    -largura / 2 + MODULO_M / 2 + colunaDe(i) * MODULO_M,
    yTopo - (linhaDe(i) + 0.5) * MODULO_M,
    0,
  ];
}

function centroide(e: Estado, celulas: number[]): [number, number, number] {
  const meio = yPendurado(alturaDoPortal(medidasM(e).altura)) - medidasM(e).altura / 2;
  if (celulas.length === 0) return [0, meio, 0];
  let sx = 0, sy = 0;
  for (const i of celulas) {
    const [x, y] = posicaoMundo(e, i);
    sx += x; sy += y;
  }
  return [sx / celulas.length, sy / celulas.length, 0];
}

/**
 * Distância de câmera que enquadra as células apontadas. Um problema em duas
 * células pede close; um que pega o painel inteiro pede plano aberto, senão a
 * câmera para em cima do centro e corta justamente o que devia mostrar.
 */
function distanciaDeEnquadramento(e: Estado, celulas: number[]): number {
  if (celulas.length === 0) return 10.5;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of celulas) {
    const [x, y] = posicaoMundo(e, i);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const raio = Math.hypot(maxX - minX + MODULO_M, maxY - minY + MODULO_M) / 2;
  return Math.min(14, Math.max(3.6, raio * 1.9 + 2.2));
}

/** Plano aberto que cabe a obra inteira, seja testeira larga ou telão alto. */
function planoAberto(e: Estado): { pos: [number, number, number]; olhar: [number, number, number] } {
  const { largura, altura } = medidasM(e);
  const meio = yPendurado(alturaDoPortal(altura)) - altura / 2;
  const dist = Math.max(9, Math.hypot(largura, altura) * 1.35 + 3);
  return { pos: [largura * 0.18, meio + altura * 0.35, dist], olhar: [0, meio, 0] };
}

function CameraVistoria({ estado, foco, orbitar }: { estado: Estado; foco: Foco | null; orbitar: boolean }) {
  const { camera } = useThree();
  const olharAtual = useRef(new THREE.Vector3(0, 2.4, 0));
  const destinoPos = useRef(new THREE.Vector3());
  const destinoOlhar = useRef(new THREE.Vector3());
  const tempo = useRef(0);

  useFrame((_, dt) => {
    tempo.current += dt;
    const aberto = planoAberto(estado);

    if (orbitar) {
      // Montagem limpa: volta giratória em torno do painel aceso.
      const a = tempo.current * 0.16;
      const raio = aberto.pos[2] * 0.92;
      destinoPos.current.set(Math.sin(a) * raio, aberto.pos[1], Math.cos(a) * raio);
      destinoOlhar.current.set(...aberto.olhar);
    } else if (foco && foco.celulas.length > 0) {
      const [cx, cy] = centroide(estado, foco.celulas);
      destinoPos.current.set(cx, cy, distanciaDeEnquadramento(estado, foco.celulas));
      destinoOlhar.current.set(cx, cy, 0);
    } else {
      destinoPos.current.set(...aberto.pos);
      destinoOlhar.current.set(...aberto.olhar);
    }

    // Aproximação exponencial: rápida no começo, assentando no fim.
    const k = 1 - Math.pow(0.0025, dt);
    camera.position.lerp(destinoPos.current, k);
    olharAtual.current.lerp(destinoOlhar.current, k);
    camera.lookAt(olharAtual.current);
  });

  return null;
}

function EtiquetaProblema({ estado, foco }: { estado: Estado; foco: Foco }) {
  const [x, y] = centroide(estado, foco.celulas);
  const tom = foco.tipo === 'reprovacao'
    ? 'border-red-500/70 bg-red-950/90 text-red-100'
    : foco.tipo === 'tempo'
      ? 'border-amber-500/60 bg-amber-950/90 text-amber-100'
      : 'border-[#336699]/70 bg-[#0C1D4D]/90 text-white';

  return (
    <Html position={[x, y + 0.55, 0.4]} center distanceFactor={9} zIndexRange={[20, 0]}>
      <div
        className={`px-3 py-1.5 rounded-md border backdrop-blur text-[13px] font-black uppercase tracking-wider whitespace-nowrap shadow-xl ${tom}`}
      >
        {foco.curto}
      </div>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Cena
// ---------------------------------------------------------------------------

// Fora do componente para a assinatura ficar estável entre renders.
const CONSULTA_MOVIMENTO = '(prefers-reduced-motion: reduce)';
const assinarMovimento = (avisar: () => void) => {
  const mq = window.matchMedia(CONSULTA_MOVIMENTO);
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
};
const lerMovimento = () => window.matchMedia(CONSULTA_MOVIMENTO).matches;

export default function Palco3D({
  estado, camada, onPintar, vistoriando = false, foco = null, orbitar = false, telaModo = 'teste',
}: {
  estado: Estado;
  camada: Camada;
  onPintar: (i: number) => void;
  /** Na vistoria a câmera é dirigida e o jogador não mexe em nada. */
  vistoriando?: boolean;
  foco?: Foco | null;
  orbitar?: boolean;
  /** 'teste' = branco pleno de checagem; 'show' = conteúdo, para a montagem limpa. */
  telaModo?: TelaModo;
}) {
  const { largura: larguraPainel, altura: alturaPainel } = medidasM(estado);
  const alturaPortal = alturaDoPortal(alturaPainel);
  const vaoPortal = vaoDoPainel(larguraPainel);
  const meioPainel = yPendurado(alturaPortal) - alturaPainel / 2;

  /** Alvo dos spots: o centro do painel pendurado. */
  const alvoSpot = useMemo(() => new THREE.Object3D(), []);
  alvoSpot.position.set(0, meioPainel, 0);
  const [pintando, setPintando] = useState(false);
  const reduzirMovimento = useSyncExternalStore(
    assinarMovimento,
    lerMovimento,
    () => false,
  );

  useEffect(() => {
    const soltar = () => setPintando(false);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    return () => {
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
  }, []);

  const iniciarPintura = useCallback(() => setPintando(true), []);

  const alertas = useMemo(
    () => new Set(vistoriando && foco ? foco.celulas : []),
    [vistoriando, foco],
  );

  const portal = useMemo(
    () => buildPortalGeometry3D(
      alturaPortal, vaoPortal, LADO_TRUSS,
      alturaPortal === 5 ? JOINTS_ALTURA : retasPara(alturaPortal),
      retasPara(vaoPortal),
    ),
    [alturaPortal, vaoPortal],
  );

  const barrasPrincipais = useMemo(
    () => [...portal.chords, ...portal.frames],
    [portal],
  );

  return (
    <Canvas
      camera={{ position: [2.2, 3.4, 10.5], fov: 42, near: 0.1, far: 120 }}
      dpr={[1, 1.75]}
      shadows={false}
      className={vistoriando ? 'touch-none' : 'touch-none cursor-crosshair'}
    >
      <color attach="background" args={['#06080C']} />
      <fog attach="fog" args={['#06080C', 14, 42]} />

      <ambientLight intensity={0.32} />
      <hemisphereLight args={['#4E93D8', '#0C1D4D', 0.3]} />
      <directionalLight position={[6, 9, 7]} intensity={0.75} />
      <directionalLight position={[-7, 4, -5]} intensity={0.25} color="#4E93D8" />

      {/* dois spots de frente, como uma vara de luz apontada para o palco */}
      <primitive object={alvoSpot} />
      <spotLight position={[-vaoPortal * 0.6, alturaPortal + 2.6, 5.2]} target={alvoSpot} angle={0.55} penumbra={0.75} intensity={80} color="#DCE8FF" distance={26} decay={2} />
      <spotLight position={[vaoPortal * 0.6, alturaPortal + 2.6, 5.2]} target={alvoSpot} angle={0.55} penumbra={0.75} intensity={80} color="#DCE8FF" distance={26} decay={2} />

      {/* piso do galpão: escuro e um pouco metálico, para receber a luz do painel */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]}>
        <planeGeometry args={[70, 70]} />
        <meshStandardMaterial color="#0A0F1B" roughness={0.45} metalness={0.4} />
      </mesh>

      {/* parede de fundo, para o portal não flutuar no vazio */}
      <mesh position={[0, 6, -10]}>
        <planeGeometry args={[52, 14]} />
        <meshStandardMaterial color="#090C14" roughness={1} />
      </mesh>

      <Grid
        position={[0, 0, 0]}
        args={[40, 40]}
        cellSize={0.5}
        sectionSize={2}
        cellColor="#16203A"
        sectionColor="#28375C"
        cellThickness={0.5}
        sectionThickness={1}
        fadeDistance={38}
        infiniteGrid
      />

      <Barras segs={barrasPrincipais} espessura={LADO_TRUSS * 0.22} cor={COR_TRUSS} />
      <Barras segs={portal.diagonals} espessura={LADO_TRUSS * 0.1} cor={COR_DIAGONAL} />

      {/* sapatas */}
      {[-vaoPortal / 2, vaoPortal / 2].map((x) => (
        <mesh key={x} position={[x, 0.05, 0]}>
          <boxGeometry args={[0.9, 0.1, 0.9]} />
          <meshStandardMaterial color="#151E30" roughness={0.8} />
        </mesh>
      ))}

      <Painel
        estado={estado}
        camada={camada}
        onPintar={vistoriando ? naoFazNada : onPintar}
        aoIniciarPintura={vistoriando ? naoFazNada : iniciarPintura}
        reduzirMovimento={reduzirMovimento}
        alertas={alertas}
        telaModo={telaModo}
      />

      {vistoriando && foco && foco.celulas.length > 0 && <EtiquetaProblema estado={estado} foco={foco} />}

      {vistoriando ? (
        <CameraVistoria estado={estado} foco={foco} orbitar={orbitar} />
      ) : (
        <OrbitControls
          enabled={!pintando}
          target={[0, meioPainel, 0]}
          minDistance={4}
          maxDistance={32}
          maxPolarAngle={Math.PI / 2 - 0.03}
          enablePan={false}
          makeDefault
        />
      )}
    </Canvas>
  );
}

/** Estável entre renders, para desligar a pintura durante a vistoria. */
function naoFazNada() {}
