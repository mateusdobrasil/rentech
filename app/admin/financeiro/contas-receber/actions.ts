'use server';

// app/admin/financeiro/contas-receber/actions.ts
// Tela de Contas a Receber (/admin/financeiro/contas-receber, pedido de
// 2026-11-15) — irmã da de Contas a Pagar. Diferença: a leitura é pelo
// servidor (financeiro_contas_receber só tem grant pro service_role) e já
// sai filtrada pelas empresas do usuário (obterEmpresasPermitidas).
// O sync em si fica em contasReceberCore.ts, reaproveitado pelo cron.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { registrarLogAuditoria } from '../../../actions';
import { sincronizarContasReceberCore } from './contasReceberCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/financeiro/contas-receber';
const TAMANHO_PAGINA = 50;

export type SituacaoReceber = 'abertas' | 'a_vencer' | 'vencidas' | 'vencidas_ate_1_ano' | 'vencidas_mais_1_ano' | 'quitadas' | 'todas';

export interface FiltrosContasReceber {
  texto?: string;
  situacao: SituacaoReceber;
  empresaId?: number | null;
  de?: string;     // AAAA-MM-DD — vencimento (ou quitação, quando situacao = quitadas)
  ate?: string;
  pagina: number;
}

function hojeBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const dataValida = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function contexto(accessToken: string) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}

