// app/lib/cadastros/produtos.ts
// Cadastro PRÓPRIO de produtos e equipamentos (2026-11-23). Só servidor, SEM
// checagem de acesso (quem chama valida rota). Mesma regra de transição dos
// parceiros (./parceiros.ts):
//   * o sistema vira a origem quando TODAS as empresas ativas congelarem o P2S;
//   * antes disso já dá para cadastrar aqui; quando o mesmo produto chega do
//     P2S (mesmo código formatado, ou o mesmo nome), o cadastro daqui é ADOTADO
//     — ganha o p2s_oid, passa a seguir o P2S e mantém o id (saldos,
//     patrimônios, kits, tabelas de preço e fichas continuam ligados);
//   * produto vindo do P2S é só leitura aqui até a virada. O que é de locação
//     (controle, dias de preparo/retorno, saldos, kits) já é do sistema e
//     continua em Estoque → Equipamentos de Locação.
// Código no padrão do P2S: categoria.subcategoria.sequência (11.02.0003), a
// sequência contando dentro da subcategoria.
import type { supabaseAdmin } from '../supabase';
import { cadastrosNoSistema } from './parceiros';
import { buscarTodasPaginas } from '../paginacao';

type Db = ReturnType<typeof supabaseAdmin>;

export const UNIDADES = ['UN', 'PÇ', 'CJT', 'KIT', 'M', 'M²', 'KG', 'CX'];
export const ORIGENS_NFE: Record<string, string> = {
  '0': '0 — Nacional',
  '1': '1 — Estrangeira, importação direta',
  '2': '2 — Estrangeira, adquirida no mercado interno',
  '3': '3 — Nacional, mais de 40% de conteúdo importado',
  '4': '4 — Nacional, processos produtivos básicos',
  '5': '5 — Nacional, até 40% de conteúdo importado',
  '6': '6 — Estrangeira, importação direta, sem similar',
  '7': '7 — Estrangeira, mercado interno, sem similar',
  '8': '8 — Nacional, mais de 70% de conteúdo importado',
};

const txt = (v: unknown, max = 300) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, max) : null; };
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const normalizar = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
/** "13 - PERIFERICO SOM" → "13" */
const prefixo = (nome: string | null | undefined) => (String(nome || '').match(/^\s*(\d{1,3})\s*-/)?.[1] || '').padStart(2, '0').replace(/^0+(?=\d{2})/, '');

// ============================================================================
// CATEGORIAS (as do catálogo; nova categoria/subcategoria = só o nome)
// ============================================================================
export interface ArvoreCategorias { categoria: string; subcategorias: string[] }

export async function categoriasDoCatalogo(db: Db): Promise<{ categorias: ArvoreCategorias[]; marcas: string[] }> {
  const { data: linhas, error } = await buscarTodasPaginas<{ categoria_nome: string | null; sub_categoria_nome: string | null; marca_nome: string | null }>(
    (de, ate) => db.from('produtos').select('categoria_nome, sub_categoria_nome, marca_nome').order('id').range(de, ate), 1000, 20000);
  if (error) throw new Error(error.message);
  const mapa = new Map<string, Set<string>>();
  const marcas = new Set<string>();
  for (const l of linhas) {
    const c = txt(l.categoria_nome);
    if (c) { if (!mapa.has(c)) mapa.set(c, new Set()); const s = txt(l.sub_categoria_nome); if (s) mapa.get(c)!.add(s); }
    const m = txt(l.marca_nome); if (m) marcas.add(m);
  }
  const ordem = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });
  return {
    categorias: [...mapa.entries()].map(([categoria, subs]) => ({ categoria, subcategorias: [...subs].sort(ordem) })).sort((a, b) => ordem(a.categoria, b.categoria)),
    marcas: [...marcas].sort(ordem),
  };
}

