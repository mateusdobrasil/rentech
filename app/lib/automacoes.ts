// Disparo de WhatsApp para automações cadastradas em folha_automacoes (tela
// Agendamentos e Disparos). Antes de enviar, respeita o "disjuntor" (`ativo`),
// o canal, a lista de `destinatarios` (vazio = todos os funcionários ativos
// com celular; com nomes = só eles) e usa o template salvo em `mensagem`,
// substituindo placeholders {{assim}} — nada disso depende mais de código.
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabase';
import { resolverProvedorAutomacao, enviarComJanela, type ProvedorAutomacao, type TemplateMeta } from './whatsapp';

interface ResultadoDisparoAutomacao {
  disparado: boolean; // false se a automação está desativada, sem canal WhatsApp ou sem mensagem configurada
  disparos: number;
  erros: string[];
}

function preencherTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, chave) => (vars[chave] !== undefined ? String(vars[chave]) : match));
}

// Brasil não observa mais horário de verão (abolido em 2019), então
// America/Sao_Paulo é sempre UTC-3 fixo — mesmo cálculo usado em
// app/api/cron/motor/route.ts e app/lib/documentos.ts.
function hojeNoBrasil(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

// Funcionários ativos, com celular, cujo mês/dia de nascimento batem com hoje
// (o ano de nascimento é ignorado). Usado pelo público 'ANIVERSARIANTES_FUNCIONARIOS'.
async function listarAniversariantesFuncionarios(db: ReturnType<typeof supabaseAdmin>): Promise<{ nome_completo: string; celular: string }[]> {
  const hoje = hojeNoBrasil();
  const mes = hoje.getMonth();
  const dia = hoje.getDate();

  const { data } = await db
    .from('folha_funcionarios')
    .select('nome_completo, celular, data_nascimento')
    .eq('ativo', true)
    .not('celular', 'is', null)
    .not('data_nascimento', 'is', null);

  return ((data || []) as { nome_completo: string; celular: string; data_nascimento: string }[])
    .filter(f => {
      const nascimento = new Date(`${f.data_nascimento}T00:00:00`);
      return nascimento.getMonth() === mes && nascimento.getDate() === dia;
    })
    .map(f => ({ nome_completo: f.nome_completo, celular: f.celular }));
}

// `contexto` traz variáveis extras específicas do evento (ex: {{numero_op}}, {{valor}}
// para o webhook de OP). {{primeiro_nome}} e {{nome_completo}} já vêm prontos do
// cadastro do funcionário destinatário.
export async function dispararAutomacaoWhatsApp(chave: string, contexto: Record<string, string | number> = {}): Promise<ResultadoDisparoAutomacao> {
  const db = supabaseAdmin();

  const { data: automacao } = await db
    .from('folha_automacoes')
    .select('ativo, canais, destinatarios, mensagem, provedor_whatsapp, meta_template_nome, meta_template_idioma, meta_template_variaveis, publico_dinamico')
    .eq('chave', chave)
    .maybeSingle();

  if (!automacao || automacao.ativo === false || !(automacao.canais || []).includes('WhatsApp')) {
    return { disparado: false, disparos: 0, erros: [] };
  }
  if (!automacao.mensagem) {
    return { disparado: false, disparos: 0, erros: ['Automação sem mensagem configurada.'] };
  }

  let funcionarios: { nome_completo: string; celular: string }[];
  if (automacao.publico_dinamico === 'ANIVERSARIANTES_FUNCIONARIOS') {
    // Destinatários calculados a cada execução — `destinatarios` não se aplica aqui.
    funcionarios = await listarAniversariantesFuncionarios(db);
  } else {
    const destinatarios: string[] = automacao.destinatarios || [];
    let query = db
      .from('folha_funcionarios')
      .select('nome_completo, celular')
      .eq('ativo', true)
      .not('celular', 'is', null);

    if (destinatarios.length > 0) {
      query = query.in('nome_completo', destinatarios);
    }

    const { data } = await query;
    funcionarios = (data || []) as { nome_completo: string; celular: string }[];
  }

  // Resolve o provedor (Z-API ou Meta) uma única vez antes do loop — evita
  // uma leitura no banco por funcionário quando o disparo é em lote.
  // 'PADRAO' (default) segue o interruptor global de Envio; a automação
  // pode fixar Z-API ou Meta explicitamente, ignorando o global.
  const provedor = await resolverProvedorAutomacao((automacao.provedor_whatsapp as ProvedorAutomacao) || 'PADRAO');

  let disparos = 0;
  const erros: string[] = [];
  for (const f of funcionarios) {
    const vars: Record<string, string | number> = { primeiro_nome: f.nome_completo.split(' ')[0], nome_completo: f.nome_completo, ...contexto };
    const texto = preencherTemplate(automacao.mensagem, vars);

    // Template da Meta (se configurado) — os parâmetros variam por
    // funcionário porque dependem de `vars` (ex: primeiro_nome).
    const templateMeta: TemplateMeta | null = automacao.meta_template_nome ? {
      nome: automacao.meta_template_nome,
      idioma: automacao.meta_template_idioma || 'pt_BR',
      parametros: ((automacao.meta_template_variaveis as string[]) || ['primeiro_nome']).map(v => String(vars[v] ?? '')),
    } : null;

    const res = await enviarComJanela(provedor, f.celular, texto, templateMeta);
    if (res.ok) disparos++; else erros.push(f.nome_completo);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', chave);

  // Log agregado desta execução, usado pelos contadores "Enviados este mês"
  // na tela Agendamentos e Disparos.
  if (disparos > 0) {
    await db.from('folha_automacoes_envios').insert({ chave, canal: 'WhatsApp', quantidade: disparos });
  }

  return { disparado: true, disparos, erros };
}

// Irmã de dispararAutomacaoWhatsApp para o canal "E-mail" — o checkbox de
// E-mail já existia na tela Agendamentos e Disparos, mas nada em folha_automacoes
// de fato disparava e-mail (só o WhatsApp). Mesma leitura de configuração
// (ativo/canais/destinatarios/mensagem), mesmo `contexto`/placeholders, único
// canal muda: usa `folha_funcionarios.email` em vez de `celular`, e envia via
// SMTP (mesmo transporte usado em app/admin/op/actions.ts).
//
// Não cobre o público dinâmico de aniversariantes (só existe para WhatsApp
// até aqui) — se alguém configurar Aniversariantes + E-mail, retorna erro
// explícito em vez de silenciosamente não enviar nada.
export async function dispararAutomacaoEmail(chave: string, contexto: Record<string, string | number> = {}, assunto?: string): Promise<ResultadoDisparoAutomacao> {
  const db = supabaseAdmin();

  const { data: automacao } = await db
    .from('folha_automacoes')
    .select('ativo, canais, destinatarios, mensagem, publico_dinamico')
    .eq('chave', chave)
    .maybeSingle();

  if (!automacao || automacao.ativo === false || !(automacao.canais || []).includes('E-mail')) {
    return { disparado: false, disparos: 0, erros: [] };
  }
  if (!automacao.mensagem) {
    return { disparado: false, disparos: 0, erros: ['Automação sem mensagem configurada.'] };
  }
  if (automacao.publico_dinamico === 'ANIVERSARIANTES_FUNCIONARIOS') {
    return { disparado: false, disparos: 0, erros: ['Público "Aniversariantes" ainda não é suportado no canal E-mail.'] };
  }

  const destinatarios: string[] = automacao.destinatarios || [];
  let query = db.from('folha_funcionarios').select('nome_completo, email').eq('ativo', true).not('email', 'is', null);
  if (destinatarios.length > 0) query = query.in('nome_completo', destinatarios);
  const { data } = await query;
  const funcionarios = (data || []) as { nome_completo: string; email: string }[];

  if (funcionarios.length === 0) {
    return { disparado: true, disparos: 0, erros: [] };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  let disparos = 0;
  const erros: string[] = [];
  for (const f of funcionarios) {
    const vars: Record<string, string | number> = { primeiro_nome: f.nome_completo.split(' ')[0], nome_completo: f.nome_completo, ...contexto };
    const texto = preencherTemplate(automacao.mensagem, vars);

    try {
      await transporter.sendMail({
        from: `"Sistema Rentech" <${process.env.SMTP_USER}>`,
        to: f.email,
        subject: assunto || 'Aviso do Sistema Rentech',
        text: texto,
      });
      disparos++;
    } catch {
      erros.push(f.nome_completo);
    }
  }

  await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', chave);
  if (disparos > 0) {
    await db.from('folha_automacoes_envios').insert({ chave, canal: 'E-mail', quantidade: disparos });
  }

  return { disparado: true, disparos, erros };
}
