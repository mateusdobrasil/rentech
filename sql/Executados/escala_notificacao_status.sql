-- Evita reenviar WhatsApp pra quem já foi notificado da escala daquele dia.
-- Cenário real que motivou isso: coordenador monta a escala da manhã e
-- notifica; à tarde adiciona outra turma pro mesmo dia e clica em
-- "Notificar Colaboradores" de novo — sem isso, a turma da manhã recebia a
-- mensagem duas vezes. Mesmo espírito de confirmado_em (sql/escala_confirmacao.sql):
-- carimbo por alocação, sem tabela nova.
--
-- Roda uma vez no SQL Editor do Supabase.
alter table escala_alocacoes add column if not exists notificado_em timestamptz;