/** Próximo código na subcategoria: { codigo: sequência, codigo_formatado: "CC.SS.NNNN" }. */
export async function proximoCodigo(db: Db, categoria: string, subcategoria: string): Promise<{ codigo: number; codigo_formatado: string | null }> {
  const c = prefixo(categoria), s = prefixo(subcategoria);
  if (!c || !s) return { codigo: 1, codigo_formatado: null };
  // pelo prefixo do código (há nomes de categoria com espaço sobrando no P2S)
  const { data, error } = await db.from('produtos').select('codigo_formatado').like('codigo_formatado', `${c}.${s}.%`);
  if (error) throw new Error(error.message);
  const seqs = ((data || []) as { codigo_formatado: string | null }[]).map(p => Number(String(p.codigo_formatado || '').split('.')[2]) || 0);
  const codigo = (seqs.length ? Math.max(...seqs) : 0) + 1;
  return { codigo, codigo_formatado: `${c}.${s}.${String(codigo).padStart(4, '0')}` };
}

/** Referência (oid) do P2S da categoria/subcategoria, pelo prefixo do código. */
async function referenciaCategoria(db: Db, categoria: string, subcategoria: string) {
  const c = prefixo(categoria), s = prefixo(subcategoria);
  if (!c || !s) return { categoria: null, sub_categoria: null };
  const { data } = await db.from('produtos').select('categoria, sub_categoria').like('codigo_formatado', `${c}.${s}.%`).not('categoria', 'is', null).limit(1);
  return { categoria: (data?.[0]?.categoria as string) ?? null, sub_categoria: (data?.[0]?.sub_categoria as string) ?? null };
}

// ============================================================================
// SINCRONIZAÇÃO DO P2S: adoção e respeito à origem
// ============================================================================
type RegistroP2s = { p2s_oid: string; codigo_formatado: string | null; nome_item: string | null } & Record<string, unknown>;

export async function prepararGravacaoProdutosP2s<T extends RegistroP2s>(db: Db, registros: T[]): Promise<{ paraUpsert: T[]; adotados: number; ignorados: number }> {
  if (!registros.length) return { paraUpsert: [], adotados: 0, ignorados: 0 };
  const sistema = await cadastrosNoSistema(db);
  const existentes = new Set<string>();
  const oids = registros.map(r => r.p2s_oid);
  for (let i = 0; i < oids.length; i += 300) {
    const { data, error } = await db.from('produtos').select('p2s_oid').in('p2s_oid', oids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of (data || []) as { p2s_oid: string }[]) existentes.add(r.p2s_oid);
  }
  // cadastros daqui ainda sem p2s_oid (são poucos: lê todos)
  const { data: locaisRaw, error: eL } = await db.from('produtos').select('id, codigo_formatado, nome_item').is('p2s_oid', null);
  if (eL) throw new Error(eL.message);
  const locais = (locaisRaw || []) as { id: number; codigo_formatado: string | null; nome_item: string | null }[];
  const usados = new Set<number>();
  const acharLocal = (r: RegistroP2s) => {
    const cod = txt(r.codigo_formatado), nome = normalizar(r.nome_item);
    return locais.find(l => !usados.has(l.id) && cod && txt(l.codigo_formatado) === cod)
      || locais.find(l => !usados.has(l.id) && nome && normalizar(l.nome_item) === nome) || null;
  };
  const paraUpsert: T[] = [];
  let adotados = 0, ignorados = 0;
  for (const r of registros) {
    const jaExiste = existentes.has(r.p2s_oid);
    const local = jaExiste ? null : acharLocal(r);
    if (sistema) {
      if (jaExiste || local) { ignorados++; continue; }
      paraUpsert.push(r);
      continue;
    }
    if (local) {
      usados.add(local.id);
      const { error } = await db.from('produtos').update({ ...r, origem: 'P2S' }).eq('id', local.id);
      if (error) throw new Error(error.message);
      adotados++;
      continue;
    }
    paraUpsert.push(r);
  }
  return { paraUpsert, adotados, ignorados };
}

