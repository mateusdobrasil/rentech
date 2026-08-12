"use client";

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Analytics } from "@vercel/analytics/next";
import logoColorido from '../../../app/imgs/logo.png';

// ============================================================================
// DADOS DE ENGENHARIA (valores médios de mercado — validar com engenharia antes da execução)
// ============================================================================
type QSize = 'Q15' | 'Q25' | 'Q30' | 'Q50';
type StructureType = 'torre' | 'vao' | 'portal';

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
  jointsM?: number[];
  jointsAltura?: number[];
  jointsVao?: number[];
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

// ============================================================================
// ÍCONES TÉCNICOS (SVG estilo "desenho de linha")
// ============================================================================
function IconWrap({ children, viewBox }: { children: React.ReactNode; viewBox: string }) {
  return (
    <svg viewBox={viewBox} className="w-full h-24 md:h-28" fill="none">
      {children}
    </svg>
  );
}

function StraightIcon() {
  return (
    <IconWrap viewBox="0 0 240 70">
      <line x1="15" y1="15" x2="225" y2="15" stroke="#0C1D4D" strokeWidth="3" />
      <line x1="15" y1="55" x2="225" y2="55" stroke="#0C1D4D" strokeWidth="3" />
      {[15, 67, 119, 171].map((x, i) => (
        <line key={`d${i}`} x1={x} y1={i % 2 === 0 ? 15 : 55} x2={x + 52} y2={i % 2 === 0 ? 55 : 15} stroke="#336699" strokeWidth="1.5" strokeDasharray="4 3" />
      ))}
      {[15, 225].map((x, i) => (
        <g key={i}>
          <circle cx={x} cy="15" r="4" fill="#fff" stroke="#0C1D4D" strokeWidth="2" />
          <circle cx={x} cy="55" r="4" fill="#fff" stroke="#0C1D4D" strokeWidth="2" />
        </g>
      ))}
    </IconWrap>
  );
}

function CuboIcon() {
  return (
    <IconWrap viewBox="0 0 100 100">
      <rect x="35" y="35" width="30" height="30" fill="#fff" stroke="#0C1D4D" strokeWidth="3" />
      <line x1="50" y1="5" x2="50" y2="35" stroke="#336699" strokeWidth="4" />
      <line x1="50" y1="65" x2="50" y2="95" stroke="#336699" strokeWidth="4" />
      <line x1="5" y1="50" x2="35" y2="50" stroke="#336699" strokeWidth="4" />
      <line x1="65" y1="50" x2="95" y2="50" stroke="#336699" strokeWidth="4" />
      <circle cx="50" cy="5" r="4" fill="#0C1D4D" />
      <circle cx="50" cy="95" r="4" fill="#0C1D4D" />
      <circle cx="5" cy="50" r="4" fill="#0C1D4D" />
      <circle cx="95" cy="50" r="4" fill="#0C1D4D" />
    </IconWrap>
  );
}

function SleeveIcon() {
  return (
    <IconWrap viewBox="0 0 200 60">
      <line x1="10" y1="30" x2="90" y2="30" stroke="#0C1D4D" strokeWidth="4" />
      <line x1="110" y1="30" x2="190" y2="30" stroke="#0C1D4D" strokeWidth="4" />
      <rect x="80" y="14" width="40" height="32" rx="4" fill="#EFF4FA" stroke="#336699" strokeWidth="2.5" />
      <line x1="88" y1="14" x2="88" y2="46" stroke="#336699" strokeWidth="1" />
      <line x1="100" y1="14" x2="100" y2="46" stroke="#336699" strokeWidth="1" />
      <line x1="112" y1="14" x2="112" y2="46" stroke="#336699" strokeWidth="1" />
    </IconWrap>
  );
}

function SapataIcon() {
  return (
    <IconWrap viewBox="0 0 100 120">
      <line x1="50" y1="5" x2="50" y2="70" stroke="#0C1D4D" strokeWidth="4" />
      <rect x="35" y="70" width="30" height="16" fill="#fff" stroke="#336699" strokeWidth="2.5" />
      <line x1="50" y1="86" x2="50" y2="100" stroke="#336699" strokeWidth="3" />
      <rect x="15" y="100" width="70" height="10" rx="2" fill="#94A3B8" />
    </IconWrap>
  );
}

