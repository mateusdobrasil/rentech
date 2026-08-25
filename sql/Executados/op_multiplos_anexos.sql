-- OP (Ordem de Pagamento): agora dá pra anexar mais de um comprovante
-- (NF + recibo + comprovante de PIX, por exemplo) em /admin/op/nova.
-- file_url continua existindo e guarda só o primeiro anexo, por
-- compatibilidade com o que já lê esse campo (e-mail, painel financeiro);
-- file_urls é a lista completa. Roda uma vez no SQL Editor do Supabase.
alter table op_ordens_pagamento
  add column if not exists file_urls jsonb not null default '[]'::jsonb;
