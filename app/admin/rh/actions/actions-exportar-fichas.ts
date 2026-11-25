'use server';

// app/admin/rh/actions/actions-exportar-fichas.ts
// Dados para o botão "Exportar Excel" da Ficha do Funcionário
// (/admin/rh/funcionario). Devolve só as colunas pedidas que estão no catálogo
// (app/lib/camposFichaExport.ts) e só de funcionários das empresas do usuário
// (obterEmpresasPermitidas, resolvida aqui no servidor). A planilha é montada
// no navegador.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas } from '../../../lib/serverAuth';
import { COLUNAS_FICHA_PERMITIDAS } from '../../../lib/camposFichaExport';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/rh/funcionario';
const LOTE = 200; // ids por consulta (o filtro .in vai na URL)

export async function exportarFichasAction(payload: {
  ids: string[];
  colunas: string[];
  dependentes: boolean;
  movimentacoes: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const ids = [...new Set((payload.ids || []).filter(i => typeof i === 'string' && i))];
  if (ids.length === 0) return { ok: false, erro: 'Nenhum colaborador para exportar.' };
  const colunas = [...new Set((payload.colunas || []).filter(c => COLUNAS_FICHA_PERMITIDAS.has(c)))];

  try {
    const db = supabaseAdmin();
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const selecao = ['id', 'nome_completo', 'empresa_id', ...colunas.filter(c => c !== 'empresa_id')].join(', ');

    const fichas: any[] = [];
    for (let i = 0; i < ids.length; i += LOTE) {
      let q = db.from('folha_funcionarios').select(selecao).in('id', ids.slice(i, i + LOTE));
      if (empresasPermitidas) q = q.in('empresa_id', empresasPermitidas);
      const { data, error } = await q;
      if (error) return { ok: false, erro: error.message };
      fichas.push(...(data || []));
    }
    fichas.sort((a, b) => String(a.nome_completo).localeCompare(String(b.nome_completo), 'pt-BR'));

    // Dependentes e movimentações: pela ficha (funcionario_id); os registros
    // antigos sem id, pelo nome.
    const idsOk = fichas.map(f => f.id as string);
    const nomePorId = new Map(fichas.map(f => [f.id as string, f.nome_completo as string]));
    const nomes = fichas.map(f => f.nome_completo as string);
    async function ligados(tabela: string, cols: string, ordem: string) {
      const linhas: any[] = [];
      for (let i = 0; i < idsOk.length; i += LOTE) {
        const [porId, porNome] = await Promise.all([
          db.from(tabela).select(`id, funcionario_id, funcionario_nome, ${cols}`).in('funcionario_id', idsOk.slice(i, i + LOTE)),
          db.from(tabela).select(`id, funcionario_id, funcionario_nome, ${cols}`).is('funcionario_id', null).in('funcionario_nome', nomes.slice(i, i + LOTE)),
        ]);
        if (porId.error) throw new Error(porId.error.message);
        if (porNome.error) throw new Error(porNome.error.message);
        linhas.push(...(porId.data || []), ...(porNome.data || []));
      }
      return linhas
        .map(l => ({ ...l, funcionario: (l.funcionario_id && nomePorId.get(l.funcionario_id)) || l.funcionario_nome }))
        .sort((a, b) => String(a.funcionario).localeCompare(String(b.funcionario), 'pt-BR') || String(a[ordem] || '').localeCompare(String(b[ordem] || '')));
    }

    const [dependentes, movimentacoes, empresas] = await Promise.all([
      payload.dependentes ? ligados('folha_dependentes', 'tipo_dependente, nome_completo, cpf, data_nascimento', 'nome_completo') : Promise.resolve([]),
      payload.movimentacoes ? ligados('folha_movimentacoes', 'motivo, cargo, data_movimentacao', 'data_movimentacao') : Promise.resolve([]),
      db.from('empresas').select('id, nome').then(r => r.data || []),
    ]);

    return { ok: true, info: { fichas, colunas, dependentes, movimentacoes, empresas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