function TalhaIcon() {
  return (
    <IconWrap viewBox="0 0 80 120">
      <path d="M40 5 a8 8 0 1 0 0.1 0" fill="none" stroke="#0C1D4D" strokeWidth="3" />
      <rect x="20" y="20" width="40" height="45" rx="4" fill="#EFF4FA" stroke="#0C1D4D" strokeWidth="3" />
      <text x="40" y="47" fontSize="11" textAnchor="middle" fill="#0C1D4D" fontWeight="700">CM</text>
      {[70, 80, 90, 100].map((y, i) => (
        <line key={i} x1={i % 2 === 0 ? 34 : 46} y1={y - 8} x2={i % 2 === 0 ? 46 : 34} y2={y} stroke="#336699" strokeWidth="2.5" />
      ))}
      <path d="M34 108 a6 8 0 1 0 12 0 a6 8 0 1 0 -12 0" fill="none" stroke="#336699" strokeWidth="2.5" />
    </IconWrap>
  );
}

function PauCargaIcon() {
  return (
    <IconWrap viewBox="0 0 100 140">
      <line x1="50" y1="5" x2="50" y2="120" stroke="#0C1D4D" strokeWidth="4" />
      <circle cx="50" cy="8" r="6" fill="#fff" stroke="#336699" strokeWidth="2.5" />
      <line x1="50" y1="14" x2="20" y2="60" stroke="#336699" strokeWidth="1.5" strokeDasharray="3 3" />
      <line x1="50" y1="14" x2="80" y2="60" stroke="#336699" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M50 60 L20 120 M50 60 L80 120" stroke="#94A3B8" strokeWidth="2" />
      <rect x="30" y="120" width="40" height="10" rx="2" fill="#94A3B8" />
    </IconWrap>
  );
}

function TPieceIcon() {
  return (
    <IconWrap viewBox="0 0 100 80">
      <line x1="5" y1="20" x2="95" y2="20" stroke="#0C1D4D" strokeWidth="4" />
      <line x1="50" y1="20" x2="50" y2="75" stroke="#0C1D4D" strokeWidth="4" />
      <circle cx="5" cy="20" r="4" fill="#fff" stroke="#336699" strokeWidth="2" />
      <circle cx="95" cy="20" r="4" fill="#fff" stroke="#336699" strokeWidth="2" />
      <circle cx="50" cy="75" r="4" fill="#fff" stroke="#336699" strokeWidth="2" />
    </IconWrap>
  );
}

