// ============================================================================
// GEOMETRIA 3D — converte os dados de engenharia (alturas, vãos, grid livre)
// em segmentos de barra e pontos de nó que o visualizador Three.js desenha.
// Módulo puro (sem dependência de React/Three) para ficar fácil de testar.
// ============================================================================
export type Vec3 = [number, number, number];
export interface Seg3D { a: Vec3; b: Vec3 }

export interface TrussGeometry3D {
  chords: Seg3D[];
  frames: Seg3D[];
  diagonals: Seg3D[];
  joints: Vec3[];
}

function panelBoundaries(jointsM: number[]): number[] {
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < jointsM.length; i++) {
    acc += jointsM[i];
    if (i < jointsM.length - 1) cum.push(acc);
  }
  return cum;
}

// Monta um tubo reto de seção quadrada (4 cordas + molduras nas pontas + diagonais
// em zigue-zague nas 4 faces) ao longo de um parâmetro t=0..lengthM. As 4 funções
// de canto descrevem a posição 3D de cada corda em função de t — isso permite
// reaproveitar a mesma lógica para tubos verticais (torres) e horizontais (vãos),
// em qualquer eixo, sem duplicar o corpo da função.
function buildTube(lengthM: number, jointsM: number[], corners: [(t: number) => Vec3, (t: number) => Vec3, (t: number) => Vec3, (t: number) => Vec3]): TrussGeometry3D {
  const chords: Seg3D[] = corners.map(fn => ({ a: fn(0), b: fn(lengthM) }));

  const frames: Seg3D[] = [];
  for (const t of [0, lengthM]) {
    for (let i = 0; i < 4; i++) frames.push({ a: corners[i](t), b: corners[(i + 1) % 4](t) });
  }

  const bounds = [0, ...panelBoundaries(jointsM), lengthM];
  const diagonals: Seg3D[] = [];
  for (let f = 0; f < 4; f++) {
    const c1 = corners[f], c2 = corners[(f + 1) % 4];
    for (let p = 0; p < bounds.length - 1; p++) {
      const tA = bounds[p], tB = bounds[p + 1];
      diagonals.push(p % 2 === 0 ? { a: c1(tA), b: c2(tB) } : { a: c2(tA), b: c1(tB) });
    }
  }

  const joints: Vec3[] = [];
  for (const t of [0, lengthM]) for (const fn of corners) joints.push(fn(t));

  return { chords, frames, diagonals, joints };
}

export function mergeGeometries3D(list: TrussGeometry3D[]): TrussGeometry3D {
  return {
    chords: list.flatMap(g => g.chords),
    frames: list.flatMap(g => g.frames),
    diagonals: list.flatMap(g => g.diagonals),
    joints: list.flatMap(g => g.joints),
  };
}

// Tubo vertical (torre): sobe em Y, seção quadrada centrada em (cx, cz).
function verticalTube(alturaM: number, ladoM: number, jointsM: number[], cx: number, cz: number): TrussGeometry3D {
  const h = ladoM / 2;
  return buildTube(alturaM, jointsM, [
    (t) => [cx - h, t, cz - h],
    (t) => [cx + h, t, cz - h],
    (t) => [cx + h, t, cz + h],
    (t) => [cx - h, t, cz + h],
  ]);
}

// Tubo horizontal correndo em X (vãos/travessas de largura): base em y0, topo em y0+ladoM, centrado em cz.
function widthTube(comprimentoM: number, ladoM: number, jointsM: number[], x0: number, y0: number, cz: number): TrussGeometry3D {
  const h = ladoM / 2;
  return buildTube(comprimentoM, jointsM, [
    (t) => [x0 + t, y0, cz - h],
    (t) => [x0 + t, y0, cz + h],
    (t) => [x0 + t, y0 + ladoM, cz + h],
    (t) => [x0 + t, y0 + ladoM, cz - h],
  ]);
}

// Tubo horizontal correndo em Z (travessas de profundidade do Box): base em y0, topo em y0+ladoM, centrado em cx.
function depthTube(comprimentoM: number, ladoM: number, jointsM: number[], z0: number, y0: number, cx: number): TrussGeometry3D {
  const h = ladoM / 2;
  return buildTube(comprimentoM, jointsM, [
    (t) => [cx - h, y0, z0 + t],
    (t) => [cx + h, y0, z0 + t],
    (t) => [cx + h, y0 + ladoM, z0 + t],
    (t) => [cx - h, y0 + ladoM, z0 + t],
  ]);
}

