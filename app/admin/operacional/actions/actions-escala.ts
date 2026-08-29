'use server';

// app/admin/operacional/actions/actions-escala.ts
// Escala de Trabalho (/admin/operacional/escala): coordenador monta, dia a
// dia, onde cada colaborador de um departamento vai trabalhar e a que
// horário chega — arrastando o card do colaborador até o local.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { resolverProvedor, enviarComJanela, type TemplateMeta } from '../../../lib/whatsapp';

const ROTA = '/admin/operacional/escala';

// Identificador da automação em folha_automacoes (ver
// sql/agendamento_escala_notificacao.sql) — registrada lá só pra aparecer no
// painel de /admin/parametros/agendamentos, contar nas estatísticas de envio
// e virar um kill-switch real (campo `ativo`) do botão "Notificar
// Colaboradores". O disparo em si continua sendo código dedicado aqui
// embaixo (cada colaborador recebe local/horário diferentes, o que o motor
// genérico de automações não suporta — ver dispararAutomacaoWhatsApp em
// app/lib/automacoes.ts). Nome/idioma do template default abaixo só valem
// se a automação ainda não tiver sido criada no banco.
const ESCALA_AUTOMACAO_CHAVE = 'escala-notificacao-diaria';
const ESCALA_TEMPLATE_NOME_PADRAO = 'escala_notificacao_diaria';
const ESCALA_TEMPLATE_IDIOMA_PADRAO = 'pt_BR';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDataExtensoServer = (d: string) =>
  capitalize(new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }));

type Resultado = { ok: boolean; erro?: string; info?: any };

interface Alocacao {
  id: string; empresa_id: number; data: string; funcionario_nome: string; departamento: string | null;
  local_id: string | null; local_nome: string; horario: string; observacao: string | null; criado_por: string | null;
}

async function autorizarEmpresa(accessToken: string, empresaId: number) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false as const, erro: acesso.message };

  const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  if (!empresaPermitida(empresasPermitidas, empresaId)) {
    return { ok: false as const, erro: 'Você não tem acesso a esta empresa.' };
  }
  return { ok: true as const, perfil: acesso.perfil };
}