function DiagonalIcon() {
  return (
    <IconWrap viewBox="0 0 140 90">
      <rect x="10" y="10" width="120" height="70" fill="none" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 3" />
      <line x1="10" y1="80" x2="130" y2="10" stroke="#0C1D4D" strokeWidth="4" />
      <circle cx="10" cy="80" r="5" fill="#fff" stroke="#336699" strokeWidth="2.5" />
      <circle cx="130" cy="10" r="5" fill="#fff" stroke="#336699" strokeWidth="2.5" />
    </IconWrap>
  );
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
// DESENHOS ESQUEMÁTICOS DA ESTRUTURA MONTADA
// ============================================================================
function TorreSVG({ alturaM, jointsM }: { alturaM: number; jointsM: number[] }) {
  const pxPerM = Math.min(70, 340 / Math.max(alturaM, 1));
  const H = alturaM * pxPerM;
  const marginTop = 24, marginBottom = 34;
  const xL = 55, xR = 125;
  const yTop = marginTop, yBase = marginTop + H;

  const cumHeights = jointsM.slice(0, -1).reduce<number[]>((acc, len) => {
    const prev = acc.length ? acc[acc.length - 1] : 0;
    acc.push(prev + len);
    return acc;
  }, []);
  const jointYs = cumHeights.map(cum => yBase - cum * pxPerM);
  const panelYs = [yBase, ...jointYs, yTop];
  const diagonais = panelYs.slice(0, -1).map((yBot, i) => {
    const yT = panelYs[i + 1];
    return i % 2 === 0 ? { x1: xL, y1: yBot, x2: xR, y2: yT } : { x1: xR, y1: yBot, x2: xL, y2: yT };
  });

  return (
    <svg viewBox={`0 0 180 ${marginTop + H + marginBottom}`} className="w-full h-full max-h-[380px]">
      <line x1={xL} y1={yTop} x2={xL} y2={yBase} stroke="#0C1D4D" strokeWidth={3} />
      <line x1={xR} y1={yTop} x2={xR} y2={yBase} stroke="#0C1D4D" strokeWidth={3} />
      {jointYs.map((y, i) => (
        <g key={i}><circle cx={xL} cy={y} r={2.2} fill="#336699" /><circle cx={xR} cy={y} r={2.2} fill="#336699" /></g>
      ))}
      {diagonais.map((d, i) => (
        <line key={i} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="#336699" strokeWidth={1.2} strokeDasharray="4 2" />
      ))}
      {[xL, xR].map((x, i) => (
        <g key={i}>
          <rect x={x - 6} y={yTop - 6} width={12} height={12} fill="#fff" stroke="#0C1D4D" strokeWidth={2} />
          <rect x={x - 6} y={yBase - 6} width={12} height={12} fill="#fff" stroke="#0C1D4D" strokeWidth={2} />
        </g>
      ))}
      <rect x={xL - 14} y={yBase + 4} width={28} height={8} rx={2} fill="#94A3B8" />
      <rect x={xR - 14} y={yBase + 4} width={28} height={8} rx={2} fill="#94A3B8" />
    </svg>
  );
}

function VaoSVG({ vaoM, jointsM }: { vaoM: number; jointsM: number[] }) {
  const pxPerM = Math.min(60, 460 / Math.max(vaoM, 1));
  const W = vaoM * pxPerM;
  const marginL = 24, marginR = 24;
  const yTop = 20, yBot = 60;
  const xStart = marginL, xEnd = marginL + W;

  const cumLengths = jointsM.slice(0, -1).reduce<number[]>((acc, len) => {
    const prev = acc.length ? acc[acc.length - 1] : 0;
    acc.push(prev + len);
    return acc;
  }, []);
  const jointXs = cumLengths.map(cum => xStart + cum * pxPerM);
  const panelXs = [xStart, ...jointXs, xEnd];
  const diagonais = panelXs.slice(0, -1).map((xA, i) => {
    const xB = panelXs[i + 1];
    return i % 2 === 0 ? { x1: xA, y1: yBot, x2: xB, y2: yTop } : { x1: xA, y1: yTop, x2: xB, y2: yBot };
  });

  return (
    <svg viewBox={`0 0 ${marginL + W + marginR} 90`} className="w-full h-auto">
      <line x1={xStart} y1={yTop} x2={xEnd} y2={yTop} stroke="#0C1D4D" strokeWidth={3} />
      <line x1={xStart} y1={yBot} x2={xEnd} y2={yBot} stroke="#0C1D4D" strokeWidth={3} />
      {jointXs.map((x, i) => (
        <g key={i}><circle cx={x} cy={yTop} r={2.2} fill="#336699" /><circle cx={x} cy={yBot} r={2.2} fill="#336699" /></g>
      ))}
      {diagonais.map((d, i) => (
        <line key={i} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="#336699" strokeWidth={1.2} strokeDasharray="4 2" />
      ))}
      {[xStart, xEnd].map((x, i) => (
        <g key={i}>
          <rect x={x - 6} y={yTop - 6} width={12} height={12} fill="#fff" stroke="#0C1D4D" strokeWidth={2} />
          <rect x={x - 6} y={yBot - 6} width={12} height={12} fill="#fff" stroke="#0C1D4D" strokeWidth={2} />
        </g>
      ))}
      <line x1={xStart} y1={yTop} x2={xStart} y2={2} stroke="#94A3B8" strokeWidth={1} strokeDasharray="3 2" />
      <line x1={xEnd} y1={yTop} x2={xEnd} y2={2} stroke="#94A3B8" strokeWidth={1} strokeDasharray="3 2" />
    </svg>
  );
}

// ============================================================================
// MONTAGEM LIVRE (grid de nós/arestas onde o usuário posiciona as peças)
// ============================================================================
type NoAcessorio = 'cubo' | 'sleeve' | 'sapata' | 'talha' | 'pauCarga';
type Ferramenta = 'reta' | 'diagonal' | NoAcessorio | 'apagar';

const FERRAMENTAS: { id: Ferramenta; label: string; cor: string }[] = [
  { id: 'reta', label: 'Reta', cor: '#0C1D4D' },
  { id: 'diagonal', label: 'Diagonal', cor: '#336699' },
  { id: 'cubo', label: 'Cubo', cor: '#0C1D4D' },
  { id: 'sleeve', label: 'Sleeve', cor: '#336699' },
  { id: 'sapata', label: 'Sapata', cor: '#94A3B8' },
  { id: 'talha', label: 'Talha', cor: '#D97706' },
  { id: 'pauCarga', label: 'Pau de Carga', cor: '#7C3AED' },
  { id: 'apagar', label: 'Apagar', cor: '#DC2626' },
];

const NODE_META: Record<NoAcessorio, { cor: string; letra: string; nome: string }> = {
  cubo: { cor: '#0C1D4D', letra: 'C', nome: 'Cubo' },
  sleeve: { cor: '#336699', letra: 'S', nome: 'Sleeve' },
  sapata: { cor: '#94A3B8', letra: 'B', nome: 'Sapata' },
  talha: { cor: '#D97706', letra: 'T', nome: 'Talha' },
  pauCarga: { cor: '#7C3AED', letra: 'P', nome: 'Pau de Carga' },
};

const CELL = 44;
const OFFSET = 22;

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
  const [cargaKg, setCargaKg] = useState<number>(200);

  const resultado = useMemo<ResultadoEstrutura>(() => {
    if (estrutura === 'torre') return computeTorre(altura, qSize, Math.max(1, numTorres));
    if (estrutura === 'vao') return computeVao(vao, qSize, Math.max(1, numVaos));
    return computePortal(altura, vao, qSize);
  }, [estrutura, altura, vao, qSize, numTorres, numVaos]);

  const materiais = useMemo(() => buildMateriais(resultado, qSize), [resultado, qSize]);

  const pontosIcamento = estrutura === 'torre' ? Math.max(1, numTorres) : estrutura === 'portal' ? 2 : Math.max(1, numVaos) * 2;
  const talha = recomendarTalha(cargaKg);
  const pauCarga = estrutura !== 'vao' ? recomendarPauCarga(resultado.alturaReal ?? altura) : null;

  const totalRetas = resultado.retas.reduce((s, r) => s + r.qty, 0);

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

  useEffect(() => {
    const stop = () => setIsPaintingFree(false);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  const gridGeom = useMemo(() => buildGridGeom(freeCols, freeRows), [freeCols, freeRows]);

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
    const pesoCubos = (contagemNos.cubo ?? 0) * info.cuboKg;
    const pesoSleeves = (contagemNos.sleeve ?? 0) * info.sleeveKg;
    const pesoSapatas = (contagemNos.sapata ?? 0) * info.sapataKg;
    const pesoTotal = pesoRetas + pesoDiag + pesoCubos + pesoSleeves + pesoSapatas;
    return { numRetas, numDiag, contagemNos, pesoTotal };
  }, [retasLivres, diagonaisLivres, nosLivres, qSize, freeModuloM]);

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

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-5">
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">1. Dados do Projeto</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Projeto / Evento</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold uppercase focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} /></div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Cliente</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
            </div>
          </div>

          {aba === 'montador' && (
            <>
              <div>
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">2. Tipo de Estrutura</h3>
                <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-lg mb-3">
                  <button onClick={() => setEstrutura('torre')} className={`py-2 text-[9px] font-black uppercase rounded ${estrutura === 'torre' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Torre</button>
                  <button onClick={() => setEstrutura('vao')} className={`py-2 text-[9px] font-black uppercase rounded ${estrutura === 'vao' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Vão / Viga</button>
                  <button onClick={() => setEstrutura('portal')} className={`py-2 text-[9px] font-black uppercase rounded ${estrutura === 'portal' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Portal</button>
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
              </div>

              <div>
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">3. Içamento</h3>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Carga a suspender por ponto (kg)</label>
                <input type="number" min="0" step="10" className="w-full p-2 border border-gray-300 rounded text-sm font-bold focus:border-[#336699] outline-none" value={cargaKg} onChange={(e) => setCargaKg(parseFloat(e.target.value) || 0)} />
                <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mt-2">Usado para recomendar a talha e o pau de carga da estrutura.</p>
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
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Estrutura Boxtruss — {aba === 'livre' ? 'Montagem Livre' : estrutura === 'torre' ? 'Torre' : estrutura === 'vao' ? 'Vão / Viga' : 'Portal'}</h2>
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
                <strong className="block text-lg text-[#336699] font-black print:text-black">
                  {resultado.alturaReal ? `${resultado.alturaReal.toFixed(1)}m alt.` : ''}{resultado.alturaReal && resultado.vaoReal ? ' × ' : ''}{resultado.vaoReal ? `${resultado.vaoReal.toFixed(1)}m vão` : ''}
                </strong>
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
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 flex-shrink-0 bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:32px_32px] print:border print:bg-none">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs mb-3">Desenho Esquemático — {estrutura === 'torre' ? `Torre ${qSize}` : estrutura === 'vao' ? `Vão ${qSize}` : `Portal ${qSize}`}</h3>

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
                {(ferramenta === 'cubo' || ferramenta === 'sleeve' || ferramenta === 'sapata' || ferramenta === 'talha' || ferramenta === 'pauCarga') && 'Clique num nó (interseção) do grid para posicionar essa peça.'}
              </p>
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
                <strong className="block text-lg text-[#16A34A] font-black print:text-black">{materiaisLivres.contagemNos.cubo ?? 0} / {materiaisLivres.contagemNos.sleeve ?? 0} / {materiaisLivres.contagemNos.sapata ?? 0}</strong>
              </div>
              <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-amber-500 p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Talhas / Pau de Carga</span>
                <strong className="block text-lg text-amber-600 font-black print:text-black">{materiaisLivres.contagemNos.talha ?? 0} / {materiaisLivres.contagemNos.pauCarga ?? 0}</strong>
              </div>
            </div>

            {/* CANVAS */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 flex-grow overflow-auto bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:22px_22px] print:border print:bg-none">
              <svg
                width={gridGeom.width}
                height={gridGeom.height}
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

                {/* Nós (cubo / sleeve / sapata / talha / pau de carga) */}
                {gridGeom.nodes.map(n => {
                  const acc = nosLivres[n.id];
                  const meta = acc ? NODE_META[acc] : null;
                  return (
                    <g key={n.id}>
                      <circle cx={n.x} cy={n.y} r={meta ? 8 : 2.5} fill={meta ? meta.cor : '#94A3B8'} stroke={meta ? '#fff' : 'none'} strokeWidth={meta ? 1.5 : 0} pointerEvents="none" />
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

            {/* LEGENDA */}
            <div className="hidden print:grid grid-cols-5 gap-2 flex-shrink-0">
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
                  {(Object.keys(NODE_META) as NoAcessorio[]).map(tipo => {
                    const qtd = materiaisLivres.contagemNos[tipo] ?? 0;
                    if (!qtd) return null;
                    const pesoUnit = tipo === 'cubo' ? Q_INFO[qSize].cuboKg : tipo === 'sleeve' ? Q_INFO[qSize].sleeveKg : tipo === 'sapata' ? Q_INFO[qSize].sapataKg : null;
                    return (
                      <tr key={tipo} className="border-b border-gray-100">
                        <td className="py-2 font-bold text-[#334155]">{NODE_META[tipo].nome} {pesoUnit !== null && <span className="text-[#94A3B8] font-medium">({qSize})</span>}</td>
                        <td className="py-2 text-right font-black text-[#0C1D4D]">{qtd} pç</td>
                        <td className="py-2 text-right font-medium text-[#64748B]">{pesoUnit !== null ? (qtd * pesoUnit).toFixed(1) : '—'}</td>
                      </tr>
                    );
                  })}
                  {materiaisLivres.numRetas === 0 && materiaisLivres.numDiag === 0 && Object.keys(materiaisLivres.contagemNos).length === 0 && (
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
