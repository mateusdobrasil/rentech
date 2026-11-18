// app/lib/diretoria/envioDiretoria.ts
// Envio dos relatórios e alertas do Diretor (IA) por E-MAIL (decisão do
// usuário em 2026-11-17: "prefiro e-mail ao WhatsApp"; até então ia por
// WhatsApp). Cada rotina tem seu card em Agendamentos e Disparos:
// - `ativo` liga/desliga a rotina inteira (geração e envio);
// - o canal "E-mail" precisa estar marcado no card para enviar;
// - `destinatarios` = nomes da Ficha do Funcionário; o e-mail sai de
//   folha_funcionarios.email (nunca do P2S). Lista VAZIA não envia para
//   ninguém (nos outros cards seria "todos os funcionários" — aqui barrado);
// - `dias_semana` continua valendo.
// O corpo do e-mail é montado aqui (HTML + texto), com o relatório completo —
// o campo `mensagem` do card não é usado por estas rotinas.
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '../supabase';

type DB = ReturnType<typeof supabaseAdmin>;

export interface ResultadoEnvioDiretoria { texto: string; enviados: number }

export const baseUrlSistema = () => process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// FAMÍLIA DO CARD (2026-11-18): o card original (chave fixa, ex.
// "diretoria-relatorio-diario") + as cópias feitas pelo "Duplicar" em
// Agendamentos (chave "<original>--2", "--3"...). Uso: o diretor da Rentech é
// diferente do da AlfaLight — um card por empresa (campo Empresa do card),
// cada um com seus destinatários. Card com empresa "Todas" (null) recebe o
// relatório de todas as empresas.
interface CardDiretoria { chave: string; ativo: boolean; canais: string[] | null; destinatarios: string[] | null; dias_semana: number[] | null; empresa_id: number | null }

export async function cardsDaFamilia(db: DB, chaveCard: string): Promise<CardDiretoria[]> {
  const { data } = await db.from('parametros_automacoes')
    .select('chave, ativo, canais, destinatarios, dias_semana, empresa_id')
    .like('chave', `${chaveCard}%`);
  return ((data || []) as CardDiretoria[]).filter(c => c.chave === chaveCard || c.chave.startsWith(`${chaveCard}--`));
}

// A rotina (cron) roda se QUALQUER card da família estiver ligado.
export async function familiaAtiva(db: DB, chaveCard: string): Promise<boolean> {
  return (await cardsDaFamilia(db, chaveCard)).some(c => c.ativo !== false);
}

