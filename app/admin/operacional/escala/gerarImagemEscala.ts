// Desenha a escala do dia num <canvas> e devolve um PNG pronto pra
// compartilhar no grupo do WhatsApp. Não é screenshot da tela (evita
// depender de layout/CSS do navegador) — é um cartão desenhado do zero com
// Canvas 2D, mesmo espírito do recorte de PDF em
// app/admin/rh/holerite/SepararHolerites.tsx. Fontes usam "sans-serif"
// genérico de propósito: texto em canvas é síncrono, então uma webfont
// customizada ainda carregando faria o desenho cair silenciosamente pro
// fallback — com sans-serif isso nunca é um problema.
export interface AlocacaoImg { funcionario_nome: string; horario: string; local_nome: string; }

const NAVY = '#0C1D4D';
const EMERALD = '#059669';
const INK = '#1c2440';
const MUTED = '#64748B';
const W = 720;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDataExtenso = (d: string) =>
  capitalize(new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }));

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function gerarImagemEscala(params: {
  empresaNome: string; data: string; alocacoes: AlocacaoImg[]; logo?: HTMLImageElement | null;
}): Promise<Blob | null> {
  const { empresaNome, data, alocacoes, logo } = params;

  const porLocal = new Map<string, AlocacaoImg[]>();
  alocacoes.forEach(a => porLocal.set(a.local_nome, [...(porLocal.get(a.local_nome) || []), a]));
  const locais = Array.from(porLocal.keys()).sort((a, b) => a.localeCompare(b));
  locais.forEach(l => porLocal.get(l)!.sort((a, b) =>
    (a.horario || '').localeCompare(b.horario || '') || a.funcionario_nome.localeCompare(b.funcionario_nome)));

  const HEADER_H = 168, FOOTER_H = 56, GROUP_HEADER_H = 46, ROW_H = 38, GROUP_GAP = 22, PAD_X = 36;

  const corpoH = locais.length === 0
    ? 80
    : locais.reduce((acc, l) => acc + GROUP_HEADER_H + (porLocal.get(l)!.length * ROW_H) + GROUP_GAP, 0);
  const H = HEADER_H + corpoH + FOOTER_H;

  const canvas = document.createElement('canvas');
  const escala = 2; // retina — texto nítido quando ampliado no WhatsApp
  canvas.width = W * escala;
  canvas.height = H * escala;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(escala, escala);

  ctx.fillStyle = '#F0F4F8';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, HEADER_H);

  let logoBottom = 24;
  if (logo && logo.width > 0) {
    const logoH = 40;
    const logoW = logo.width * (logoH / logo.height);
    const boxPadX = 14, boxPadY = 8;
    const boxW = logoW + boxPadX * 2, boxH = logoH + boxPadY * 2;
    const boxX = W / 2 - boxW / 2, boxY = 20;
    ctx.fillStyle = '#fff';
    roundRect(ctx, boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.drawImage(logo, boxX + boxPadX, boxY + boxPadY, logoW, logoH);
    logoBottom = boxY + boxH;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '800 30px sans-serif';
  ctx.fillText('ESCALA DE TRABALHO', W / 2, logoBottom + 40);
  ctx.font = '600 16px sans-serif';
  ctx.fillStyle = '#B9C4E0';
  ctx.fillText(`${empresaNome} · ${fmtDataExtenso(data)}`, W / 2, logoBottom + 66);

  ctx.textAlign = 'left';
  let y = HEADER_H + 30;

  if (locais.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = '600 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nenhum colaborador alocado ainda.', W / 2, y + 20);
    ctx.textAlign = 'left';
  } else {
    locais.forEach(local => {
      const itens = porLocal.get(local)!;

      ctx.fillStyle = '#DCFCE7';
      roundRect(ctx, PAD_X, y, W - PAD_X * 2, GROUP_HEADER_H - 10, 8);
      ctx.fill();
      ctx.fillStyle = EMERALD;
      ctx.font = '800 17px sans-serif';
      ctx.fillText(`\u{1F4CD} ${local}`, PAD_X + 14, y + (GROUP_HEADER_H - 10) / 2 + 6);
      y += GROUP_HEADER_H;

      itens.forEach((a, i) => {
        if (i % 2 === 1) {
          ctx.fillStyle = '#F8FAFC';
          ctx.fillRect(PAD_X, y - 4, W - PAD_X * 2, ROW_H);
        }
        ctx.fillStyle = NAVY;
        ctx.font = '800 15px sans-serif';
        ctx.fillText(a.horario?.slice(0, 5) || '--:--', PAD_X + 14, y + 20);
        ctx.fillStyle = INK;
        ctx.font = '600 15px sans-serif';
        ctx.fillText(a.funcionario_nome, PAD_X + 90, y + 20);
        y += ROW_H;
      });
      y += GROUP_GAP;
    });
  }

  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(0, H - FOOTER_H, W, 1);
  ctx.fillStyle = MUTED;
  ctx.font = '600 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Gerado em ${new Date().toLocaleString('pt-BR')} · Sistema Rentech`, W / 2, H - FOOTER_H / 2 + 4);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1));
}
