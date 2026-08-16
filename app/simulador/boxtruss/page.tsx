"use client";

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Analytics } from "@vercel/analytics/next";
import logoColorido from '../../../app/imgs/logo.png';
import { StraightIcon, CuboIcon, SleeveIcon, SapataIcon, TalhaIcon, PauCargaIcon, TPieceIcon, DiagonalIcon } from './icons';
import { TorreSVG, VaoSVG, BoxSVG } from './schematics';
import { type NoAcessorio, NODE_META, AUTO_CONEXAO_META } from './livre-meta';
import { buildTorreGeometry3D, buildVaoGeometry3D, buildPortalGeometry3D, buildBoxGeometry3D, buildLivreGeometry3D } from './geometry3d';

const Loading3D = () => (
  <div className="h-[420px] flex items-center justify-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">Carregando visualização 3D…</div>
);
const MontadorTruss3D = dynamic(() => import('./Truss3D').then(m => m.MontadorTruss3D), { ssr: false, loading: Loading3D });
const LivreTruss3D = dynamic(() => import('./Truss3D').then(m => m.LivreTruss3D), { ssr: false, loading: Loading3D });

// ============================================================================
// DADOS DE ENGENHARIA (valores médios de mercado — validar com engenharia antes da execução)
// ============================================================================
type QSize = 'Q15' | 'Q25' | 'Q30' | 'Q50';
type StructureType = 'torre' | 'vao' | 'portal' | 'box';

const Q_SIZES: QSize[] = ['Q15', 'Q25', 'Q30', 'Q50'];

const Q_INFO: Record<QSize, { label: string; ladoCm: number; ladoM: number; kgPerM: number; cuboKg: number; sleeveKg: number; sapataKg: number; diagonalKg: number }> = {
  Q15: { label: 'Q15 (15x15cm)', ladoCm: 15, ladoM: 0.15, kgPerM: 3.0, cuboKg: 2.0, sleeveKg: 0.5, sapataKg: 1.5, diagonalKg: 2.0 },
  Q25: { label: 'Q25 (25x25cm)', ladoCm: 25, ladoM: 0.25, kgPerM: 4.2, cuboKg: 3.2, sleeveKg: 0.8, sapataKg: 2.5, diagonalKg: 3.0 },
  Q30: { label: 'Q30 (30x30cm)', ladoCm: 30, ladoM: 0.30, kgPerM: 5.5, cuboKg: 4.5, sleeveKg: 1.0, sapataKg: 3.5, diagonalKg: 3.8 },
  Q50: { label: 'Q50 (50x50cm)', ladoCm: 50, ladoM: 0.50, kgPerM: 9.0, cuboKg: 8.0, sleeveKg: 1.8, sapataKg: 6.0, diagonalKg: 6.5 },
};

const STRAIGHT_LENGTHS_M = [3.0, 2.5, 2.0, 1.5, 1.0, 0.5];

const TALHA_OPTIONS = [
  { capKg: 500, pesoKg: 14 },
  { capKg: 1000, pesoKg: 20 },
  { capKg: 2000, pesoKg: 33 },
  { capKg: 3000, pesoKg: 46 },
];

const PAU_CARGA_OPTIONS = [
  { comprimentoM: 3, wllKg: 250 },
  { comprimentoM: 4, wllKg: 200 },
  { comprimentoM: 6, wllKg: 150 },
];

// ============================================================================
// MOTOR DE CÁLCULO
// ============================================================================
function breakdownLength(targetM: number) {
  let remaining = Math.round(Math.max(0.5, Math.ceil(targetM * 2) / 2) * 100) / 100;
  const pieces: { len: number; qty: number }[] = [];
  for (const len of STRAIGHT_LENGTHS_M) {
    let qty = 0;
    while (remaining + 1e-6 >= len) {
      qty++;
      remaining = Math.round((remaining - len) * 100) / 100;
    }
    if (qty > 0) pieces.push({ len, qty });
  }
  const total = pieces.reduce((s, p) => s + p.len * p.qty, 0);
  const segments = pieces.reduce((s, p) => s + p.qty, 0);
  const jointsM = pieces.flatMap(p => Array(p.qty).fill(p.len));
  return { pieces, total, segments, jointsM };
}

interface ResultadoEstrutura {
  tipo: StructureType;
  alturaReal?: number;
  vaoReal?: number;
  larguraReal?: number;
  profundidadeReal?: number;
  jointsM?: number[];
  jointsAltura?: number[];
  jointsVao?: number[];
  jointsLargura?: number[];
  jointsProfundidade?: number[];
  retas: { len: number; qty: number }[];
  sleeves: number;
  cubos: number;
  sapatas?: number;
  diagonais?: number;
  pesoTotal: number;
}

function computeTorre(alturaInput: number, qSize: QSize, numTorres: number): ResultadoEstrutura {
  const info = Q_INFO[qSize];
  const { pieces, total, segments, jointsM } = breakdownLength(alturaInput);
  const retas = pieces.map(p => ({ len: p.len, qty: p.qty * 4 * numTorres }));
  const sleeves = Math.max(0, segments - 1) * 4 * numTorres;
  const cubos = 8 * numTorres; // 4 no topo + 4 na base, por torre
  const sapatas = 4 * numTorres;
  const diagonaisPorFace = Math.max(1, Math.round(total / 2));
  const diagonais = diagonaisPorFace * 4 * numTorres;
  const molduraKg = 2 * (4 * info.ladoM) * info.kgPerM * numTorres; // quadro topo + base

  const pesoRetas = total * 4 * info.kgPerM * numTorres;
  const pesoTotal = pesoRetas + cubos * info.cuboKg + sleeves * info.sleeveKg + sapatas * info.sapataKg + diagonais * info.diagonalKg + molduraKg;

  return { tipo: 'torre', alturaReal: total, jointsM, retas, sleeves, cubos, sapatas, diagonais, pesoTotal };
}

function computeVao(vaoInput: number, qSize: QSize, numVaos: number): ResultadoEstrutura {
  const info = Q_INFO[qSize];
  const { pieces, total, segments, jointsM } = breakdownLength(vaoInput);
  const retas = pieces.map(p => ({ len: p.len, qty: p.qty * numVaos }));
  const sleeves = Math.max(0, segments - 1) * numVaos;
  const cubos = 2 * numVaos; // terminações / pontos de içamento nas pontas

  const pesoRetas = total * info.kgPerM * numVaos;
  const pesoTotal = pesoRetas + cubos * info.cuboKg + sleeves * info.sleeveKg;

  return { tipo: 'vao', vaoReal: total, jointsM, retas, sleeves, cubos, pesoTotal };
}

function computePortal(alturaInput: number, vaoInput: number, qSize: QSize): ResultadoEstrutura {
  const info = Q_INFO[qSize];
  const torre = computeTorre(alturaInput, qSize, 2);
  const vaoCalc = computeVao(vaoInput, qSize, 1);
  const pesoTravessa = vaoCalc.pesoTotal - vaoCalc.cubos * info.cuboKg; // pontas reaproveitam os cubos do topo das torres

  const retasMap = new Map<number, number>();
  torre.retas.forEach(r => retasMap.set(r.len, (retasMap.get(r.len) || 0) + r.qty));
  vaoCalc.retas.forEach(r => retasMap.set(r.len, (retasMap.get(r.len) || 0) + r.qty));
  const retas = Array.from(retasMap.entries()).map(([len, qty]) => ({ len, qty })).sort((a, b) => b.len - a.len);

  return {
    tipo: 'portal',
    alturaReal: torre.alturaReal,
    vaoReal: vaoCalc.vaoReal,
    jointsAltura: torre.jointsM,
    jointsVao: vaoCalc.jointsM,
    retas,
    cubos: torre.cubos,
    sleeves: torre.sleeves + vaoCalc.sleeves,
    sapatas: torre.sapatas,
    diagonais: torre.diagonais,
    pesoTotal: torre.pesoTotal + pesoTravessa,
  };
}

