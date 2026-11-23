'use server';

// app/admin/estoque/equipamentos/actions.ts
// Equipamentos de Locação (/admin/estoque/equipamentos, 2026-11-16) — Fase 1
// da substituição do P2S. Por produto locável:
//   - controle: INDIVIDUAL (patrimônio com nº/série/QR) × QUANTIDADE (saldo);
//   - dias de preparo/retorno (prendem a agenda antes/depois da locação);
//   - saldos por empresa/local, patrimônios e composição de kit.
// Tudo pelo servidor (tabelas locacao_* só têm grant pro service_role),
// restrito às empresas do usuário.
//
// CARGA DO P2S (investigado em 2026-11-16):
// - O espelho produtos.estoques NÃO tem quantidade. O saldo sai de
//   TCustomMovimentacaoEstoque: QuantidadePosterior do último movimento de
//   cada estoque. Saída para locação não mexe no estoque do P2S (só
//   sublocação entra/sai), então o saldo = quantidade própria.
// - Estoques usados: "LOCACAO - <EMPRESA>" (total) e "MANUTENCAO - <EMPRESA>"
//   (em manutenção, somada ao total). ATIVO FIXO, SUCATA, VENDAS e
//   "LOCAÇÃO - MRP" ficam de fora (MRP: empresa a confirmar com o usuário).
// - Peça individual: TCustomItemEstoqueIndividual com StatusHistorico "A"
//   (ativo); "H" é histórico. Quase não é usado no P2S (134 ativas).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { registrarLogAuditoria } from '../../../actions';
import { consultarObjetos, criterioRef, type ObjetoP2s } from '../../../lib/p2s';
import { empresasCongeladas } from '../../../lib/virada/estado';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/estoque/equipamentos';
const SETOR = 'ESTOQUE';
const LOCAL_PADRAO = 'PRINCIPAL';

export type ControleLocacao = 'INDIVIDUAL' | 'QUANTIDADE';
export type SituacaoPatrimonio = 'ATIVO' | 'MANUTENCAO' | 'BAIXADO' | 'EXTRAVIADO';

async function contexto(accessToken: string) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}

async function empresasVisiveis(permitidas: number[] | null) {
  const { data } = await supabaseAdmin().from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
  return ((data || []) as any[])
    .filter(e => permitidas === null || permitidas.includes(e.id))
    .map(e => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim(), nomeCompleto: `${e.nome_curto || ''} ${e.nome || ''}` }));
}

function log(perfilNome: string, acao: string, detalhe?: string) {
  registrarLogAuditoria({ usuario_nome: perfilNome, acao, setor: SETOR, equipamento_nome: detalhe || null });
}

const num = (v: unknown, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? n : padrao; };
const numOuNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const dataOuNull = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const limparBusca = (s: string) => s.replace(/[%_,()]/g, ' ').trim();

