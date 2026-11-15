'use server';

// app/admin/diretoria/actions.ts
// Tela do Diretor (IA): relatórios diários e semanais por empresa, alertas
// de exceção e os parâmetros (valores de corte) dos alertas. "Gerar agora"
// e "Verificar agora" nunca mandam WhatsApp — envio é só das rotinas
// agendadas. Empresa sempre resolvida no servidor (obterEmpresasPermitidas).
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../lib/serverAuth';
import { gerarRelatorioDiario } from '../../lib/diretoria/relatorioDiario';
import { gerarRelatorioSemanal } from '../../lib/diretoria/relatorioSemanal';
import { processarAlertas } from '../../lib/diretoria/alertas';
import { PARAMETROS_PADRAO, type ChaveParametro } from '../../lib/diretoria/parametros';
import { perguntarAoDiretor } from '../../lib/diretoria/chat';
import { gerarRelatorioPeriodo } from '../../lib/diretoria/relatorioPeriodo';
import { projetarCaixa } from '../../lib/diretoria/caixa';
import { progressoMetasDoMes, TIPOS_META } from '../../lib/diretoria/metas';
import { hojeISO } from '../../lib/diretoria/indicadoresDiarios';
import type { EmpresaChat } from '../../lib/diretoria/ferramentasChat';
import { registrarLogAuditoria } from '../../actions';

type Resultado = { ok: boolean; erro?: string; info?: any };
type TipoRelatorio = 'DIARIO' | 'SEMANAL' | 'MENSAL' | 'ANUAL';

const ROTA = '/admin/diretoria';

async function contexto(accessToken: string) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}

async function empresaDoUsuario(empresaId: number, permitidas: number[] | null) {
  if (permitidas !== null && !permitidas.includes(empresaId)) return null;
  const { data: e } = await supabaseAdmin().from('empresas').select('*').eq('id', empresaId).maybeSingle();
  return e ? { id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() } : null;
}

export async function listarRelatoriosDiretoriaAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();

  const { data: empresas } = await db.from('empresas').select('*').eq('ativo', true).order('id');
  const visiveis = ((empresas || []) as any[])
    .filter(e => ctx.permitidas === null || ctx.permitidas.includes(e.id))
    .map(e => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() }));
  if (!visiveis.length) return { ok: true, info: { empresas: [], relatorios: [] } };

  const { data, error } = await db.from('diretoria_relatorios')
    .select('id, empresa_id, tipo, data_referencia, status, erro, conteudo, gerado_em, gerado_por, whatsapp_resultado')
    .in('empresa_id', visiveis.map(e => e.id)).in('tipo', ['DIARIO', 'SEMANAL', 'MENSAL', 'ANUAL'])
    .order('data_referencia', { ascending: false }).limit(300);
  if (error) return { ok: false, erro: error.message };

  const relatorios = ((data || []) as any[]).map(r => ({
    id: r.id, empresa_id: r.empresa_id, tipo: r.tipo, data_referencia: r.data_referencia, status: r.status, erro: r.erro,
    situacao: r.conteudo?.situacao ?? null, manchete: r.conteudo?.manchete ?? null,
    gerado_em: r.gerado_em, gerado_por: r.gerado_por, whatsapp_resultado: r.whatsapp_resultado,
  }));
  return { ok: true, info: { empresas: visiveis, relatorios } };
}

export async function obterRelatorioDiretoriaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { data, error } = await supabaseAdmin().from('diretoria_relatorios').select('*').eq('id', id).maybeSingle();
  if (error) return { ok: false, erro: error.message };
  if (!data || !empresaPermitida(ctx.permitidas, data.empresa_id)) return { ok: false, erro: 'Relatório não encontrado.' };
  return { ok: true, info: data };
}

