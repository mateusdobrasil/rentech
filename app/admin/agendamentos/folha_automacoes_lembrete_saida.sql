-- Execute no SQL Editor do Supabase.
-- Cadastra a automação "Lembrete de Ponto - Saída" (chave 'lembrete-ponto2'),
-- disparada pelo Cron da Vercel às 19h (Seg a Sex) — ver app/api/cron/lembrete-ponto2/route.ts
-- e a entrada correspondente em vercel.json.

insert into public.folha_automacoes (chave, nome, descricao, tipo, gatilho, canais, publico_alvo, ativo, destinatarios)
values (
  'lembrete-ponto2',
  'Lembrete de Ponto - Saída',
  'Avisa a equipe técnica às 19h para registrar a saída antes de encerrar o turno.',
  'CRON',
  '19:00 (Seg a Sex)',
  array['WhatsApp'],
  'Técnicos de Campo',
  true,
  '{}'
)
on conflict (chave) do nothing;
