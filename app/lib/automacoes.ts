// Disparo de WhatsApp para automações cadastradas em folha_automacoes (tela
// Agendamentos e Disparos). Antes de enviar, respeita o "disjuntor" (`ativo`)
// e a lista de `destinatarios` configurada pelo admin — vazio = todos os
// funcionários ativos com celular; com nomes = só eles.
import { supabaseAdmin } from './supabase';
import { enviarWhatsApp } from './zapi';

interface ResultadoDisparoAutomacao {
  disparado: boolean; // false se a automação está desativada ou sem canal WhatsApp
  disparos: number;
  erros: string[];
}

export async function dispararAutomacaoWhatsApp(chave: string, mensagem: string): Promise<ResultadoDisparoAutomacao> {
  const db = supabaseAdmin();

  const { data: automacao } = await db
    .from('folha_automacoes')
    .select('ativo, canais, destinatarios')
    .eq('chave', chave)
    .maybeSingle();

  if (!automacao || automacao.ativo === false || !(automacao.canais || []).includes('WhatsApp')) {
    return { disparado: false, disparos: 0, erros: [] };
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
  for (const f of funcionarios || []) {
    const res = await enviarWhatsApp(f.celular as string, mensagem);
    if (res.ok) disparos++; else erros.push(f.nome_completo);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', chave);

  return { disparado: true, disparos, erros };
}
