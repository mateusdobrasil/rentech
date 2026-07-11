import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Inicializa o Supabase com a chave de serviço (Service Role Key) 
// para ignorar as restrições de RLS, já que isto é um processo de backend automatizado.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  // 1. Barreira de Segurança: Verifica se quem está a chamar a rota é realmente a Vercel
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }

  try {
    // 2. Disjuntor: verifica se esta automação está ligada e busca a lista de destinatários
    const { data: automacao, error: automacaoError } = await supabase
      .from('folha_automacoes')
      .select('ativo, destinatarios')
      .eq('chave', 'lembrete-ponto')
      .single();

    if (automacaoError) {
      console.error('Erro ao verificar folha_automacoes:', automacaoError);
    }
    if (automacao && automacao.ativo === false) {
      return NextResponse.json({ success: true, skipped: true, message: 'Automação desativada em Agendamentos e Disparos. Nenhuma mensagem enviada.' });
    }

    // 3. Buscar os funcionários ativos no banco de dados.
    // Se a automação tiver destinatários específicos selecionados em Agendamentos
    // e Disparos, dispara só para eles; senão, vai para todos os ativos.
    const destinatarios: string[] = automacao?.destinatarios || [];
    let query = supabase
      .from('folha_funcionarios')
      .select('nome_completo, celular')
      .eq('ativo', true)
      .not('celular', 'is', null);

    if (destinatarios.length > 0) {
      query = query.in('nome_completo', destinatarios);
    }

    const { data: funcionarios, error } = await query;

    if (error) throw error;
    if (!funcionarios || funcionarios.length === 0) {
      return NextResponse.json({ message: 'Nenhum funcionário com celular cadastrado entre os destinatários selecionados.' });
    }

    // 4. Preparar credenciais da Z-API
    const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
    const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
    const ZAPI_CLIENT_TOKEN = process.env.API_CLIENT_TOKEN;
    
    if (!ZAPI_INSTANCE || !ZAPI_TOKEN) {
      throw new Error('Credenciais da Z-API não configuradas nas variáveis de ambiente.');
    }

    const zapiUrl = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

    let disparosComSucesso = 0;
    const falhas: string[] = [];

    // 5. Disparar o WhatsApp para cada funcionário
    for (const func of funcionarios) {
      // Limpa a formatação do número (remove parênteses, espaços, traços)
      const celularLimpo = func.celular.replace(/\D/g, '');
      const primeiroNome = func.nome_completo.split(' ')[0];
      
      const mensagem = `Olá, *${primeiroNome}*! ☀️\n\nEste é o lembrete diário do RH da Rentech.\nNão se esqueça de registar o início do seu turno e eventuais marcações de ponto no nosso portal.\n\nTenha um excelente dia de trabalho! 🚀`;

      const response = await fetch(zapiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Token': ZAPI_CLIENT_TOKEN || ''
        },
        body: JSON.stringify({
          phone: `55${celularLimpo}`, // Adiciona o DDI do Brasil
          message: mensagem
        })
      });

      if (response.ok) {
        disparosComSucesso++;
      } else {
        falhas.push(func.nome_completo);
      }

      // Pequena pausa (delay) para não sobrecarregar a fila da Z-API e evitar banimentos do WhatsApp
      await new Promise(resolve => setTimeout(resolve, 1500)); 
    }

    // 6. Registrar Log de Auditoria do Sistema
    await supabase.from('logs_auditoria').insert([{
      usuario_nome: 'SISTEMA (CRON)',
      acao: 'DISPARO DE LEMBRETE DE PONTO',
      setor: 'OP',
      equipamento_nome: `Enviado para ${disparosComSucesso} técnicos. Falhas: ${falhas.length}`
    }]);

    // 7. Marca a última execução para exibir na tela de Agendamentos e Disparos
    await supabase.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', 'lembrete-ponto');

    return NextResponse.json({ 
      success: true, 
      message: 'Rotina executada com sucesso.',
      disparos: disparosComSucesso,
      erros: falhas 
    });

  } catch (error: any) {
    console.error('Erro na execução do Cron:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}