export async function gerarRelatorioDiretoriaAgoraAction(empresaId: number, tipo: TipoRelatorio, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const empresa = await empresaDoUsuario(empresaId, ctx.permitidas);
  if (!empresa) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };

  const db = supabaseAdmin();
  const opcoes = { geradoPor: ctx.perfil.nome, enviarWhatsapp: false };
  const r = tipo === 'SEMANAL' ? await gerarRelatorioSemanal(db, empresa, opcoes)
    : tipo === 'MENSAL' || tipo === 'ANUAL' ? await gerarRelatorioPeriodo(db, empresa, tipo, opcoes)
    : await gerarRelatorioDiario(db, empresa, opcoes);
  registrarLogAuditoria({
    usuario_nome: ctx.perfil.nome,
    acao: `GEROU RELATÓRIO ${tipo === 'DIARIO' ? 'DIÁRIO' : tipo} DO DIRETOR (${empresa.nome})`,
    setor: 'DIRETORIA',
    equipamento_nome: r.ok ? 'ok' : `erro: ${r.erro}`.slice(0, 200),
  });
  if (!r.relatorioId) return { ok: false, erro: r.erro };
  return { ok: r.ok, erro: r.erro, info: { id: r.relatorioId } };
}

export async function listarAlertasDiretoriaAction(empresaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (ctx.permitidas !== null && !ctx.permitidas.includes(empresaId)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const { data, error } = await supabaseAdmin().from('diretoria_alertas')
    .select('id, tipo, titulo, detalhe, valor, link, detectado_em, enviado_em, envio_resultado')
    .eq('empresa_id', empresaId).order('detectado_em', { ascending: false }).limit(150);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: data || [] };
}

// Roda a detecção na hora (sem WhatsApp): o que for novo aparece na lista e
// sai na próxima rodada agendada (12h ou 18h).
export async function verificarAlertasAgoraAction(empresaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const empresa = await empresaDoUsuario(empresaId, ctx.permitidas);
  if (!empresa) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const r = await processarAlertas(supabaseAdmin(), empresa, { enviarWhatsapp: false });
  return { ok: r.erros.length === 0, erro: r.erros.join(' | ') || undefined, info: r };
}

// --- Caixa (aba Caixa) e metas (aba Parâmetros) — Fase 4 ---

export async function projecaoCaixaDiretoriaAction(empresaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const empresa = await empresaDoUsuario(empresaId, ctx.permitidas);
  if (!empresa) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  return { ok: true, info: await projetarCaixa(supabaseAdmin(), empresa) };
}

// Metas de um ano + o progresso do mês corrente (para a tela mostrar "quanto falta").
export async function listarMetasDiretoriaAction(empresaId: number, ano: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const empresa = await empresaDoUsuario(empresaId, ctx.permitidas);
  if (!empresa) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const db = supabaseAdmin();
  const { data, error } = await db.from('diretoria_metas').select('mes, tipo, valor, atualizado_por, atualizado_em').eq('empresa_id', empresaId).eq('ano', ano);
  if (error) return { ok: false, erro: error.message };
  const { data: cadastro } = await db.from('empresas').select('*').eq('id', empresaId).maybeSingle();
  const hoje = hojeISO();
  const progresso = Number(hoje.slice(0, 4)) === ano
    ? await progressoMetasDoMes(db, empresaId, cadastro?.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S', hoje).catch(() => null)
    : null;
  return { ok: true, info: { metas: data || [], progresso } };
}

// Grava várias metas de uma vez. valor null = apaga a meta daquele mês/tipo.
export async function salvarMetasDiretoriaAction(empresaId: number, ano: number, itens: { mes: number; tipo: string; valor: number | null }[], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const empresa = await empresaDoUsuario(empresaId, ctx.permitidas);
  if (!empresa) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) return { ok: false, erro: 'Ano inválido.' };
  const validos = itens.filter(i => Number.isInteger(i.mes) && i.mes >= 1 && i.mes <= 12 && (TIPOS_META as readonly string[]).includes(i.tipo));
  if (validos.some(i => i.valor != null && (!Number.isFinite(i.valor) || i.valor < 0))) return { ok: false, erro: 'Valores precisam ser números maiores ou iguais a zero.' };

  const db = supabaseAdmin();
  const agora = new Date().toISOString();
  const gravar = validos.filter(i => i.valor != null).map(i => ({ empresa_id: empresaId, ano, mes: i.mes, tipo: i.tipo, valor: i.valor, atualizado_em: agora, atualizado_por: ctx.perfil.nome }));
  if (gravar.length) {
    const { error } = await db.from('diretoria_metas').upsert(gravar, { onConflict: 'empresa_id,ano,mes,tipo' });
    if (error) return { ok: false, erro: error.message };
  }
  for (const i of validos.filter(x => x.valor == null)) {
    await db.from('diretoria_metas').delete().eq('empresa_id', empresaId).eq('ano', ano).eq('mes', i.mes).eq('tipo', i.tipo);
  }
  registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: `ALTEROU METAS DO DIRETOR (${empresa.nome}, ${ano})`, setor: 'DIRETORIA', equipamento_nome: `${validos.length} valor(es)` });
  return { ok: true };
}

