// ============================================================================
// DESENHOS ESQUEMÁTICOS DA ESTRUTURA MONTADA
// ============================================================================
export function TorreSVG({ alturaM, jointsM }: { alturaM: number; jointsM: number[] }) {
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

export function VaoSVG({ vaoM, jointsM }: { vaoM: number; jointsM: number[] }) {
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

// Caixa / estande: 4 torres de canto + moldura no topo, em projeção pseudo-3D (isométrica simplificada).
export function BoxSVG({ alturaM, larguraM, profundidadeM }: { alturaM: number; larguraM: number; profundidadeM: number }) {
  const pxPerMV = Math.min(60, 200 / Math.max(alturaM, 1));
  const pxPerMW = Math.min(46, 220 / Math.max(larguraM, 1));
  const H = alturaM * pxPerMV;
  const W = larguraM * pxPerMW;
  const D = Math.min(70, Math.max(30, profundidadeM * 14)); // profundidade em perspectiva (offset diagonal)

  const marginL = 30, marginTop = 16, marginBottom = 30;
  // Face frontal (frente-baixo-esquerda como origem)
  const xFL = marginL, xFR = marginL + W;
  const yFTop = marginTop + D, yFBase = marginTop + D + H;
  // Face de trás, deslocada em diagonal (dx, -dy) para simular profundidade
  const xBL = xFL + D, xBR = xFR + D;
  const yBTop = marginTop, yBBase = marginTop + H;

  const viewW = xBR + 16;
  const viewH = yFBase + marginBottom;

  const frontEdges = [
    { x1: xFL, y1: yFTop, x2: xFL, y2: yFBase }, // vertical esquerda
    { x1: xFR, y1: yFTop, x2: xFR, y2: yFBase }, // vertical direita
    { x1: xFL, y1: yFTop, x2: xFR, y2: yFTop },  // topo frontal
    { x1: xFL, y1: yFBase, x2: xFR, y2: yFBase }, // base frontal
  ];
  const backEdges = [
    { x1: xBL, y1: yBTop, x2: xBL, y2: yBBase },
    { x1: xBR, y1: yBTop, x2: xBR, y2: yBBase },
    { x1: xBL, y1: yBTop, x2: xBR, y2: yBTop },
  ];
  const depthEdges = [
    { x1: xFL, y1: yFTop, x2: xBL, y2: yBTop },
    { x1: xFR, y1: yFTop, x2: xBR, y2: yBTop },
  ];
  const corners = [
    { x: xFL, y: yFTop }, { x: xFR, y: yFTop }, { x: xFL, y: yFBase }, { x: xFR, y: yFBase },
    { x: xBL, y: yBTop }, { x: xBR, y: yBTop },
  ];

  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full h-full max-h-[380px]">
      {backEdges.map((e, i) => (
        <line key={`b${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#336699" strokeWidth={2} strokeDasharray="5 3" />
      ))}
      {depthEdges.map((e, i) => (
        <line key={`d${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#336699" strokeWidth={2} strokeDasharray="5 3" />
      ))}
      {frontEdges.map((e, i) => (
        <line key={`f${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#0C1D4D" strokeWidth={3} />
      ))}
      {corners.map((c, i) => (
        <rect key={i} x={c.x - 5} y={c.y - 5} width={10} height={10} fill="#fff" stroke="#0C1D4D" strokeWidth={2} />
      ))}
      <rect x={xFL - 14} y={yFBase + 4} width={28} height={8} rx={2} fill="#94A3B8" />
      <rect x={xFR - 14} y={yFBase + 4} width={28} height={8} rx={2} fill="#94A3B8" />
    </svg>
  );
}