// ============================================================================
// LISTA
// ============================================================================
export async function listarEquipamentosAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const empresas = await empresasVisiveis(ctx.permitidas);
    const ids = empresas.map(e => e.id);

    const [rProd, rSaldos, rPat, rKits] = await Promise.all([
      buscarTodasPaginas<any>((de, ate) => db.from('produtos')
        .select('id, nome_item, codigo_formatado, unidade, categoria_nome, controle_locacao, dias_preparo, dias_retorno, valor_indenizacao, custo_reposicao')
        .eq('habilitado_para_locacao', true).eq('flag_em_desuso', false).order('id').range(de, ate)),
      ids.length ? buscarTodasPaginas<any>((de, ate) => db.from('locacao_saldos')
        .select('produto_id, empresa_id, quantidade_total, quantidade_manutencao, updated_at').in('empresa_id', ids).order('id').range(de, ate))
        : Promise.resolve({ data: [], error: null }),
      ids.length ? buscarTodasPaginas<any>((de, ate) => db.from('locacao_patrimonios')
        .select('produto_id, empresa_id, situacao').in('empresa_id', ids).order('id').range(de, ate))
        : Promise.resolve({ data: [], error: null }),
      buscarTodasPaginas<any>((de, ate) => db.from('locacao_kit_itens').select('kit_produto_id').order('id').range(de, ate)),
    ]);
    for (const r of [rProd, rSaldos, rPat, rKits]) if (r.error) throw r.error;

    const kits = new Set(rKits.data.map(k => k.kit_produto_id));
    const saldos = new Map<number, Record<number, { total: number; manutencao: number }>>();
    let ultimaAtualizacaoSaldo: string | null = null;
    for (const s of rSaldos.data) {
      const m = saldos.get(s.produto_id) || {};
      const atual = m[s.empresa_id] || { total: 0, manutencao: 0 };
      atual.total += num(s.quantidade_total); atual.manutencao += num(s.quantidade_manutencao);
      m[s.empresa_id] = atual; saldos.set(s.produto_id, m);
      if (!ultimaAtualizacaoSaldo || s.updated_at > ultimaAtualizacaoSaldo) ultimaAtualizacaoSaldo = s.updated_at;
    }
    const pats = new Map<number, Record<number, { ativos: number; manutencao: number }>>();
    for (const p of rPat.data) {
      if (p.situacao !== 'ATIVO' && p.situacao !== 'MANUTENCAO') continue;
      const m = pats.get(p.produto_id) || {};
      const atual = m[p.empresa_id] || { ativos: 0, manutencao: 0 };
      if (p.situacao === 'ATIVO') atual.ativos++; else atual.manutencao++;
      m[p.empresa_id] = atual; pats.set(p.produto_id, m);
    }

    const linhas = rProd.data.map(p => ({
      produto_id: p.id, nome: p.nome_item, codigo: p.codigo_formatado, unidade: p.unidade, categoria: p.categoria_nome,
      controle_locacao: (p.controle_locacao || 'QUANTIDADE') as ControleLocacao,
      dias_preparo: num(p.dias_preparo), dias_retorno: num(p.dias_retorno),
      valor_indenizacao: numOuNull(p.valor_indenizacao), custo_reposicao: numOuNull(p.custo_reposicao),
      saldos: saldos.get(p.id) || {}, patrimonios: pats.get(p.id) || {}, eh_kit: kits.has(p.id),
    })).sort((a, b) => (a.codigo || a.nome || '').localeCompare(b.codigo || b.nome || '', 'pt-BR', { numeric: true }));

    return { ok: true, info: { empresas: empresas.map(({ id, nome }) => ({ id, nome })), linhas, ultimaAtualizacaoSaldo } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// DETALHE DO PRODUTO
// ============================================================================
export async function carregarEquipamentoAction(produtoId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const empresas = await empresasVisiveis(ctx.permitidas);
    const ids = empresas.map(e => e.id);
    const { data: produto, error } = await db.from('produtos')
      .select('id, p2s_oid, nome_item, codigo_formatado, unidade, categoria_nome, sub_categoria_nome, marca_nome, controle_locacao, dias_preparo, dias_retorno, valor_indenizacao, custo_reposicao, foto')
      .eq('id', produtoId).maybeSingle();
    if (error) throw error;
    if (!produto) return { ok: false, erro: 'Produto não encontrado.' };

    const [rSaldos, rPat, rKit, rUsadoEm] = await Promise.all([
      ids.length ? db.from('locacao_saldos').select('*').eq('produto_id', produtoId).in('empresa_id', ids).order('empresa_id').order('local') : Promise.resolve({ data: [], error: null }),
      ids.length ? buscarTodasPaginas<any>((de, ate) => db.from('locacao_patrimonios').select('*').eq('produto_id', produtoId).in('empresa_id', ids).order('numero_patrimonio').range(de, ate)) : Promise.resolve({ data: [], error: null }),
      db.from('locacao_kit_itens').select('id, componente_produto_id, quantidade, opcional, ordem, componente:produtos!locacao_kit_itens_componente_produto_id_fkey(nome_item, codigo_formatado, unidade)')
        .eq('kit_produto_id', produtoId).order('ordem'),
      db.from('locacao_kit_itens').select('quantidade, kit:produtos!locacao_kit_itens_kit_produto_id_fkey(id, nome_item, codigo_formatado)')
        .eq('componente_produto_id', produtoId),
    ]);
    for (const r of [rSaldos, rPat, rKit, rUsadoEm] as any[]) if (r.error) throw r.error;
    // ficha técnica de painel de LED (tabela pode não existir antes do SQL)
    const { data: led } = await db.from('locacao_produto_led').select('*').eq('produto_id', produtoId).maybeSingle();

    return {
      ok: true,
      info: {
        empresas: empresas.map(({ id, nome }) => ({ id, nome })),
        produto,
        led: led || null,
        saldos: rSaldos.data || [],
        patrimonios: rPat.data || [],
        kit: (rKit.data || []).map((k: any) => ({
          componente_produto_id: k.componente_produto_id, quantidade: num(k.quantidade), opcional: !!k.opcional,
          nome: k.componente?.nome_item || `Produto #${k.componente_produto_id}`, codigo: k.componente?.codigo_formatado || null, unidade: k.componente?.unidade || null,
        })),
        usadoEmKits: (rUsadoEm.data || []).map((k: any) => ({ id: k.kit?.id, nome: k.kit?.nome_item, codigo: k.kit?.codigo_formatado, quantidade: num(k.quantidade) })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function salvarConfigEquipamentoAction(
  produtoId: number,
  dados: { controle_locacao: ControleLocacao; dias_preparo: number; dias_retorno: number },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!['INDIVIDUAL', 'QUANTIDADE'].includes(dados.controle_locacao)) return { ok: false, erro: 'Controle inválido.' };
  const preparo = Math.floor(num(dados.dias_preparo, -1)), retorno = Math.floor(num(dados.dias_retorno, -1));
  if (preparo < 0 || preparo > 60 || retorno < 0 || retorno > 60) return { ok: false, erro: 'Dias de preparo/retorno devem ficar entre 0 e 60.' };
  try {
    const { data: antes } = await supabaseAdmin().from('produtos').select('nome_item, controle_locacao').eq('id', produtoId).maybeSingle();
    const { error } = await supabaseAdmin().from('produtos')
      .update({ controle_locacao: dados.controle_locacao, dias_preparo: preparo, dias_retorno: retorno }).eq('id', produtoId);
    if (error) throw error;
    log(ctx.perfil.nome, 'CONFIGUROU EQUIPAMENTO DE LOCAÇÃO',
      `${antes?.nome_item || produtoId}: ${antes?.controle_locacao || '?'} → ${dados.controle_locacao}, preparo ${preparo}d, retorno ${retorno}d`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Ficha técnica de PAINEL DE LED (2026-11-17): gabinete, resolução, peso e
// consumo — a ficha calcula m², gabinetes, pixel map, peso e consumo a partir
// da largura × altura pedida, e a proposta mostra. dados = null apaga.
export interface DadosEspecLed {
  pitch_mm: number | null; gabinete_largura_cm: number; gabinete_altura_cm: number;
  resolucao_largura_px: number; resolucao_altura_px: number;
  peso_kg_gabinete: number | null; consumo_w_gabinete: number | null; descricao_tecnica: string | null;
}
export async function salvarEspecLedAction(produtoId: number, dados: DadosEspecLed | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: prod } = await db.from('produtos').select('nome_item').eq('id', produtoId).maybeSingle();
    if (!prod) return { ok: false, erro: 'Produto não encontrado.' };
    if (!dados) {
      const { error } = await db.from('locacao_produto_led').delete().eq('produto_id', produtoId);
      if (error) throw error;
      log(ctx.perfil.nome, 'REMOVEU FICHA TÉCNICA DE LED', prod.nome_item);
      return { ok: true };
    }
    const positivo = (v: unknown) => num(v) > 0;
    if (![dados.gabinete_largura_cm, dados.gabinete_altura_cm, dados.resolucao_largura_px, dados.resolucao_altura_px].every(positivo)) {
      return { ok: false, erro: 'Informe tamanho do gabinete (cm) e resolução do gabinete (px).' };
    }
    const opc = (v: unknown) => (positivo(v) ? num(v) : null);
    const linha = {
      produto_id: produtoId, pitch_mm: opc(dados.pitch_mm),
      gabinete_largura_cm: num(dados.gabinete_largura_cm), gabinete_altura_cm: num(dados.gabinete_altura_cm),
      resolucao_largura_px: Math.round(num(dados.resolucao_largura_px)), resolucao_altura_px: Math.round(num(dados.resolucao_altura_px)),
      peso_kg_gabinete: opc(dados.peso_kg_gabinete), consumo_w_gabinete: opc(dados.consumo_w_gabinete),
      descricao_tecnica: (dados.descricao_tecnica || '').trim() || null,
      atualizado_por: ctx.perfil.nome, atualizado_em: new Date().toISOString(),
    };
    const { error } = await db.from('locacao_produto_led').upsert(linha, { onConflict: 'produto_id' });
    if (error) throw error;
    log(ctx.perfil.nome, 'SALVOU FICHA TÉCNICA DE LED', `${prod.nome_item}: gabinete ${linha.gabinete_largura_cm}x${linha.gabinete_altura_cm} cm, ${linha.resolucao_largura_px}x${linha.resolucao_altura_px} px`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Troca em massa (lista): ex. marcar vários produtos como INDIVIDUAL.
export async function definirControleEmMassaAction(produtoIds: number[], controle: ControleLocacao, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!['INDIVIDUAL', 'QUANTIDADE'].includes(controle)) return { ok: false, erro: 'Controle inválido.' };
  if (!produtoIds.length) return { ok: true };
  try {
    for (let i = 0; i < produtoIds.length; i += 200) {
      const { error } = await supabaseAdmin().from('produtos').update({ controle_locacao: controle }).in('id', produtoIds.slice(i, i + 200));
      if (error) throw error;
    }
    log(ctx.perfil.nome, 'CONFIGUROU EQUIPAMENTOS DE LOCAÇÃO EM MASSA', `${produtoIds.length} produto(s) → ${controle}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// SALDOS (controle por QUANTIDADE)
// ============================================================================
export async function salvarSaldoAction(
  dados: { id?: number; produto_id: number; empresa_id: number; local: string; quantidade_total: number; quantidade_manutencao: number; observacoes?: string | null },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const total = num(dados.quantidade_total, -1), manut = num(dados.quantidade_manutencao, -1);
  if (total < 0 || manut < 0) return { ok: false, erro: 'Quantidades não podem ser negativas.' };
  if (manut > total) return { ok: false, erro: 'A quantidade em manutenção não pode passar do total.' };
  const local = (dados.local || '').trim().toUpperCase() || LOCAL_PADRAO;
  const db = supabaseAdmin();
  try {
    const linha = {
      produto_id: dados.produto_id, empresa_id: dados.empresa_id, local, quantidade_total: total, quantidade_manutencao: manut,
      observacoes: dados.observacoes?.trim() || null, updated_at: new Date().toISOString(),
    };
    if (dados.id) {
      const { data: atual } = await db.from('locacao_saldos').select('empresa_id').eq('id', dados.id).maybeSingle();
      if (!atual || !empresaPermitida(ctx.permitidas, atual.empresa_id)) return { ok: false, erro: 'Saldo não encontrado.' };
      const { error } = await db.from('locacao_saldos').update(linha).eq('id', dados.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('locacao_saldos').upsert(linha, { onConflict: 'produto_id,empresa_id,local' });
      if (error) throw error;
    }
    log(ctx.perfil.nome, 'AJUSTOU SALDO DE LOCAÇÃO', `produto #${dados.produto_id}, empresa ${dados.empresa_id}, ${local}: total ${total}, manutenção ${manut}`);
    return { ok: true };
  } catch (e: any) {
    if (String(e.message).includes('duplicate key')) return { ok: false, erro: 'Já existe saldo deste produto nesta empresa/local.' };
    return { ok: false, erro: e.message };
  }
}

export async function excluirSaldoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: atual } = await db.from('locacao_saldos').select('empresa_id, produto_id, local').eq('id', id).maybeSingle();
    if (!atual || !empresaPermitida(ctx.permitidas, atual.empresa_id)) return { ok: false, erro: 'Saldo não encontrado.' };
    const { error } = await db.from('locacao_saldos').delete().eq('id', id);
    if (error) throw error;
    log(ctx.perfil.nome, 'EXCLUIU SALDO DE LOCAÇÃO', `produto #${atual.produto_id}, empresa ${atual.empresa_id}, ${atual.local}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PATRIMÔNIOS (controle INDIVIDUAL)
// ============================================================================
export interface DadosPatrimonio {
  id?: number;
  produto_id: number;
  empresa_id: number;
  numero_patrimonio: string;
  numero_serie?: string | null;
  situacao: SituacaoPatrimonio;
  local?: string | null;
  custo_aquisicao?: number | null;
  data_aquisicao?: string | null;
  nota_fiscal_compra?: string | null;
  observacoes?: string | null;
}

const qrDoPatrimonio = (empresaId: number, numero: string) => `PAT-${empresaId}-${numero}`;

export async function salvarPatrimonioAction(dados: DadosPatrimonio, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const numero = (dados.numero_patrimonio || '').trim().toUpperCase();
  if (!numero) return { ok: false, erro: 'Informe o número do patrimônio.' };
  if (!['ATIVO', 'MANUTENCAO', 'BAIXADO', 'EXTRAVIADO'].includes(dados.situacao)) return { ok: false, erro: 'Situação inválida.' };
  const db = supabaseAdmin();
  try {
    const linha = {
      produto_id: dados.produto_id, empresa_id: dados.empresa_id, numero_patrimonio: numero,
      numero_serie: dados.numero_serie?.trim() || null, situacao: dados.situacao, local: dados.local?.trim().toUpperCase() || null,
      custo_aquisicao: numOuNull(dados.custo_aquisicao), data_aquisicao: dataOuNull(dados.data_aquisicao),
      nota_fiscal_compra: dados.nota_fiscal_compra?.trim() || null, observacoes: dados.observacoes?.trim() || null,
      qr_code: qrDoPatrimonio(dados.empresa_id, numero), updated_at: new Date().toISOString(),
    };
    if (dados.id) {
      const { data: atual } = await db.from('locacao_patrimonios').select('empresa_id').eq('id', dados.id).maybeSingle();
      if (!atual || !empresaPermitida(ctx.permitidas, atual.empresa_id)) return { ok: false, erro: 'Patrimônio não encontrado.' };
      const { error } = await db.from('locacao_patrimonios').update(linha).eq('id', dados.id);
      if (error) throw error;
      log(ctx.perfil.nome, 'EDITOU PATRIMÔNIO', `${numero} (produto #${dados.produto_id}) — ${dados.situacao}`);
    } else {
      const { error } = await db.from('locacao_patrimonios').insert({ ...linha, criado_por: ctx.perfil.nome });
      if (error) throw error;
      log(ctx.perfil.nome, 'CADASTROU PATRIMÔNIO', `${numero} (produto #${dados.produto_id})`);
    }
    return { ok: true };
  } catch (e: any) {
    if (String(e.message).includes('duplicate key')) return { ok: false, erro: `O patrimônio ${numero} já existe nesta empresa.` };
    return { ok: false, erro: e.message };
  }
}

// Gera N patrimônios em sequência: prefixo + número com zeros à esquerda.
// Ex.: prefixo "11.02.0003-", início 1, 3 peças, 3 dígitos → -001, -002, -003.
export async function gerarPatrimoniosLoteAction(
  dados: { produto_id: number; empresa_id: number; prefixo: string; inicio: number; quantidade: number; digitos: number; local?: string | null; custo_aquisicao?: number | null; data_aquisicao?: string | null; nota_fiscal_compra?: string | null },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const qtd = Math.floor(num(dados.quantidade)), inicio = Math.floor(num(dados.inicio, 1)), digitos = Math.min(8, Math.max(1, Math.floor(num(dados.digitos, 3))));
  if (qtd < 1 || qtd > 500) return { ok: false, erro: 'Gere de 1 a 500 peças por vez.' };
  if (inicio < 0) return { ok: false, erro: 'Número inicial inválido.' };
  const prefixo = (dados.prefixo || '').trim().toUpperCase();
  const numeros = Array.from({ length: qtd }, (_, i) => `${prefixo}${String(inicio + i).padStart(digitos, '0')}`);
  const db = supabaseAdmin();
  try {
    const { data: existentes } = await db.from('locacao_patrimonios').select('numero_patrimonio')
      .eq('empresa_id', dados.empresa_id).in('numero_patrimonio', numeros);
    if (existentes?.length) return { ok: false, erro: `Já existem: ${existentes.slice(0, 5).map(e => e.numero_patrimonio).join(', ')}${existentes.length > 5 ? '…' : ''}. Mude o prefixo ou o número inicial.` };
    const agora = new Date().toISOString();
    const { error } = await db.from('locacao_patrimonios').insert(numeros.map(n => ({
      produto_id: dados.produto_id, empresa_id: dados.empresa_id, numero_patrimonio: n, situacao: 'ATIVO',
      local: dados.local?.trim().toUpperCase() || null, custo_aquisicao: numOuNull(dados.custo_aquisicao),
      data_aquisicao: dataOuNull(dados.data_aquisicao), nota_fiscal_compra: dados.nota_fiscal_compra?.trim() || null,
      qr_code: qrDoPatrimonio(dados.empresa_id, n), criado_por: ctx.perfil.nome, created_at: agora, updated_at: agora,
    })));
    if (error) throw error;
    log(ctx.perfil.nome, 'GEROU PATRIMÔNIOS EM LOTE', `produto #${dados.produto_id}: ${numeros[0]} a ${numeros[numeros.length - 1]} (${qtd})`);
    return { ok: true, info: { gerados: qtd } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function excluirPatrimonioAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: atual } = await db.from('locacao_patrimonios').select('empresa_id, numero_patrimonio, produto_id').eq('id', id).maybeSingle();
    if (!atual || !empresaPermitida(ctx.permitidas, atual.empresa_id)) return { ok: false, erro: 'Patrimônio não encontrado.' };
    const { count } = await db.from('locacao_alocacoes').select('id', { count: 'exact', head: true }).eq('patrimonio_id', id);
    if ((count || 0) > 0) return { ok: false, erro: 'Este patrimônio já passou por reservas — mude a situação para BAIXADO em vez de excluir.' };
    const { error } = await db.from('locacao_patrimonios').delete().eq('id', id);
    if (error) throw error;
    log(ctx.perfil.nome, 'EXCLUIU PATRIMÔNIO', `${atual.numero_patrimonio} (produto #${atual.produto_id})`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Estoque do P2S → empresa + papel (total ou manutenção). Nome do estoque
// no formato "LOCACAO - RENTECH", "MANUTENCAO - ALFALIGHT".
function papelDoEstoque(nomeEstoque: string): { tipo: 'LOCACAO' | 'MANUTENCAO'; empresaTexto: string } | null {
  const n = (nomeEstoque || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const m = n.match(/^(LOCACAO|MANUTENCAO)\s*-\s*(.+)$/);
  if (!m) return null;
  return { tipo: m[1] as 'LOCACAO' | 'MANUTENCAO', empresaTexto: m[2].replace(/\s+/g, '') };
}

function empresaDoTexto(empresaTexto: string, empresas: { id: number; nomeCompleto: string }[]) {
  return empresas.find(e => e.nomeCompleto.toUpperCase().replace(/\s+/g, '').includes(empresaTexto)) || null;
}

async function nomesEstoquesP2s(): Promise<Map<string, string>> {
  const r = await consultarObjetos('PRODUCAO', 'TCustomEstoque', []);
  return new Map(r.objectlist.map(e => [e.oid, String(e.NomeEstoque || e.oid)]));
}

export async function importarPatrimoniosP2sAction(produtoId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: produto } = await db.from('produtos').select('id, p2s_oid, nome_item').eq('id', produtoId).maybeSingle();
    if (!produto?.p2s_oid) return { ok: false, erro: 'Produto sem vínculo com o P2S.' };
    const empresas = await empresasVisiveis(ctx.permitidas);
    const nomesEst = await nomesEstoquesP2s();
    const r = await consultarObjetos('PRODUCAO', 'TCustomItemEstoqueIndividual', [criterioRef('ItemEstoque', produto.p2s_oid)]);
    const ativos = r.objectlist.filter((o: ObjetoP2s) => String(o.StatusHistorico) === 'A');

    const linhas: any[] = [];
    const ignorados: string[] = [];
    for (const o of ativos) {
      const nomeEst = nomesEst.get(String(o.Estoque)) || String(o.Estoque);
      const papel = papelDoEstoque(nomeEst);
      const empresa = papel ? empresaDoTexto(papel.empresaTexto, empresas) : null;
      const numero = String(o.Identificador || '').trim().toUpperCase() || String(o.oid);
      if (!empresa) { ignorados.push(`${numero} (${nomeEst})`); continue; }
      linhas.push({
        produto_id: produtoId, empresa_id: empresa.id, numero_patrimonio: numero,
        numero_serie: String(o.NumeroSerie || '').trim() || null, tag_identificacao: String(o.TagIdentificacao || '').trim() || null,
        situacao: papel!.tipo === 'MANUTENCAO' ? 'MANUTENCAO' : 'ATIVO',
        custo_aquisicao: Number(o.ValorMercado) > 0 ? Number(o.ValorMercado) : null,
        observacoes: String(o.Observacoes || '').trim() || null,
        qr_code: qrDoPatrimonio(empresa.id, numero), p2s_oid: o.oid, criado_por: ctx.perfil.nome, updated_at: new Date().toISOString(),
      });
    }
    if (linhas.length) {
      const { error } = await db.from('locacao_patrimonios').upsert(linhas, { onConflict: 'p2s_oid' });
      if (error) {
        if (String(error.message).includes('duplicate key')) return { ok: false, erro: 'Algum número de patrimônio do P2S já existe aqui cadastrado à mão. Renomeie o existente e tente de novo.' };
        throw error;
      }
    }
    log(ctx.perfil.nome, 'IMPORTOU PATRIMÔNIOS DO P2S', `${produto.nome_item}: ${linhas.length} peça(s)`);
    return { ok: true, info: { importados: linhas.length, ignorados, historico: r.objectlist.length - ativos.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// KIT
// ============================================================================
export async function salvarKitAction(
  kitProdutoId: number,
  itens: { componente_produto_id: number; quantidade: number; opcional: boolean }[],
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  for (const i of itens) {
    if (i.componente_produto_id === kitProdutoId) return { ok: false, erro: 'O kit não pode conter ele mesmo.' };
    if (!(num(i.quantidade) > 0)) return { ok: false, erro: 'Quantidade do componente deve ser maior que zero.' };
  }
  if (new Set(itens.map(i => i.componente_produto_id)).size !== itens.length) return { ok: false, erro: 'Componente repetido no kit.' };
  const db = supabaseAdmin();
  try {
    // Evita kit dentro de kit em ciclo: componente que é kit e contém este.
    if (itens.length) {
      const { data: ciclo } = await db.from('locacao_kit_itens').select('kit_produto_id')
        .eq('componente_produto_id', kitProdutoId).in('kit_produto_id', itens.map(i => i.componente_produto_id));
      if (ciclo?.length) return { ok: false, erro: 'Um dos componentes já é um kit que contém este produto.' };
    }
    const { error: eDel } = await db.from('locacao_kit_itens').delete().eq('kit_produto_id', kitProdutoId);
    if (eDel) throw eDel;
    if (itens.length) {
      const { error } = await db.from('locacao_kit_itens').insert(itens.map((i, idx) => ({
        kit_produto_id: kitProdutoId, componente_produto_id: i.componente_produto_id, quantidade: num(i.quantidade), opcional: !!i.opcional, ordem: idx,
      })));
      if (error) throw error;
    }
    log(ctx.perfil.nome, 'SALVOU COMPOSIÇÃO DE KIT', `produto #${kitProdutoId}: ${itens.length} componente(s)`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarProdutosAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const termo = limparBusca(texto || '');
  if (termo.length < 2) return { ok: true, info: [] };
  try {
    const { data, error } = await supabaseAdmin().from('produtos')
      .select('id, nome_item, codigo_formatado, unidade, categoria_nome')
      .eq('habilitado_para_locacao', true).eq('flag_em_desuso', false)
      .or(`nome_item.ilike.%${termo}%,codigo_formatado.ilike.%${termo}%`)
      .order('nome_item').limit(30);
    if (error) throw error;
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CARGA INICIAL DE SALDOS DO P2S
// ============================================================================
// Para cada produto locável: lê as movimentações de estoque no P2S, pega o
// saldo (QuantidadePosterior do último movimento) de cada estoque e grava em
// locacao_saldos (local PRINCIPAL): total = LOCACAO + MANUTENCAO,
// manutenção = MANUTENCAO. Sobrescreve o saldo do local PRINCIPAL das
// empresas com movimento no P2S; outros locais e produtos sem movimento não
// são tocados. ~370 produtos ≈ 10 s (6 consultas em paralelo).
export async function cargaSaldosP2sAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    // Empresa que já virou a chave: o saldo vem do inventário da virada — o P2S não
    // sobrescreve mais nada (2026-11-23).
    const congeladas = await empresasCongeladas(db);
    const empresas = (await empresasVisiveis(ctx.permitidas)).filter(e => !congeladas.has(e.id));
    if (!empresas.length) return { ok: false, erro: 'As empresas já viraram a chave: o saldo agora vem do inventário, não do P2S.' };
    const nomesEst = await nomesEstoquesP2s();
    const { data: produtos, error } = await buscarTodasPaginas<any>((de, ate) => db.from('produtos')
      .select('id, p2s_oid, nome_item').eq('habilitado_para_locacao', true).eq('flag_em_desuso', false)
      .not('p2s_oid', 'is', null).order('id').range(de, ate));
    if (error) throw error;

    const linhas: any[] = [];
    const ignoradosPorEstoque: Record<string, number> = {};
    const negativos: string[] = [];
    const falhas: string[] = [];
    let semMovimento = 0;
    const agora = new Date().toISOString();

    const fila = [...produtos];
    const trabalhar = async () => {
      while (fila.length) {
        const p = fila.shift()!;
        try {
          const r = await consultarObjetos('PRODUCAO', 'TCustomMovimentacaoEstoque', [criterioRef('ItemEstoque', p.p2s_oid)]);
          if (!r.objectlist.length) { semMovimento++; continue; }
          // último movimento por estoque (data+hora; empate → maior oid)
          const ultimo = new Map<string, { t: number; n: number; q: number }>();
          for (const o of r.objectlist) {
            const t = num(o.DataMovimentacao) + num(o.HoraMovimentacao);
            const n = num(String(o.oid).split(',')[1]);
            const prev = ultimo.get(String(o.Estoque));
            if (!prev || t > prev.t || (t === prev.t && n > prev.n)) ultimo.set(String(o.Estoque), { t, n, q: num(o.QuantidadePosterior) });
          }
          const porEmpresa = new Map<number, { locacao: number; manutencao: number }>();
          for (const [estOid, v] of ultimo) {
            const nomeEst = nomesEst.get(estOid) || estOid;
            const papel = papelDoEstoque(nomeEst);
            const empresa = papel ? empresaDoTexto(papel.empresaTexto, empresas) : null;
            if (!papel || !empresa) { if (v.q > 0) ignoradosPorEstoque[nomeEst] = (ignoradosPorEstoque[nomeEst] || 0) + v.q; continue; }
            if (v.q < 0) negativos.push(`${p.nome_item} (${nomeEst}: ${v.q})`);
            const atual = porEmpresa.get(empresa.id) || { locacao: 0, manutencao: 0 };
            if (papel.tipo === 'LOCACAO') atual.locacao += Math.max(0, v.q); else atual.manutencao += Math.max(0, v.q);
            porEmpresa.set(empresa.id, atual);
          }
          for (const [empresaId, s] of porEmpresa) {
            linhas.push({
              produto_id: p.id, empresa_id: empresaId, local: LOCAL_PADRAO,
              quantidade_total: s.locacao + s.manutencao, quantidade_manutencao: s.manutencao,
              observacoes: 'Carga do P2S', updated_at: agora,
            });
          }
        } catch (e: any) {
          falhas.push(`${p.nome_item}: ${String(e.message).slice(0, 120)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, trabalhar));

    for (let i = 0; i < linhas.length; i += 500) {
      const { error: eUp } = await db.from('locacao_saldos').upsert(linhas.slice(i, i + 500), { onConflict: 'produto_id,empresa_id,local' });
      if (eUp) throw eUp;
    }

    const porEmpresa = empresas.map(e => {
      const ls = linhas.filter(l => l.empresa_id === e.id);
      return { empresa: e.nome, produtos: ls.filter(l => l.quantidade_total > 0).length, unidades: ls.reduce((s, l) => s + l.quantidade_total, 0), manutencao: ls.reduce((s, l) => s + l.quantidade_manutencao, 0) };
    });
    log(ctx.perfil.nome, 'CARGA DE SALDOS DE LOCAÇÃO DO P2S',
      porEmpresa.map(x => `${x.empresa}: ${x.produtos} produtos/${x.unidades} un.`).join('; ') + (falhas.length ? `; ${falhas.length} falha(s)` : ''));
    return { ok: true, info: { porEmpresa, ignoradosPorEstoque, negativos, falhas, semMovimento, totalProdutos: produtos.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
