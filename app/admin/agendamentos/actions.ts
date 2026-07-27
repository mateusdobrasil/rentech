'use server';

// Server actions da tela de Agendamentos e Disparos, com service role.
// A tabela folha_automacoes é o "disjuntor": o Cron (app/api/cron/*) lê o
// campo `ativo` antes de disparar qualquer mensagem. Desligar aqui impede
// o envio sem precisar mexer em código ou na Vercel.
import { supabaseAdmin } from '../../lib/supabase';
import { verificarConexaoZapi } from '../../lib/zapi';

export interface RotinaAutomacaoDB {
  id: number;
  chave: string;
  nome: string;
  descricao: string | null;
  tipo: 'CRON' | 'WEBHOOK';
  gatilho: string | null;
  canais: string[];
  publico_alvo: string | null;
  ativo: boolean;
  ultima_execucao: string | null;
  destinatarios: string[];
  mensagem: string | null;
  horario: string | null; // 'HH:MM', só para tipo CRON
  dias_semana: number[]; // 0=Dom..6=Sáb, só para tipo CRON
  provedor_whatsapp: 'PADRAO' | 'ZAPI' | 'META';
  meta_template_nome: string | null;
  meta_template_idioma: string;
  meta_template_variaveis: string[];
}

export interface FormAutomacao {
  nome: string;
  descricao: string;
  tipo: 'CRON' | 'WEBHOOK';
  gatilho: string;
  canais: string[];
  publico_alvo: string;
  destinatarios: string[]; // nome_completo dos funcionários; vazio = todos os ativos
  mensagem: string;
  horario: string;
  dias_semana: number[];
  provedor_whatsapp: 'PADRAO' | 'ZAPI' | 'META';
  meta_template_nome: string; // vazio = sem template (texto livre, melhor esforço na Meta)
  meta_template_idioma: string;
  meta_template_variaveis: string; // separadas por vírgula na tela; convertido em array só ao salvar
}

export interface FuncionarioParaAutomacao {
  nome_completo: string;
  cargo: string | null;
}

type Resultado<T = undefined> = { ok: boolean; erro?: string; data?: T };

const slugify = (texto: string) =>
  texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export async function listarAutomacoesAction(): Promise<Resultado<RotinaAutomacaoDB[]>> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_automacoes')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return { ok: true, data: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Lista os funcionários ativos disponíveis para seleção como destinatários,
