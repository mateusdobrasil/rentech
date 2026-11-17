'use server';

// app/admin/relatorios/actions.ts
// HUB Relatórios (2026-11-17): cada relatório valida a PRÓPRIA rota e só vê as
// empresas permitidas do usuário. Vendas e Orçamentos respeitam a carteira:
// vendedor padrão (escopo CARTEIRA em Permissões → Locação) só vê o dele.
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso, validarAcessoAlgumaRota, obterEmpresasPermitidas } from '../../lib/serverAuth';
import { acessoLocacao } from '../../lib/locacao/acessoFichas';
import { relatorioVendas, relatorioOrcamentos, relatorioFinanceiro, relatorioEquipamentos, type FiltrosRelatorio } from '../../lib/relatorios/consultas';
import { gerarRelatorioPdf, type DadosRelatorioPdf } from '../../lib/relatorios/gerarRelatorioPdf';

type Resultado = { ok: boolean; erro?: string; info?: any };
export interface FiltrosTela { de: string; ate: string; empresaId: number | null; vendedorId?: number | null }

const ROTAS = {
  vendas: '/admin/relatorios/vendas', orcamentos: '/admin/relatorios/orcamentos',
  financeiro: '/admin/relatorios/financeiro', equipamentos: '/admin/relatorios/equipamentos',
} as const;
const dataOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

async function contexto(accessToken: string, rota: string, ft: FiltrosTela, usaCarteira: boolean) {
  const v = await validarAcesso(accessToken, rota);
  if (!v.ok) return { erro: v.message } as const;
  if (!dataOk(ft.de) || !dataOk(ft.ate) || ft.ate < ft.de) return { erro: 'Período inválido.' } as const;
  const db = supabaseAdmin();
  const permitidas = await obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada);
  const { data: emps } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
  const empresas = ((emps || []) as any[]).filter(e => permitidas === null || permitidas.includes(e.id)).map(e => ({ id: e.id as number, nome: String(e.nome_curto || e.nome).trim() }));
  const empresaIds = ft.empresaId ? empresas.filter(e => e.id === ft.empresaId).map(e => e.id) : empresas.map(e => e.id);
  let vendedorId = ft.vendedorId || null;
  let soDoVendedor: string | null = null;
  if (usaCarteira) {
    const a = await acessoLocacao(db, v.perfil);
    if (a.escopo === 'CARTEIRA') {
      if (!a.vendedorId) return { erro: 'Seu usuário não está ligado a um vendedor (Parâmetros → Permissões → Locação).' } as const;
      vendedorId = a.vendedorId; soDoVendedor = a.vendedorNome;
    }
  }
  const filtros: FiltrosRelatorio = { de: ft.de, ate: ft.ate, empresaIds, vendedorId };
  return { db, filtros, empresas, soDoVendedor } as const;
}

async function vendedoresDaLista(db: ReturnType<typeof supabaseAdmin>) {
  const { data } = await db.from('colaboradores').select('id, nome_exibicao').eq('flag_vendedor_rep', true).order('nome_exibicao');
  return ((data || []) as any[]).map(v => ({ id: v.id as number, nome: String(v.nome_exibicao || '').trim() }));
}

export async function relatorioVendasAction(ft: FiltrosTela, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, ROTAS.vendas, ft, true);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    return { ok: true, info: { empresas: ctx.empresas, soDoVendedor: ctx.soDoVendedor, vendedores: ctx.soDoVendedor ? [] : await vendedoresDaLista(ctx.db), dados: await relatorioVendas(ctx.db, ctx.filtros) } };
  } catch (e: any) { return { ok: false, erro: e.message }; }
}
export async function relatorioOrcamentosAction(ft: FiltrosTela, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, ROTAS.orcamentos, ft, true);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    return { ok: true, info: { empresas: ctx.empresas, soDoVendedor: ctx.soDoVendedor, vendedores: ctx.soDoVendedor ? [] : await vendedoresDaLista(ctx.db), dados: await relatorioOrcamentos(ctx.db, ctx.filtros) } };
  } catch (e: any) { return { ok: false, erro: e.message }; }
}
export async function relatorioFinanceiroAction(ft: FiltrosTela, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, ROTAS.financeiro, ft, false);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: { empresas: ctx.empresas, dados: await relatorioFinanceiro(ctx.db, ctx.filtros) } }; } catch (e: any) { return { ok: false, erro: e.message }; }
}
export async function relatorioEquipamentosAction(ft: FiltrosTela, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, ROTAS.equipamentos, ft, false);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: { empresas: ctx.empresas, dados: await relatorioEquipamentos(ctx.db, ctx.filtros) } }; } catch (e: any) { return { ok: false, erro: e.message }; }
}

/** PDF de qualquer relatório (a tela manda os textos já formatados). */
export async function relatorioPdfAction(dados: DadosRelatorioPdf, accessToken: string): Promise<Resultado> {
  const v = await validarAcessoAlgumaRota(accessToken, Object.values(ROTAS));
  if (!v.ok) return { ok: false, erro: v.message };
  try {
    const limitado: DadosRelatorioPdf = { ...dados, tabelas: (dados.tabelas || []).slice(0, 12).map(t => ({ ...t, linhas: (t.linhas || []).slice(0, 2000) })) };
    const bytes = await gerarRelatorioPdf(limitado);
    return { ok: true, info: { base64: Buffer.from(bytes).toString('base64') } };
  } catch (e: any) { return { ok: false, erro: e.message }; }
}
