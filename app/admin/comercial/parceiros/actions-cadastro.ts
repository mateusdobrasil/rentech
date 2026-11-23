'use server';

// Cadastro próprio de clientes e fornecedores (2026-11-23). Regras em
// app/lib/cadastros/parceiros.ts. Quem acessa Comercial → Parceiros pode
// cadastrar, editar o que é do sistema e mudar a carteira do vendedor.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import {
  cadastrosNoSistema, cadastroEditavel, salvarParceiro, consultarCnpj, consultarCep, parceiroComDocumento,
  type DadosParceiro,
} from '../../../lib/cadastros/parceiros';

const ROTA = '/admin/comercial/parceiros';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mesmo formato de retorno das outras actions
type Resultado = { ok: boolean; erro?: string; info?: any };
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.');

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  return { perfil: v.perfil } as const;
}

async function vendedores() {
  const { data, error } = await supabaseAdmin().from('colaboradores').select('id, nome_exibicao, nome_completo, status_colaborador').eq('flag_vendedor_rep', true).order('nome_exibicao');
  if (error) throw error;
  return ((data || []) as { id: number; nome_exibicao: string | null; nome_completo: string | null; status_colaborador: string | null }[]).map(v => ({ id: v.id as number, nome: String(v.nome_exibicao || v.nome_completo || '').trim(), ativo: v.status_colaborador === 'A' }));
}

/** Origem dos cadastros e lista de vendedores (para a carteira). */
export async function contextoCadastroParceiroAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const db = supabaseAdmin();
    return { ok: true, info: { sistemaOrigem: await cadastrosNoSistema(db), vendedores: (await vendedores()).filter(v => v.ativo) } };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}

export async function carregarParceiroAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const db = supabaseAdmin();
    const { data: p, error } = await db.from('parceiros').select('*').eq('id', Number(id)).maybeSingle();
    if (error) throw error;
    if (!p) return { ok: false, erro: 'Parceiro não encontrado.' };
    const [{ data: cart }, edit] = await Promise.all([
      db.from('comercial_carteira_clientes').select('vendedor_id').eq('parceiro_id', p.id).maybeSingle(),
      cadastroEditavel(db, p),
    ]);
    return { ok: true, info: { parceiro: p, vendedorId: cart?.vendedor_id ?? null, editavel: edit.editavel, motivo: edit.motivo } };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}

async function gravarCarteira(parceiroId: number, vendedorId: number | null, usuario: string) {
  const db = supabaseAdmin();
  const { data: atual } = await db.from('comercial_carteira_clientes').select('vendedor_id').eq('parceiro_id', parceiroId).maybeSingle();
  if ((atual?.vendedor_id ?? null) === (vendedorId ?? null)) return false;
  if (vendedorId) {
    const v = (await vendedores()).find(x => x.id === vendedorId);
    if (!v || !v.ativo) throw new Error('Vendedor inválido ou inativo.');
    const { error } = await db.from('comercial_carteira_clientes').upsert({ parceiro_id: parceiroId, vendedor_id: vendedorId, origem: 'MANUAL', definido_por: usuario, definido_em: new Date().toISOString() }, { onConflict: 'parceiro_id' });
    if (error) throw error;
  } else {
    const { error } = await db.from('comercial_carteira_clientes').delete().eq('parceiro_id', parceiroId);
    if (error) throw error;
  }
  return true;
}

export async function salvarParceiroAction(dados: DadosParceiro & { vendedor_id?: number | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const db = supabaseAdmin();
    const r = await salvarParceiro(db, dados, ctx.perfil.nome);
    const mudouCarteira = dados.flag_cliente ? await gravarCarteira(r.id, dados.vendedor_id ?? null, ctx.perfil.nome) : false;
    registrarLogAuditoria({
      usuario_nome: ctx.perfil.nome, acao: r.novo ? 'CADASTROU PARCEIRO' : 'ALTEROU PARCEIRO', setor: 'COMERCIAL',
      equipamento_nome: `${dados.nome_completo} (código ${r.codigo ?? r.id})${mudouCarteira ? ' + carteira' : ''}`,
    });
    return { ok: true, info: r };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}

/** Só a carteira (vale também para cadastro do P2S, que é só leitura). */
export async function salvarCarteiraParceiroAction(parceiroId: number, vendedorId: number | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const mudou = await gravarCarteira(Number(parceiroId), vendedorId ? Number(vendedorId) : null, ctx.perfil.nome);
    if (mudou) registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'ALTEROU CARTEIRA DE CLIENTES', setor: 'COMERCIAL', equipamento_nome: `parceiro #${parceiroId} → ${vendedorId ?? 'sem carteira'}` });
    return { ok: true, info: { mudou } };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}

/** Avisa na hora se o documento já está cadastrado (antes de salvar). */
export async function verificarDocumentoParceiroAction(documento: string, excetoId: number | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: await parceiroComDocumento(supabaseAdmin(), documento, excetoId) }; } catch (e) { return { ok: false, erro: msg(e) }; }
}

export async function consultarCnpjAction(cnpj: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: await consultarCnpj(cnpj) }; } catch (e) { return { ok: false, erro: msg(e) }; }
}

export async function consultarCepAction(cep: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: await consultarCep(cep) }; } catch (e) { return { ok: false, erro: msg(e) }; }
}