// agrupáveis por cargo (não há uma coluna de "departamento" na tabela).
export async function listarFuncionariosParaAutomacaoAction(): Promise<Resultado<FuncionarioParaAutomacao[]>> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_funcionarios')
      .select('nome_completo, cargo')
      .eq('ativo', true)
      .order('cargo', { ascending: true })
      .order('nome_completo', { ascending: true });
    if (error) throw new Error(error.message);
    return { ok: true, data: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function alternarStatusAutomacaoAction(id: number, ativo: boolean): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_automacoes').update({ ativo }).eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

const NOMES_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Monta o rótulo exibido no card a partir do horário/dias configurados,
// pra não ficar um texto livre desalinhado do agendamento real.
function formatarGatilhoCron(horario: string, diasSemana: number[]): string {
  if (!horario) return '';
  const dias = [...diasSemana].sort();
  const ehSegASex = dias.length === 5 && dias.join(',') === '1,2,3,4,5';
  const todosOsDias = dias.length === 7;
  const rotuloDias = todosOsDias ? 'Todos os dias' : ehSegASex ? 'Seg a Sex' : dias.map(d => NOMES_DIAS[d]).join(', ');
  return `${horario} (${rotuloDias})`;
}

// Gera uma `chave` (identificador técnico estável, lido pelo Cron) a partir do
// nome digitado, garantindo unicidade com um sufixo numérico se necessário.
async function gerarChaveUnica(db: ReturnType<typeof supabaseAdmin>, nome: string): Promise<string> {
  const base = slugify(nome) || 'automacao';
  let candidata = base;
  let sufixo = 2;
  while (true) {
    const { data } = await db.from('folha_automacoes').select('id').eq('chave', candidata).maybeSingle();
    if (!data) return candidata;
    candidata = `${base}-${sufixo}`;
    sufixo++;
  }
}

// Converte "primeiro_nome, valor" (como a RH digita na tela) em ['primeiro_nome', 'valor'].
const parseVariaveisTemplate = (texto: string): string[] =>
  (texto || '').split(',').map(s => s.trim()).filter(Boolean);

export async function criarAutomacaoAction(payload: FormAutomacao): Promise<Resultado<{ chave: string }>> {
  const db = supabaseAdmin();
  const nome = payload.nome.trim();
  if (!nome) return { ok: false, erro: 'Informe o nome da automação.' };
  if (!payload.canais || payload.canais.length === 0) return { ok: false, erro: 'Selecione ao menos um canal de disparo.' };

  if (payload.tipo === 'CRON' && !payload.horario) return { ok: false, erro: 'Informe o horário do disparo.' };
  if (payload.tipo === 'CRON' && (!payload.dias_semana || payload.dias_semana.length === 0)) return { ok: false, erro: 'Selecione ao menos um dia da semana.' };

  try {
    const chave = await gerarChaveUnica(db, nome);
    const gatilho = payload.tipo === 'CRON' ? formatarGatilhoCron(payload.horario, payload.dias_semana) : (payload.gatilho?.trim() || null);
    const { error } = await db.from('folha_automacoes').insert({
      chave,
      nome,
      descricao: payload.descricao?.trim() || null,
      tipo: payload.tipo,
      gatilho,
      canais: payload.canais,
      publico_alvo: payload.publico_alvo?.trim() || null,
      destinatarios: payload.destinatarios || [],
      mensagem: payload.mensagem?.trim() || null,
      horario: payload.tipo === 'CRON' ? payload.horario : null,
      dias_semana: payload.tipo === 'CRON' ? payload.dias_semana : [1, 2, 3, 4, 5],
      provedor_whatsapp: payload.provedor_whatsapp || 'PADRAO',
      meta_template_nome: payload.meta_template_nome?.trim() || null,
      meta_template_idioma: payload.meta_template_idioma?.trim() || 'pt_BR',
      meta_template_variaveis: parseVariaveisTemplate(payload.meta_template_variaveis),
      ativo: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { chave } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Atualiza os dados descritivos da automação. A `chave` nunca é alterada aqui:
// ela é o vínculo estável usado pela rota de Cron correspondente.
export async function atualizarAutomacaoAction(id: number, payload: FormAutomacao): Promise<Resultado> {
  const db = supabaseAdmin();
  const nome = payload.nome.trim();
  if (!nome) return { ok: false, erro: 'Informe o nome da automação.' };
  if (!payload.canais || payload.canais.length === 0) return { ok: false, erro: 'Selecione ao menos um canal de disparo.' };

  if (payload.tipo === 'CRON' && !payload.horario) return { ok: false, erro: 'Informe o horário do disparo.' };
  if (payload.tipo === 'CRON' && (!payload.dias_semana || payload.dias_semana.length === 0)) return { ok: false, erro: 'Selecione ao menos um dia da semana.' };

  try {
    const gatilho = payload.tipo === 'CRON' ? formatarGatilhoCron(payload.horario, payload.dias_semana) : (payload.gatilho?.trim() || null);
    const { error } = await db.from('folha_automacoes').update({
      nome,
      descricao: payload.descricao?.trim() || null,
      tipo: payload.tipo,
      gatilho,
      canais: payload.canais,
      publico_alvo: payload.publico_alvo?.trim() || null,
      destinatarios: payload.destinatarios || [],
      mensagem: payload.mensagem?.trim() || null,
      horario: payload.tipo === 'CRON' ? payload.horario : null,
      dias_semana: payload.tipo === 'CRON' ? payload.dias_semana : [1, 2, 3, 4, 5],
      provedor_whatsapp: payload.provedor_whatsapp || 'PADRAO',
      meta_template_nome: payload.meta_template_nome?.trim() || null,
      meta_template_idioma: payload.meta_template_idioma?.trim() || 'pt_BR',
      meta_template_variaveis: parseVariaveisTemplate(payload.meta_template_variaveis),
    }).eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Soma real de disparos deste mês, por canal, a partir de folha_automacoes_envios
// (substitui os números fixos "1.240" / "450" que existiam antes).
export async function contarEnviosMesAction(): Promise<Resultado<{ whatsapp: number; email: number }>> {
  const db = supabaseAdmin();
  try {
    const agora = new Date();
    const inicioMes = new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), 1)).toISOString();
    const { data, error } = await db
      .from('folha_automacoes_envios')
      .select('canal, quantidade')
      .gte('criado_em', inicioMes);
    if (error) throw new Error(error.message);

    const whatsapp = (data || []).filter(d => d.canal === 'WhatsApp').reduce((s, d) => s + d.quantidade, 0);
    const email = (data || []).filter(d => d.canal === 'E-mail').reduce((s, d) => s + d.quantidade, 0);
    return { ok: true, data: { whatsapp, email } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Checagem ao vivo da conexão da Z-API (substitui o badge fixo "Conectado").
export async function verificarStatusZapiAction(): Promise<Resultado<{ conectado: boolean; detalhe?: string }>> {
  const resultado = await verificarConexaoZapi();
  return { ok: true, data: resultado };
}

export async function excluirAutomacaoAction(id: number): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_automacoes').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
