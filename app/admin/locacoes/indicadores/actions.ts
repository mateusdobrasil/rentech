'use server';

// app/admin/locacoes/indicadores/actions.ts
// Indicadores de utilização (2026-11-17). Cálculo em app/lib/locacao/indicadores.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { calcularUtilizacao } from '../../../lib/locacao/indicadores';
import { importarFichasP2sCore } from '../../../lib/locacao/importarFichasP2s';
import { dataValida, diasInclusivos } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/locacoes/indicadores';

export async function indicadoresAction(args: { empresa_id?: number | null; inicio: string; fim: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!dataValida(args.inicio) || !dataValida(args.fim) || args.fim < args.inicio) return { ok: false, erro: 'Período inválido.' };
  if (diasInclusivos(args.inicio, args.fim) > 1100) return { ok: false, erro: 'Período de no máximo 3 anos.' };
  const db = supabaseAdmin();
  try {
    const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: emps } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
    const empresas = (emps || []).filter((e: any) => permitidas === null || permitidas.includes(e.id))
      .map((e: any) => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() }));
    if (!empresas.length) return { ok: true, info: { empresas, linhas: [] } };
    const empresaId = args.empresa_id && empresas.some(e => e.id === args.empresa_id) ? args.empresa_id : empresas[0].id;
    if (!empresaPermitida(permitidas, empresaId)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
    const r = await calcularUtilizacao(db, empresaId, args.inicio, args.fim);
    return { ok: true, info: { empresas, empresaId, ...r } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Importa do P2S as fichas que cruzam [de, ate] (um mês por chamada). */
export async function importarHistoricoAction(args: { de: string; ate: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!dataValida(args.de) || !dataValida(args.ate) || args.ate < args.de) return { ok: false, erro: 'Período inválido.' };
  if (diasInclusivos(args.de, args.ate) > 62) return { ok: false, erro: 'Importe no máximo 2 meses por vez.' };
  try {
    const r = await importarFichasP2sCore(supabaseAdmin(), { de: args.de, ate: args.ate });
    registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: 'IMPORTOU HISTÓRICO DE FICHAS DO P2S', setor: 'LOCACOES', equipamento_nome: `${args.de} a ${args.ate}: ${r.gravadas} fichas` });
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