export async function enviarPeloCard(db: DB, chaveCard: string, hojeISO: string, email: { assunto: string; html: string; texto: string }, empresaId: number | null): Promise<ResultadoEnvioDiretoria> {
  const nao = (texto: string) => ({ texto, enviados: 0 });
  // Cards da família que valem pra esta empresa (o dela, ou "Todas")
  const daEmpresa = (await cardsDaFamilia(db, chaveCard)).filter(c => c.empresa_id == null || c.empresa_id === empresaId);
  if (!daEmpresa.length) return nao('Não enviado: nenhum card desta rotina para esta empresa em Agendamentos e Disparos (duplique o card e escolha a empresa).');
  const ligados = daEmpresa.filter(c => c.ativo !== false);
  if (!ligados.length) return nao('Não enviado: card desta empresa desligado em Agendamentos e Disparos.');
  const comEmailMarcado = ligados.filter(c => (c.canais || []).includes('E-mail'));
  if (!comEmailMarcado.length) return nao('Não enviado: canal E-mail desmarcado no card.');
  const diaSemana = new Date(`${hojeISO}T12:00:00Z`).getUTCDay();
  const doDia = comEmailMarcado.filter(c => (c.dias_semana || [0, 1, 2, 3, 4, 5, 6]).includes(diaSemana));
  if (!doDia.length) return nao('Não enviado: hoje não está nos dias do card.');
  const usados = doDia.filter(c => (c.destinatarios || []).length > 0);
  // Mesma pessoa em dois cards (ex.: card da empresa + card "Todas") recebe uma vez só
  const nomes = [...new Set(usados.flatMap(c => c.destinatarios || []))];
  if (!nomes.length) return nao('Não enviado: card sem destinatários.');

  const { data: pessoas } = await db.from('folha_funcionarios').select('nome_completo, email').eq('ativo', true).in('nome_completo', nomes);
  const comEmail = ((pessoas || []) as { nome_completo: string; email: string | null }[]).filter(p => (p.email || '').includes('@'));
  const semEmail = nomes.filter(n => !comEmail.some(p => p.nome_completo === n));
  if (!comEmail.length) return nao(`Não enviado: ${semEmail.join(', ')} sem e-mail na Ficha do Funcionário.`);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return nao('Não enviado: SMTP não configurado no servidor.');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  let enviados = 0;
  const falhas: string[] = [];
  for (const p of comEmail) {
    try {
      await transporter.sendMail({ from: `"Diretor (IA) · Rentech" <${process.env.SMTP_USER}>`, to: p.email!, subject: email.assunto, text: email.texto, html: email.html });
      enviados++;
    } catch (e: any) {
      falhas.push(`${p.nome_completo} (${e?.message || 'erro'})`);
    }
  }

  const chavesUsadas = usados.map(c => c.chave);
  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).in('chave', chavesUsadas);
  if (enviados > 0) await db.from('parametros_automacoes_envios').insert({ chave: chavesUsadas[0], canal: 'E-mail', quantidade: enviados });

  const partes = [enviados ? `E-mail enviado para ${enviados}.` : 'Nenhum e-mail enviado.'];
  if (falhas.length) partes.push(`Falhou: ${falhas.join(', ')}.`);
  if (semEmail.length) partes.push(`Sem e-mail na ficha: ${semEmail.join(', ')}.`);
  return { texto: partes.join(' '), enviados };
}

// ---------------------------------------------------------------------------
// Montagem do e-mail. HTML simples com estilo inline (clientes de e-mail
// ignoram <style>), largura máxima 640px, cores do sistema.
// ---------------------------------------------------------------------------

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const AZUL = '#0C1D4D';
const COR_SITUACAO: Record<string, { fundo: string; texto: string; rotulo: string }> = {
  NORMAL: { fundo: '#d1fae5', texto: '#047857', rotulo: 'Normal' },
  ATENCAO: { fundo: '#fef3c7', texto: '#b45309', rotulo: 'Atenção' },
  CRITICO: { fundo: '#fee2e2', texto: '#b91c1c', rotulo: 'Crítico' },
};
const COR_GRAVIDADE: Record<string, string> = { ALTA: '#ef4444', MEDIA: '#f59e0b', BAIXA: '#94a3b8' };
const ROTULO_AREA: Record<string, string> = { FINANCEIRO: 'Financeiro', COMERCIAL: 'Comercial', EXPEDICAO: 'Expedição', FROTA: 'Frota', RH: 'RH', DADOS: 'Dados' };

interface ConteudoEmail {
  situacao: string;
  manchete: string;
  resumo_semana?: string; resumo?: string;
  pontos_de_atencao: { area: string; gravidade: string; titulo: string; detalhe: string; acao_sugerida: string | null }[];
  secoes: { area: string; resumo: string; itens: string[] }[];
  pendencias: { descricao: string; desde: string; situacao: string }[];
  prioridades?: string[]; recomendacoes?: string[]; tendencias?: string[];
  metas?: { meta: string; avaliacao: string }[]; caixa?: string;
  agenda_proxima_semana?: { data: string; descricao: string }[];
  observacoes_dados: string | null;
}