export function buildTorreGeometry3D(alturaM: number, ladoM: number, jointsM: number[]): TrussGeometry3D {
  return verticalTube(alturaM, ladoM, jointsM, 0, 0);
}

export function buildVaoGeometry3D(vaoM: number, ladoM: number, jointsM: number[]): TrussGeometry3D {
  return widthTube(vaoM, ladoM, jointsM, -vaoM / 2, 0, 0);
}

export function buildPortalGeometry3D(alturaM: number, vaoM: number, ladoM: number, jointsAltura: number[], jointsVao: number[]): TrussGeometry3D {
  const half = vaoM / 2;
  return mergeGeometries3D([
    verticalTube(alturaM, ladoM, jointsAltura, -half, 0),
    verticalTube(alturaM, ladoM, jointsAltura, half, 0),
    widthTube(vaoM, ladoM, jointsVao, -half, alturaM, 0),
  ]);
}

export function buildBoxGeometry3D(alturaM: number, larguraM: number, profundidadeM: number, ladoM: number, jointsAltura: number[], jointsLargura: number[], jointsProfundidade: number[]): TrussGeometry3D {
  const hw = larguraM / 2, hd = profundidadeM / 2;
  return mergeGeometries3D([
    verticalTube(alturaM, ladoM, jointsAltura, -hw, -hd),
    verticalTube(alturaM, ladoM, jointsAltura, hw, -hd),
    verticalTube(alturaM, ladoM, jointsAltura, hw, hd),
    verticalTube(alturaM, ladoM, jointsAltura, -hw, hd),
    widthTube(larguraM, ladoM, jointsLargura, -hw, alturaM, -hd),
    widthTube(larguraM, ladoM, jointsLargura, -hw, alturaM, hd),
    depthTube(profundidadeM, ladoM, jointsProfundidade, -hd, alturaM, -hw),
    depthTube(profundidadeM, ladoM, jointsProfundidade, -hd, alturaM, hw),
  ]);
}

// -------- Montagem Livre: grid 2D (X = colunas, Y = linhas invertidas, Z = 0) --------
export interface LivreGeometry3D {
  bars: Seg3D[];
  diagonals: Seg3D[];
  cubos: Vec3[];
  sleeves: Vec3[];
  acessorios: { pos: Vec3; tipo: string }[];
}

export function buildLivreGeometry3D(
  cols: number,
  rows: number,
  moduloM: number,
  retasLivres: Set<string>,
  diagonaisLivres: Set<string>,
  autoNodes: { c: number; r: number; tipo: 'cubo' | 'sleeve' }[],
  nosLivres: Record<string, string>,
): LivreGeometry3D {
  const nx = (c: number) => c * moduloM;
  const ny = (r: number) => (rows - r) * moduloM;

  const bars: Seg3D[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (retasLivres.has(`H-${c}-${r}`)) bars.push({ a: [nx(c), ny(r), 0], b: [nx(c + 1), ny(r), 0] });
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (retasLivres.has(`V-${c}-${r}`)) bars.push({ a: [nx(c), ny(r), 0], b: [nx(c), ny(r + 1), 0] });
    }
  }

  const diagonals: Seg3D[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (diagonaisLivres.has(`D1-${c}-${r}`)) diagonals.push({ a: [nx(c), ny(r), 0], b: [nx(c + 1), ny(r + 1), 0] });
      if (diagonaisLivres.has(`D2-${c}-${r}`)) diagonals.push({ a: [nx(c), ny(r + 1), 0], b: [nx(c + 1), ny(r), 0] });
    }
  }

  const cubos: Vec3[] = [];
  const sleeves: Vec3[] = [];
  for (const n of autoNodes) (n.tipo === 'cubo' ? cubos : sleeves).push([nx(n.c), ny(n.r), 0]);

  const acessorios: { pos: Vec3; tipo: string }[] = Object.entries(nosLivres).map(([id, tipo]) => {
    const [, c, r] = id.split('-');
    return { pos: [nx(Number(c)), ny(Number(r)), 0] as Vec3, tipo };
  });

  return { bars, diagonals, cubos, sleeves, acessorios };
}