function computeBox(alturaInput: number, larguraInput: number, profundidadeInput: number, qSize: QSize): ResultadoEstrutura {
  const info = Q_INFO[qSize];
  const torres = computeTorre(alturaInput, qSize, 4); // 4 torres de canto
  const vaoLargura = computeVao(larguraInput, qSize, 2); // moldura do topo, lados de largura (frente + fundo)
  const vaoProfundidade = computeVao(profundidadeInput, qSize, 2); // moldura do topo, lados de profundidade

  // Cubos das pontas dos vãos reaproveitam os cubos do topo das torres — não somar em dobro
  const pesoLargura = vaoLargura.pesoTotal - vaoLargura.cubos * info.cuboKg;
  const pesoProfundidade = vaoProfundidade.pesoTotal - vaoProfundidade.cubos * info.cuboKg;

  const retasMap = new Map<number, number>();
  [torres, vaoLargura, vaoProfundidade].forEach(r => r.retas.forEach(p => retasMap.set(p.len, (retasMap.get(p.len) || 0) + p.qty)));
  const retas = Array.from(retasMap.entries()).map(([len, qty]) => ({ len, qty })).sort((a, b) => b.len - a.len);

  return {
    tipo: 'box',
    alturaReal: torres.alturaReal,
    larguraReal: vaoLargura.vaoReal,
    profundidadeReal: vaoProfundidade.vaoReal,
    jointsAltura: torres.jointsM,
    jointsLargura: vaoLargura.jointsM,
    jointsProfundidade: vaoProfundidade.jointsM,
    retas,
    cubos: torres.cubos,
    sleeves: torres.sleeves + vaoLargura.sleeves + vaoProfundidade.sleeves,
    sapatas: torres.sapatas,
    diagonais: torres.diagonais,
    pesoTotal: torres.pesoTotal + pesoLargura + pesoProfundidade,
  };
}

function recomendarTalha(cargaKgPorPonto: number) {
  return TALHA_OPTIONS.find(t => t.capKg >= cargaKgPorPonto) ?? TALHA_OPTIONS[TALHA_OPTIONS.length - 1];
}
function recomendarPauCarga(alturaM: number) {
  return PAU_CARGA_OPTIONS.find(p => p.comprimentoM >= alturaM) ?? PAU_CARGA_OPTIONS[PAU_CARGA_OPTIONS.length - 1];
}

function buildMateriais(resultado: ResultadoEstrutura, qSize: QSize) {
  const info = Q_INFO[qSize];
  const linhas: { nome: string; qtd: number; unidade: string; pesoTotalKg: number }[] = [];
  [...resultado.retas].sort((a, b) => b.len - a.len).forEach(r => {
    if (r.qty > 0) linhas.push({ nome: `Reta ${r.len.toFixed(1)}m`, qtd: r.qty, unidade: 'pç', pesoTotalKg: r.len * r.qty * info.kgPerM });
  });
  if (resultado.cubos) linhas.push({ nome: 'Cubo (peça de canto)', qtd: resultado.cubos, unidade: 'pç', pesoTotalKg: resultado.cubos * info.cuboKg });
  if (resultado.sleeves) linhas.push({ nome: 'Sleeve (luva de emenda)', qtd: resultado.sleeves, unidade: 'pç', pesoTotalKg: resultado.sleeves * info.sleeveKg });
  if (resultado.sapatas) linhas.push({ nome: 'Sapata / base ajustável', qtd: resultado.sapatas, unidade: 'pç', pesoTotalKg: resultado.sapatas * info.sapataKg });
  if (resultado.diagonais) linhas.push({ nome: 'Diagonal (contraventamento)', qtd: resultado.diagonais, unidade: 'pç', pesoTotalKg: resultado.diagonais * info.diagonalKg });
  return linhas;
}

const CATALOGO: { id: string; nome: string; categoria: string; descricao: string; Icon: () => React.JSX.Element; specs: string[] }[] = [
  {
    id: 'reta', nome: 'Reta (Segmento Reto)', categoria: 'Estrutura',
    descricao: 'Módulo reto de treliça, disponível em vários comprimentos padrão para compor torres, vãos e portais.',
    Icon: StraightIcon,
    specs: ['Comprimentos: 0,5 / 1,0 / 1,5 / 2,0 / 2,5 / 3,0 m', ...Q_SIZES.map(q => `${q}: ${Q_INFO[q].kgPerM.toFixed(1)} kg/m`)],
  },
  {
    id: 'cubo', nome: 'Cubo (Peça de Canto)', categoria: 'Conexão',
    descricao: 'Conecta até 6 retas em direções ortogonais — usado nos cantos de torres e portais.',
    Icon: CuboIcon,
    specs: Q_SIZES.map(q => `${q}: ${Q_INFO[q].cuboKg.toFixed(1)} kg`),
  },
  {
    id: 'sleeve', nome: 'Sleeve (Luva de Emenda)', categoria: 'Conexão',
    descricao: 'Une duas retas em linha reta, permitindo estender o comprimento de um segmento.',
    Icon: SleeveIcon,
    specs: Q_SIZES.map(q => `${q}: ${Q_INFO[q].sleeveKg.toFixed(1)} kg`),
  },
  {
    id: 'sapata', nome: 'Sapata / Base Ajustável', categoria: 'Apoio',
    descricao: 'Base de apoio no solo com pé regulável para nivelamento da torre.',
    Icon: SapataIcon,
    specs: Q_SIZES.map(q => `${q}: ${Q_INFO[q].sapataKg.toFixed(1)} kg`),
  },
  {
    id: 'diagonal', nome: 'Diagonal (Contraventamento)', categoria: 'Estrutura',
    descricao: 'Trava diagonal entre pernas da torre, garantindo rigidez e estabilidade lateral.',
    Icon: DiagonalIcon,
    specs: Q_SIZES.map(q => `${q}: ${Q_INFO[q].diagonalKg.toFixed(1)} kg`),
  },
  {
    id: 'tpiece', nome: 'Junção T', categoria: 'Conexão',
    descricao: 'Deriva uma terceira direção a partir de uma linha reta — usada em ramificações e travessas intermediárias.',
    Icon: TPieceIcon,
    specs: ['Disponível em todos os tamanhos Q'],
  },
  {
    id: 'talha', nome: 'Talha (Chain Hoist)', categoria: 'Içamento',
    descricao: 'Talha manual de corrente para içar e travar a estrutura em altura com segurança.',
    Icon: TalhaIcon,
    specs: TALHA_OPTIONS.map(t => `CM ${t.capKg} kg — peso ${t.pesoKg} kg`),
  },
  {
    id: 'pauCarga', nome: 'Pau de Carga', categoria: 'Içamento',
    descricao: 'Mastro guinchado usado para erguer torres manualmente por rotação, sem uso de talha.',
    Icon: PauCargaIcon,
    specs: PAU_CARGA_OPTIONS.map(p => `${p.comprimentoM} m — WLL ${p.wllKg} kg`),
  },
];

// ============================================================================
// MONTAGEM LIVRE (grid de nós/arestas onde o usuário posiciona as peças)
// ============================================================================
type Ferramenta = 'reta' | 'diagonal' | NoAcessorio | 'apagar';

