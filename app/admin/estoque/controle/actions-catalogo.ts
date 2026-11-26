'use server';

// Conferência "Ligar a Produtos" do Controle de Estoque (2026-11-26).
// Cada equipamento do catálogo técnico (equipamentos) é ligado ao produto do
// catálogo de locação (produtos), vira produto novo, ou é marcado como "não é
// item de locação". Ligar: quem acessa o Controle de Estoque. Criar produto:
// só quem também acessa Estoque → Produtos (o catálogo é de quem cuida dele).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, possuiAcessoRota } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { categoriasDoCatalogo, salvarProduto, type ArvoreCategorias } from '../../../lib/cadastros/produtos';
import { maisParecidos } from '../../../lib/cadastros/semelhanca';
import { buscarTodasPaginas } from '../../../lib/paginacao';

const ROTA = '/admin/estoque/controle';
const ROTA_PRODUTOS = '/admin/estoque/produtos';
const SETOR = 'ESTOQUE';
type Resultado<T> = { ok: boolean; erro?: string; info?: T };
const semSql = (m: string) => (/produto_id|fora_do_catalogo/.test(m) ? 'Falta rodar o SQL (.sql/Pendentes/equipamentos_ligar_produtos.sql).' : m);

// Categoria do Controle → categoria de Produtos sugerida para "criar produto".
const MAPA_CATEGORIA: Record<string, string> = {
  adp: '16', acc: '11', cab: '14', truss: '24', light: '21', mon: '02', led: '18', cpu: '05',
  proc: '25', 'proc.': '25', sound: '13', touch: '15', tv: '01', pvideo: '08', fones: '13',
};

export interface ProdutoLeve { id: number; codigo: string | null; nome: string; categoria: string | null; subcategoria: string | null; desuso: boolean }
export interface LinhaConferencia {
  id: string; nome: string; categoriaId: string; categoriaNome: string; ativo: boolean;
  produtoId: number | null; foraDoCatalogo: boolean;
  qtdAntiga: number | null;                         // contagem do controle antigo (referência p/ o inventário)
  sugestoes: { produtoId: number; nota: number }[];
  categoriaSugerida: string | null;                 // para "criar produto"
}
export interface DadosConferencia {
  linhas: LinhaConferencia[];
  produtos: ProdutoLeve[];
  arvore: ArvoreCategorias[];
  podeCriar: boolean;
}