// ============================================================================
// CADASTRO
// ============================================================================
export interface DadosProduto {
  id?: number | null;
  nome_item: string;
  categoria_nome: string;
  sub_categoria_nome: string;
  codigo_formatado?: string | null; // vazio = gera pela categoria/subcategoria
  unidade: string;
  marca_nome?: string | null;
  modelo?: string | null;
  descricao_detalhada?: string | null;
  habilitado_para_locacao: boolean;
  habilitado_para_venda: boolean;
  flag_em_desuso: boolean;
  custo_reposicao?: number | null;
  valor_indenizacao?: number | null;
  classificacao_fiscal?: string | null; // NCM
  origem_nfe?: number | null;
  peso_unitario?: number | null;
  controle_locacao: 'QUANTIDADE' | 'INDIVIDUAL';
  dias_preparo: number;
  dias_retorno: number;
  observacoes?: string | null;
}

export async function produtoEditavel(db: Db, p: { origem?: string | null; p2s_oid?: string | null }): Promise<{ editavel: boolean; motivo: string | null }> {
  if (p.origem === 'SISTEMA' && !p.p2s_oid) return { editavel: true, motivo: null };
  if (await cadastrosNoSistema(db)) return { editavel: true, motivo: null };
  return { editavel: false, motivo: 'Produto do P2S: enquanto o P2S for oficial, altere o cadastro lá; a mudança chega aqui na sincronização (11h e 17h). Controle, dias de preparo/retorno, saldos e kits continuam em Estoque → Equipamentos de Locação.' };
}

