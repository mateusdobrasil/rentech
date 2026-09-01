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

interface ContextoLocalDia {
  id: string; empresa_id: number; data: string; local_id: string;
  horario_padrao: string | null; tipo_id: string | null; tipo_nome: string | null;
  evento: string | null; responsavel: string | null;
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

// Catálogo de tipos de escala (escala_tipo) — global (não por empresa,
// mesmo critério de folha_departamento: tipo de operação não muda por
// empresa). Substituiu um enum fixo no código pra crescer sem deploy — ver
// sql/escala_tipo.sql.
export async function listarTiposAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('escala_tipo').select('id, nome').eq('ativo', true).order('nome');
    if (error) throw error;
    return { ok: true, info: { tipos: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarTipoAction(params: { nome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const nome = params.nome.trim();
  if (!nome) return { ok: false, erro: 'Informe o nome do tipo.' };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('escala_tipo')
      .upsert({ nome, ativo: true }, { onConflict: 'nome' })
      .select('id, nome').single();
    if (error) throw error;
    return { ok: true, info: { tipo: data } };
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

// Dias do mês (empresa específica) que já têm colaborador alocado, com a
// quantidade de cada dia — alimenta a aba "Escalas Montadas" (calendário do
// mês, com o total de gente escalada em cada dia), pro coordenador enxergar
// de longe onde já tem escala pronta sem precisar ir trocando a data um a um.
export async function listarDiasComEscalaAction(params: { empresaId: number; ano: number; mes: number }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const inicio = `${params.ano}-${String(params.mes).padStart(2, '0')}-01`;
    const proximoMes = params.mes === 12 ? { ano: params.ano + 1, mes: 1 } : { ano: params.ano, mes: params.mes + 1 };
    const fim = `${proximoMes.ano}-${String(proximoMes.mes).padStart(2, '0')}-01`;

    const { data, error } = await db
      .from('escala_alocacoes').select('data')
      .eq('empresa_id', params.empresaId).gte('data', inicio).lt('data', fim);
    if (error) throw error;

    const contagem = new Map<string, number>();
    (data || []).forEach(d => contagem.set(d.data as string, (contagem.get(d.data as string) || 0) + 1));
    const dias = Array.from(contagem.entries()).map(([dia, quantidade]) => ({ dia, quantidade }));
    return { ok: true, info: { dias } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Um colaborador pode ter mais de um turno no mesmo dia (ex: visita técnica
// de manhã, desmontagem à tarde — ver sql/escala_multiplos_turnos.sql, que
// removeu o unique(empresa,data,funcionario) que travava isso a 1 por dia).
// Por isso não é mais upsert por pessoa+dia: com `id`, atualiza aquele turno
// específico (editar horário ou mover pra outro local); sem `id`, sempre
// cria um turno novo (arrastar do pool).
export async function salvarAlocacaoAction(params: {
  id?: string; empresaId: number; data: string; funcionarioNome: string; departamento: string | null;
  localId: string; localNome: string; horario: string; observacao?: string | null; criadoPor: string;
}, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    if (params.id) {
      const { data, error } = await db
        .from('escala_alocacoes')
        .update({
          local_id: params.localId, local_nome: params.localNome, horario: params.horario,
          observacao: params.observacao || null, atualizado_em: new Date().toISOString(),
        })
        .eq('id', params.id).eq('empresa_id', params.empresaId)
        .select('*').single();
      if (error) throw error;
      return { ok: true, info: { alocacao: data as Alocacao } };
    }

    const { data, error } = await db
      .from('escala_alocacoes')
      .insert({
        empresa_id: params.empresaId, data: params.data, funcionario_nome: params.funcionarioNome,
        departamento: params.departamento, local_id: params.localId, local_nome: params.localNome,
        horario: params.horario, observacao: params.observacao || null, criado_por: params.criadoPor,
      })
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

    // Contexto do local (horário padrão/tipo/evento/responsável) do dia de
    // origem também é copiado — sem isso, "copiar de ontem" traria os
    // colaboradores mas perderia o que estavam fazendo lá.
    const { data: contextoOrigem, error: erroContexto } = await db
      .from('escala_locais_dia').select('*')
      .eq('empresa_id', params.empresaId).eq('data', params.dataOrigem);
    if (erroContexto) throw erroContexto;

    if (contextoOrigem && contextoOrigem.length > 0) {
      const linhasContexto = (contextoOrigem as ContextoLocalDia[]).map(c => ({
        empresa_id: params.empresaId, data: params.dataDestino, local_id: c.local_id,
        horario_padrao: c.horario_padrao, tipo_id: c.tipo_id, tipo_nome: c.tipo_nome,
        evento: c.evento, responsavel: c.responsavel,
      }));
      const { error: erroUpsertContexto } = await db
        .from('escala_locais_dia')
        .upsert(linhasContexto, { onConflict: 'empresa_id,data,local_id', ignoreDuplicates: true });
      if (erroUpsertContexto) throw erroUpsertContexto;
    }

    if (!origem || origem.length === 0) return { ok: true, info: { copiados: 0 } };

    // Colaborador pode ter mais de um turno por dia agora, então não dá mais
    // pra distinguir "já copiado" só por pessoa — usa pessoa+local: evita
    // duplicar o mesmo turno se "copiar de ontem" for clicado de novo, mas
    // deixa passar um turno genuinamente novo (outro local) da mesma pessoa.
    const { data: destinoExistente, error: erroDestino } = await db
      .from('escala_alocacoes').select('funcionario_nome, local_id')
      .eq('empresa_id', params.empresaId).eq('data', params.dataDestino);
    if (erroDestino) throw erroDestino;
    const jaExiste = new Set((destinoExistente || []).map(d => `${d.funcionario_nome}|${d.local_id}`));

    const linhas = (origem as Alocacao[])
      .filter(a => !jaExiste.has(`${a.funcionario_nome}|${a.local_id}`))
      .map(a => ({
        empresa_id: params.empresaId, data: params.dataDestino, funcionario_nome: a.funcionario_nome,
        departamento: a.departamento, local_id: a.local_id, local_nome: a.local_nome, horario: a.horario,
        observacao: a.observacao, criado_por: params.criadoPor,
      }));

    if (linhas.length > 0) {
      const { error } = await db.from('escala_alocacoes').insert(linhas);
      if (error) throw error;
    }
    return { ok: true, info: { copiados: linhas.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function listarContextoLocaisDiaAction(params: { empresaId: number; data: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('escala_locais_dia').select('*')
      .eq('empresa_id', params.empresaId).eq('data', params.data);
    if (error) throw error;
    return { ok: true, info: { contextos: (data || []) as ContextoLocalDia[] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Salva o contexto do local naquele dia (horário padrão, tipo, evento,
// responsável) — cada campo é opcional (undefined = não mexe nele, mantém o
// que já tinha), então a tela pode chamar essa action um campo por vez sem
// perder os outros. Quando `horarioPadrao` é informado, propaga pra todos os
// colaboradores já alocados nesse local naquele dia (exceções pontuais
// continuam editáveis direto no card do colaborador).
export async function salvarContextoLocalAction(params: {
  empresaId: number; data: string; localId: string;
  horarioPadrao?: string | null; tipoId?: string | null; tipoNome?: string | null;
  evento?: string | null; responsavel?: string | null;
}, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { data: existente } = await db
      .from('escala_locais_dia').select('*')
      .eq('empresa_id', params.empresaId).eq('data', params.data).eq('local_id', params.localId).maybeSingle();

    const payload = {
      empresa_id: params.empresaId, data: params.data, local_id: params.localId,
      horario_padrao: params.horarioPadrao !== undefined ? params.horarioPadrao : (existente?.horario_padrao ?? null),
      tipo_id: params.tipoId !== undefined ? params.tipoId : (existente?.tipo_id ?? null),
      tipo_nome: params.tipoNome !== undefined ? params.tipoNome : (existente?.tipo_nome ?? null),
      evento: params.evento !== undefined ? params.evento : (existente?.evento ?? null),
      responsavel: params.responsavel !== undefined ? params.responsavel : (existente?.responsavel ?? null),
      atualizado_em: new Date().toISOString(),
    };

    const { data: salvo, error } = await db
      .from('escala_locais_dia')
      .upsert(payload, { onConflict: 'empresa_id,data,local_id' })
      .select('*').single();
    if (error) throw error;

    if (params.horarioPadrao !== undefined && params.horarioPadrao) {
      const { error: erroBulk } = await db
        .from('escala_alocacoes')
        .update({ horario: params.horarioPadrao, atualizado_em: new Date().toISOString() })
        .eq('empresa_id', params.empresaId).eq('data', params.data).eq('local_id', params.localId);
      if (erroBulk) throw erroBulk;
    }

    return { ok: true, info: { contexto: salvo as ContextoLocalDia } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Tira um local da visão do dia (a tela só mostra locais com alocação ou
// contexto salvo naquele dia — ver locaisAtivosHoje em page.tsx). Só permite
// remover se ninguém estiver alocado ali naquele dia, pra nunca esconder
// gente já escalada sem querer; o local em si continua no catálogo
// (escala_locais), só some da tela desse dia específico.
export async function removerLocalDiaAction(params: { empresaId: number; data: string; localId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizarEmpresa(accessToken, params.empresaId);
  if (!auth.ok) return { ok: false, erro: auth.erro };

  const db = supabaseAdmin();
  try {
    const { count, error: erroCount } = await db
      .from('escala_alocacoes').select('id', { count: 'exact', head: true })
      .eq('empresa_id', params.empresaId).eq('data', params.data).eq('local_id', params.localId);
    if (erroCount) throw erroCount;
    if ((count || 0) > 0) return { ok: false, erro: 'Esse local ainda tem colaboradores alocados hoje.' };

    const { error } = await db
      .from('escala_locais_dia').delete()
      .eq('empresa_id', params.empresaId).eq('data', params.data).eq('local_id', params.localId);
    if (error) throw error;
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Avisa cada colaborador alocado no dia (WhatsApp individual, um por um) do
// local e horário dele, com um link de confirmação de ciência
// (/api/confirmar-escala?id=<alocacao.id> — a gestão vê quem confirmou pelo
// campo escala_alocacoes.confirmado_em, atualizado por esse Route Handler).
// Texto livre só entrega se o colaborador falou com o WhatsApp da empresa
// nas últimas 24h (enviarComJanela cuida dessa decisão); fora disso cai
// automaticamente no Message Template — por isso o disparo nunca falha
// silenciosamente por causa da janela, só se o template ainda não estiver
// aprovado na Meta. O template tem 5 variáveis agora (a 5ª é o link) — se
// o nome/corpo aprovado na Meta ainda for a versão de 4 variáveis, o envio
// via template falha até re-aprovar (ver sql/escala_confirmacao.sql). Pula
// quem já foi notificado antes (escala_alocacoes.notificado_em) — sem isso,
// notificar de novo depois de adicionar uma turma nova no mesmo dia
// reenviava a mensagem pra quem já tinha recebido de manhã (ver
// sql/escala_notificacao_status.sql).
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
      .from('escala_alocacoes').select('id, funcionario_nome, local_nome, horario, notificado_em')
      .eq('empresa_id', params.empresaId).eq('data', params.data);
    if (erroAlocacoes) throw erroAlocacoes;
    if (!alocacoes || alocacoes.length === 0) return { ok: true, info: { enviados: 0, semCelular: [], falhas: [], jaNotificados: 0 } };

    const pendentes = (alocacoes as { id: string; funcionario_nome: string; local_nome: string; horario: string; notificado_em: string | null }[])
      .filter(a => !a.notificado_em);
    const jaNotificados = alocacoes.length - pendentes.length;
    if (pendentes.length === 0) return { ok: true, info: { enviados: 0, semCelular: [], falhas: [], jaNotificados } };

    const nomes = pendentes.map(a => a.funcionario_nome);
    const { data: funcionarios, error: erroFuncs } = await db
      .from('folha_funcionarios').select('nome_completo, celular').in('nome_completo', nomes);
    if (erroFuncs) throw erroFuncs;
    const celularPorNome = new Map((funcionarios || []).map(f => [f.nome_completo, f.celular as string | null]));

    const dataExtenso = fmtDataExtensoServer(params.data);
    const provedor = await resolverProvedor('ENVIO');

    let enviados = 0;
    const semCelular: string[] = [];
    const falhas: string[] = [];

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    for (const a of pendentes) {
      const celular = celularPorNome.get(a.funcionario_nome);
      if (!celular) { semCelular.push(a.funcionario_nome); continue; }

      const primeiroNome = a.funcionario_nome.split(' ')[0];
      const horarioFmt = a.horario?.slice(0, 5) || '--:--';
      const link = `${baseUrl}/api/confirmar-escala?id=${a.id}`;
      const textoLivre = `Olá ${primeiroNome}! Sua escala de ${dataExtenso} já está definida:\n\n📍 Local: ${a.local_nome}\n🕐 Horário: ${horarioFmt}\n\n${link}\nQualquer dúvida, fale com seu encarregado ou coordenador.`;
      const templateMeta: TemplateMeta = {
        nome: templateNome, idioma: templateIdioma,
        parametros: [primeiroNome, dataExtenso, a.local_nome, horarioFmt, link],
      };

      const res = await enviarComJanela(provedor, celular, textoLivre, templateMeta);
      if (res.ok) {
        enviados++;
        await db.from('escala_alocacoes').update({ notificado_em: new Date().toISOString() }).eq('id', a.id);
      } else {
        falhas.push(a.funcionario_nome);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Mesmo rastro que dispararAutomacaoWhatsApp deixa (automacoes.ts) —
    // alimenta o contador "WhatsApp Enviados este mês" e o "Última Execução"
    // do card em /admin/parametros/agendamentos.
    if (enviados > 0) {
      await db.from('folha_automacoes_envios').insert({ chave: ESCALA_AUTOMACAO_CHAVE, canal: 'WhatsApp', quantidade: enviados });
    }
    await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', ESCALA_AUTOMACAO_CHAVE);

    return { ok: true, info: { enviados, semCelular, falhas, jaNotificados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