// Empresas que o usuário vê — alimenta o seletor da tela.
async function empresasVisiveis(permitidas: number[] | null) {
  const { data } = await supabaseAdmin().from('empresas').select('*').eq('ativo', true).order('id');
  return ((data || []) as any[])
    .filter(e => permitidas === null || permitidas.includes(e.id))
    .map(e => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim(), fonte_recebimentos: e.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S' }));
}

export async function listarContasReceberAction(filtros: FiltrosContasReceber, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const empresas = await empresasVisiveis(ctx.permitidas);
  if (!empresas.length) return { ok: true, info: { empresas, linhas: [], total: 0, soma: 0, tamanhoPagina: TAMANHO_PAGINA } };
  const idsEmpresas = filtros.empresaId && empresas.some(e => e.id === filtros.empresaId) ? [filtros.empresaId] : empresas.map(e => e.id);

  const hoje = hojeBrasilia();
  const quitadas = filtros.situacao === 'quitadas';
  const campoData = quitadas ? 'data_quitacao' : 'data_vencimento';
  const pagina = Math.max(0, Math.floor(filtros.pagina || 0));

  // Mesmos filtros para a página e para a soma do filtro inteiro.
  const filtrar = (q: any) => {
    q = q.in('empresa_id', idsEmpresas);
    switch (filtros.situacao) {
      case 'abertas': q = q.eq('quitado', false); break;
      case 'a_vencer': q = q.eq('quitado', false).gte('data_vencimento', hoje); break;
      case 'vencidas': q = q.eq('quitado', false).lt('data_vencimento', hoje); break;
      case 'vencidas_ate_1_ano': q = q.eq('quitado', false).lt('data_vencimento', hoje).gte('data_vencimento', somarDias(hoje, -365)); break;
      case 'vencidas_mais_1_ano': q = q.eq('quitado', false).lt('data_vencimento', somarDias(hoje, -365)); break;
      case 'quitadas': q = q.eq('quitado', true); break;
    }
    const texto = (filtros.texto || '').replace(/[%_,()]/g, ' ').trim();
    if (texto) q = q.or(`cliente.ilike.%${texto}%,descricao.ilike.%${texto}%,num_documento.ilike.%${texto}%,evento.ilike.%${texto}%,centro_financeiro.ilike.%${texto}%`);
    if (dataValida(filtros.de)) q = q.gte(campoData, filtros.de);
    if (dataValida(filtros.ate)) q = q.lte(campoData, filtros.ate);
    return q;
  };

  const db = supabaseAdmin();
  const de = pagina * TAMANHO_PAGINA;
  const [paginaRes, somaRes] = await Promise.all([
    filtrar(db.from('financeiro_contas_receber')
      .select('id, empresa_id, cliente, descricao, documento, num_documento, num_parcela, evento, centro_financeiro, forma_pagamento, conta_financeira, valor_final, valor_pago, data_emissao, data_vencimento, data_quitacao, quitado, prorrogado', { count: 'exact' }))
      .order(campoData, { ascending: !quitadas, nullsFirst: false }).order('id')
      .range(de, de + TAMANHO_PAGINA - 1),
    buscarTodasPaginas((i, f) => filtrar(db.from('financeiro_contas_receber').select('id, valor_final, valor_pago, quitado')).order('id').range(i, f)),
  ]);
  if (paginaRes.error) return { ok: false, erro: paginaRes.error.message };
  const soma = (somaRes.data as any[]).reduce((s, l) => s + (l.quitado ? (Number(l.valor_pago) || Number(l.valor_final) || 0) : (Number(l.valor_final) || 0)), 0);

  return { ok: true, info: { empresas, linhas: paginaRes.data || [], total: paginaRes.count || 0, soma: Math.round(soma * 100) / 100, tamanhoPagina: TAMANHO_PAGINA, hoje } };
}

// Cartões do topo: a vencer, vencido até 1 ano, vencido há mais de 1 ano
// (quase sempre baixa pendente no P2S) e recebido no mês.
export async function resumoContasReceberAction(empresaId: number | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const empresas = await empresasVisiveis(ctx.permitidas);
  const ids = empresaId && empresas.some(e => e.id === empresaId) ? [empresaId] : empresas.map(e => e.id);
  if (!ids.length) return { ok: true, info: null };

  const hoje = hojeBrasilia();
  const umAno = somarDias(hoje, -365);
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const db = supabaseAdmin();
  const [abertos, recebidos] = await Promise.all([
    buscarTodasPaginas((i, f) => db.from('financeiro_contas_receber').select('id, valor_final, data_vencimento').in('empresa_id', ids).eq('quitado', false).order('id').range(i, f)),
    buscarTodasPaginas((i, f) => db.from('financeiro_contas_receber').select('id, valor_final, valor_pago').in('empresa_id', ids).eq('quitado', true).gte('data_quitacao', inicioMes).lte('data_quitacao', hoje).order('id').range(i, f)),
  ]);
  if (abertos.error) return { ok: false, erro: abertos.error.message };
  const vq = () => ({ valor: 0, qtd: 0 });
  const r = { aVencer: vq(), aVencer7d: vq(), vencidoAte1Ano: vq(), vencidoMais1Ano: vq(), recebidoMes: vq() };
  const em7 = somarDias(hoje, 7);
  for (const l of abertos.data as any[]) {
    const v = Number(l.valor_final) || 0;
    const alvo = l.data_vencimento >= hoje ? r.aVencer : l.data_vencimento >= umAno ? r.vencidoAte1Ano : r.vencidoMais1Ano;
    alvo.valor += v; alvo.qtd++;
    if (l.data_vencimento >= hoje && l.data_vencimento <= em7) { r.aVencer7d.valor += v; r.aVencer7d.qtd++; }
  }
  for (const l of recebidos.data as any[]) { r.recebidoMes.valor += Number(l.valor_pago) || Number(l.valor_final) || 0; r.recebidoMes.qtd++; }
  for (const k of Object.keys(r) as (keyof typeof r)[]) r[k].valor = Math.round(r[k].valor * 100) / 100;
  return { ok: true, info: r };
}

export async function sincronizarContasReceberP2sAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const r = await sincronizarContasReceberCore();
  registrarLogAuditoria({
    usuario_nome: ctx.perfil.nome,
    acao: 'SINCRONIZOU CONTAS A RECEBER VIA API (P2S)',
    setor: 'FINANCEIRO',
    equipamento_nome: r.ok ? `${r.info?.processados ?? 0} registro(s)` : `erro: ${r.erro}`.slice(0, 200),
  });
  return r;
}

export async function buscarUltimaSincronizacaoContasReceberAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  return { ok: true, info: await obterUltimaSincronizacao('contas_receber', 'PRODUCAO') };
}
