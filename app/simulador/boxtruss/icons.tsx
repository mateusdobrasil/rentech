// ============================================================================
// ÍCONES TÉCNICOS (SVG estilo "desenho de linha") — catálogo de peças
// ============================================================================
import type { ReactNode } from 'react';

function IconWrap({ children, viewBox }: { children: ReactNode; viewBox: string }) {
  return (
    <svg viewBox={viewBox} className="w-full h-24 md:h-28" fill="none">
      {children}
    </svg>
  );
}

export function StraightIcon() {
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

export function CuboIcon() {
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

export function SleeveIcon() {
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

export function SapataIcon() {
  return (
    <IconWrap viewBox="0 0 100 120">
      <line x1="50" y1="5" x2="50" y2="70" stroke="#0C1D4D" strokeWidth="4" />
      <rect x="35" y="70" width="30" height="16" fill="#fff" stroke="#336699" strokeWidth="2.5" />
      <line x1="50" y1="86" x2="50" y2="100" stroke="#336699" strokeWidth="3" />
      <rect x="15" y="100" width="70" height="10" rx="2" fill="#94A3B8" />
    </IconWrap>
  );
}

export function TalhaIcon() {
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

export function PauCargaIcon() {
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

export function TPieceIcon() {
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

export function DiagonalIcon() {
  return (
    <IconWrap viewBox="0 0 140 90">
      <rect x="10" y="10" width="120" height="70" fill="none" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 3" />
      <line x1="10" y1="80" x2="130" y2="10" stroke="#0C1D4D" strokeWidth="4" />
      <circle cx="10" cy="80" r="5" fill="#fff" stroke="#336699" strokeWidth="2.5" />
      <circle cx="130" cy="10" r="5" fill="#fff" stroke="#336699" strokeWidth="2.5" />
    </IconWrap>
  );
}