const numOuNull = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export async function salvarProduto(db: Db, d: DadosProduto, usuario: string): Promise<{ id: number; codigo_formatado: string | null; novo: boolean }> {
  const nome = txt(d.nome_item, 200);
  if (!nome) throw new Error('Informe o nome do produto.');
  const categoria = txt(d.categoria_nome, 120), sub = txt(d.sub_categoria_nome, 120);
  if (!categoria || !sub) throw new Error('Escolha a categoria e a subcategoria.');
  for (const [rot, v] of [['Categoria', categoria], ['Subcategoria', sub]] as const) if (!/^\d{1,3}\s*-\s*\S/.test(v)) throw new Error(`${rot} no formato "NN - NOME" (ex.: 13 - PERIFERICO SOM).`);
  const unidade = txt(d.unidade, 6)?.toUpperCase();
  if (!unidade) throw new Error('Informe a unidade.');
  const ncm = dig(d.classificacao_fiscal);
  if (ncm && ncm.length !== 8) throw new Error('NCM com 8 dígitos.');
  const origemNfe = d.origem_nfe === null || d.origem_nfe === undefined || (d.origem_nfe as unknown) === '' ? 0 : Number(d.origem_nfe);
  if (!(String(origemNfe) in ORIGENS_NFE)) throw new Error('Origem da mercadoria inválida.');
  const custo = numOuNull(d.custo_reposicao), indeniza = numOuNull(d.valor_indenizacao), peso = numOuNull(d.peso_unitario);
  for (const [rot, v] of [['Custo de reposição', custo], ['Valor de indenização', indeniza], ['Peso', peso]] as const) if (Number.isNaN(v) || (v !== null && v < 0)) throw new Error(`${rot} inválido.`);
  if (!['QUANTIDADE', 'INDIVIDUAL'].includes(d.controle_locacao)) throw new Error('Controle inválido.');
  const preparo = Math.floor(Number(d.dias_preparo)), retorno = Math.floor(Number(d.dias_retorno));
  if (!(preparo >= 0 && preparo <= 30) || !(retorno >= 0 && retorno <= 30)) throw new Error('Dias de preparo e de retorno entre 0 e 30.');

  let atual: { id: number; origem: string | null; p2s_oid: string | null; codigo_formatado: string | null; categoria_nome: string | null; sub_categoria_nome: string | null } | null = null;
  if (d.id) {
    const { data, error } = await db.from('produtos').select('id, origem, p2s_oid, codigo_formatado, categoria_nome, sub_categoria_nome').eq('id', d.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Produto não encontrado.');
    const e = await produtoEditavel(db, data);
    if (!e.editavel) throw new Error(e.motivo || 'Produto só para leitura.');
    atual = data;
  }

  // Código: o informado, o atual (se a subcategoria não mudou) ou o próximo da subcategoria.
  let codigoFmt = txt(d.codigo_formatado, 20);
  let codigoSeq: number | null = null;
  const mudouSub = !atual || normalizar(atual.categoria_nome) !== normalizar(categoria) || normalizar(atual.sub_categoria_nome) !== normalizar(sub);
  if (!codigoFmt && atual && !mudouSub && atual.codigo_formatado) codigoFmt = atual.codigo_formatado; // edição sem trocar de subcategoria: mantém
  if (!codigoFmt || (atual && mudouSub && codigoFmt === atual.codigo_formatado)) {
    const p = await proximoCodigo(db, categoria, sub);
    codigoFmt = p.codigo_formatado; codigoSeq = p.codigo;
  } else {
    codigoSeq = Number(codigoFmt.split('.')[2]) || null;
  }
  if (!codigoFmt) throw new Error('Não deu para gerar o código: informe-o (ex.: 13.09.0002).');
  let qDup = db.from('produtos').select('id, nome_item').eq('codigo_formatado', codigoFmt).limit(1);
  if (atual) qDup = qDup.neq('id', atual.id);
  const { data: dup } = await qDup;
  if (dup?.length) throw new Error(`O código ${codigoFmt} já é do produto ${dup[0].nome_item}.`);
  let qNome = db.from('produtos').select('id, codigo_formatado').ilike('nome_item', nome).limit(1);
  if (atual) qNome = qNome.neq('id', atual.id);
  const { data: dupNome } = await qNome;
  if (dupNome?.length) throw new Error(`Já existe um produto com este nome (código ${dupNome[0].codigo_formatado || dupNome[0].id}).`);

  const agora = new Date().toISOString();
  const linha: Record<string, unknown> = {
    nome_item: nome.toUpperCase(),
    categoria_nome: categoria.toUpperCase(), sub_categoria_nome: sub.toUpperCase(),
    codigo: codigoSeq, codigo_formatado: codigoFmt,
    unidade, marca_nome: txt(d.marca_nome, 80)?.toUpperCase() || null, modelo: txt(d.modelo, 80),
    descricao_detalhada: txt(d.descricao_detalhada, 2000),
    habilitado_para_locacao: !!d.habilitado_para_locacao, habilitado_para_venda: !!d.habilitado_para_venda, flag_em_desuso: !!d.flag_em_desuso,
    custo_reposicao: custo, valor_indenizacao: indeniza, peso_unitario: peso,
    classificacao_fiscal: ncm || null, origem_nfe: origemNfe,
    controle_locacao: d.controle_locacao, dias_preparo: preparo, dias_retorno: retorno,
    num_dias_indisponivel_apos_ret_loc: retorno,
    observacoes: txt(d.observacoes, 2000),
    data_ultima_alteracao_cadastro: agora.slice(0, 10), login_ultima_alteracao_cadastro: usuario,
    atualizado_por: usuario, updated_at: agora,
  };
  // categoria existente: herda a referência (oid) do P2S para agrupar igual
  if (!atual || mudouSub) Object.assign(linha, await referenciaCategoria(db, categoria, sub));

  if (atual) {
    const { error } = await db.from('produtos').update(linha).eq('id', atual.id);
    if (error) throw new Error(error.message);
    return { id: atual.id, codigo_formatado: codigoFmt, novo: false };
  }
  const { data: novo, error } = await db.from('produtos').insert({
    ...linha, origem: 'SISTEMA', p2s_oid: null,
    data_cadastro: agora.slice(0, 10), login_cadastro: usuario, criado_por: usuario,
  }).select('id').single();
  if (error) throw new Error(/null value in column "p2s_oid"|origem/i.test(error.message) ? 'Falta rodar o SQL do cadastro de produtos (.sql/Pendentes/produtos_cadastro_proprio.sql).' : error.message);
  return { id: novo.id as number, codigo_formatado: codigoFmt, novo: true };
}
