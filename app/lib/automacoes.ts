// Disparo de WhatsApp para automações cadastradas em folha_automacoes (tela
// Agendamentos e Disparos). Antes de enviar, respeita o "disjuntor" (`ativo`),
// o canal, a lista de `destinatarios` (vazio = todos os funcionários ativos
// com celular; com nomes = só eles) e usa o template salvo em `mensagem`,
// substituindo placeholders {{assim}} — nada disso depende mais de código.
import { supabaseAdmin } from './supabase';
import { enviarWhatsApp } from './zapi';

interface ResultadoDisparoAutomacao {
  disparado: boolean; // false se a automação está desativada, sem canal WhatsApp ou sem mensagem configurada
  disparos: number;
  erros: string[];
}

function preencherTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, chave) => (vars[chave] !== undefined ? String(vars[chave]) : match));
}

// `contexto` traz variáveis extras específicas do evento (ex: {{numero_op}}, {{valor}}
// para o webhook de OP). {{primeiro_nome}} e {{nome_completo}} já vêm prontos do
// cadastro do funcionário destinatário.
export async function dispararAutomacaoWhatsApp(chave: string, contexto: Record<string, string | number> = {}): Promise<ResultadoDisparoAutomacao> {
  const db = supabaseAdmin();

  const { data: automacao } = await db
    .from('folha_automacoes')
    .select('ativo, canais, destinatarios, mensagem')
    .eq('chave', chave)
    .maybeSingle();

  if (!automacao || automacao.ativo === false || !(automacao.canais || []).includes('WhatsApp')) {
    return { disparado: false, disparos: 0, erros: [] };
  }
  if (!automacao.mensagem) {
    return { disparado: false, disparos: 0, erros: ['Automação sem mensagem configurada.'] };
  }

  const destinatarios: string[] = automacao.destinatarios || [];
  let query = db
    .from('folha_funcionarios')
    .select('nome_completo, celular')
    .eq('ativo', true)
    .not('celular', 'is', null);

  if (destinatarios.length > 0) {
    query = query.in('nome_completo', destinatarios);
  }

  const { data: funcionarios } = await query;

  let disparos = 0;
  const erros: string[] = [];
  for (const f of (funcionarios || []) as { nome_completo: string; celular: string }[]) {
    const vars = { primeiro_nome: f.nome_completo.split(' ')[0], nome_completo: f.nome_completo, ...contexto };
    const texto = preencherTemplate(automacao.mensagem, vars);
    const res = await enviarWhatsApp(f.celular, texto);
    if (res.ok) disparos++; else erros.push(f.nome_completo);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', chave);

  return { disparado: true, disparos, erros };
}
