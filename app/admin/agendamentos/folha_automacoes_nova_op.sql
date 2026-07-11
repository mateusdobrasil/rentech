-- Execute no SQL Editor do Supabase.
-- Cadastra a automação "Notificação de Nova OP" (tipo WEBHOOK), disparada
-- direto pelo código em app/admin/op/actions.ts (função criarOP) sempre que
-- uma nova Ordem de Pagamento é criada — não depende do Cron da Vercel.
--
-- Criada com ativo=false e destinatarios vazio de propósito: como
-- destinatarios vazio significa "todos os funcionários ativos", ligar isso
-- sem antes escolher quem recebe mandaria uma mensagem pra empresa inteira
-- a cada OP criada. Configure os destinatários (ex: equipe financeira) pelo
-- modal "Configurar" em Agendamentos e Disparos, e só então ligue o toggle.

insert into public.folha_automacoes (chave, nome, descricao, tipo, gatilho, canais, publico_alvo, ativo, destinatarios)
values (
  'nova-op',
  'Notificação de Nova OP',
  'Avisa por WhatsApp sempre que uma nova Ordem de Pagamento é criada no sistema.',
  'WEBHOOK',
  'Ao Criar Nova OP',
  array['WhatsApp'],
  'A Definir',
  false,
  '{}'
)
on conflict (chave) do nothing;