function moldura(titulo: string, subtitulo: string, corpo: string, link: string, rotuloBotao: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F0F4F8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;border:1px solid #E2E8F0;">
<tr><td style="padding:20px 24px;border-bottom:1px solid #E2E8F0;">
<div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#64748B;">🧭 Diretor (IA) · ${esc(subtitulo)}</div>
<div style="font-size:20px;font-weight:bold;color:${AZUL};margin-top:4px;">${esc(titulo)}</div>
</td></tr>
<tr><td style="padding:20px 24px;">${corpo}</td></tr>
<tr><td style="padding:0 24px 24px;"><a href="${esc(link)}" style="display:inline-block;background:${AZUL};color:#ffffff;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 20px;border-radius:8px;">${esc(rotuloBotao)}</a></td></tr>
</table>
<div style="font-size:11px;color:#94a3b8;margin-top:12px;">Enviado pelo Rentech WEB. Para mudar quem recebe, edite o card em Parâmetros → Agendamentos e Disparos.</div>
</td></tr></table></body></html>`;
}

const tituloSecao = (t: string) => `<div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin:20px 0 8px;">${esc(t)}</div>`;
const lista = (itens: string[]) => `<ul style="margin:0;padding-left:18px;">${itens.map(i => `<li style="font-size:13px;line-height:1.5;margin-bottom:4px;">${esc(i)}</li>`).join('')}</ul>`;

export function montarEmailRelatorio(p: { tipoRotulo: string; empresa: string; periodo: string; conteudo: ConteudoEmail; link: string }): { assunto: string; html: string; texto: string } {
  const c = p.conteudo;
  const sit = COR_SITUACAO[c.situacao] || COR_SITUACAO.NORMAL;
  const resumo = c.resumo_semana || c.resumo;
  const prioridades = c.prioridades || c.recomendacoes || [];
  const pendencias = (c.pendencias || []).filter(x => x.situacao === 'ABERTA');

  let corpo = `<div style="display:inline-block;background:${sit.fundo};color:${sit.texto};font-size:11px;font-weight:bold;text-transform:uppercase;padding:3px 10px;border-radius:999px;">${sit.rotulo}</div>
<div style="font-size:17px;font-weight:bold;color:${AZUL};line-height:1.4;margin-top:10px;">${esc(c.manchete)}</div>`;
  if (resumo) corpo += `<p style="font-size:13px;line-height:1.6;color:#475569;margin:10px 0 0;">${esc(resumo)}</p>`;

  corpo += tituloSecao('Pontos de atenção');
  corpo += c.pontos_de_atencao.length
    ? c.pontos_de_atencao.map(pt => `<div style="border-left:4px solid ${COR_GRAVIDADE[pt.gravidade] || '#94a3b8'};padding:6px 0 6px 12px;margin-bottom:10px;">
<div style="font-size:13px;font-weight:bold;color:${AZUL};">${esc(pt.titulo)} <span style="font-size:10px;color:#94a3b8;text-transform:uppercase;">${esc(ROTULO_AREA[pt.area] || pt.area)} · ${esc(pt.gravidade.toLowerCase())}</span></div>
<div style="font-size:13px;line-height:1.5;color:#475569;margin-top:2px;">${esc(pt.detalhe)}</div>
${pt.acao_sugerida ? `<div style="font-size:12px;font-weight:bold;color:#284B8C;margin-top:4px;">→ ${esc(pt.acao_sugerida)}</div>` : ''}</div>`).join('')
    : `<div style="font-size:13px;color:#047857;font-weight:bold;">✓ Nada fora do normal.</div>`;

  if (prioridades.length) corpo += tituloSecao(c.recomendacoes ? 'Recomendações' : 'Prioridades') + `<ol style="margin:0;padding-left:18px;">${prioridades.map(x => `<li style="font-size:13px;line-height:1.5;margin-bottom:4px;">${esc(x)}</li>`).join('')}</ol>`;
  if (c.metas?.length) corpo += tituloSecao('Metas') + lista(c.metas.map(m => `${m.meta}: ${m.avaliacao}`));
  if (c.caixa) corpo += tituloSecao('Caixa — próximos 30/60/90 dias') + `<p style="font-size:13px;line-height:1.6;color:#475569;margin:0;">${esc(c.caixa)}</p>`;
  if (c.tendencias?.length) corpo += tituloSecao('Tendências') + lista(c.tendencias);
  if (c.agenda_proxima_semana?.length) corpo += tituloSecao('Agenda da semana que começa') + lista(c.agenda_proxima_semana.map(a => `${/^\d{4}-\d{2}-\d{2}$/.test(a.data) ? `${a.data.slice(8, 10)}/${a.data.slice(5, 7)}` : a.data} — ${a.descricao}`));
  for (const s of c.secoes || []) {
    corpo += tituloSecao(ROTULO_AREA[s.area] || s.area) + `<p style="font-size:13px;line-height:1.5;color:#475569;margin:0 0 6px;">${esc(s.resumo)}</p>` + (s.itens.length ? lista(s.itens) : '');
  }
  if (pendencias.length) corpo += tituloSecao('Pendências que o diretor está cobrando') + lista(pendencias.map(x => `${x.descricao} (desde ${x.desde.slice(8, 10)}/${x.desde.slice(5, 7)})`));
  if (c.observacoes_dados) corpo += `<p style="font-size:11px;line-height:1.5;color:#94a3b8;margin:16px 0 0;">Sobre os dados: ${esc(c.observacoes_dados)}</p>`;

  const sitTxt = `[${sit.rotulo}]`;
  const texto = [
    `Diretor (IA) · ${p.empresa} · ${p.tipoRotulo} — ${p.periodo}`, '', `${sitTxt} ${c.manchete}`, resumo ? `\n${resumo}` : '',
    '', 'PONTOS DE ATENÇÃO', ...(c.pontos_de_atencao.length ? c.pontos_de_atencao.map(pt => `- [${pt.gravidade}] ${pt.titulo}: ${pt.detalhe}${pt.acao_sugerida ? ` → ${pt.acao_sugerida}` : ''}`) : ['- Nada fora do normal.']),
    ...(prioridades.length ? ['', c.recomendacoes ? 'RECOMENDAÇÕES' : 'PRIORIDADES', ...prioridades.map((x, i) => `${i + 1}. ${x}`)] : []),
    ...(pendencias.length ? ['', 'PENDÊNCIAS', ...pendencias.map(x => `- ${x.descricao}`)] : []),
    '', `Relatório completo: ${p.link}`,
  ].join('\n');

  const manchete = c.manchete.length > 90 ? `${c.manchete.slice(0, 87)}…` : c.manchete;
  return { assunto: `${sitTxt} ${p.empresa} · ${p.tipoRotulo} ${p.periodo} — ${manchete}`, html: moldura(`${p.tipoRotulo} — ${p.periodo}`, p.empresa, corpo, p.link, 'Abrir relatório completo'), texto };
}

export function montarEmailAlertas(p: { empresa: string; alertas: { titulo: string; detalhe: string | null }[]; link: string }): { assunto: string; html: string; texto: string } {
  const LIMITE = 20;
  const mostrados = p.alertas.slice(0, LIMITE);
  let corpo = `<p style="font-size:13px;line-height:1.6;color:#475569;margin:0 0 12px;">${p.alertas.length} alerta(s) novo(s) desde o último envio. Cada ocorrência é avisada uma vez.</p>`;
  corpo += mostrados.map(a => `<div style="border-left:4px solid #f59e0b;padding:6px 0 6px 12px;margin-bottom:10px;">
<div style="font-size:13px;font-weight:bold;color:${AZUL};">${esc(a.titulo)}</div>
${a.detalhe ? `<div style="font-size:13px;line-height:1.5;color:#475569;margin-top:2px;">${esc(a.detalhe)}</div>` : ''}</div>`).join('');
  if (p.alertas.length > LIMITE) corpo += `<p style="font-size:12px;color:#64748B;">… e mais ${p.alertas.length - LIMITE} na tela.</p>`;
  const texto = [`Diretor (IA) · ${p.empresa} — ${p.alertas.length} alerta(s) novo(s)`, '', ...mostrados.map(a => `- ${a.titulo}${a.detalhe ? `: ${a.detalhe}` : ''}`), '', `Ver na tela: ${p.link}`].join('\n');
  return { assunto: `[Alertas] ${p.empresa} · ${p.alertas.length} novo(s) — ${p.alertas[0].titulo}`.slice(0, 160), html: moldura(`${p.alertas.length} alerta(s) novo(s)`, p.empresa, corpo, p.link, 'Ver alertas'), texto };
}
