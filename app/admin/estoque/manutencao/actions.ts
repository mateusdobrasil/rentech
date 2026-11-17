'use server';

// app/admin/estoque/manutencao/actions.ts
// Avarias e Manutenção (2026-11-17). Regras/efeitos no estoque em
// app/lib/locacao/manutencao.ts. Fotos no bucket privado "locacao-avarias"
// (upload direto do navegador por URL assinada — evita o 413 de mandar
// arquivo por server action; ver memória do upload de documentos).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { registrarLogAuditoria } from '../../../actions';
import {
  abrirManutencao, mudarStatusManutencao, registrarAvaria,
  type DadosAbrirOS, type DadosAvaria, type StatusOS,
} from '../../../lib/locacao/manutencao';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/estoque/manutencao';
const ROTAS_FOTO = [ROTA, '/admin/estoque/expedicao'];
const BUCKET = 'locacao-avarias';
const limpar = (s: string) => (s || '').replace(/[%_,()]/g, ' ').trim();

async function contexto(accessToken: string) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}
function log(nome: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: nome, acao, setor: 'ESTOQUE', equipamento_nome: detalhe });
}

// ============================================================================
// PAINEL
// ============================================================================
export async function painelManutencaoAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: emps } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
    const empresas = (emps || []).filter((e: any) => ctx.permitidas === null || ctx.permitidas.includes(e.id))
      .map((e: any) => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() }));
    const ids = empresas.length ? empresas.map(e => e.id) : [0];
    const [rOS, rAv] = await Promise.all([
      buscarTodasPaginas<any>((de, ate) => db.from('locacao_manutencoes')
        .select('*, produto:produtos(nome_item, codigo_formatado, unidade), patrimonio:locacao_patrimonios(numero_patrimonio), fornecedor:parceiros(nome_exibicao, nome_completo)')
        .in('empresa_id', ids).order('aberta_em', { ascending: false }).range(de, ate), 1000, 3000),
      buscarTodasPaginas<any>((de, ate) => db.from('locacao_avarias')
        .select('*, produto:produtos(nome_item, codigo_formatado, valor_indenizacao), patrimonio:locacao_patrimonios(numero_patrimonio), cliente:parceiros(nome_exibicao, nome_completo), ficha:locacao_fichas_reserva(id, origem, p2s_numero), manutencao:locacao_manutencoes(status)')
        .in('empresa_id', ids).order('registrada_em', { ascending: false }).range(de, ate), 1000, 3000),
    ]);
    if (rOS.error) throw rOS.error;
    if (rAv.error) throw rAv.error;
    const nomeParc = (p: any) => (p ? p.nome_exibicao || p.nome_completo : null);
    return {
      ok: true,
      info: {
        empresas,
        manutencoes: rOS.data.map(o => ({
          ...o, produto: undefined, patrimonio: undefined, fornecedor: undefined,
          produto_nome: o.produto?.nome_item, produto_codigo: o.produto?.codigo_formatado, unidade: o.produto?.unidade,
          patrimonio_numero: o.patrimonio?.numero_patrimonio || null, fornecedor_nome: nomeParc(o.fornecedor),
        })),
        avarias: rAv.data.map(a => ({
          ...a, produto: undefined, patrimonio: undefined, cliente: undefined, ficha: undefined, manutencao: undefined,
          produto_nome: a.produto?.nome_item, produto_codigo: a.produto?.codigo_formatado, valor_indenizacao: a.produto?.valor_indenizacao ?? null,
          patrimonio_numero: a.patrimonio?.numero_patrimonio || null, cliente_nome: nomeParc(a.cliente),
          ficha_numero: a.ficha ? (a.ficha.origem === 'P2S' ? `P2S ${a.ficha.p2s_numero}` : `FR-${String(a.ficha.id).padStart(5, '0')}`) : null,
          manutencao_status: a.manutencao?.status || null,
        })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// BUSCAS
// ============================================================================
/** Produto ou patrimônio (pelo nº/QR) da empresa. */
export async function buscarItemEstoqueAction(texto: string, empresaId: number, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS_FOTO);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const t = limpar(texto).toUpperCase();
  if (t.length < 2) return { ok: true, info: [] };
  const db = supabaseAdmin();
  try {
    const [rPat, rProd] = await Promise.all([
      db.from('locacao_patrimonios').select('id, produto_id, numero_patrimonio, situacao, produto:produtos(nome_item, valor_indenizacao)')
        .eq('empresa_id', empresaId).or(`numero_patrimonio.ilike.%${t}%,qr_code.eq.${t}`).limit(15),
      db.from('produtos').select('id, nome_item, codigo_formatado, controle_locacao, valor_indenizacao')
        .eq('habilitado_para_locacao', true).or(`nome_item.ilike.%${t}%,codigo_formatado.ilike.%${t}%`).order('nome_item').limit(25),
    ]);
    const ops = [
      ...((rPat.data || []) as any[]).map(p => ({
        id: `P${p.id}`, nome: `${p.numero_patrimonio} · ${p.produto?.nome_item || ''}`, detalhe: `patrimônio · ${p.situacao}`,
        extra: { patrimonio_id: p.id, produto_id: p.produto_id, controle: 'INDIVIDUAL', valor_indenizacao: p.produto?.valor_indenizacao ?? null },
      })),
      ...((rProd.data || []) as any[]).map(p => ({
        id: `Q${p.id}`, nome: p.nome_item, detalhe: [p.codigo_formatado, p.controle_locacao === 'INDIVIDUAL' ? 'por patrimônio — escolha a peça' : 'por quantidade'].filter(Boolean).join(' · '),
        extra: { patrimonio_id: null, produto_id: p.id, controle: p.controle_locacao, valor_indenizacao: p.valor_indenizacao ?? null },
      })),
    ];
    return { ok: true, info: ops };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarFornecedoresAction(texto: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS_FOTO);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const t = limpar(texto);
  if (t.length < 2) return { ok: true, info: [] };
  const { data } = await supabaseAdmin().from('parceiros').select('id, nome_exibicao, nome_completo, cidade1')
    .eq('flag_fornecedor', true).or(`nome_exibicao.ilike.%${t}%,nome_completo.ilike.%${t}%`).order('nome_exibicao').limit(20);
  return { ok: true, info: (data || []).map((p: any) => ({ id: p.id, nome: p.nome_exibicao || p.nome_completo, detalhe: p.cidade1 || '' })) };
}

export async function buscarFichasAction(texto: string, empresaId: number, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS_FOTO);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const t = limpar(texto);
  if (t.length < 2) return { ok: true, info: [] };
  const db = supabaseAdmin();
  const { data: parcs } = await db.from('parceiros').select('id').or(`nome_exibicao.ilike.%${t}%,nome_completo.ilike.%${t}%`).limit(50);
  let q = db.from('locacao_fichas_reserva').select('id, origem, p2s_numero, data_inicio, data_fim, parceiro_id, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)')
    .eq('empresa_id', empresaId).in('status', ['RESERVADA', 'EM_LOCACAO', 'FINALIZADA', 'APROVADO']);
  const ids = (parcs || []).map((p: any) => p.id);
  q = /^\d+$/.test(t) ? q.or(`p2s_numero.ilike.%${t}%,id.eq.${Number(t)}`) : q.in('parceiro_id', ids.length ? ids : [0]);
  const { data } = await q.order('data_inicio', { ascending: false }).limit(20);
  return {
    ok: true,
    info: (data || []).map((f: any) => ({
      id: f.id, nome: `${f.origem === 'P2S' ? `P2S ${f.p2s_numero}` : `FR-${String(f.id).padStart(5, '0')}`} · ${f.parceiro?.nome_exibicao || f.parceiro?.nome_completo || ''}`,
      detalhe: [f.evento?.nome, `${f.data_inicio?.split('-').reverse().join('/')} a ${f.data_fim?.split('-').reverse().join('/')}`].filter(Boolean).join(' · '),
      extra: { parceiro_id: f.parceiro_id },
    })),
  };
}

// ============================================================================
// OS DE MANUTENÇÃO
// ============================================================================
export async function abrirOSAction(dados: DadosAbrirOS, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    const id = await abrirManutencao(supabaseAdmin(), dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'ABRIU OS DE MANUTENÇÃO', `#${id} produto ${dados.produto_id}${dados.patrimonio_id ? ` patrimônio ${dados.patrimonio_id}` : ` qtd ${dados.quantidade}`}`);
    return { ok: true, info: { id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function atualizarOSAction(id: number, novoStatus: StatusOS, dados: Parameters<typeof mudarStatusManutencao>[3], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: os } = await db.from('locacao_manutencoes').select('empresa_id, status').eq('id', id).maybeSingle();
    if (!os || !empresaPermitida(ctx.permitidas, os.empresa_id)) return { ok: false, erro: 'OS não encontrada.' };
    await mudarStatusManutencao(db, id, novoStatus, dados, ctx.perfil.nome);
    if (novoStatus !== os.status) log(ctx.perfil.nome, 'OS DE MANUTENÇÃO', `#${id} ${os.status} → ${novoStatus}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// AVARIAS
// ============================================================================
export async function registrarAvariaAction(dados: DadosAvaria, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS_FOTO);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  if (!empresaPermitida(permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    const r = await registrarAvaria(supabaseAdmin(), dados, acesso.perfil.nome);
    log(acesso.perfil.nome, 'REGISTROU AVARIA', `#${r.avariaId} ${dados.gravidade} produto ${dados.produto_id}${r.manutencaoId ? ` → OS #${r.manutencaoId}` : ''}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function atualizarCobrancaAvariaAction(
  id: number, dados: { status_cobranca: 'A_DEFINIR' | 'COBRAR' | 'NAO_COBRAR' | 'COBRADO' | 'PAGO'; valor_cobranca: number | null; observacao_cobranca: string | null; ficha_id?: number | null; parceiro_id?: number | null },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: av } = await db.from('locacao_avarias').select('empresa_id').eq('id', id).maybeSingle();
    if (!av || !empresaPermitida(ctx.permitidas, av.empresa_id)) return { ok: false, erro: 'Avaria não encontrada.' };
    if (['COBRAR', 'COBRADO', 'PAGO'].includes(dados.status_cobranca) && !(Number(dados.valor_cobranca) > 0)) return { ok: false, erro: 'Informe o valor a cobrar.' };
    const { error } = await db.from('locacao_avarias').update({
      status_cobranca: dados.status_cobranca, valor_cobranca: dados.valor_cobranca, observacao_cobranca: dados.observacao_cobranca?.trim() || null,
      ...(dados.ficha_id !== undefined ? { ficha_id: dados.ficha_id } : {}), ...(dados.parceiro_id !== undefined ? { parceiro_id: dados.parceiro_id } : {}),
      atualizado_em: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
    log(ctx.perfil.nome, 'COBRANÇA DE AVARIA', `#${id} → ${dados.status_cobranca}${dados.valor_cobranca ? ` R$ ${dados.valor_cobranca}` : ''}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// FOTOS (bucket privado; upload por URL assinada)
// ============================================================================
export async function urlUploadFotoAction(nomeArquivo: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS_FOTO);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const ext = (nomeArquivo.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const caminho = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: { caminho, token: data.token } };
}

export async function urlsFotosAction(caminhos: string[], accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS_FOTO);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!caminhos.length) return { ok: true, info: {} };
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(caminhos.slice(0, 50), 60 * 30);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: Object.fromEntries((data || []).map((d: any) => [d.path, d.signedUrl])) };
}
