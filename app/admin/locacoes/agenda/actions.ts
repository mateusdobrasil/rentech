'use server';

// app/admin/locacoes/agenda/actions.ts
// Agenda de disponibilidade (2026-11-17): ocupação diária por equipamento de
// uma empresa num período, a partir das alocações (fichas do P2S importadas
// e fichas criadas aqui). Só leitura. Motor: agendaOcupacao em
// app/lib/locacao/disponibilidade.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { agendaOcupacao } from '../../../lib/locacao/disponibilidade';
import { dataValida, somarDias } from '../../../lib/locacao/datas';
import { ultimaImportacaoFichasP2s } from '../../../lib/locacao/importarFichasP2s';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/locacoes/agenda';
const MAX_DIAS = 92;

export async function agendaAction(args: { empresa_id?: number | null; inicio: string; dias: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!dataValida(args.inicio)) return { ok: false, erro: 'Data inicial inválida.' };
  const dias = Math.min(MAX_DIAS, Math.max(1, Math.floor(Number(args.dias) || 30)));
  const db = supabaseAdmin();
  try {
    const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: emps } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
    const empresas = (emps || []).filter((e: any) => permitidas === null || permitidas.includes(e.id))
      .map((e: any) => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() }));
    if (!empresas.length) return { ok: true, info: { empresas, dias: [], produtos: [], fichas: {} } };
    const empresaId = args.empresa_id && empresas.some(e => e.id === args.empresa_id) ? args.empresa_id : empresas[0].id;
    if (!empresaPermitida(permitidas, empresaId)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };

    const fim = somarDias(args.inicio, dias - 1);
    const agenda = await agendaOcupacao(db, empresaId, args.inicio, fim);

    // categoria/unidade para filtro e exibição
    const ids = agenda.produtos.map(p => p.produto_id);
    const extras = new Map<number, { categoria: string | null; unidade: string | null }>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await db.from('produtos').select('id, categoria_nome, unidade').in('id', ids.slice(i, i + 300));
      for (const p of data || []) extras.set(p.id, { categoria: p.categoria_nome, unidade: p.unidade });
    }

    // fichas citadas (para o detalhe do dia)
    const fichaIds = [...new Set(agenda.produtos.flatMap(p => p.alocacoes.map(a => a.ficha_id)))];
    const fichas: Record<number, any> = {};
    for (let i = 0; i < fichaIds.length; i += 300) {
      const { data } = await db.from('locacao_fichas_reserva')
        .select('id, status, origem, p2s_numero, p2s_status, data_inicio, data_fim, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)')
        .in('id', fichaIds.slice(i, i + 300));
      for (const f of (data || []) as any[]) fichas[f.id] = {
        id: f.id, status: f.status, origem: f.origem, p2s_numero: f.p2s_numero, p2s_status: f.p2s_status,
        data_inicio: f.data_inicio, data_fim: f.data_fim,
        cliente: f.parceiro ? (f.parceiro.nome_exibicao || f.parceiro.nome_completo) : '—', evento: f.evento?.nome || null,
      };
    }

    return {
      ok: true,
      info: {
        empresas, empresaId, dias: agenda.dias, fichas,
        produtos: agenda.produtos.map(p => ({ ...p, ...(extras.get(p.produto_id) || { categoria: null, unidade: null }) })),
        ultimaImportacaoP2s: await ultimaImportacaoFichasP2s(db),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