// --- Chat "pergunte ao diretor" (aba Perguntar). Cada conversa é só de quem a criou. ---

export async function listarConversasDiretoriaAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { data, error } = await supabaseAdmin().from('diretoria_conversas').select('id, titulo, atualizado_em, custo_usd')
    .eq('perfil_id', ctx.perfil.id).order('atualizado_em', { ascending: false }).limit(50);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: data || [] };
}

export async function obterConversaDiretoriaAction(id: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { data, error } = await supabaseAdmin().from('diretoria_conversas').select('id, titulo, exibicao, custo_usd').eq('id', id).eq('perfil_id', ctx.perfil.id).maybeSingle();
  if (error) return { ok: false, erro: error.message };
  if (!data) return { ok: false, erro: 'Conversa não encontrada.' };
  return { ok: true, info: data };
}

export async function perguntarDiretorAction(conversaId: string | null, pergunta: string, empresaTelaId: number | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  const { data: empresas } = await db.from('empresas').select('*').eq('ativo', true).order('id');
  const visiveis: EmpresaChat[] = ((empresas || []) as any[])
    .filter(e => ctx.permitidas === null || ctx.permitidas.includes(e.id))
    .map(e => ({ id: e.id, nome: ((e.nome_curto || e.nome) as string).trim(), fonte_recebimentos: e.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S' }));
  const r = await perguntarAoDiretor(db, { id: ctx.perfil.id, nome: ctx.perfil.nome }, { conversaId, pergunta, empresas: visiveis, empresaTelaId });
  return r.ok ? { ok: true, info: { conversaId: r.conversaId, resposta: r.resposta } } : { ok: false, erro: r.erro };
}

export async function excluirConversaDiretoriaAction(id: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { error } = await supabaseAdmin().from('diretoria_conversas').delete().eq('id', id).eq('perfil_id', ctx.perfil.id);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

export async function listarParametrosDiretoriaAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { data, error } = await supabaseAdmin().from('diretoria_parametros').select('chave, valor, rotulo, descricao, ordem, atualizado_em, atualizado_por').order('ordem');
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: data || [] };
}

export async function salvarParametroDiretoriaAction(chave: string, valor: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!(chave in PARAMETROS_PADRAO)) return { ok: false, erro: 'Parâmetro desconhecido.' };
  if (!Number.isFinite(valor) || valor < 0) return { ok: false, erro: 'Informe um número maior ou igual a zero.' };
  const { error } = await supabaseAdmin().from('diretoria_parametros')
    .update({ valor, atualizado_em: new Date().toISOString(), atualizado_por: ctx.perfil.nome }).eq('chave', chave as ChaveParametro);
  if (error) return { ok: false, erro: error.message };
  registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: `ALTEROU PARÂMETRO DO DIRETOR: ${chave} = ${valor}`, setor: 'DIRETORIA' });
  return { ok: true };
}