const FERRAMENTAS: { id: Ferramenta; label: string; cor: string }[] = [
  { id: 'reta', label: 'Reta', cor: '#0C1D4D' },
  { id: 'diagonal', label: 'Diagonal', cor: '#336699' },
  { id: 'sapata', label: 'Sapata', cor: '#94A3B8' },
  { id: 'talha', label: 'Talha', cor: '#D97706' },
  { id: 'pauCarga', label: 'Pau de Carga', cor: '#7C3AED' },
  { id: 'apagar', label: 'Apagar', cor: '#DC2626' },
];

const CELL = 44;
const OFFSET = 22;
const STORAGE_KEY = 'rentech-boxtruss-simulador-v1';

function buildGridGeom(cols: number, rows: number) {
  const nodes: { id: string; x: number; y: number }[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) nodes.push({ id: `N-${c}-${r}`, x: OFFSET + c * CELL, y: OFFSET + r * CELL });

  const hEdges: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) hEdges.push({ id: `H-${c}-${r}`, x1: OFFSET + c * CELL, y1: OFFSET + r * CELL, x2: OFFSET + (c + 1) * CELL, y2: OFFSET + r * CELL });

  const vEdges: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let c = 0; c <= cols; c++) for (let r = 0; r < rows; r++) vEdges.push({ id: `V-${c}-${r}`, x1: OFFSET + c * CELL, y1: OFFSET + r * CELL, x2: OFFSET + c * CELL, y2: OFFSET + (r + 1) * CELL });

  const cells: { id: string; d1: string; d2: string; x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ id: `C-${c}-${r}`, d1: `D1-${c}-${r}`, d2: `D2-${c}-${r}`, x: OFFSET + c * CELL, y: OFFSET + r * CELL });

  return { nodes, hEdges, vEdges, cells, width: OFFSET * 2 + cols * CELL, height: OFFSET * 2 + rows * CELL };
}

// Para cada nó do grid, infere a peça de conexão a partir das retas incidentes:
// 2 retas em linha reta (colineares) => Sleeve; qualquer canto, T ou cruzamento => Cubo.
function computeConexoesAutomaticas(cols: number, rows: number, retasLivres: Set<string>) {
  const nodes: { id: string; c: number; r: number; tipo: 'cubo' | 'sleeve' }[] = [];
  let cubos = 0, sleeves = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const left = c > 0 && retasLivres.has(`H-${c - 1}-${r}`);
      const right = c < cols && retasLivres.has(`H-${c}-${r}`);
      const up = r > 0 && retasLivres.has(`V-${c}-${r - 1}`);
      const down = r < rows && retasLivres.has(`V-${c}-${r}`);
      const degree = [left, right, up, down].filter(Boolean).length;
      if (degree < 2) continue;
      const colinear = (left && right && !up && !down) || (up && down && !left && !right);
      const tipo: 'cubo' | 'sleeve' = degree === 2 && colinear ? 'sleeve' : 'cubo';
      if (tipo === 'cubo') cubos++; else sleeves++;
      nodes.push({ id: `N-${c}-${r}`, c, r, tipo });
    }
  }
  return { nodes, cubos, sleeves };
}