export async function conferenciaCatalogoAction(accessToken: string): Promise<Resultado<DadosConferencia>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const db = supabaseAdmin();
  try {
    const [eq, cats, est] = await Promise.all([
      db.from('equipamentos').select('id, nome, categoria_id, ativo, produto_id, fora_do_catalogo').order('nome'),
      db.from('categorias').select('id, nome'),
      db.from('estoque').select('equipamento_id, qtd_total'),
    ]);
    if (eq.error) return { ok: false, erro: semSql(eq.error.message) };
    const { data: prods, error: eP } = await buscarTodasPaginas<{ id: number; codigo_formatado: string | null; nome_item: string; categoria_nome: string | null; sub_categoria_nome: string | null; flag_em_desuso: boolean | null }>(
      (de, ate) => db.from('produtos').select('id, codigo_formatado, nome_item, categoria_nome, sub_categoria_nome, flag_em_desuso').order('codigo_formatado').range(de, ate), 1000, 20000);
    if (eP) return { ok: false, erro: eP.message };
    // "99999 - ITEM EXCLUIDO" não entra nas sugestões nem na busca
    const produtos: ProdutoLeve[] = prods.filter(p => !/^99999/.test(p.categoria_nome || ''))
      .map(p => ({ id: p.id, codigo: p.codigo_formatado, nome: p.nome_item, categoria: p.categoria_nome, subcategoria: p.sub_categoria_nome, desuso: !!p.flag_em_desuso }));
    const ativos = produtos.filter(p => !p.desuso);
    const arvore = (await categoriasDoCatalogo(db)).categorias.filter(c => !/^99999/.test(c.categoria));
    const catNome = new Map(((cats.data || []) as { id: string; nome: string }[]).map(c => [c.id, c.nome]));
    const qtd = new Map(((est.data || []) as { equipamento_id: string; qtd_total: number | null }[]).map(e => [e.equipamento_id, e.qtd_total]));
    const linhas: LinhaConferencia[] = ((eq.data || []) as { id: string; nome: string; categoria_id: string; ativo: boolean; produto_id: number | null; fora_do_catalogo: boolean }[]).map(e => {
      const sug = e.produto_id || e.fora_do_catalogo ? [] : maisParecidos(e.nome, ativos, p => p.nome, 3);
      const pref = MAPA_CATEGORIA[String(e.categoria_id || '').toLowerCase()];
      const catSug = sug[0]?.item.categoria || (pref ? arvore.find(c => c.categoria.startsWith(`${pref} `))?.categoria || null : null);
      return {
        id: e.id, nome: e.nome, categoriaId: e.categoria_id, categoriaNome: catNome.get(e.categoria_id) || e.categoria_id, ativo: e.ativo !== false,
        produtoId: e.produto_id, foraDoCatalogo: !!e.fora_do_catalogo, qtdAntiga: qtd.get(e.id) ?? null,
        sugestoes: sug.map(s => ({ produtoId: s.item.id, nota: s.nota })),
        categoriaSugerida: catSug,
      };
    });
    const podeCriar = acesso.perfil.permissaoNormalizada === 'ADMINISTRADOR' || await possuiAcessoRota(acesso.perfil.permissaoNormalizada, ROTA_PRODUTOS);
    return { ok: true, info: { linhas, produtos, arvore, podeCriar } };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

/** Liga (produtoId), marca "não é de locação" (fora) ou desfaz (os dois vazios) — um ou vários. */
export async function ligarEquipamentosAction(itens: { equipamentoId: string; produtoId: number | null; fora: boolean }[], accessToken: string): Promise<Resultado<{ feitos: number }>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!Array.isArray(itens) || !itens.length || itens.length > 500) return { ok: false, erro: 'Nada para gravar.' };
  const db = supabaseAdmin();
  const ids = [...new Set(itens.map(i => Number(i.produtoId)).filter(n => Number.isFinite(n) && n > 0))];
  if (ids.length) {
    const { data } = await db.from('produtos').select('id').in('id', ids);
    if ((data || []).length !== ids.length) return { ok: false, erro: 'Algum produto escolhido não existe mais. Recarregue a conferência.' };
  }
  let feitos = 0;
  for (const i of itens) {
    const produtoId = i.produtoId ? Number(i.produtoId) : null;
    const { error } = await db.from('equipamentos').update({ produto_id: produtoId, fora_do_catalogo: !produtoId && !!i.fora }).eq('id', String(i.equipamentoId));
    if (error) return { ok: false, erro: semSql(error.message) };
    feitos++;
  }
  await registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `CONTROLE DE ESTOQUE: LIGOU ${feitos} EQUIPAMENTO(S) A PRODUTOS`, setor: SETOR });
  return { ok: true, info: { feitos } };
}

/** Cria o produto a partir do equipamento e já liga. */
export async function criarProdutoDoEquipamentoAction(p: { equipamentoId: string; nome: string; categoria: string; subcategoria: string; unidade: string; controle: 'QUANTIDADE' | 'INDIVIDUAL' }, accessToken: string): Promise<Resultado<{ produtoId: number; codigo: string | null }>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const podeCriar = acesso.perfil.permissaoNormalizada === 'ADMINISTRADOR' || await possuiAcessoRota(acesso.perfil.permissaoNormalizada, ROTA_PRODUTOS);
  if (!podeCriar) return { ok: false, erro: 'Criar produto exige acesso a Estoque → Produtos. Ligue a um produto existente ou peça a quem cuida do catálogo.' };
  const db = supabaseAdmin();
  const { data: eq, error: eE } = await db.from('equipamentos').select('id, nome, peso, produto_id').eq('id', String(p.equipamentoId)).maybeSingle();
  if (eE) return { ok: false, erro: semSql(eE.message) };
  if (!eq) return { ok: false, erro: 'Equipamento não encontrado.' };
  if (eq.produto_id) return { ok: false, erro: 'Este equipamento já está ligado a um produto.' };
  try {
    const r = await salvarProduto(db, {
      nome_item: p.nome, categoria_nome: p.categoria, sub_categoria_nome: p.subcategoria, unidade: p.unidade || 'UN',
      habilitado_para_locacao: true, habilitado_para_venda: false, flag_em_desuso: false,
      peso_unitario: Number(eq.peso) > 0 ? Number(eq.peso) : null,
      controle_locacao: p.controle === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'QUANTIDADE', dias_preparo: 0, dias_retorno: 0,
      observacoes: `Criado a partir do Controle de Estoque (${eq.nome}).`,
    }, acesso.perfil.nome);
    const { error } = await db.from('equipamentos').update({ produto_id: r.id, fora_do_catalogo: false }).eq('id', eq.id);
    if (error) return { ok: false, erro: semSql(error.message) };
    await registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `CONTROLE DE ESTOQUE: CRIOU PRODUTO ${r.codigo_formatado} ${p.nome.toUpperCase()} (de ${eq.nome})`, setor: SETOR });
    return { ok: true, info: { produtoId: r.id, codigo: r.codigo_formatado } };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}
