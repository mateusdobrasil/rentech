// app/lib/locacao/buscas.ts
// Buscas usadas pelas telas do hub Locações (cliente, evento, produto).
// SEM checagem de acesso — quem chama (server action) valida a rota antes.
// Devolve só o necessário para escolher; dado sensível de parceiro fica na
// tela de Parceiros.
import type { supabaseAdmin } from '../supabase';

type Db = ReturnType<typeof supabaseAdmin>;
const limpar = (s: string) => (s || '').replace(/[%_,()]/g, ' ').trim();

export interface OpcaoBusca { id: number | string; nome: string; detalhe?: string; extra?: Record<string, unknown> }

export async function buscarClientes(db: Db, texto: string): Promise<OpcaoBusca[]> {
  const t = limpar(texto);
  if (t.length < 2) return [];
  // nome, ou CPF/CNPJ quando a busca tem dígitos (cadastro próprio, 2026-11-23)
  const digitos = t.replace(/\D/g, '');
  const porDoc = digitos.length >= 5 ? `,cnpj_digitos.ilike.%${digitos}%,cpf_digitos.ilike.%${digitos}%` : '';
  const { data, error } = await db.from('parceiros')
    .select('id, nome_exibicao, nome_completo, cidade1, estado1, telefone1, email1')
    .eq('flag_cliente', true)
    .or(`nome_exibicao.ilike.%${t}%,nome_completo.ilike.%${t}%${porDoc}`)
    .order('nome_exibicao').limit(30);
  if (error) throw error;
  return (data || []).map((p: any) => ({
    id: p.id, nome: p.nome_exibicao || p.nome_completo,
    detalhe: [p.nome_completo !== p.nome_exibicao ? p.nome_completo : null, [p.cidade1, p.estado1].filter(Boolean).join('/')].filter(Boolean).join(' · '),
    extra: { telefone: p.telefone1 || null, email: p.email1 || null },
  }));
}

export async function buscarEventos(db: Db, texto: string): Promise<OpcaoBusca[]> {
  const t = limpar(texto);
  if (t.length < 2) return [];
  const { data, error } = await db.from('eventos_feiras')
    .select('id, nome, data_inicial, data_final, local')
    .ilike('nome', `%${t}%`)
    .order('data_inicial', { ascending: false }).limit(30);
  if (error) throw error;
  return (data || []).map((e: any) => ({
    id: e.id, nome: e.nome,
    detalhe: [e.data_inicial ? e.data_inicial.split('-').reverse().join('/') : null, e.local].filter(Boolean).join(' · '),
    extra: { data_inicial: e.data_inicial, data_final: e.data_final, local: e.local },
  }));
}

export async function buscarProdutosLocaveis(db: Db, texto: string) {
  const t = limpar(texto);
  if (t.length < 2) return [];
  const { data, error } = await db.from('produtos')
    .select('id, nome_item, codigo_formatado, unidade, categoria_nome, sub_categoria_nome, controle_locacao')
    .eq('habilitado_para_locacao', true).eq('flag_em_desuso', false)
    .or(`nome_item.ilike.%${t}%,codigo_formatado.ilike.%${t}%,categoria_nome.ilike.%${t}%`)
    .order('nome_item').limit(40);
  if (error) throw error;
  return data || [];
}
