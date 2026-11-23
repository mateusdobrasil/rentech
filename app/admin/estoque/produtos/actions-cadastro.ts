'use server';

// Cadastro próprio de produtos e equipamentos (2026-11-23). Regras em
// app/lib/cadastros/produtos.ts. Quem acessa Estoque → Produtos pode
// cadastrar e editar o que é do sistema (ou tudo, depois da virada).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { cadastrosNoSistema } from '../../../lib/cadastros/parceiros';
import { categoriasDoCatalogo, proximoCodigo, produtoEditavel, salvarProduto, type DadosProduto } from '../../../lib/cadastros/produtos';

const ROTA = '/admin/estoque/produtos';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mesmo formato de retorno das outras actions
type Resultado = { ok: boolean; erro?: string; info?: any };
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.');

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  return { perfil: v.perfil } as const;
}

/** Origem dos cadastros, categorias/subcategorias e marcas do catálogo. */
export async function contextoCadastroProdutoAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const db = supabaseAdmin();
    const [sistemaOrigem, cat] = await Promise.all([cadastrosNoSistema(db), categoriasDoCatalogo(db)]);
    return { ok: true, info: { sistemaOrigem, ...cat } };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}

export async function carregarProdutoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const db = supabaseAdmin();
    const { data: p, error } = await db.from('produtos').select('*').eq('id', Number(id)).maybeSingle();
    if (error) throw error;
    if (!p) return { ok: false, erro: 'Produto não encontrado.' };
    const e = await produtoEditavel(db, p);
    return { ok: true, info: { produto: p, editavel: e.editavel, motivo: e.motivo } };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}

export async function sugerirCodigoProdutoAction(categoria: string, subcategoria: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: await proximoCodigo(supabaseAdmin(), String(categoria || ''), String(subcategoria || '')) }; } catch (e) { return { ok: false, erro: msg(e) }; }
}

export async function salvarProdutoAction(dados: DadosProduto, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const r = await salvarProduto(supabaseAdmin(), dados, ctx.perfil.nome);
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: r.novo ? 'CADASTROU PRODUTO' : 'ALTEROU PRODUTO', setor: 'ESTOQUE', equipamento_nome: `${dados.nome_item} (${r.codigo_formatado || r.id})` });
    return { ok: true, info: r };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}