// ============================================================================
// PÁGINA
// ============================================================================
export default function SimuladorBoxtruss() {
  const [aba, setAba] = useState<'catalogo' | 'montador' | 'livre'>('catalogo');

  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');
  const [qSize, setQSize] = useState<QSize>('Q30');
  const [estrutura, setEstrutura] = useState<StructureType>('torre');
  const [altura, setAltura] = useState<number>(3);
  const [vao, setVao] = useState<number>(6);
  const [numTorres, setNumTorres] = useState<number>(1);
  const [numVaos, setNumVaos] = useState<number>(1);
  const [boxLargura, setBoxLargura] = useState<number>(4);
  const [boxProfundidade, setBoxProfundidade] = useState<number>(3);
  const [cargaEquipamentosKg, setCargaEquipamentosKg] = useState<number>(0);

  const resultado = useMemo<ResultadoEstrutura>(() => {
    if (estrutura === 'torre') return computeTorre(altura, qSize, Math.max(1, numTorres));
    if (estrutura === 'vao') return computeVao(vao, qSize, Math.max(1, numVaos));
    if (estrutura === 'box') return computeBox(altura, boxLargura, boxProfundidade, qSize);
    return computePortal(altura, vao, qSize);
  }, [estrutura, altura, vao, qSize, numTorres, numVaos, boxLargura, boxProfundidade]);

  const materiais = useMemo(() => buildMateriais(resultado, qSize), [resultado, qSize]);

  const pontosIcamento = estrutura === 'torre' ? Math.max(1, numTorres) : estrutura === 'portal' ? 2 : estrutura === 'box' ? 4 : Math.max(1, numVaos) * 2;
  const cargaTotalKg = resultado.pesoTotal + Math.max(0, cargaEquipamentosKg);
  const cargaPorPontoKg = cargaTotalKg / Math.max(1, pontosIcamento);
  const talha = recomendarTalha(cargaPorPontoKg);
  const pauCarga = estrutura !== 'vao' ? recomendarPauCarga(resultado.alturaReal ?? altura) : null;

  const totalRetas = resultado.retas.reduce((s, r) => s + r.qty, 0);
  const dimensoesLabel = [
    resultado.alturaReal ? `${resultado.alturaReal.toFixed(1)}m alt.` : null,
    resultado.vaoReal ? `${resultado.vaoReal.toFixed(1)}m vão` : null,
    resultado.larguraReal ? `${resultado.larguraReal.toFixed(1)}m larg.` : null,
    resultado.profundidadeReal ? `${resultado.profundidadeReal.toFixed(1)}m prof.` : null,
  ].filter(Boolean).join(' × ');

  const [modo3D, setModo3D] = useState(false);
  const geometria3D = useMemo(() => {
    const ladoM = Q_INFO[qSize].ladoM;
    if (estrutura === 'torre') return buildTorreGeometry3D(resultado.alturaReal ?? altura, ladoM, resultado.jointsM ?? []);
    if (estrutura === 'vao') return buildVaoGeometry3D(resultado.vaoReal ?? vao, ladoM, resultado.jointsM ?? []);
    if (estrutura === 'box') {
      return buildBoxGeometry3D(
        resultado.alturaReal ?? altura, resultado.larguraReal ?? boxLargura, resultado.profundidadeReal ?? boxProfundidade, ladoM,
        resultado.jointsAltura ?? [], resultado.jointsLargura ?? [], resultado.jointsProfundidade ?? []
      );
    }
    return buildPortalGeometry3D(resultado.alturaReal ?? altura, resultado.vaoReal ?? vao, ladoM, resultado.jointsAltura ?? [], resultado.jointsVao ?? []);
  }, [estrutura, resultado, altura, vao, boxLargura, boxProfundidade, qSize]);

  // -------- Montagem Livre --------
  const [freeCols, setFreeCols] = useState(10);
  const [freeRows, setFreeRows] = useState(6);
  const [freeModuloM, setFreeModuloM] = useState<number>(1);
  const [freeColsInput, setFreeColsInput] = useState(10);
  const [freeRowsInput, setFreeRowsInput] = useState(6);
  const [freeModuloInput, setFreeModuloInput] = useState<number>(1);
  const [ferramenta, setFerramenta] = useState<Ferramenta>('reta');
  const [retasLivres, setRetasLivres] = useState<Set<string>>(new Set());
  const [diagonaisLivres, setDiagonaisLivres] = useState<Set<string>>(new Set());
  const [nosLivres, setNosLivres] = useState<Record<string, NoAcessorio>>({});
  const [isPaintingFree, setIsPaintingFree] = useState(false);
  const [paintMode, setPaintMode] = useState(true);
  const [freeZoom, setFreeZoom] = useState(1);

  useEffect(() => {
    const stop = () => setIsPaintingFree(false);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  // -------- Salvamento automático no navegador (localStorage) --------
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.projeto === 'string') setProjeto(s.projeto);
        if (typeof s.cliente === 'string') setCliente(s.cliente);
        if (s.qSize) setQSize(s.qSize);
        if (s.estrutura) setEstrutura(s.estrutura);
        if (typeof s.altura === 'number') setAltura(s.altura);
        if (typeof s.vao === 'number') setVao(s.vao);
        if (typeof s.numTorres === 'number') setNumTorres(s.numTorres);
        if (typeof s.numVaos === 'number') setNumVaos(s.numVaos);
        if (typeof s.boxLargura === 'number') setBoxLargura(s.boxLargura);
        if (typeof s.boxProfundidade === 'number') setBoxProfundidade(s.boxProfundidade);
        if (typeof s.cargaEquipamentosKg === 'number') setCargaEquipamentosKg(s.cargaEquipamentosKg);
        if (typeof s.freeCols === 'number') { setFreeCols(s.freeCols); setFreeColsInput(s.freeCols); }
        if (typeof s.freeRows === 'number') { setFreeRows(s.freeRows); setFreeRowsInput(s.freeRows); }
        if (typeof s.freeModuloM === 'number') { setFreeModuloM(s.freeModuloM); setFreeModuloInput(s.freeModuloM); }
        if (Array.isArray(s.retasLivres)) setRetasLivres(new Set(s.retasLivres));
        if (Array.isArray(s.diagonaisLivres)) setDiagonaisLivres(new Set(s.diagonaisLivres));
        if (s.nosLivres && typeof s.nosLivres === 'object') setNosLivres(s.nosLivres);
        if (typeof s.freeZoom === 'number') setFreeZoom(s.freeZoom);
      }
    } catch {
      // localStorage indisponível ou dado corrompido — segue com os padrões
    }
    setHidratado(true);
  }, []);

  useEffect(() => {
    if (!hidratado) return;
    const timeout = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          projeto, cliente, qSize, estrutura, altura, vao, numTorres, numVaos,
          boxLargura, boxProfundidade, cargaEquipamentosKg,
          freeCols, freeRows, freeModuloM,
          retasLivres: Array.from(retasLivres), diagonaisLivres: Array.from(diagonaisLivres), nosLivres, freeZoom,
        }));
      } catch {
        // localStorage indisponível (modo privado, cota excedida) — ignora silenciosamente
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [hidratado, projeto, cliente, qSize, estrutura, altura, vao, numTorres, numVaos, boxLargura, boxProfundidade, cargaEquipamentosKg, freeCols, freeRows, freeModuloM, retasLivres, diagonaisLivres, nosLivres, freeZoom]);

  const novoProjeto = () => {
    if (!window.confirm('Isso apaga o projeto atual (Montador e Montagem Livre) salvo neste navegador. Continuar?')) return;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignora */ }
    setProjeto(''); setCliente('');
    setQSize('Q30'); setEstrutura('torre'); setAltura(3); setVao(6); setNumTorres(1); setNumVaos(1);
    setBoxLargura(4); setBoxProfundidade(3); setCargaEquipamentosKg(0);
    setFreeCols(10); setFreeRows(6); setFreeModuloM(1);
    setFreeColsInput(10); setFreeRowsInput(6); setFreeModuloInput(1);
    setRetasLivres(new Set()); setDiagonaisLivres(new Set()); setNosLivres({});
    setFreeZoom(1);
  };

  const gridGeom = useMemo(() => buildGridGeom(freeCols, freeRows), [freeCols, freeRows]);
  const autoConexoes = useMemo(() => computeConexoesAutomaticas(freeCols, freeRows, retasLivres), [freeCols, freeRows, retasLivres]);
  const geometriaLivre3D = useMemo(
    () => buildLivreGeometry3D(freeCols, freeRows, freeModuloM, retasLivres, diagonaisLivres, autoConexoes.nodes, nosLivres),
    [freeCols, freeRows, freeModuloM, retasLivres, diagonaisLivres, autoConexoes, nosLivres]
  );

  const aplicarNovaGradeLivre = () => {
    setFreeCols(Math.min(24, Math.max(1, Math.round(freeColsInput))));
    setFreeRows(Math.min(16, Math.max(1, Math.round(freeRowsInput))));
    setFreeModuloM(freeModuloInput);
    setRetasLivres(new Set());
    setDiagonaisLivres(new Set());
    setNosLivres({});
  };

  const limparLivre = () => {
    setRetasLivres(new Set());
    setDiagonaisLivres(new Set());
    setNosLivres({});
  };

  const handleEdgeMouseDown = (id: string) => {
    if (ferramenta === 'reta') {
      const novoEstado = !retasLivres.has(id);
      setPaintMode(novoEstado);
      setIsPaintingFree(true);
      setRetasLivres(prev => { const n = new Set(prev); if (novoEstado) n.add(id); else n.delete(id); return n; });
    } else if (ferramenta === 'apagar') {
      setIsPaintingFree(true);
      setRetasLivres(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleEdgeMouseEnter = (id: string) => {
    if (!isPaintingFree) return;
    if (ferramenta === 'reta') {
      setRetasLivres(prev => { if (prev.has(id) === paintMode) return prev; const n = new Set(prev); if (paintMode) n.add(id); else n.delete(id); return n; });
    } else if (ferramenta === 'apagar') {
      setRetasLivres(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleDiagonalClick = (id: string) => {
    if (ferramenta === 'diagonal') {
      setDiagonaisLivres(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    } else if (ferramenta === 'apagar') {
      setDiagonaisLivres(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleNodeClick = (id: string) => {
    if (ferramenta === 'apagar') {
      setNosLivres(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    if (ferramenta === 'reta' || ferramenta === 'diagonal') return;
    const tipo = ferramenta;
    setNosLivres(prev => {
      const n = { ...prev };
      if (n[id] === tipo) delete n[id]; else n[id] = tipo;
      return n;
    });
  };

  const materiaisLivres = useMemo(() => {
    const info = Q_INFO[qSize];
    const contagemNos: Partial<Record<NoAcessorio, number>> = {};
    Object.values(nosLivres).forEach(t => { contagemNos[t] = (contagemNos[t] ?? 0) + 1; });
    const numRetas = retasLivres.size;
    const numDiag = diagonaisLivres.size;
    const pesoRetas = numRetas * freeModuloM * info.kgPerM;
    const pesoDiag = numDiag * info.diagonalKg;
    const pesoCubos = autoConexoes.cubos * info.cuboKg;
    const pesoSleeves = autoConexoes.sleeves * info.sleeveKg;
    const pesoSapatas = (contagemNos.sapata ?? 0) * info.sapataKg;
    const pesoTotal = pesoRetas + pesoDiag + pesoCubos + pesoSleeves + pesoSapatas;
    return { numRetas, numDiag, contagemNos, pesoTotal };
  }, [retasLivres, diagonaisLivres, nosLivres, qSize, freeModuloM, autoConexoes]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 px-4 md:px-8 py-6 bg-[#F0F4F8] text-[#0F172A] min-h-screen font-sans print:bg-white print:text-black print:block print:p-0">
      <Analytics />

      {/* SIDEBAR */}
      <aside className="w-full lg:w-[400px] flex-shrink-0 flex flex-col gap-4 print:hidden">
        <div className="bg-[#0C1D4D] p-5 rounded-2xl shadow-md text-white">
          <h1 className="text-xl font-black uppercase tracking-widest leading-tight">Engenharia Boxtruss</h1>
          <p className="text-blue-300 text-xs mt-1">Catálogo de Peças e Montador de Estrutura</p>
        </div>

        {/* Abas */}
        <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setAba('catalogo')} className={`py-2.5 text-[9px] md:text-[10px] font-black uppercase rounded ${aba === 'catalogo' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Catálogo</button>
          <button onClick={() => setAba('montador')} className={`py-2.5 text-[9px] md:text-[10px] font-black uppercase rounded ${aba === 'montador' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Montador</button>
          <button onClick={() => setAba('livre')} className={`py-2.5 text-[9px] md:text-[10px] font-black uppercase rounded ${aba === 'livre' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Montagem Livre</button>
        </div>

        <button onClick={novoProjeto} className="w-full bg-white border border-gray-200 text-gray-500 py-2 rounded-xl font-black uppercase text-[9px] tracking-widest hover:border-red-300 hover:text-red-500 transition-colors">
          Novo Projeto (apaga o salvo neste navegador)
        </button>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-5">
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">1. Dados do Projeto</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Projeto / Evento</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold uppercase focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} /></div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Cliente</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
            </div>
            <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mt-2">Salvo automaticamente neste navegador.</p>
          </div>

          {aba === 'montador' && (
            <>
              <div>
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">2. Tipo de Estrutura</h3>
                <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg mb-3">
                  <button onClick={() => setEstrutura('torre')} className={`py-2 text-[9px] font-black uppercase rounded ${estrutura === 'torre' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Torre</button>
                  <button onClick={() => setEstrutura('vao')} className={`py-2 text-[9px] font-black uppercase rounded ${estrutura === 'vao' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Vão / Viga</button>
                  <button onClick={() => setEstrutura('portal')} className={`py-2 text-[9px] font-black uppercase rounded ${estrutura === 'portal' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Portal</button>
                  <button onClick={() => setEstrutura('box')} className={`py-2 text-[9px] font-black uppercase rounded ${estrutura === 'box' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Box / Estande</button>
                </div>

                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Tamanho da Treliça (Q)</label>
                <select className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-[#0C1D4D] font-bold focus:border-[#336699] outline-none cursor-pointer mb-3" value={qSize} onChange={(e) => setQSize(e.target.value as QSize)}>
                  {Q_SIZES.map(q => <option key={q} value={q}>{Q_INFO[q].label}</option>)}
                </select>

                {(estrutura === 'torre' || estrutura === 'portal') && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Altura da Torre (m)</label>
                      <input type="number" min="1" step="0.5" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={altura} onChange={(e) => setAltura(parseFloat(e.target.value) || 1)} />
                    </div>
                    {estrutura === 'torre' && (
                      <div>
                        <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Qtd. de Torres</label>
                        <input type="number" min="1" step="1" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={numTorres} onChange={(e) => setNumTorres(parseInt(e.target.value) || 1)} />
                      </div>
                    )}
                  </div>
                )}

                {(estrutura === 'vao' || estrutura === 'portal') && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">{estrutura === 'portal' ? 'Vão entre Torres (m)' : 'Comprimento do Vão (m)'}</label>
                      <input type="number" min="0.5" step="0.5" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={vao} onChange={(e) => setVao(parseFloat(e.target.value) || 0.5)} />
                    </div>
                    {estrutura === 'vao' && (
                      <div>
                        <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Qtd. de Vãos</label>
                        <input type="number" min="1" step="1" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={numVaos} onChange={(e) => setNumVaos(parseInt(e.target.value) || 1)} />
                      </div>
                    )}
                  </div>
                )}

                {estrutura === 'box' && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Altura (m)</label>
                      <input type="number" min="1" step="0.5" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={altura} onChange={(e) => setAltura(parseFloat(e.target.value) || 1)} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Largura (m)</label>
                      <input type="number" min="0.5" step="0.5" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={boxLargura} onChange={(e) => setBoxLargura(parseFloat(e.target.value) || 0.5)} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Profund. (m)</label>
                      <input type="number" min="0.5" step="0.5" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={boxProfundidade} onChange={(e) => setBoxProfundidade(parseFloat(e.target.value) || 0.5)} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">3. Içamento</h3>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Carga de equipamentos (áudio/vídeo/luz) somada à estrutura (kg)</label>
                <input type="number" min="0" step="10" className="w-full p-2 border border-gray-300 rounded text-sm font-bold focus:border-[#336699] outline-none" value={cargaEquipamentosKg} onChange={(e) => setCargaEquipamentosKg(parseFloat(e.target.value) || 0)} />
                <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
                  <div className="bg-gray-50 rounded-lg p-2">
                    <span className="block text-gray-500 uppercase font-bold">Peso da estrutura</span>
                    <strong className="text-[#0C1D4D]">{resultado.pesoTotal.toFixed(0)} kg</strong>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <span className="block text-gray-500 uppercase font-bold">Carga por ponto</span>
                    <strong className="text-[#0C1D4D]">{cargaPorPontoKg.toFixed(0)} kg</strong>
                  </div>
                </div>
                <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mt-2">(Estrutura + equipamentos) ÷ {pontosIcamento} ponto(s) define a talha e o pau de carga recomendados.</p>
              </div>

              <button onClick={() => window.print()} className="w-full bg-[#0C1D4D] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-[#284B8C] shadow-md transition-colors">
                🖨️ Gerar PDF / Imprimir
              </button>
            </>
          )}

          {aba === 'livre' && (
            <>
              <div>
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">2. Grade de Montagem</h3>

                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Tamanho da Treliça (Q)</label>
                <select className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-[#0C1D4D] font-bold focus:border-[#336699] outline-none cursor-pointer mb-3" value={qSize} onChange={(e) => setQSize(e.target.value as QSize)}>
                  {Q_SIZES.map(q => <option key={q} value={q}>{Q_INFO[q].label}</option>)}
                </select>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Colunas</label>
                    <input type="number" min="1" max="24" step="1" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={freeColsInput} onChange={(e) => setFreeColsInput(parseInt(e.target.value) || 1)} />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">Linhas</label>
                    <input type="number" min="1" max="16" step="1" className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={freeRowsInput} onChange={(e) => setFreeRowsInput(parseInt(e.target.value) || 1)} />
                  </div>
                </div>

                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Módulo de Cada Reta</label>
                <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg mb-3">
                  <button onClick={() => setFreeModuloInput(0.5)} className={`py-1.5 text-[10px] font-black uppercase rounded ${freeModuloInput === 0.5 ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>0,5 m</button>
                  <button onClick={() => setFreeModuloInput(1)} className={`py-1.5 text-[10px] font-black uppercase rounded ${freeModuloInput === 1 ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>1,0 m</button>
                </div>

                <button onClick={aplicarNovaGradeLivre} className="w-full bg-[#16A34A] text-white p-3 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#15803D] transition-all shadow-sm mb-2">
                  Aplicar Nova Grade
                </button>
                <button onClick={limparLivre} className="w-full bg-red-50 text-red-600 border border-red-200 p-2.5 rounded-xl font-black uppercase text-[10px] tracking-wider hover:bg-red-100 transition-all">
                  Limpar Tudo
                </button>
              </div>

              <button onClick={() => window.print()} className="w-full bg-[#0C1D4D] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-[#284B8C] shadow-md transition-colors">
                🖨️ Gerar PDF / Imprimir
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <main className="flex-grow flex flex-col gap-4 relative print:bg-white print:p-8 overflow-y-auto">

        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-2 flex-shrink-0">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Estrutura Boxtruss — {aba === 'livre' ? 'Montagem Livre' : estrutura === 'torre' ? 'Torre' : estrutura === 'vao' ? 'Vão / Viga' : estrutura === 'box' ? 'Box / Estande' : 'Portal'}</h2>
            <p className="text-sm font-bold text-gray-600 mt-1">Data: {new Date().toLocaleDateString('pt-BR')}</p>
          </div>
        </div>
        <div className="hidden print:grid grid-cols-2 gap-4 mb-2 border-b border-gray-300 pb-4 flex-shrink-0">
          <div><span className="block text-[10px] text-gray-500 uppercase font-bold">Projeto / Evento:</span><strong className="text-base text-black">{projeto || '---'}</strong></div>
          <div><span className="block text-[10px] text-gray-500 uppercase font-bold">Cliente:</span><strong className="text-base text-black">{cliente || '---'}</strong></div>
        </div>

        {aba === 'catalogo' && (
          <>
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm flex-shrink-0">
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-tight">Catálogo Técnico de Peças</h2>
              <p className="text-xs text-[#64748B] font-medium mt-1">Desenhos de referência para apresentação ao cliente. Pesos por tamanho de treliça (Q15 / Q25 / Q30 / Q50).</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {CATALOGO.map(item => (
                <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex flex-col">
                  <div className="text-[9px] font-black uppercase text-[#336699] mb-2 tracking-widest">{item.categoria}</div>
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 mb-3 flex items-center justify-center">
                    <item.Icon />
                  </div>
                  <h3 className="text-sm font-black text-[#0C1D4D] mb-1">{item.nome}</h3>
                  <p className="text-xs text-[#64748B] font-medium mb-3 flex-grow">{item.descricao}</p>
                  <div className="border-t border-gray-100 pt-2 space-y-0.5">
                    {item.specs.map((s, i) => (
                      <div key={i} className="text-[10px] font-bold text-[#334155]">{s}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {aba === 'montador' && (
          <>
            {/* MÉTRICAS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0 print:gap-3">
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#0C1D4D] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Peso Total Estimado</span>
                <strong className="block text-lg text-[#0C1D4D] font-black print:text-black">{resultado.pesoTotal.toFixed(0)} kg</strong>
                <span className="text-[9px] font-bold text-[#336699] uppercase print:text-gray-500">{qSize}</span>
              </div>
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Dimensões</span>
                <strong className="block text-lg text-[#336699] font-black print:text-black">{dimensoesLabel}</strong>
                <span className="text-[9px] font-bold text-[#336699] uppercase print:text-gray-500">Arredondado p/ módulo de 0,5m</span>
              </div>
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#16A34A] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Retas / Cubos</span>
                <strong className="block text-lg text-[#16A34A] font-black print:text-black">{totalRetas} / {resultado.cubos}</strong>
                <span className="text-[9px] font-bold text-[#16A34A] uppercase print:text-gray-500">Sleeves: {resultado.sleeves}</span>
              </div>
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-amber-500 p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Içamento Recomendado</span>
                <strong className="block text-sm text-amber-600 font-black print:text-black">CM {talha.capKg}kg{pauCarga ? ` · PC ${pauCarga.comprimentoM}m` : ''}</strong>
                <span className="text-[9px] font-bold text-amber-600 uppercase print:text-gray-500">{pontosIcamento} ponto(s)</span>
              </div>
            </div>

            {/* DESENHO ESQUEMÁTICO */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 flex-shrink-0 print:border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs">Desenho Esquemático — {estrutura === 'torre' ? `Torre ${qSize}` : estrutura === 'vao' ? `Vão ${qSize}` : estrutura === 'box' ? `Box ${qSize}` : `Portal ${qSize}`}</h3>
                <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg print:hidden">
                  <button onClick={() => setModo3D(false)} className={`px-3 py-1 text-[9px] font-black uppercase rounded ${!modo3D ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>2D</button>
                  <button onClick={() => setModo3D(true)} className={`px-3 py-1 text-[9px] font-black uppercase rounded ${modo3D ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>3D</button>
                </div>
              </div>

              <div className={`${modo3D ? 'hidden print:block' : 'block'} bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:32px_32px] print:bg-none rounded-xl`}>
                {estrutura === 'torre' && (
                  <div className="flex justify-center">
                    <div className="w-40">
                      <TorreSVG alturaM={resultado.alturaReal ?? altura} jointsM={resultado.jointsM ?? []} />
                      <p className="text-center text-xs font-black text-[#0C1D4D] mt-1">{(resultado.alturaReal ?? altura).toFixed(1)}m</p>
                    </div>
                  </div>
                )}

                {estrutura === 'vao' && (
                  <div className="flex flex-col items-center">
                    <VaoSVG vaoM={resultado.vaoReal ?? vao} jointsM={resultado.jointsM ?? []} />
                    <p className="text-center text-xs font-black text-[#0C1D4D] mt-1">{(resultado.vaoReal ?? vao).toFixed(1)}m</p>
                  </div>
                )}

                {estrutura === 'portal' && (
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-full max-w-md">
                      <VaoSVG vaoM={resultado.vaoReal ?? vao} jointsM={resultado.jointsVao ?? []} />
                    </div>
                    <div className="flex justify-between w-full max-w-md -mt-2">
                      <div className="w-28"><TorreSVG alturaM={resultado.alturaReal ?? altura} jointsM={resultado.jointsAltura ?? []} /></div>
                      <div className="w-28"><TorreSVG alturaM={resultado.alturaReal ?? altura} jointsM={resultado.jointsAltura ?? []} /></div>
                    </div>
                    <p className="text-center text-xs font-black text-[#0C1D4D]">{(resultado.alturaReal ?? altura).toFixed(1)}m alt. × {(resultado.vaoReal ?? vao).toFixed(1)}m vão</p>
                  </div>
                )}

                {estrutura === 'box' && (
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-64">
                      <BoxSVG alturaM={resultado.alturaReal ?? altura} larguraM={resultado.larguraReal ?? boxLargura} profundidadeM={resultado.profundidadeReal ?? boxProfundidade} />
                    </div>
                    <p className="text-center text-xs font-black text-[#0C1D4D]">{(resultado.alturaReal ?? altura).toFixed(1)}m alt. × {(resultado.larguraReal ?? boxLargura).toFixed(1)}m larg. × {(resultado.profundidadeReal ?? boxProfundidade).toFixed(1)}m prof.</p>
                  </div>
                )}
              </div>

              <div className={`${modo3D ? 'block' : 'hidden'} print:hidden`}>
                <div className="h-[420px] rounded-xl overflow-hidden border border-[#E2E8F0]">
                  <MontadorTruss3D geometry={geometria3D} ladoM={Q_INFO[qSize].ladoM} />
                </div>
                <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mt-2 text-center">Arraste para rotacionar · scroll para zoom · visualização esquemática, não substitui o memorial de cálculo</p>
              </div>
            </div>

            {/* LISTA DE MATERIAIS */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 flex-grow print:border">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs mb-3">Lista de Material Estimada</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-[#0C1D4D] text-left">
                    <th className="py-2 font-black text-[#0C1D4D] uppercase text-[10px]">Peça</th>
                    <th className="py-2 font-black text-[#0C1D4D] uppercase text-[10px] text-right">Qtd.</th>
                    <th className="py-2 font-black text-[#0C1D4D] uppercase text-[10px] text-right">Peso (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {materiais.map((m, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 font-bold text-[#334155]">{m.nome} <span className="text-[#94A3B8] font-medium">({qSize})</span></td>
                      <td className="py-2 text-right font-black text-[#0C1D4D]">{m.qtd} {m.unidade}</td>
                      <td className="py-2 text-right font-medium text-[#64748B]">{m.pesoTotalKg.toFixed(1)}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-gray-100">
                    <td className="py-2 font-bold text-[#334155]">Talha CM {talha.capKg}kg</td>
                    <td className="py-2 text-right font-black text-[#0C1D4D]">{pontosIcamento} pç</td>
                    <td className="py-2 text-right font-medium text-[#64748B]">{(talha.pesoKg * pontosIcamento).toFixed(1)}</td>
                  </tr>
                  {pauCarga && (
                    <tr>
                      <td className="py-2 font-bold text-[#334155]">Pau de Carga {pauCarga.comprimentoM}m (WLL {pauCarga.wllKg}kg)</td>
                      <td className="py-2 text-right font-black text-[#0C1D4D]">{pontosIcamento} pç</td>
                      <td className="py-2 text-right font-medium text-[#64748B]">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="text-[10px] text-[#94A3B8] font-medium mt-3 border-t border-gray-100 pt-2">
                * Valores de peso e quantidades são estimativas comerciais baseadas em médias de mercado por tamanho de treliça. Validar cargas, WLL e memorial de cálculo com engenharia responsável antes da execução.
              </p>
            </div>
          </>
        )}

        {aba === 'livre' && (
          <>
            {/* PALETA DE PEÇAS */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 flex-shrink-0 print:hidden">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs mb-3">Selecione a Peça e Clique no Grid</h3>
              <div className="flex flex-wrap gap-2">
                {FERRAMENTAS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFerramenta(f.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-wide transition-colors ${ferramenta === f.id ? 'text-white' : 'bg-white text-[#334155] border-gray-200 hover:border-[#336699]'}`}
                    style={ferramenta === f.id ? { backgroundColor: f.cor, borderColor: f.cor } : undefined}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: f.cor }} />
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mt-3">
                {ferramenta === 'reta' && 'Clique e arraste sobre as bordas do grid para desenhar retas.'}
                {ferramenta === 'diagonal' && 'Clique dentro de um módulo, na diagonal desejada, para adicionar um contraventamento.'}
                {ferramenta === 'apagar' && 'Clique (ou clique e arraste) sobre uma reta, diagonal ou nó para remover a peça.'}
                {(ferramenta === 'sapata' || ferramenta === 'talha' || ferramenta === 'pauCarga') && 'Clique num nó (interseção) do grid para posicionar essa peça.'}
              </p>
              <p className="text-[9px] text-gray-400 tracking-widest font-bold mt-1">Cubos e sleeves são calculados automaticamente a partir da geometria das retas — não precisam ser marcados.</p>
            </div>

            {/* MÉTRICAS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0 print:gap-3">
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#0C1D4D] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Peso Total Estimado</span>
                <strong className="block text-lg text-[#0C1D4D] font-black print:text-black">{materiaisLivres.pesoTotal.toFixed(0)} kg</strong>
                <span className="text-[9px] font-bold text-[#336699] uppercase print:text-gray-500">{qSize} · módulo {freeModuloM.toFixed(1)}m</span>
              </div>
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Retas / Diagonais</span>
                <strong className="block text-lg text-[#336699] font-black print:text-black">{materiaisLivres.numRetas} / {materiaisLivres.numDiag}</strong>
                <span className="text-[9px] font-bold text-[#336699] uppercase print:text-gray-500">Grade {freeCols} × {freeRows} módulos</span>
              </div>
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#16A34A] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Cubos / Sleeves / Sapatas</span>
                <strong className="block text-lg text-[#16A34A] font-black print:text-black">{autoConexoes.cubos} / {autoConexoes.sleeves} / {materiaisLivres.contagemNos.sapata ?? 0}</strong>
                <span className="text-[9px] font-bold text-[#16A34A] uppercase print:text-gray-500">Cubo/sleeve automáticos</span>
              </div>
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-amber-500 p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Talhas / Pau de Carga</span>
                <strong className="block text-lg text-amber-600 font-black print:text-black">{materiaisLivres.contagemNos.talha ?? 0} / {materiaisLivres.contagemNos.pauCarga ?? 0}</strong>
              </div>
            </div>

            {/* CANVAS */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 flex-grow flex flex-col gap-2 print:border">
              <div className="flex items-center justify-between gap-1 print:hidden">
                <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg">
                  <button onClick={() => setModo3D(false)} className={`px-3 py-1 text-[9px] font-black uppercase rounded ${!modo3D ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>2D</button>
                  <button onClick={() => setModo3D(true)} className={`px-3 py-1 text-[9px] font-black uppercase rounded ${modo3D ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>3D</button>
                </div>
                {!modo3D && (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mr-1">Zoom</span>
                    <button onClick={() => setFreeZoom(z => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} className="w-7 h-7 rounded-lg border border-gray-200 text-[#0C1D4D] font-black hover:bg-gray-100">−</button>
                    <button onClick={() => setFreeZoom(1)} className="px-2 h-7 rounded-lg border border-gray-200 text-[10px] font-black text-[#0C1D4D] hover:bg-gray-100">{Math.round(freeZoom * 100)}%</button>
                    <button onClick={() => setFreeZoom(z => Math.min(2, Math.round((z + 0.1) * 10) / 10))} className="w-7 h-7 rounded-lg border border-gray-200 text-[#0C1D4D] font-black hover:bg-gray-100">+</button>
                  </div>
                )}
              </div>

              {modo3D && (
                <div className="print:hidden">
                  <div className="h-[420px] rounded-xl overflow-hidden border border-[#E2E8F0]">
                    <LivreTruss3D geometry={geometriaLivre3D} ladoM={Q_INFO[qSize].ladoM} />
                  </div>
                  <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mt-2 text-center">Arraste para rotacionar · scroll para zoom · visualização esquemática, não substitui o memorial de cálculo</p>
                </div>
              )}

              <div className={`${modo3D ? 'hidden print:block' : 'block'} overflow-auto bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:22px_22px] rounded-xl print:bg-none`}>
              <svg
                width={gridGeom.width * freeZoom}
                height={gridGeom.height * freeZoom}
                viewBox={`0 0 ${gridGeom.width} ${gridGeom.height}`}
                className="select-none"
                onDragStart={(e) => e.preventDefault()}
              >
                {/* Retas (horizontais + verticais) */}
                {[...gridGeom.hEdges, ...gridGeom.vEdges].map(e => {
                  const ativo = retasLivres.has(e.id);
                  return (
                    <g key={e.id}>
                      <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={ativo ? '#0C1D4D' : '#CBD5E1'} strokeWidth={ativo ? 5 : 1.5} strokeDasharray={ativo ? undefined : '3 4'} strokeLinecap="round" pointerEvents="none" />
                      <line
                        x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                        stroke="transparent" strokeWidth={16}
                        style={{ cursor: ferramenta === 'reta' || ferramenta === 'apagar' ? 'pointer' : 'default' }}
                        onMouseDown={() => handleEdgeMouseDown(e.id)}
                        onMouseEnter={() => handleEdgeMouseEnter(e.id)}
                      />
                    </g>
                  );
                })}

                {/* Diagonais */}
                {gridGeom.cells.map(c => {
                  const d1Ativo = diagonaisLivres.has(c.d1);
                  const d2Ativo = diagonaisLivres.has(c.d2);
                  return (
                    <g key={c.id}>
                      <line x1={c.x} y1={c.y} x2={c.x + CELL} y2={c.y + CELL} stroke={d1Ativo ? '#336699' : 'transparent'} strokeWidth={d1Ativo ? 3 : 0} strokeDasharray="5 3" strokeLinecap="round" pointerEvents="none" />
                      <line
                        x1={c.x} y1={c.y} x2={c.x + CELL} y2={c.y + CELL}
                        stroke="transparent" strokeWidth={10}
                        style={{ cursor: ferramenta === 'diagonal' || ferramenta === 'apagar' ? 'pointer' : 'default' }}
                        onClick={() => handleDiagonalClick(c.d1)}
                      />
                      <line x1={c.x} y1={c.y + CELL} x2={c.x + CELL} y2={c.y} stroke={d2Ativo ? '#336699' : 'transparent'} strokeWidth={d2Ativo ? 3 : 0} strokeDasharray="5 3" strokeLinecap="round" pointerEvents="none" />
                      <line
                        x1={c.x} y1={c.y + CELL} x2={c.x + CELL} y2={c.y}
                        stroke="transparent" strokeWidth={10}
                        style={{ cursor: ferramenta === 'diagonal' || ferramenta === 'apagar' ? 'pointer' : 'default' }}
                        onClick={() => handleDiagonalClick(c.d2)}
                      />
                    </g>
                  );
                })}

                {/* Cubo / Sleeve — inferidos automaticamente pela geometria das retas */}
                {autoConexoes.nodes.map(n => {
                  const meta = AUTO_CONEXAO_META[n.tipo];
                  const x = OFFSET + n.c * CELL, y = OFFSET + n.r * CELL;
                  return (
                    <g key={`auto-${n.id}`} pointerEvents="none">
                      <circle cx={x} cy={y} r={7} fill={meta.cor} stroke="#fff" strokeWidth={1.5} opacity={0.9} />
                      <text x={x} y={y + 3} fontSize={7.5} textAnchor="middle" fill="#fff" fontWeight={700}>{meta.letra}</text>
                    </g>
                  );
                })}

                {/* Nós (sapata / talha / pau de carga — posicionados manualmente) */}
                {gridGeom.nodes.map(n => {
                  const acc = nosLivres[n.id];
                  const meta = acc ? NODE_META[acc] : null;
                  return (
                    <g key={n.id}>
                      {meta && <circle cx={n.x} cy={n.y} r={8} fill={meta.cor} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />}
                      {meta && <text x={n.x} y={n.y + 3} fontSize={8} textAnchor="middle" fill="#fff" fontWeight={700} pointerEvents="none">{meta.letra}</text>}
                      <circle
                        cx={n.x} cy={n.y} r={13} fill="transparent"
                        style={{ cursor: ferramenta === 'reta' || ferramenta === 'diagonal' ? 'default' : 'pointer' }}
                        onClick={() => handleNodeClick(n.id)}
                      />
                    </g>
                  );
                })}
              </svg>
              </div>
            </div>

            {/* LEGENDA */}
            <div className="hidden print:grid grid-cols-5 gap-2 flex-shrink-0">
              {(['cubo', 'sleeve'] as const).map(k => (
                <div key={k} className="flex items-center gap-1.5 text-[9px] font-bold text-gray-700">
                  <span className="w-3 h-3 rounded-full flex items-center justify-center text-white text-[7px]" style={{ backgroundColor: AUTO_CONEXAO_META[k].cor }}>{AUTO_CONEXAO_META[k].letra}</span>
                  {AUTO_CONEXAO_META[k].nome}
                </div>
              ))}
              {(Object.keys(NODE_META) as NoAcessorio[]).map(k => (
                <div key={k} className="flex items-center gap-1.5 text-[9px] font-bold text-gray-700">
                  <span className="w-3 h-3 rounded-full flex items-center justify-center text-white text-[7px]" style={{ backgroundColor: NODE_META[k].cor }}>{NODE_META[k].letra}</span>
                  {NODE_META[k].nome}
                </div>
              ))}
            </div>

            {/* PEÇAS UTILIZADAS */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 print:border">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs mb-3">Peças Utilizadas</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-[#0C1D4D] text-left">
                    <th className="py-2 font-black text-[#0C1D4D] uppercase text-[10px]">Peça</th>
                    <th className="py-2 font-black text-[#0C1D4D] uppercase text-[10px] text-right">Qtd.</th>
                    <th className="py-2 font-black text-[#0C1D4D] uppercase text-[10px] text-right">Peso (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {materiaisLivres.numRetas > 0 && (
                    <tr className="border-b border-gray-100">
                      <td className="py-2 font-bold text-[#334155]">Reta {freeModuloM.toFixed(1)}m <span className="text-[#94A3B8] font-medium">({qSize})</span></td>
                      <td className="py-2 text-right font-black text-[#0C1D4D]">{materiaisLivres.numRetas} pç</td>
                      <td className="py-2 text-right font-medium text-[#64748B]">{(materiaisLivres.numRetas * freeModuloM * Q_INFO[qSize].kgPerM).toFixed(1)}</td>
                    </tr>
                  )}
                  {materiaisLivres.numDiag > 0 && (
                    <tr className="border-b border-gray-100">
                      <td className="py-2 font-bold text-[#334155]">Diagonal (contraventamento) <span className="text-[#94A3B8] font-medium">({qSize})</span></td>
                      <td className="py-2 text-right font-black text-[#0C1D4D]">{materiaisLivres.numDiag} pç</td>
                      <td className="py-2 text-right font-medium text-[#64748B]">{(materiaisLivres.numDiag * Q_INFO[qSize].diagonalKg).toFixed(1)}</td>
                    </tr>
                  )}
                  {autoConexoes.cubos > 0 && (
                    <tr className="border-b border-gray-100">
                      <td className="py-2 font-bold text-[#334155]">Cubo (peça de canto) <span className="text-[#94A3B8] font-medium">({qSize}) · sugestão automática</span></td>
                      <td className="py-2 text-right font-black text-[#0C1D4D]">{autoConexoes.cubos} pç</td>
                      <td className="py-2 text-right font-medium text-[#64748B]">{(autoConexoes.cubos * Q_INFO[qSize].cuboKg).toFixed(1)}</td>
                    </tr>
                  )}
                  {autoConexoes.sleeves > 0 && (
                    <tr className="border-b border-gray-100">
                      <td className="py-2 font-bold text-[#334155]">Sleeve (luva de emenda) <span className="text-[#94A3B8] font-medium">({qSize}) · sugestão automática</span></td>
                      <td className="py-2 text-right font-black text-[#0C1D4D]">{autoConexoes.sleeves} pç</td>
                      <td className="py-2 text-right font-medium text-[#64748B]">{(autoConexoes.sleeves * Q_INFO[qSize].sleeveKg).toFixed(1)}</td>
                    </tr>
                  )}
                  {(Object.keys(NODE_META) as NoAcessorio[]).map(tipo => {
                    const qtd = materiaisLivres.contagemNos[tipo] ?? 0;
                    if (!qtd) return null;
                    const pesoUnit = tipo === 'sapata' ? Q_INFO[qSize].sapataKg : null;
                    return (
                      <tr key={tipo} className="border-b border-gray-100">
                        <td className="py-2 font-bold text-[#334155]">{NODE_META[tipo].nome} {pesoUnit !== null && <span className="text-[#94A3B8] font-medium">({qSize})</span>}</td>
                        <td className="py-2 text-right font-black text-[#0C1D4D]">{qtd} pç</td>
                        <td className="py-2 text-right font-medium text-[#64748B]">{pesoUnit !== null ? (qtd * pesoUnit).toFixed(1) : '—'}</td>
                      </tr>
                    );
                  })}
                  {materiaisLivres.numRetas === 0 && materiaisLivres.numDiag === 0 && autoConexoes.cubos === 0 && autoConexoes.sleeves === 0 && Object.keys(materiaisLivres.contagemNos).length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-center text-[#94A3B8] font-bold uppercase text-[10px]">Nenhuma peça posicionada ainda</td></tr>
                  )}
                </tbody>
              </table>
              <p className="text-[10px] text-[#94A3B8] font-medium mt-3 border-t border-gray-100 pt-2">
                * Talha e Pau de Carga são equipamentos de içamento (não somam ao peso da estrutura). Valores estimados — validar com engenharia antes da execução.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