export async function listarLocaisAction(params: { empresaId: number }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('escala_locais').select('id, nome')
      .eq('empresa_id', params.empresaId).eq('ativo', true).order('nome');
    if (error) throw error;
    return { ok: true, info: { locais: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarLocalAction(params: { empresaId: number; nome: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const nome = params.nome.trim();
  if (!nome) return { ok: false, erro: 'Informe o nome do local.' };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('escala_locais')
      .upsert({ empresa_id: params.empresaId, nome, ativo: true }, { onConflict: 'empresa_id,nome' })
      .select('id, nome').single();
    if (error) throw error;
    return { ok: true, info: { local: data } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function listarEscalaDiaAction(params: { empresaId: number; data: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('escala_alocacoes').select('*')
      .eq('empresa_id', params.empresaId).eq('data', params.data)
      .order('local_nome').order('funcionario_nome');
    if (error) throw error;
    return { ok: true, info: { alocacoes: (data || []) as Alocacao[] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function salvarAlocacaoAction(params: {
  empresaId: number; data: string; funcionarioNome: string; departamento: string | null;
  localId: string; localNome: string; horario: string; observacao?: string | null; criadoPor: string;
}, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('escala_alocacoes')
      .upsert({
        empresa_id: params.empresaId, data: params.data, funcionario_nome: params.funcionarioNome,
        departamento: params.departamento, local_id: params.localId, local_nome: params.localNome,
        horario: params.horario, observacao: params.observacao || null, criado_por: params.criadoPor,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'empresa_id,data,funcionario_nome' })
      .select('*').single();
    if (error) throw error;
    return { ok: true, info: { alocacao: data as Alocacao } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function removerAlocacaoAction(params: { id: string; empresaId: number }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { error } = await db.from('escala_alocacoes').delete().eq('id', params.id).eq('empresa_id', params.empresaId);
    if (error) throw error;
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function copiarEscalaAction(params: {
  empresaId: number; dataOrigem: string; dataDestino: string; criadoPor: string;
}, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { data: origem, error: erroOrigem } = await db
      .from('escala_alocacoes').select('*')
      .eq('empresa_id', params.empresaId).eq('data', params.dataOrigem);
    if (erroOrigem) throw erroOrigem;
    if (!origem || origem.length === 0) return { ok: true, info: { copiados: 0 } };

    const linhas = (origem as Alocacao[]).map(a => ({
      empresa_id: params.empresaId, data: params.dataDestino, funcionario_nome: a.funcionario_nome,
      departamento: a.departamento, local_id: a.local_id, local_nome: a.local_nome, horario: a.horario,
      observacao: a.observacao, criado_por: params.criadoPor,
    }));

    // ignoreDuplicates: quem já tem alocação em dataDestino não é sobrescrito.
    const { error } = await db
      .from('escala_alocacoes')
      .upsert(linhas, { onConflict: 'empresa_id,data,funcionario_nome', ignoreDuplicates: true });
    if (error) throw error;
    return { ok: true, info: { copiados: linhas.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Avisa cada colaborador alocado no dia (WhatsApp individual, um por um) do
// local e horário dele. Texto livre só entrega se o colaborador falou com o
// WhatsApp da empresa nas últimas 24h (enviarComJanela cuida dessa decisão);
// fora disso cai automaticamente no Message Template — por isso o disparo
// nunca falha silenciosamente por causa da janela, só se o template ainda
// não estiver aprovado na Meta.
export async function notificarColaboradoresAction(params: { empresaId: number; data: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { data: automacao } = await db
      .from('folha_automacoes')
      .select('ativo, canais, meta_template_nome, meta_template_idioma')
      .eq('chave', ESCALA_AUTOMACAO_CHAVE)
      .maybeSingle();

    // Sem a linha ainda cadastrada (sql/agendamento_escala_notificacao.sql
    // não rodado), segue com os defaults — não bloqueia quem ainda não
    // rodou a migration. Com a linha cadastrada, `ativo=false` é o
    // kill-switch de verdade: bloqueia mesmo.
    if (automacao && (automacao.ativo === false || !(automacao.canais || []).includes('WhatsApp'))) {
      return { ok: false, erro: 'Notificação de escala desativada em Agendamentos e Disparos (Parâmetros → Agendamentos).' };
    }
    const templateNome = automacao?.meta_template_nome || ESCALA_TEMPLATE_NOME_PADRAO;
    const templateIdioma = automacao?.meta_template_idioma || ESCALA_TEMPLATE_IDIOMA_PADRAO;

    const { data: alocacoes, error: erroAlocacoes } = await db
      .from('escala_alocacoes').select('funcionario_nome, local_nome, horario')
      .eq('empresa_id', params.empresaId).eq('data', params.data);
    if (erroAlocacoes) throw erroAlocacoes;
    if (!alocacoes || alocacoes.length === 0) return { ok: true, info: { enviados: 0, semCelular: [], falhas: [] } };

    const nomes = alocacoes.map(a => a.funcionario_nome);
    const { data: funcionarios, error: erroFuncs } = await db
      .from('folha_funcionarios').select('nome_completo, celular').in('nome_completo', nomes);
    if (erroFuncs) throw erroFuncs;
    const celularPorNome = new Map((funcionarios || []).map(f => [f.nome_completo, f.celular as string | null]));

    const dataExtenso = fmtDataExtensoServer(params.data);
    const provedor = await resolverProvedor('ENVIO');

    let enviados = 0;
    const semCelular: string[] = [];
    const falhas: string[] = [];

    for (const a of alocacoes as { funcionario_nome: string; local_nome: string; horario: string }[]) {
      const celular = celularPorNome.get(a.funcionario_nome);
      if (!celular) { semCelular.push(a.funcionario_nome); continue; }

      const primeiroNome = a.funcionario_nome.split(' ')[0];
      const horarioFmt = a.horario?.slice(0, 5) || '--:--';
      const textoLivre = `Olá ${primeiroNome}! Sua escala de ${dataExtenso} já está definida:\n\n📍 Local: ${a.local_nome}\n🕐 Horário: ${horarioFmt}\n\nQualquer dúvida, fale com seu coordenador.`;
      const templateMeta: TemplateMeta = {
        nome: templateNome, idioma: templateIdioma,
        parametros: [primeiroNome, dataExtenso, a.local_nome, horarioFmt],
      };

      const res = await enviarComJanela(provedor, celular, textoLivre, templateMeta);
      if (res.ok) enviados++; else falhas.push(a.funcionario_nome);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Mesmo rastro que dispararAutomacaoWhatsApp deixa (automacoes.ts) —
    // alimenta o contador "WhatsApp Enviados este mês" e o "Última Execução"
    // do card em /admin/parametros/agendamentos.
    if (enviados > 0) {
      await db.from('folha_automacoes_envios').insert({ chave: ESCALA_AUTOMACAO_CHAVE, canal: 'WhatsApp', quantidade: enviados });
    }
    await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', ESCALA_AUTOMACAO_CHAVE);

    return { ok: true, info: { enviados, semCelular, falhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
